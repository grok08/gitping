export const heartbeatIntervalMs = 25_000;
export const heartbeatTimeoutMs = 10_000;

type HeartbeatOptions = {
  intervalMs?: number;
  timeoutMs?: number;
  onPing: () => void;
  onTimeout: () => void;
};

export type Heartbeat = {
  start: () => void;
  noteActivity: () => void;
  stop: () => void;
};

/**
 * Liveness watchdog. A socket that never reports a close is the case the
 * browser cannot detect on its own: a laptop that slept, or a proxy that
 * dropped the flow, leaves a socket that looks open and delivers nothing.
 *
 * Every interval the client pings; any inbound frame counts as a sign of life
 * and clears the deadline. If the deadline passes, the caller closes the
 * socket, which turns a silent stall into the normal reconnect path.
 */
export function createHeartbeat({
  intervalMs = heartbeatIntervalMs,
  timeoutMs = heartbeatTimeoutMs,
  onPing,
  onTimeout,
}: HeartbeatOptions): Heartbeat {
  let interval: ReturnType<typeof setInterval> | null = null;
  let deadline: ReturnType<typeof setTimeout> | null = null;

  function clearDeadline() {
    if (deadline !== null) {
      clearTimeout(deadline);
      deadline = null;
    }
  }

  function stop() {
    if (interval !== null) {
      clearInterval(interval);
      interval = null;
    }

    clearDeadline();
  }

  function start() {
    stop();

    interval = setInterval(() => {
      // A ping is already outstanding: leaving the deadline alone is what
      // turns silence into a timeout instead of pushing it forward forever.
      if (deadline !== null) {
        return;
      }

      onPing();

      deadline = setTimeout(() => {
        deadline = null;
        onTimeout();
      }, timeoutMs);
    }, intervalMs);
  }

  return {
    start,
    stop,
    noteActivity: clearDeadline,
  };
}
