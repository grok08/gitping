import type { Database } from "bun:sqlite";
import { createApp } from "./app";
import { initializeDatabase, openDatabase } from "./db";
import type { RealtimeEvent, RealtimePublisher } from "./realtime/events";
import { createBranchRepository } from "./repositories/branch-repository";
import type { CommandRequestRepository } from "./repositories/command-request-repository";
import { createCommandRequestRepository } from "./repositories/command-request-repository";
import { createConversationRepository } from "./repositories/conversation-repository";
import { createMessageRepository } from "./repositories/message-repository";
import { createUserRepository } from "./repositories/user-repository";
import { createCommandService } from "./services/command-service";
import type { SendCommandResult } from "./services/command-service";
import { createConversationService } from "./services/conversation-service";
import { createServer } from "./server";
import type { MessageRecord } from "./types/http";

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

export function createTestCommandService(
  db: Database = createTestDatabase(),
  options: { requests?: CommandRequestRepository } = {},
) {
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
      requests: options.requests ?? createCommandRequestRepository(db),
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

/**
 * Narrows a command result to its message body, so a test that expects a
 * content command stays about the message rather than the whole union.
 */
export function sentMessage(result: SendCommandResult): MessageRecord {
  if (!result.ok) {
    throw new Error(`expected a message, received ${result.reason}: ${result.error}`);
  }

  if (result.kind !== "message") {
    throw new Error(`expected a message, received ${result.kind}`);
  }

  return result.message;
}
