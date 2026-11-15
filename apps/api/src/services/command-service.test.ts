import { describe, expect, test } from "bun:test";
import type { CommandRequestRepository } from "../repositories/command-request-repository";
import { createCommandRequestRepository } from "../repositories/command-request-repository";
import { createTestCommandService } from "../test-helpers";
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

    const result = commands.send('git commit -m "move the head"', "grok08");

    if (!result.ok) {
      throw new Error("expected the command to succeed");
    }

    const branch = db
      .query(
        "SELECT head_message_id FROM branches WHERE id = 'branch-conv-engineering-main'",
      )
      .get() as { head_message_id: string };

    expect(branch.head_message_id).toBe(result.message.id);
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
      error: 'For the first message flow, use: git commit -m "message"',
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

describe("idempotent commands", () => {
  test("returns the stored message for a repeated request id without writing or publishing again", () => {
    const { db, messages, events, commands } = createTestCommandService();

    const first = commands.send('git commit -m "retry me"', "grok08", {
      requestId: "request-retry-1",
    });
    const second = commands.send('git commit -m "retry me"', "grok08", {
      requestId: "request-retry-1",
    });

    if (!first.ok || !second.ok) {
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

    const first = commands.send('git commit -m "same words"', "grok08", {
      requestId: "request-distinct-1",
    });
    const second = commands.send('git commit -m "same words"', "grok08", {
      requestId: "request-distinct-2",
    });

    if (!first.ok || !second.ok) {
      throw new Error("expected both commands to succeed");
    }

    expect(second.replayed).toBe(false);
    expect(second.message.id).not.toBe(first.message.id);
    expect(messages.list()).toHaveLength(2);
  });

  test("keeps one commit per request when no request id is sent", () => {
    const { messages, commands } = createTestCommandService();

    const first = commands.send('git commit -m "ping"', "grok08");
    const second = commands.send('git commit -m "ping"', "grok08");

    if (!first.ok || !second.ok) {
      throw new Error("expected both commands to succeed");
    }

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(false);
    expect(second.message.id).not.toBe(first.message.id);
    expect(messages.list()).toHaveLength(2);
  });

  test("replays the winner when a concurrent duplicate loses the request-row insert", () => {
    const { db, messages, commands } = createTestCommandService();

    const winner = commands.send('git commit -m "race"', "grok08", {
      requestId: "request-race-1",
    });

    if (!winner.ok) {
      throw new Error("expected the first request to succeed");
    }

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

    if (!replay.ok) {
      throw new Error("expected the duplicate to replay, not fail");
    }

    expect(replay.replayed).toBe(true);
    expect(replay.message.id).toBe(winner.message.id);
    expect(messages.list()).toHaveLength(1);
    expect(loser.events.events).toHaveLength(0);

    // The rollback covers the whole write: the branch head still points at the
    // winner's message, not at the duplicate the loser tried to insert.
    const branch = db
      .query(
        "SELECT head_message_id FROM branches WHERE id = 'branch-conv-engineering-main'",
      )
      .get() as { head_message_id: string };

    expect(branch.head_message_id).toBe(winner.message.id);
  });
});
