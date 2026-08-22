import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

export const THEME_KEY = "cue-theme";

/**
 * The `dark` variant is class-based (`@custom-variant dark (&:is(.dark *))`), so
 * "system" is not a passive state — it means "mirror the media query onto the
 * class", and keep mirroring it when the OS setting changes.
 */
export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", resolveTheme(theme) === "dark");
}

function readStored(): Theme {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // Private browsing / blocked storage: fall through to the default.
  }
  return "system";
}

export function useTheme(): [Theme, (next: Theme) => void] {
  // SPA mode: the first render already happens in the browser, so the stored
  // value can seed state directly — no post-mount sync needed.
  const [theme, setThemeState] = useState<Theme>(readStored);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Non-persistent is still better than not switching at all.
    }
    applyTheme(next);
  }, []);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return [theme, setTheme];
}
