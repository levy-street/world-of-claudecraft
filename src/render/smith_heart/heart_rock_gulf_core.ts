// The Wind Bridge gulf's far walls (the weak-spots pass of 2026-11-04). The
// mountain's bands (heart_rock_plan_core.ts) keep a whole piece's reach out of
// the open air round the Wind Bridge (`heartOpenAir`, a disc of the piece's
// width), so across the gulf, where the mountain climbs steeply from the mist,
// no band ever found room and the walls the bridge looks at stayed the bare
// heightfield: flat faceted planes. Here the gulf's walls take the raid's
// sculpted rock (the rock kit's great faces, two storeys where the mountain
// climbs past one), set along both sides of the bridge with their FRONT on the
// gulf's edge, facing the bridge across it:
//   - every front point stays out of the open air (the gulf keeps its width:
//     the bridge still spans a chasm), its body backed by the mountain (no
//     face stands free over the void);
//   - none stands over a walked floor between its foot and its crest, none
//     over the summit's horizon (`heartSummitCap`);
//   - its foot sinks deep under the deck (the wall rises out of the mist),
//     on the beds' grid like every face of the mountain;
//   - cosmetic: shed on the low tier with the upper bands (the heightfield
//     stays behind them).
// Pinned by tests/smith_heart_rock_gulf.test.ts; its solids join the sightline
// plan (heart_sightline_core.ts heartRockSolids).
//
// Three-free, DOM-free, deterministic (a hash, never rng).

import { SMITH_HEART_FIELD, WIND_BRIDGE } from '../../sim/content/smith_heart_layout';
import { authoredFieldHeight } from '../../sim/instances/authored_field';
import type { HeartKitPlacement } from './heart_kit_core';
import {
  HEART_MOUNTAIN_CHASM,
  heartMountainGrid,
  heartMountainSample,
} from './heart_mountain_core';
import { heartHash } from './heart_plan_core';
import {
  HEART_ROCK_PIECES,
  HEART_ROCK_STRATA,
  heartRockBackOverFloor,
  heartRockBedFloor,
  heartRockFrontPoints,
} from './heart_rock_plan_core';
import { heartOpenAir, heartSummitCap } from './heart_walls_core';

/** The gulf walls' measures: how far from the bridge's line their fronts
 *  stand (yards: the gulf's open air is 22), the spacing along the bridge,
 *  how far past its ends the run reaches, how deep under the deck a foot
 *  sinks, and the pieces they draw from (tall faces, hashed). */
export const HEART_GULF_WALL = {
  off: 24,
  step: 15,
  pastEnds: 14,
  sink: 44,
  scale: [1.0, 1.2] as const,
  pieces: ['Kit_RockWallC', 'Kit_RockWallA', 'Kit_RockWallB', 'Kit_RockWallC'] as const,
  /** The storey over a face where the mountain climbs past its crest: how far
   *  back it stands (yards at scale 1). */
  upperBack: 6,
} as const;

/** A point `lx` across and `lz` ahead of a placement (its front is +Z). */
function at(p: { x: number; z: number; rot: number }, lx: number, lz: number) {
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  return { x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c };
}

/** The mountain under a piece's back half: its highest point (nothing of
 *  the slope stands above it) and its lowest (a face must be backed). */
function backing(
  p: { x: number; z: number; rot: number },
  half: number,
  depth: number,
): { high: number; low: number } {
  const g = heartMountainGrid(3);
  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  for (let i = -2; i <= 2; i++) {
    for (let j = 2; j <= 4; j++) {
      const q = at(p, (i / 2) * half, (-j / 4) * depth);
      const h = heartMountainSample(g, q.x, q.z);
      high = Math.max(high, h.high);
      low = Math.min(low, h.mid);
    }
  }
  return { high, low };
}

let cached: HeartKitPlacement[] | null = null;

/** Every gulf wall (instance-local), both sides of the Wind Bridge. */
export function planHeartGulfWalls(): HeartKitPlacement[] {
  if (cached) return cached;
  const W = HEART_GULF_WALL;
  const S = HEART_ROCK_STRATA;
  const B = WIND_BRIDGE;
  const dx = B.toX - B.fromX;
  const dz = B.toZ - B.fromZ;
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  const out: HeartKitPlacement[] = [];
  for (const side of [-1, 1] as const) {
    // The side's outward normal (from the bridge into the gulf's wall).
    const nx = -uz * side;
    const nz = ux * side;
    for (let s = -W.pastEnds; s <= len + W.pastEnds + 1e-6; s += W.step) {
      const t = Math.max(0, Math.min(len, s));
      const bx = B.fromX + ux * t;
      const bz = B.fromZ + uz * t;
      const deck = authoredFieldHeight(SMITH_HEART_FIELD, bx, bz);
      const px = B.fromX + ux * s + nx * W.off;
      const pz = B.fromZ + uz * s + nz * W.off;
      // Square to the bridge, facing it across the gulf.
      const rot =
        Math.atan2(-nx, -nz) + (heartHash(Math.round(px * 3), Math.round(pz * 3)) - 0.5) * 0.16;
      const h = heartHash(Math.round(px * 7) + 911, Math.round(pz * 7) - side * 37);
      const name = W.pieces[Math.floor(h * W.pieces.length) % W.pieces.length];
      const piece = HEART_ROCK_PIECES[name];
      const k =
        W.scale[0] + (W.scale[1] - W.scale[0]) * heartHash(Math.round(pz * 5), Math.round(px * 5));
      const q = { x: px, z: pz, rot, scale: k };
      // The gulf keeps its open air: every point of the front past it.
      if (heartRockFrontPoints(q, piece).some((f) => heartOpenAir(f.x, f.z, 0.5))) continue;
      const tall = piece.height * S.scale;
      const foot = heartRockBedFloor(deck - W.sink);
      const back = backing(q, piece.half * k, piece.depth * k);
      // Backed by the mountain, never standing free over the mist.
      if (!Number.isFinite(back.low) || back.low <= HEART_MOUNTAIN_CHASM + 1) continue;
      if (back.low < foot + tall * 0.25) continue;
      if (foot + tall > heartSummitCap(px, pz)) continue;
      if (heartRockBackOverFloor(q, piece, foot, tall)) continue;
      out.push({
        piece: name,
        x: px,
        y: foot,
        z: pz,
        rot,
        scale: k,
        rise: S.scale / k,
        noShadow: true,
        cosmetic: true,
      });
      // The mountain climbs past its crest: a second storey on its upper beds,
      // a step back (never a piece stretched past its beds).
      if (back.high > foot + tall - S.lift) {
        const upper = HEART_ROCK_PIECES.Kit_RockMassB;
        const k2 = k;
        const b2 = W.upperBack * k2;
        const q2 = { x: px + nx * b2, z: pz + nz * b2, rot, scale: k2 };
        const foot2 = heartRockBedFloor(foot + tall - 2 * S.lift);
        const tall2 = upper.height * S.scale;
        if (heartRockFrontPoints(q2, upper).some((f) => heartOpenAir(f.x, f.z, 0.5))) continue;
        if (foot2 + tall2 > heartSummitCap(q2.x, q2.z)) continue;
        if (heartRockBackOverFloor(q2, upper, foot2, tall2)) continue;
        out.push({
          piece: 'Kit_RockMassB',
          x: q2.x,
          y: foot2,
          z: q2.z,
          rot,
          scale: k2,
          rise: S.scale / k2,
          noShadow: true,
          cosmetic: true,
        });
      }
    }
  }
  cached = out;
  return out;
}
