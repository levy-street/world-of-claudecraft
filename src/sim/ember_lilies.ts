// The Drakelands' giant ember-lily groves: every lily's spot, footprint,
// and yaw, computed once per seed. Lives sim-side so the render module
// (render/ember_features.ts) and the collider builder (sim/colliders.ts)
// read the SAME list: the rocky bed you see is exactly the bed that blocks
// you (the fen_willows idiom). Lilies grow in families (one or two huge
// elders at the heart, giants around them, small lilies at the skirt) and
// only on genuinely FLAT ground: the modeled bed is a detailed rock disc,
// and on any slope one edge lifts clear of the dirt and the whole plant
// reads as floating. Pure leaf: deterministic, memoized, no SimContext.

import { castleClear } from './castle_layout';
import { EMBER_FLAT_POOLS, EMBER_LAVA_LINKS, emberNearestOnLink } from './ember_lava_layout';
import { hash2 } from './rng';
import {
  EMBER_LAVA_POOLS,
  EMBER_VOLCANOES,
  generateDecorationsInBounds,
  roadDistance,
  terrainHeight,
} from './world';

export interface EmberLily {
  x: number;
  z: number;
  y: number;
  /** model footprint in world units */
  fp: number;
  rot: number;
  /** rocky-bed collider radius; 0 for the small skirt lilies (dressing) */
  r: number;
}

// the dragon dens keep their shelves clear (matches render/ember_features)
const EMBER_DENS = [
  { x: 419, z: 2266 },
  { x: 302, z: 2258 },
] as const;
const WYRMWATCH = { x: 404, z: 1900, r: 32 } as const;

/** Shared scatter clearance: roads, the hub, dens, and the whole modeled
 *  lava network (pools, basins, river banks along the real meander). */
export function emberScatterClear(x: number, z: number): boolean {
  if (roadDistance(x, z) < 6) return false;
  if (Math.hypot(x - WYRMWATCH.x, z - WYRMWATCH.z) < WYRMWATCH.r) return false;
  if (!castleClear(x, z)) return false; // the Last Keep's grounds
  for (const pool of EMBER_LAVA_POOLS) {
    if (Math.hypot(x - pool.x, z - pool.z) < pool.r * 1.5 + 6) return false;
  }
  for (const v of EMBER_VOLCANOES) {
    if (Math.hypot(x - v.x, z - v.z) < v.craterR + 10) return false;
  }
  for (const den of EMBER_DENS) {
    if (Math.hypot(x - den.x, z - den.z) < 13) return false;
  }
  for (const pool of EMBER_FLAT_POOLS) {
    if (Math.hypot(x - pool.x, z - pool.z) < pool.r * 1.5 + 5) return false;
  }
  for (const link of EMBER_LAVA_LINKS) {
    if (emberNearestOnLink(link, x, z).dist < link.w * 0.8 + 4) return false;
  }
  return true;
}

let lilyCache: { seed: number; spots: EmberLily[] } | null = null;

/** All lily grove placements for the seed (cached). */
export function emberLilySpots(seed: number): readonly EmberLily[] {
  if (lilyCache && lilyCache.seed === seed) return lilyCache.spots;
  const spots: EmberLily[] = [];
  // a lily only roots on genuinely FLAT ground: gentle center gradient AND
  // a level footprint (the bed's rim must touch dirt all the way around)
  const flatAt = (x: number, z: number, fp: number): number | null => {
    const e = 1.2;
    const hx = terrainHeight(x + e, z, seed) - terrainHeight(x - e, z, seed);
    const hz = terrainHeight(x, z + e, seed) - terrainHeight(x, z - e, seed);
    if (Math.hypot(hx, hz) / (2 * e) > 0.14) return null;
    const pr = fp * 0.32;
    const y0 = terrainHeight(x, z, seed);
    let lo = y0;
    let hi = y0;
    for (const [ox, oz] of [
      [pr, 0],
      [-pr, 0],
      [0, pr],
      [0, -pr],
    ] as const) {
      const h = terrainHeight(x + ox, z + oz, seed);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    if (hi - lo > 0.7) return null;
    // the bed rests on the LOWEST touched point so no edge hangs in air
    return lo;
  };
  // the terrain's own scatter rocks must not spear a bed (willow rule)
  const rocks = generateDecorationsInBounds(seed, {
    minX: 195,
    maxX: 535,
    minZ: 1825,
    maxZ: 2410,
  }).filter((d) => d.kind === 'rock');
  const clearOfRocks = (x: number, z: number, need: number): boolean => {
    for (const rock of rocks) {
      if (Math.hypot(x - rock.x, z - rock.z) < need + rock.scale * 1.4) return false;
    }
    return true;
  };
  for (let gx = 200; gx <= 530; gx += 12) {
    for (let gz = 1830; gz <= 2405; gz += 12) {
      const r = hash2(gx, gz, seed + 811);
      if (r >= 0.055) continue;
      const cx = gx + (hash2(gx + 1, gz, seed + 821) - 0.5) * 9;
      const cz = gz + (hash2(gx, gz + 1, seed + 831) - 0.5) * 9;
      if (terrainHeight(cx, cz, seed) < 1) continue;
      if (!emberScatterClear(cx, cz)) continue;
      // the family: 1-2 huge elders at the heart, 2-3 giants around them,
      // 3-4 small lilies at the skirt, every stem on its own flat probe
      const tiers = [
        { n: 1 + Math.round(hash2(gx, gz, seed + 852)), lo: 11, hi: 15, rad: 3.2, rk: 0.2 },
        { n: 2 + Math.round(hash2(gx, gz, seed + 853)), lo: 7, hi: 10, rad: 7.5, rk: 0.18 },
        { n: 3 + Math.round(hash2(gx, gz, seed + 854)), lo: 3.5, hi: 6, rad: 11, rk: 0 },
      ];
      tiers.forEach((t, ti) => {
        for (let k = 0; k < t.n; k++) {
          const ang = hash2(gx + k, gz + ti * 7, seed + 855) * Math.PI * 2;
          const dist =
            ti === 0 && k === 0
              ? 0
              : t.rad * (0.55 + hash2(gx, gz + k + ti * 13, seed + 856) * 0.45);
          const lx = cx + Math.sin(ang) * dist;
          const lz = cz + Math.cos(ang) * dist;
          const fp = t.lo + hash2(lz, lx, seed + 857) * (t.hi - t.lo);
          if (terrainHeight(lx, lz, seed) < 1) continue;
          if (!emberScatterClear(lx, lz)) continue;
          if (!clearOfRocks(lx, lz, fp * 0.4)) continue;
          const ly = flatAt(lx, lz, fp);
          if (ly === null) continue;
          spots.push({
            x: lx,
            z: lz,
            y: ly,
            fp,
            rot: hash2(lx, lz, seed + 858) * Math.PI * 2,
            r: t.rk === 0 ? 0 : fp * t.rk,
          });
        }
      });
    }
  }
  lilyCache = { seed, spots };
  return spots;
}
