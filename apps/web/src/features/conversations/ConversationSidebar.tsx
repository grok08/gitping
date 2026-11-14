import { Plus } from "lucide-react";
import { useMemo } from "react";
import type { RefObject } from "react";
import { GlobalSearch } from "../search/GlobalSearch";
import type { Conversation } from "../../types/conversation";
import { ConversationItem } from "./ConversationItem";

type ConversationSidebarProps = {
  conversations: Conversation[];
  activeConversationId: string;
  search: string;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onSearchChange: (value: string) => void;
  onSelect: (id: string) => void;
  onNewChannel: () => void;
  onNewDirect: () => void;
};

export function ConversationSidebar({
  conversations,
  activeConversationId,
  search,
  searchInputRef,
  onSearchChange,
  onSelect,
  onNewChannel,
  onNewDirect,
}: ConversationSidebarProps) {
  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return conversations;
    }

    return conversations.filter(
      (conversation) =>
        conversation.name.toLowerCase().includes(query) ||
        conversation.preview?.toLowerCase().includes(query),
    );
  }, [conversations, search]);

  const channels = filteredConversations.filter(
    (conversation) => conversation.type === "channel",
  );
  const directMessages = filteredConversations.filter(
    (conversation) => conversation.type === "direct",
  );

  return (
    <aside className="conversation-sidebar">
      <div className="workspace-header">
        <div>
          <div className="workspace-name">GitPing</div>
          <div className="workspace-subtitle">Engineering workspace</div>
        </div>

        <button
          className="icon-button"
          type="button"
          onClick={onNewChannel}
          aria-label="New channel"
          title="New channel"
        >
          <Plus size={17} />
        </button>
      </div>

      <GlobalSearch
        value={search}
        onChange={onSearchChange}
        inputRef={searchInputRef}
      />

      <div className="conversation-scroll">
        <section className="conversation-section">
          <div className="section-header">
            <span>CHANNELS</span>

            <button type="button" onClick={onNewChannel} aria-label="Add channel">
              <Plus size={14} />
            </button>
          </div>

          {channels.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              selected={activeConversationId === conversation.id}
              onSelect={onSelect}
            />
          ))}
        </section>

        <section className="conversation-section">
          <div className="section-header">
            <span>DIRECT MESSAGES</span>

            <button
              type="button"
              onClick={onNewDirect}
              aria-label="New direct message"
            >
              <Plus size={14} />
            </button>
          </div>

          {directMessages.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              selected={activeConversationId === conversation.id}
              onSelect={onSelect}
            />
          ))}
        </section>
      </div>
    </aside>
  );
}
