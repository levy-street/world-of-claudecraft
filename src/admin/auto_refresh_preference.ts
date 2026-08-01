// Auto-refresh opt-out, remembered per surface. Every live admin page defaults to
// ON and stores only the operator's explicit OFF, so a first visit (and a browser
// with no storage access) still polls.

export function readAutoRefreshPreference(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) !== '0';
  } catch {
    return true;
  }
}

export function writeAutoRefreshPreference(storageKey: string, enabled: boolean): void {
  try {
    localStorage.setItem(storageKey, enabled ? '1' : '0');
  } catch {
    // A blocked or full storage must never break the toggle itself.
  }
}
