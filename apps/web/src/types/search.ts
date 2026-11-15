import type { ConversationKind } from "./conversation";

export type SearchFilters = {
  author: string | null;
  command: string | null;
  branch: string | null;
  after: string | null;
  before: string | null;
};

export type ParsedSearchQuery = {
  text: string;
  terms: string[];
  filters: SearchFilters;
};

export type SearchConversationHit = {
  id: string;
  name: string;
  kind: ConversationKind;
  memberCount: number;
  preview: string | null;
};

export type SearchUserHit = {
  id: string;
  handle: string;
  displayName: string;
  avatar: string;
  role: "owner" | "developer";
};

export type SearchBranchHit = {
  id: string;
  name: string;
  conversationId: string;
  conversationName: string;
  conversationKind: ConversationKind;
  current: boolean;
};

export type SearchMessageHit = {
  id: string;
  seq: number;
  text: string;
  snippet: string;
  author: string;
  command: string;
  createdAt: string;
  reverted: boolean;
  stashed: boolean;
  branch: { id: string; name: string };
  conversation: { id: string; name: string; kind: ConversationKind };
};

export type WorkspaceSearchResults = {
  query: ParsedSearchQuery;
  groups: {
    conversations: SearchConversationHit[];
    users: SearchUserHit[];
    branches: SearchBranchHit[];
    messages: SearchMessageHit[];
  };
  totals: {
    conversations: number;
    users: number;
    branches: number;
    messages: number;
  };
  truncated: {
    conversations: boolean;
    users: boolean;
    branches: boolean;
    messages: boolean;
  };
};

export type ConversationSearchResults = {
  query: ParsedSearchQuery;
  messages: SearchMessageHit[];
  total: number;
  truncated: boolean;
};
