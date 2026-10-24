// The one resolver for the Marketplace terms link that the two money surfaces
// (the trade window's $WOC arm and the Exchange window) render beside their
// consent checkbox (draft Terms 10.3: the document is LINKED at the moment of
// acceptance, so the href has to reach it on every shell).
//
// A same-origin '/terms' works only where the client is served by the site
// (the web, the Vite dev server through STATIC_PAGE_ALIASES). The packaged
// desktop shell loads app://worldofclaudecraft and its window-open handler
// hands only http(s) URLs to the system browser; the Capacitor shells load
// capacitor://localhost (iOS: UIApplication.open of that scheme is a no-op)
// and http://localhost (Android: an in-app host, so a target=_blank anchor
// NAVIGATES the game WebView and the html5 fallback reboots the app). Every
// non-site origin therefore takes the canonical absolute URL, which each shell
// already routes to the system browser (the wiki_link.ts precedent).
//
// DOM-free (registered in tests/architecture.test.ts UI_PURE_CORES): the
// painters hand in the page origin, this module never reads the host.

import { CANONICAL_TERMS_URL, NATIVE_APP } from '../client_origin';

export interface TermsUrlEnv {
  /** True in the Capacitor native app (its WebView origin is not the site). */
  nativeApp: boolean;
  /** window.location.origin ('' when unavailable). */
  origin: string;
}

/** The same-origin path the site serves (server/main.ts STATIC_PAGE_ALIASES
 *  and vite.config.ts alias '/terms' to terms.html). */
export const TERMS_PATH = '/terms';

/** Same-origin '/terms' whenever the client is served by the site itself (an
 *  http(s) origin outside the native app); the canonical URL otherwise. */
export function resolveTermsUrl(env: TermsUrlEnv): string {
  if (!env.nativeApp && /^https?:\/\//.test(env.origin)) return TERMS_PATH;
  return CANONICAL_TERMS_URL;
}

/** The href both consent links render: the build's NATIVE_APP flag plus the
 *  page origin the painter reads (location.origin, or '' when unavailable). */
export function termsUrlFor(origin: string): string {
  return resolveTermsUrl({ nativeApp: NATIVE_APP, origin });
}
