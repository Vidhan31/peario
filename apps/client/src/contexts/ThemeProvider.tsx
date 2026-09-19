import { type ReactNode, useCallback, useLayoutEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";

import type { Theme } from "../types/Theme";

import { STORAGE_KEYS } from "../constants/index.ts";
import { ThemeContext } from "./ThemeContext";

const VALID_THEMES: ReadonlySet<Theme> = new Set<Theme>(["light", "dark", "system"]);

export function isValidTheme(value: unknown): value is Theme {
  return typeof value === "string" && VALID_THEMES.has(value as Theme);
}

interface ThemeProviderProps {
  children: ReactNode;
  storageKey?: string;
  defaultTheme?: Theme;
}

export function ThemeProvider({
  children,
  storageKey = STORAGE_KEYS.THEME,
  defaultTheme = "system",
}: ThemeProviderProps) {
  const [themeState, setThemeState] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem(storageKey);
        if (isValidTheme(stored)) {
          return stored;
        }
      } catch {
        // Fall back if localStorage is restricted or throws
      }
    }
    return defaultTheme;
  });

  useLayoutEffect(() => {
    try {
      localStorage.setItem(storageKey, themeState);
    } catch {
      // Ignore localStorage errors (private mode, quota, restricted access)
    }

    const root = window.document.documentElement;

    root.classList.remove("light", "dark");

    if (themeState === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

      root.classList.add(systemTheme);
      return;
    }

    root.classList.add(themeState);
  }, [themeState, storageKey]);

  const setTheme = useCallback((newTheme: Theme) => {
    if (!("startViewTransition" in document)) {
      setThemeState(newTheme);
      return;
    }

    document.startViewTransition(() => {
      // eslint-disable-next-line @eslint-react/dom-no-flush-sync
      flushSync(() => {
        setThemeState(newTheme);
      });
    });
  }, []);

  const value = useMemo(
    () => ({
      theme: themeState,
      setTheme,
    }),
    [themeState, setTheme],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}
