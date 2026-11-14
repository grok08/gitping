import { Hono } from "hono";
import type { Database } from "bun:sqlite";

export function createHealthRoutes(db: Database) {
  const routes = new Hono();

  routes.get("/health", (c) => {
    const result = db.query("SELECT 1 AS ok").get() as { ok: number } | null;

    return c.json({
      status: "ok",
      database: result?.ok === 1,
    });
  });

  return routes;
}
