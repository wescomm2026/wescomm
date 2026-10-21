"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  THEME_STORAGE_KEY,
  isThemePreference,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference
} from "@/lib/theme";

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyResolvedTheme(preference: ThemePreference, prefersDark: boolean) {
  const resolved = resolveTheme(preference, prefersDark);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content",
    resolved === "dark" ? "#0f1912" : "#006633"
  );
  return resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const bootstrappedPreference = document.documentElement.dataset.themePreference;
    let storedPreference: string | null = null;
    try {
      storedPreference = window.localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      // Storage can be unavailable in private or restricted browsing contexts.
    }
    const initialPreference = isThemePreference(bootstrappedPreference)
      ? bootstrappedPreference
      : isThemePreference(storedPreference)
        ? storedPreference
        : "system";
    setPreferenceState(initialPreference);
    setResolvedTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setResolvedTheme(applyResolvedTheme(preference, media.matches));
    update();
    if (preference !== "system") return;
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [mounted, preference]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      setPreferenceState(isThemePreference(event.newValue) ? event.newValue : "system");
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const setPreference = useCallback((nextPreference: ThemePreference) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextPreference);
    } catch {
      // The preference still applies for this session when storage is unavailable.
    }
    setPreferenceState(nextPreference);
  }, []);

  const value = useMemo(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme, setPreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
