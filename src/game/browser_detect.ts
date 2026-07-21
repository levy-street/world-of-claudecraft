// Browser-brand detection for the unsupported-browser notice.
// Pure helper (no DOM, no side effects), Node-tested.
//
// Supported browsers: Chrome, Firefox, Safari. Everything else (Brave, Edge,
// Opera, etc.) is "unsupported": the game still runs, but the player gets a
// one-time dismissible notice that performance may be worse.
//
// Brave masks itself as Chrome in the user-agent but exposes navigator.brave.
// Chromium-based Edge carries the "Edg/" UA token. Both are unsupported.
// Electron and Capacitor shells are excluded entirely (they bundle Chromium).

export type BrowserKind = 'chrome' | 'firefox' | 'safari' | 'unsupported';

/**
 * Detect the browser brand from the user-agent and Brave API.
 *
 * @param userAgent  navigator.userAgent
 * @param isBrave    !!navigator.brave (resolved by the caller, which has the DOM)
 * @returns 'chrome', 'firefox', 'safari', or 'unsupported'
 *
 * Detection order (load-bearing):
 *   1. iOS forces every browser onto WebKit - classification happens on the
 *      user-agent alone (no Brave/Edge tokens can override).
 *   2. Electron/Capacitor shells are excluded before this is called (the caller
 *      returns early for DESKTOP_APP / NATIVE_APP).
 *   3. Firefox (Gecko + Firefox/ token).
 *   4. Chromium Edge (Edg/ token) → unsupported.
 *   5. Brave (navigator.brave is a Promise<boolean>) → unsupported.
 *   6. Plain Chrome/Chromium → supported.
 *   7. Safari (AppleWebKit + Version/ token, no Chrome token) → supported.
 *   8. Unknown → supported (default to safe on ambiguity).
 */
export function detectBrowserKind(userAgent: string, isBrave: boolean): BrowserKind {
  const ua = userAgent || '';

  if (/iPhone|iPad|iPod/.test(ua)) {
    // Everything on iOS is Safari under the hood.
    return 'safari';
  }

  if (/Firefox\//.test(ua)) {
    return 'firefox';
  }

  // Chromium-based Edge
  if (/\bEdg\//.test(ua)) {
    return 'unsupported';
  }

  // Brave (navigator.brave is a truthy object with a `brave()` method)
  if (isBrave) {
    return 'unsupported';
  }

  // Opera, Vivaldi, other Chromium forks without explicit support
  if (/\b(?:OPR|Opera|Vivaldi)\//.test(ua)) {
    return 'unsupported';
  }

  if (/\b(?:Chrome|Chromium|CriOS)\/\d/.test(ua)) {
    return 'chrome';
  }

  if (/AppleWebKit/.test(ua) && /Version\/\d/.test(ua) && !/Chrome|Chromium/.test(ua)) {
    return 'safari';
  }

  // Unknown → default to supported (chrome) so we never nag a real user on ambiguity.
  return 'chrome';
}
