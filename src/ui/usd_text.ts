// One spelling for a USD amount, everywhere the client prints one.
//
// Intl currency formatting bound to the active locale (suffix-currency
// locales and negative amounts included), never a hardcoded "$" prefix: the
// review's i18n medium found the trade arm concatenating "$" while the
// Exchange window used Intl, so the same dollar read differently across two
// surfaces of one deal. Rule-of-three extraction (trade arm, Exchange
// window, Claudium store, daily rewards all spell USD).
//
// DOM-free (registered in tests/architecture.test.ts UI_PURE_CORES). Cents
// in: callers own the integer; nothing economic is derived here.

import { formatNumber } from './i18n';

export function usdText(cents: number): string {
  return formatNumber(cents / 100, { style: 'currency', currency: 'USD' });
}

/** The dollar-unit twin for surfaces whose wire figure is already dollars
 *  (daily-rewards prize pools, the Claudium pack labels). Kept separate so
 *  no caller multiplies units at the call site. */
export function usdDollarsText(dollars: number): string {
  return formatNumber(dollars, { style: 'currency', currency: 'USD' });
}
