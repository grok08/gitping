import { parseCommand } from "@gitping/command-engine";
import type { Database } from "bun:sqlite";
import type { BranchRepository } from "../repositories/branch-repository";
import type { CommandRequestRepository } from "../repositories/command-request-repository";
import type { ConversationRepository } from "../repositories/conversation-repository";
import type { MessageRepository } from "../repositories/message-repository";
import type { UserRepository } from "../repositories/user-repository";
import type { RealtimePublisher } from "../realtime/events";
import type { Conversation } from "../types/domain";
import type { MessageRecord, MessageRow } from "../types/http";

export type SendCommandOptions = {
  conversation?: string;
  conversationId?: string;
  branch?: string;
  requestId?: string;
};

export type CommandFailureReason =
  | "invalid_command"
  | "unknown_conversation"
  | "unknown_branch"
  | "request_conflict";

export type SendCommandResult =
  | { ok: true; message: MessageRecord; replayed: boolean }
  | { ok: false; reason: CommandFailureReason; error: string };

export type CommandServiceDependencies = {
  db: Database;
  users: UserRepository;
  conversations: ConversationRepository;
  branches: BranchRepository;
  messages: MessageRepository;
  requests: CommandRequestRepository;
  events: RealtimePublisher;
};

function toRecord(row: MessageRow): MessageRecord {
  return {
    seq: row.seq,
    id: row.id,
    author: row.author,
    text: row.text,
    command: row.command,
    createdAt: row.created_at,
  };
}

const defaultConversation = "engineering";
const defaultBranch = "main";
const requestConflictError = "Request id already used for another command";

function reject(
  reason: CommandFailureReason,
  error: string,
): SendCommandResult {
  return { ok: false, reason, error };
}

/**
 * A PRIMARY KEY or UNIQUE violation on the request row means another request
 * with the same id committed first, so the write we just lost was a duplicate.
 * That is a replay, not a failure. Any other constraint keeps propagating.
 */
function isDuplicateRequestRow(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as { code?: unknown }).code;

  return (
    (code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
      code === "SQLITE_CONSTRAINT_UNIQUE") &&
    error.message.includes("command_requests")
  );
}

export function createCommandService({
  db,
  users,
  conversations,
  branches,
  messages,
  requests,
  events,
}: CommandServiceDependencies) {
  /**
   * The replay answer for an id that already names a command. It runs before
   * the command is parsed because a retry does not need to be valid again: the
   * stored message is the answer. The author is read here rather than created,
   * so a replay never writes a user.
   */
  function findReplay(
    requestId: string,
    authorHandle: string,
    conversationId: string,
  ): SendCommandResult | null {
    const user = users.findByHandle(authorHandle);

    if (!user) {
      return null;
    }

    const request = requests.find(requestId);

    if (!request) {
      return null;
    }

    if (
      request.conversationId !== conversationId ||
      request.authorId !== user.id
    ) {
      return reject("request_conflict", requestConflictError);
    }

    const stored = messages.findById(request.messageId);

    if (!stored) {
      return null;
    }

    return { ok: true, message: toRecord(stored), replayed: true };
  }

  return {
    send(
      input: string,
      author: string,
      options: SendCommandOptions = {},
    ): SendCommandResult {
      let conversation: Conversation | null;
      let conversationLabel: string;

      if (options.conversationId) {
        conversationLabel = options.conversationId;
        conversation = conversations.findById(options.conversationId);
      } else {
        conversationLabel = options.conversation ?? defaultConversation;
        conversation = conversations.findByKindAndName(
          "channel",
          conversationLabel,
        );
      }

      if (!conversation) {
        return reject(
          "unknown_conversation",
          `Unknown conversation: ${conversationLabel}`,
        );
      }

      const { requestId } = options;

      if (requestId) {
        const replay = findReplay(requestId, author, conversation.id);

        if (replay) {
          return replay;
        }
      }

      let parsed: ReturnType<typeof parseCommand>;

      try {
        parsed = parseCommand(input);
      } catch {
        return reject("invalid_command", "Unsupported or invalid Git command");
      }

      if (parsed.type !== "commit") {
        return reject(
          "invalid_command",
          'For the first message flow, use: git commit -m "message"',
        );
      }

      const branchName = options.branch ?? defaultBranch;
      const branch = branches.find(conversation.id, branchName);

      if (!branch) {
        return reject("unknown_branch", `Unknown branch: ${branchName}`);
      }

      const write = db.transaction((): MessageRow => {
        const user = users.ensure(author);

        const message = messages.insert({
          id: crypto.randomUUID(),
          conversationId: conversation.id,
          branchId: branch.id,
          authorId: user.id,
          text: parsed.message,
          verb: parsed.type,
          raw: input,
          args: JSON.stringify(parsed),
          createdAt: new Date().toISOString(),
        });

        branches.setHead(branch.id, message.id);

        if (requestId) {
          requests.insert({
            id: requestId,
            conversationId: conversation.id,
            messageId: message.id,
            authorId: user.id,
            createdAt: message.created_at,
          });
        }

        return message;
      });

      let row: MessageRow;

      try {
        row = write();
      } catch (error) {
        // Two identical requests can both pass the replay lookup and then
        // serialise on the write. The loser's transaction is rolled back
        // whole (message, command, event, branch head), so the winner's
        // message is the one and only answer.
        const replay =
          requestId && isDuplicateRequestRow(error)
            ? findReplay(requestId, author, conversation.id)
            : null;

        if (!replay) {
          throw error;
        }

        return replay;
      }

      const message = toRecord(row);

      // The transaction has committed, so the row is durable before any client
      // is told about it. A rolled-back write never reaches this line. A replay
      // returns early above and publishes nothing, so one retry is one event.
      events.publish({
        type: "message.created",
        conversationId: conversation.id,
        seq: message.seq,
        message,
      });

      return { ok: true, message, replayed: false };
    },
  };
}

export type CommandService = ReturnType<typeof createCommandService>;
