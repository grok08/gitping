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
    reverted: row.reverted,
    stashed: row.stashed,
  };
}

type ContentWrite = {
  conversation: Conversation;
  branch: Branch;
  author: string;
  input: string;
  text: string;
  verb: string;
  args: unknown;
  requestId: string | undefined;
  /** Runs inside the same transaction, after the message and its command. */
  afterWrite?: (message: MessageRow) => void;
};

const defaultConversation = "engineering";
const defaultBranch = "main";
const minTargetLength = 4;
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

  /**
   * One transaction for every content command: the message, its Git command,
   * its `created` event, any state event the command adds, the branch head, and
   * the request id. A rolled-back command leaves none of those behind.
   */
  function persistContent(write: ContentWrite): SendCommandResult {
    const transaction = db.transaction((): MessageRow => {
      const user = users.ensure(write.author);

      const message = messages.insert({
        id: crypto.randomUUID(),
        conversationId: write.conversation.id,
        branchId: write.branch.id,
        authorId: user.id,
        text: write.text,
        verb: write.verb,
        raw: write.input,
        args: JSON.stringify(write.args),
        createdAt: new Date().toISOString(),
      });

      write.afterWrite?.(message);
      branches.setHead(write.branch.id, message.id);

      if (write.requestId) {
        requests.insert({
          id: write.requestId,
          conversationId: write.conversation.id,
          messageId: message.id,
          authorId: user.id,
          createdAt: message.created_at,
        });
      }

      return message;
    });

    let row: MessageRow;

    try {
      row = transaction();
    } catch (error) {
      // Two identical requests can both pass the replay lookup and then
      // serialise on the write. The loser's transaction is rolled back whole
      // (message, command, event, branch head), so the winner's message is the
      // one and only answer.
      const replay =
        write.requestId && isDuplicateRequestRow(error)
          ? findReplay(write.requestId, write.author, write.conversation.id)
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
      conversationId: write.conversation.id,
      seq: message.seq,
      message,
    });

    return { ok: true, kind: "message", message, replayed: false };
  }

  /**
   * Re-reads a message whose derived state just changed and pushes it to the
   * conversation. Called after the state transaction commits, once per
   * affected message.
   */
  function publishUpdate(conversationId: string, messageId: string): void {
    const updated = messages.findById(messageId);

    if (!updated) {
      return;
    }

    const message = toRecord(updated);

    events.publish({
      type: "message.updated",
      conversationId,
      seq: message.seq,
      message,
    });
  }

  function revert(
    conversation: Conversation,
    branch: Branch,
    author: string,
    input: string,
    target: string,
    requestId: string | undefined,
  ): SendCommandResult {
    const resolved = resolveTarget(conversation.id, target);

    if (!resolved.ok) {
      return reject("invalid_argument", resolved.error);
    }

    const reverted = resolved.message;

    if (messages.hasEvent(reverted.id, "reverted")) {
      return reject("conflict", `Message ${target} is already reverted`);
    }

    const result = persistContent({
      conversation,
      branch,
      author,
      input,
      text: `Revert "${reverted.text}"`,
      verb: "revert",
      args: { type: "revert", target },
      requestId,
      afterWrite(message) {
        messages.addEvent({
          messageId: reverted.id,
          type: "reverted",
          payload: { byMessageId: message.id },
          createdAt: message.created_at,
        });
      },
    });

    if (result.ok && result.kind === "message" && !result.replayed) {
      publishUpdate(conversation.id, reverted.id);
    }

    return result;
  }

  /**
   * A merge records intent and ancestry on the current branch. Only the two
   * heads are compared, because the schema has no ancestry graph to resolve a
   * real common ancestor; that limit is documented in the evidence.
   */
  function merge(
    conversation: Conversation,
    current: Branch,
    author: string,
    input: string,
    sourceName: string,
    requestId: string | undefined,
  ): SendCommandResult {
    const source = branches.find(conversation.id, sourceName);

    if (!source) {
      return reject("unknown_branch", `Unknown branch: ${sourceName}`);
    }

    if (source.id === current.id) {
      return reject("invalid_argument", "Cannot merge a branch into itself");
    }

    if (
      source.headMessageId === null ||
      source.headMessageId === current.headMessageId
    ) {
      return reject("invalid_argument", "Already up to date");
    }

    return persistContent({
      conversation,
      branch: current,
      author,
      input,
      text: `Merge branch '${source.name}' into ${current.name}`,
      verb: "merge",
      args: { type: "merge", branch: sourceName },
      requestId,
      afterWrite(message) {
        messages.addEvent({
          messageId: message.id,
          type: "merged",
          payload: {
            sourceBranchId: source.id,
            sourceBranchName: source.name,
            targetBranchId: current.id,
            sourceHeadMessageId: source.headMessageId,
            targetHeadMessageId: current.headMessageId,
          },
          createdAt: message.created_at,
        });
      },
    });
  }

  function stashesFor(
    conversationId: string,
    branch: Branch,
  ): StashRecord[] {
    return messages.listStashed(conversationId, branch.id);
  }

  function stashesResult(stashes: StashRecord[]): SendCommandResult {
    return { ok: true, kind: "stashes", stashes };
  }

  /**
   * A stash sets the newest message on the branch aside without deleting it or
   * creating a message of its own. Stash state belongs to the conversation, so
   * every member who lists the same branch sees the same stash.
   */
  function stashPush(
    conversation: Conversation,
    branch: Branch,
    note: string | undefined,
  ): SendCommandResult {
    const newest = messages.findNewestOnBranch(conversation.id, branch.id);

    if (!newest) {
      return reject("invalid_argument", `Nothing to stash on ${branch.name}`);
    }

    const setAside = db.transaction(() => {
      messages.addEvent({
        messageId: newest.id,
        type: "stashed",
        payload: { note: note ?? null },
        createdAt: new Date().toISOString(),
      });
    });

    setAside();
    publishUpdate(conversation.id, newest.id);

    return stashesResult(stashesFor(conversation.id, branch));
  }

  function stashPop(
    conversation: Conversation,
    branch: Branch,
    target: string | undefined,
  ): SendCommandResult {
    const stashed = stashesFor(conversation.id, branch);
    const stash = target ? findStash(stashed, target) : stashed[0];

    if (!stash) {
      const error = target
        ? `Unknown stash: ${target}`
        : `No stash to pop on ${branch.name}`;

      return reject("invalid_argument", error);
    }

    const restore = db.transaction(() => {
      messages.addEvent({
        messageId: stash.id,
        type: "unstashed",
        payload: { byMessageId: crypto.randomUUID() },
        createdAt: new Date().toISOString(),
      });
    });

    restore();
    publishUpdate(conversation.id, stash.id);

    return stashesResult(stashesFor(conversation.id, branch));
  }

  /**
   * A stash id is a message id, given in full or as a unique prefix, because
   * that is the id the message already shows.
   */
  function findStash(
    stashed: StashRecord[],
    target: string,
  ): StashRecord | null {
    const exact = stashed.find((stash) => stash.id === target);

    if (exact) {
      return exact;
    }

    const matches = stashed.filter((stash) => stash.id.startsWith(target));

    return matches.length === 1 ? (matches[0] ?? null) : null;
  }

  /**
   * A target is a full message id or a prefix of one. The prefix has to be at
   * least four characters so a short string cannot stand for a message by
   * accident, and it is resolved inside the conversation it was sent to.
   */
  function resolveTarget(
    conversationId: string,
    target: string,
  ): { ok: true; message: MessageRow } | { ok: false; error: string } {
    if (target.length < minTargetLength) {
      return { ok: false, error: `Unknown message: ${target}` };
    }

    const matches = messages.findByPrefix(conversationId, target);

    if (matches.length === 0) {
      return { ok: false, error: `Unknown message: ${target}` };
    }

    const [only] = matches;

    if (matches.length > 1 || !only) {
      return { ok: false, error: `Ambiguous message prefix: ${target}` };
    }

    return { ok: true, message: only };
  }

  /**
   * The branch a content command writes to, or the failure to answer with.
   */
  function contentBranch(
    conversation: Conversation,
    user: User | null,
    requestedName: string | undefined,
  ): { ok: true; branch: Branch } | { ok: false; result: SendCommandResult } {
    const lookup = branchFor(conversation.id, user, requestedName);

    if (!lookup.ok) {
      return { ok: false, result: reject("unknown_branch", lookup.error) };
    }

    if (!lookup.branch) {
      return {
        ok: false,
        result: reject("unknown_branch", `Unknown branch: ${defaultBranch}`),
      };
    }

    return { ok: true, branch: lookup.branch };
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
          const resolved = contentBranch(conversation, user, options.branch);

          if (!resolved.ok) {
            return resolved.result;
          }

          return persistContent({
            conversation,
            branch: resolved.branch,
            author,
            input,
            text: parsed.message,
            verb: "commit",
            args: parsed,
            requestId,
          });
        }

        case "revert": {
          const resolved = contentBranch(conversation, user, options.branch);

          if (!resolved.ok) {
            return resolved.result;
          }

          return revert(
            conversation,
            resolved.branch,
            author,
            input,
            parsed.target,
            requestId,
          );
        }

        case "merge": {
          const resolved = contentBranch(conversation, user, options.branch);

          if (!resolved.ok) {
            return resolved.result;
          }

          return merge(
            conversation,
            resolved.branch,
            author,
            input,
            parsed.branch,
            requestId,
          );
        }

        case "stash-push":
        case "stash-list":
        case "stash-pop": {
          const resolved = contentBranch(conversation, user, options.branch);

          if (!resolved.ok) {
            return resolved.result;
          }

          if (parsed.type === "stash-push") {
            return stashPush(conversation, resolved.branch, parsed.message);
          }

          if (parsed.type === "stash-list") {
            return stashesResult(stashesFor(conversation.id, resolved.branch));
          }

          return stashPop(conversation, resolved.branch, parsed.stash);
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
