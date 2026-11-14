import { Hash } from "lucide-react";
import type { Conversation } from "../../types/conversation";

type ConversationItemProps = {
  conversation: Conversation;
  selected: boolean;
  onSelect: (id: string) => void;
};

export function ConversationItem({
  conversation,
  selected,
  onSelect,
}: ConversationItemProps) {
  const fallbackPreview =
    conversation.type === "channel" ? "No messages yet" : "Start a conversation";

  return (
    <button
      className={`conversation-item ${selected ? "selected" : ""}`.trim()}
      type="button"
      onClick={() => onSelect(conversation.id)}
    >
      {conversation.type === "channel" ? (
        <Hash size={15} />
      ) : (
        <span className="conversation-avatar">
          {conversation.name.charAt(0).toUpperCase()}
        </span>
      )}

      <span className="conversation-details">
        <span className="conversation-name">{conversation.name}</span>
        <span className="conversation-preview">
          {conversation.preview || fallbackPreview}
        </span>
      </span>

      {conversation.unread ? (
        <span className="unread-count">{conversation.unread}</span>
      ) : null}
    </button>
  );
}
