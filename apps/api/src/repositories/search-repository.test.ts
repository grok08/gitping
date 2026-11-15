import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { createBranchRepository } from "./branch-repository";
import { createMessageRepository } from "./message-repository";
import { createSearchRepository } from "./search-repository";
import type { SearchRepository } from "./search-repository";
import type { SearchCriteria } from "../search/query";
import { createTestDatabase } from "../test-helpers";

const early = "2026-10-01T09:00:00.000Z";
const later = "2026-10-05T09:00:00.000Z";

type SeedInput = {
  id: string;
  text: string;
  authorId?: string;
  verb?: string;
  conversationId?: string;
  branchId?: string;
  createdAt?: string;
  reverted?: boolean;
  stashed?: boolean;
};

function seed(db: Database, input: SeedInput): void {
  const messages = createMessageRepository(db);
  const conversationId = input.conversationId ?? "conv-engineering";

  messages.insert({
    id: input.id,
    conversationId,
    branchId: input.branchId ?? `branch-${conversationId}-main`,
    authorId: input.authorId ?? "user-grok08",
    text: input.text,
    verb: input.verb ?? "commit",
    raw: `git ${input.verb ?? "commit"} -m "${input.text}"`,
    args: JSON.stringify({ type: "commit", message: input.text }),
    createdAt: input.createdAt ?? early,
  });

  if (input.reverted) {
    messages.addEvent({
      messageId: input.id,
      type: "reverted",
      payload: null,
      createdAt: input.createdAt ?? early,
    });
  }

  if (input.stashed) {
    messages.addEvent({
      messageId: input.id,
      type: "stashed",
      payload: { note: null },
      createdAt: input.createdAt ?? early,
    });
  }
}

function criteria(overrides: Partial<SearchCriteria> = {}): SearchCriteria {
  return {
    terms: [],
    conversationId: null,
    author: null,
    command: null,
    branch: null,
    after: null,
    before: null,
    ...overrides,
  };
}

function setUp(): { db: Database; search: SearchRepository } {
  const db = createTestDatabase();

  return { db, search: createSearchRepository(db) };
}

describe("message search", () => {
  test("matches a substring in any case", () => {
    const { db, search } = setUp();

    seed(db, { id: "message-login", text: "Fix the Login redirect" });

    const page = search.messages(criteria({ terms: ["login"] }), 10);

    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]?.id).toBe("message-login");
  });

  test("requires every term", () => {
    const { db, search } = setUp();

    seed(db, { id: "message-login", text: "Fix the Login redirect" });

    expect(
      search.messages(criteria({ terms: ["login", "redirect"] }), 10).rows,
    ).toHaveLength(1);
    expect(
      search.messages(criteria({ terms: ["login", "billing"] }), 10).rows,
    ).toHaveLength(0);
  });

  test("returns the newest message first", () => {
    const { db, search } = setUp();

    seed(db, { id: "message-old", text: "deploy notes", createdAt: early });
    seed(db, { id: "message-new", text: "deploy notes", createdAt: later });

    const page = search.messages(criteria({ terms: ["deploy"] }), 10);

    expect(page.rows.map((row) => row.id)).toEqual([
      "message-new",
      "message-old",
    ]);
  });

  test("narrows by author, command, branch, and dates", () => {
    const { db, search } = setUp();

    seed(db, {
      id: "message-rahul",
      text: "deploy rahul",
      authorId: "user-rahul",
      createdAt: later,
    });
    seed(db, {
      id: "message-grok",
      text: "deploy grok",
      verb: "revert",
      createdAt: early,
    });
    seed(db, {
      id: "message-weekend",
      text: "deploy weekend",
      branchId: "branch-conv-engineering-weekend",
      createdAt: later,
    });

    const ids = (overrides: Partial<SearchCriteria>) =>
      search
        .messages(criteria({ terms: ["deploy"], ...overrides }), 10)
        .rows.map((row) => row.id)
        .sort();

    expect(ids({ author: "rahul" })).toEqual(["message-rahul"]);
    expect(ids({ command: "revert" })).toEqual(["message-grok"]);
    expect(ids({ branch: "weekend" })).toEqual(["message-weekend"]);
    expect(ids({ after: "2026-10-03T00:00:00.000Z" })).toEqual([
      "message-rahul",
      "message-weekend",
    ]);
    expect(ids({ before: "2026-10-03T00:00:00.000Z" })).toEqual([
      "message-grok",
    ]);
  });

  test("scopes to one conversation", () => {
    const { db, search } = setUp();

    seed(db, { id: "message-here", text: "deploy here" });
    seed(db, {
      id: "message-there",
      text: "deploy there",
      conversationId: "conv-weekend",
      branchId: "branch-conv-weekend-main",
    });

    const page = search.messages(
      criteria({ terms: ["deploy"], conversationId: "conv-engineering" }),
      10,
    );

    expect(page.rows.map((row) => row.id)).toEqual(["message-here"]);
  });

  test("caps the rows and reports the full total", () => {
    const { db, search } = setUp();

    seed(db, { id: "message-one", text: "deploy one", createdAt: early });
    seed(db, { id: "message-two", text: "deploy two", createdAt: later });

    const page = search.messages(criteria({ terms: ["deploy"] }), 1);

    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]?.id).toBe("message-two");
    expect(page.total).toBe(2);
  });

  test("carries the derived state and the branch", () => {
    const { db, search } = setUp();

    seed(db, {
      id: "message-state",
      text: "deploy state",
      branchId: "branch-conv-engineering-feature-ui",
      reverted: true,
      stashed: true,
    });

    const hit = search.messages(criteria({ terms: ["deploy"] }), 10).rows[0];

    expect(hit).toMatchObject({
      id: "message-state",
      author: "grok08",
      command: "git commit",
      reverted: true,
      stashed: true,
      branch: { name: "feature-ui" },
      conversation: { id: "conv-engineering", kind: "channel" },
    });
  });
});

describe("conversation, people, and branch search", () => {
  test("finds a conversation by name and by its newest message", () => {
    const { db, search } = setUp();

    seed(db, { id: "message-preview", text: "release the kraken" });

    const byName = search.conversations(["eng"], 10);
    const byPreview = search.conversations(["kraken"], 10);

    expect(byName.rows.map((row) => row.id)).toContain("conv-engineering");
    expect(byPreview.rows).toEqual([
      {
        id: "conv-engineering",
        name: "engineering",
        kind: "channel",
        memberCount: 4,
        preview: "release the kraken",
      },
    ]);
  });

  test("ranks a name that starts with the term first", () => {
    const { db, search } = setUp();

    seed(db, {
      id: "message-preview",
      text: "general",
      conversationId: "conv-random",
      branchId: "branch-conv-random-main",
    });

    // "general" is a conversation name, and "random" mentions it in a preview.
    const page = search.conversations(["general"], 10);

    expect(page.rows.map((row) => row.id)).toEqual([
      "conv-general",
      "conv-random",
    ]);
  });

  test("finds people by handle and by display name", () => {
    const { search } = setUp();

    expect(search.people(["rah"], 10).rows.map((row) => row.handle)).toEqual([
      "rahul",
    ]);
    expect(search.people(["MAR"], 10).rows.map((row) => row.handle)).toEqual([
      "maria",
    ]);
  });

  test("marks the viewer's current branch", () => {
    const { db, search } = setUp();

    createBranchRepository(db).setCurrent(
      "conv-engineering",
      "user-grok08",
      "branch-conv-engineering-weekend",
    );

    const page = search.branches(["weekend"], "user-grok08", 10);

    expect(page.rows).toEqual([
      {
        id: "branch-conv-engineering-weekend",
        name: "weekend",
        conversationId: "conv-engineering",
        conversationName: "engineering",
        conversationKind: "channel",
        current: true,
      },
    ]);
  });
});
