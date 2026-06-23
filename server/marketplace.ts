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
import { normalizeDesignSpec, type SkinDesignSpec } from '../src/world_api';
import { hostedSlotQuota, isTrustedCreator, TRUST_STRIKE_WINDOW_DAYS } from './creator_quota';
import { holderInfoForPubkey } from './woc_balance';
import { fetchRemoteImage, validateSkinPng } from './skin_assets';
import { pinFileToIPFS, unpinFromIPFS, pinataEnabled } from './pinata';
import {
  type CreatorSkinRow, type MarketplaceQuoteRow,
  createMarketplaceQuote, getMarketplaceQuote, deleteMarketplaceQuote,
  redeemPurchase, listLiveCreatorSkins, getCreatorSkin, walletForAccount,
  upsertCreatorSkin, countLiveCreatorSkinsByAccount, countHostedSkinsByAccount,
  ensureCreatorTrust, getCreatorTrust, listHostedSkinsByAccount, setCreatorSkinOverflowHidden,
  setCreatorSkinReview, setCreatorSkinStatus, setCreatorTrusted, bumpApprovedListings, recordCreatorStrike,
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
  const d = parsed.tokenDeltas;
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
  design: SkinDesignSpec | null;
  creator: string; // short public attribution (no full wallet / PII)
  priceUsdc: string;
}

/** Public creator attribution: a short, abbreviated wallet — never the full
 *  address or any account PII. */
function creatorLabel(wallet: string): string {
  return wallet.length > 9 ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : wallet;
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
    design: r.design,
    creator: creatorLabel(r.creatorWallet),
    priceUsdc: r.priceUsdc.toString(),
  }));
}

// --- Creator self-serve listing (the in-browser designer "Sell" path) -------
// A creator submits a procedural design + name + price; we list it 'live'
// immediately (instant-live policy) under the creator's own linked wallet as
// the 70% payout destination. No file upload — the design IS the asset. Bounded
// per-account to deter spam.
export const MAX_LISTINGS_PER_ACCOUNT = 24;
export const MIN_LISTING_PRICE = 500_000n; //  $0.50 (USDC base units)
export const MAX_LISTING_PRICE = 10_000_000_000n; // $10,000
const NAME_MAX = 40;
const DESC_MAX = 200;

export interface ListingInput {
  name: string;
  description: string;
  priceUsdc: bigint;
  design: unknown; // untrusted; validated via normalizeDesignSpec
  targetClass: string | null;
}

export type ListingResult =
  | { ok: true; id: string }
  | { ok: false; reason: string };

export async function createListing(input: ListingInput, creatorAccountId: number, creatorWallet: string): Promise<ListingResult> {
  if (!isSolanaAddress(creatorWallet)) return { ok: false, reason: 'invalid_wallet' };
  const name = input.name.trim();
  if (name.length < 1 || name.length > NAME_MAX) return { ok: false, reason: 'invalid_name' };
  const description = input.description.trim();
  if (description.length > DESC_MAX) return { ok: false, reason: 'invalid_description' };
  if (input.priceUsdc < MIN_LISTING_PRICE || input.priceUsdc > MAX_LISTING_PRICE) return { ok: false, reason: 'invalid_price' };
  const design = normalizeDesignSpec(input.design);
  if (!design) return { ok: false, reason: 'invalid_design' };
  if (await countLiveCreatorSkinsByAccount(creatorAccountId) >= MAX_LISTINGS_PER_ACCOUNT) {
    return { ok: false, reason: 'too_many_listings' };
  }
  const id = `cs_${randomBytes(12).toString('hex')}`;
  const row: CreatorSkinRow = {
    id,
    creatorAccountId,
    creatorWallet,
    name,
    description,
    skinCatalog: 'class',
    fallbackSkin: 0,
    targetClass: input.targetClass,
    assetUrl: 'procedural', // sentinel — `design` is the real source
    emissiveUrl: null,
    design,
    source: 'design',
    originUrl: null,
    ipfsCid: null,
    reviewStatus: 'approved', // procedural designs are instant-live (no arbitrary image to moderate)
    overflowHidden: false,
    priceUsdc: input.priceUsdc,
    status: 'live', // instant-live policy
    sha256: null,
  };
  await upsertCreatorSkin(row);
  return { ok: true, id };
}

// --- Hosting quota + review gate (the image-mode decision) ------------------
// Pure: given the creator's $WOC holder tier, trust, and current hosted usage,
// decide whether a HOSTED upload is allowed and whether it lists instant-live or
// goes to the review queue. Self-hosted is free (quota not applied) but still
// review-gated. Kept pure so the security-critical policy is unit-tested without
// a DB/RPC. Consumers map a denial reason to an HTTP error.
export type HostingDenyReason = 'hosted_quota_exceeded';
export interface HostingDecision {
  allowed: boolean;
  reason?: HostingDenyReason;
  reviewStatus: 'pending' | 'approved';
  quota: number;
  used: number;
}

export function hostingDecision(params: {
  source: 'self_hosted' | 'hosted';
  tierIndex: number;
  trusted: boolean;
  currentHosted: number;
}): HostingDecision {
  const quota = hostedSlotQuota(params.tierIndex);
  // A trusted creator's image listings skip the review queue (instant-live).
  const reviewStatus: 'pending' | 'approved' = params.trusted ? 'approved' : 'pending';
  if (params.source === 'hosted' && params.currentHosted >= quota) {
    return { allowed: false, reason: 'hosted_quota_exceeded', reviewStatus, quota, used: params.currentHosted };
  }
  return { allowed: true, reviewStatus, quota, used: params.currentHosted };
}

// Shared name/description/price validation for every listing mode.
export function validateListingMeta(input: { name: string; description: string; priceUsdc: bigint }):
  { ok: true; name: string; description: string } | { ok: false; reason: string } {
  const name = input.name.trim();
  if (name.length < 1 || name.length > NAME_MAX) return { ok: false, reason: 'invalid_name' };
  const description = input.description.trim();
  if (description.length > DESC_MAX) return { ok: false, reason: 'invalid_description' };
  if (input.priceUsdc < MIN_LISTING_PRICE || input.priceUsdc > MAX_LISTING_PRICE) return { ok: false, reason: 'invalid_price' };
  return { ok: true, name, description };
}

const DAY_MS = 86_400_000;

/** Whether a creator's image uploads skip review (instant-live), from their
 *  persisted trust record + current holder tier. Tenure is measured from
 *  first_listing_at; a strike inside the window revokes. */
export async function evaluateCreatorTrust(creatorAccountId: number, tierIndex: number): Promise<boolean> {
  const t = await getCreatorTrust(creatorAccountId);
  const ageDays = (Date.now() - new Date(t.firstListingAt).getTime()) / DAY_MS;
  const recentStrikes = t.lastStrikeAt && Date.now() - new Date(t.lastStrikeAt).getTime() <= TRUST_STRIKE_WINDOW_DAYS * DAY_MS ? t.strikes : 0;
  return isTrustedCreator({ approvedCount: t.approvedCount, tierIndex, accountAgeDays: ageDays, recentStrikes });
}

export type ImageListingOutcome = { ok: true; id: string; reviewStatus: 'pending' | 'approved' } | { ok: false; reason: string };

// Build a CreatorSkinRow for an image-mode listing. assetUrl is the opaque proxy
// route — the origin URL / CID never leaves the server through the registry.
function imageRow(
  id: string, creatorAccountId: number, creatorWallet: string,
  meta: { name: string; description: string }, targetClass: string | null,
  fields: { source: 'self_hosted' | 'hosted'; originUrl: string | null; ipfsCid: string | null; reviewStatus: 'pending' | 'approved'; sha256: string },
  priceUsdc: bigint,
): CreatorSkinRow {
  return {
    id, creatorAccountId, creatorWallet, name: meta.name, description: meta.description,
    skinCatalog: 'class', fallbackSkin: 0, targetClass,
    assetUrl: `/api/skins/${id}/atlas.png`, emissiveUrl: null, design: null,
    source: fields.source, originUrl: fields.originUrl, ipfsCid: fields.ipfsCid,
    reviewStatus: fields.reviewStatus, overflowHidden: false,
    priceUsdc, status: 'live', sha256: fields.sha256,
  };
}

async function tierForWallet(wallet: string): Promise<number> {
  return (await holderInfoForPubkey(wallet)).tier;
}

/** List a self-hosted skin (free): fetch + validate the creator's URL (SSRF-safe,
 *  origin stored server-only), then list pending review unless the creator is trusted. */
export async function createSelfHostedListing(
  input: { name: string; description: string; priceUsdc: bigint; targetClass: string | null; originUrl: string },
  creatorAccountId: number, creatorWallet: string,
): Promise<ImageListingOutcome> {
  if (!isSolanaAddress(creatorWallet)) return { ok: false, reason: 'invalid_wallet' };
  const meta = validateListingMeta(input);
  if (!meta.ok) return meta;
  if (await countLiveCreatorSkinsByAccount(creatorAccountId) >= MAX_LISTINGS_PER_ACCOUNT) return { ok: false, reason: 'too_many_listings' };
  // The fetch throws SSRF/transport reasons; map them to a clean listing failure.
  let bytes: Buffer;
  try { bytes = await fetchRemoteImage(input.originUrl); }
  catch (err) { return { ok: false, reason: err instanceof Error ? err.message : 'fetch_failed' }; }
  const png = validateSkinPng(bytes);
  if (!png.ok) return { ok: false, reason: png.reason };
  await ensureCreatorTrust(creatorAccountId);
  const tierIndex = await tierForWallet(creatorWallet);
  const reviewStatus = hostingDecision({ source: 'self_hosted', tierIndex, trusted: await evaluateCreatorTrust(creatorAccountId, tierIndex), currentHosted: 0 }).reviewStatus;
  const id = `cs_${randomBytes(12).toString('hex')}`;
  await upsertCreatorSkin(imageRow(id, creatorAccountId, creatorWallet, meta, input.targetClass,
    { source: 'self_hosted', originUrl: input.originUrl, ipfsCid: null, reviewStatus, sha256: png.sha256 }, input.priceUsdc));
  return { ok: true, id, reviewStatus };
}

/** List a hosted skin: validate the uploaded PNG, enforce the $WOC hosted quota,
 *  pin to IPFS, then list pending review unless the creator is trusted. */
export async function createHostedListing(
  input: { name: string; description: string; priceUsdc: bigint; targetClass: string | null; bytes: Buffer },
  creatorAccountId: number, creatorWallet: string,
): Promise<ImageListingOutcome> {
  if (!pinataEnabled()) return { ok: false, reason: 'hosting_unavailable' };
  if (!isSolanaAddress(creatorWallet)) return { ok: false, reason: 'invalid_wallet' };
  const meta = validateListingMeta(input);
  if (!meta.ok) return meta;
  const png = validateSkinPng(input.bytes);
  if (!png.ok) return { ok: false, reason: png.reason };
  await ensureCreatorTrust(creatorAccountId);
  const tierIndex = await tierForWallet(creatorWallet);
  const trusted = await evaluateCreatorTrust(creatorAccountId, tierIndex);
  const decision = hostingDecision({ source: 'hosted', tierIndex, trusted, currentHosted: await countHostedSkinsByAccount(creatorAccountId) });
  if (!decision.allowed) return { ok: false, reason: decision.reason ?? 'hosted_quota_exceeded' };
  const cid = await pinFileToIPFS(input.bytes, meta.name);
  const id = `cs_${randomBytes(12).toString('hex')}`;
  await upsertCreatorSkin(imageRow(id, creatorAccountId, creatorWallet, meta, input.targetClass,
    { source: 'hosted', originUrl: null, ipfsCid: cid, reviewStatus: decision.reviewStatus, sha256: png.sha256 }, input.priceUsdc));
  return { ok: true, id, reviewStatus: decision.reviewStatus };
}

// --- Moderation (operator review queue + trust accrual) ---------------------

/** Recompute + persist a creator's trusted badge from their record + current tier. */
export async function recomputeCreatorTrust(creatorAccountId: number): Promise<boolean> {
  const wallet = await walletForAccount(creatorAccountId);
  const tierIndex = wallet ? (await holderInfoForPubkey(wallet.pubkey)).tier : 0;
  const trusted = await evaluateCreatorTrust(creatorAccountId, tierIndex);
  await setCreatorTrusted(creatorAccountId, trusted);
  return trusted;
}

export type ReviewOutcome = { ok: true; reviewStatus: 'approved' | 'rejected' } | { ok: false; reason: string };

/** Operator review of an image listing. Approve credits the creator's approved
 *  tally + recomputes their trusted badge; reject hides it from sale. */
export async function reviewListing(skinId: string, decision: 'approve' | 'reject'): Promise<ReviewOutcome> {
  const skin = await getCreatorSkin(skinId);
  if (!skin) return { ok: false, reason: 'not_found' };
  if (skin.source === 'design') return { ok: false, reason: 'not_reviewable' };
  if (decision === 'approve') {
    await setCreatorSkinReview(skinId, 'approved');
    if (skin.creatorAccountId !== null) { await bumpApprovedListings(skin.creatorAccountId); await recomputeCreatorTrust(skin.creatorAccountId); }
    return { ok: true, reviewStatus: 'approved' };
  }
  await setCreatorSkinReview(skinId, 'rejected');
  return { ok: true, reviewStatus: 'rejected' };
}

/** Operator takedown: remove from sale, record a creator strike (revokes trust),
 *  and unpin a hosted skin to stop paying for it. */
export async function removeListing(skinId: string): Promise<{ ok: boolean; reason?: string }> {
  const skin = await getCreatorSkin(skinId);
  if (!skin) return { ok: false, reason: 'not_found' };
  await setCreatorSkinStatus(skinId, 'removed');
  if (skin.creatorAccountId !== null) { await recordCreatorStrike(skin.creatorAccountId); await recomputeCreatorTrust(skin.creatorAccountId); }
  if (skin.source === 'hosted' && skin.ipfsCid) await unpinFromIPFS(skin.ipfsCid);
  return { ok: true };
}

/** Recompute a creator's hosted overflow against their current quota: keep the
 *  oldest `quota`, park the newest beyond it (restore on top-up). Idempotent. */
export async function enforceHostedQuota(creatorAccountId: number, tierIndex: number): Promise<number> {
  const quota = hostedSlotQuota(tierIndex);
  const rows = await listHostedSkinsByAccount(creatorAccountId); // newest first
  const overflow = Math.max(0, rows.length - quota);
  for (let i = 0; i < rows.length; i++) {
    const shouldHide = i < overflow; // the newest `overflow` are parked
    if (rows[i].overflowHidden !== shouldHide) await setCreatorSkinOverflowHidden(rows[i].id, shouldHide);
  }
  return overflow;
}
