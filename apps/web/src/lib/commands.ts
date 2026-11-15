export type PendingCommand = {
  id: string;
  text: string;
};

/**
 * The id a retry has to reuse, and a new one for anything else.
 *
 * A request id names one intent, not one request body, so a retry of the same
 * text keeps its id and the server can answer with the message it already
 * stored. Any other text is a new intent and gets a fresh id.
 *
 * Pure on purpose: no React and no DOM, so the rule is unit-testable.
 */
export function commandRequestId(
  previous: PendingCommand | null,
  text: string,
): PendingCommand {
  if (previous && previous.text === text) {
    return previous;
  }

  return { id: crypto.randomUUID(), text };
}
