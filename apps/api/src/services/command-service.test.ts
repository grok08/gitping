import { describe, expect, test } from "bun:test";
import type { CommandRequestRepository } from "../repositories/command-request-repository";
import { createCommandRequestRepository } from "../repositories/command-request-repository";
import { createMessageRepository } from "../repositories/message-repository";
import { createTestCommandService, sentMessage } from "../test-helpers";
import type { CommandRequestRecord } from "../types/domain";

describe("command service", () => {
  test("stores a commit as a message with its git command and event", () => {
    const { db, messages, commands } = createTestCommandService();

    const result = commands.send('git commit -m "hello from gitping"', "grok08");

    expect(result).toMatchObject({
      ok: true,
      message: {
        author: "grok08",
        text: "hello from gitping",
        command: "git commit",
      },
    });

    const stored = messages.list();

    expect(stored).toHaveLength(1);
    expect(stored[0]?.text).toBe("hello from gitping");

    const command = db
      .query("SELECT verb, raw, args FROM git_commands")
      .get() as { verb: string; raw: string; args: string };

    expect(command.verb).toBe("commit");
    expect(command.raw).toBe('git commit -m "hello from gitping"');
    expect(JSON.parse(command.args)).toMatchObject({
      type: "commit",
      message: "hello from gitping",
    });

    const events = db
      .query("SELECT type FROM message_events")
      .all() as Array<{ type: string }>;

    expect(events).toEqual([{ type: "created" }]);
  });

  test("moves the branch head to the new message", () => {
    const { db, commands } = createTestCommandService();

    const message = sentMessage(
      commands.send('git commit -m "move the head"', "grok08"),
    );

    const branch = db
      .query(
        "SELECT head_message_id FROM branches WHERE id = 'branch-conv-engineering-main'",
      )
      .get() as { head_message_id: string };

    expect(branch.head_message_id).toBe(message.id);
  });

  test("attaches a message to the requested conversation and branch", () => {
    const { db, messages, commands } = createTestCommandService();

    const result = commands.send('git commit -m "weekend work"', "rahul", {
      conversation: "weekend",
      branch: "main",
    });

    expect(result.ok).toBe(true);
    expect(messages.list("conv-weekend")).toHaveLength(1);
    expect(messages.list("conv-engineering")).toHaveLength(0);

    const row = db
      .query("SELECT conversation_id, branch_id FROM messages")
      .get() as { conversation_id: string; branch_id: string };

    expect(row).toEqual({
      conversation_id: "conv-weekend",
      branch_id: "branch-conv-weekend-main",
    });
  });

  test("creates a user for a new author handle", () => {
    const { db, commands } = createTestCommandService();

    commands.send('git commit -m "new author"', "newcomer");

    const users = db
      .query("SELECT handle, role FROM users WHERE handle = 'newcomer'")
      .all() as Array<{ handle: string; role: string }>;

    expect(users).toEqual([{ handle: "newcomer", role: "developer" }]);
  });

  test("rejects a Git command that is not a message", () => {
    const { messages, commands } = createTestCommandService();

    const result = commands.send("git log", "grok08");

    expect(result).toEqual({
      ok: false,
      reason: "invalid_command",
      error:
        "Unsupported command. Use git commit, git revert, git merge, git branch, git switch, or git stash.",
    });
    expect(messages.list()).toHaveLength(0);
  });

  test("rejects input that is not a supported Git command", () => {
    const { commands } = createTestCommandService();

    expect(commands.send("hello there", "grok08").ok).toBe(false);
    expect(commands.send("git commit", "grok08").ok).toBe(false);
  });

  test("rejects an unknown conversation or branch", () => {
    const { commands } = createTestCommandService();

    expect(
      commands.send('git commit -m "nowhere"', "grok08", {
        conversation: "missing",
      }),
    ).toEqual({
      ok: false,
      reason: "unknown_conversation",
      error: "Unknown conversation: missing",
    });

    expect(
      commands.send('git commit -m "nowhere"', "grok08", {
        branch: "missing",
      }),
    ).toEqual({
      ok: false,
      reason: "unknown_branch",
      error: "Unknown branch: missing",
    });
  });

  test("resolves a conversation by id for the conversation-scoped route", () => {
    const { db, messages, commands } = createTestCommandService();

    const result = commands.send('git commit -m "by id"', "grok08", {
      conversationId: "conv-engineering",
      branch: "weekend",
    });

    expect(result.ok).toBe(true);
    expect(messages.list("conv-engineering")).toHaveLength(1);

    const row = db
      .query("SELECT branch_id FROM messages")
      .get() as { branch_id: string };

    expect(row.branch_id).toBe("branch-conv-engineering-weekend");
  });

  test("rejects an unknown conversation id before parsing the command", () => {
    const { messages, commands } = createTestCommandService();

    expect(
      commands.send("git log", "grok08", { conversationId: "conv-missing" }),
    ).toEqual({
      ok: false,
      reason: "unknown_conversation",
      error: "Unknown conversation: conv-missing",
    });
    expect(messages.list()).toHaveLength(0);
  });

  test("rejects an unknown branch for a known conversation id", () => {
    const { commands } = createTestCommandService();

    expect(
      commands.send('git commit -m "nowhere"', "grok08", {
        conversationId: "conv-engineering",
        branch: "release",
      }),
    ).toEqual({
      ok: false,
      reason: "unknown_branch",
      error: "Unknown branch: release",
    });
  });

  test("lists messages in commit order", () => {
    const { messages, commands } = createTestCommandService();

    commands.send('git commit -m "first"', "grok08");
    commands.send('git commit -m "second"', "rahul");

    expect(messages.list().map((message) => message.text)).toEqual([
      "first",
      "second",
    ]);
  });
});

describe("branch commands", () => {
  test("git branch lists branches with the member's current branch marked", () => {
    const { messages, commands } = createTestCommandService();

    const result = commands.send("git branch", "grok08", {
      conversationId: "conv-engineering",
    });

    expect(result).toEqual({
      ok: true,
      kind: "branches",
      branches: [
        {
          id: "branch-conv-engineering-main",
          name: "main",
          headMessageId: null,
          current: true,
        },
        {
          id: "branch-conv-engineering-weekend",
          name: "weekend",
          headMessageId: null,
          current: false,
        },
        {
          id: "branch-conv-engineering-feature-ui",
          name: "feature-ui",
          headMessageId: null,
          current: false,
        },
      ],
    });
    expect(messages.list()).toHaveLength(0);
  });

  test("git branch <name> creates from the current head without moving it", () => {
    const { db, messages, commands } = createTestCommandService();
    const commit = sentMessage(
      commands.send('git commit -m "base work"', "grok08", {
        conversationId: "conv-engineering",
      }),
    );

    const result = commands.send("git branch release", "grok08", {
      conversationId: "conv-engineering",
    });

    if (!result.ok || result.kind !== "branches") {
      throw new Error("expected a branch list");
    }

    const created = result.branches.find((branch) => branch.name === "release");

    expect(created).toMatchObject({
      headMessageId: commit.id,
      current: false,
    });
    expect(result.branches.find((branch) => branch.name === "main")).toMatchObject(
      { current: true, headMessageId: commit.id },
    );
    expect(messages.list("conv-engineering")).toHaveLength(1);

    const row = db
      .query(
        "SELECT created_from_branch_id FROM branches WHERE name = 'release'",
      )
      .get() as { created_from_branch_id: string };

    expect(row.created_from_branch_id).toBe("branch-conv-engineering-main");
  });

  test("git branch rejects a duplicate name and an invalid name", () => {
    const { commands } = createTestCommandService();

    expect(
      commands.send("git branch weekend", "grok08", {
        conversationId: "conv-engineering",
      }),
    ).toEqual({
      ok: false,
      reason: "conflict",
      error: "Branch already exists: weekend",
    });

    for (const name of ["HEAD", "a".repeat(41)]) {
      expect(
        commands.send(`git branch ${name}`, "grok08", {
          conversationId: "conv-engineering",
        }),
      ).toEqual({
        ok: false,
        reason: "invalid_argument",
        error: `Invalid branch name: ${name}`,
      });
    }

    for (const name of ["-bad", "has space"]) {
      expect(
        commands.send(`git switch -c "${name}"`, "grok08", {
          conversationId: "conv-engineering",
        }),
      ).toEqual({
        ok: false,
        reason: "invalid_argument",
        error: `Invalid branch name: ${name}`,
      });
    }
  });

  test("git switch persists the member's current branch", () => {
    const { db, commands } = createTestCommandService();

    const result = commands.send("git switch weekend", "grok08", {
      conversationId: "conv-engineering",
    });

    if (!result.ok || result.kind !== "branches") {
      throw new Error("expected a branch list");
    }

    expect(result.branches.find((branch) => branch.current)).toMatchObject({
      name: "weekend",
    });

    const member = db
      .query(
        `SELECT current_branch_id FROM conversation_members
         WHERE conversation_id = 'conv-engineering' AND user_id = 'user-grok08'`,
      )
      .get() as { current_branch_id: string };

    expect(member.current_branch_id).toBe("branch-conv-engineering-weekend");
  });

  test("git switch rejects an unknown branch", () => {
    const { commands } = createTestCommandService();

    expect(
      commands.send("git switch release", "grok08", {
        conversationId: "conv-engineering",
      }),
    ).toEqual({
      ok: false,
      reason: "unknown_branch",
      error: "Unknown branch: release",
    });
  });

  test("git switch -c creates the branch at the current head and switches to it", () => {
    const { db, messages, commands } = createTestCommandService();
    const commit = sentMessage(
      commands.send('git commit -m "before the branch"', "grok08", {
        conversationId: "conv-engineering",
      }),
    );

    const result = commands.send("git switch -c release", "grok08", {
      conversationId: "conv-engineering",
    });

    if (!result.ok || result.kind !== "branches") {
      throw new Error("expected a branch list");
    }

    const created = result.branches.find((branch) => branch.name === "release");

    expect(created).toMatchObject({ current: true, headMessageId: commit.id });
    expect(result.branches.find((branch) => branch.name === "main")).toMatchObject(
      { current: false },
    );
    expect(messages.list("conv-engineering")).toHaveLength(1);

    const member = db
      .query(
        `SELECT current_branch_id FROM conversation_members
         WHERE conversation_id = 'conv-engineering' AND user_id = 'user-grok08'`,
      )
      .get() as { current_branch_id: string };

    if (!created) {
      throw new Error("expected the new branch in the list");
    }

    expect(member.current_branch_id).toBe(created.id);
  });

  test("a persisted branch carries the next commit when the request names none", () => {
    const { db, commands } = createTestCommandService();

    commands.send("git switch weekend", "grok08", {
      conversationId: "conv-engineering",
    });
    const commit = sentMessage(
      commands.send('git commit -m "weekend only"', "grok08", {
        conversationId: "conv-engineering",
      }),
    );
    const row = db
      .query("SELECT branch_id FROM messages WHERE id = $id")
      .get({ $id: commit.id }) as { branch_id: string };

    expect(row.branch_id).toBe("branch-conv-engineering-weekend");
  });

  test("switching in one conversation leaves another member's view alone", () => {
    const { db, commands } = createTestCommandService();

    commands.send("git switch weekend", "grok08", {
      conversationId: "conv-engineering",
    });

    const rahul = db
      .query(
        `SELECT current_branch_id FROM conversation_members
         WHERE conversation_id = 'conv-engineering' AND user_id = 'user-rahul'`,
      )
      .get() as { current_branch_id: string | null };

    expect(rahul.current_branch_id).toBeNull();

    const listed = commands.send("git branch", "rahul", {
      conversationId: "conv-engineering",
    });

    if (!listed.ok || listed.kind !== "branches") {
      throw new Error("expected a branch list");
    }

    expect(listed.branches.find((branch) => branch.current)?.name).toBe("main");
  });
});

describe("idempotent commands", () => {
  test("returns the stored message for a repeated request id without writing or publishing again", () => {
    const { db, messages, events, commands } = createTestCommandService();

    const first = commands.send('git commit -m "retry me"', "grok08", {
      requestId: "request-retry-1",
    });
    const second = commands.send('git commit -m "retry me"', "grok08", {
      requestId: "request-retry-1",
    });

    if (
      !first.ok ||
      first.kind !== "message" ||
      !second.ok ||
      second.kind !== "message"
    ) {
      throw new Error("expected both attempts to succeed");
    }

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.message).toEqual(first.message);
    expect(messages.list()).toHaveLength(1);
    expect(events.events).toHaveLength(1);

    const commandRows = db
      .query("SELECT id FROM git_commands")
      .all() as Array<{ id: string }>;
    const eventRows = db
      .query("SELECT id FROM message_events")
      .all() as Array<{ id: string }>;
    const requestRows = db
      .query("SELECT id, message_id FROM command_requests")
      .all() as Array<{ id: string; message_id: string }>;

    expect(commandRows).toHaveLength(1);
    expect(eventRows).toHaveLength(1);
    expect(requestRows).toEqual([
      { id: "request-retry-1", message_id: first.message.id },
    ]);
  });

  test("rejects a request id that already named a command in another conversation", () => {
    const { messages, commands } = createTestCommandService();

    const first = commands.send('git commit -m "engineering note"', "grok08", {
      requestId: "request-cross-1",
    });

    expect(first.ok).toBe(true);

    expect(
      commands.send('git commit -m "weekend note"', "grok08", {
        conversation: "weekend",
        requestId: "request-cross-1",
      }),
    ).toEqual({
      ok: false,
      reason: "request_conflict",
      error: "Request id already used for another command",
    });
    expect(messages.list()).toHaveLength(1);
  });

  test("rejects a request id that already named a command for another author", () => {
    const { messages, commands } = createTestCommandService();

    const first = commands.send('git commit -m "signed note"', "grok08", {
      requestId: "request-author-1",
    });

    expect(first.ok).toBe(true);

    expect(
      commands.send('git commit -m "signed note"', "rahul", {
        requestId: "request-author-1",
      }),
    ).toEqual({
      ok: false,
      reason: "request_conflict",
      error: "Request id already used for another command",
    });
    expect(messages.list()).toHaveLength(1);
  });

  test("creates a second message for a different request id", () => {
    const { messages, commands } = createTestCommandService();

    const firstMessage = sentMessage(
      commands.send('git commit -m "same words"', "grok08", {
        requestId: "request-distinct-1",
      }),
    );
    const second = commands.send('git commit -m "same words"', "grok08", {
      requestId: "request-distinct-2",
    });

    expect(second.ok && second.kind === "message" && second.replayed).toBe(false);
    expect(sentMessage(second).id).not.toBe(firstMessage.id);
    expect(messages.list()).toHaveLength(2);
  });

  test("keeps one commit per request when no request id is sent", () => {
    const { messages, commands } = createTestCommandService();

    const first = sentMessage(commands.send('git commit -m "ping"', "grok08"));
    const second = commands.send('git commit -m "ping"', "grok08");

    expect(second.ok && second.kind === "message" && second.replayed).toBe(false);
    expect(sentMessage(second).id).not.toBe(first.id);
    expect(messages.list()).toHaveLength(2);
  });

  test("replays the winner when a concurrent duplicate loses the request-row insert", () => {
    const { db, messages, commands } = createTestCommandService();

    const winner = commands.send('git commit -m "race"', "grok08", {
      requestId: "request-race-1",
    });

    const winnerMessage = sentMessage(winner);

    // Two identical requests can both pass the replay lookup. This wrapper
    // hides the winner's row from exactly one lookup, so the second attempt
    // reaches the write and hits the `command_requests` primary key.
    const stored = createCommandRequestRepository(db);
    let hideOnce = true;

    const racing: CommandRequestRepository = {
      find(id: string): CommandRequestRecord | null {
        if (hideOnce) {
          hideOnce = false;

          return null;
        }

        return stored.find(id);
      },

      insert(request: CommandRequestRecord): void {
        stored.insert(request);
      },
    };

    const loser = createTestCommandService(db, { requests: racing });
    const replay = loser.commands.send('git commit -m "race"', "grok08", {
      requestId: "request-race-1",
    });

    if (!replay.ok || replay.kind !== "message") {
      throw new Error("expected the duplicate to replay, not fail");
    }

    expect(replay.replayed).toBe(true);
    expect(replay.message.id).toBe(winnerMessage.id);
    expect(messages.list()).toHaveLength(1);
    expect(loser.events.events).toHaveLength(0);

    // The rollback covers the whole write: the branch head still points at the
    // winner's message, not at the duplicate the loser tried to insert.
    const branch = db
      .query(
        "SELECT head_message_id FROM branches WHERE id = 'branch-conv-engineering-main'",
      )
      .get() as { head_message_id: string };

    expect(branch.head_message_id).toBe(winnerMessage.id);
  });
});

describe("revert", () => {
  test("creates a revert message on the current branch and flags the target", () => {
    const { db, messages, events, commands } = createTestCommandService();
    const target = sentMessage(
      commands.send('git commit -m "ship the bug"', "rahul", {
        conversationId: "conv-engineering",
      }),
    );

    const result = commands.send(
      `git revert ${target.id.slice(0, 8)}`,
      "grok08",
      { conversationId: "conv-engineering" },
    );

    const revert = sentMessage(result);

    expect(revert).toMatchObject({
      author: "grok08",
      text: 'Revert "ship the bug"',
      command: "git revert",
      reverted: false,
    });

    const stored = messages.findById(target.id);

    expect(stored?.reverted).toBe(true);
    expect(stored?.stashed).toBe(false);

    const payload = db
      .query(
        `SELECT payload FROM message_events
         WHERE message_id = $id AND type = 'reverted'`,
      )
      .get({ $id: target.id }) as { payload: string };

    expect(JSON.parse(payload.payload)).toEqual({ byMessageId: revert.id });

    const head = db
      .query(
        "SELECT head_message_id FROM branches WHERE id = 'branch-conv-engineering-main'",
      )
      .get() as { head_message_id: string };

    expect(head.head_message_id).toBe(revert.id);

    // The revert message is announced as a new row, and the target is pushed
    // again with its new state, both after the transaction committed.
    expect(events.events.map((event) => event.type)).toEqual([
      "message.created",
      "message.created",
      "message.updated",
    ]);
    expect(events.events[2]).toMatchObject({
      conversationId: "conv-engineering",
      seq: target.seq,
      message: { id: target.id, reverted: true, stashed: false },
    });
  });

  test("resolves a full id and a unique prefix of at least four characters", () => {
    const { commands } = createTestCommandService();
    const target = sentMessage(
      commands.send('git commit -m "prefix me"', "rahul"),
    );

    expect(
      commands.send(`git revert ${target.id}`, "grok08", {
        conversationId: "conv-engineering",
      }).ok,
    ).toBe(true);

    const second = sentMessage(
      commands.send('git commit -m "short prefix"', "rahul"),
    );

    expect(
      commands.send(`git revert ${second.id.slice(0, 4)}`, "grok08", {
        conversationId: "conv-engineering",
      }).ok,
    ).toBe(true);
  });

  test("rejects an unknown target, a short target, and an ambiguous prefix", () => {
    const { db, commands } = createTestCommandService();
    const messages = createMessageRepository(db);
    const insert = (id: string) =>
      messages.insert({
        id,
        conversationId: "conv-engineering",
        branchId: "branch-conv-engineering-main",
        authorId: "user-grok08",
        text: `note ${id}`,
        verb: "commit",
        raw: `git commit -m "note ${id}"`,
        args: JSON.stringify({ type: "commit", message: id, amend: false }),
        createdAt: new Date().toISOString(),
      });

    insert("abcd1111-0000-0000-0000-000000000000");
    insert("abcd2222-0000-0000-0000-000000000000");

    expect(
      commands.send("git revert ffff", "grok08", {
        conversationId: "conv-engineering",
      }),
    ).toEqual({
      ok: false,
      reason: "invalid_argument",
      error: "Unknown message: ffff",
    });

    expect(
      commands.send("git revert abc", "grok08", {
        conversationId: "conv-engineering",
      }),
    ).toEqual({
      ok: false,
      reason: "invalid_argument",
      error: "Unknown message: abc",
    });

    expect(
      commands.send("git revert abcd", "grok08", {
        conversationId: "conv-engineering",
      }),
    ).toEqual({
      ok: false,
      reason: "invalid_argument",
      error: "Ambiguous message prefix: abcd",
    });
  });

  test("rejects a second revert of the same message with a conflict", () => {
    const { db, commands } = createTestCommandService();
    const target = sentMessage(
      commands.send('git commit -m "revert once"', "rahul"),
    );
    const prefix = target.id.slice(0, 8);

    commands.send(`git revert ${prefix}`, "grok08", {
      conversationId: "conv-engineering",
    });

    expect(
      commands.send(`git revert ${prefix}`, "grok08", {
        conversationId: "conv-engineering",
      }),
    ).toEqual({
      ok: false,
      reason: "conflict",
      error: `Message ${prefix} is already reverted`,
    });

    const rows = db
      .query(
        `SELECT COUNT(*) AS total FROM message_events WHERE type = 'reverted'`,
      )
      .get() as { total: number };

    expect(rows.total).toBe(1);
  });

  test("allows reverting a revert, as Git does", () => {
    const { db, messages, commands } = createTestCommandService();
    const target = sentMessage(
      commands.send('git commit -m "original"', "rahul"),
    );

    const first = sentMessage(
      commands.send(`git revert ${target.id.slice(0, 8)}`, "grok08", {
        conversationId: "conv-engineering",
      }),
    );

    const second = sentMessage(
      commands.send(`git revert ${first.id.slice(0, 8)}`, "grok08", {
        conversationId: "conv-engineering",
      }),
    );

    expect(second.text).toBe('Revert "Revert "original""');
    expect(messages.findById(first.id)?.reverted).toBe(true);
    expect(messages.findById(target.id)?.reverted).toBe(true);

    const count = db
      .query(
        `SELECT COUNT(*) AS total FROM message_events WHERE type = 'reverted'`,
      )
      .get() as { total: number };

    expect(count.total).toBe(2);
  });

  test("leaves the history in place, with the reverted row readable", () => {
    const { messages, commands } = createTestCommandService();
    const target = sentMessage(
      commands.send('git commit -m "stays in history"', "rahul"),
    );

    commands.send(`git revert ${target.id.slice(0, 8)}`, "grok08", {
      conversationId: "conv-engineering",
    });

    const listed = messages.list("conv-engineering");

    expect(listed.map((message) => message.text)).toEqual([
      "stays in history",
      'Revert "stays in history"',
    ]);
    expect(listed[0]?.reverted).toBe(true);
  });
});

describe("merge", () => {
  test("creates a merge message on the current branch with both heads recorded", () => {
    const { db, messages, commands } = createTestCommandService();
    const target = sentMessage(
      commands.send('git commit -m "main work"', "grok08", {
        conversationId: "conv-engineering",
      }),
    );
    const source = sentMessage(
      commands.send('git commit -m "weekend work"', "rahul", {
        conversationId: "conv-engineering",
        branch: "weekend",
      }),
    );

    const result = commands.send("git merge weekend", "grok08", {
      conversationId: "conv-engineering",
      branch: "main",
    });

    const mergeMessage = sentMessage(result);

    expect(mergeMessage).toMatchObject({
      text: "Merge branch 'weekend' into main",
      command: "git merge",
      reverted: false,
      stashed: false,
    });

    const event = db
      .query(
        `SELECT payload FROM message_events
         WHERE message_id = $id AND type = 'merged'`,
      )
      .get({ $id: mergeMessage.id }) as { payload: string };

    expect(JSON.parse(event.payload)).toEqual({
      sourceBranchId: "branch-conv-engineering-weekend",
      sourceBranchName: "weekend",
      targetBranchId: "branch-conv-engineering-main",
      sourceHeadMessageId: source.id,
      targetHeadMessageId: target.id,
    });

    const head = db
      .query(
        "SELECT head_message_id FROM branches WHERE id = 'branch-conv-engineering-main'",
      )
      .get() as { head_message_id: string };

    expect(head.head_message_id).toBe(mergeMessage.id);
    expect(messages.list("conv-engineering")).toHaveLength(3);
  });

  test("does not copy the source branch's messages", () => {
    const { messages, commands } = createTestCommandService();

    commands.send('git commit -m "weekend only"', "rahul", {
      conversationId: "conv-engineering",
      branch: "weekend",
    });
    commands.send("git merge weekend", "grok08", {
      conversationId: "conv-engineering",
      branch: "main",
    });

    const listed = messages.list("conv-engineering");

    expect(listed.map((message) => message.text)).toEqual([
      "weekend only",
      "Merge branch 'weekend' into main",
    ]);
    expect(listed.map((message) => message.reverted)).toEqual([false, false]);
  });

  test("rejects an unknown branch and a merge into itself", () => {
    const { commands } = createTestCommandService();

    expect(
      commands.send("git merge release", "grok08", {
        conversationId: "conv-engineering",
      }),
    ).toEqual({
      ok: false,
      reason: "unknown_branch",
      error: "Unknown branch: release",
    });

    expect(
      commands.send("git merge main", "grok08", {
        conversationId: "conv-engineering",
      }),
    ).toEqual({
      ok: false,
      reason: "invalid_argument",
      error: "Cannot merge a branch into itself",
    });
  });

  test("reports already up to date when the source head is null or equal", () => {
    const { commands } = createTestCommandService();

    // Both heads are null on the seeded branches.
    expect(
      commands.send("git merge weekend", "grok08", {
        conversationId: "conv-engineering",
      }),
    ).toEqual({
      ok: false,
      reason: "invalid_argument",
      error: "Already up to date",
    });

    // A branch created at main's head has the same head, so there is nothing
    // to merge.
    sentMessage(
      commands.send('git commit -m "shared head"', "grok08", {
        conversationId: "conv-engineering",
        branch: "main",
      }),
    );
    commands.send("git branch shared-head", "grok08", {
      conversationId: "conv-engineering",
      branch: "main",
    });

    expect(
      commands.send("git merge shared-head", "grok08", {
        conversationId: "conv-engineering",
        branch: "main",
      }),
    ).toEqual({
      ok: false,
      reason: "invalid_argument",
      error: "Already up to date",
    });
  });
});
