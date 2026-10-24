// Shared browser/native URL policy for public assets and REST calls. This stays
// independent of the online world client so presentation modules can use the
// configured Capacitor production origin without importing net/.

import { isDesktopAppRuntime, normalizeOrigin, runtimeApiOrigin } from './runtime';

export const NATIVE_APP = String(import.meta.env.VITE_NATIVE_APP ?? '') === '1';
/** The public Marketplace terms page, for shells whose origin is not the site
 *  (the wallet-connect modal's terms link and src/ui/terms_link.ts share it). */
export const CANONICAL_TERMS_URL = 'https://worldofclaudecraft.com/terms';
/** The playable client (not the marketing root), for shells whose origin is
 *  not the site (src/ui/woc_market_link.ts's desktop-shell browser hand-off). */
export const CANONICAL_WOC_MARKET_URL = 'https://worldofclaudecraft.com/play';
export const NATIVE_API_ORIGIN = normalizeOrigin(String(import.meta.env.VITE_API_ORIGIN ?? ''));
export const DESKTOP_APP = isDesktopAppRuntime();
export const DESKTOP_API_ORIGIN = DESKTOP_APP ? runtimeApiOrigin() : '';

export function apiUrl(path: string, base = ''): string {
  if (/^https?:\/\//.test(path)) return path;
  const origin = normalizeOrigin(base) || NATIVE_API_ORIGIN || DESKTOP_API_ORIGIN;
  return origin ? `${origin}${path}` : path;
}
