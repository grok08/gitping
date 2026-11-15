import type { Database } from "bun:sqlite";
import { createApp } from "./app";
import { initializeDatabase, openDatabase } from "./db";
import type { RealtimeEvent, RealtimePublisher } from "./realtime/events";
import { createBranchRepository } from "./repositories/branch-repository";
import { createConversationRepository } from "./repositories/conversation-repository";
import { createMessageRepository } from "./repositories/message-repository";
import { createUserRepository } from "./repositories/user-repository";
import { createCommandService } from "./services/command-service";
import { createConversationService } from "./services/conversation-service";
import { createServer } from "./server";

export function createTestDatabase(): Database {
  const db = openDatabase(":memory:");

  initializeDatabase(db);

  return db;
}

export function createTestApp(db: Database = createTestDatabase()) {
  return createApp(db);
}

export function createTestServer(db: Database = createTestDatabase()) {
  return createServer(db);
}

export function createTestPublisher() {
  const events: RealtimeEvent[] = [];

  return {
    events,

    publish(event: RealtimeEvent) {
      events.push(event);
    },
  } satisfies RealtimePublisher & { events: RealtimeEvent[] };
}

export function createTestCommandService(db: Database = createTestDatabase()) {
  const messages = createMessageRepository(db);
  const events = createTestPublisher();

  return {
    db,
    messages,
    events,
    commands: createCommandService({
      db,
      messages,
      events,
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
