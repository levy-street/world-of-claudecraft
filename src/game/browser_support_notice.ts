// Unsupported-browser advisory (issue #2266). Players on a browser outside the
// officially supported set (Chrome, Firefox, Safari) can hit degraded
// performance with no signal that the browser is the cause. This module is
// pure detection + dismissal-persistence logic; `initBrowserSupportNotice`
// is the thin DOM consumer main.ts calls once at boot. The desktop shell
// (Electron) and native mobile shells (Capacitor) are excluded entirely: they
// either bundle Chromium themselves or are not a "browser" choice at all.

const DISMISS_KEY = 'woc_unsupported_browser_dismissed';

/**
 * Best-effort classification of whether the current engine is one of the
 * three officially supported browsers. Pure: pass any UA string in.
 *
 * Two UA fossils would otherwise misclassify as supported, called out in the
 * issue: Brave reports a plain Chrome UA (caught via `hasBraveApi`, the
 * `navigator.brave` object Brave alone exposes), and Chromium-based Edge
 * carries a `Edg/` token alongside the Chrome one. Both must be checked
 * BEFORE the generic Chromium match. Anything else ambiguous defaults to
 * supported: a false "unsupported" nag on a real Chrome user is worse than a
 * missed notice on some other Chromium fork.
 */
export function isSupportedBrowser(userAgent: string, hasBraveApi: boolean): boolean {
  const ua = userAgent || '';
  if (hasBraveApi) return false;
  if (/\bEdg(?:A|iOS)?\/\d/.test(ua)) return false;
  if (/\bOPR\/\d/.test(ua)) return false;
  // The three positive branches below are documentation of intent, not load-bearing
  // decisions: the trailing `return true` already covers everything that reaches
  // this point, per the "default to supported on ambiguity" rule above. Keep them
  // named so the supported set stays legible even though removing any one changes
  // no observable behavior.
  if (/Gecko\/\d/.test(ua) && /Firefox\/\d/.test(ua)) return true;
  if (/(?:Chrome|CriOS|Chromium)\/\d/.test(ua)) return true;
  if (/AppleWebKit/.test(ua) && /Version\/\d/.test(ua) && !/Chrome|Chromium|CriOS/.test(ua)) {
    return true;
  }
  return true;
}

/** Read the browser's own "am I Brave" signal. False everywhere but Brave. */
export function readHasBraveApi(
  nav: { brave?: unknown } = navigator as Navigator & { brave?: unknown },
): boolean {
  return typeof nav.brave === 'object' && nav.brave !== null;
}

export interface BrowserSupportNoticeInput {
  readonly isSupportedBrowser: boolean;
  readonly isDesktopApp: boolean;
  readonly isNativeShell: boolean;
  readonly dismissed: boolean;
}

/** Decide whether the notice should render. Pure so every case is table-tested. */
export function shouldShowBrowserSupportNotice(input: BrowserSupportNoticeInput): boolean {
  if (input.isSupportedBrowser) return false;
  if (input.isDesktopApp) return false;
  if (input.isNativeShell) return false;
  if (input.dismissed) return false;
  return true;
}

/** Read the persisted dismissal flag. Never throws (private mode / corrupt storage). */
export function readBrowserSupportNoticeDismissed(storage: Storage = localStorage): boolean {
  try {
    return storage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/** Persist the dismissal so the notice does not nag every future load. */
export function persistBrowserSupportNoticeDismissed(storage: Storage = localStorage): void {
  try {
    storage.setItem(DISMISS_KEY, '1');
  } catch {
    // Private mode / storage full: the notice simply reappears next load.
  }
}

// ---------------------------------------------------------------------------
// DOM wiring. main.ts calls initBrowserSupportNotice() once at boot; every
// input above is impure-but-injectable so the decision itself stays testable.
// ---------------------------------------------------------------------------

import { isDesktopAppRuntime } from '../runtime';
import { ensureLocaleLoaded, getLanguage, t } from '../ui/i18n';
import { isNativeAppShell } from './mobile_controls';

/**
 * Builds the dismissible banner element. Exported for a future visual test.
 * `onDismiss` also fires from the "get the desktop app" button, since that
 * click navigates the player to the download view and the notice has no
 * further reason to sit on top of it.
 */
export function buildBrowserSupportNoticeElement(
  doc: Document,
  onDismiss: () => void,
): HTMLElement {
  const el = doc.createElement('div');
  el.id = 'browser-support-notice';
  el.className = 'browser-support-notice';
  el.setAttribute('role', 'status');

  const title = doc.createElement('div');
  title.className = 'browser-support-notice-title';
  title.textContent = t('hudChrome.landing.browserSupport.title');
  el.appendChild(title);

  const body = doc.createElement('div');
  body.className = 'browser-support-notice-body';
  body.textContent = t('hudChrome.landing.browserSupport.body');
  el.appendChild(body);

  const actions = doc.createElement('div');
  actions.className = 'browser-support-notice-actions';

  const desktopBtn = doc.createElement('button');
  desktopBtn.type = 'button';
  desktopBtn.className = 'browser-support-notice-desktop';
  desktopBtn.textContent = t('hudChrome.landing.browserSupport.getDesktopApp');
  desktopBtn.addEventListener('click', () => {
    doc.getElementById('nav-btn-download')?.dispatchEvent(new Event('click', { bubbles: true }));
    onDismiss();
  });
  actions.appendChild(desktopBtn);

  const continueBtn = doc.createElement('button');
  continueBtn.type = 'button';
  continueBtn.className = 'browser-support-notice-continue';
  continueBtn.textContent = t('hudChrome.landing.browserSupport.continueInBrowser');
  continueBtn.setAttribute('aria-label', t('hudChrome.landing.browserSupport.dismissAria'));
  continueBtn.addEventListener('click', onDismiss);
  actions.appendChild(continueBtn);

  el.appendChild(actions);
  return el;
}

// The one live instance this boot may have shown, so `hideBrowserSupportNotice`
// (called on world entry, a landing-only surface) can tear it down without
// main.ts holding a reference of its own. `liveRelocalize` is the exact
// listener function passed to `addEventListener`, kept alongside so it can be
// removed again by reference.
let liveNotice: HTMLElement | null = null;
let liveRelocalize: (() => void) | null = null;

/**
 * Show the notice, once, when this load's browser is genuinely unsupported and
 * the dismissal was not already persisted. No-op in the desktop app, in a
 * native mobile shell, or on an already-supported browser.
 *
 * The strings are localized against the CURRENT language, which may still be
 * loading asynchronously at boot (only `en` is resident synchronously; see
 * `ensureLocaleLoaded` in `src/ui/i18n.ts`), so building the element is
 * deferred behind that load: `t()` would otherwise resolve every string
 * against the English table and never correct itself. A later in-session
 * language switch is covered by `woc:languagechange`, the same reactivity
 * `src/ui/gpu_notice_toast.ts` uses.
 */
export function initBrowserSupportNotice(doc: Document = document): void {
  const show = shouldShowBrowserSupportNotice({
    isSupportedBrowser: isSupportedBrowser(navigator.userAgent || '', readHasBraveApi()),
    isDesktopApp: isDesktopAppRuntime(),
    isNativeShell: isNativeAppShell(),
    dismissed: readBrowserSupportNoticeDismissed(),
  });
  if (!show) return;

  const teardown = (): void => {
    liveNotice?.remove();
    liveNotice = null;
    if (liveRelocalize) doc.removeEventListener('woc:languagechange', liveRelocalize);
    liveRelocalize = null;
  };

  const dismiss = (): void => {
    persistBrowserSupportNoticeDismissed();
    teardown();
  };

  const relocalize = (): void => {
    if (!liveNotice) return;
    const rebuilt = buildBrowserSupportNoticeElement(doc, dismiss);
    liveNotice.replaceWith(rebuilt);
    liveNotice = rebuilt;
  };

  const reveal = (): void => {
    if (readBrowserSupportNoticeDismissed()) return; // dismissed while the locale loaded
    liveNotice = buildBrowserSupportNoticeElement(doc, dismiss);
    doc.body.appendChild(liveNotice);
    liveRelocalize = relocalize;
    doc.addEventListener('woc:languagechange', liveRelocalize);
  };

  // Both arms reveal: a rejected locale load falls back to the resident
  // English table rather than stranding the notice unshown.
  void ensureLocaleLoaded(getLanguage()).then(reveal, reveal);
}

/**
 * Landing-only advisory: tear it down on world entry so it never survives
 * into the game and sits on top of in-world HUD chrome (the chat frame in
 * particular, which shares its bottom-left corner). No-op if the notice was
 * never shown or was already dismissed.
 */
export function hideBrowserSupportNotice(doc: Document = document): void {
  liveNotice?.remove();
  liveNotice = null;
  if (liveRelocalize) doc.removeEventListener('woc:languagechange', liveRelocalize);
  liveRelocalize = null;
}
