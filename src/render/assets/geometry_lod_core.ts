// The pure half of a geometry's levels of detail (geometry_lod.ts is the three.js half): which
// level draws when a coarser one is asked of a geometry that does not carry it, how a file's
// list of levels is named, whether a list is a legal triangle list, and the index arithmetic a
// merge runs to carry every part's levels into the merged geometry. Three-free, so a Vitest
// reads the very arithmetic the store runs.
//
// A level is an INDEX LIST over its geometry's own vertices (the WOC_lod contract,
// woc_lod_plugin.ts): a coarser triangle list drawn over the same vertex buffers, so skinning,
// uvs, normals and morph targets hold as they are. Level 0 is the geometry's own index (or its
// vertices in order, for a geometry with none).

/** The level of detail a geometry draws: its own index (`lod0`), or a coarser list beside it. */
export type GeometryLodLevel = 'lod0' | 'mid' | 'far';

/** The coarser levels a geometry can carry beside its own index. */
export type CoarseLodLevel = Exclude<GeometryLodLevel, 'lod0'>;

/**
 * The level a geometry draws when `wanted` is asked of it: the wanted level when it carries it,
 * else the next finer one it carries (far falls back to mid, mid to level 0). A piece the build
 * left without a level of some kind (it saved too little to ship) draws the next finer one.
 */
export function geometryLodDrawn(
  wanted: GeometryLodLevel,
  carries: (level: CoarseLodLevel) => boolean,
): GeometryLodLevel {
  if (wanted === 'far' && carries('far')) return 'far';
  if (wanted !== 'lod0' && carries('mid')) return 'mid';
  return 'lod0';
}

/**
 * What each entry of a primitive's WOC_lod `levels` list is, by position. The list is ordered
 * mid first then far, and a level that saves under a tenth of the triangles is left out. The far
 * level always saves at least what the mid one does, so a list of one names the far level (the
 * mid one saved too little), and a list of two names both. Entries past the second name nothing.
 */
export function wocLodLevelNames(count: number): readonly CoarseLodLevel[] {
  if (count <= 0) return [];
  return count === 1 ? ['far'] : ['mid', 'far'];
}

/** Whether `indices` is a legal triangle list over `vertices` vertices: at least one whole
 *  triangle, whole triangles only, and every entry an integer naming one of the vertices. */
export function lodIndicesValid(indices: ArrayLike<number>, vertices: number): boolean {
  const n = indices.length;
  if (n === 0 || n % 3 !== 0) return false;
  for (let i = 0; i < n; i++) {
    const v = indices[i];
    if (!Number.isInteger(v) || v < 0 || v >= vertices) return false;
  }
  return true;
}

/**
 * The most a level's triangles may be degenerate (two corners on one vertex) before the level is
 * taken for a broken encoding rather than a simplification. A simplifier's output carries none.
 * What does carry them is a 16-bit list written as a VERTEX stream: gltf-transform's meshopt
 * writer encodes an accessor no primitive references (usage OTHER) in ATTRIBUTES mode, padded to
 * a 4-byte stride without saying so in the buffer view, so the list reads back with a zero after
 * every entry: in range, whole triangles, and half of them degenerate. A writer marks the level
 * accessors as index data (ELEMENT_ARRAY_BUFFER) to be read back as written.
 */
export const LOD_MAX_DEGENERATE_SHARE = 0.1;

/** The share of a triangle list's triangles that are degenerate (0 for an empty list). */
export function lodDegenerateShare(indices: ArrayLike<number>): number {
  const triangles = Math.floor(indices.length / 3);
  if (triangles === 0) return 0;
  let degenerate = 0;
  for (let k = 0; k < triangles * 3; k += 3) {
    const a = indices[k];
    const b = indices[k + 1];
    const c = indices[k + 2];
    if (a === b || b === c || a === c) degenerate++;
  }
  return degenerate / triangles;
}

/** One part of a merged geometry, as its levels see it. */
export interface LodMergePart {
  /** The part's vertex count: its vertices sit after those of the parts before it. */
  readonly vertices: number;
  /** The merge flips the part's winding (a mirrored part): each triangle's second and third
   *  corners swap, exactly as the merge's own level 0 swaps them. */
  readonly flip: boolean;
  /** The part's own index (level 0); null for a part with none (its vertices in order). */
  readonly lod0: ArrayLike<number> | null;
  readonly mid: ArrayLike<number> | null;
  readonly far: ArrayLike<number> | null;
}

/** A merged geometry's coarser levels (null: no part carries that level). */
export interface LodMergeLevels {
  readonly mid: Uint16Array | Uint32Array | null;
  readonly far: Uint16Array | Uint32Array | null;
}

/** The list a part draws at `level`: its own, else the next finer one it carries. */
function partList(part: LodMergePart, level: CoarseLodLevel): ArrayLike<number> | null {
  if (level === 'far' && part.far) return part.far;
  return part.mid ?? part.lod0;
}

/** A list's length less a trailing partial triangle (every part after a malformed one would
 *  otherwise draw shifted triangles), or the part's vertex count for a part with no index. */
function wholeCount(list: ArrayLike<number> | null, vertices: number): number {
  const n = list ? list.length : vertices;
  return n - (n % 3);
}

/**
 * The levels of a geometry merged from `parts` (in the order their vertices were concatenated):
 * each part's own list at that level, or the next finer one it carries, offset by the vertices
 * before it and flipped as the merge flips its level 0. A merged level exists only when some
 * part carries that level itself (a merge of parts that carry none draws its level 0 there),
 * so a merged level draws exactly the union of what its parts draw at that level. The list is
 * 16-bit up to 0xffff vertices, as the merges' own level 0 is.
 */
export function mergeLodIndices(parts: readonly LodMergePart[]): LodMergeLevels {
  let total = 0;
  for (const part of parts) total += part.vertices;
  const merged = (level: CoarseLodLevel): Uint16Array | Uint32Array | null => {
    if (!parts.some((part) => part[level] !== null)) return null;
    let count = 0;
    for (const part of parts) count += wholeCount(partList(part, level), part.vertices);
    const out = total > 0xffff ? new Uint32Array(count) : new Uint16Array(count);
    let v0 = 0;
    let i0 = 0;
    for (const part of parts) {
      const list = partList(part, level);
      const n = wholeCount(list, part.vertices);
      for (let k = 0; k < n; k += 3) {
        const a = list ? list[k] : k;
        const b = list ? list[k + 1] : k + 1;
        const c = list ? list[k + 2] : k + 2;
        out[i0 + k] = v0 + a;
        out[i0 + k + 1] = v0 + (part.flip ? c : b);
        out[i0 + k + 2] = v0 + (part.flip ? b : c);
      }
      v0 += part.vertices;
      i0 += n;
    }
    return out;
  };
  return { mid: merged('mid'), far: merged('far') };
}
