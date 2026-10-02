import { describe, expect, test } from "bun:test";
import { parseCommand } from "./parser";

describe("GitPing command parser", () => {
  test("git init", () => {
    expect(parseCommand("git init")).toEqual({
      type: "init",
    });
  });

  test("git clone", () => {
    expect(parseCommand("git clone gitping://general")).toEqual({
      type: "clone",
      repository: "gitping://general",
    });
  });

  test("git commit", () => {
    expect(
      parseCommand('git commit -m "what are you doing?"'),
    ).toEqual({
      type: "commit",
      message: "what are you doing?",
      amend: false,
    });
  });

  test("git commit with single quotes", () => {
    expect(parseCommand("git commit -m 'hello world'")).toEqual({
      type: "commit",
      message: "hello world",
      amend: false,
    });
  });

  test("git commit --amend", () => {
    expect(
      parseCommand('git commit --amend -m "corrected message"'),
    ).toEqual({
      type: "commit",
      message: "corrected message",
      amend: true,
    });
  });

  test("git commit --message", () => {
    expect(
      parseCommand('git commit --message="hello"'),
    ).toEqual({
      type: "commit",
      message: "hello",
      amend: false,
    });
  });

  test("git log", () => {
    expect(parseCommand("git log")).toEqual({
      type: "log",
    });
  });

  test("git show", () => {
    expect(parseCommand("git show a81c32")).toEqual({
      type: "show",
      target: "a81c32",
    });
  });

  test("git branch", () => {
    expect(parseCommand("git branch")).toEqual({
      type: "branch",
    });
  });

  test("git branch weekend", () => {
    expect(parseCommand("git branch weekend")).toEqual({
      type: "branch",
      name: "weekend",
    });
  });

  test("git switch weekend", () => {
    expect(parseCommand("git switch weekend")).toEqual({
      type: "switch",
      name: "weekend",
      create: false,
    });
  });

  test("git switch -c weekend", () => {
    expect(parseCommand("git switch -c weekend")).toEqual({
      type: "switch",
      name: "weekend",
      create: true,
    });
  });

  test("git status", () => {
    expect(parseCommand("git status")).toEqual({
      type: "status",
    });
  });

  test("git fetch", () => {
    expect(parseCommand("git fetch")).toEqual({
      type: "fetch",
      remote: undefined,
    });
  });

  test("git fetch origin", () => {
    expect(parseCommand("git fetch origin")).toEqual({
      type: "fetch",
      remote: "origin",
    });
  });

  test("git pull", () => {
    expect(parseCommand("git pull")).toEqual({
      type: "pull",
      remote: undefined,
      branch: undefined,
    });
  });

  test("git pull origin main", () => {
    expect(parseCommand("git pull origin main")).toEqual({
      type: "pull",
      remote: "origin",
      branch: "main",
    });
  });

  test("git push", () => {
    expect(parseCommand("git push")).toEqual({
      type: "push",
      remote: undefined,
      branch: undefined,
    });
  });

  test("git push origin main", () => {
    expect(parseCommand("git push origin main")).toEqual({
      type: "push",
      remote: "origin",
      branch: "main",
    });
  });

  test("git revert", () => {
    expect(parseCommand("git revert a81c32")).toEqual({
      type: "revert",
      target: "a81c32",
    });
  });

  test("git stash", () => {
    expect(parseCommand("git stash")).toEqual({
      type: "stash-push",
    });
  });

  test("git stash push -m", () => {
    expect(
      parseCommand('git stash push -m "tell you later"'),
    ).toEqual({
      type: "stash-push",
      message: "tell you later",
    });
  });

  test("git stash list", () => {
    expect(parseCommand("git stash list")).toEqual({
      type: "stash-list",
    });
  });

  test("git stash pop", () => {
    expect(parseCommand("git stash pop stash@{0}")).toEqual({
      type: "stash-pop",
      stash: "stash@{0}",
    });
  });

  test("git config user.name", () => {
    expect(
      parseCommand('git config user.name "Umesh Chandra"'),
    ).toEqual({
      type: "config",
      key: "user.name",
      value: "Umesh Chandra",
    });
  });

  test("git config user.email", () => {
    expect(
      parseCommand(
        'git config user.email "umesh@example.com"',
      ),
    ).toEqual({
      type: "config",
      key: "user.email",
      value: "umesh@example.com",
    });
  });

  test("rejects non-git commands", () => {
    expect(() => parseCommand("npm install")).toThrow(
      "Command must start with 'git'",
    );
  });

  test("rejects unsupported git commands", () => {
    expect(() => parseCommand("git checkout main")).toThrow(
      "Unsupported GitPing command: git checkout",
    );
  });

  test("rejects commit without message", () => {
    expect(() => parseCommand("git commit")).toThrow(
      "git commit requires -m <message>",
    );
  });

  test("rejects unterminated quotes", () => {
    expect(() => parseCommand('git commit -m "hello')).toThrow(
      "Unterminated quote",
    );
  });
});