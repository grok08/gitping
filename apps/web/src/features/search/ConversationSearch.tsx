import { Search, X } from "lucide-react";
import type { RefObject } from "react";

type ChatSearchBarProps = {
  conversationName: string;
  query: string;
  resultCount: number;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onClose: () => void;
};

export function ConversationSearch({
  conversationName,
  query,
  resultCount,
  inputRef,
  onChange,
  onClose,
}: ChatSearchBarProps) {
  return (
    <div className="chat-search-bar">
      <div className="chat-search-inner">
        <Search size={15} />

        <input
          ref={inputRef}
          value={query}
          onChange={(event) => onChange(event.target.value)}
          placeholder={`Search in #${conversationName}`}
        />

        {query && (
          <span className="chat-search-count">
            {resultCount} {resultCount === 1 ? "result" : "results"}
          </span>
        )}

        <button type="button" onClick={onClose} aria-label="Close conversation search">
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
