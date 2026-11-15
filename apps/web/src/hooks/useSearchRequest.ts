import { useEffect, useRef, useState } from "react";

export type SearchRequestState<T> = {
  status: "idle" | "loading" | "ready" | "error";
  results: T | null;
  error: string;
};

const idleState = {
  status: "idle",
  results: null,
  error: "",
} as const;

const debounceMs = 150;

/**
 * One request per settled query. Every keystroke cancels the previous request,
 * so a slow answer for an old query can never replace a newer one, and an empty
 * query never reaches the network.
 */
export function useSearchRequest<T>(
  query: string,
  enabled: boolean,
  run: (query: string, signal: AbortSignal) => Promise<T>,
): SearchRequestState<T> {
  const [state, setState] = useState<SearchRequestState<T>>(idleState);
  const runRef = useRef(run);

  useEffect(() => {
    runRef.current = run;
  });

  useEffect(() => {
    const trimmed = query.trim();

    if (!enabled || !trimmed) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState((current) => ({
        status: "loading",
        results: current.results,
        error: "",
      }));

      runRef
        .current(trimmed, controller.signal)
        .then((results) => {
          if (controller.signal.aborted) {
            return;
          }

          setState({ status: "ready", results, error: "" });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            return;
          }

          setState((current) => ({
            status: "error",
            results: current.results,
            error: error instanceof Error ? error.message : "Search failed",
          }));
        });
    }, debounceMs);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, enabled]);

  if (!enabled || query.trim() === "") {
    return idleState;
  }

  return state;
}
