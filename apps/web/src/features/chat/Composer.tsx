import { ArrowUp } from "lucide-react";
import type { FormEvent, RefObject } from "react";

type ComposerProps = {
  value: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function Composer({
  value,
  inputRef,
  onChange,
  onSubmit,
}: ComposerProps) {
  return (
    <footer className="composer-tray">
      <div className="composer-content">
        <form className="composer" onSubmit={onSubmit}>
          <span className="composer-prompt">$</span>

          <input
            ref={inputRef}
            autoFocus
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder='git commit -m "message"'
            spellCheck={false}
          />

          <button
            className="send-button"
            disabled={!value.trim()}
            type="submit"
            aria-label="Send command"
            title="Send command"
          >
            <ArrowUp size={17} />
          </button>
        </form>

        <div className="composer-help">
          <span>
            Communicate with <strong>Git commands</strong>
          </span>

          <span>Enter to send</span>
        </div>
      </div>
    </footer>
  );
}
