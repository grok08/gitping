export type Conversation = {
  id: string;
  name: string;
  type: "channel" | "direct";
  unread?: number;
  members?: number;
  preview?: string;
};
