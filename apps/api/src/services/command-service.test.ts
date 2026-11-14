import { describe, expect, test } from "bun:test";
import { createTestCommandService } from "../test-helpers";

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
    ).toEqual({ ok: false, error: "Unknown conversation: missing" });

    expect(
      commands.send('git commit -m "nowhere"', "grok08", {
        branch: "missing",
      }),
    ).toEqual({ ok: false, error: "Unknown branch: missing" });
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
