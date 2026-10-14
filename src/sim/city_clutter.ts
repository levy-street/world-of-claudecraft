// Painted ground clutter: discs a maker stamps with the Studio's Paint Clutter
// brush. A stamp stores the brush settings it was painted with (which of the
// ten clutter kinds, density, size range, clumping) plus a seed; the renderer
// (render/city_clutter_core.ts) scatters the actual pieces deterministically
// from that, so the document stays a few bytes per stroke and the pieces never
// touch the placement cap or the simulation. Tier-gated dressing: the sim
// never collides with it. DOM/Three-free so a Vitest imports it directly.

/** The ten clutter models, in bit order for `ClutterStamp.kinds`. */
export const CLUTTER_KINDS = [
  'tile_broken',
  'tile_shards',
  'pebbles',
  'stones',
  'letter',
  'paper_scraps',
  'leaves',
  'straw',
  'splinters',
  'pot_shards',
] as const;
export type ClutterKind = (typeof CLUTTER_KINDS)[number];
/** Bitmask with every kind enabled. */
export const CLUTTER_ALL_KINDS = (1 << CLUTTER_KINDS.length) - 1;

/** One painted clutter disc (world yards) and the brush settings it carries. */
export interface ClutterStamp {
  x: number;
  z: number;
  r: number;
  /** Bitmask over CLUTTER_KINDS (bit i = kind i enabled). */
  kinds: number;
  /** Pieces per area, 1..10 (render side calibrates the count). */
  density: number;
  /** Uniform size multipliers over the authored models. */
  minScale: number;
  maxScale: number;
  /** 0 = even scatter; N = the pieces gather into N piles. */
  clumps: number;
  /** Deterministic scatter seed (integer). */
  seed: number;
}

// A brush stroke leaves one stamp every half radius, so a few thousand stamps
// dress a whole city; the cap bounds document size and the render query.
export const MAX_CLUTTER_STAMPS = 6000;
export const CLUTTER_RADIUS_MIN = 0.5;
export const CLUTTER_RADIUS_MAX = 60;
export const CLUTTER_DENSITY_MIN = 1;
export const CLUTTER_DENSITY_MAX = 10;
export const CLUTTER_SCALE_MIN = 0.25;
export const CLUTTER_SCALE_MAX = 4;
export const CLUTTER_CLUMPS_MAX = 8;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validate one stored stamp (map_doc's sanitizer): null drops it. */
export function sanitizeClutterStamp(v: unknown): ClutterStamp | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  if (!finite(s.x) || !finite(s.z) || !finite(s.r) || s.r <= 0) return null;
  const minScale = finite(s.minScale) ? clamp(s.minScale, CLUTTER_SCALE_MIN, CLUTTER_SCALE_MAX) : 1;
  const maxScale = finite(s.maxScale) ? clamp(s.maxScale, CLUTTER_SCALE_MIN, CLUTTER_SCALE_MAX) : 1;
  const kinds = finite(s.kinds) ? Math.round(s.kinds) & CLUTTER_ALL_KINDS : CLUTTER_ALL_KINDS;
  return {
    x: Math.round(s.x * 100) / 100,
    z: Math.round(s.z * 100) / 100,
    r: clamp(s.r, CLUTTER_RADIUS_MIN, CLUTTER_RADIUS_MAX),
    kinds: kinds === 0 ? CLUTTER_ALL_KINDS : kinds,
    density: finite(s.density)
      ? clamp(Math.round(s.density), CLUTTER_DENSITY_MIN, CLUTTER_DENSITY_MAX)
      : 4,
    minScale: Math.min(minScale, maxScale),
    maxScale: Math.max(minScale, maxScale),
    clumps: finite(s.clumps) ? clamp(Math.round(s.clumps), 0, CLUTTER_CLUMPS_MAX) : 0,
    seed: finite(s.seed) ? Math.round(s.seed) >>> 0 : 1,
  };
}

const BUCKET = 32; // yards per spatial-index cell

interface ClutterIndex {
  buckets: Map<string, ClutterStamp[]>;
  maxR: number;
}

// Keyed by the exact array identity: the editor keeps one live array on the
// document (shared with the active world content), so the index rebuilds only
// when the array reference is swapped, never per query.
const indexCache = new WeakMap<readonly ClutterStamp[], ClutterIndex>();

function bucketKey(cx: number, cz: number): string {
  return `${cx}:${cz}`;
}

function buildIndex(stamps: readonly ClutterStamp[]): ClutterIndex {
  const buckets = new Map<string, ClutterStamp[]>();
  let maxR = 0;
  for (const s of stamps) {
    maxR = Math.max(maxR, s.r);
    const minX = Math.floor((s.x - s.r) / BUCKET);
    const maxX = Math.floor((s.x + s.r) / BUCKET);
    const minZ = Math.floor((s.z - s.r) / BUCKET);
    const maxZ = Math.floor((s.z + s.r) / BUCKET);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const key = bucketKey(cx, cz);
        let list = buckets.get(key);
        if (!list) {
          list = [];
          buckets.set(key, list);
        }
        list.push(s);
      }
    }
  }
  return { buckets, maxR };
}

/** Every stamp whose disc comes within `radius` of (x, z), each once, in
 *  document order. */
export function clutterStampsNear(
  stamps: readonly ClutterStamp[] | undefined,
  x: number,
  z: number,
  radius: number,
): ClutterStamp[] {
  if (!stamps || stamps.length === 0) return [];
  let index = indexCache.get(stamps);
  if (!index) {
    index = buildIndex(stamps);
    indexCache.set(stamps, index);
  }
  const seen = new Set<ClutterStamp>();
  const out: ClutterStamp[] = [];
  const minX = Math.floor((x - radius) / BUCKET);
  const maxX = Math.floor((x + radius) / BUCKET);
  const minZ = Math.floor((z - radius) / BUCKET);
  const maxZ = Math.floor((z + radius) / BUCKET);
  for (let cx = minX; cx <= maxX; cx++) {
    for (let cz = minZ; cz <= maxZ; cz++) {
      const list = index.buckets.get(bucketKey(cx, cz));
      if (!list) continue;
      for (const s of list) {
        if (seen.has(s)) continue;
        const dx = x - s.x;
        const dz = z - s.z;
        const reach = radius + s.r;
        if (dx * dx + dz * dz > reach * reach) continue;
        seen.add(s);
        out.push(s);
      }
    }
  }
  // document order keeps the render's pool fill deterministic
  if (out.length > 1) {
    const order = new Map<ClutterStamp, number>();
    for (let i = 0; i < stamps.length; i++) order.set(stamps[i], i);
    out.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }
  return out;
}

/** Whether two stamps were painted with the same brush settings. */
export function sameClutterBrush(a: ClutterStamp, b: ClutterStamp): boolean {
  return (
    a.kinds === b.kinds &&
    a.density === b.density &&
    a.minScale === b.minScale &&
    a.maxScale === b.maxScale &&
    a.clumps === b.clumps
  );
}

/** Add a stamp, dropping it when a same-brush disc already fully contains it,
 *  so a drag inside an already-painted area does not pile up duplicates.
 *  Returns a NEW array when it changes, else the input unchanged. */
export function addClutterStamp(
  stamps: readonly ClutterStamp[],
  stamp: ClutterStamp,
): readonly ClutterStamp[] {
  for (const s of stamps) {
    if (!sameClutterBrush(s, stamp)) continue;
    const d = Math.hypot(stamp.x - s.x, stamp.z - s.z);
    if (d + stamp.r <= s.r) return stamps;
  }
  return [...stamps, stamp];
}

/** Erase: drop every stamp whose centre lies within `r` of (x, z) (a stamp is
 *  the unit of painting, so the eraser lifts whole stamps). Returns the input
 *  unchanged when nothing is hit. */
export function eraseClutterStamps(
  stamps: readonly ClutterStamp[],
  x: number,
  z: number,
  r: number,
): readonly ClutterStamp[] {
  const keep = stamps.filter((s) => Math.hypot(s.x - x, s.z - z) > r);
  return keep.length === stamps.length ? stamps : keep;
}
