// The custom-map terrain edit layer: the sculpt-brush HeightStamps a map
// document carries (`terrainEdits`), folded into the height terrainHeight has
// computed so far. Moved verbatim out of world.ts (the monolith ratchet):
// world.ts's terrainHeightUnpadded calls applyEditLayer as its last step and
// re-exports the public names, so every importer of world.ts stands.
//
// Pure and host-agnostic: reads only the active content's stamp list, no RNG,
// no DOM. The bucket index below is a cache whose iteration order is part of
// the determinism contract (terrain height feeds the parity goldens).

import { getActiveWorldContent } from './data';
import { terrainBrushAlpha, terrainBrushWeight } from './terrain_brush';
import { noiseStampWeight } from './terrain_noise_brush';
import type { HeightStamp } from './types';

// A byte-identical copy of world.ts's private helper (same expression, same
// evaluation order), so a stamp evaluates to the same bits it did in place.
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ---------------------------------------------------------------------------
// The custom-map edit layer (the sculpt brushes), applied to the height computed
// so far. Stamps apply in array order; pure data, no RNG, so the sim and renderer
// agree. `add` stamps add a falloff-weighted delta (a Noise-brush stamp scales it by
// a seeded field, terrain_noise_brush.ts); `level` stamps pull toward `delta`.
//
// Stamps are looked up through a coarse spatial bucket index (cell 32yd; each
// stamp registered in every cell its radius's bounding box touches) instead of a
// linear scan: the render chunk rebuilder samples the height 5x per vertex, so
// with the 4000-stamp cap the linear scan grows editor brush cost with session
// length. Determinism contract: candidates for a query point are iterated in
// ascending original array index (each bucket is built in index order and a stamp
// appears at most once per bucket), so float addition order is bit-identical to
// the linear scan. The index is a pure cache keyed by the terrainEdits array
// reference + length; it is rebuilt when either differs and cleared by
// invalidateTerrainEditIndex() for same-length in-place mutations.
// ---------------------------------------------------------------------------

const EDIT_INDEX_CELL = 32; // yards per bucket cell
// A stamp this large would touch an unbounded number of cells; index none and
// fall back to the (bit-identical) linear scan. The document sanitizer caps
// stamp radius at 200, so this only guards hostile in-memory content.
const EDIT_INDEX_MAX_RADIUS = 4096;

interface TerrainEditIndex {
  length: number;
  linear: boolean; // true = do not use buckets, scan the array
  buckets: Map<string, number[]>; // "cx,cz" -> ascending stamp indices
}

let terrainEditIndexCache = new WeakMap<HeightStamp[], TerrainEditIndex>();

// Clears the edit-layer index cache. The editor MUST call this after a
// splice-style in-place mutation that keeps the array reference and length
// (e.g. replacing a stamp); push/pop/reassignment are picked up automatically
// via the length + reference key. The exact export name is a contract with the
// editor lane: do not rename.
export function invalidateTerrainEditIndex(): void {
  terrainEditIndexCache = new WeakMap();
}

function buildTerrainEditIndex(edits: HeightStamp[]): TerrainEditIndex {
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    if (e.radius <= 0) continue; // the scan skips these too; no cell to register
    // A non-finite stamp (NaN poisons the scan; Infinity reaches everywhere)
    // or an absurd radius cannot be bucketed: reproduce the linear scan's
    // exact semantics by not indexing at all.
    if (
      !Number.isFinite(e.radius) ||
      e.radius > EDIT_INDEX_MAX_RADIUS ||
      !Number.isFinite(e.x) ||
      !Number.isFinite(e.z)
    ) {
      return { length: edits.length, linear: true, buckets: new Map() };
    }
    // One guard cell on every side: sqrt rounding can put a point with
    // d < radius up to ~1 ulp outside the bbox cells at an exact cell
    // boundary. Extra candidates are harmless (applyStamp re-checks d).
    const c0 = Math.floor((e.x - e.radius) / EDIT_INDEX_CELL) - 1;
    const c1 = Math.floor((e.x + e.radius) / EDIT_INDEX_CELL) + 1;
    const r0 = Math.floor((e.z - e.radius) / EDIT_INDEX_CELL) - 1;
    const r1 = Math.floor((e.z + e.radius) / EDIT_INDEX_CELL) + 1;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const key = `${c},${r}`;
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = [];
          buckets.set(key, bucket);
        }
        bucket.push(i); // outer loop is ascending i, so each bucket stays sorted
      }
    }
  }
  return { length: edits.length, linear: false, buckets };
}

// One stamp's contribution, shared verbatim by the indexed and linear paths so
// they are bit-identical.
function applyStamp(e: HeightStamp, x: number, z: number, h: number): number {
  if (e.radius <= 0) return h;
  const dx = x - e.x;
  const dz = z - e.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= e.radius) return h;
  const t = d / e.radius; // 0 at centre, 1 at edge
  // 'flat' = full delta out to the edge (shaped by the brush alpha when one is
  // set); 'smooth' = the eased taper to 0 outside the brush's solid hardness
  // core (terrain_brush.ts). A stamp with neither field keeps its original
  // falloff bit for bit: terrainBrushWeight at hardness 0 is 1 - smoothstep(t).
  const alphaArgs = e.alpha ? { id: e.alpha, u: dx / e.radius, v: dz / e.radius } : undefined;
  const w =
    e.falloff === 'flat'
      ? alphaArgs
        ? terrainBrushAlpha(alphaArgs.id, alphaArgs.u, alphaArgs.v)
        : 1
      : terrainBrushWeight(t, e.hardness ?? 0, alphaArgs);
  if (e.mode === 'level') {
    // A level target may be a tilted plane (HeightStamp.gx/gz): Smooth uses it
    // to level toward the ground's own local trend, so a slope keeps its slope
    // instead of being pressed into a plateau. No gradient = the flat target.
    const target =
      e.gx !== undefined || e.gz !== undefined
        ? e.delta + (e.gx ?? 0) * dx + (e.gz ?? 0) * dz
        : e.delta;
    return lerp(h, target, w * (e.strength ?? 1));
  }
  return h + e.delta * (e.noiseSize === undefined ? w : noiseStampWeight(e, x, z, t));
}

export function applyEditLayer(x: number, z: number, h0: number): number {
  const edits = getActiveWorldContent().terrainEdits;
  if (!edits || edits.length === 0) return h0;
  let index = terrainEditIndexCache.get(edits);
  if (!index || index.length !== edits.length) {
    index = buildTerrainEditIndex(edits);
    terrainEditIndexCache.set(edits, index);
  }
  let h = h0;
  if (index.linear) {
    for (const e of edits) h = applyStamp(e, x, z, h);
    return h;
  }
  const key = `${Math.floor(x / EDIT_INDEX_CELL)},${Math.floor(z / EDIT_INDEX_CELL)}`;
  const bucket = index.buckets.get(key);
  if (!bucket) return h0;
  // Any stamp with d < radius has |x - e.x| < radius, so its bounding-box cells
  // cover the query cell: the bucket holds every contributing stamp, in
  // ascending array index, exactly once.
  for (const i of bucket) h = applyStamp(edits[i], x, z, h);
  return h;
}

/** True when an authored height stamp reaches (x, z). Empty in the built-in
 *  world (its only stamp is the off-world jail pad), so this costs nothing
 *  there; on a custom map it is the same bucketed index applyEditLayer uses. */
export function inAuthoredHeightStamp(x: number, z: number): boolean {
  const edits = getActiveWorldContent().terrainEdits;
  if (!edits || edits.length === 0) return false;
  let index = terrainEditIndexCache.get(edits);
  if (!index || index.length !== edits.length) {
    index = buildTerrainEditIndex(edits);
    terrainEditIndexCache.set(edits, index);
  }
  const hit = (e: HeightStamp): boolean => (x - e.x) ** 2 + (z - e.z) ** 2 < e.radius ** 2;
  if (index.linear) return edits.some(hit);
  const bucket = index.buckets.get(
    `${Math.floor(x / EDIT_INDEX_CELL)},${Math.floor(z / EDIT_INDEX_CELL)}`,
  );
  return bucket ? bucket.some((i) => hit(edits[i])) : false;
}
