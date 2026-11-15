import { describe, expect, test } from "bun:test";
import {
  maxSearchLength,
  parseSearchLimit,
  parseSearchQuery,
  searchCriteria,
} from "./query";

function parse(raw: string) {
  const result = parseSearchQuery(raw);

  if (!result.ok) {
    throw new Error(`expected a parsed query, received: ${result.error}`);
  }

  return result.query;
}

describe("search query parsing", () => {
  test("splits bare words into separate terms", () => {
    expect(parse("login redirect")).toEqual({
      text: "login redirect",
      terms: ["login", "redirect"],
      filters: {
        author: null,
        command: null,
        branch: null,
        after: null,
        before: null,
      },
    });
  });

  test("keeps a quoted phrase as one term", () => {
    const query = parse('"login redirect" oops');

    expect(query.terms).toEqual(["login redirect", "oops"]);
    expect(query.text).toBe("login redirect oops");
  });

  test("reads every filter and leaves the text behind", () => {
    const query = parse(
      "deploy author:grok08 command:commit branch:feature-ui after:2026-10-01 before:2026-11-01",
    );

    expect(query).toEqual({
      text: "deploy",
      terms: ["deploy"],
      filters: {
        author: "grok08",
        command: "commit",
        branch: "feature-ui",
        after: "2026-10-01",
        before: "2026-11-01",
      },
    });
  });

  test("accepts a filter on its own", () => {
    const query = parse("author:rahul");

    expect(query.text).toBe("");
    expect(query.terms).toEqual([]);
    expect(query.filters.author).toBe("rahul");
  });

  test("accepts an ISO timestamp and a quoted git prefix on the verb", () => {
    const query = parse('command:"git stash" after:2026-10-01T09:30:00Z');

    expect(query.filters.command).toBe("stash");
    expect(query.filters.after).toBe("2026-10-01T09:30:00Z");
  });

  test("treats a word with an unknown prefix as text", () => {
    const query = parse("note:later https://example.test");

    expect(query.terms).toEqual(["note:later", "https://example.test"]);
  });

  test("rejects a filter with no value", () => {
    expect(parseSearchQuery("branch:  deploy")).toEqual({
      ok: false,
      error: "branch: needs a value",
    });
  });

  test("rejects a date it cannot read", () => {
    expect(parseSearchQuery("after:soon")).toEqual({
      ok: false,
      error: "after: expects YYYY-MM-DD or an ISO timestamp",
    });

    expect(parseSearchQuery("before:2026-13-45")).toEqual({
      ok: false,
      error: "before: expects YYYY-MM-DD or an ISO timestamp",
    });
  });

  test("rejects a command the server does not route", () => {
    const result = parseSearchQuery("command:log");

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toBe(
        "Unknown command: log. Supported: commit, revert, merge, branch, switch, or stash.",
      );
    }
  });

  test("rejects a blank query and a query made of filled words that filter out", () => {
    expect(parseSearchQuery("   ")).toEqual({
      ok: false,
      error: "Search query is required",
    });
    expect(parseSearchQuery(undefined)).toEqual({
      ok: false,
      error: "Search query is required",
    });
    expect(parseSearchQuery('""')).toEqual({
      ok: false,
      error: "Search query is required",
    });
  });

  test("rejects a query past the length limit", () => {
    const result = parseSearchQuery("a".repeat(maxSearchLength + 1));

    expect(result).toEqual({
      ok: false,
      error: `Search query is too long (${maxSearchLength} characters maximum)`,
    });
  });
});

describe("search limit parsing", () => {
  test("defaults to ten", () => {
    expect(parseSearchLimit(undefined)).toEqual({ ok: true, value: 10 });
    expect(parseSearchLimit("")).toEqual({ ok: true, value: 10 });
  });

  test("accepts a whole number inside the range", () => {
    expect(parseSearchLimit("1")).toEqual({ ok: true, value: 1 });
    expect(parseSearchLimit("50")).toEqual({ ok: true, value: 50 });
  });

  test("rejects zero, fifty-one, a fraction, and a word", () => {
    const error = "limit must be a whole number from 1 to 50";

    expect(parseSearchLimit("0")).toEqual({ ok: false, error });
    expect(parseSearchLimit("51")).toEqual({ ok: false, error });
    expect(parseSearchLimit("2.5")).toEqual({ ok: false, error });
    expect(parseSearchLimit("many")).toEqual({ ok: false, error });
  });
});

describe("search criteria", () => {
  test("carries the filters and the scope", () => {
    const query = parse("login author:rahul after:2026-10-01");

    expect(searchCriteria(query, { conversationId: "conv-engineering" })).toEqual({
      terms: ["login"],
      conversationId: "conv-engineering",
      author: "rahul",
      command: null,
      branch: null,
      after: "2026-10-01T00:00:00.000Z",
      before: null,
    });
  });
});
