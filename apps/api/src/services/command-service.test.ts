import { describe, expect, test } from "bun:test";
import { initializeSchema, openDatabase } from "../db";
import { createMessageRepository } from "../repositories/message-repository";
import { createCommandService } from "./command-service";

function createHarness() {
  const db = openDatabase(":memory:");

  initializeSchema(db);

  const messages = createMessageRepository(db);

  return {
    db,
    messages,
    service: createCommandService(messages),
  };
}

describe("command service", () => {
  test("stores a commit message and returns it for rendering", () => {
    const { messages, service } = createHarness();

    const result = service.send('git commit -m "hello from gitping"', "grok08");

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
  });

  test("rejects a Git command that is not a message", () => {
    const { messages, service } = createHarness();

    const result = service.send("git log", "grok08");

    expect(result.ok).toBe(false);
    expect(messages.list()).toHaveLength(0);
  });

  test("rejects input that is not a supported Git command", () => {
    const { service } = createHarness();

    expect(service.send("hello there", "grok08").ok).toBe(false);
    expect(service.send("git commit", "grok08").ok).toBe(false);
  });

  test("lists messages in the order they were committed", () => {
    const { messages, service } = createHarness();

    service.send('git commit -m "first"', "grok08");
    service.send('git commit -m "second"', "rahul");

    expect(messages.list().map((message) => message.text)).toEqual([
      "first",
      "second",
    ]);
  });
});
