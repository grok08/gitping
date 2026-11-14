import type { Database } from "bun:sqlite";
import { createApp } from "./app";
import { initializeDatabase, openDatabase } from "./db";
import { createBranchRepository } from "./repositories/branch-repository";
import { createConversationRepository } from "./repositories/conversation-repository";
import { createMessageRepository } from "./repositories/message-repository";
import { createUserRepository } from "./repositories/user-repository";
import { createCommandService } from "./services/command-service";
import { createConversationService } from "./services/conversation-service";

export function createTestDatabase(): Database {
  const db = openDatabase(":memory:");

  initializeDatabase(db);

  return db;
}

export function createTestApp(db: Database = createTestDatabase()) {
  return createApp(db);
}

export function createTestCommandService(db: Database = createTestDatabase()) {
  const messages = createMessageRepository(db);

  return {
    db,
    messages,
    commands: createCommandService({
      db,
      messages,
      users: createUserRepository(db),
      conversations: createConversationRepository(db),
      branches: createBranchRepository(db),
    }),
  };
}

export function createTestConversationService(
  db: Database = createTestDatabase(),
) {
  return {
    db,
    conversations: createConversationService({
      db,
      users: createUserRepository(db),
      conversations: createConversationRepository(db),
      branches: createBranchRepository(db),
      messages: createMessageRepository(db),
    }),
  };
}
