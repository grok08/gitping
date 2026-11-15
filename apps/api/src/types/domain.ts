export type UserRole = "owner" | "developer";

export type ConversationKind = "channel" | "direct";

export type MessageEventType = "created" | "reverted" | "stashed" | "merged";

export type User = {
  id: string;
  handle: string;
  displayName: string;
  avatar: string;
  role: UserRole;
  createdAt: string;
};

export type Conversation = {
  id: string;
  name: string;
  kind: ConversationKind;
  createdBy: string;
  createdAt: string;
};

export type ConversationMember = {
  conversationId: string;
  userId: string;
  joinedAt: string;
  lastReadAt: string | null;
};

export type Branch = {
  id: string;
  conversationId: string;
  name: string;
  headMessageId: string | null;
  createdFromBranchId: string | null;
  createdAt: string;
};

export type Message = {
  seq: number;
  id: string;
  conversationId: string;
  branchId: string;
  authorId: string;
  text: string;
  createdAt: string;
};

export type GitCommandRecord = {
  id: string;
  messageId: string;
  verb: string;
  raw: string;
  args: string;
  parsedAt: string;
};

export type MessageEvent = {
  id: string;
  messageId: string;
  type: MessageEventType;
  payload: string | null;
  createdAt: string;
};

/**
 * One row per client-named command. It is the mapping from the id a client
 * chose for one intent to the message that intent produced, so a retry after a
 * lost response resolves to the existing row instead of writing a second one.
 */
export type CommandRequestRecord = {
  id: string;
  conversationId: string;
  messageId: string;
  authorId: string;
  createdAt: string;
};

export type NewConversation = {
  id: string;
  name: string;
  kind: ConversationKind;
  createdBy: string;
  createdAt: string;
};

export type NewBranch = {
  id: string;
  conversationId: string;
  name: string;
  headMessageId: string | null;
  createdFromBranchId: string | null;
  createdAt: string;
};

export type NewMessage = {
  id: string;
  conversationId: string;
  branchId: string;
  authorId: string;
  text: string;
  verb: string;
  raw: string;
  args: string;
  createdAt: string;
};
