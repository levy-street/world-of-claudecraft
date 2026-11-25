// The Hammer Council's cover guard (docs/design/raid/smith_heart.md section
// 7.1, "The cover guard"; the team's playtest of 2026-11-25: "after the melee
// boss died, the giant AoE once in a while came with no pillars").
//
// Every Wrath after the first takes the cover the last one left none of, so
// between two Wraths Wake the Stone must have its turn:
//
//   Owed      a Wrath landing owes the next one a Wake (`coverOwed`). The
//             next Wrath does not begin, however full the energy, until a
//             Wake bar has landed (its marks placed) or been kicked, and
//             while its marks are still on the floor (the pillars not yet
//             up) it waits too.
//   Bare      a full Wrath with NO shelter pillar standing (the rock or the
//             Rush took the last of them) waits for one more Wake, unless
//             the raid kicked a Wake since the last Wrath: the kick is the
//             raid's choice (the review of 2026-11-09), never undone here.
//   Forced    while the Wrath waits on cover the Wake is due at once, past
//             its own clock and Normal's Wrath guard (council_floor.ts
//             clearOfWrath, which would otherwise hold it behind the very
//             Wrath it must come before); the floor gap still spaces it.
//   Bounded   a Wrath waits at most COUNCIL_TUNING.coverHoldMax seconds
//             (a member stunned or silenced past it), and never when nobody
//             holds the pillars (the Singer fallen and her soul still in
//             flight, or a tier whose survivor never takes them up).
//
// The first Wrath of a pull owes nothing: the five carved columns are its
// cover. The energy waits full (the bar's cadence resumes when it lands).
// Zero rng; the clock is the fight's own.

import { DT } from '../../types';
import { COUNCIL_CASTS, COUNCIL_ROLES, COUNCIL_TUNING as T } from './council_ids';
import { councilPillars } from './council_pillars';
import { type CouncilScope, jobHolder } from './council_scope';
import type { CouncilFightState } from './council_state';

/** A Wrath landed: the next one is owed a Wake. */
export function oweCover(st: CouncilFightState): void {
  st.coverOwed = true;
  st.coverKicked = false;
  st.coverHeld = 0;
}

/** A Wake bar landed (its marks go on) or was kicked: the debt is paid. */
export function payCover(st: CouncilFightState, kicked: boolean): void {
  st.coverOwed = false;
  if (kicked) st.coverKicked = true;
}

/** A Wake on its way: its bar running, or its marks still on the floor. */
export function wakeInFlight(s: Pick<CouncilScope, 'st'>): boolean {
  if (s.st.wakeMarks.length > 0) return true;
  for (const r of COUNCIL_ROLES) if (s.st.bars[r]?.castId === COUNCIL_CASTS.wake) return true;
  return false;
}

/** Shelter pillars standing (a carved column or a risen one; the cursed
 *  pillar and a soul's shelter nobody from the Wrath). */
export function shelterPillars(s: Pick<CouncilScope, 'ctx' | 'inst'>): number {
  let n = 0;
  for (const p of councilPillars(s.ctx, s.inst)) if (!p.cursed && p.soul === null) n++;
  return n;
}

/** Does the next Wrath wait for cover now? */
export function wrathWaitsForCover(s: CouncilScope): boolean {
  const st = s.st;
  if (st.coverHeld >= T.coverHoldMax - 1e-9) return false;
  // Nobody can raise a pillar: waiting would only delay the blow.
  if (!jobHolder(s, 'pillars')) return false;
  if (wakeInFlight(s)) return true;
  if (st.coverKicked) return false;
  if (st.coverOwed) return true;
  return shelterPillars(s) === 0;
}

/** Should a Wake start now, past its clock and the Wrath guard, because a
 *  full Wrath waits for it? (`wrathFull`: the energy is full.) */
export function wakeForcedByCover(s: CouncilScope, wrathFull: boolean): boolean {
  return wrathFull && !wakeInFlight(s) && wrathWaitsForCover(s);
}

/** One tick a full Wrath spent waiting for cover (the bound's clock). */
export function noteCoverHold(st: CouncilFightState): void {
  st.coverHeld += DT;
}
