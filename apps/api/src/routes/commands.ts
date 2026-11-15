import { Hono } from "hono";
import { currentUserHandle } from "../current-user";
import { checkRequestId, requestIdError } from "./request-id";
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
    const author = body.author?.trim() || currentUserHandle;

    if (!input) {
      return c.json({ error: "Command is required" }, 400);
    }

    const requestId = checkRequestId(body.requestId);

    if (!requestId.ok) {
      return c.json({ error: requestIdError }, 400);
    }

    const result = commands.send(input, author, {
      conversation: body.conversation,
      branch: body.branch,
      requestId: requestId.requestId,
    });

    if (!result.ok) {
      const status = result.reason === "request_conflict" ? 409 : 400;

      return c.json({ error: result.error }, status);
    }

    if (result.replayed) {
      c.header("Idempotent-Replay", "true");
    }

    return c.json({ message: result.message }, 201);
  });

  return routes;
}
