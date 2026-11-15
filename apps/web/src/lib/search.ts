import type {
  SearchBranchHit,
  SearchConversationHit,
  SearchMessageHit,
  SearchUserHit,
  WorkspaceSearchResults,
} from "../types/search";

export type SearchHit =
  | { kind: "message"; key: string; message: SearchMessageHit }
  | { kind: "conversation"; key: string; conversation: SearchConversationHit }
  | { kind: "user"; key: string; user: SearchUserHit }
  | { kind: "branch"; key: string; branch: SearchBranchHit };

/**
 * The palette is one list for the keyboard, so groups are only a rendering
 * concern. Messages come first because a member searches text far more often
 * than a name.
 */
export function flattenResults(results: WorkspaceSearchResults): SearchHit[] {
  return [
    ...results.groups.messages.map((message) => ({
      kind: "message" as const,
      key: `message:${message.id}`,
      message,
    })),
    ...results.groups.conversations.map((conversation) => ({
      kind: "conversation" as const,
      key: `conversation:${conversation.id}`,
      conversation,
    })),
    ...results.groups.users.map((user) => ({
      kind: "user" as const,
      key: `user:${user.id}`,
      user,
    })),
    ...results.groups.branches.map((branch) => ({
      kind: "branch" as const,
      key: `branch:${branch.id}`,
      branch,
    })),
  ];
}

/** Arrow keys wrap, so the list never dead-ends on a single group. */
export function moveActiveIndex(
  current: number,
  delta: number,
  length: number,
): number {
  if (length === 0) {
    return 0;
  }

  return (current + delta + length) % length;
}

export function clampActiveIndex(current: number, length: number): number {
  if (length === 0) {
    return 0;
  }

  return Math.min(Math.max(current, 0), length - 1);
}

export type HighlightSegment = {
  text: string;
  match: boolean;
};

/**
 * Splits text into matched and unmatched runs for the terms the server
 * matched. Overlapping terms merge, so a highlight never nests.
 */
export function highlightSegments(
  text: string,
  terms: readonly string[],
): HighlightSegment[] {
  if (!text) {
    return [];
  }

  const lower = text.toLowerCase();
  const marked = new Array<boolean>(text.length).fill(false);

  for (const term of terms) {
    const needle = term.toLowerCase();

    if (!needle) {
      continue;
    }

    let from = 0;

    while (from <= lower.length) {
      const at = lower.indexOf(needle, from);

      if (at < 0) {
        break;
      }

      for (let index = at; index < at + needle.length; index += 1) {
        marked[index] = true;
      }

      from = at + needle.length;
    }
  }

  const segments: HighlightSegment[] = [];
  let start = 0;

  for (let index = 1; index <= text.length; index += 1) {
    if (index === text.length || marked[index] !== marked[start]) {
      segments.push({
        text: text.slice(start, index),
        match: marked[start] === true,
      });
      start = index;
    }
  }

  return segments;
}
