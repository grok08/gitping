import { Hono } from "hono";
import type { CommandService } from "../services/command-service";
import type { CommandRequest } from "../types/http";

export function createCommandRoutes(commands: CommandService) {
  const routes = new Hono();

  routes.post("/commands", async (c) => {
    let body: CommandRequest;

    try {
      body = await c.req.json<CommandRequest>();
    } catch {
      return c.json({ error: "Invalid JSON request body" }, 400);
    }

    const input = body.input?.trim() ?? "";
    const author = body.author?.trim() || "grok08";

    if (!input) {
      return c.json({ error: "Command is required" }, 400);
    }

    const result = commands.send(input, author);

    if (!result.ok) {
      return c.json({ error: result.error }, 400);
    }

    return c.json({ message: result.message }, 201);
  });

  return routes;
}
