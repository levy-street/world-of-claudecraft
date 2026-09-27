// The Wyrmwatch cliff harbor's pure decisions (the painter is wyrmwatch_harbor.ts):
// which named parts of the one Blender model a graphics tier keeps, and where the
// flagstones of the path to Wyrmwatch lie. Three-, DOM- and i18n-free.
//
// Fairness (docs/design/graphics-settings-fairness.md): everything a player walks
// on, bumps into or steers by is kept on EVERY tier: the quays, both flights, the
// landings, every rail, the gate, the cargo the sim collides with, every lantern
// (the landmarks that read the climb at a distance), the path, and the whole
// Harbormaster's House a player walks into (its frame, walls, door, roof, the wall
// map and every piece of furniture the sim collides with). A lower preset sheds only
// dressing nothing collides with: the iron trim, fenders and bolts below medium, the
// rope coils, baskets, loose odds and the house's clutter below high. The tier is
// the STATIC effects tier (GFX.effectsTier), never the frame-rate governor.

import type { GfxTier } from './gfx';
import { HOUSE_SHELL_PARTS } from './wyrmwatch_harbor_house_core';

/** Walkable structure, solids and landmarks: never shed. */
export const WYRMWATCH_HARBOR_CRITICAL_PARTS = [
  'QuayDecks',
  'StairFlights',
  'Landings',
  'Railings',
  'HarborGate',
  'Lanterns',
  'Cargo',
  'HouseFrame',
  ...HOUSE_SHELL_PARTS,
  'HouseFurnishings',
] as const;
/** Medium and up: fenders, iron bands, bolts, straps, battens. */
export const WYRMWATCH_HARBOR_TRIM_PARTS = ['HarborTrim'] as const;
/** High and up: rope coils, baskets, a bucket, a sack, a spare anchor, and the house's
 *  clutter (the sea chest, firewood, books, the rowboat under the stilts). */
export const WYRMWATCH_HARBOR_OPTIONAL_PARTS = ['HarborClutter', 'HouseClutter'] as const;
/** The three flagstones the path is laid from (the model's PathStoneA/B/C). */
export const WYRMWATCH_PATH_STONE_PARTS = ['PathStoneA', 'PathStoneB', 'PathStoneC'] as const;

const TIER_RANK: Readonly<Record<GfxTier, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  ultra: 3,
  insane: 4,
};

/** The model's named parts a tier draws in place (the path stones are laid on
 *  every tier, see wyrmwatchPathStones). */
export function wyrmwatchHarborParts(tier: GfxTier): readonly string[] {
  const rank = TIER_RANK[tier];
  const parts: string[] = [...WYRMWATCH_HARBOR_CRITICAL_PARTS];
  if (rank >= TIER_RANK.medium) parts.push(...WYRMWATCH_HARBOR_TRIM_PARTS);
  if (rank >= TIER_RANK.high) parts.push(...WYRMWATCH_HARBOR_OPTIONAL_PARTS);
  return parts;
}

/** One flagstone of the path: where it lies, how it is turned, which stone. */
export interface WyrmwatchPathStone {
  x: number;
  /** The stone's origin height: its dressed top stands WYRMWATCH_PATH_STONE_PROUD over
   *  the ground. */
  y: number;
  z: number;
  /** Yaw about the ground's normal (radians). */
  yaw: number;
  /** The ground's unit normal under the stone (it lies flush on a slope). */
  nx: number;
  ny: number;
  nz: number;
  /** Which of the three stones (0..2), and its size. */
  variant: number;
  scale: number;
}

/** A flagstone is never laid where the ground tips it further than this from level
 *  (the normal's up component): the lip at the cliff crest just past the top landing
 *  and the steepest bits of the mound near Wyrmwatch stay bare grass. */
export const WYRMWATCH_PATH_MIN_UP = 0.88;
/** Stones every this many yards along the path, three abreast. */
export const WYRMWATCH_PATH_STEP = 0.95;
/** The model's stone top stands this far over its origin (build_wyrmwatch_harbor.py
 *  STONE_TOP, stamped in the model's root extras as stoneTop); the path sets it just
 *  proud of the grass. */
export const WYRMWATCH_PATH_STONE_TOP = 0.08;
export const WYRMWATCH_PATH_STONE_PROUD = 0.05;

/** A stable hash in [0, 1) of three integers (the stones are laid the same way on
 *  every client, with no rng). */
function hash01(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/**
 * The flagstones along a centre line of world (x, z) points, `halfWidth` either
 * side, each seated on `groundAt` and tilted to the ground's slope. Deterministic:
 * the same path always gets the same stones. A few side stones are left out (a
 * worn path), and none is laid on ground too steep to bed a flag.
 */
export function wyrmwatchPathStones(
  path: readonly (readonly [number, number])[],
  halfWidth: number,
  groundAt: (x: number, z: number) => number,
): WyrmwatchPathStone[] {
  const out: WyrmwatchPathStone[] = [];
  const across = [-halfWidth * 0.62, 0, halfWidth * 0.62];
  let row = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const [x0, z0] = path[i];
    const [x1, z1] = path[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1e-6) continue;
    const ux = (x1 - x0) / len;
    const uz = (z1 - z0) / len;
    // the leg's first stone sits half a step in, so legs join without a double row
    for (let s = WYRMWATCH_PATH_STEP / 2; s < len; s += WYRMWATCH_PATH_STEP, row++) {
      for (let k = 0; k < across.length; k++) {
        if (k !== 1 && hash01(row, k, 7) < 0.1) continue;
        const jitterA = (hash01(row, k, 1) - 0.5) * 0.24;
        const jitterC = (hash01(row, k, 2) - 0.5) * 0.24;
        const a = s + jitterA;
        const c = across[k] + jitterC;
        const x = x0 + ux * a - uz * c;
        const z = z0 + uz * a + ux * c;
        const g = groundAt(x, z);
        const gx = groundAt(x + 0.4, z) - groundAt(x - 0.4, z);
        const gz = groundAt(x, z + 0.4) - groundAt(x, z - 0.4);
        // the normal of the plane through the four samples 0.8 yd apart
        const nx = -gx / 0.8;
        const nz = -gz / 0.8;
        const n = Math.hypot(nx, 1, nz);
        if (1 / n < WYRMWATCH_PATH_MIN_UP) continue;
        out.push({
          x,
          y: g + WYRMWATCH_PATH_STONE_PROUD - WYRMWATCH_PATH_STONE_TOP,
          z,
          yaw: hash01(row, k, 3) * Math.PI * 2,
          nx: nx / n,
          ny: 1 / n,
          nz: nz / n,
          variant: Math.floor(hash01(row, k, 4) * 3) % 3,
          scale: 0.92 + hash01(row, k, 5) * 0.22,
        });
      }
    }
  }
  return out;
}
