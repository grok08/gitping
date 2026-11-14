import { Copy } from "lucide-react";
import { Avatar } from "../../components/ui/Avatar";
import type { Message } from "../../types/message";

type MessageItemProps = {
  message: Message;
  onCopyCommand: (command: string) => void;
};

export function MessageItem({ message, onCopyCommand }: MessageItemProps) {
  return (
    <article className="message-row">
      <Avatar label={message.avatar} mine={message.mine} />

      <div className="message-body">
        <div className="message-header">
          <span className="message-author">{message.author}</span>

          <span className="message-time">{message.time}</span>
        </div>

        <div className="message-text">{message.text}</div>

        <div className="message-command">
          <span aria-hidden="true">$</span>
          <code>{message.command}</code>
          <button
            className="message-copy"
            type="button"
            onClick={() => onCopyCommand(message.command)}
            aria-label="Copy Git command"
            title="Copy Git command"
          >
            <Copy size={13} />
          </button>
        </div>

        <div className="message-footer">
          <span className="commit-pill">commit</span>

          <span className="commit-id">{message.id.slice(0, 8)}</span>
        </div>
      </div>
    </article>
  );
}
