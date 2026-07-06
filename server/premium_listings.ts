// Premium (featured) listing slots (#471) - server-authoritative.
//
// A creator burns a fixed, config-driven fee to feature one of their live
// listings in a bounded set of PREMIUM SLOTS for a fixed, config-driven window.
// There is NO auction: the price and the slot count are fixed from config, and a
// slot is claimed first-come while any is free. When the window passes the slot is
// swept and freed for the next buyer.
//
// This module DOES NOT introduce a new crypto path. The feature fee settles through
// the EXACT same on-chain split-payment + burn-vault mechanism the creator-skins
// marketplace already uses: a single atomic transaction with a 70% creator leg and
// a 30% burn-vault leg. The "burn" is that existing burn-vault share (the buy-and-
// burn keeper drains it separately). Concretely we reuse, unchanged:
//   - splitAmounts()           - the 70/30 split (from marketplace.ts)
//   - createMarketplaceQuote() - persist the quote (memo = quoteId)
//   - parseSplitPayment()      - parse the finalized tx (from solana_rpc.ts)
//   - validateSplitPayment()   - the exhaustive accept/reject validator (marketplace.ts)
//   - onchain_payments tx_sig  - the redeem-once replay guard (via claimPremiumSlot)
// so the only premium-specific logic is the slot ledger + expiry sweep + config.
//
// Availability is gated behind premiumListingsEnabled(): a NEW env flag
// (PREMIUM_LISTINGS_ENABLED), default OFF, AND the marketplace being configured
// (a burn vault must exist to receive the burn leg). Fail-closed like marketplaceEnabled.
import { randomBytes } from 'node:crypto';
import {
  claimPremiumSlot,
  createMarketplaceQuote,
  deleteMarketplaceQuote,
  getMarketplaceQuote,
  type MarketplaceQuoteRow,
} from './db';
import { marketplaceEnabled, splitAmounts, usdcMint, validateSplitPayment } from './marketplace';
import { fetchFinalizedTransaction, parseSplitPayment } from './solana_rpc';
import { isSolanaAddress } from './wallet_link';

const BURN_VAULT = (process.env.MARKETPLACE_BURN_VAULT ?? '').trim();
const QUOTE_TTL_MS = 5 * 60 * 1000;

function envInt(name: string, fallback: number): number {
  const raw = (process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function envBigint(name: string, fallback: bigint): bigint {
  const raw = (process.env[name] ?? '').trim();
  if (!raw) return fallback;
  try {
    const n = BigInt(raw);
    return n > 0n ? n : fallback;
  } catch {
    return fallback;
  }
}

/** Number of premium slots (fixed; no auction). */
export function premiumSlotCount(): number {
  return envInt('PREMIUM_SLOT_COUNT', 4);
}

/** How long a claimed slot stays featured, in milliseconds. */
export function premiumSlotDurationMs(): number {
  return envInt('PREMIUM_SLOT_DURATION_MS', 7 * 24 * 60 * 60 * 1000); // 7 days
}

/** The fixed feature fee, in USDC base units (6 decimals). */
export function premiumSlotPriceUsdc(): bigint {
  return envBigint('PREMIUM_SLOT_PRICE_USDC', 25_000_000n); // $25.00
}

/**
 * Premium listings are available only when explicitly enabled AND the marketplace
 * is configured (the burn vault that receives the 30% burn leg must exist). Both
 * conditions fail closed: an unset flag or an unconfigured vault reports unavailable
 * rather than issuing an unbackable quote. Mirrors marketplaceEnabled gating.
 */
export function premiumListingsEnabled(): boolean {
  return process.env.PREMIUM_LISTINGS_ENABLED === '1' && marketplaceEnabled();
}

/**
 * Issue a quote to feature `skin` in a premium slot. The fee is the fixed config
 * price, split 70/30 onto the creator's own payout wallet + the burn vault (the
 * same split a skin purchase uses). The memo the client must embed is the quoteId.
 * The skin row supplies the creator payout wallet, exactly as a skin quote does.
 */
export async function quotePremiumSlot(
  skin: { id: string; creatorWallet: string },
  buyerAccountId: number,
): Promise<MarketplaceQuoteRow> {
  if (!isSolanaAddress(skin.creatorWallet))
    throw new Error(`premium listing ${skin.id} has an invalid payout wallet`);
  const { creator, burn } = splitAmounts(premiumSlotPriceUsdc());
  const quote: MarketplaceQuoteRow = {
    quoteId: randomBytes(16).toString('hex'),
    skinId: skin.id,
    buyerAccountId,
    creatorOwner: skin.creatorWallet,
    burnOwner: BURN_VAULT,
    creatorUsdc: creator,
    burnUsdc: burn,
    mint: usdcMint(),
    expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
  };
  await createMarketplaceQuote(quote);
  return quote;
}

export type PremiumPurchaseResult =
  | { ok: true; slotIndex: number; expiresAt: string }
  | { ok: false; reason: string };

/**
 * Verify a buyer's on-chain split payment for a premium-slot quote and, if valid,
 * atomically claim a slot (replay-guarded on the signature, exhaustion-checked).
 * The validation is the marketplace's validateSplitPayment/parseSplitPayment
 * verbatim; only the redeem side differs (a slot claim instead of a skin grant).
 */
export async function verifyPremiumPurchase(params: {
  quoteId: string;
  signature: string;
  buyerAccountId: number;
  buyerWallet: string;
}): Promise<PremiumPurchaseResult> {
  const quote = await getMarketplaceQuote(params.quoteId);
  if (!quote) return { ok: false, reason: 'quote_not_found' };
  if (new Date(quote.expiresAt).getTime() <= Date.now()) {
    await deleteMarketplaceQuote(params.quoteId);
    return { ok: false, reason: 'quote_expired' };
  }
  if (quote.buyerAccountId !== params.buyerAccountId)
    return { ok: false, reason: 'quote_buyer_mismatch' };

  const tx = await fetchFinalizedTransaction(params.signature);
  if (!tx) return { ok: false, reason: 'tx_not_finalized' };

  const parsed = parseSplitPayment(tx, quote.mint);
  const reason = validateSplitPayment(parsed, quote, params.buyerWallet);
  if (reason !== 'ok') return { ok: false, reason };

  const expiresAt = new Date(Date.now() + premiumSlotDurationMs()).toISOString();
  const claim = await claimPremiumSlot({
    txSig: params.signature,
    accountId: params.buyerAccountId,
    quoteId: params.quoteId,
    mint: quote.mint,
    skinId: quote.skinId,
    grossUsdc: quote.creatorUsdc + quote.burnUsdc,
    slotCount: premiumSlotCount(),
    expiresAt,
  });
  if (!claim.ok) return { ok: false, reason: claim.reason };
  return { ok: true, slotIndex: claim.slotIndex, expiresAt };
}
