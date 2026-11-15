import type { ConversationKind, UserRole } from "./domain";

export type MessageRow = {
  seq: number;
  id: string;
  author: string;
  text: string;
  command: string;
  created_at: string;
  reverted: boolean;
  stashed: boolean;
};

export type MessageRecord = {
  seq: number;
  id: string;
  author: string;
  text: string;
  command: string;
  createdAt: string;
  reverted: boolean;
  stashed: boolean;
};

export type CommandRequest = {
  input?: string;
  author?: string;
  conversation?: string;
  branch?: string;
  requestId?: string;
};

export type CommandResponse =
  | { message: MessageRecord }
  | { branches: BranchSummary[] }
  | { stashes: StashRecord[] };

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
  /** This member's current branch, which is what a reload restores. */
  current: boolean;
};

export type StashRecord = {
  id: string;
  text: string;
  note: string | null;
  createdAt: string;
};

export type SearchFilters = {
  author: string | null;
  command: string | null;
  branch: string | null;
  after: string | null;
  before: string | null;
};

/**
 * A query as the client asked for it. `text` is what the member typed after the
 * filters were removed, and `terms` is how it matches: one substring per term,
 * and every term has to be present.
 */
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
  role: UserRole;
};

export type SearchBranchHit = {
  id: string;
  name: string;
  conversationId: string;
  conversationName: string;
  conversationKind: ConversationKind;
  /** This viewer's current branch in that conversation. */
  current: boolean;
};

/**
 * One message result, identical on both search routes, so one client component
 * renders both surfaces.
 */
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

export type SearchTotals = {
  conversations: number;
  users: number;
  branches: number;
  messages: number;
};

export type SearchTruncation = {
  conversations: boolean;
  users: boolean;
  branches: boolean;
  messages: boolean;
};

export type WorkspaceSearchResults = {
  query: ParsedSearchQuery;
  groups: {
    conversations: SearchConversationHit[];
    users: SearchUserHit[];
    branches: SearchBranchHit[];
    messages: SearchMessageHit[];
  };
  totals: SearchTotals;
  truncated: SearchTruncation;
};

export type ConversationSearchResults = {
  query: ParsedSearchQuery;
  messages: SearchMessageHit[];
  total: number;
  truncated: boolean;
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
