export type Message = {
  seq: number;
  id: string;
  author: string;
  avatar: string;
  text: string;
  command: string;
  time: string;
  mine?: boolean;
  /** State derived by the server from the message's events. */
  reverted: boolean;
  stashed: boolean;
};

export type ApiMessage = {
  seq: number;
  id: string;
  author: string;
  text: string;
  command: string;
  created_at: string;
  reverted: boolean;
  stashed: boolean;
};

export type CreatedMessage = {
  seq: number;
  id: string;
  author: string;
  text: string;
  command: string;
  createdAt: string;
  reverted: boolean;
  stashed: boolean;
};

/**
 * A frame that carries one committed message. `created` announces a new row,
 * `updated` replaces a row whose derived state changed, such as a revert or a
 * stash. The server sends either only after SQLite has committed it, so every
 * field is authoritative.
 */
export type MessageEventPayload = {
  type: "message.created" | "message.updated";
  conversationId: string;
  seq: number;
  message: CreatedMessage;
};
