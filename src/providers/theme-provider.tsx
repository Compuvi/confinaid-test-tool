import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Theme = "light" | "dark" | "system";

/** Must match the inline anti-FOUC script in index.html. */
const STORAGE_KEY = "confinaid-test-tool-theme";

type ThemeProviderState = {
  theme: Theme;
  /** The theme actually applied right now — `system` resolved to light or dark. */
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
};

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);

function prefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    /* localStorage can throw in restricted webviews */
  }
  return "system";
}

function applyTheme(theme: Theme): "light" | "dark" {
  const isDark = theme === "dark" || (theme === "system" && prefersDark());
  const root = document.documentElement;

  // Transitions are enabled for one frame only, so ordinary hover/focus
  // styles are not slowed down by the theme-swap transition.
  root.classList.add("theme-transition");
  root.classList.toggle("dark", isDark);
  window.setTimeout(() => root.classList.remove("theme-transition"), 200);

  return isDark ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() =>
    theme === "dark" || (theme === "system" && prefersDark()) ? "dark" : "light"
  );

  useEffect(() => {
    setResolvedTheme(applyTheme(theme));
  }, [theme]);

  // Follow the OS only while the user has explicitly chosen "system".
  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolvedTheme(applyTheme("system"));
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* non-fatal: the theme still applies for this session */
    }
    setThemeState(next);
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme]
  );

  return <ThemeProviderContext.Provider value={value}>{children}</ThemeProviderContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const context = useContext(ThemeProviderContext);
  if (!context) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
}
