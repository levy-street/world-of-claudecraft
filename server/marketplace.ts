// Creator skins marketplace — server-authoritative purchase verification.
//
// A buyer pays in USDC on Solana with a single atomic transaction carrying two
// SPL token transfers: 70% to the creator's wallet and 30% to the burn vault
// (Option C, non-custodial of the creator share). The server NEVER moves funds;
// it only verifies a finalized on-chain transaction matches an issued quote,
// then grants the cosmetic. The 30% accumulates in the burn vault for the
// (separately, legally-gated) buy-and-burn keeper — out of scope here.
//
// All money math is bigint USDC base units (6 decimals). Verification is split
// into a PURE validator (validateSplitPayment) plus the I/O around it
// (verifyPurchase), so the security-critical checks are exhaustively unit-tested.
import { randomBytes } from 'node:crypto';
import { isSolanaAddress } from './wallet_link';
import { parseSplitPayment, fetchFinalizedTransaction, type ParsedSplitPayment } from './solana_rpc';
import {
  type CreatorSkinRow, type MarketplaceQuoteRow,
  createMarketplaceQuote, getMarketplaceQuote, deleteMarketplaceQuote,
  redeemPurchase, listLiveCreatorSkins,
} from './db';

const USDC_MINT = (process.env.USDC_MINT ?? process.env.VITE_USDC_MINT ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v').trim();
const BURN_VAULT = (process.env.MARKETPLACE_BURN_VAULT ?? '').trim();
const QUOTE_TTL_MS = 5 * 60 * 1000;
const SPLIT_CREATOR_BPS = 7000n; // 70% to the creator; the remainder (incl. rounding dust) burns

// The marketplace only operates once a burn-vault destination is configured (and
// is a real Solana address). Without it, quote/buy endpoints report unavailable
// rather than issuing unbacked quotes.
export function marketplaceEnabled(): boolean {
  return isSolanaAddress(BURN_VAULT);
}

export function usdcMint(): string {
  return USDC_MINT;
}

/**
 * Split a gross USDC price 70/30. The creator share floors; the burn share takes
 * the remainder, so not a single base unit is lost to rounding — dust accrues to
 * the burn pool, never unaccounted. Price-independent by construction.
 */
export function splitAmounts(priceUsdc: bigint): { creator: bigint; burn: bigint } {
  const creator = (priceUsdc * SPLIT_CREATOR_BPS) / 10000n;
  return { creator, burn: priceUsdc - creator };
}

/**
 * Issue a purchase quote for `skin` to `buyerAccountId`: compute the split,
 * pin the destination owners (creator wallet + burn vault) and exact amounts,
 * persist it (short TTL), and return it for the client to build the payment tx.
 * The memo the client must embed is the quoteId.
 */
export async function quotePurchase(skin: CreatorSkinRow, buyerAccountId: number): Promise<MarketplaceQuoteRow> {
  // Fail fast on malformed curated data (symmetric to the BURN_VAULT check in
  // marketplaceEnabled) rather than issuing an unbackable quote that only fails
  // at verify-time, far from the seed-data root cause.
  if (!isSolanaAddress(skin.creatorWallet)) throw new Error(`creator skin ${skin.id} has an invalid payout wallet`);
  const { creator, burn } = splitAmounts(skin.priceUsdc);
  const quote: MarketplaceQuoteRow = {
    quoteId: randomBytes(16).toString('hex'),
    skinId: skin.id,
    buyerAccountId,
    creatorOwner: skin.creatorWallet,
    burnOwner: BURN_VAULT,
    creatorUsdc: creator,
    burnUsdc: burn,
    mint: USDC_MINT,
    expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
  };
  await createMarketplaceQuote(quote);
  return quote;
}

export type SplitVerifyReason =
  | 'ok'
  | 'tx_failed'
  | 'token_2022'
  | 'wrong_payer'
  | 'memo_mismatch'
  | 'owners_not_distinct'
  | 'creator_amount'
  | 'burn_amount'
  | 'buyer_amount'
  | 'extra_recipient';

/**
 * The pure heart of purchase verification: does this parsed transaction exactly
 * realise this quote, paid by this buyer? Every check is a hard equality — no
 * ">= price" slack — so a short-, over-, wrong-mint, wrong-recipient, forged-memo,
 * wrong-payer, or Token-2022 payment is rejected. Returns 'ok' or the failing reason.
 */
export function validateSplitPayment(parsed: ParsedSplitPayment, quote: MarketplaceQuoteRow, buyerWallet: string): SplitVerifyReason {
  if (!parsed.succeeded) return 'tx_failed';
  if (parsed.usesToken2022ForMint) return 'token_2022';
  if (parsed.feePayer !== buyerWallet) return 'wrong_payer';
  if (parsed.memo !== quote.quoteId) return 'memo_mismatch';
  // The three parties must be distinct, else deltas conflate and a self-pay could
  // masquerade as a split.
  if (quote.creatorOwner === quote.burnOwner || quote.creatorOwner === buyerWallet || quote.burnOwner === buyerWallet) {
    return 'owners_not_distinct';
  }
  const d = parsed.usdcDeltas;
  if ((d.get(quote.creatorOwner) ?? 0n) !== quote.creatorUsdc) return 'creator_amount';
  if ((d.get(quote.burnOwner) ?? 0n) !== quote.burnUsdc) return 'burn_amount';
  // The buyer's own wallet must fund the whole gross and nothing more (no extra
  // USDC debit from the buyer in the same tx).
  if ((d.get(buyerWallet) ?? 0n) !== -(quote.creatorUsdc + quote.burnUsdc)) return 'buyer_amount';
  // No third party may receive USDC. (Other wallets *spending* USDC — negative
  // deltas — are irrelevant; only unexpected recipients matter.)
  for (const [owner, delta] of d) {
    if (delta > 0n && owner !== quote.creatorOwner && owner !== quote.burnOwner) return 'extra_recipient';
  }
  return 'ok';
}

export type PurchaseResult =
  | { ok: true; skinId: string }
  | { ok: false; reason: string };

/**
 * Verify a buyer's on-chain split payment against a previously-issued quote and,
 * if valid, atomically record the payment (replay-guarded on the signature),
 * record the sale, and grant the cosmetic. Idempotent: a replayed signature is
 * rejected as already redeemed rather than double-granting.
 */
export async function verifyPurchase(params: { quoteId: string; signature: string; buyerAccountId: number; buyerWallet: string }): Promise<PurchaseResult> {
  const quote = await getMarketplaceQuote(params.quoteId);
  if (!quote) return { ok: false, reason: 'quote_not_found' };
  if (new Date(quote.expiresAt).getTime() <= Date.now()) {
    await deleteMarketplaceQuote(params.quoteId);
    return { ok: false, reason: 'quote_expired' };
  }
  if (quote.buyerAccountId !== params.buyerAccountId) return { ok: false, reason: 'quote_buyer_mismatch' };

  const tx = await fetchFinalizedTransaction(params.signature);
  if (!tx) return { ok: false, reason: 'tx_not_finalized' };

  const parsed = parseSplitPayment(tx, quote.mint);
  const reason = validateSplitPayment(parsed, quote, params.buyerWallet);
  if (reason !== 'ok') return { ok: false, reason };

  // Consume the signature, record the sale, grant the skin, and drop the quote in
  // ONE transaction (redeemPurchase). The signature's PRIMARY KEY is the
  // redeem-once gate; a replay (already-consumed signature) returns false. Doing
  // it atomically means a mid-way failure can't strand a paid buyer with a
  // consumed signature and no cosmetic.
  const granted = await redeemPurchase({
    txSig: params.signature,
    accountId: params.buyerAccountId,
    quoteId: params.quoteId,
    mint: quote.mint,
    skinId: quote.skinId,
    grossUsdc: quote.creatorUsdc + quote.burnUsdc,
    creatorUsdc: quote.creatorUsdc,
    burnUsdc: quote.burnUsdc,
  });
  if (!granted) return { ok: false, reason: 'already_redeemed' };
  return { ok: true, skinId: quote.skinId };
}

// Public cosmetic metadata for the runtime skin registry the client fetches.
// Deliberately excludes the creator's wallet, price-internal fields, and status —
// only what the renderer + marketplace browse need. priceUsdc is a base-unit
// string (bigint isn't JSON-serialisable).
export interface RegistrySkin {
  id: string;
  name: string;
  description: string;
  skinCatalog: 'class' | 'mech';
  fallbackSkin: number;
  targetClass: string | null;
  assetUrl: string;
  emissiveUrl: string | null;
  priceUsdc: string;
}

export async function registrySkins(): Promise<RegistrySkin[]> {
  const rows = await listLiveCreatorSkins();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    skinCatalog: r.skinCatalog,
    fallbackSkin: r.fallbackSkin,
    targetClass: r.targetClass,
    assetUrl: r.assetUrl,
    emissiveUrl: r.emissiveUrl,
    priceUsdc: r.priceUsdc.toString(),
  }));
}
