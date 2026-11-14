import { createApp } from "./app";
import { defaultDatabasePath, initializeDatabase, openDatabase } from "./db";

const port = Number(process.env.PORT ?? 3000);
const db = openDatabase(process.env.GITPING_DB_PATH ?? defaultDatabasePath());

initializeDatabase(db);

const app = createApp(db);

console.log(`GitPing API running on http://localhost:${port}`);

Bun.serve({
  port,
  fetch: app.fetch,
});
