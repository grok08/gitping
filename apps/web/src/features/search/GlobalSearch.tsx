import { Search, X } from "lucide-react";
import type { RefObject } from "react";

type GlobalSearchProps = {
  value: string;
  onChange: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
};

export function GlobalSearch({
  value,
  onChange,
  inputRef,
}: GlobalSearchProps) {
  return (
    <div className="search-box">
      <Search size={15} />

      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search conversations"
      />

      {value ? (
        <button
          className="search-clear"
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
        >
          <X size={14} />
        </button>
      ) : (
        <kbd>
          {navigator.platform.toLowerCase().includes("mac") ? "⌘ K" : "Ctrl K"}
        </kbd>
      )}
    </div>
  );
}
