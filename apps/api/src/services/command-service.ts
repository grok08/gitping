import { parseCommand } from "@gitping/command-engine";
import type { Database } from "bun:sqlite";
import type { BranchRepository } from "../repositories/branch-repository";
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
};

export type CommandFailureReason =
  | "invalid_command"
  | "unknown_conversation"
  | "unknown_branch";

export type SendCommandResult =
  | { ok: true; message: MessageRecord }
  | { ok: false; reason: CommandFailureReason; error: string };

export type CommandServiceDependencies = {
  db: Database;
  users: UserRepository;
  conversations: ConversationRepository;
  branches: BranchRepository;
  messages: MessageRepository;
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

function reject(
  reason: CommandFailureReason,
  error: string,
): SendCommandResult {
  return { ok: false, reason, error };
}

export function createCommandService({
  db,
  users,
  conversations,
  branches,
  messages,
  events,
}: CommandServiceDependencies) {
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

        return message;
      });

      const row = write();
      const message = toRecord(row);

      // The transaction has committed, so the row is durable before any client
      // is told about it. A rolled-back write never reaches this line.
      events.publish({
        type: "message.created",
        conversationId: conversation.id,
        seq: message.seq,
        message,
      });

      return { ok: true, message };
    },
  };
}

export type CommandService = ReturnType<typeof createCommandService>;
