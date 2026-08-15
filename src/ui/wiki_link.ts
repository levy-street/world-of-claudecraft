// The HUD's one path to the public wiki (the /wiki guide SPA). Confirm-first:
// every entry point (the #mm-wiki micro button, the Esc-menu row, the mobile
// More tray) routes through promptWikiVisit, which shows the shared confirm
// dialog and only opens the wiki on OK, so an accidental tap can never yank a
// mid-fight player out of the game (the browser hop is the interruption, and
// it is not cancelable once taken).
//
// Registered in tests/architecture.test.ts UI_DOM_MODULES: it owns the
// window.open hop. Every shell hands that hop to the system browser, so the
// game really does keep running: Electron via setWindowOpenHandler, Capacitor
// iOS via createWebViewWith (UIApplication.open, no in-app webview), and
// Capacitor Android via Bridge.launchIntent (ACTION_VIEW for any host outside
// the app origin). The URL decision itself is the pure resolveWikiUrl.

import { NATIVE_APP } from '../client_origin';
import { t } from './i18n';

/** The canonical public wiki, for shells with no meaningful web origin. */
export const CANONICAL_WIKI_URL = 'https://worldofclaudecraft.com/wiki/';

export interface WikiUrlEnv {
  /** True in the Capacitor native app (its WebView origin is not the site). */
  nativeApp: boolean;
  /** window.location.origin ('' when unavailable). */
  origin: string;
}

/** Same-origin /wiki/ whenever the client is served by the site itself (web
 *  and the desktop shell, which loads the live site), so a dev deploy links
 *  to its own wiki; the canonical URL otherwise (a native WebView origin like
 *  capacitor://localhost is not the site and has no /wiki to serve). */
export function resolveWikiUrl(env: WikiUrlEnv): string {
  if (!env.nativeApp && /^https?:\/\//.test(env.origin)) {
    return new URL('/wiki/', env.origin).toString();
  }
  return CANONICAL_WIKI_URL;
}

export interface WikiPromptDeps {
  /** The shared HUD confirm dialog (Hud.confirmDialog: focus-trapped, aria-named). */
  confirm(title: string, body: string, okText: string, cancelText: string, onOk: () => void): void;
  /** Injectable for tests; defaults to a new-tab/system-browser window.open. */
  openUrl?(url: string): void;
}

/** Ask before leaving: show the confirm dialog, and open the wiki only on OK. */
export function promptWikiVisit(deps: WikiPromptDeps): void {
  const url = resolveWikiUrl({
    nativeApp: NATIVE_APP,
    origin: globalThis.location?.origin ?? '',
  });
  const open = deps.openUrl ?? ((u: string) => window.open(u, '_blank', 'noopener,noreferrer'));
  deps.confirm(
    t('hudChrome.wiki.confirmTitle'),
    t('hudChrome.wiki.confirmBody'),
    t('hudChrome.wiki.confirmOpen'),
    t('hudChrome.wiki.confirmCancel'),
    () => open(url),
  );
}
