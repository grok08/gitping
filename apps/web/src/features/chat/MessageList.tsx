import { X } from "lucide-react";
import type { RefObject } from "react";
import type { Message } from "../../types/message";
import { MessageItem } from "./MessageItem";

type MessageListProps = {
  messages: Message[];
  loading: boolean;
  searching: boolean;
  error: string;
  listRef: RefObject<HTMLElement | null>;
  onDismissError: () => void;
  onCopyCommand: (command: string) => void;
};

export function MessageList({
  messages,
  loading,
  searching,
  error,
  listRef,
  onDismissError,
  onCopyCommand,
}: MessageListProps) {
  return (
    <section className="message-list" ref={listRef}>
      <div className="message-content">
        <div className="message-day">TODAY</div>

        {loading ? (
          <div className="empty-state">Loading messages…</div>
        ) : messages.length === 0 ? (
          <div className="empty-state">
            {searching ? "No messages match your search." : "No messages yet."}
          </div>
        ) : (
          messages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              onCopyCommand={onCopyCommand}
            />
          ))
        )}

        {error && (
          <div className="command-error">
            <span>{error}</span>

            <button
              type="button"
              onClick={onDismissError}
              aria-label="Dismiss error"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
