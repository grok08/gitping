import { Hono } from "hono";
import { currentUserHandle } from "../current-user";
import { checkRequestId, requestIdError } from "./request-id";
import { sendCommandResponse } from "./command-response";
import { sendSearchResponse } from "./search";
import type { CommandService } from "../services/command-service";
import type { ConversationService } from "../services/conversation-service";
import type { SearchService } from "../services/search-service";
import type {
  ConversationCommandRequest,
  CreateConversationRequest,
} from "../types/http";

export function createConversationRoutes(
  conversations: ConversationService,
  commands: CommandService,
  search: SearchService,
) {
  const routes = new Hono();

  routes.get("/conversations", (c) =>
    c.json(conversations.list(currentUserHandle)),
  );

  routes.post("/conversations", async (c) => {
    let body: CreateConversationRequest;

    try {
      body = await c.req.json<CreateConversationRequest>();
    } catch {
      return c.json({ error: "Invalid JSON request body" }, 400);
    }

    const result = conversations.create(
      {
        name: body.name ?? "",
        kind: body.kind ?? "",
      },
      currentUserHandle,
    );

    if (!result.ok) {
      return c.json({ error: result.error }, 400);
    }

    return c.json({ conversation: result.value }, 201);
  });

  routes.get("/conversations/:id/messages", (c) => {
    const result = conversations.messages(c.req.param("id"));

    if (!result.ok) {
      return c.json({ error: result.error }, 404);
    }

    return c.json(result.value);
  });

  routes.post("/conversations/:id/commands", async (c) => {
    let body: ConversationCommandRequest;

    try {
      body = await c.req.json<ConversationCommandRequest>();
    } catch {
      return c.json({ error: "Invalid JSON request body" }, 400);
    }

    const input = body.input?.trim() ?? "";

    if (!input) {
      return c.json({ error: "Command is required" }, 400);
    }

    const requestId = checkRequestId(body.requestId);

    if (!requestId.ok) {
      return c.json({ error: requestIdError }, 400);
    }

    const result = commands.send(input, currentUserHandle, {
      conversationId: c.req.param("id"),
      branch: body.branch,
      requestId: requestId.requestId,
    });

    return sendCommandResponse(c, result);
  });

  routes.get("/conversations/:id/members", (c) => {
    const result = conversations.members(c.req.param("id"));

    if (!result.ok) {
      return c.json({ error: result.error }, 404);
    }

    return c.json(result.value);
  });

  routes.get("/conversations/:id/branches", (c) => {
    const result = conversations.branches(c.req.param("id"), currentUserHandle);

    if (!result.ok) {
      return c.json({ error: result.error }, 404);
    }

    return c.json(result.value);
  });

  routes.get("/conversations/:id/stashes", (c) => {
    const result = conversations.stashes(c.req.param("id"), currentUserHandle);

    if (!result.ok) {
      return c.json({ error: result.error }, 404);
    }

    return c.json(result.value);
  });

  routes.get("/conversations/:id/search", (c) =>
    sendSearchResponse(
      c,
      search.conversation(
        c.req.param("id"),
        c.req.query("q"),
        c.req.query("limit"),
      ),
    ),
  );

  return routes;
}
