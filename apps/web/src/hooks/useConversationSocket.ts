import { useEffect, useRef } from "react";
import { conversationEventsUrl } from "../lib/api";
import { createHeartbeat } from "../lib/heartbeat";
import { nextReconnectDelay, parseMessageEvent, pingFrame } from "../lib/realtime";
import type { CreatedMessage } from "../types/message";

export type ConnectionStatus =
  | "connecting"
  | "live"
  | "reconnecting"
  | "offline";

type ConversationSocketOptions = {
  conversationId: string;
  onMessage: (message: CreatedMessage, conversationId: string) => void;
  /**
   * Called on every successful open, including reconnects. The caller refetches
   * persisted history and merges it, which closes any gap left by the outage.
   */
  onCatchUp: (conversationId: string) => void;
  onStatusChange: (status: ConnectionStatus) => void;
};

/**
 * A malformed URL throws synchronously. The reconnect loop treats that as any
 * other failure instead of letting it escape into the render pass.
 */
function createSocket(conversationId: string): WebSocket | null {
  try {
    return new WebSocket(conversationEventsUrl(conversationId));
  } catch {
    return null;
  }
}

/**
 * WebSocket lifecycle for the active conversation: open, close, error, a
 * bounded reconnect loop, and a heartbeat so a silent socket cannot pass for a
 * live one. The socket is transport only; persistence stays on HTTP, which
 * keeps working while the socket is down.
 */
export function useConversationSocket({
  conversationId,
  onMessage,
  onCatchUp,
  onStatusChange,
}: ConversationSocketOptions): void {
  const handlers = useRef({ onMessage, onCatchUp, onStatusChange });

  // Keep the effect below independent of callback identity while still
  // calling the latest handlers.
  useEffect(() => {
    handlers.current = { onMessage, onCatchUp, onStatusChange };
  });

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let openedOnce = false;
    let disposed = false;

    const heartbeat = createHeartbeat({
      onPing() {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(pingFrame());
        }
      },
      onTimeout() {
        // Close on silence so the normal reconnect path takes over.
        socket?.close();
      },
    });

    function report(status: ConnectionStatus) {
      if (!disposed) {
        handlers.current.onStatusChange(status);
      }
    }

    function clearTimer() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function connect() {
      clearTimer();

      if (disposed) {
        return;
      }

      report(
        openedOnce
          ? navigator.onLine
            ? "reconnecting"
            : "offline"
          : "connecting",
      );

      const current = createSocket(conversationId);

      if (!current) {
        report(navigator.onLine ? "reconnecting" : "offline");

        const delay = nextReconnectDelay(attempt);

        attempt += 1;
        timer = setTimeout(connect, delay);
        return;
      }

      socket = current;

      current.addEventListener("open", () => {
        attempt = 0;
        openedOnce = true;
        report("live");
        heartbeat.start();
        handlers.current.onCatchUp(conversationId);
      });

      current.addEventListener("message", (event) => {
        heartbeat.noteActivity();

        if (typeof event.data !== "string") {
          return;
        }

        const parsed = parseMessageEvent(event.data);

        // The socket is already scoped to one conversation, and this is the
        // second line of defence: a frame for another room is dropped here.
        if (!parsed || parsed.conversationId !== conversationId) {
          return;
        }

        handlers.current.onMessage(parsed.message, conversationId);
      });

      current.addEventListener("error", () => {
        report(navigator.onLine ? "reconnecting" : "offline");
      });

      current.addEventListener("close", () => {
        heartbeat.stop();

        if (socket === current) {
          socket = null;
        }

        if (disposed) {
          return;
        }

        report(navigator.onLine ? "reconnecting" : "offline");

        const delay = nextReconnectDelay(attempt);

        attempt += 1;
        timer = setTimeout(connect, delay);
      });
    }

    function retryImmediately() {
      if (disposed || socket) {
        return;
      }

      attempt = 0;
      connect();
    }

    window.addEventListener("online", retryImmediately);
    connect();

    return () => {
      disposed = true;
      clearTimer();
      heartbeat.stop();
      window.removeEventListener("online", retryImmediately);
      socket?.close();
    };
  }, [conversationId]);
}
