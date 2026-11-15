export const commandHistoryLimit = 50;

export function commandHistoryKey(conversationId: string): string {
  return `gitping:command-history:${conversationId}`;
}

/**
 * A session history keeps the last 50 commands per conversation. A repeated
 * command directly after itself is the same intent pressed twice, so it is
 * collapsed; the same command later in the list is a real repeat and stays.
 */
export function pushCommandHistory(
  history: readonly string[],
  command: string,
): readonly string[] {
  const value = command.trim();

  if (!value || history[history.length - 1] === value) {
    return history;
  }

  const next = [...history, value];

  return next.length > commandHistoryLimit
    ? next.slice(next.length - commandHistoryLimit)
    : next;
}

export type HistoryCursor = {
  /** Index into the history while recalling, or null while editing the draft. */
  index: number | null;
  /** The text that was in the composer before the first recall. */
  draft: string;
};

export type HistoryStep = {
  value: string;
  cursor: HistoryCursor;
};

/**
 * ArrowUp walks back from the newest command; ArrowDown walks forward and then
 * returns to the draft the user had before recalling anything.
 */
export function stepCommandHistory(
  history: readonly string[],
  cursor: HistoryCursor,
  direction: "older" | "newer",
  currentValue: string,
): HistoryStep {
  if (history.length === 0) {
    return { value: currentValue, cursor };
  }

  if (direction === "older") {
    const index =
      cursor.index === null
        ? history.length - 1
        : Math.max(0, cursor.index - 1);
    const draft = cursor.index === null ? currentValue : cursor.draft;

    return {
      value: history[index] ?? currentValue,
      cursor: { index, draft },
    };
  }

  if (cursor.index === null) {
    return { value: currentValue, cursor };
  }

  const index = cursor.index + 1;

  if (index >= history.length) {
    return {
      value: cursor.draft,
      cursor: { index: null, draft: cursor.draft },
    };
  }

  return {
    value: history[index] ?? currentValue,
    cursor: { index, draft: cursor.draft },
  };
}

export type HistoryStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

export function readCommandHistory(
  storage: HistoryStorage,
  conversationId: string,
): string[] {
  try {
    const stored = storage.getItem(commandHistoryKey(conversationId));

    if (!stored) {
      return [];
    }

    const parsed: unknown = JSON.parse(stored);

    return isStringArray(parsed) ? parsed.slice(-commandHistoryLimit) : [];
  } catch {
    // Unreadable history is the same as no history; sending still works.
    return [];
  }
}

export function writeCommandHistory(
  storage: HistoryStorage,
  conversationId: string,
  history: readonly string[],
): void {
  try {
    storage.setItem(
      commandHistoryKey(conversationId),
      JSON.stringify(history.slice(-commandHistoryLimit)),
    );
  } catch {
    // Storage can be full or blocked. History is a convenience, not state.
  }
}
