// The $WOC Exchange's hand-off for a wrapped DESKTOP shell (Electron, Steam,
// the packaged website build): the Exchange itself stays fail-closed there
// (src/game/woc_market_wiring.ts, docs/prd/woc/marketplace.md "Platforms,
// realms, configuration"; browser-only is a counsel-gated PRD scope, not a
// client toggle, so this module never unlocks the Exchange UI, wallet code,
// or trading flow inside the wrapped shell). Before this module the wrapped
// shell's launcher just stayed hidden with no explanation, which read as a
// missing icon rather than an out-of-scope feature (the bug this closes).
// Deliberately NOT offered to Capacitor native (iOS/Android): steering a
// mobile-app-store build to an external real-money marketplace is the
// anti-steering shape those stores restrict, and the PRD's counsel-gated
// scope has not signed off on that; native stays exactly as fail-closed and
// silent as before (src/game/woc_market_wiring.ts wocMarketBrowserHandoffAllowed).
//
// Same confirm-then-hand-off contract, and the same window.open hop, as
// src/ui/wiki_link.ts (registered in tests/architecture.test.ts
// UI_DOM_MODULES): every shell hands a non-origin URL to the system browser
// (Electron's setWindowOpenHandler), so the wrapped-shell game keeps running
// while the Exchange opens in a real browser tab.

import { CANONICAL_WOC_MARKET_URL } from '../client_origin';
import { t } from './i18n';

export { CANONICAL_WOC_MARKET_URL };

export interface WocMarketUrlEnv {
  /** window.location.origin ('' when unavailable). */
  origin: string;
}

/** Same-origin '/play' whenever the client is served by the site itself (an
 *  http(s) origin, including a dev deploy against the Vite server); the
 *  canonical playable-client URL otherwise (the packaged Electron shell's
 *  app://worldofclaudecraft is not an http(s) origin and fails the test
 *  below). Mirrors src/ui/wiki_link.ts's resolveWikiUrl. */
export function resolveWocMarketUrl(env: WocMarketUrlEnv): string {
  if (/^https?:\/\//.test(env.origin)) return new URL('/play', env.origin).toString();
  return CANONICAL_WOC_MARKET_URL;
}

/** The toggle-button decision for #mm-wocmarket / #mobile-wocmarket, pulled
 *  out of Hud.toggleWocMarket() so the state machine is unit-testable without
 *  constructing a Hud: 'handoff' takes the browser hand-off over opening the
 *  real window even if hooks were somehow also attached (fail toward NOT
 *  silently stranding the money surface open), 'toggle' opens the real
 *  Exchange window, 'none' matches the pre-attach state (launcher hidden). */
export type WocMarketToggleAction = 'handoff' | 'toggle' | 'none';

export function wocMarketToggleAction(state: {
  browserOnly: boolean;
  hasHooks: boolean;
}): WocMarketToggleAction {
  if (state.browserOnly) return 'handoff';
  if (state.hasHooks) return 'toggle';
  return 'none';
}

export interface WocMarketLinkDeps {
  confirm(title: string, body: string, okText: string, cancelText: string, onOk: () => void): void;
  /** Injectable for tests; defaults to a new-tab/system-browser window.open. */
  openUrl?(url: string): void;
}

/** Ask before leaving, then hand the $WOC Exchange off to the system browser. */
export function promptWocMarketBrowserVisit(deps: WocMarketLinkDeps): void {
  const url = resolveWocMarketUrl({ origin: globalThis.location?.origin ?? '' });
  const open = deps.openUrl ?? ((u: string) => window.open(u, '_blank', 'noopener,noreferrer'));
  deps.confirm(
    t('hudChrome.wocMarket.browserOnlyConfirmTitle'),
    t('hudChrome.wocMarket.browserOnlyConfirmBody'),
    t('hudChrome.wocMarket.browserOnlyConfirmOpen'),
    t('hudChrome.wocMarket.browserOnlyConfirmCancel'),
    () => open(url),
  );
}
