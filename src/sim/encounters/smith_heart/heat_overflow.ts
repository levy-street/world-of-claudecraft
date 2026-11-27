// The Guardian of the Heat's overflows (docs/design/raid/smith_heart.md
// section 7.4), at 70 and at 40 percent.
//
//   It sinks         2.5 s: the guardian sinks into the wellspring, out of
//                    reach (nobody's target, nothing harms it).
//   The overflow     the Hearth overflows: rings of lava roll out of the
//                    wellspring one after another, each parting in two
//                    corridors the raid must stand in as it passes
//                    (heat_waves.ts, the rework of 2026-11-18 in place of the
//                    rivers), and every 3 s Falling Cinders strike random
//                    players (heal through them). It lasts as long as its
//                    rings (about 22 to 25 s). Heroic: the Wellspawn climb
//                    out at the room's edge and walk to the wellspring all
//                    the while (and at 40 percent two Wellkeepers rise;
//                    heat_wellspawn.ts); Normal: two slower Wellspawn in the
//                    first overflow only. Those still walking at the end dive
//                    in and feed it.
//   It rises         3 s, still out of reach, then the next phase begins.
//
// Deterministic: the corridors and the bolts' players are hashed; the only
// rng draws are the damage rolls, in player order.

import { DT, type Entity } from '../../types';
import { HEAT_CUES, HEAT_NAMES, HEAT_TUNING as T } from './heat_ids';
import { cueOn, fireHit, type HeatScope, pickPlayers, roll } from './heat_scope';
import type { HeatOverflow } from './heat_state';
import { clearWaves, startWaves, stepWaves, wavesDone } from './heat_waves';

/** A fresh overflow's own state (its clocks). */
export function freshOverflow(n: 1 | 2): HeatOverflow {
  return {
    n,
    clock: 0,
    boltIn: T.boltFirst,
    volleys: 0,
    planned: 0,
    launched: 0,
    rings: [],
    next: null,
  };
}

/** A volley of Falling Cinders on hashed players. Returns who. */
export function volley(s: HeatScope, o: HeatOverflow): Entity[] {
  const hit = pickPlayers(s, s.rules.bolts, 400 + o.volleys);
  o.volleys++;
  for (const p of hit) {
    cueOn(s, p, HEAT_CUES.bolt);
    fireHit(s, p, roll(s, T.boltMin, T.boltMax), HEAT_NAMES.bolt);
  }
  return hit;
}

/** The guardian is under: the first ring's corridors glow. */
export function beginFlood(s: HeatScope, o: HeatOverflow): void {
  startWaves(s, o);
}

/** One tick of the Hearth overflowing (the rings and the bolts). */
export function stepFlood(s: HeatScope, o: HeatOverflow): void {
  o.clock += DT;
  o.boltIn -= DT;
  if (o.boltIn <= 1e-9) {
    o.boltIn += T.boltEvery;
    volley(s, o);
  }
  stepWaves(s, o);
}

/** The overflow has run its course: every ring has rolled past the walls. */
export function floodDone(o: HeatOverflow): boolean {
  return wavesDone(o);
}

/** Every ring and corridor off the floor. */
export function clearFlood(s: Pick<HeatScope, 'ctx' | 'inst'>, o: HeatOverflow | null): void {
  clearWaves(s, o);
}
