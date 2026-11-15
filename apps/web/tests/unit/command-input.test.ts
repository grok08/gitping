import { describe, expect, test } from "bun:test";
import {
  analyzeCommandInput,
  completeCommand,
  suggestCommands,
  validateCommand,
} from "../../src/lib/command-input";
import type { CommandContext } from "../../src/lib/command-input";

const context: CommandContext = {
  conversationName: "engineering",
  conversationKind: "channel",
  branch: "main",
  branches: ["main", "weekend", "feature-ui"],
  messages: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      text: "Ready to ship?",
      stashed: false,
      reverted: false,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      text: "Parked work",
      stashed: true,
      reverted: false,
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      text: "Undone note",
      stashed: false,
      reverted: true,
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      text: "Newest first",
      stashed: false,
      reverted: false,
    },
  ],
};

function compose(input: string, caret = input.length): string {
  const [suggestion] = suggestCommands(input, { ...context, caret });

  if (!suggestion) {
    return "<none>";
  }

  return completeCommand(input, suggestion).value;
}

describe("command suggestions", () => {
  test("a partial verb offers the supported command", () => {
    const [suggestion] = suggestCommands("git sw", context);

    expect(suggestion?.label).toBe("git switch <branch>");
    expect(compose("git sw")).toBe("git switch ");
  });

  test("a single letter offers supported verbs only, content first", () => {
    const labels = suggestCommands("git s", context).map((item) => item.label);

    expect(labels).toEqual(["git switch <branch>", "git stash [push|list|pop]"]);
    expect(labels).not.toContain("git status");
  });

  test("an empty verb offers at most six supported commands", () => {
    const labels = suggestCommands("git ", context).map((item) => item.label);

    expect(labels).toHaveLength(6);
    expect(labels[0]).toBe('git commit -m "<message>"');
    expect(labels).not.toContain("git log");
  });

  test("the switch argument lists every branch and marks the current one", () => {
    const items = suggestCommands("git switch ", context);

    expect(items.map((item) => item.label)).toEqual([
      "git switch main",
      "git switch weekend",
      "git switch feature-ui",
    ]);
    expect(items.map((item) => item.current)).toEqual([true, false, false]);
    expect(items[0]?.detail).toBe("current branch");
  });

  test("a branch prefix filters and completion replaces only that token", () => {
    expect(suggestCommands("git switch fe", context).map((item) => item.label)).toEqual([
      "git switch feature-ui",
    ]);
    expect(compose("git switch fe")).toBe("git switch feature-ui");
    expect(compose("git switch fe tail", 13)).toBe("git switch feature-ui tail");
  });

  test("a caret inside a branch name replaces the whole token", () => {
    expect(compose("git switch feature", 13)).toBe("git switch feature-ui");
  });

  test("creating a branch offers names for neither switch -c nor branch", () => {
    expect(suggestCommands("git switch -c ", context)).toEqual([]);
    expect(suggestCommands("git branch ", context)).toEqual([]);
  });

  test("merge skips the current branch", () => {
    expect(suggestCommands("git merge ", context).map((item) => item.label)).toEqual([
      "git merge weekend",
      "git merge feature-ui",
    ]);
  });

  test("revert offers recent messages by id, newest first, skipping reverted", () => {
    const items = suggestCommands("git revert ", context);

    expect(items.map((item) => item.label)).toEqual([
      "git revert 44444444",
      "git revert 22222222",
      "git revert 11111111",
    ]);
    expect(items[0]?.detail).toBe('"Newest first"');
    expect(compose("git revert ")).toBe("git revert 44444444");
  });

  test("stash pop offers only stashed messages", () => {
    const items = suggestCommands("git stash pop ", context);

    expect(items.map((item) => item.label)).toEqual(["git stash pop 22222222"]);
  });

  test("stash lists its own subcommands", () => {
    expect(suggestCommands("git stash ", context).map((item) => item.label)).toEqual([
      'git stash push -m "<message>"',
      "git stash list",
      "git stash pop [<stash>]",
    ]);
  });

  test("a quoted message skeleton puts the caret between the quotes", () => {
    const [suggestion] = suggestCommands("git commit", context);

    expect(suggestion).toBeDefined();

    if (!suggestion) {
      return;
    }

    const applied = completeCommand("git commit", suggestion);

    expect(applied.value).toBe('git commit -m ""');
    expect(applied.caret).toBe(applied.value.length - 1);
  });

  test("nothing is suggested for an empty or unsupported input", () => {
    expect(suggestCommands("", context)).toEqual([]);
    expect(suggestCommands("git log", context)).toEqual([]);
  });

  test("suggestions never exceed six", () => {
    const wide = {
      ...context,
      branches: Array.from({ length: 10 }, (_, index) => `branch-${index}`),
    };

    expect(suggestCommands("git switch ", wide)).toHaveLength(6);
  });
});

describe("command validation", () => {
  test("an empty composer renders nothing", () => {
    expect(validateCommand("", context)).toEqual({
      state: "empty",
      hint: "",
      preview: "",
      message: "",
    });
  });

  test("git alone is incomplete, not an error", () => {
    const validation = validateCommand("git", context);

    expect(validation.state).toBe("incomplete");
    expect(validation.message).toBe("");
    expect(validation.hint).toBe("Type a Git command");
  });

  test("a partial verb names the commands it could become", () => {
    const validation = validateCommand("git sw", context);

    expect(validation.state).toBe("incomplete");
    expect(validation.hint).toBe("Commands: git switch");
  });

  test("missing arguments are incomplete with a hint", () => {
    expect(validateCommand("git switch", context)).toMatchObject({
      state: "incomplete",
      hint: expect.stringContaining("branch: main, weekend, feature-ui"),
    });
    expect(validateCommand("git switch -c", context)).toMatchObject({
      state: "incomplete",
      hint: expect.stringContaining("new branch name"),
    });
    expect(validateCommand("git branch ", context)).toMatchObject({
      state: "incomplete",
      hint: expect.stringContaining("new branch name"),
    });
    expect(validateCommand("git commit", context)).toMatchObject({
      state: "incomplete",
      hint: expect.stringContaining('git commit -m "<message>"'),
    });
  });

  test("a bare branch lists and a trailing space asks for a name", () => {
    expect(validateCommand("git branch", context)).toMatchObject({
      state: "complete",
      preview: "List the branches in #engineering",
    });
    expect(validateCommand("git branch ", context).state).toBe("incomplete");
  });

  test("complete commands carry a plain-language preview", () => {
    expect(validateCommand('git commit -m "ship it"', context)).toMatchObject({
      state: "complete",
      preview: "Commit to #engineering on main",
    });
    expect(validateCommand("git revert 1a2b3c4d", context).preview).toBe(
      "Revert 1a2b3c4d",
    );
    expect(validateCommand("git merge weekend", context).preview).toBe(
      "Merge weekend into main",
    );
    expect(validateCommand("git stash", context).preview).toBe(
      "Stash the newest message on main",
    );
    expect(validateCommand("git stash list", context).preview).toBe(
      "List stashed messages on main",
    );
    expect(validateCommand("git stash pop 22222222", context).preview).toBe(
      "Restore stash 22222222",
    );
    expect(validateCommand("git stash pop", context).preview).toBe(
      "Restore the newest stash on main",
    );
    expect(validateCommand("git switch -c release", context).preview).toBe(
      "Create release from main and switch to it",
    );
    expect(validateCommand("git branch weekend", context).preview).toBe(
      "Create branch weekend from main",
    );
  });

  test("a direct conversation is named without a channel prefix", () => {
    expect(
      validateCommand('git commit -m "hi"', {
        ...context,
        conversationName: "alice",
        conversationKind: "direct",
      }).preview,
    ).toBe("Commit to alice on main");
  });

  test("an unsupported verb is invalid and says it is not enabled", () => {
    const validation = validateCommand("git log", context);

    expect(validation.state).toBe("invalid");
    expect(validation.message).toBe("git log is not enabled yet.");
    expect(validation.preview).toBe("Not enabled yet");
  });

  test("an unknown verb is invalid with the parser's message", () => {
    expect(validateCommand("git checkout main", context)).toMatchObject({
      state: "invalid",
      message: "Unsupported GitPing command: git checkout",
    });
    expect(validateCommand("npm install", context)).toMatchObject({
      state: "invalid",
      message: "Command must start with 'git'",
    });
  });

  test("a malformed argument list is invalid, not incomplete", () => {
    expect(validateCommand("git merge one two", context)).toMatchObject({
      state: "invalid",
      message: "Use git merge <branch>",
    });
    expect(validateCommand('git commit -m "unterminated', context)).toMatchObject({
      state: "invalid",
      message: "Unterminated quote",
    });
  });

  test("analysis reports the stage the caret is in", () => {
    expect(analyzeCommandInput("git sw").state).toBe("command");
    expect(analyzeCommandInput("git switch ").state).toBe("argument");
    expect(analyzeCommandInput("git stash ").state).toBe("literal");
    expect(analyzeCommandInput("git branch weekend").state).toBe("complete");
  });
});
