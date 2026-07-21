// Procedural generation for the editor. Pure and seeded so a given (seed, params)
// always yields the same layout. This is EDITOR code: it uses its own small RNG
// (never the sim Rng) and only emits data (AssetPlacements / HeightStamps) the
// deterministic engine later consumes. No DOM.

import type { HeightStamp } from '../sim/types';
import type { AssetPlacement } from './custom_map';

// mulberry32: a tiny, fast, decent-quality seeded PRNG. Editor-only.
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface ScatterParams {
  assetIds: readonly string[]; // chosen uniformly per placement
  count: number; // target number of placements to attempt
  bounds: Bounds;
  seed: number;
  minScale: number;
  maxScale: number;
  // Optional rejection test in world space (e.g. underwater / in a hub / on a road).
  // Return true to REJECT a candidate point.
  avoid?: (x: number, z: number) => boolean;
}

// Scatter assets across the bounds, honouring the avoid predicate. Rejected points
// are retried a bounded number of times so a dense exclusion map cannot loop forever;
// the result may therefore be fewer than `count`.
export function scatterPlacements(params: ScatterParams): AssetPlacement[] {
  const out: AssetPlacement[] = [];
  if (params.assetIds.length === 0 || params.count <= 0) return out;
  const rng = makeRng(params.seed);
  const { minX, maxX, minZ, maxZ } = params.bounds;
  const spanX = Math.max(0, maxX - minX);
  const spanZ = Math.max(0, maxZ - minZ);
  const maxAttempts = params.count * 8;
  let attempts = 0;
  while (out.length < params.count && attempts < maxAttempts) {
    attempts++;
    const x = minX + rng() * spanX;
    const z = minZ + rng() * spanZ;
    if (params.avoid?.(x, z)) continue;
    const assetId = params.assetIds[Math.floor(rng() * params.assetIds.length)];
    const scale = params.minScale + rng() * (params.maxScale - params.minScale);
    out.push({ assetId, x, z, rotY: rng() * Math.PI * 2, scale, collide: false });
  }
  return out;
}

export interface HillParams {
  count: number;
  bounds: Bounds;
  seed: number;
  minRadius: number;
  maxRadius: number;
  minHeight: number;
  maxHeight: number;
  avoid?: (x: number, z: number) => boolean;
}

// Scatter smooth raised hills (additive height stamps) across the bounds. Useful
// for roughing in terrain before hand-editing with the brush.
export function scatterHills(params: HillParams): HeightStamp[] {
  const out: HeightStamp[] = [];
  if (params.count <= 0) return out;
  const rng = makeRng(params.seed ^ 0x9e3779b9);
  const { minX, maxX, minZ, maxZ } = params.bounds;
  const spanX = Math.max(0, maxX - minX);
  const spanZ = Math.max(0, maxZ - minZ);
  const maxAttempts = params.count * 8;
  let attempts = 0;
  while (out.length < params.count && attempts < maxAttempts) {
    attempts++;
    const x = minX + rng() * spanX;
    const z = minZ + rng() * spanZ;
    if (params.avoid?.(x, z)) continue;
    out.push({
      x,
      z,
      radius: params.minRadius + rng() * (params.maxRadius - params.minRadius),
      delta: params.minHeight + rng() * (params.maxHeight - params.minHeight),
      falloff: 'smooth',
    });
  }
  return out;
}
