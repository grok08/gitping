import { describe, expect, test } from "bun:test";
import {
  commandHistoryKey,
  commandHistoryLimit,
  pushCommandHistory,
  readCommandHistory,
  stepCommandHistory,
  writeCommandHistory,
} from "../../src/lib/command-history";
import type { HistoryStorage } from "../../src/lib/command-history";

function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));

  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    values,
  } satisfies HistoryStorage & { values: Map<string, string> };
}

describe("command history", () => {
  test("keeps one key per conversation", () => {
    expect(commandHistoryKey("conv-engineering")).toBe(
      "gitping:command-history:conv-engineering",
    );
    expect(commandHistoryKey("conv-weekend")).not.toBe(
      commandHistoryKey("conv-engineering"),
    );
  });

  test("collapses consecutive duplicates and keeps a later repeat", () => {
    let history = pushCommandHistory([], "git stash");
    history = pushCommandHistory(history, "git stash");
    history = pushCommandHistory(history, "git status");
    history = pushCommandHistory(history, "git stash");

    expect(history).toEqual(["git stash", "git status", "git stash"]);
  });

  test("ignores empty commands and caps the list", () => {
    expect(pushCommandHistory([], "   ")).toEqual([]);

    let history: readonly string[] = [];

    for (let index = 0; index < commandHistoryLimit + 5; index += 1) {
      history = pushCommandHistory(history, `git commit -m "note ${index}"`);
    }

    expect(history).toHaveLength(commandHistoryLimit);
    expect(history[0]).toBe('git commit -m "note 5"');
    expect(history[history.length - 1]).toBe(
      `git commit -m "note ${commandHistoryLimit + 4}"`,
    );
  });

  test("arrow up recalls the newest command and arrow down returns the draft", () => {
    const history = ["git stash", "git status", "git commit"];

    const older = stepCommandHistory(
      history,
      { index: null, draft: "" },
      "older",
      "half typed",
    );

    expect(older.value).toBe("git commit");
    expect(older.cursor).toEqual({ index: 2, draft: "half typed" });

    const olderAgain = stepCommandHistory(history, older.cursor, "older", older.value);

    expect(olderAgain.value).toBe("git status");

    const newest = stepCommandHistory(
      history,
      { index: 1, draft: "half typed" },
      "newer",
      olderAgain.value,
    );

    expect(newest.value).toBe("git commit");

    const draft = stepCommandHistory(history, newest.cursor, "newer", newest.value);

    expect(draft.value).toBe("half typed");
    expect(draft.cursor.index).toBeNull();
  });

  test("arrow up stops at the oldest command", () => {
    const history = ["git stash", "git commit"];
    const atOldest = { index: 0, draft: "" };

    expect(
      stepCommandHistory(history, atOldest, "older", "git stash").value,
    ).toBe("git stash");
  });

  test("arrow down with no recall in progress leaves the draft alone", () => {
    expect(
      stepCommandHistory(
        ["git stash"],
        { index: null, draft: "" },
        "newer",
        "draft",
      ).value,
    ).toBe("draft");
  });

  test("reads and writes through storage, ignoring broken values", () => {
    const storage = fakeStorage();
    const conversationId = "conv-engineering";

    writeCommandHistory(storage, conversationId, ["git stash", "git commit"]);

    expect(readCommandHistory(storage, conversationId)).toEqual([
      "git stash",
      "git commit",
    ]);

    storage.values.set(commandHistoryKey(conversationId), "{not json");
    expect(readCommandHistory(storage, conversationId)).toEqual([]);

    storage.values.set(commandHistoryKey(conversationId), '{"a":1}');
    expect(readCommandHistory(storage, conversationId)).toEqual([]);
  });
});
