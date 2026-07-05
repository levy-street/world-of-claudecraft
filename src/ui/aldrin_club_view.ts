// Aldrin Club membership panel, pure view core (PR #938). Maps the server's
// GET /api/aldrin status plus the client wallet's signing capability into the
// render model the thin modal (aldrin_club_window.ts) paints. The input types
// are structural mirrors of the wire shapes in src/net/online.ts: a pure core
// must not import from src/net, so the Api results assign here structurally.
//
// DOM-free, i18n-free, deterministic: the wall clock arrives as nowMs, so the
// same input always yields the same model (registered in UI_PURE_CORES,
// tests/architecture.test.ts). Fail-closed by construction: a null status (the
// server 404s while ALDRIN_ENABLED is off, or the fetch failed) renders every
// payment method unavailable and the club as disabled.

export type AldrinMethodId = 'sol' | 'usdc' | 'woc' | 'stripe';

/** Fixed display order; unavailable methods still render, with their reason. */
export const ALDRIN_METHOD_ORDER: readonly AldrinMethodId[] = ['sol', 'usdc', 'woc', 'stripe'];

export interface AldrinStatusInput {
  enabled: boolean;
  priceUsdCents: number;
  periodDays: number;
  /** Basis points of every payment that are bought-and-burned (5000 = 50%). */
  burnBps: number;
  /** Methods the server has configured (payees funded, Stripe keys present). */
  methods: string[];
  perks: Array<{ id: string; kind: string }>;
  membership: {
    active: boolean;
    since: string;
    until: string;
    daysRemaining: number;
    autoRenew: boolean;
    lastMethod: string;
  } | null;
}

export interface AldrinQuoteInput {
  method: string;
  decimals: number;
  /** Base units (lamports / token base units), decimal string. */
  priceBase: string;
  treasuryBase: string;
  splitBase: string;
  memo: string;
  expiresAt: string;
}

export interface AldrinViewInput {
  /** null: the server reported the feature disabled or the fetch failed. */
  status: AldrinStatusInput | null;
  /** The quote currently on display, if one was fetched. */
  quote: AldrinQuoteInput | null;
  /**
   * True only when the connected wallet can sign transactions. On this branch
   * the wallet link is signMessage-only, so the window always passes false and
   * every crypto method renders unavailable with the walletCannotSign reason.
   */
  walletCanSignTransactions: boolean;
  /** True when the server advertises the Stripe rail (ANDed with its methods list). */
  stripeEnabled: boolean;
  /** Injected wall clock (this core never reads Date.now). */
  nowMs: number;
}

export type AldrinMethodReason = 'clubDisabled' | 'walletCannotSign' | 'notConfigured';

export interface AldrinMethodModel {
  method: AldrinMethodId;
  available: boolean;
  reason: AldrinMethodReason | null;
}

export interface AldrinQuoteModel {
  method: AldrinMethodId;
  /** Whole asset units to pay (display only; base units scaled by decimals). */
  amountUnits: number;
  decimals: number;
  treasuryUnits: number;
  burnUnits: number;
  /** Integer percents of the split, derived from the quote's own base amounts. */
  treasuryPct: number;
  burnPct: number;
  memo: string;
  expired: boolean;
  /** Whole seconds until expiry at nowMs (0 when expired); static text, no timer. */
  expiresInSeconds: number;
}

export interface AldrinClubModel {
  enabled: boolean;
  member: boolean;
  memberUntilISO: string | null;
  memberDaysRemaining: number;
  autoRenew: boolean;
  priceUsdCents: number;
  periodDays: number;
  /** Split percents advertised by the server (burnBps / 100 and its complement). */
  burnPct: number;
  treasuryPct: number;
  perks: Array<{ id: string; kind: string }>;
  methods: AldrinMethodModel[];
  quote: AldrinQuoteModel | null;
}

const DAY_MS = 86_400_000;

function isMethodId(value: string): value is AldrinMethodId {
  return value === 'sol' || value === 'usdc' || value === 'woc' || value === 'stripe';
}

function baseToUnits(base: string, decimals: number): number {
  const n = Number(base);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n / 10 ** decimals;
}

function methodModel(
  method: AldrinMethodId,
  status: AldrinStatusInput | null,
  walletCanSignTransactions: boolean,
  stripeEnabled: boolean,
): AldrinMethodModel {
  if (!status?.enabled) return { method, available: false, reason: 'clubDisabled' };
  const advertised = status.methods.includes(method);
  if (method === 'stripe') {
    // Fail closed both ways: the server must advertise the rail AND the caller
    // must confirm it (they are the same signal today; the AND keeps a future
    // mismatch unavailable rather than clickable).
    return advertised && stripeEnabled
      ? { method, available: true, reason: null }
      : { method, available: false, reason: 'notConfigured' };
  }
  if (!advertised) return { method, available: false, reason: 'notConfigured' };
  if (!walletCanSignTransactions) return { method, available: false, reason: 'walletCannotSign' };
  return { method, available: true, reason: null };
}

function quoteModel(quote: AldrinQuoteInput | null, nowMs: number): AldrinQuoteModel | null {
  if (!quote || !isMethodId(quote.method)) return null;
  const expiresMs = Date.parse(quote.expiresAt);
  const expiresInSeconds = Number.isFinite(expiresMs)
    ? Math.max(0, Math.floor((expiresMs - nowMs) / 1000))
    : 0;
  const price = Number(quote.priceBase);
  const split = Number(quote.splitBase);
  const treasury = Number(quote.treasuryBase);
  const burnPct =
    Number.isFinite(price) && price > 0 && Number.isFinite(split)
      ? Math.round((split / price) * 100)
      : 0;
  const treasuryPct =
    Number.isFinite(price) && price > 0 && Number.isFinite(treasury)
      ? Math.round((treasury / price) * 100)
      : 0;
  return {
    method: quote.method,
    amountUnits: baseToUnits(quote.priceBase, quote.decimals),
    decimals: quote.decimals,
    treasuryUnits: baseToUnits(quote.treasuryBase, quote.decimals),
    burnUnits: baseToUnits(quote.splitBase, quote.decimals),
    treasuryPct,
    burnPct,
    memo: quote.memo,
    expired: expiresInSeconds <= 0,
    expiresInSeconds,
  };
}

export function buildAldrinClubModel(input: AldrinViewInput): AldrinClubModel {
  const status = input.status?.enabled ? input.status : null;
  const membership = status?.membership ?? null;
  // Recompute activity from the expiry against the injected clock rather than
  // trusting the snapshot's `active` flag (the status may be minutes old).
  const untilMs = membership ? Date.parse(membership.until) : Number.NaN;
  const member = Number.isFinite(untilMs) && untilMs > input.nowMs;
  const burnBps = status ? Math.max(0, Math.min(10_000, status.burnBps)) : 0;
  const burnPct = Math.round(burnBps / 100);
  return {
    enabled: status !== null,
    member,
    memberUntilISO: member && membership ? membership.until : null,
    memberDaysRemaining: member ? Math.ceil((untilMs - input.nowMs) / DAY_MS) : 0,
    autoRenew: member ? (membership?.autoRenew ?? false) : false,
    priceUsdCents: status?.priceUsdCents ?? 0,
    periodDays: status?.periodDays ?? 0,
    burnPct,
    treasuryPct: status ? 100 - burnPct : 0,
    perks: status ? status.perks.map((p) => ({ id: p.id, kind: p.kind })) : [],
    methods: ALDRIN_METHOD_ORDER.map((m) =>
      methodModel(m, status, input.walletCanSignTransactions, input.stripeEnabled),
    ),
    quote: status ? quoteModel(input.quote, input.nowMs) : null,
  };
}
