import { createBunWebSocket } from "hono/bun";
import { Hono } from "hono";
import type { ConversationService } from "../services/conversation-service";
import { errorFrame, parseClientFrame, pongFrame, readyFrame } from "./frames";
import type { MessageHub, RealtimeClient } from "./hub";

/**
 * Bun WebSocket support.
 *
 * `createBunWebSocket` is Hono's Bun adapter: the upgrade is performed by the
 * route through `server.upgrade(...)`, which Bun exposes as the second
 * argument of `fetch`. `index.ts` therefore serves `app.fetch` and passes
 * `websocket` to `Bun.serve`.
 */
export const { upgradeWebSocket, websocket } = createBunWebSocket();

const openState = 1;

export function createRealtimeRoutes(
  hub: MessageHub,
  conversations: ConversationService,
) {
  const routes = new Hono();

  routes.get(
    "/conversations/:id/events",
    (c, next) => {
      const conversationId = c.req.param("id");

      if (!conversations.exists(conversationId)) {
        return c.json({ error: `Unknown conversation: ${conversationId}` }, 404);
      }

      return next();
    },
    upgradeWebSocket((c) => {
      const conversationId = c.req.param("id") ?? "";
      let client: RealtimeClient | null = null;

      function release() {
        if (client) {
          hub.unsubscribe(client);
          client = null;
        }
      }

      return {
        onOpen(_event, ws) {
          client = {
            id: crypto.randomUUID(),
            conversationId,
            send(payload) {
              if (ws.readyState === openState) {
                ws.send(payload);
              }
            },
          };

          hub.subscribe(client);

          // The client uses this frame to know the subscription is live, so a
          // message committed immediately after connecting cannot be missed.
          ws.send(readyFrame(conversationId));
        },

        onMessage(event, ws) {
          const raw = typeof event.data === "string" ? event.data : "";
          const frame = parseClientFrame(raw);

          if (frame.type === "ping") {
            ws.send(pongFrame());
            return;
          }

          ws.send(errorFrame(frame.error));
        },

        onClose() {
          release();
        },

        onError() {
          release();
        },
      };
    }),
  );

  return routes;
}
