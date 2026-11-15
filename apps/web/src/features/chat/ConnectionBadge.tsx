import type { ConnectionStatus } from "../../hooks/useConversationSocket";

const labels: Record<ConnectionStatus, string> = {
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
  offline: "Offline",
};

const descriptions: Record<ConnectionStatus, string> = {
  connecting: "Connecting to real-time delivery",
  live: "Real-time delivery is connected",
  reconnecting: "Real-time delivery is reconnecting",
  offline: "Offline: commands still send over HTTP",
};

export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  return (
    <span
      className={`connection-badge connection-${status}`}
      data-connection={status}
      role="status"
      aria-live="polite"
      title={descriptions[status]}
    >
      <span className="connection-dot" aria-hidden="true" />
      <span className="connection-label">{labels[status]}</span>
    </span>
  );
}
