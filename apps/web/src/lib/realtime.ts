import type { MessageEventPayload } from "../types/message";

const initialReconnectDelay = 500;
const maxReconnectDelay = 10_000;
const jitterRatio = 0.2;

/**
 * Bounded exponential backoff: 500ms, 1s, 2s, 4s, 8s, then 10s, each step
 * spread by up to 20% so a room full of clients does not retry in lockstep.
 */
export function nextReconnectDelay(
  attempt: number,
  random: () => number = Math.random,
): number {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  const base = Math.min(
    initialReconnectDelay * 2 ** safeAttempt,
    maxReconnectDelay,
  );
  const spread = (random() * 2 - 1) * jitterRatio;

  return Math.round(base * (1 + spread));
}

export function pingFrame(): string {
  return JSON.stringify({ type: "ping" });
}

/**
 * Parses a server frame without trusting it. Anything that is not a complete
 * `message.created` payload is ignored instead of crashing the UI.
 */
export function parseMessageEvent(raw: string): MessageEventPayload | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const frame = parsed as {
    type?: unknown;
    conversationId?: unknown;
    message?: unknown;
  };

  if (
    frame.type !== "message.created" ||
    typeof frame.conversationId !== "string"
  ) {
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
    type: "message.created",
    conversationId: frame.conversationId,
    seq: message.seq,
    message: {
      seq: message.seq,
      id: message.id,
      author: message.author,
      text: message.text,
      command: message.command,
      createdAt: message.createdAt,
    },
  };
}
