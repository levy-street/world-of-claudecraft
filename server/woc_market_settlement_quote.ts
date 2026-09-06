// The settlement quote stamp (extracted verbatim from woc_market.ts quoteFor
// under the monolith ratchet): ask the economy service for the payable
// settlement quote, stamp its reference and legs on the row, register it for
// desktop signing, and trace a retired reference. Every rule below moved
// unchanged; the coordinator keeps a thin delegator over this seam.
//
// The Vault arm (woc_market_held.ts): a walletless seller's listing carries
// no seller wallet, so the seller leg pays to the operator custody address,
// and the stamped seller leg is what the delivery finalize later credits.

import type { WocMarketDb, WocSettlementRow } from './woc_market';
import type { WocDesktopHandoffRegistrar } from './woc_market_desktop_handoff';
import { registerWocQuoteHandoff } from './woc_market_desktop_handoff';
import { logSafe } from './woc_market_drift_warn';
import type { WocMarketEconomy, WocQuoteIntent } from './woc_market_economy_types';
import { HELD_QUOTE_REFUSED } from './woc_market_held';
import { settlementCustodyRef } from './woc_market_rules';

export interface WocSettlementQuoteCtx {
  readonly db: Pick<WocMarketDb, 'setSettlementQuote'>;
  readonly economy: Pick<WocMarketEconomy, 'settlementQuote'>;
  readonly desktopHandoff: WocDesktopHandoffRegistrar | undefined;
  /** The custody address a Vault seller's leg pays to; null with the Vault off. */
  custodyWallet(): string | null;
  now(): number;
}

export async function stampSettlementQuote(
  ctx: WocSettlementQuoteCtx,
  settlement: WocSettlementRow,
  listingSellerWallet: string | null,
): Promise<WocQuoteIntent> {
  // A Vault seller's leg pays to the custody address; with the Vault off
  // (operator unset the wallet after such listings existed) the quote is
  // honestly unavailable rather than paid to nobody.
  const sellerWallet = listingSellerWallet ?? ctx.custodyWallet();
  if (sellerWallet === null) return HELD_QUOTE_REFUSED;
  const intent = await ctx.economy.settlementQuote({
    memoRef: settlementCustodyRef(settlement.id),
    usdCents: settlement.amountCents,
    buyerWallet: settlement.buyerWallet,
    sellerWallet,
  });
  if (intent.ok && intent.reference !== null && intent.expiresAtMs !== null) {
    let retiredPair: { reference: string; signature: string } | null = null;
    if (
      settlement.quoteReference !== null &&
      settlement.quoteReference !== intent.reference &&
      settlement.txSignature !== null
    ) {
      // A revival re-quote RETIRES a stored reference a payment may exist
      // against: the row holds one scalar, and every later confirm asks
      // about the fresh one only. The service side can legitimately end up
      // with TWO settled quotes for this memoRef (its entry adoption
      // re-settles a superseded quote a ledger-proven payment backs), and
      // it keys everything on the reference, so this line is the game's
      // only durable trace of the retired pair; an operator reconciling a
      // later-adopted payment matches it against the service's admin quote
      // rows (dev-channel, deliberately not player text). Scoped to rows
      // with a RECORDED signature: an unsigned re-quote is routine (the
      // quote-refresh path) and tracing it would emit a line per refresh.
      // An UNSIGNED retired reference (paid on chain, never confirmed to
      // the game) leaves no game-side line, deliberately: the service
      // still holds that quote keyed by this settlement's memoRef
      // (settlementCustodyRef of the id), which is what actually anchors
      // reconciliation. Captured here, emitted only AFTER the CAS lands:
      // the guarded write can lose (the row left 'offered' to a racing
      // confirm), and a trace claiming a retirement that never happened
      // would falsify the very trail it exists to keep.
      retiredPair = {
        reference: settlement.quoteReference,
        signature: settlement.txSignature,
      };
    }
    const stamped = await ctx.db.setSettlementQuote(
      settlement.id,
      intent.reference,
      intent.expiresAtMs,
      intent.amount?.base ?? null,
      intent.seller?.base ?? null,
    );
    if (!stamped) return { ...intent, ok: false, reason: 'settlement_not_open' };
    // Every payable settlement quote (buy-now, winner, revival) registers
    // for desktop signing, past the stamp only (no adopted row, no entry).
    registerWocQuoteHandoff(
      ctx.desktopHandoff,
      settlement.buyerAccount,
      settlement.buyerWallet,
      intent,
      ctx.now(),
    );
    if (retiredPair !== null) {
      console.warn(
        `[woc_market] settlement ${settlement.id} retires quote reference ${logSafe(retiredPair.reference)} with recorded signature ${logSafe(retiredPair.signature)}`,
      );
    }
  }
  return intent;
}
