import { defaultDatabasePath, initializeDatabase, openDatabase } from "./db";
import { createServer } from "./server";

const port = Number(process.env.PORT ?? 3000);
const db = openDatabase(process.env.GITPING_DB_PATH ?? defaultDatabasePath());

initializeDatabase(db);

const { app, hub, websocket } = createServer(db);

const server = Bun.serve({
  port,
  fetch: app.fetch,
  websocket,
});

console.log(`GitPing API running on http://localhost:${port}`);

function shutdown() {
  hub.closeAll();
  server.stop(true);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
