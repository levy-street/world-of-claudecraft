// Mountain's Wrath's floor as numbers (the team's playtest of 2026-11-25):
// the Wrath is ARENA-WIDE (encounters/smith_heart/council_wrath.ts landWrath:
// every player on the council's floor, wherever the caster stands), so its
// warning is the whole Quarry, never a ring round the caster. The generic
// trash-engine sight field (a 45 yd ring with line-of-sight wedges) said the
// wrong thing twice over: an edge a raider could stand past, and shadows that
// were not the sim's shelter (the fixed ring round each pillar,
// council_shelter_fx.ts); it is off for the council (the kit's `ownFloor`).
//
//   The floor   a faint lethal tint over the whole pit, swept out from the
//               middle with the bar (the bar's fill, the timing the raid
//               reads), a slow hatch drifting in it; kept LOW so every mark,
//               soak and the shelters read on top (it lies under them all).
//   The edge    a crisp lethal line round the pit's rim: the blast reaches
//               all of it.
//   The blow    a room-sized shockwave from the middle to the rim.
//
// Every layer on every tier (the field IS the warning); reduced motion holds
// the hatch still. Three-free, DOM-free, deterministic.

import { HAMMER_PIT } from '../../sim/content/smith_heart_layout';
import { TELEGRAPH_THREAT_COLORS } from '../floor_telegraph/telegraph_look_core';

export const WRATH_FIELD = {
  /** The pit's own ellipse plus its worked rim and the stair's foot. */
  rx: HAMMER_PIT.rx + 2,
  rz: HAMMER_PIT.rz + 2,
  /** Draped stations: rings out from the middle, stations round. */
  rings: 12,
  around: 128,
  /** Lift over the floor (yards). */
  lift: 0.1,
  color: TELEGRAPH_THREAT_COLORS.lethal,
  /** The tint behind the sweep at its strongest (low: telegraphs on top;
   *  0.16 read as a heavy red wash in the capture of 2026-11-25). */
  tint: 0.09,
  /** The edge's strength. */
  edge: 0.9,
  /** The landing's shockwave: seconds, and its look (a room-sized wave). */
  blowSeconds: 0.75,
  blowLook: { wake: 0.45, crest: 0.06, strength: 0.85 },
} as const;

export interface WrathFieldLook {
  /** The sweep's front, 0 (the middle) to 1 (the rim). */
  front: number;
  tint: number;
  edge: number;
  /** The hatch's drift (0 under reduced motion). */
  drift: number;
}

/** The field at the bar's `fill` (0 begun, 1 landing). Fills `out`. */
export function wrathFieldLook(
  fill: number,
  reduced: boolean,
  out: WrathFieldLook,
): WrathFieldLook {
  const f = Math.max(0, Math.min(1, fill));
  // The sweep reaches the rim a little before the blow: the whole floor is
  // lit for the last of the bar.
  out.front = Math.min(1, f / 0.8);
  out.tint = WRATH_FIELD.tint * (0.55 + 0.45 * f);
  out.edge = WRATH_FIELD.edge * Math.min(1, 0.6 + f * 2);
  out.drift = reduced ? 0 : 1;
  return out;
}

/** A station of the field: ring `k` of WRATH_FIELD.rings out (0 the middle,
 *  1 the rim), `u` round (0..1), round the pit's middle at (cx, cz). */
export function wrathFieldPoint(
  cx: number,
  cz: number,
  k: number,
  u: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  const a = u * Math.PI * 2;
  out.x = cx + Math.sin(a) * WRATH_FIELD.rx * k;
  out.z = cz + Math.cos(a) * WRATH_FIELD.rz * k;
  return out;
}
