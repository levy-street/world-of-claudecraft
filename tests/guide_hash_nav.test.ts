// @vitest-environment jsdom
//
// DOM behavioral guard for the Guide router's fragment handling. Back/Forward
// (popstate) and a language switch must keep the URL #anchor so a deep-linked
// section re-scrolls to that section instead of jumping to the top: router.ts
// handlePopState and app.ts changeLanguage both pass pathname + hash, and
// focusMain reads the hash for the scroll (matchRoute strips it for routing).
// A hashless navigation must still scroll to top and focus the content region.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuideApp } from '../src/guide/app';
import { GUIDE_BASE } from '../src/guide/routes';
import { setLanguage } from '../src/ui/i18n';

// The deeds page emits a section per category with id="deed-cat-<category>"
// (src/guide/pages/deeds.ts), a stable in-page anchor to deep-link to.
const DEEDS_PATH = `${GUIDE_BASE}/deeds`;
const ANCHOR = 'deed-cat-progression';

let scrollIntoView: ReturnType<typeof vi.spyOn>;
let scrollTo: ReturnType<typeof vi.fn>;

function setUrl(path: string): void {
  window.history.replaceState({}, '', path);
}

// Start the app on `path`, returning a direct invoker for THIS app's popstate
// handler. Calling it directly (rather than dispatching a global popstate)
// isolates the test from popstate listeners that earlier apps left on window.
function mountApp(path: string): { app: GuideApp; firePopstate: () => void } {
  setUrl(path);
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const spy = vi.spyOn(window, 'addEventListener');
  const app = new GuideApp(mount);
  app.start();
  const handler = spy.mock.calls.find(([type]) => type === 'popstate')?.[1] as
    | EventListener
    | undefined;
  spy.mockRestore();
  return {
    app,
    firePopstate: () => handler?.(new PopStateEvent('popstate')),
  };
}

beforeEach(() => {
  setLanguage('en');
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  // jsdom stubs neither reliably; give both a spyable function.
  HTMLElement.prototype.scrollIntoView = HTMLElement.prototype.scrollIntoView || (() => {});
  scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
  scrollTo = vi.fn();
  (window as unknown as { scrollTo: unknown }).scrollTo = scrollTo;
});

afterEach(() => {
  scrollIntoView.mockRestore();
  setUrl('/');
});

describe('Guide fragment handling on popstate and language change', () => {
  it('scrolls to the anchor on Back/Forward to a deep-linked section, not to the top', () => {
    const { firePopstate } = mountApp(DEEDS_PATH); // initial nav is hashless
    expect(scrollIntoView).not.toHaveBeenCalled();

    // A Back/Forward that lands on the hashed URL.
    setUrl(`${DEEDS_PATH}#${ANCHOR}`);
    firePopstate();

    const target = document.getElementById(ANCHOR);
    expect(target).not.toBeNull();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(target);
    // The hash branch returns before the scroll-to-top fallback.
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('re-scrolls to the anchor after a language change on a deep-linked section', async () => {
    const { app } = mountApp(DEEDS_PATH);
    setUrl(`${DEEDS_PATH}#${ANCHOR}`);
    scrollIntoView.mockClear();

    // changeLanguage is private; invoke it as the chrome's lang-select would.
    // English stays resident, so the re-render is synchronous after the await.
    await (app as unknown as { changeLanguage(lang: string): Promise<void> }).changeLanguage('en');

    const target = document.getElementById(ANCHOR);
    expect(target).not.toBeNull();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(target);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('still scrolls to top and focuses main on a hashless Back/Forward', () => {
    const { firePopstate } = mountApp(DEEDS_PATH);
    const mainEl = document.getElementById('guide-main') as HTMLElement;
    const focusSpy = vi.spyOn(mainEl, 'focus');

    // A hashless route (the home landing): the top-scroll + focus path.
    setUrl(GUIDE_BASE);
    firePopstate();

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });
    expect(focusSpy).toHaveBeenCalled();
  });
});
