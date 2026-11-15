import type { ConversationKind, UserRole } from "./domain";

export type MessageRow = {
  seq: number;
  id: string;
  author: string;
  text: string;
  command: string;
  created_at: string;
};

export type MessageRecord = {
  seq: number;
  id: string;
  author: string;
  text: string;
  command: string;
  createdAt: string;
};

export type CommandRequest = {
  input?: string;
  author?: string;
  conversation?: string;
  branch?: string;
  requestId?: string;
};

export type CommandResponse = {
  message: MessageRecord;
};

export type ErrorResponse = {
  error: string;
};

export type ConversationSummary = {
  id: string;
  name: string;
  kind: ConversationKind;
  memberCount: number;
  preview: string | null;
  unreadCount: number;
};

export type ConversationMemberRecord = {
  id: string;
  handle: string;
  displayName: string;
  avatar: string;
  role: UserRole;
};

export type BranchSummary = {
  id: string;
  name: string;
  headMessageId: string | null;
};

export type CreateConversationRequest = {
  name?: string;
  kind?: string;
};

export type ConversationCommandRequest = {
  input?: string;
  branch?: string;
  requestId?: string;
};

export type CreateConversationResponse = {
  conversation: ConversationSummary;
};
