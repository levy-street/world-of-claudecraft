// Client-side state + pure presenter for the $WOC reward-season HUD panel.
//
// The active season + its pool are external read-only state (GET /api/woc/season,
// read from the server's flow ledger by src/net/wallet), NOT world state, so —
// exactly like the wallet balance (see wallet_balance.ts) — they don't belong on
// IWorld. To keep src/ui free of any src/net import, main.ts (the one layer that
// knows both) fetches via src/net/wallet and pushes the payload in here; the HUD
// reads it out and a single listener re-renders the panel on change.
//
// `formatSeasonView` is a PURE function (takes `nowMs`, no Date.now / DOM / t()),
// so the display logic is unit-tested in isolation; the painter
// (woc_season_panel.ts) is a thin consumer that applies t()/formatNumber.

// The /api/woc/season payload. Kept structurally identical to
// net/wallet.ts `WocSeasonResponse` (the wire contract); main.ts bridges the two.
export interface WocSeasonInfo {
  seasonId: number;
  label: string;
  status: 'active' | 'closed' | 'finalized';
  openedAt: string;
  endsAt: string | null;
  sinkBase: string; // base-unit decimal strings (can exceed Number.MAX_SAFE_INTEGER)
  emissionBase: string;
  poolBase: string;
}
export interface WocSeasonPayload {
  season: WocSeasonInfo | null;
  decimals: number;
}

export interface SeasonView {
  state: 'none' | 'active' | 'ended';
  seasonId: number | null;
  label: string;
  poolWoc: string; // exact human-readable $WOC (base units / 10^decimals)
  sinkWoc: string;
  emissionWoc: string;
  emittedPct: number; // 0..100, share of verified sinks already emitted
  countdown: { days: number; hours: number; minutes: number; totalMs: number } | null;
}

function toBig(base: string): bigint {
  return /^-?\d+$/.test(base) ? BigInt(base) : 0n;
}

/**
 * Exact base-units → human-readable $WOC string (no float rounding). Trims
 * trailing fractional zeros: '2700000000' @6 → '2700', '2700500000' @6 → '2700.5'.
 */
export function baseToWoc(base: string, decimals: number): string {
  if (!/^-?\d+$/.test(base)) return '0';
  const neg = base.startsWith('-');
  const digits = (neg ? base.slice(1) : base).replace(/^0+/, '') || '0';
  if (decimals <= 0) return (neg && digits !== '0' ? '-' : '') + digits;
  const padded = digits.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals);
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, '');
  const sign = neg && (intPart !== '0' || frac) ? '-' : '';
  return sign + (frac ? `${intPart}.${frac}` : intPart);
}

const clampPct = (n: number): number => Math.max(0, Math.min(100, n));

/**
 * Reduce a /api/woc/season payload to the view model the panel renders. `nowMs`
 * is injected (not read from the clock) so the countdown + ended/active decision
 * are deterministic and testable. A closed/finalized season, or one whose end
 * time has passed, presents as 'ended' (no countdown).
 */
export function formatSeasonView(payload: WocSeasonPayload | null, nowMs: number): SeasonView {
  const none: SeasonView = { state: 'none', seasonId: null, label: '', poolWoc: '0', sinkWoc: '0', emissionWoc: '0', emittedPct: 0, countdown: null };
  if (!payload || !payload.season) return none;
  const s = payload.season;
  const d = payload.decimals;
  const sink = toBig(s.sinkBase);
  const emission = toBig(s.emissionBase);
  const emittedPct = sink > 0n ? clampPct(Number((emission * 10000n) / sink) / 100) : 0;

  let state: SeasonView['state'] = 'active';
  let countdown: SeasonView['countdown'] = null;
  if (s.endsAt) {
    const endMs = Date.parse(s.endsAt);
    if (Number.isFinite(endMs)) {
      const totalMs = endMs - nowMs;
      if (totalMs <= 0) state = 'ended';
      else countdown = { days: Math.floor(totalMs / 86_400_000), hours: Math.floor((totalMs % 86_400_000) / 3_600_000), minutes: Math.floor((totalMs % 3_600_000) / 60_000), totalMs };
    }
  }
  if (s.status !== 'active') { state = 'ended'; countdown = null; }

  return {
    state,
    seasonId: s.seasonId,
    label: s.label,
    poolWoc: baseToWoc(s.poolBase, d),
    sinkWoc: baseToWoc(s.sinkBase, d),
    emissionWoc: baseToWoc(s.emissionBase, d),
    emittedPct,
    countdown,
  };
}

// ── UI-side state holder (main.ts pushes; the HUD reads) ──────────────────────
let payloadState: WocSeasonPayload | null = null;
let enabled = false;
let listener: (() => void) | null = null;

/** Whether the $WOC season panel is enabled in this client build (wallet on). */
export function wocSeasonUiEnabled(): boolean {
  return enabled;
}
export function setWocSeasonUiEnabled(value: boolean): void {
  if (enabled === value) return;
  enabled = value;
  listener?.();
}

/** Push the latest /api/woc/season payload (or null while unloaded/failed). */
export function setWocSeason(payload: WocSeasonPayload | null): void {
  payloadState = payload;
  listener?.();
}

/** The current view model (pure), using the supplied clock. */
export function currentSeasonView(nowMs: number): SeasonView {
  return formatSeasonView(payloadState, nowMs);
}

/** Subscribe to season-state changes (re-render the panel). One listener. */
export function onWocSeasonChange(cb: () => void): () => void {
  listener = cb;
  return () => { if (listener === cb) listener = null; };
}
