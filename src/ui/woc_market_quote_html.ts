// The Exchange window's payment-quote face, as one pure builder (the
// woc_market_activity_html.ts shape, its own file because the quote is a full
// pane over the tab body, not status chrome). Moved verbatim from
// woc_market_window.ts on the monolith ratchet: the window passes its
// formatters and its busy flag through the host bag and renders the returned
// markup; the title resolution (which auction a bond is for, whether a USD
// label is known) lives here where a Vitest drives it without a DOM.
//
// DOM-free and deterministic over its inputs (registered in
// tests/architecture.test.ts UI_PURE_CORES).

import { t } from './i18n';
import { wocQuoteFaceHtml } from './woc_market_chrome';
import type { WocQuoteLegView } from './woc_market_view';

/** Structural twin of the SDK quote's face-relevant fields (the view core's
 *  rule: the pure-core sweep forbids net imports even type-only, so the real
 *  WocQuoteView flows in unchanged through structural typing). */
export interface WocQuoteFaceView {
  amount: WocQuoteLegView | null;
  seller: WocQuoteLegView | null;
  burn: WocQuoteLegView | null;
  treasury: WocQuoteLegView | null;
  expiresAtMs: number | null;
}

// usdCents is NULLABLE on purpose: it is only a display label sourced from the
// cached activity row, and a missing row must render no amount rather than a
// fabricated $0.00 next to a real charge. The quote's token legs are the
// authoritative figures either way.
// Generic over the quote so the window keeps the FULL SDK quote (its signing
// fields) on the same record the face reads its legs and clock from.
export type PendingQuote<Q extends WocQuoteFaceView = WocQuoteFaceView> =
  | {
      kind: 'bond';
      bidId: number;
      /** The listing's item when the painter knows it ('' otherwise): the
       *  quote face names which auction the bond is for. Display only. */
      itemId: string;
      usdCents: number | null;
      quote: Q;
    }
  | {
      kind: 'settlement';
      settlementId: number;
      itemId: string;
      usdCents: number | null;
      /** The claim's own payment deadline (the wire's deadlineAtMs), or null:
       *  the quote face shows it beside the quote expiry. Display only. */
      deadlineAtMs: number | null;
      quote: Q;
    };

/** The window-owned pieces the face renders through: its formatters (one USD,
 *  one token and one item-name spelling per window) and the busy flag that
 *  deadens the Pay / Not now controls while a mutation is in flight. */
export interface WocQuoteHtmlHost {
  busy: boolean;
  usd(cents: number): string;
  tokens(value: number): string;
  itemName(itemId: string): string;
}

export function wocQuoteHtml(pending: PendingQuote, host: WocQuoteHtmlHost, nowMs: number): string {
  const q = pending.quote;
  const remainingMs = q.expiresAtMs === null ? 0 : Math.max(0, q.expiresAtMs - nowMs);
  // With no cached USD label, the token legs below carry the amount rather
  // than a fabricated $0.00. A bond names its listing's item when the
  // painter knows it (a retry face after a declined wallet still says which
  // auction it is for).
  const title =
    pending.usdCents === null
      ? t('hudChrome.wocMarket.quoteTitle')
      : pending.kind === 'bond'
        ? pending.itemId === ''
          ? t('hudChrome.wocMarket.quoteBondFor', { usd: host.usd(pending.usdCents) })
          : t('hudChrome.wocMarket.quoteBondForItem', {
              item: host.itemName(pending.itemId),
              usd: host.usd(pending.usdCents),
            })
        : t('hudChrome.wocMarket.quoteSettlementFor', {
            item: host.itemName(pending.itemId),
            usd: host.usd(pending.usdCents),
          });
  // The face itself is the chrome builder's; this painter resolves the
  // title, the token legs and the clock (chrome holds none of them).
  return wocQuoteFaceHtml({
    title,
    amountTokens: q.amount ? host.tokens(q.amount.tokens) : null,
    sellerTokens: q.seller ? host.tokens(q.seller.tokens) : null,
    burnTokens: q.burn ? host.tokens(q.burn.tokens) : null,
    treasuryTokens: q.treasury ? host.tokens(q.treasury.tokens) : null,
    remainingMs,
    // The claim's own payment deadline on a settlement quote (the trade
    // arm's quote face shows its twin): 'Not now' keeps it running.
    dueAtMs: pending.kind === 'settlement' ? pending.deadlineAtMs : null,
    busy: host.busy,
  });
}
