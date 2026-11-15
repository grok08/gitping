import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { createMessageRepository } from "./message-repository";
import type { MessageRepository } from "./message-repository";
import { createTestDatabase } from "../test-helpers";

const createdAt = "2026-11-15T10:00:00.000Z";

function seed(
  messages: MessageRepository,
  id: string,
  conversationId = "conv-engineering",
): void {
  messages.insert({
    id,
    conversationId,
    branchId: `branch-${conversationId}-main`,
    authorId: "user-grok08",
    text: `note ${id}`,
    verb: "commit",
    raw: `git commit -m "note ${id}"`,
    args: JSON.stringify({ type: "commit", message: `note ${id}`, amend: false }),
    createdAt,
  });
}

function flags(db: Database, id: string) {
  const row = createMessageRepository(db).findById(id);

  return { reverted: row?.reverted, stashed: row?.stashed };
}

describe("message state derivation", () => {
  test("defaults to not reverted and not stashed", () => {
    const db = createTestDatabase();

    seed(createMessageRepository(db), "message-default");

    expect(flags(db, "message-default")).toEqual({
      reverted: false,
      stashed: false,
    });
  });

  test("derives reverted from a reverted event", () => {
    const db = createTestDatabase();
    const messages = createMessageRepository(db);

    seed(messages, "message-reverted");
    messages.addEvent({
      messageId: "message-reverted",
      type: "reverted",
      payload: { byMessageId: "revert-1" },
      createdAt,
    });

    expect(flags(db, "message-reverted")).toEqual({
      reverted: true,
      stashed: false,
    });
  });

  test("derives stashed from a stashed event and clears it on unstashed", () => {
    const db = createTestDatabase();
    const messages = createMessageRepository(db);

    seed(messages, "message-stashed");
    messages.addEvent({
      messageId: "message-stashed",
      type: "stashed",
      payload: { note: "later" },
      createdAt,
    });

    expect(flags(db, "message-stashed")).toEqual({
      reverted: false,
      stashed: true,
    });

    messages.addEvent({
      messageId: "message-stashed",
      type: "unstashed",
      payload: { byMessageId: "pop-1" },
      createdAt,
    });

    expect(flags(db, "message-stashed")).toEqual({
      reverted: false,
      stashed: false,
    });
  });

  test("does not depend on the order the events were written in", () => {
    const db = createTestDatabase();
    const messages = createMessageRepository(db);

    // One message gets `unstashed` first, the other gets it last. Both hold the
    // same event set, so both must report the same state.
    seed(messages, "message-unstash-first");
    messages.addEvent({
      messageId: "message-unstash-first",
      type: "unstashed",
      payload: { byMessageId: "pop-1" },
      createdAt,
    });
    messages.addEvent({
      messageId: "message-unstash-first",
      type: "stashed",
      payload: { note: null },
      createdAt,
    });

    seed(messages, "message-stash-first");
    messages.addEvent({
      messageId: "message-stash-first",
      type: "stashed",
      payload: { note: null },
      createdAt,
    });
    messages.addEvent({
      messageId: "message-stash-first",
      type: "unstashed",
      payload: { byMessageId: "pop-2" },
      createdAt,
    });

    expect(flags(db, "message-unstash-first")).toEqual({
      reverted: false,
      stashed: false,
    });
    expect(flags(db, "message-stash-first")).toEqual({
      reverted: false,
      stashed: false,
    });
  });

  test("records the created event for every inserted message", () => {
    const db = createTestDatabase();
    const messages = createMessageRepository(db);

    seed(messages, "message-created");

    expect(messages.hasEvent("message-created", "created")).toBe(true);
    expect(messages.hasEvent("message-created", "reverted")).toBe(false);
  });

  test("resolves a prefix inside one conversation only", () => {
    const db = createTestDatabase();
    const messages = createMessageRepository(db);

    seed(messages, "abcd1111-0000-0000-0000-000000000000");
    seed(messages, "abcd2222-0000-0000-0000-000000000000");
    seed(messages, "abcd3333-0000-0000-0000-000000000000", "conv-weekend");

    expect(
      messages
        .findByPrefix("conv-engineering", "abcd")
        .map((message) => message.id),
    ).toEqual([
      "abcd1111-0000-0000-0000-000000000000",
      "abcd2222-0000-0000-0000-000000000000",
    ]);
    expect(messages.findByPrefix("conv-weekend", "abcd")).toHaveLength(1);
    expect(messages.findByPrefix("conv-engineering", "ffff")).toEqual([]);
    expect(
      messages.findByPrefix("conv-engineering", "abcd1111")[0]?.id,
    ).toBe("abcd1111-0000-0000-0000-000000000000");
  });
});
