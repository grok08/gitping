import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Database } from "bun:sqlite";
import { allowedOrigins } from "./allowed-origins";
import { createMessageHub } from "./realtime/hub";
import type { MessageHub } from "./realtime/hub";
import { createRealtimeRoutes } from "./realtime/websocket";
import { createBranchRepository } from "./repositories/branch-repository";
import { createConversationRepository } from "./repositories/conversation-repository";
import { createMessageRepository } from "./repositories/message-repository";
import { createUserRepository } from "./repositories/user-repository";
import { createCommandService } from "./services/command-service";
import { createConversationService } from "./services/conversation-service";
import { createCommandRoutes } from "./routes/commands";
import { createConversationRoutes } from "./routes/conversations";
import { createHealthRoutes } from "./routes/health";
import { createMessageRoutes } from "./routes/messages";

export function createApp(
  db: Database,
  hub: MessageHub = createMessageHub(),
): Hono {
  const users = createUserRepository(db);
  const conversations = createConversationRepository(db);
  const branches = createBranchRepository(db);
  const messages = createMessageRepository(db);

  const commands = createCommandService({
    db,
    users,
    conversations,
    branches,
    messages,
    events: hub,
  });

  const conversationService = createConversationService({
    db,
    users,
    conversations,
    branches,
    messages,
  });

  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: allowedOrigins,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    }),
  );

  app.route("/", createHealthRoutes(db));
  app.route("/", createMessageRoutes(messages));
  app.route("/", createCommandRoutes(commands));
  app.route("/", createConversationRoutes(conversationService, commands));
  app.route("/", createRealtimeRoutes(hub, conversationService));

  return app;
}
