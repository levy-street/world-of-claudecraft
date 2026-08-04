// Dark/light theme preference, remembered per browser (mirrors the pattern in
// auto_refresh_preference.ts). Dark is the shipped default so every existing
// operator's screen is unchanged; light is an explicit, persisted opt-in. The
// palette itself lives in styles/tokens.css as a `[data-theme="light"]` override
// block over the same semantic --tokens every stylesheet and scoped component
// style already reads, so applying a mode is just stamping one DOM attribute.

export type ThemeMode = 'dark' | 'light';

export const DEFAULT_THEME_MODE: ThemeMode = 'dark';

// Exported so admin.html's inline pre-paint script (see its header comment) and
// tests can be pinned against the same literal instead of drifting apart.
export const THEME_STORAGE_KEY = 'claudecraft_admin_theme';

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'dark' || value === 'light';
}

export function readThemePreference(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : DEFAULT_THEME_MODE;
  } catch {
    return DEFAULT_THEME_MODE;
  }
}

export function writeThemePreference(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // A blocked or full store must never break the toggle itself.
  }
}

// Stamps the mode on <html> for styles/tokens.css's `[data-theme="light"]`
// override block. Dark has no attribute of its own (it is the unprefixed :root
// default), so this only ever writes the "light" marker or clears it.
export function applyThemeMode(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
}
