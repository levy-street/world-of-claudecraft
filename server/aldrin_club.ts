// Aldrin Club subscription: pure, IO-free domain logic. No SQL, no Solana RPC,
// no Stripe SDK, no DOM, no Date.now. Everything here is a deterministic function
// of its inputs so it is unit-testable without a database or a network (mirrors
// the wallet_link.ts / chat_filter.ts pure-core split this repo prefers).
//
// SPLIT ARCHITECTURE (#938): the money logic (FX pricing, the 50/50 treasury +
// buy-and-burn split, on-chain payment verification, Stripe signature
// verification) MOVED to the economy service. This module now owns only what the
// game still owns: the membership clock (active / extend / heal), the perk
// catalog, the method guards, and the local payment-quote shape the ledger
// persists (the amounts on that quote are service-authoritative, mirrored, never
// recomputed here). The IO shells consume it:
//   - server/subscription_proxy.ts proxies pricing + verification to the service
//   - server/aldrin_club_db.ts     persists quotes + an immutable payment ledger
//   - server/aldrin_club_http.ts   wires req/res to the service + the local grant

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
      throw new Error(
        `Aldrin perk "${p.id}" has non-allowed kind "${p.kind}" (pay-to-win is forbidden)`,
      );
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
// Payment quote. A single-use intent the client pays against. It pins the exact
// base amount (a live FX snapshot for SOL/$WOC, computed by the economy service),
// the payee address, and a memo (the service subscriptionId) so the on-chain tx
// is bound to this quote and account. Amounts are decimal strings so the quote
// round-trips through JSON/JSONB without BigInt loss. Every amount is
// service-authoritative: the HTTP shell fills this shape from the service quote
// and the game recomputes nothing.
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

export function quoteExpired(q: Pick<AldrinQuote, 'expiresAt'>, nowMs: number): boolean {
  const t = Date.parse(q.expiresAt);
  return !Number.isFinite(t) || t <= nowMs;
}

// Fail loud at import (server boot, and in the test suite) if a perk ever becomes
// pay-to-win. Cheap, and the whole point is that this cannot ship unnoticed.
assertNoPowerPerks();
