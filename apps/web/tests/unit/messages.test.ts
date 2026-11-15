import { describe, expect, test } from "bun:test";
import {
  fromApiMessage,
  fromConfirmedMessage,
  mergeMessages,
} from "../../src/lib/messages";
import type { CreatedMessage, Message } from "../../src/types/message";

function confirmed(seq: number, text = `note ${seq}`): CreatedMessage {
  return {
    seq,
    id: `message-${seq}`,
    author: "rahul",
    text,
    command: "git commit",
    createdAt: "2026-10-01T09:00:00.000Z",
  };
}

function toMessages(...seqs: number[]): Message[] {
  return seqs.map((seq) => fromConfirmedMessage(confirmed(seq)));
}

describe("message merging", () => {
  test("keeps confirmed messages ordered by seq", () => {
    const messages = mergeMessages(toMessages(1, 3), toMessages(2));

    expect(messages.map((message) => message.seq)).toEqual([1, 2, 3]);
  });

  test("places an out-of-order event where its seq belongs", () => {
    const existing = toMessages(1, 2, 4);
    const late = toMessages(3);

    expect(mergeMessages(existing, late).map((message) => message.seq)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  test("ignores a repeated event for a message already on screen", () => {
    const existing = toMessages(1, 2);
    const duplicate = toMessages(2);

    const merged = mergeMessages(existing, duplicate);

    expect(merged).toHaveLength(2);
    expect(merged.filter((message) => message.id === "message-2")).toHaveLength(
      1,
    );
  });

  test("collapses a broadcast that repeats the sender's own HTTP response", () => {
    const fromHttp = fromConfirmedMessage(confirmed(1, "hello"));
    const fromSocket = fromConfirmedMessage(confirmed(1, "hello"));

    expect(mergeMessages([fromHttp], [fromSocket])).toHaveLength(1);
  });

  test("does not reorder or copy when there is nothing new", () => {
    const existing = toMessages(1, 2);

    expect(mergeMessages(existing, [])).toBe(existing);
  });

  test("preserves server ids when building a render message", () => {
    const message = fromApiMessage({
      seq: 9,
      id: "0b0d4f6a-1e6a-4a36-9a0a-4a2f6f1f00aa",
      author: "grok08",
      text: "server id",
      command: "git commit",
      created_at: "2026-10-01T09:00:00.000Z",
    });

    expect(message.id).toBe("0b0d4f6a-1e6a-4a36-9a0a-4a2f6f1f00aa");
    expect(message.command).toBe('git commit -m "server id"');
    expect(message.mine).toBe(true);
  });
});
