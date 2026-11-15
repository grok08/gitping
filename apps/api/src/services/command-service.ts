import { parseCommand } from "@gitping/command-engine";
import type { Database } from "bun:sqlite";
import type { BranchRepository } from "../repositories/branch-repository";
import type { CommandRequestRepository } from "../repositories/command-request-repository";
import type { ConversationRepository } from "../repositories/conversation-repository";
import type { MessageRepository } from "../repositories/message-repository";
import type { UserRepository } from "../repositories/user-repository";
import type { RealtimePublisher } from "../realtime/events";
import type { Branch, Conversation, User } from "../types/domain";
import type {
  BranchSummary,
  MessageRecord,
  MessageRow,
  StashRecord,
} from "../types/http";

export type SendCommandOptions = {
  conversation?: string;
  conversationId?: string;
  branch?: string;
  requestId?: string;
};

export type CommandFailureReason =
  | "invalid_command"
  | "invalid_argument"
  | "unknown_conversation"
  | "unknown_branch"
  | "conflict"
  | "request_conflict";

/**
 * A command answers with exactly one of three bodies, or a failure. The union
 * is untagged on the wire: a client checks `message`, then `branches`, then
 * `stashes`.
 */
export type SendCommandResult =
  | { ok: true; kind: "message"; message: MessageRecord; replayed: boolean }
  | { ok: true; kind: "branches"; branches: BranchSummary[] }
  | { ok: true; kind: "stashes"; stashes: StashRecord[] }
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
const unsupportedCommand =
  "Unsupported command. Use git commit, git revert, git merge, git branch, git switch, or git stash.";

/**
 * Branch names follow Git's rule for a short, safe name. `HEAD` is refused
 * because it names a pointer, not a branch.
 */
const branchNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

function isBranchName(name: string): boolean {
  return name !== "HEAD" && branchNamePattern.test(name);
}

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
   * The branch a command acts on. An explicit branch from the request wins,
   * because that is the branch the caller's selector shows; otherwise the
   * member's persisted branch, which is what a reload restores. An explicit
   * branch that does not exist is an error rather than a silent fallback.
   */
  function branchFor(
    conversationId: string,
    user: User | null,
    requestedName: string | undefined,
  ): { ok: true; branch: Branch | null } | { ok: false; error: string } {
    if (requestedName) {
      const branch = branches.find(conversationId, requestedName);

      return branch
        ? { ok: true, branch }
        : { ok: false, error: `Unknown branch: ${requestedName}` };
    }

    return {
      ok: true,
      // A member row can be absent (an author who is not a member) or the
      // column can be NULL, so `main` is the last resort, exactly as Git treats
      // a repository's initial branch.
      branch:
        (user ? branches.currentFor(conversationId, user.id) : null) ??
        branches.find(conversationId, defaultBranch),
    };
  }

  function branchesResult(
    conversationId: string,
    currentBranchId: string | null,
  ): SendCommandResult {
    return {
      ok: true,
      kind: "branches",
      branches: branches.list(conversationId, currentBranchId),
    };
  }

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

    return {
      ok: true,
      kind: "message",
      message: toRecord(stored),
      replayed: true,
    };
  }

  function commit(
    conversation: Conversation,
    branch: Branch,
    author: string,
    input: string,
    parsed: { message: string },
    requestId: string | undefined,
  ): SendCommandResult {
    const write = db.transaction((): MessageRow => {
      const user = users.ensure(author);

      const message = messages.insert({
        id: crypto.randomUUID(),
        conversationId: conversation.id,
        branchId: branch.id,
        authorId: user.id,
        text: parsed.message,
        verb: "commit",
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
      // serialise on the write. The loser's transaction is rolled back whole
      // (message, command, event, branch head), so the winner's message is the
      // one and only answer.
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

    return { ok: true, kind: "message", message, replayed: false };
  }

  function listBranches(
    conversation: Conversation,
    user: User | null,
    requestedName: string | undefined,
  ): SendCommandResult {
    const lookup = branchFor(conversation.id, user, requestedName);

    if (!lookup.ok) {
      return reject("unknown_branch", lookup.error);
    }

    return branchesResult(conversation.id, lookup.branch?.id ?? null);
  }

  function createBranch(
    conversation: Conversation,
    user: User | null,
    name: string,
    requestedName: string | undefined,
  ): SendCommandResult {
    if (!isBranchName(name)) {
      return reject("invalid_argument", `Invalid branch name: ${name}`);
    }

    if (branches.find(conversation.id, name)) {
      return reject("conflict", `Branch already exists: ${name}`);
    }

    const lookup = branchFor(conversation.id, user, requestedName);

    if (!lookup.ok) {
      return reject("unknown_branch", lookup.error);
    }

    const current = lookup.branch;

    branches.create({
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      name,
      headMessageId: current?.headMessageId ?? null,
      createdFromBranchId: current?.id ?? null,
      createdAt: new Date().toISOString(),
    });

    return branchesResult(conversation.id, current?.id ?? null);
  }

  function switchBranch(
    conversation: Conversation,
    author: string,
    name: string,
    create: boolean,
  ): SendCommandResult {
    if (create) {
      return createAndSwitch(conversation, author, name);
    }

    const target = branches.find(conversation.id, name);

    if (!target) {
      return reject("unknown_branch", `Unknown branch: ${name}`);
    }

    const move = db.transaction(() => {
      const user = users.ensure(author);

      branches.setCurrent(conversation.id, user.id, target.id);
    });

    move();

    return branchesResult(conversation.id, target.id);
  }

  function createAndSwitch(
    conversation: Conversation,
    author: string,
    name: string,
  ): SendCommandResult {
    if (!isBranchName(name)) {
      return reject("invalid_argument", `Invalid branch name: ${name}`);
    }

    if (branches.find(conversation.id, name)) {
      return reject("conflict", `Branch already exists: ${name}`);
    }

    const move = db.transaction(() => {
      const user = users.ensure(author);
      const from = branches.currentFor(conversation.id, user.id);
      const branch: Branch = {
        id: crypto.randomUUID(),
        conversationId: conversation.id,
        name,
        headMessageId: from?.headMessageId ?? null,
        createdFromBranchId: from?.id ?? null,
        createdAt: new Date().toISOString(),
      };

      branches.create(branch);
      branches.setCurrent(conversation.id, user.id, branch.id);

      return branch;
    });

    return branchesResult(conversation.id, move().id);
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

      const user = users.findByHandle(author);

      switch (parsed.type) {
        case "commit": {
          const lookup = branchFor(conversation.id, user, options.branch);

          if (!lookup.ok) {
            return reject("unknown_branch", lookup.error);
          }

          if (!lookup.branch) {
            return reject("unknown_branch", `Unknown branch: ${defaultBranch}`);
          }

          return commit(
            conversation,
            lookup.branch,
            author,
            input,
            parsed,
            requestId,
          );
        }

        case "branch": {
          if (parsed.name === undefined) {
            return listBranches(conversation, user, options.branch);
          }

          return createBranch(
            conversation,
            user,
            parsed.name,
            options.branch,
          );
        }

        case "switch": {
          return switchBranch(conversation, author, parsed.name, parsed.create);
        }

        default: {
          return reject("invalid_command", unsupportedCommand);
        }
      }
    },
  };
}

export type CommandService = ReturnType<typeof createCommandService>;
