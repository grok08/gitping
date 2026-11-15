import { Hono } from "hono";
import type { Context } from "hono";
import { currentUserHandle } from "../current-user";
import type { SearchResult, SearchService } from "../services/search-service";

/**
 * Both search routes answer the same way, so a rejection reads the same whether
 * the query was malformed or the conversation was missing.
 */
export function sendSearchResponse<T>(c: Context, result: SearchResult<T>) {
  if (!result.ok) {
    return c.json({ error: result.error }, result.status);
  }

  return c.json(result.value);
}

export function createSearchRoutes(search: SearchService) {
  const routes = new Hono();

  routes.get("/search", (c) =>
    sendSearchResponse(
      c,
      search.all(currentUserHandle, c.req.query("q"), c.req.query("limit")),
    ),
  );

  return routes;
}
