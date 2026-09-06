// The Exchange window's pending quote face (extracted from woc_market_window.ts
// under the monolith ratchet): the quote a bond or a settlement is waiting on,
// and the painter-side resolution of its title, token legs, and clock. The
// face markup itself stays the chrome builder's (wocQuoteFaceHtml).

import type { WocQuoteView } from '../net/woc_market_sdk';
import { t } from './i18n';
import { wocQuoteFaceHtml } from './woc_market_chrome';

/** A quote awaiting the player's commit. usdCents is the cached USD label
 *  (null when the painter has none: the token legs then carry the amount);
 *  the server's quote carries the authoritative figures either way. */
export type WocPendingQuote =
  | {
      kind: 'bond';
      bidId: number;
      /** The listing's item when the painter knows it ('' otherwise): the
       *  quote face names which auction the bond is for. Display only. */
      itemId: string;
      usdCents: number | null;
      quote: WocQuoteView;
    }
  | {
      kind: 'settlement';
      settlementId: number;
      itemId: string;
      usdCents: number | null;
      /** The settlement pays from the Exchange Vault: the commit step calls
       *  confirmHeld instead of asking a wallet to sign. */
      held: boolean;
      /** The claim's own payment deadline (the wire's deadlineAtMs), or null:
       *  the quote face shows it beside the quote expiry. Display only. */
      deadlineAtMs: number | null;
      quote: WocQuoteView;
    };

export interface WocPendingQuoteFormat {
  usd(cents: number): string;
  tokens(value: number): string;
  itemName(itemId: string): string;
  nowMs: number;
  busy: boolean;
}

export function wocPendingQuoteHtml(pending: WocPendingQuote, fmt: WocPendingQuoteFormat): string {
  const q = pending.quote;
  const remainingMs = q.expiresAtMs === null ? 0 : Math.max(0, q.expiresAtMs - fmt.nowMs);
  // With no cached USD label, the token legs below carry the amount rather
  // than a fabricated $0.00. A bond names its listing's item when the
  // painter knows it (a retry face after a declined wallet still says which
  // auction it is for).
  const title =
    pending.usdCents === null
      ? t('hudChrome.wocMarket.quoteTitle')
      : pending.kind === 'bond'
        ? pending.itemId === ''
          ? t('hudChrome.wocMarket.quoteBondFor', { usd: fmt.usd(pending.usdCents) })
          : t('hudChrome.wocMarket.quoteBondForItem', {
              item: fmt.itemName(pending.itemId),
              usd: fmt.usd(pending.usdCents),
            })
        : t('hudChrome.wocMarket.quoteSettlementFor', {
            item: fmt.itemName(pending.itemId),
            usd: fmt.usd(pending.usdCents),
          });
  return wocQuoteFaceHtml({
    title,
    amountTokens: q.amount ? fmt.tokens(q.amount.tokens) : null,
    sellerTokens: q.seller ? fmt.tokens(q.seller.tokens) : null,
    burnTokens: q.burn ? fmt.tokens(q.burn.tokens) : null,
    treasuryTokens: q.treasury ? fmt.tokens(q.treasury.tokens) : null,
    remainingMs,
    // The claim's own payment deadline on a settlement quote (the trade
    // arm's quote face shows its twin): 'Not now' keeps it running.
    dueAtMs: pending.kind === 'settlement' ? pending.deadlineAtMs : null,
    busy: fmt.busy,
    vaultPay: pending.kind === 'settlement' && pending.held,
  });
}
