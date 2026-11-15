import { useEffect, useRef } from "react";

export type ShortcutHandlers = {
  openSearchPalette: () => void;
  dismissOverlays: () => void;
};

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const latestHandlers = useRef(handlers);

  useEffect(() => {
    latestHandlers.current = handlers;
  });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();

      if ((event.ctrlKey || event.metaKey) && key === "k") {
        event.preventDefault();
        latestHandlers.current.openSearchPalette();
        return;
      }

      if (event.key === "Escape") {
        latestHandlers.current.dismissOverlays();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
}
