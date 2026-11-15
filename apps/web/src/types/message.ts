export type Message = {
  seq: number;
  id: string;
  author: string;
  avatar: string;
  text: string;
  command: string;
  time: string;
  mine?: boolean;
};

export type ApiMessage = {
  seq: number;
  id: string;
  author: string;
  text: string;
  command: string;
  created_at: string;
};

export type CreatedMessage = {
  seq: number;
  id: string;
  author: string;
  text: string;
  command: string;
  createdAt: string;
};

/**
 * One `message.created` frame. The server sends this only after SQLite has
 * committed the row, so every field is authoritative.
 */
export type MessageEventPayload = {
  type: "message.created";
  conversationId: string;
  seq: number;
  message: CreatedMessage;
};
