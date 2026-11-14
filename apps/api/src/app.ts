import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Database } from "bun:sqlite";
import { createBranchRepository } from "./repositories/branch-repository";
import { createConversationRepository } from "./repositories/conversation-repository";
import { createMessageRepository } from "./repositories/message-repository";
import { createUserRepository } from "./repositories/user-repository";
import { createCommandService } from "./services/command-service";
import { createCommandRoutes } from "./routes/commands";
import { createHealthRoutes } from "./routes/health";
import { createMessageRoutes } from "./routes/messages";

const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

export function createApp(db: Database) {
  const messages = createMessageRepository(db);
  const commands = createCommandService({
    db,
    messages,
    users: createUserRepository(db),
    conversations: createConversationRepository(db),
    branches: createBranchRepository(db),
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

  return app;
}
