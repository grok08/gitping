import { Moon, Sun, X } from "lucide-react";
import type { TransitionEvent } from "react";
import type { Theme } from "../../types/workspace";

export type WorkspaceModalKind = "channel" | "direct" | "settings";

type WorkspaceModalProps = {
  kind: WorkspaceModalKind;
  closing: boolean;
  theme: Theme;
  name: string;
  onNameChange: (value: string) => void;
  onCreate: () => void;
  onToggleTheme: () => void;
  onClose: () => void;
  onClosed: () => void;
};

const headings: Record<WorkspaceModalKind, { title: string; subtitle: string }> =
  {
    channel: {
      title: "Create channel",
      subtitle: "Create a new Git conversation",
    },
    direct: {
      title: "New direct message",
      subtitle: "Start talking to a developer",
    },
    settings: {
      title: "Settings",
      subtitle: "GitPing preferences",
    },
  };

export function WorkspaceModal({
  kind,
  closing,
  theme,
  name,
  onNameChange,
  onCreate,
  onToggleTheme,
  onClose,
  onClosed,
}: WorkspaceModalProps) {
  function handleTransitionEnd(event: TransitionEvent<HTMLDivElement>) {
    if (
      closing &&
      event.target === event.currentTarget &&
      event.propertyName === "opacity"
    ) {
      onClosed();
    }
  }

  return (
    <div
      className={`modal-backdrop ${closing ? "is-closing" : ""}`.trim()}
      onMouseDown={onClose}
      onTransitionEnd={handleTransitionEnd}
    >
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <strong>{headings[kind].title}</strong>
            <span>{headings[kind].subtitle}</span>
          </div>

          <button type="button" onClick={onClose} aria-label="Close">
            <X size={17} />
          </button>
        </div>

        {kind === "settings" ? (
          <div className="settings-content">
            <div className="setting-row">
              <div>
                <strong>Theme</strong>
                <span>Switch between light and dark mode</span>
              </div>

              <button
                className="setting-control"
                type="button"
                onClick={onToggleTheme}
              >
                {theme === "dark" ? (
                  <>
                    <Sun size={14} />
                    Light
                  </>
                ) : (
                  <>
                    <Moon size={14} />
                    Dark
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <form
            className="modal-form"
            onSubmit={(event) => {
              event.preventDefault();
              onCreate();
            }}
          >
            <label htmlFor="conversation-name">
              {kind === "channel" ? "Channel name" : "GitHub username"}
            </label>

            <input
              id="conversation-name"
              autoFocus
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder={kind === "channel" ? "e.g. architecture" : "e.g. alice"}
            />

            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={onClose}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="primary-button"
                disabled={!name.trim()}
              >
                {kind === "channel" ? "Create channel" : "Start conversation"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
