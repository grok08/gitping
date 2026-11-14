import { useEffect, useState } from "react";

export function useSidebar() {
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const compactViewport = window.matchMedia("(max-width: 760px)").matches;

    return (
      !compactViewport && localStorage.getItem("gitping-sidebar") !== "closed"
    );
  });

  useEffect(() => {
    localStorage.setItem("gitping-sidebar", sidebarOpen ? "open" : "closed");
  }, [sidebarOpen]);

  return { sidebarOpen, setSidebarOpen };
}
