import { createBunWebSocket } from "hono/bun";
import { Hono } from "hono";
import { isAllowedOrigin } from "../allowed-origins";
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

/**
 * A client that cannot drain its socket would otherwise grow Bun's buffer
 * without limit. Past this point it is cheaper to drop the connection: the
 * browser reconnects and catches up from persisted history.
 */
const maxBufferedBytes = 1024 * 1024;

export function createRealtimeRoutes(
  hub: MessageHub,
  conversations: ConversationService,
) {
  const routes = new Hono();

  routes.get(
    "/conversations/:id/events",
    (c, next) => {
      // CORS does not apply to WebSocket upgrades, so the allowlist has to be
      // enforced here or any web page could read a conversation stream.
      if (!isAllowedOrigin(c.req.header("origin"))) {
        return c.json({ error: "Origin not allowed" }, 403);
      }

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
          const raw = ws.raw as
            | { getBufferedAmount?: () => number }
            | undefined;

          client = {
            id: crypto.randomUUID(),
            conversationId,

            send(payload) {
              if (ws.readyState === openState) {
                ws.send(payload);
              }
            },

            overloaded() {
              return (raw?.getBufferedAmount?.() ?? 0) > maxBufferedBytes;
            },

            close(code, reason) {
              ws.close(code, reason);
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
