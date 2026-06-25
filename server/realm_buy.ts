// Buy-a-realm orchestration (#475): acquire a realm OUTRIGHT with SOL or USDC.
// The buyer pays the live market value of a tier's $WOC threshold, split in one
// atomic transaction: 70% to the treasury, 30% to a buyback vault that the
// buy-and-burn keeper later swaps to $WOC and burns. There is no escrow and no
// stake: a purchase is final (non-refundable), so decommissioning a bought realm
// just closes it. The verify is buyer-funded and non-custodial (the server holds
// no settlement key); it reuses the marketplace split-payment reader.
//
// No SQL here (realm_buy_db.ts owns it); this is the logic main.ts calls.

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { fetchFinalizedTransaction, parseSplitPayment, parseNativePayment } from './solana_rpc';
import { WOC_MINT, WOC_DECIMALS, WOC_TREASURY } from './woc_config';
import { isSolanaAddress } from './wallet_link';
import { offensiveName } from './auth';
import { isUniqueViolation } from './http_util';
import { resolveRealm, type RealmType } from './realm';
import {
  activateRealm,
  addRealmRole,
  countOwnedRealms,
  createProvisioningRealm,
  getLiveRealmByName,
} from './realm_db';
import { countOpenQuotesForAccount, reclaimExpiredProvisioning } from './realm_quote_db';
import {
  countOpenBuyQuotesForAccount,
  createRealmBond,
  createRealmBuyQuote,
  deleteRealmBuyQuote,
  getRealmBuyQuote,
  insertRealmPurchase,
  reclaimExpiredBuyProvisioning,
} from './realm_buy_db';
import { BOND_BPS, bondBaseForTier, bondEnabled, initialGraceUntil, walletCoversBond } from './realm_bond';
import { cachedWocBalance } from './woc_balance';
import { TIER_BPS, tierName, tierThreshold, type RealmTier } from './realm_tiers';
import { getMintSupplyBase } from './realm_provision';
import {
  CURRENCIES,
  TREASURY_BPS,
  isBuyCurrency,
  priceTierInCurrency,
  splitBuy,
  type BuyCurrency,
} from './realm_price';
import { setRealmAffiliate } from './affiliate_db';
import { resolveReferralAccount } from './db';

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,90}$/;

function intEnv(key: string, def: number, min: number, max: number): number {
  const v = Number.parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(v) && v >= min && v <= max ? v : def;
}

// Same per-account realm cap as the stake path (anti name-squatting): owned realms
// plus open quotes of EITHER acquisition path count against it.
const MAX_REALMS_PER_ACCOUNT = intEnv('REALM_MAX_PER_ACCOUNT', 3, 1, 1000);
// A buy quote pins a PRICE that drifts with the market, so it is short-lived: long
// enough to sign + land + finalize a payment, short enough to bound how stale the
// quoted price can get. Shorter than the stake quote TTL by design.
const BUY_QUOTE_TTL_MS = intEnv('REALM_BUY_QUOTE_TTL_MINUTES', 10, 1, 1440) * 60_000;
// Affiliate commission bps (drawn from the operator's share when #477 lands),
// attributed at purchase exactly as on the stake path.
const AFFILIATE_BPS = intEnv('REALM_AFFILIATE_BPS', 1500, 0, 5000);

// The 70% destination. Prefer a realm-specific treasury, fall back to the shared
// identity-fee treasury (woc_config). The 30% destination is the buyback vault the
// keeper drains. Both must be valid and DISTINCT, else buying is disabled (a single
// shared address would let one combined transfer satisfy both legs).
const REALM_TREASURY = (process.env.REALM_TREASURY ?? WOC_TREASURY ?? '').trim();
// Required explicitly (no BUYBACK_VAULT fallback): the 30% must not silently land
// in the marketplace vault, where the marketplace keeper would burn it under
// marketplace accounting and a SOL leg would never be processed at all. To share
// the marketplace vault an operator sets REALM_BUYBACK_VAULT to it deliberately.
const REALM_BUYBACK_VAULT = (process.env.REALM_BUYBACK_VAULT ?? '').trim();

export function buyConfigured(): boolean {
  return (
    isSolanaAddress(REALM_TREASURY) &&
    isSolanaAddress(REALM_BUYBACK_VAULT) &&
    REALM_TREASURY !== REALM_BUYBACK_VAULT
  );
}

export type Result<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };
function fail(status: number, error: string): { ok: false; status: number; error: string } {
  return { ok: false, status, error };
}

// ── Pricing display ──────────────────────────────────────────────────────────

export interface RealmBuyCurrencyInfo {
  key: BuyCurrency;
  mint: string;
  decimals: number;
  native: boolean;
}

export interface RealmBuyTierOption {
  tier: number; // 1 bronze, 2 silver, 3 gold
  name: 'bronze' | 'silver' | 'gold';
  bps: number; // basis points of supply this tier represents
  wocBase: string; // the $WOC-equivalent amount the price is the market value of
  bondBase: string; // the ongoing $WOC the owner must keep holding (0 if bonds off)
  // base-unit price per currency, or null when no DEX route is available.
  prices: Record<BuyCurrency, string | null>;
}

export interface RealmBuyInfo {
  wocMint: string;
  wocDecimals: number;
  supplyBase: string;
  treasuryBps: number;
  treasury: string;
  buybackVault: string;
  maxPerAccount: number;
  bondBps: number; // ongoing $WOC hold requirement as bps of the tier threshold (0 = off)
  currencies: RealmBuyCurrencyInfo[];
  tiers: RealmBuyTierOption[];
}

// Display data for the "buy a realm" UI: each tier's $WOC-equivalent and its live
// SOL + USDC price, plus the split + recipient addresses. Returns null when buying
// is unconfigured or the $WOC supply read fails (route 503). A currency with no DEX
// route yields a null price for that currency (the UI disables it) without sinking
// the whole response.
export async function realmBuyInfo(): Promise<RealmBuyInfo | null> {
  if (!buyConfigured()) return null;
  const supply = await getMintSupplyBase(WOC_MINT);
  if (supply === null) return null;

  const order: RealmBuyTierOption['name'][] = ['bronze', 'silver', 'gold'];
  const tiers: RealmBuyTierOption[] = [];
  for (let i = 0; i < order.length; i++) {
    const name = order[i];
    const wocBase = tierThreshold(TIER_BPS[name], supply);
    const [usdc, sol] = await Promise.all([
      priceTierInCurrency(wocBase, 'USDC'),
      priceTierInCurrency(wocBase, 'SOL'),
    ]);
    tiers.push({
      tier: i + 1,
      name,
      bps: TIER_BPS[name],
      wocBase: wocBase.toString(),
      bondBase: bondBaseForTier(wocBase).toString(),
      prices: { USDC: usdc?.toString() ?? null, SOL: sol?.toString() ?? null },
    });
  }

  return {
    wocMint: WOC_MINT,
    wocDecimals: WOC_DECIMALS,
    supplyBase: supply.toString(),
    treasuryBps: TREASURY_BPS,
    treasury: REALM_TREASURY,
    buybackVault: REALM_BUYBACK_VAULT,
    maxPerAccount: MAX_REALMS_PER_ACCOUNT,
    bondBps: bondEnabled() ? BOND_BPS : 0,
    currencies: Object.values(CURRENCIES).map((c) => ({
      key: c.key,
      mint: c.mint,
      decimals: c.decimals,
      native: c.native,
    })),
    tiers,
  };
}

// ── Quote ────────────────────────────────────────────────────────────────────

export interface BuyQuote {
  quoteId: string;
  realmId: number;
  name: string;
  type: RealmType;
  tier: number;
  tierName: string;
  currency: BuyCurrency;
  native: boolean;
  currencyMint: string;
  currencyDecimals: number;
  totalBase: string;
  treasuryBase: string;
  buybackBase: string;
  treasury: string; // 70% recipient (owner pubkey)
  buybackVault: string; // 30% recipient (buyback vault owner pubkey)
  wocBase: string; // the $WOC-equivalent the price was derived from
  bondBase: string; // the ongoing $WOC the owner must keep holding (0 if bonds off)
  memo: string; // == quoteId; binds the payment tx to this quote
  expiresAt: string;
  affiliateApplied: boolean;
}

// Issue a buy quote: validate the name + per-account cap + tier + currency, price
// the tier in the chosen currency at the live market, reserve a provisioning realm,
// and pin the exact legs the client must pay. The client then signs ONE transaction
// paying treasuryBase to `treasury` and buybackBase to `buybackVault` (both tagged
// with `memo`), and posts the signature to /buy/confirm.
export async function prepareBuyQuote(
  pool: Pool,
  args: {
    accountId: number;
    buyerWallet: string;
    name: string;
    type: RealmType;
    tier: number;
    currency: string;
    affiliateCode?: string;
  },
): Promise<Result<BuyQuote>> {
  if (!buyConfigured()) return fail(503, 'buy_unavailable');
  if (!isBuyCurrency(args.currency)) return fail(400, 'invalid_currency');
  if (!Number.isInteger(args.tier) || args.tier < 1 || args.tier > 3) return fail(400, 'invalid_tier');
  const currency = args.currency;

  const name = args.name.trim();
  if (!name || resolveRealm(name) !== name) return fail(400, 'invalid_realm_name');
  if (offensiveName(name)) return fail(400, 'realm_name_not_allowed');

  // Free expired reservations from BOTH acquisition paths before uniqueness + cap.
  await reclaimExpiredProvisioning(pool);
  await reclaimExpiredBuyProvisioning(pool);
  if (await getLiveRealmByName(pool, name)) return fail(409, 'realm_name_taken');

  const owned = await countOwnedRealms(pool, args.accountId);
  const openStake = await countOpenQuotesForAccount(pool, args.accountId);
  const openBuy = await countOpenBuyQuotesForAccount(pool, args.accountId);
  if (owned + openStake + openBuy >= MAX_REALMS_PER_ACCOUNT) return fail(409, 'realm_cap_reached');

  const supply = await getMintSupplyBase(WOC_MINT);
  if (supply === null) return fail(503, 'supply_unavailable');

  const tierIdx = args.tier as RealmTier;
  const name3: RealmBuyTierOption['name'] = (['bronze', 'silver', 'gold'] as const)[tierIdx - 1];
  const wocBase = tierThreshold(TIER_BPS[name3], supply);
  const totalBase = await priceTierInCurrency(wocBase, currency);
  if (totalBase === null || totalBase <= 0n) return fail(503, 'price_unavailable');
  const { treasuryBase, buybackBase } = splitBuy(totalBase);
  if (treasuryBase <= 0n || buybackBase <= 0n) return fail(503, 'price_unavailable');

  // Ongoing $WOC bond (skin in the game): the buyer must hold it now and keep
  // holding it. Gate at quote so the UI tells them upfront; a null balance (RPC
  // down) is lenient (the periodic enforcer still catches a real shortfall). The
  // bond is pinned into the quote so confirm uses the same figure.
  const bondBase = bondBaseForTier(wocBase);
  if (bondEnabled() && bondBase > 0n) {
    const balanceHuman = await cachedWocBalance(args.buyerWallet);
    if (!walletCoversBond(balanceHuman, bondBase)) return fail(409, 'bond_required');
  }

  let realmId: number;
  try {
    const realm = await createProvisioningRealm(pool, {
      name,
      type: args.type,
      ownerAccountId: args.accountId,
      tier: tierIdx,
    });
    realmId = realm.realmId;
  } catch (err) {
    if (isUniqueViolation(err)) return fail(409, 'realm_name_taken'); // lost a name race
    throw err;
  }

  // Affiliate attribution (#475): first-touch, never self-referral, best-effort.
  // Identical semantics to the stake path; founding never fails on a bad code.
  let affiliateApplied = false;
  if (args.affiliateCode) {
    const affiliateAccountId = await resolveReferralAccount(args.affiliateCode);
    if (affiliateAccountId !== null && affiliateAccountId !== args.accountId) {
      await setRealmAffiliate(pool, { realmId, affiliateAccountId, bps: AFFILIATE_BPS });
      affiliateApplied = true;
    }
  }

  const quoteId = randomUUID();
  const expiresAt = new Date(Date.now() + BUY_QUOTE_TTL_MS);
  await createRealmBuyQuote(pool, {
    quoteId,
    accountId: args.accountId,
    realmId,
    buyerWallet: args.buyerWallet,
    currency,
    totalBase,
    treasuryBase,
    buybackBase,
    treasuryAddr: REALM_TREASURY,
    buybackAddr: REALM_BUYBACK_VAULT,
    tier: tierIdx,
    wocBase,
    bondBase,
    expiresAt,
  });

  const cfg = CURRENCIES[currency];
  return {
    ok: true,
    quoteId,
    realmId,
    name,
    type: args.type,
    tier: tierIdx,
    tierName: tierName(tierIdx),
    currency,
    native: cfg.native,
    currencyMint: cfg.mint,
    currencyDecimals: cfg.decimals,
    totalBase: totalBase.toString(),
    treasuryBase: treasuryBase.toString(),
    buybackBase: buybackBase.toString(),
    treasury: REALM_TREASURY,
    buybackVault: REALM_BUYBACK_VAULT,
    wocBase: wocBase.toString(),
    bondBase: bondBase.toString(),
    memo: quoteId,
    expiresAt: expiresAt.toISOString(),
    affiliateApplied,
  };
}

// ── Verify ───────────────────────────────────────────────────────────────────

export type BuyVerdict = { ok: true } | { ok: false; reason: string };
const bad = (reason: string): BuyVerdict => ({ ok: false, reason });

// Verify that `paySig` is a finalized split payment by `buyerWallet` that credited
// at least `treasuryBase` to `treasury` AND `buybackBase` to `buybackVault` in
// `currency`, tagged with `memo`. Pure verification against chain (no DB writes).
// USDC uses the SPL token-delta parser (Token-2022 rejected); SOL uses native
// lamport deltas. The payer is bound by fee-payer identity; the recipient legs are
// what we measure, so a third-party fee payer cannot impersonate the buyer.
export async function verifyBuyPayment(args: {
  paySig: string;
  buyerWallet: string;
  currency: BuyCurrency;
  treasury: string;
  buybackVault: string;
  treasuryBase: bigint;
  buybackBase: bigint;
  memo: string;
}): Promise<BuyVerdict> {
  if (!BASE58.test(args.paySig)) return bad('bad_signature');
  if (args.treasury === args.buybackVault) return bad('legs_collide'); // would let one transfer cover both
  const tx = await fetchFinalizedTransaction(args.paySig);
  if (!tx) return bad('not_finalized');

  const cfg = CURRENCIES[args.currency];
  if (cfg.native) {
    const p = parseNativePayment(tx);
    if (!p.succeeded) return bad('tx_failed');
    if (p.memo !== args.memo) return bad('memo_mismatch');
    if (p.feePayer !== args.buyerWallet) return bad('wrong_payer');
    if ((p.lamportDeltas.get(args.treasury) ?? 0n) < args.treasuryBase) return bad('treasury_short');
    if ((p.lamportDeltas.get(args.buybackVault) ?? 0n) < args.buybackBase) return bad('buyback_short');
    return { ok: true };
  }

  const p = parseSplitPayment(tx, cfg.mint);
  if (!p.succeeded) return bad('tx_failed');
  if (p.usesToken2022ForMint) return bad('token_2022');
  if (p.memo !== args.memo) return bad('memo_mismatch');
  if (p.feePayer !== args.buyerWallet) return bad('wrong_payer');
  if ((p.tokenDeltas.get(args.treasury) ?? 0n) < args.treasuryBase) return bad('treasury_short');
  if ((p.tokenDeltas.get(args.buybackVault) ?? 0n) < args.buybackBase) return bad('buyback_short');
  return { ok: true };
}

// ── Confirm ──────────────────────────────────────────────────────────────────

// Redeem a buy quote with the finalized payment signature: verify the split matches
// the quote, then atomically record the purchase + activate the realm + grant the
// owner role. realm_purchases.pay_tx_sig is UNIQUE, so a re-confirmed payment rolls
// the whole transaction back (replay guard) and consumes the quote.
export async function confirmBuyQuote(
  pool: Pool,
  args: { accountId: number; quoteId: string; paySig: string },
): Promise<Result<{ realmId: number; tier: number }>> {
  const quote = await getRealmBuyQuote(pool, args.quoteId);
  if (!quote) return fail(404, 'quote_not_found');
  if (quote.accountId !== args.accountId) return fail(403, 'not_your_quote');
  if (quote.expiresAt.getTime() <= Date.now()) return fail(410, 'quote_expired');

  const verdict = await verifyBuyPayment({
    paySig: args.paySig,
    buyerWallet: quote.buyerWallet,
    currency: quote.currency,
    treasury: quote.treasuryAddr,
    buybackVault: quote.buybackAddr,
    treasuryBase: quote.treasuryBase,
    buybackBase: quote.buybackBase,
    memo: quote.quoteId,
  });
  if (!verdict.ok) return fail(400, verdict.reason);

  // Initial bond grace: if the buyer's wallet already covers the bond, no grace;
  // else start the clock so they have the window to top up. Read before the
  // transaction (it does network IO); a failed read is lenient (no grace), and the
  // periodic enforcer reconciles the real state on its next pass.
  let bondGraceUntil: Date | null = null;
  if (bondEnabled() && quote.bondBase > 0n) {
    const balanceHuman = await cachedWocBalance(quote.buyerWallet);
    bondGraceUntil = initialGraceUntil(balanceHuman, quote.bondBase, Date.now());
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Activate FIRST: this is the linearization point. activateRealm only flips a
    // 'provisioning' realm to 'active' (a row-locked CAS), so two concurrent
    // confirms (or a confirm that races the expiry reclaimer closing the realm)
    // cannot both proceed. A null return means the realm was already activated or
    // reclaimed: roll back so a payment landing past the TTL boundary never records
    // a purchase against a closed/active realm.
    const activated = await activateRealm(client, quote.realmId);
    if (!activated) {
      await client.query('ROLLBACK');
      return fail(409, 'realm_unavailable');
    }
    await insertRealmPurchase(client, {
      realmId: quote.realmId,
      accountId: quote.accountId,
      buyerWallet: quote.buyerWallet,
      currency: quote.currency,
      totalBase: quote.totalBase,
      treasuryBase: quote.treasuryBase,
      buybackBase: quote.buybackBase,
      tier: quote.tier,
      payTxSig: args.paySig,
    });
    await addRealmRole(client, quote.realmId, quote.accountId, 'owner', quote.accountId);
    if (bondEnabled() && quote.bondBase > 0n) {
      await createRealmBond(client, {
        realmId: quote.realmId,
        accountId: quote.accountId,
        bondBase: quote.bondBase,
        graceUntil: bondGraceUntil,
      });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    // UNIQUE(realm_id) or UNIQUE(pay_tx_sig): this realm was already bought, or this
    // exact payment was already recorded. Consume the quote so it cannot be retried.
    if (isUniqueViolation(err)) {
      await deleteRealmBuyQuote(pool, args.quoteId);
      return fail(409, 'payment_already_recorded');
    }
    throw err;
  } finally {
    client.release();
  }

  await deleteRealmBuyQuote(pool, args.quoteId);
  return { ok: true, realmId: quote.realmId, tier: quote.tier };
}
