import { ArrowUp, X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, RefObject } from "react";
import { stepCommandHistory } from "../../lib/command-history";
import type { HistoryCursor } from "../../lib/command-history";
import { completeCommand, suggestCommands, validateCommand } from "../../lib/command-input";
import type { CommandContext } from "../../lib/command-input";

type ComposerProps = {
  value: string;
  inputRef: RefObject<HTMLInputElement | null>;
  context: CommandContext;
  history: readonly string[];
  /** The server's last rejection, shown ahead of the local reading. */
  error: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDismissError: () => void;
  onOpenHelp: () => void;
};

const listId = "composer-suggestions";
const hintId = "composer-hint";

function optionId(index: number): string {
  return `${listId}-option-${index}`;
}

export function Composer({
  value,
  inputRef,
  context,
  history,
  error,
  onChange,
  onSubmit,
  onDismissError,
  onOpenHelp,
}: ComposerProps) {
  const [caret, setCaret] = useState(value.length);
  const [resetKey, setResetKey] = useState(value);
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [dismissedError, setDismissedError] = useState(false);
  const [focused, setFocused] = useState(false);
  const [cursor, setCursor] = useState<HistoryCursor>({ index: null, draft: "" });
  const pendingCaret = useRef<number | null>(null);

  // A new value means a new reading: reopen the popup, restart the highlight,
  // and let a local error speak again. Adjusting state during render is the
  // React pattern for state derived from a changed prop.
  if (resetKey !== value) {
    setResetKey(value);
    setHighlight(0);
    setDismissed(false);
    setDismissedError(false);
  }

  const reading = { ...context, caret };
  const validation = validateCommand(value, reading);
  const suggestions = suggestCommands(value, reading);
  const showPopup =
    focused &&
    !dismissed &&
    suggestions.length > 0 &&
    validation.state !== "empty";
  const highlighted =
    suggestions.length > 0 ? Math.min(highlight, suggestions.length - 1) : 0;
  const hasHint = validation.hint !== "" || validation.preview !== "";
  const message = dismissedError ? "" : error || validation.message;

  useLayoutEffect(() => {
    const target = pendingCaret.current;

    if (target === null) {
      return;
    }

    pendingCaret.current = null;

    const input = inputRef.current;

    if (!input) {
      return;
    }

    const position = Math.min(target, input.value.length);

    input.focus();
    input.setSelectionRange(position, position);
    setCaret(position);
  }, [value, inputRef]);

  function resetCursor() {
    setCursor({ index: null, draft: "" });
  }

  function apply(next: string, nextCaret: number) {
    pendingCaret.current = nextCaret;
    onChange(next);
  }

  function accept(index: number) {
    const suggestion = suggestions[index];

    if (!suggestion) {
      return;
    }

    const applied = completeCommand(value, suggestion);

    resetCursor();
    setDismissed(false);
    apply(applied.value, applied.caret);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (showPopup) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlight((current) => (current + 1) % suggestions.length);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlight(
          (current) => (current - 1 + suggestions.length) % suggestions.length,
        );
        return;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        accept(highlighted);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setDismissed(true);
        return;
      }
    }

    const element = event.currentTarget;
    const atStart =
      element.selectionStart === 0 && element.selectionEnd === 0;
    const atEnd =
      element.selectionStart === value.length &&
      element.selectionEnd === value.length;

    if (event.key === "ArrowUp" && atStart && history.length > 0) {
      event.preventDefault();

      const step = stepCommandHistory(history, cursor, "older", value);

      setCursor(step.cursor);
      apply(step.value, step.value.length);
      return;
    }

    if (event.key === "ArrowDown" && atEnd && cursor.index !== null) {
      event.preventDefault();

      const step = stepCommandHistory(history, cursor, "newer", value);

      setCursor(step.cursor);
      apply(step.value, step.value.length);
    }
  }

  return (
    <footer className="composer-tray">
      <div className="composer-content">
        <div className="composer-field">
          <form className="composer" onSubmit={onSubmit}>
            <span className="composer-prompt">$</span>

            <input
              ref={inputRef}
              autoFocus
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showPopup}
              aria-controls={showPopup ? listId : undefined}
              aria-activedescendant={
                showPopup ? optionId(highlighted) : undefined
              }
              aria-describedby={hasHint ? hintId : undefined}
              value={value}
              onChange={(event) => {
                setCaret(event.currentTarget.selectionStart ?? value.length);
                resetCursor();
                onChange(event.currentTarget.value);
              }}
              onSelect={(event) =>
                setCaret(event.currentTarget.selectionStart ?? 0)
              }
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={handleKeyDown}
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

          {showPopup && (
            <ul
              className="composer-suggestions"
              id={listId}
              role="listbox"
              aria-label="Command suggestions"
            >
              {suggestions.map((suggestion, index) => (
                <li
                  key={suggestion.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === highlighted}
                  className={`composer-suggestion ${
                    index === highlighted ? "is-highlighted" : ""
                  }`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    accept(index);
                  }}
                  onMouseEnter={() => setHighlight(index)}
                >
                  <span className="composer-suggestion-index">{index + 1}</span>
                  <span className="composer-suggestion-label">
                    {suggestion.label}
                  </span>
                  <span
                    className={`composer-suggestion-detail ${
                      suggestion.current ? "is-current" : ""
                    }`}
                  >
                    {suggestion.detail}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {message && (
          <div className="command-error" role="alert">
            <span>{message}</span>

            <button
              type="button"
              onClick={() => {
                setDismissedError(true);
                onDismissError();
              }}
              aria-label="Dismiss error"
            >
              <X size={13} />
            </button>
          </div>
        )}

        {hasHint && (
          <div className="composer-hint" id={hintId}>
            <span className="composer-hint-text">{validation.hint}</span>

            {validation.preview && (
              <span className="composer-preview">{validation.preview}</span>
            )}
          </div>
        )}

        <div className="composer-help">
          <span>
            Communicate with <strong>Git commands</strong>
          </span>

          <div className="composer-help-actions">
            <span>Enter to send</span>

            <button
              className="composer-help-button"
              type="button"
              onClick={onOpenHelp}
              aria-label="Command help"
              title="Command help"
            >
              ?
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
