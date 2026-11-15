import { describe, expect, test } from "bun:test";
import {
  clampActiveIndex,
  flattenResults,
  highlightSegments,
  moveActiveIndex,
} from "../../src/lib/search";
import type { WorkspaceSearchResults } from "../../src/types/search";

const results: WorkspaceSearchResults = {
  query: {
    text: "login",
    terms: ["login"],
    filters: {
      author: null,
      command: null,
      branch: null,
      after: null,
      before: null,
    },
  },
  groups: {
    conversations: [
      {
        id: "conv-engineering",
        name: "engineering",
        kind: "channel",
        memberCount: 4,
        preview: "Fix the login redirect",
      },
    ],
    users: [
      {
        id: "user-rahul",
        handle: "rahul",
        displayName: "rahul",
        avatar: "R",
        role: "developer",
      },
    ],
    branches: [
      {
        id: "branch-main",
        name: "main",
        conversationId: "conv-engineering",
        conversationName: "engineering",
        conversationKind: "channel",
        current: true,
      },
    ],
    messages: [
      {
        id: "message-one",
        seq: 1,
        text: "Fix the login redirect",
        snippet: "Fix the login redirect",
        author: "rahul",
        command: "git commit",
        createdAt: "2026-10-03T08:43:00.000Z",
        reverted: false,
        stashed: false,
        branch: { id: "branch-main", name: "main" },
        conversation: { id: "conv-engineering", name: "engineering", kind: "channel" },
      },
    ],
  },
  totals: { conversations: 1, users: 1, branches: 1, messages: 1 },
  truncated: {
    conversations: false,
    users: false,
    branches: false,
    messages: false,
  },
};

describe("palette list", () => {
  test("orders messages, conversations, people, then branches", () => {
    expect(flattenResults(results).map((hit) => hit.kind)).toEqual([
      "message",
      "conversation",
      "user",
      "branch",
    ]);
  });

  test("gives every hit a unique key", () => {
    const keys = flattenResults(results).map((hit) => hit.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  test("wraps at both ends and stays at zero for an empty list", () => {
    expect(moveActiveIndex(0, -1, 4)).toBe(3);
    expect(moveActiveIndex(3, 1, 4)).toBe(0);
    expect(moveActiveIndex(1, 1, 4)).toBe(2);
    expect(moveActiveIndex(0, 1, 0)).toBe(0);
  });

  test("clamps an index past the end of a shorter list", () => {
    expect(clampActiveIndex(5, 2)).toBe(1);
    expect(clampActiveIndex(-1, 2)).toBe(0);
    expect(clampActiveIndex(0, 0)).toBe(0);
  });
});

describe("highlight segments", () => {
  test("returns one unmatched segment when there is no term", () => {
    expect(highlightSegments("Fix the login", [])).toEqual([
      { text: "Fix the login", match: false },
    ]);
  });

  test("marks every occurrence without regard to case", () => {
    expect(highlightSegments("Login the LOGIN", ["login"])).toEqual([
      { text: "Login", match: true },
      { text: " the ", match: false },
      { text: "LOGIN", match: true },
    ]);
  });

  test("merges overlapping terms into one mark", () => {
    expect(highlightSegments("login", ["log", "login"])).toEqual([
      { text: "login", match: true },
    ]);
  });

  test("returns nothing for empty text", () => {
    expect(highlightSegments("", ["login"])).toEqual([]);
  });
});
