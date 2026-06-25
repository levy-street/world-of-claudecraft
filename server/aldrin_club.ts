// Aldrin Club subscription: pure, IO-free domain logic. No SQL, no Solana RPC,
// no Stripe SDK, no DOM, no Date.now. Everything here is a deterministic function
// of its inputs so it is unit-testable without a database or a network (mirrors
// the wallet_link.ts / chat_filter.ts pure-core split this repo prefers).
//
// What lives here: the membership clock (active / extend), the 50/50 split math,
// the payment-quote shape + expiry, the perk catalog, and the pure verdict for an
// already-parsed on-chain payment. The IO shells consume it:
//   - server/aldrin_solana.ts   parses a finalized tx into ParsedOnchainPayment
//   - server/aldrin_buyback.ts  swaps + burns the SOL/USDC buyback split
//   - server/aldrin_stripe.ts   verifies a webhook then grants membership
//   - server/aldrin_club_db.ts  persists quotes + an immutable payment ledger
//   - server/aldrin_club_http.ts wires req/res to all of the above

export type AldrinPayMethod = 'sol' | 'usdc' | 'woc' | 'stripe';

export const ALDRIN_METHODS: readonly AldrinPayMethod[] = ['sol', 'usdc', 'woc', 'stripe'];

/** True for the on-chain rails (SOL/USDC/$WOC); false for Stripe (fiat). */
export function isCryptoMethod(method: AldrinPayMethod): boolean {
  return method === 'sol' || method === 'usdc' || method === 'woc';
}

export function isPayMethod(value: unknown): value is AldrinPayMethod {
  return typeof value === 'string' && (ALDRIN_METHODS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Perk catalog. EVERY perk is cosmetic, convenience, or access. None grant
// combat power, stats, gear bonuses, gold, XP, or progression: that is the
// project's non-negotiable "cosmetic-only / no pay-to-win" rule. The kind union
// has no 'power' member by construction, and assertNoPowerPerks() is asserted by
// the test suite so a future power perk cannot slip in unreviewed.
// ---------------------------------------------------------------------------
export type PerkKind = 'cosmetic' | 'convenience' | 'access';

export interface AldrinPerk {
  /** Stable id; the client maps it to an i18n label + description key. */
  id: string;
  kind: PerkKind;
}

export const ALDRIN_PERKS: readonly AldrinPerk[] = [
  { id: 'aura', kind: 'cosmetic' }, // the "buff": a purely visual golden aura + buff-frame icon, zero stats
  { id: 'regalia', kind: 'cosmetic' }, // the "gear access": an appearance-only transmog set, no item stats
  { id: 'mount', kind: 'cosmetic' }, // exclusive cosmetic mount appearance (reuses the mount pipeline)
  { id: 'title', kind: 'cosmetic' }, // "Member of the Aldrin Club" title
  { id: 'nameColor', kind: 'cosmetic' }, // gold nameplate color
  { id: 'lounge', kind: 'access' }, // members-only social lounge + chat channel
  { id: 'wardrobe', kind: 'convenience' }, // extra cosmetic/transmog loadout slots
  { id: 'queue', kind: 'convenience' }, // priority login queue at capacity
  { id: 'stipend', kind: 'convenience' }, // monthly cosmetic-only vanity credit (never spendable on power)
];

const ALLOWED_PERK_KINDS: ReadonlySet<PerkKind> = new Set(['cosmetic', 'convenience', 'access']);

/**
 * Invariant guard for the no-pay-to-win rule: throws if any perk is not strictly
 * cosmetic/convenience/access. Called by the test suite (and cheap enough to call
 * at boot) so adding a power perk fails loudly instead of shipping.
 */
export function assertNoPowerPerks(perks: readonly AldrinPerk[] = ALDRIN_PERKS): void {
  for (const p of perks) {
    if (!ALLOWED_PERK_KINDS.has(p.kind)) {
      throw new Error(`Aldrin perk "${p.id}" has non-allowed kind "${p.kind}" (pay-to-win is forbidden)`);
    }
  }
}

// ---------------------------------------------------------------------------
// Membership clock. Stored account-level inside accounts.cosmetics.aldrinClub
// (server-authoritative; mirrored to the client via the existing cosmetics sync).
// ---------------------------------------------------------------------------
export interface AldrinMembership {
  /** ISO of the first time this account activated. */
  since: string;
  /** ISO of current expiry. Membership is active while now < until. */
  until: string;
  /** Which rail funded the most recent activation/renewal. */
  lastMethod: AldrinPayMethod;
  /** True only for a live Stripe subscription (the only rail that auto-renews). */
  autoRenew: boolean;
}

export function membershipActive(m: AldrinMembership | null | undefined, nowMs: number): boolean {
  if (!m) return false;
  const until = Date.parse(m.until);
  return Number.isFinite(until) && until > nowMs;
}

/** Whole days of membership remaining (0 if lapsed). For display only. */
export function daysRemaining(m: AldrinMembership | null | undefined, nowMs: number): number {
  if (!m) return 0;
  const until = Date.parse(m.until);
  if (!Number.isFinite(until) || until <= nowMs) return 0;
  return Math.ceil((until - nowMs) / DAY_MS);
}

const DAY_MS = 86_400_000;

/**
 * Apply one paid period. Extends from whichever is later, now or the existing
 * expiry, so paying before lapse never burns the remaining days (and a lapsed
 * member restarts from now). `since` is preserved across renewals.
 */
export function extendMembership(
  prev: AldrinMembership | null | undefined,
  nowMs: number,
  method: AldrinPayMethod,
  periodDays: number,
  autoRenew: boolean,
): AldrinMembership {
  const prevUntil = prev ? Date.parse(prev.until) : NaN;
  const base = Number.isFinite(prevUntil) && prevUntil > nowMs ? prevUntil : nowMs;
  const until = base + periodDays * DAY_MS;
  return {
    since: prev?.since ?? new Date(nowMs).toISOString(),
    until: new Date(until).toISOString(),
    lastMethod: method,
    autoRenew,
  };
}

/**
 * Idempotent self-heal for a payment already written to the ledger whose
 * membership grant may not have persisted (e.g. the grant write failed after the
 * ledger insert committed, or a webhook redelivered). Given the granted_until
 * recorded for that payment, return a membership whose expiry is at least that
 * WITHOUT extending again, or null when the current record already covers it
 * (nothing to do). Never shortens an existing membership. This is what makes a
 * retried confirm/webhook safe: it converges to the recorded grant, never double
 * counts. `since` is preserved (or reconstructed from the period if it was lost).
 */
export function healMembership(
  current: AldrinMembership | null | undefined,
  grantedUntilISO: string | null | undefined,
  fallbackMethod: AldrinPayMethod,
  periodDays: number,
): AldrinMembership | null {
  if (!grantedUntilISO) return null;
  const target = Date.parse(grantedUntilISO);
  if (!Number.isFinite(target)) return null;
  const curUntil = current ? Date.parse(current.until) : NaN;
  if (Number.isFinite(curUntil) && curUntil >= target) return null; // already covered
  return {
    since: current?.since ?? new Date(target - periodDays * DAY_MS).toISOString(),
    until: grantedUntilISO,
    lastMethod: current?.lastMethod ?? fallbackMethod,
    autoRenew: current?.autoRenew ?? false,
  };
}

// ---------------------------------------------------------------------------
// Split math. By default 50% of a payment is removed from $WOC supply and 50%
// funds the treasury. For SOL/USDC the "burn" portion is routed to the buyback
// vault (the keeper swaps it to $WOC and burns it later); for a $WOC payment the
// "burn" portion is burned directly in the same transaction. Same arithmetic
// either way, so a single helper covers all three rails. Integer base units only.
// ---------------------------------------------------------------------------
export interface AldrinSplit {
  /** Base units bought-and-burned (SOL/USDC) or burned in-tx ($WOC). */
  splitBase: bigint;
  /** Base units credited to the treasury. */
  treasuryBase: bigint;
}

export function splitAldrinAmount(priceBase: bigint, burnBps: number): AldrinSplit {
  if (priceBase < 0n) return { splitBase: 0n, treasuryBase: 0n };
  const bps = BigInt(Math.max(0, Math.min(10000, Math.trunc(burnBps))));
  const splitBase = (priceBase * bps) / 10000n;
  return { splitBase, treasuryBase: priceBase - splitBase };
}

// ---------------------------------------------------------------------------
// Payment quote. A single-use intent the client pays against. It pins the exact
// base amount (a live FX snapshot for SOL/$WOC), the payee addresses, and a memo
// equal to the quoteId so the on-chain tx is bound to this quote and account.
// Amounts are decimal strings so the quote round-trips through JSON/JSONB without
// BigInt loss. The IO shell supplies quoteId (random) and the FX-derived
// priceBase; this builder is pure.
// ---------------------------------------------------------------------------
export interface AldrinQuote {
  quoteId: string;
  accountId: number;
  method: AldrinPayMethod;
  usdCents: number;
  /** SPL mint for usdc/woc; null for native SOL and Stripe. */
  mint: string | null;
  /** Asset decimals (9 SOL, 6 USDC, $WOC decimals); 0 for Stripe. */
  decimals: number;
  /** Total base units the payer must spend (lamports / token base units). */
  priceBase: string;
  /** Treasury payee for the treasury split; null for Stripe. */
  treasury: string | null;
  /** Buyback-vault payee for the buyback split (SOL/USDC only); null otherwise. */
  buyback: string | null;
  /** Base units to the treasury. */
  treasuryBase: string;
  /** Base units bought-and-burned (SOL/USDC) or burned in-tx ($WOC). */
  splitBase: string;
  /** Memo string the tx must carry; always equal to quoteId. */
  memo: string;
  expiresAt: string;
}

export interface BuildQuoteInput {
  quoteId: string;
  accountId: number;
  method: AldrinPayMethod;
  usdCents: number;
  mint: string | null;
  decimals: number;
  /** FX-derived total to charge, in base units (the IO shell computes this). */
  priceBase: bigint;
  treasury: string | null;
  buyback: string | null;
  burnBps: number;
  nowMs: number;
  ttlSeconds: number;
}

export function buildQuote(input: BuildQuoteInput): AldrinQuote {
  const { splitBase, treasuryBase } = splitAldrinAmount(input.priceBase, input.burnBps);
  return {
    quoteId: input.quoteId,
    accountId: input.accountId,
    method: input.method,
    usdCents: input.usdCents,
    mint: input.mint,
    decimals: input.decimals,
    priceBase: input.priceBase.toString(),
    treasury: input.treasury,
    buyback: input.buyback,
    treasuryBase: treasuryBase.toString(),
    splitBase: splitBase.toString(),
    memo: input.quoteId,
    expiresAt: new Date(input.nowMs + input.ttlSeconds * 1000).toISOString(),
  };
}

export function quoteExpired(q: Pick<AldrinQuote, 'expiresAt'>, nowMs: number): boolean {
  const t = Date.parse(q.expiresAt);
  return !Number.isFinite(t) || t <= nowMs;
}

// ---------------------------------------------------------------------------
// On-chain verdict. The Solana shell parses a finalized transaction into this
// normalized summary; this function decides whether it satisfies the quote.
// Splitting parse (IO) from judgement (pure) is what makes the accept/reject
// rules exhaustively testable with hand-built fixtures.
// ---------------------------------------------------------------------------
export interface ParsedOnchainPayment {
  finalized: boolean;
  succeeded: boolean;
  /** The asset mint is held under Token-2022 in this tx (reject SPL look-alikes). */
  usesToken2022: boolean;
  /** A memo instruction exactly equal to the quote memo is present. */
  memoMatches: boolean;
  /** Payer's net outflow of the asset (base units, positive). */
  payerSpentBase: bigint;
  /** Base units credited to the treasury payee. */
  treasuryCreditedBase: bigint;
  /** Base units credited to the buyback vault (SOL/USDC). */
  buybackCreditedBase: bigint;
  /** Base units burned by the payer in this tx ($WOC direct burn). */
  burnedBase: bigint;
}

export type AldrinVerdict = { ok: true } | { ok: false; reason: string };

const reject = (reason: string): AldrinVerdict => ({ ok: false, reason });

/**
 * Decide whether a parsed on-chain payment satisfies the quote. Reasons are
 * stable machine codes the HTTP layer maps to a localized message (and a "retry"
 * hint for `not_finalized`). The handler still owns the tx-signature replay guard
 * (a UNIQUE column in the payment ledger).
 */
export function verifyAldrinPayment(q: AldrinQuote, p: ParsedOnchainPayment): AldrinVerdict {
  if (!isCryptoMethod(q.method)) return reject('not_onchain');
  const priceBase = BigInt(q.priceBase);
  const treasuryBase = BigInt(q.treasuryBase);
  const splitBase = BigInt(q.splitBase);

  if (priceBase <= 0n) return reject('bad_price');
  if (!p.finalized) return reject('not_finalized');
  if (!p.succeeded) return reject('tx_failed');
  if (q.mint && p.usesToken2022) return reject('token_2022');
  if (!p.memoMatches) return reject('memo_mismatch');
  if (p.payerSpentBase < priceBase) return reject('underpaid');
  if (treasuryBase > 0n && p.treasuryCreditedBase < treasuryBase) return reject('treasury_short');

  if (q.method === 'woc') {
    if (splitBase > 0n && p.burnedBase < splitBase) return reject('burn_missing');
  } else {
    // sol / usdc: the buyback split must land in the disclosed buyback vault.
    if (splitBase > 0n && p.buybackCreditedBase < splitBase) return reject('buyback_short');
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// USD -> base-unit conversion for a quoted FX rate. `usdPerAsset` is the price of
// one whole asset unit in USD (e.g. 150 for SOL, 1 for USDC, 0.0004 for $WOC).
// Returns ceil(base units) so rounding never underprices the membership.
// ---------------------------------------------------------------------------
export function usdCentsToAssetBase(usdCents: number, usdPerAsset: number, decimals: number): bigint {
  if (!Number.isFinite(usdCents) || usdCents <= 0) return 0n;
  if (!Number.isFinite(usdPerAsset) || usdPerAsset <= 0) return 0n;
  const wholeAssets = usdCents / 100 / usdPerAsset;
  const base = Math.ceil(wholeAssets * 10 ** decimals);
  return base > 0 ? BigInt(base) : 0n;
}

// Fail loud at import (server boot, and in the test suite) if a perk ever becomes
// pay-to-win. Cheap, and the whole point is that this cannot ship unnoticed.
assertNoPowerPerks();
