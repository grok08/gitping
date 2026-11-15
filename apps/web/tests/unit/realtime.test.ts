import { describe, expect, test } from "bun:test";
import { nextReconnectDelay, parseMessageEvent } from "../../src/lib/realtime";

const frame = JSON.stringify({
  type: "message.created",
  conversationId: "conv-engineering",
  seq: 4,
  message: {
    seq: 4,
    id: "message-4",
    author: "grok08",
    text: "live",
    command: "git commit",
    createdAt: "2026-10-01T09:00:00.000Z",
  },
});

describe("realtime frames", () => {
  test("parses a message.created event", () => {
    expect(parseMessageEvent(frame)).toEqual({
      seq: 4,
      id: "message-4",
      author: "grok08",
      text: "live",
      command: "git commit",
      createdAt: "2026-10-01T09:00:00.000Z",
    });
  });

  test("ignores control frames and malformed payloads", () => {
    const ignored = [
      "not json",
      "null",
      "[]",
      JSON.stringify({ type: "ready", conversationId: "conv-engineering" }),
      JSON.stringify({ type: "pong" }),
      JSON.stringify({ type: "error", error: "nope" }),
      JSON.stringify({ type: "message.created", message: { id: "x" } }),
      JSON.stringify({
        type: "message.created",
        message: { ...JSON.parse(frame).message, seq: "4" },
      }),
    ];

    for (const raw of ignored) {
      expect(parseMessageEvent(raw)).toBeNull();
    }
  });
});

describe("reconnect backoff", () => {
  test("grows exponentially and stops at ten seconds", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(nextReconnectDelay)).toEqual([
      500, 1000, 2000, 4000, 8000, 10000, 10000,
    ]);
  });

  test("never returns a negative or unbounded delay", () => {
    expect(nextReconnectDelay(-3)).toBe(500);
    expect(nextReconnectDelay(Number.NaN)).toBe(500);
    expect(nextReconnectDelay(1000)).toBe(10000);
  });
});
