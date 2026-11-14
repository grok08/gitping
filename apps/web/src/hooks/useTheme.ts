import { useEffect, useState } from "react";
import type { Theme } from "../types/workspace";

function storedTheme(): Theme | null {
  const saved = localStorage.getItem("gitping-theme");

  return saved === "light" || saved === "dark" ? saved : null;
}

function preferredTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(
    () => storedTheme() ?? preferredTheme(),
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("gitping-theme", theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  return { theme, setTheme, toggleTheme };
}
