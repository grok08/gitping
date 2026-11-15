import { describe, expect, test } from "bun:test";
import { commandRequestId } from "../../src/lib/commands";

describe("command request ids", () => {
  test("reuses the previous id when the text is a retry of the same intent", () => {
    const previous = commandRequestId(null, 'git commit -m "retry me"');

    expect(commandRequestId(previous, 'git commit -m "retry me"')).toBe(previous);
  });

  test("generates a new id when the text changes", () => {
    const previous = commandRequestId(null, 'git commit -m "first"');
    const next = commandRequestId(previous, 'git commit -m "second"');

    expect(next).not.toBe(previous);
    expect(next.id).not.toBe(previous.id);
    expect(next.text).toBe('git commit -m "second"');
  });

  test("generates a fresh id for a first send", () => {
    const first = commandRequestId(null, "git commit -m \"hello\"");
    const second = commandRequestId(null, "git commit -m \"hello\"");

    expect(first.id).not.toBe(second.id);
    expect(first.id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  test("keeps the id stable across repeated retries of one text", () => {
    const first = commandRequestId(null, 'git commit -m "retry me"');
    const retried = commandRequestId(first, 'git commit -m "retry me"');
    const retriedAgain = commandRequestId(retried, 'git commit -m "retry me"');

    expect(retriedAgain.id).toBe(first.id);
  });
});
