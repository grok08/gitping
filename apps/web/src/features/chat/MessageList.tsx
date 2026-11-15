import type { RefObject } from "react";
import type { Message } from "../../types/message";
import { MessageItem } from "./MessageItem";

type MessageListProps = {
  messages: Message[];
  loading: boolean;
  searching: boolean;
  listRef: RefObject<HTMLElement | null>;
  onCopyCommand: (command: string) => void;
};

export function MessageList({
  messages,
  loading,
  searching,
  listRef,
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
      </div>
    </section>
  );
}
