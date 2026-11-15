import { describe, expect, test } from "bun:test";
import {
  nextReconnectDelay,
  parseMessageEvent,
  pingFrame,
} from "../../src/lib/realtime";

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
    reverted: false,
    stashed: false,
  },
});

describe("realtime frames", () => {
  test("parses a message.created event with its conversation", () => {
    expect(parseMessageEvent(frame)).toEqual({
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
        reverted: false,
        stashed: false,
      },
    });
  });

  test("parses a message.updated event with its new state", () => {
    const updated = JSON.stringify({
      ...JSON.parse(frame),
      type: "message.updated",
      message: {
        ...JSON.parse(frame).message,
        reverted: true,
        stashed: false,
      },
    });

    expect(parseMessageEvent(updated)).toEqual({
      type: "message.updated",
      conversationId: "conv-engineering",
      seq: 4,
      message: {
        seq: 4,
        id: "message-4",
        author: "grok08",
        text: "live",
        command: "git commit",
        createdAt: "2026-10-01T09:00:00.000Z",
        reverted: true,
        stashed: false,
      },
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
        conversationId: "conv-engineering",
        message: { ...JSON.parse(frame).message, seq: "4" },
      }),
    ];

    for (const raw of ignored) {
      expect(parseMessageEvent(raw)).toBeNull();
    }
  });

  test("serializes the keepalive ping", () => {
    expect(pingFrame()).toBe('{"type":"ping"}');
  });
});

describe("reconnect backoff", () => {
  test("grows exponentially and stops near ten seconds", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((attempt) => nextReconnectDelay(attempt, () => 0.5))).toEqual([
      500, 1000, 2000, 4000, 8000, 10000, 10000,
    ]);
  });

  test("spreads each step instead of retrying in lockstep", () => {
    expect(nextReconnectDelay(0, () => 0)).toBe(400);
    expect(nextReconnectDelay(0, () => 1)).toBe(600);

    for (const random of [0, 0.25, 0.5, 0.75, 1]) {
      const delay = nextReconnectDelay(3, () => random);

      expect(delay).toBeGreaterThanOrEqual(3200);
      expect(delay).toBeLessThanOrEqual(4800);
    }
  });

  test("never returns a negative or unbounded delay", () => {
    expect(nextReconnectDelay(-3, () => 0.5)).toBe(500);
    expect(nextReconnectDelay(Number.NaN, () => 0.5)).toBe(500);
    expect(nextReconnectDelay(1000, () => 1)).toBe(12000);
  });
});
