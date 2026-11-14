import { X } from "lucide-react";
import type { ReactNode, TransitionEvent } from "react";

type SidePanelProps = {
  title: string;
  subtitle: string;
  closeLabel: string;
  closing: boolean;
  className?: string;
  onClose: () => void;
  onClosed: () => void;
  children: ReactNode;
};

export function SidePanel({
  title,
  subtitle,
  closeLabel,
  closing,
  className = "",
  onClose,
  onClosed,
  children,
}: SidePanelProps) {
  function handleTransitionEnd(event: TransitionEvent<HTMLElement>) {
    if (
      closing &&
      event.target === event.currentTarget &&
      event.propertyName === "opacity"
    ) {
      onClosed();
    }
  }

  return (
    <aside
      className={`side-panel ${className} ${closing ? "is-closing" : ""}`
        .replace(/\s+/g, " ")
        .trim()}
      onTransitionEnd={handleTransitionEnd}
    >
      <div className="side-panel-header">
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>

        <button type="button" onClick={onClose} aria-label={closeLabel}>
          <X size={17} />
        </button>
      </div>

      <div className="side-panel-content">{children}</div>
    </aside>
  );
}
