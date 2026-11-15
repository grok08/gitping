import { describe, expect, test } from "bun:test";
import { currentBranchName } from "../../src/lib/branches";
import type { ApiBranch } from "../../src/types/conversation";

function branch(name: string, current = false): ApiBranch {
  return {
    id: `branch-${name}`,
    name,
    headMessageId: null,
    current,
  };
}

describe("current branch selection", () => {
  test("selects the branch the server marks current", () => {
    expect(
      currentBranchName([branch("main"), branch("release", true), branch("weekend")]),
    ).toBe("release");
  });

  test("falls back to main when no branch is marked", () => {
    expect(currentBranchName([branch("release"), branch("main")])).toBe("main");
  });

  test("falls back to the first branch when main is absent", () => {
    expect(currentBranchName([branch("release"), branch("weekend")])).toBe(
      "release",
    );
  });

  test("defaults to main before the list has loaded", () => {
    expect(currentBranchName([])).toBe("main");
  });
});
