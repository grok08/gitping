import { Hono } from "hono";
import type { MessageRepository } from "../repositories/message-repository";

export function createMessageRoutes(messages: MessageRepository) {
  const routes = new Hono();

  routes.get("/messages", (c) => c.json(messages.list()));

  return routes;
}
