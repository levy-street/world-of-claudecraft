// Thornhollow Fields backfill rules: the pure half of "a fighter left, can a
// queued player take the empty seat".
//
// A desertion leaves the team a player down for the rest of a RATED match, and
// at BG_TEAM_SIZE 5 that is 20% of a side, closer to an arena loss than to the
// dent one leaver makes in a fifteen-a-side battleground. bgResolveDesertion
// already charges the leaver; this is the other half, repairing the match for
// the four who stayed.
//
// Everything here is a pure function of plain numbers, and the caller supplies
// the tuning values from social/battleground.ts (which owns them) rather than
// this leaf importing them back: that keeps the module graph one-directional,
// the same shape battleground_outcomes.ts has, and lets a Vitest drive every
// cutoff with no Sim, no BgMatch, and no queue. The seating itself (bodies,
// parties, events) stays in social/battleground.ts.
//
// src/sim-pure: no SimContext, no imports at all, no rng, no clock (the caller
// passes the match's own remaining seconds). Runs unchanged in Node, the
// browser, and the RL env.

/**
 * Stop backfilling once the match has this many seconds or fewer left. The
 * value matches the FIRST entry of BG_TIME_WARNINGS rather than being a fresh
 * number: once the clock has called out the closing minutes, a fighter seated
 * into a stranger's match can no longer meaningfully change it, and being
 * dropped into someone else's ending is worse than the 4v5 the team already
 * plays. Held as a literal so this leaf imports nothing; the equality with
 * BG_TIME_WARNINGS[0] is pinned by tests/battleground_backfill.test.ts.
 */
export const BG_BACKFILL_MIN_SECONDS_LEFT = 120;

/** The match facts the rules read. A view, so a test never builds a BgMatch. */
export interface BgBackfillMatchView {
  state: 'countdown' | 'active' | 'ended';
  /** Seconds of active play remaining. Caller: BG_MAX_DURATION minus elapsed. */
  secondsLeft: number;
  scores: [number, number];
  teamSizes: [number, number];
  /** A full side, BG_TEAM_SIZE. */
  teamSize: number;
  /** Captures that win the match, BG_CAPS_TO_WIN. */
  capsToWin: number;
}

/** One queued group as the picker sees it. */
export interface BgBackfillCandidate {
  size: number;
  waited: number;
}

/**
 * Which team should take a backfill seat, or null when this match must not take
 * one. Both teams short is possible after a double desertion: the emptier side
 * goes first, and team 0 breaks an exact tie, so the choice is always total and
 * never draws rng.
 */
export function bgBackfillSeat(view: BgBackfillMatchView): 0 | 1 | null {
  // The result is already recorded and the frozen scoreboard belongs to the
  // players still reading it; an arrival there would be seated into nothing.
  if (view.state === 'ended') return null;

  const short = ([0, 1] as const).filter((t) => view.teamSizes[t] < view.teamSize);
  if (short.length === 0) return null;
  let team: 0 | 1 = short[0];
  for (const t of short) if (view.teamSizes[t] < view.teamSizes[team]) team = t;

  // Form-up has no clock spent and no score yet, so nothing can be out of
  // reach: a seat open here is just a match still assembling.
  if (view.state === 'countdown') return team;

  if (view.secondsLeft <= BG_BACKFILL_MIN_SECONDS_LEFT) return null;
  // One enemy capture from over. Seating someone into a loss they cannot affect
  // is the case that makes players refuse to queue at all, which would cost
  // every later backfill too.
  const other = team === 0 ? 1 : 0;
  if (view.scores[other] >= view.capsToWin - 1) return null;
  return team;
}

/**
 * Index of the queued group that takes the seat, or -1 when none qualifies.
 *
 * SOLOS ONLY, deliberately: a seat is one wide, and splitting a queued group to
 * fill it would break the promise that a party queued together plays together
 * (the same rule startBgMatch protects when it hands seats back as whole
 * team-sized groups). Oldest wait first, queue order breaking a tie, so the
 * pick is an explicit total order rather than a lean on sort stability.
 */
export function pickBgBackfillGroup(groups: readonly BgBackfillCandidate[]): number {
  let best = -1;
  for (let i = 0; i < groups.length; i++) {
    if (groups[i].size !== 1) continue;
    if (best === -1 || groups[i].waited > groups[best].waited) best = i;
  }
  return best;
}
