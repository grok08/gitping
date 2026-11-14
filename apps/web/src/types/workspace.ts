export type Theme = "light" | "dark";

export type WorkspaceMember = {
  name: string;
  role: string;
  avatar: string;
  online: boolean;
};

export type ActiveMenu = "branch" | "more" | "profile" | null;

export type ActivePanel =
  | "notifications"
  | "workspace-members"
  | "conversation-members"
  | null;

export type ModalKind = "channel" | "direct" | "settings" | null;
