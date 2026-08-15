// @vitest-environment jsdom

// DOM-facing coverage for the two blocking review findings on the
// unsupported-browser notice (issue #2266, PR #2721):
//   1. the notice must render in the resident locale once ensureLocaleLoaded
//      settles, and must relocalize on woc:languagechange rather than staying
//      pinned to whatever locale was resident when it first built;
//   2. the notice must not survive world entry: hideBrowserSupportNotice tears
//      it down (and its languagechange listener) so it never sits over the
//      in-world HUD.
//
// isSupportedBrowser is UA-driven and jsdom's own UA defaults to "supported",
// so these tests force the unsupported path through the Brave-API signal
// (`navigator.brave`) instead of trying to spoof a UA string.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildBrowserSupportNoticeElement,
  hideBrowserSupportNotice,
  initBrowserSupportNotice,
} from '../src/game/browser_support_notice';
import { ensureLocaleLoaded, type SupportedLanguage, setLanguage, t } from '../src/ui/i18n';

// The browserSupport keys got their required M16 non-Latin fills for exactly
// five locales (zh_CN, zh_TW, ja_JP, ko_KR, ru_RU); the rest stay pending
// English-only under the PR-tier gate, so `es` would silently fall back and
// make the relocalize assertions below vacuous.
const OTHER: SupportedLanguage = 'ja_JP';

beforeAll(async () => {
  await ensureLocaleLoaded(OTHER);
});

beforeEach(() => {
  setLanguage('en');
  document.body.innerHTML = '';
  (navigator as unknown as { brave?: unknown }).brave = undefined;
  localStorage.clear();
});

afterEach(() => {
  hideBrowserSupportNotice();
  setLanguage('en');
  document.body.innerHTML = '';
  (navigator as unknown as { brave?: unknown }).brave = undefined;
  localStorage.clear();
});

// A real locale, not the dev pseudo one; refuse to run if the key happens to
// read the same in both, which would make the relocalize assertion vacuous.
function bilingualTitle(): { en: string; other: string } {
  setLanguage('en');
  const en = t('hudChrome.landing.browserSupport.title');
  setLanguage(OTHER);
  const other = t('hudChrome.landing.browserSupport.title');
  setLanguage('en');
  expect(other, 'browserSupport.title reads the same in en and es').not.toBe(en);
  return { en, other };
}

function markBrave(): void {
  (navigator as unknown as { brave?: unknown }).brave = {};
}

describe('buildBrowserSupportNoticeElement', () => {
  it('renders the title, body, and both actions from t(), and wires dismiss', () => {
    let dismissed = 0;
    const el = buildBrowserSupportNoticeElement(document, () => {
      dismissed++;
    });
    expect(el.id).toBe('browser-support-notice');
    expect(el.querySelector('.browser-support-notice-title')?.textContent).toBe(
      t('hudChrome.landing.browserSupport.title'),
    );
    expect(el.querySelector('.browser-support-notice-body')?.textContent).toBe(
      t('hudChrome.landing.browserSupport.body'),
    );
    (el.querySelector('.browser-support-notice-continue') as HTMLButtonElement).click();
    expect(dismissed).toBe(1);
  });

  it('dismisses the notice when the desktop-app button is clicked, not just navigated', () => {
    document.body.innerHTML = '<button id="nav-btn-download"></button>';
    let dismissed = 0;
    const el = buildBrowserSupportNoticeElement(document, () => {
      dismissed++;
    });
    document.body.appendChild(el);
    (el.querySelector('.browser-support-notice-desktop') as HTMLButtonElement).click();
    expect(dismissed, 'the desktop-app button left the notice stranded on screen').toBe(1);
  });
});

describe('#2721 finding 1: the notice renders in the resident locale and relocalizes', () => {
  it('builds against the CURRENT language once the locale load settles, not English', async () => {
    const title = bilingualTitle();
    markBrave();
    setLanguage(OTHER);

    initBrowserSupportNotice(document);
    // ensureLocaleLoaded(getLanguage()) is already-resolved for OTHER (loaded in
    // beforeAll), but the reveal still runs as a microtask off that promise.
    await Promise.resolve();
    await Promise.resolve();

    const built = document.getElementById('browser-support-notice');
    expect(built, 'the notice never appeared').not.toBeNull();
    expect(built?.querySelector('.browser-support-notice-title')?.textContent).toBe(title.other);
  });

  it('rebuilds in place on woc:languagechange, replacing the stale English copy', async () => {
    const title = bilingualTitle();
    markBrave();
    setLanguage('en');

    initBrowserSupportNotice(document);
    await Promise.resolve();
    await Promise.resolve();

    const before = document.getElementById('browser-support-notice');
    expect(before?.querySelector('.browser-support-notice-title')?.textContent).toBe(title.en);

    setLanguage(OTHER);
    document.dispatchEvent(new Event('woc:languagechange'));

    const after = document.getElementById('browser-support-notice');
    expect(after, 'the relocalize dropped the notice entirely').not.toBeNull();
    expect(after?.querySelector('.browser-support-notice-title')?.textContent).toBe(title.other);
  });

  it('does nothing on languagechange once the notice was dismissed mid-load', async () => {
    markBrave();
    setLanguage('en');
    initBrowserSupportNotice(document);
    // Dismiss before the locale-load microtask settles.
    document.getElementById('browser-support-notice')?.remove();
    localStorage.setItem('woc_unsupported_browser_dismissed', '1');
    await Promise.resolve();
    await Promise.resolve();

    expect(
      document.getElementById('browser-support-notice'),
      'a dismissal that raced the locale load still revealed the notice',
    ).toBeNull();

    // A stray languagechange after that must not resurrect it.
    setLanguage(OTHER);
    document.dispatchEvent(new Event('woc:languagechange'));
    expect(document.getElementById('browser-support-notice')).toBeNull();
  });
});

describe('#2721 finding 2: the notice does not survive world entry', () => {
  it('hideBrowserSupportNotice removes the live element and its languagechange listener', async () => {
    markBrave();
    setLanguage('en');
    initBrowserSupportNotice(document);
    await Promise.resolve();
    await Promise.resolve();
    expect(document.getElementById('browser-support-notice')).not.toBeNull();

    hideBrowserSupportNotice(document);
    expect(
      document.getElementById('browser-support-notice'),
      'the notice survived world entry',
    ).toBeNull();

    // The listener must be gone too: a later language switch must not resurrect
    // a torn-down notice by rebuilding it back onto the document.
    setLanguage(OTHER);
    document.dispatchEvent(new Event('woc:languagechange'));
    expect(document.getElementById('browser-support-notice')).toBeNull();
  });

  it('is a safe no-op when the notice was never shown', () => {
    expect(() => hideBrowserSupportNotice(document)).not.toThrow();
    expect(document.getElementById('browser-support-notice')).toBeNull();
  });
});
