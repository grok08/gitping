import type { CreatedMessage } from "../types/message";

const initialReconnectDelay = 500;
const maxReconnectDelay = 10_000;

/**
 * Bounded exponential backoff: 500ms, 1s, 2s, 4s, 8s, then 10s forever.
 */
export function nextReconnectDelay(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;

  return Math.min(
    initialReconnectDelay * 2 ** safeAttempt,
    maxReconnectDelay,
  );
}

/**
 * Parses a server frame without trusting it. Anything that is not a complete
 * `message.created` payload is ignored instead of crashing the UI.
 */
export function parseMessageEvent(raw: string): CreatedMessage | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const frame = parsed as { type?: unknown; message?: unknown };

  if (frame.type !== "message.created") {
    return null;
  }

  if (typeof frame.message !== "object" || frame.message === null) {
    return null;
  }

  const message = frame.message as Record<string, unknown>;

  if (
    typeof message.id !== "string" ||
    typeof message.author !== "string" ||
    typeof message.text !== "string" ||
    typeof message.command !== "string" ||
    typeof message.createdAt !== "string" ||
    typeof message.seq !== "number" ||
    !Number.isFinite(message.seq)
  ) {
    return null;
  }

  return {
    seq: message.seq,
    id: message.id,
    author: message.author,
    text: message.text,
    command: message.command,
    createdAt: message.createdAt,
  };
}
