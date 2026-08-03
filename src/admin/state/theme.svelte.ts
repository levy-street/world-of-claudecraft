import {
  applyThemeMode,
  readThemePreference,
  type ThemeMode,
  writeThemePreference,
} from '../theme';

// Reactive theme-mode signal. Applied to <html data-theme> at construction and on
// every change, so styles/tokens.css's light override takes over before the next
// paint. admin.html additionally stamps the attribute synchronously in an inline
// <head> script (mirroring the stored-locale preload in index.html/play.html/
// guide.html), so a returning light-mode operator never sees a flash of the dark
// default before this module even runs; this class just keeps the DOM and the
// stored preference in sync once the app is live.
class ThemeState {
  mode = $state<ThemeMode>(readThemePreference());

  constructor() {
    applyThemeMode(this.mode);
  }

  toggle(): void {
    this.set(this.mode === 'dark' ? 'light' : 'dark');
  }

  set(mode: ThemeMode): void {
    this.mode = mode;
    writeThemePreference(mode);
    applyThemeMode(mode);
  }
}

export const theme = new ThemeState();
