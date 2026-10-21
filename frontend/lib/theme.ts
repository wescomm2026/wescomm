export const THEME_STORAGE_KEY = "wescomm-theme";

export const themePreferences = ["system", "light", "dark"] as const;

export type ThemePreference = (typeof themePreferences)[number];
export type ResolvedTheme = Exclude<ThemePreference, "system">;

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && themePreferences.includes(value as ThemePreference);
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  return preference === "system" ? (prefersDark ? "dark" : "light") : preference;
}

export function themeBootstrapScript() {
  const storageKey = JSON.stringify(THEME_STORAGE_KEY);

  return `(() => {
    const root = document.documentElement;
    let preference = "system";
    try {
      const stored = localStorage.getItem(${storageKey});
      if (stored === "light" || stored === "dark" || stored === "system") preference = stored;
    } catch {}
    const resolved = preference === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : preference;
    root.dataset.theme = resolved;
    root.dataset.themePreference = preference;
    root.style.colorScheme = resolved;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute("content", resolved === "dark" ? "#0f1912" : "#006633");
  })();`;
}
