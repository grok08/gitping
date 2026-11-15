import type { Database } from "bun:sqlite";
import { createApp } from "./app";
import { createMessageHub } from "./realtime/hub";
import { websocket } from "./realtime/websocket";

/**
 * Builds everything one API process needs: the Hono app, the in-process
 * connection hub, and the Bun WebSocket handler that `Bun.serve` needs.
 */
export function createServer(db: Database) {
  const hub = createMessageHub();

  return {
    app: createApp(db, hub),
    hub,
    websocket,
  };
}
