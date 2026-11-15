import { describe, expect, test } from "bun:test";
import { messageSnippet } from "./snippet";

describe("message snippets", () => {
  test("returns a short message unchanged", () => {
    expect(messageSnippet("Fix the login redirect", ["login"])).toBe(
      "Fix the login redirect",
    );
  });

  test("cuts a long message around the earliest term", () => {
    const text = `${"a".repeat(400)} login ${"b".repeat(400)}`;
    const snippet = messageSnippet(text, ["login"]);

    expect(snippet).toContain("login");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(202);
  });

  test("starts at the beginning when the match is early", () => {
    const text = `login ${"b".repeat(400)}`;
    const snippet = messageSnippet(text, ["login"]);

    expect(snippet.startsWith("login")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
  });

  test("falls back to the start when no term matches", () => {
    const text = "b".repeat(400);
    const snippet = messageSnippet(text, ["login"]);

    expect(snippet.startsWith("b")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
  });
});
