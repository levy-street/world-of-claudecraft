// The Masterless Strength's woken stars (docs/design/raid/smith_heart.md
// section 7.5, the owner's rework of 2026-11-18): the first time the boss
// enters a quarter, that quarter's guardian's star mechanic WAKES and stays
// awake for the rest of the fight, piling up in the order the raid drags it
// round:
//   Hammer  Wake the Stone (final_pillars.ts)
//   Breath  Sky Strike (final_sky.ts)
//   Quench  Crossing Blade (final_blades.ts)
//   Heat    Fire Whirl (final_heat.ts)
// The star of the quarter it stands in runs at full pace; the others at
// FINAL_TUNING.reducedPace (their clocks count down slower); a quarter a
// Splinter poured in (it survived its call) runs at full pace for good; the
// final phase runs all four at FINAL_TUNING.finalPace (quarterPace). A star
// due through Weight of the Anvil's bar waits for it to fall. Through
// a stride and a call every star holds still (what is already on the floor
// runs out; the charged pillars hold their pulse).
//
// Deterministic: no draw here (the stars' own picks are hashed).

import type { SmithHeartVein } from '../../content/smith_heart_layout';
import { HEART_QUARTER_ORDER, heartQuarterSpot } from '../../content/smith_heart_quarters';
import { DT, type Entity } from '../../types';
import { clearBlades, startBlades, stepBlades } from './final_blades';
import { raiseWhirls } from './final_heat';
import {
  FINAL_CUES,
  FINAL_STAR_CLOCK,
  FINAL_STARS,
  quarterPace,
  FINAL_TUNING as T,
} from './final_ids';
import { clearPillars, raisePillars, stepPillars } from './final_pillars';
import { cueAt, dropFightObject, type FinalScope } from './final_scope';
import { clearSky, skyVolley, stepSky } from './final_sky';
import type { FinalStarsState } from './final_state';

/** No star awake, nothing on the floor. */
export function freshStars(): FinalStarsState {
  return {
    awake: [],
    clock: { breath: 0, quench: 0, hammer: 0, heat: 0 },
    pillars: [],
    rises: [],
    strikes: [],
    blade: null,
    bladeQueue: [],
    chargedTimer: T.chargedEvery,
    volleys: 0,
    thrums: 0,
    shattered: 0,
    charges: 0,
  };
}

/** Is `vein`'s star awake? */
export function starAwake(s: Pick<FinalScope, 'st'>, vein: SmithHeartVein): boolean {
  return s.st.stars.awake.includes(vein);
}

/** Wake `vein`'s star (the boss entered its quarter, a Splinter poured it
 *  in, the final phase, a dev verb). Returns true when it was asleep. */
export function wakeStar(s: FinalScope, vein: SmithHeartVein): boolean {
  const st = s.st.stars;
  if (st.awake.includes(vein)) return false;
  st.awake.push(vein);
  st.clock[vein] = FINAL_STAR_CLOCK[vein].first;
  const spot = heartQuarterSpot(vein);
  cueAt(s, FINAL_CUES.wake, spot.x, spot.z, 20, 'arcane');
  return true;
}

/** The pace `vein`'s star runs at now (0 asleep). */
export function starPace(s: Pick<FinalScope, 'st'>, vein: SmithHeartVein): number {
  if (!starAwake(s, vein)) return 0;
  const ph = s.st.phase;
  return quarterPace({
    finalPhase: ph.stage === 'final' || ph.stage === 'collapse',
    here: s.st.zone === vein,
    poured: ph.poured[vein] > 0,
  });
}

/** Fire `vein`'s star now (exported for the dev verbs). Returns how many
 *  things it laid. */
export function fireStar(s: FinalScope, vein: SmithHeartVein): number {
  switch (FINAL_STARS[vein]) {
    case 'pillars':
      return raisePillars(s);
    case 'sky':
      return skyVolley(s);
    case 'blades':
      return startBlades(s).length;
    default:
      return raiseWhirls(s);
  }
}

/** One tick of every awake star's clock (`running`: the fight or the final
 *  phase; held still through a stride and a call). */
export function stepStarClocks(s: FinalScope, running: boolean): void {
  if (!running) return;
  const st = s.st.stars;
  for (const vein of HEART_QUARTER_ORDER) {
    const pace = starPace(s, vein);
    if (pace <= 0) continue;
    st.clock[vein] -= DT * pace;
    if (st.clock[vein] > 1e-9) continue;
    // Through Weight of the Anvil's bar the stars hold their next fall (the
    // bot raid of 2026-11-18: a strike, a whirl, a line or a pillar laid on
    // the stacked soakers killed them): the raid gathers, then it comes.
    if (s.st.anvil) {
      st.clock[vein] = 0;
      continue;
    }
    // A round of blades still flying waits for its last line.
    if (FINAL_STARS[vein] === 'blades' && (st.blade || st.bladeQueue.length > 0)) {
      st.clock[vein] = 0;
      continue;
    }
    st.clock[vein] = FINAL_STAR_CLOCK[vein].every;
    fireStar(s, vein);
  }
}

/** One tick of what the stars laid (it runs out whatever the stage). */
export function stepStarFloor(s: FinalScope, live: boolean): void {
  stepPillars(s, live);
  stepSky(s);
  stepBlades(s);
}

/** What the stars have in flight goes (Mythic's kneel: every ability stops),
 *  the pillars standing on as the room's stone (they pulse no more while the
 *  stars hold still: final_pillars.ts stepPillars `live`). */
export function clearStarsInFlight(
  s: Pick<FinalScope, 'ctx' | 'inst' | 'st'>,
  players: readonly Entity[],
): void {
  const st = s.st.stars;
  for (const r of st.rises) dropFightObject(s.ctx, s.inst, r.objectId);
  st.rises = [];
  clearSky(s, players);
  clearBlades(s, players);
}

/** Every star's floor gone (a wipe, the kill). */
export function clearStars(
  s: Pick<FinalScope, 'ctx' | 'inst' | 'st'>,
  players: readonly Entity[],
): void {
  clearPillars(s);
  clearSky(s, players);
  clearBlades(s, players);
}

/** The awake stars as a quarter bit mask (the phase aura's, the room's). */
export function starMask(s: Pick<FinalScope, 'st'>, bit: (v: SmithHeartVein) => number): number {
  let m = 0;
  for (const v of s.st.stars.awake) m |= bit(v);
  return m;
}
