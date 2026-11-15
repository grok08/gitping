import type { RealtimeEvent, RealtimePublisher } from "./events";

export type RealtimeClient = {
  id: string;
  conversationId: string;
  send: (payload: string) => void;
  close?: (code?: number, reason?: string) => void;
};

export type MessageHub = RealtimePublisher & {
  subscribe: (client: RealtimeClient) => void;
  unsubscribe: (client: RealtimeClient) => void;
  subscriberCount: (conversationId: string) => number;
  clientCount: () => number;
  closeAll: () => void;
};

/**
 * In-memory registry of connected clients, keyed by conversation.
 *
 * A hub instance belongs to one API process. It only knows about sockets that
 * live in this process, which is enough for the single-process deployment this
 * phase targets.
 */
export function createMessageHub(): MessageHub {
  const conversations = new Map<string, Set<RealtimeClient>>();

  function unsubscribe(client: RealtimeClient): void {
    const subscribers = conversations.get(client.conversationId);

    if (!subscribers) {
      return;
    }

    subscribers.delete(client);

    if (subscribers.size === 0) {
      conversations.delete(client.conversationId);
    }
  }

  function subscribe(client: RealtimeClient): void {
    const subscribers = conversations.get(client.conversationId);

    if (subscribers) {
      subscribers.add(client);
      return;
    }

    conversations.set(client.conversationId, new Set([client]));
  }

  return {
    subscribe,
    unsubscribe,

    publish(event: RealtimeEvent): void {
      const subscribers = conversations.get(event.conversationId);

      if (!subscribers) {
        return;
      }

      const payload = JSON.stringify(event);

      // Copy first so a failing send can unsubscribe without mutating the
      // collection that is being iterated.
      for (const client of [...subscribers]) {
        try {
          client.send(payload);
        } catch {
          unsubscribe(client);
        }
      }
    },

    subscriberCount(conversationId: string): number {
      return conversations.get(conversationId)?.size ?? 0;
    },

    clientCount(): number {
      let total = 0;

      for (const subscribers of conversations.values()) {
        total += subscribers.size;
      }

      return total;
    },

    closeAll(): void {
      for (const subscribers of [...conversations.values()]) {
        for (const client of [...subscribers]) {
          try {
            client.close?.(1001, "server shutting down");
          } catch {
            // A socket that is already gone needs no cleanup.
          }
        }
      }

      conversations.clear();
    },
  };
}
