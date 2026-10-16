// Ground-clutter scatter policy for the renderer's painted clutter layer
// (city_clutter.ts). A painted stamp (sim/city_clutter.ts) becomes a
// deterministic list of pieces here: same stamp, same pieces, on every machine
// and every frame. Pure and Three-free so a Vitest pins the behaviour; the
// pieces are tier-gated visual dressing and never touch the simulation.

import { CLUTTER_KINDS, type ClutterStamp } from '../sim/city_clutter';

/** One scattered piece (world yards; y and tilt come from the ground at draw time). */
export interface ClutterItem {
  x: number;
  z: number;
  /** Index into CLUTTER_KINDS. */
  kind: number;
  scale: number;
  yaw: number;
}

// Calibration: a density-4 brush of radius 6 (113 sq yd) drops ~25 pieces; the
// per-stamp cap keeps a huge brush from costing more than a small one.
export const CLUTTER_ITEMS_PER_SQ_YD_PER_DENSITY = 0.055;
export const CLUTTER_MAX_ITEMS_PER_STAMP = 160;
// piles: how tight the pieces gather around each clump centre
export const CLUTTER_CLUMP_SPREAD = 0.18;

/** Small deterministic PRNG (mulberry32) seeded per stamp. */
export function clutterRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The kind indices a stamp's bitmask enables (every kind when the mask is empty). */
export function clutterKindsOf(mask: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < CLUTTER_KINDS.length; i++) if (mask & (1 << i)) out.push(i);
  if (out.length === 0) for (let i = 0; i < CLUTTER_KINDS.length; i++) out.push(i);
  return out;
}

/** How many pieces a stamp scatters. */
export function clutterItemCount(stamp: ClutterStamp): number {
  const area = Math.PI * stamp.r * stamp.r;
  const n = Math.round(area * stamp.density * CLUTTER_ITEMS_PER_SQ_YD_PER_DENSITY);
  return Math.max(1, Math.min(CLUTTER_MAX_ITEMS_PER_STAMP, n));
}

/**
 * Scatter a stamp's pieces. Even spread is a uniform disc; with clumps the
 * pieces gather in Gaussian piles around N centres inside the disc (piles
 * never spill past the painted radius).
 */
export function clutterItemsForStamp(stamp: ClutterStamp): ClutterItem[] {
  const rng = clutterRng(stamp.seed);
  const kinds = clutterKindsOf(stamp.kinds);
  const count = clutterItemCount(stamp);
  const clumps = Math.max(0, Math.round(stamp.clumps));
  const centres: { x: number; z: number }[] = [];
  for (let c = 0; c < clumps; c++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * stamp.r * 0.72;
    centres.push({ x: stamp.x + Math.cos(a) * d, z: stamp.z + Math.sin(a) * d });
  }
  const spread = Math.max(0.6, stamp.r * CLUTTER_CLUMP_SPREAD);
  const items: ClutterItem[] = [];
  for (let i = 0; i < count; i++) {
    let x: number;
    let z: number;
    if (centres.length > 0) {
      const c = centres[Math.floor(rng() * centres.length)];
      // Box-Muller: a Gaussian pile around the clump centre
      const u = Math.max(1e-6, rng());
      const v = rng();
      const g = Math.sqrt(-2 * Math.log(u)) * spread;
      x = c.x + Math.cos(v * Math.PI * 2) * g;
      z = c.z + Math.sin(v * Math.PI * 2) * g;
      // keep the pile inside the painted disc
      const dx = x - stamp.x;
      const dz = z - stamp.z;
      const d = Math.hypot(dx, dz);
      if (d > stamp.r) {
        x = stamp.x + (dx / d) * stamp.r * 0.98;
        z = stamp.z + (dz / d) * stamp.r * 0.98;
      }
    } else {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * stamp.r;
      x = stamp.x + Math.cos(a) * d;
      z = stamp.z + Math.sin(a) * d;
    }
    const kind = kinds[Math.floor(rng() * kinds.length)];
    const scale = stamp.minScale + rng() * (stamp.maxScale - stamp.minScale);
    const yaw = rng() * Math.PI * 2;
    items.push({ x, z, kind, scale, yaw });
  }
  return items;
}

/** Mean distance from each piece to the nearest other piece: a clumped stamp
 *  packs tighter than an even one of the same count (test helper). */
export function clutterMeanNearest(items: readonly ClutterItem[]): number {
  if (items.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    let best = Number.POSITIVE_INFINITY;
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      const d = Math.hypot(items[i].x - items[j].x, items[i].z - items[j].z);
      if (d < best) best = d;
    }
    total += best;
  }
  return total / items.length;
}
