/**
 * Client frames are intentionally small. The socket only carries server
 * events today, so the only client frame we accept is a keepalive ping.
 */
export type ClientFrame =
  | { type: "ping" }
  | { type: "unsupported"; error: string };

export type ServerFrame =
  | { type: "ready"; conversationId: string }
  | { type: "pong" }
  | { type: "error"; error: string };

export function parseClientFrame(raw: string): ClientFrame {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return { type: "unsupported", error: "Malformed frame: expected JSON" };
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as { type?: unknown }).type === "ping"
  ) {
    return { type: "ping" };
  }

  return { type: "unsupported", error: "Unsupported frame type" };
}

export function serializeServerFrame(frame: ServerFrame): string {
  return JSON.stringify(frame);
}

export function readyFrame(conversationId: string): string {
  return serializeServerFrame({ type: "ready", conversationId });
}

export function pongFrame(): string {
  return serializeServerFrame({ type: "pong" });
}

export function errorFrame(error: string): string {
  return serializeServerFrame({ type: "error", error });
}
