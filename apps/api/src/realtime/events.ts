import type { MessageRecord } from "../types/http";

/**
 * A message that is already committed to SQLite.
 *
 * The event carries the same message shape the HTTP API returns, plus the
 * conversation id and `seq` so a client can place the message without
 * relying on arrival order.
 */
export type MessageCreatedEvent = {
  type: "message.created";
  conversationId: string;
  seq: number;
  message: MessageRecord;
};

/**
 * A committed message whose derived state changed in place, such as a revert
 * or a stash. The client merges it by id, so the row is replaced rather than
 * duplicated, and `seq` keeps its place in commit order.
 */
export type MessageUpdatedEvent = {
  type: "message.updated";
  conversationId: string;
  seq: number;
  message: MessageRecord;
};

export type RealtimeEvent = MessageCreatedEvent | MessageUpdatedEvent;

export type RealtimePublisher = {
  publish: (event: RealtimeEvent) => void;
};

export const noopPublisher: RealtimePublisher = {
  publish() {
    // Used by callers that only need persistence, such as isolated HTTP tests.
  },
};
