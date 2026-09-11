// Grass-clear regions: circular stamps a maker paints to remove the procedural
// meadow grass (src/render/foliage.ts buildChunk), including the grass baked
// into the built-in world. A large brush covers a huge area in one stamp, so
// the region list stays tiny; a cached bucket index keeps the per-blade render
// query O(1) even with many small stamps. DOM/Three-free so it lives in sim and
// a Vitest imports it directly.

/** One painted no-grass disc in world space (center + radius, yards). */
export interface GrassClearCircle {
  x: number;
  z: number;
  r: number;
}

const BUCKET = 32; // yards per spatial-index cell

interface GrassClearIndex {
  buckets: Map<string, GrassClearCircle[]>;
}

// Keyed by the exact regions array identity: the editor keeps one live array on
// the document (shared with the active world content), so the index rebuilds
// only when the array reference is swapped, never per query.
const indexCache = new WeakMap<readonly GrassClearCircle[], GrassClearIndex>();

function bucketKey(cx: number, cz: number): string {
  return `${cx}:${cz}`;
}

function buildIndex(regions: readonly GrassClearCircle[]): GrassClearIndex {
  const buckets = new Map<string, GrassClearCircle[]>();
  for (const c of regions) {
    const minX = Math.floor((c.x - c.r) / BUCKET);
    const maxX = Math.floor((c.x + c.r) / BUCKET);
    const minZ = Math.floor((c.z - c.r) / BUCKET);
    const maxZ = Math.floor((c.z + c.r) / BUCKET);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const key = bucketKey(cx, cz);
        let list = buckets.get(key);
        if (!list) {
          list = [];
          buckets.set(key, list);
        }
        list.push(c);
      }
    }
  }
  return { buckets };
}

/** Whether (x, z) sits inside any painted no-grass disc. */
export function grassClearedAt(
  regions: readonly GrassClearCircle[] | undefined,
  x: number,
  z: number,
): boolean {
  if (!regions || regions.length === 0) return false;
  let index = indexCache.get(regions);
  if (!index) {
    index = buildIndex(regions);
    indexCache.set(regions, index);
  }
  const list = index.buckets.get(bucketKey(Math.floor(x / BUCKET), Math.floor(z / BUCKET)));
  if (!list) return false;
  for (const c of list) {
    const dx = x - c.x;
    const dz = z - c.z;
    if (dx * dx + dz * dz <= c.r * c.r) return true;
  }
  return false;
}

/** Add a stamp, dropping it when an existing disc already fully contains it, so
 *  a drag of the same brush size does not pile up redundant circles. Returns a
 *  NEW array when it changes, else the input unchanged. */
export function addGrassClearStamp(
  regions: readonly GrassClearCircle[],
  stamp: GrassClearCircle,
): readonly GrassClearCircle[] {
  for (const c of regions) {
    const d = Math.hypot(stamp.x - c.x, stamp.z - c.z);
    // The new disc is wholly inside an existing one: nothing to add.
    if (d + stamp.r <= c.r) return regions;
  }
  return [...regions, stamp];
}
