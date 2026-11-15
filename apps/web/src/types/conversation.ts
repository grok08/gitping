export type ConversationKind = "channel" | "direct";

export type Conversation = {
  id: string;
  name: string;
  type: ConversationKind;
  unread?: number;
  members?: number;
  preview?: string;
  /** Commit order of the message behind `preview`, so it only moves forward. */
  previewSeq?: number;
};

export type ApiConversation = {
  id: string;
  name: string;
  kind: ConversationKind;
  memberCount: number;
  preview: string | null;
  unreadCount: number;
};

export type ApiBranch = {
  id: string;
  name: string;
  headMessageId: string | null;
  /** The member's current branch, which is what a reload restores. */
  current: boolean;
};

export type ApiStash = {
  id: string;
  text: string;
  note: string | null;
  createdAt: string;
};

export type ApiMember = {
  id: string;
  handle: string;
  displayName: string;
  avatar: string;
  role: "owner" | "developer";
};
