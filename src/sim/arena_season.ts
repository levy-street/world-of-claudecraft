// The ranked Arena season calendar: a pure, host-agnostic clock over the Ashen
// Coliseum's six-month competitive seasons.
//
// A season is a real-world window, not a sim-clock one, so nothing here reads a
// clock: every entry point takes the instant (UTC epoch milliseconds) as an
// argument and is a pure function of it. That is what lets the SAME calendar
// serve all three consumers without any of them re-deriving the boundaries:
// - `server/arena_season_settlement.ts` decides which season has closed and is
//   still unsettled (the authoritative award path),
// - `src/ui/arena_season_view.ts` renders the header countdown from the browser
//   clock (presentation only),
// - the tests pin the boundaries as literals.
//
// It lives in src/sim/ for the same reason `leaderboard_page.ts` does: it is
// shared, deterministic rule-of-the-world code that both the server and the
// client must agree on byte for byte. The sim ITSELF never calls it (the sim has
// no wall clock); the season's only reach into gameplay is the Book of Deeds
// title the server awards at settlement.
//
// Month arithmetic is UTC calendar arithmetic, not a fixed millisecond stride,
// so a season always opens at 00:00 UTC on the first of a month regardless of
// month lengths or leap years. `Date.UTC` and `new Date(ms)` are both pure
// functions of their arguments (unlike `Date.now()` / `new Date()`), so this
// file stays inside the sim's determinism invariant.

/** A season runs half a calendar year. */
export const ARENA_SEASON_LENGTH_MONTHS = 6;

/**
 * The two RANKED brackets a season settles, in display order. Deliberately a
 * narrow pair rather than `ArenaFormat`: Fiesta and the Protect Yumi brackets
 * are unranked play that never moves the Elo ladder (see `social/arena.ts`
 * `endArenaMatch`), so they can never crown a champion, and a `Record` keyed on
 * this type makes that exhaustive by construction instead of by convention.
 */
export const ARENA_SEASON_BRACKETS = ['1v1', '2v2'] as const;

export type ArenaSeasonBracket = (typeof ARENA_SEASON_BRACKETS)[number];

/**
 * When Season 1, the inaugural season, opens: 2026-08-01T00:00:00Z.
 *
 * MAINTAINER KNOB. Anchoring the calendar on a single constant is what keeps
 * every boundary derivable rather than authored ten times; moving it shifts the
 * whole schedule. Move it only BEFORE Season 1 opens: once a season has been
 * settled, its awards are persisted against a season NUMBER, and re-anchoring
 * would re-point that number at a different window.
 */
export const ARENA_SEASON_EPOCH_MS = Date.UTC(2026, 7, 1);

/**
 * The index reported before the epoch. Preseason play is unranked in the
 * seasonal sense: ratings still move (the all-time ladder is untouched by
 * seasons), but no title is on offer and nothing settles.
 */
export const ARENA_PRESEASON = 0;

const EPOCH_YEAR = new Date(ARENA_SEASON_EPOCH_MS).getUTCFullYear();
const EPOCH_MONTH = new Date(ARENA_SEASON_EPOCH_MS).getUTCMonth();

/** True for a real, 1-based season index (Preseason and junk are not). */
export function isArenaSeasonIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 1;
}

/** The instant season `index` opens. Season 1 opens at the epoch. */
export function arenaSeasonStartMs(index: number): number {
  if (!isArenaSeasonIndex(index)) return ARENA_SEASON_EPOCH_MS;
  return Date.UTC(EPOCH_YEAR, EPOCH_MONTH + (index - 1) * ARENA_SEASON_LENGTH_MONTHS, 1);
}

/** The instant season `index` closes, which is exactly when the next one opens. */
export function arenaSeasonEndMs(index: number): number {
  return arenaSeasonStartMs(index + 1);
}

/**
 * The season live at `nowMs`, or `ARENA_PRESEASON` before the epoch. Half-open
 * by construction: an instant exactly on a boundary belongs to the season that
 * is OPENING, never the one that just closed, so no instant is scored twice.
 */
export function arenaSeasonIndexAt(nowMs: number): number {
  if (!Number.isFinite(nowMs) || nowMs < ARENA_SEASON_EPOCH_MS) return ARENA_PRESEASON;
  const at = new Date(nowMs);
  const months = (at.getUTCFullYear() - EPOCH_YEAR) * 12 + (at.getUTCMonth() - EPOCH_MONTH);
  return Math.floor(months / ARENA_SEASON_LENGTH_MONTHS) + 1;
}

/**
 * The highest season that has fully CLOSED by `nowMs`, or 0 when none has. This
 * is the settlement driver's whole clock question: every season from 1 to this
 * number is eligible to be settled, and the persisted settlement marker decides
 * which of them actually still need it.
 */
export function lastClosedArenaSeasonAt(nowMs: number): number {
  return Math.max(0, arenaSeasonIndexAt(nowMs) - 1);
}

/** A resolved season window: what the header renders and what settlement scores. */
export interface ArenaSeasonWindow {
  /** 1-based season number, or `ARENA_PRESEASON` before the calendar opens. */
  index: number;
  /** Inclusive open instant (the epoch while in Preseason). */
  startMs: number;
  /** Exclusive close instant. */
  endMs: number;
  /** Milliseconds left before the close, clamped at 0. */
  remainingMs: number;
  /** How far through the window `nowMs` sits, clamped to 0..1. */
  elapsedFrac: number;
  /** True before the epoch, when no season is live. */
  preseason: boolean;
}

/** Resolve the full window around `nowMs` in one pass (the view-model input). */
export function arenaSeasonWindowAt(nowMs: number): ArenaSeasonWindow {
  const index = arenaSeasonIndexAt(nowMs);
  const preseason = index === ARENA_PRESEASON;
  const startMs = preseason ? ARENA_SEASON_EPOCH_MS : arenaSeasonStartMs(index);
  const endMs = preseason ? ARENA_SEASON_EPOCH_MS : arenaSeasonEndMs(index);
  const span = Math.max(1, endMs - startMs);
  const clock = Number.isFinite(nowMs) ? nowMs : startMs;
  return {
    index,
    startMs,
    endMs,
    // In Preseason the countdown runs to the epoch instead (the header shows
    // "opens in"), so the caller never has to special-case a negative span.
    remainingMs: Math.max(0, (preseason ? ARENA_SEASON_EPOCH_MS : endMs) - clock),
    elapsedFrac: preseason ? 0 : Math.max(0, Math.min(1, (clock - startMs) / span)),
    preseason,
  };
}
