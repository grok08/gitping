import { describe, expect, test } from "bun:test";
import {
  catalogEntryForType,
  commandCatalog,
  formatCommandList,
  supportedCommandEntries,
  supportedCommandNames,
  unsupportedCommandMessage,
} from "./catalog";
import type { CommandType } from "./catalog";
import { parseCommand } from "./parser";

const parserTypes: readonly CommandType[] = [
  "init",
  "clone",
  "commit",
  "log",
  "show",
  "branch",
  "switch",
  "status",
  "fetch",
  "pull",
  "push",
  "revert",
  "merge",
  "stash-push",
  "stash-list",
  "stash-pop",
  "config",
];

describe("command catalog", () => {
  test("every example is a real command", () => {
    for (const entry of commandCatalog) {
      expect(() => parseCommand(entry.example)).not.toThrow();
    }
  });

  test("every example parses to a type the entry owns", () => {
    for (const entry of commandCatalog) {
      expect(entry.types).toContain(parseCommand(entry.example).type);
    }
  });

  test("every parser type maps to exactly one entry", () => {
    const owners = new Map<CommandType, string>();

    for (const entry of commandCatalog) {
      for (const type of entry.types) {
        expect(owners.has(type)).toBe(false);
        owners.set(type, entry.name);
      }
    }

    expect([...owners.keys()].sort()).toEqual([...parserTypes].sort());

    for (const type of parserTypes) {
      expect(catalogEntryForType(type).types).toContain(type);
    }
  });

  test("every form is written for its own verb", () => {
    for (const entry of commandCatalog) {
      expect(entry.forms.length).toBeGreaterThan(0);

      for (const form of entry.forms) {
        expect(form.syntax.startsWith(`git ${entry.name}`)).toBe(true);
      }
    }
  });

  test("content and context are the only accepted commands", () => {
    expect(supportedCommandEntries().map((entry) => entry.name)).toEqual([
      "commit",
      "revert",
      "merge",
      "branch",
      "switch",
      "stash",
    ]);

    for (const entry of supportedCommandEntries()) {
      expect(["content", "context"]).toContain(entry.support);
    }
  });

  test("the unsupported sentence lists exactly the supported verbs", () => {
    expect(unsupportedCommandMessage()).toBe(
      "Unsupported command. Use git commit, git revert, git merge, git branch, git switch, or git stash.",
    );
    expect(supportedCommandNames()).toEqual([
      "commit",
      "revert",
      "merge",
      "branch",
      "switch",
      "stash",
    ]);
  });

  test("formats a command list the way the rejection sentence reads", () => {
    expect(formatCommandList([])).toBe("");
    expect(formatCommandList(["git commit"])).toBe("git commit");
    expect(formatCommandList(["git commit", "git stash"])).toBe(
      "git commit, or git stash",
    );
    expect(
      formatCommandList(["git commit", "git revert", "git stash"]),
    ).toBe("git commit, git revert, or git stash");
  });
});
