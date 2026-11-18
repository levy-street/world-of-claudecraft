// The Heart's crown ridge dressed as the Breath's own cliffs (the review of
// 2026-11-18: the bare ridge read as huge flat grey slabs behind the guardian).
// The ridge's mass (heart_mountain_core.ts heartCrownRidge) keeps the open Heart
// chamber out of sight from the east isles; over it stand the Breath's painted
// storm spires and bluffs (breath_env_plan_core.ts BREATH_ENV_ROCK: the same
// wind-carved granite, sky-blue crystal and pale lichen as every other Breath
// cliff), in two rows for depth:
//   - the crest: tall spires a little in from the chasm's rim, their tops broken
//     and staggered (a hash per spire, never one height), turned to face the
//     Cornice so their carved fronts catch its light;
//   - the shoulder: lower spires and bluffs a stride toward the Cornice, between
//     the crest's spires, so the ridge reads as a range of crags in front of
//     crags, never a wall.
// Every piece keeps a gap of air round each isle over the crown's rim (it
// stands beside an isle, never under its crag, whose point hangs near the
// isle's middle), and out of the chamber's chasm. Three-free, DOM-free, deterministic (a hash, never rng).

import {
  BREATH,
  BREATH_ISLE_REACH,
  BREATH_ISLES,
  HEART_ROOM,
  HEART_ROOM_CHASM_R,
} from '../../sim/content/smith_heart_layout';
import { BREATH_ENV_ROCK } from './breath_env_plan_core';
import type { HeartKitPlacement } from './heart_kit_core';
import { HEART_CROWN_RIDGE, heartMountainHeight } from './heart_mountain_core';
import { heartHash } from './heart_plan_core';
import { heartIsleOverCrown } from './heart_walls_core';

/** The air kept between a crag and an isle's rim (yards). */
export const HEART_ISLE_GAP = 6;

/** The two rows: yards past the chasm's rim, the bearing step from the
 *  chamber's middle (degrees), the crest's height over the Cornice's floor
 *  (from, to), each spire's width at scale 1 times (from, to), how deep its
 *  foot sinks into the mass. */
export const HEART_CROWN_SPIRES = {
  crest: { past: 5, step: 6.5, top: [78, 108], scale: [1.05, 1.5], sink: 10 },
  shoulder: { past: 12, step: 6.5, top: [52, 74], scale: [0.75, 1.1], sink: 8 },
} as const;

type Row = (typeof HEART_CROWN_SPIRES)[keyof typeof HEART_CROWN_SPIRES];

/** Is a piece of half-width `half` at (x, z) clear of every isle over the
 *  crown (its reach, the cap's reach, a margin)? */
function clearOfIsles(x: number, z: number, half: number): boolean {
  for (let i = 0; i < BREATH_ISLES.length; i++) {
    if (!heartIsleOverCrown(i)) continue;
    const isle = BREATH_ISLES[i];
    const room = BREATH_ISLE_REACH[i] + HEART_ISLE_GAP + half;
    if (Math.hypot(x - isle.x, z - isle.z) < room) return false;
  }
  return true;
}

function plan(row: Row, kind: 'crest' | 'shoulder'): HeartKitPlacement[] {
  const R = HEART_CROWN_RIDGE;
  const C = BREATH.cornice;
  const out: HeartKitPlacement[] = [];
  const first = R.deg - R.half + (kind === 'shoulder' ? row.step / 2 : 0);
  for (let deg = first; deg <= R.deg + R.half + 1e-9; deg += row.step) {
    const k = Math.round(deg * 10) + (kind === 'shoulder' ? 7001 : 0);
    const h1 = heartHash(k, 311);
    const h2 = heartHash(k + 17, 977);
    const h3 = heartHash(k - 5, 61);
    const a = ((deg + (h3 - 0.5) * row.step * 0.6) * Math.PI) / 180;
    const d = HEART_ROOM_CHASM_R + row.past + (h1 - 0.5) * 3;
    const x = HEART_ROOM.x + Math.sin(a) * d;
    const z = HEART_ROOM.z + Math.cos(a) * d;
    // The shoulder alternates spires and bluffs; the crest is all spires.
    const piece = kind === 'crest' || h2 < 0.55 ? 'Env_StormSpire' : 'Env_StormBluff';
    const m = BREATH_ENV_ROCK[piece];
    let scale = row.scale[0] + (row.scale[1] - row.scale[0]) * h2;
    // Faced toward the Cornice, its depth runs toward the isles: that is
    // the reach that must stay clear.
    while (scale > 0.55 && !clearOfIsles(x, z, (m.d * scale) / 2)) scale *= 0.85;
    if (!clearOfIsles(x, z, (m.d * scale) / 2)) continue;
    const ground = heartMountainHeight(x, z);
    const foot = Math.max(C.h - 4, ground) - row.sink;
    const top = C.h + row.top[0] + (row.top[1] - row.top[0]) * h1;
    // A bluff is a broad shoulder, never stretched into a tower.
    const most = piece === 'Env_StormBluff' ? 1.5 : 1.8;
    const rise = Math.min(most, Math.max(0.6, (top - foot) / (m.h * scale)));
    // Faced to the Cornice's middle, a little off it, so the fronts vary.
    const rot = Math.atan2(C.x - x, C.z - z) + (h3 - 0.5) * 0.5;
    out.push({
      piece,
      // The front plane set forward half the depth: the body centred on (x, z).
      x: x + Math.sin(rot) * ((m.d * scale) / 2),
      y: foot,
      z: z + Math.cos(rot) * ((m.d * scale) / 2),
      rot,
      scale,
      stretch: 0.85 + 0.3 * h3,
      rise,
      noShadow: true,
    });
  }
  return out;
}

let cached: HeartKitPlacement[] | null = null;

/** The crown ridge's painted crags: the crest's spires, then the shoulder's. */
export function planHeartCrownSpires(): HeartKitPlacement[] {
  if (!cached)
    cached = [
      ...plan(HEART_CROWN_SPIRES.crest, 'crest'),
      ...plan(HEART_CROWN_SPIRES.shoulder, 'shoulder'),
    ];
  return cached;
}
