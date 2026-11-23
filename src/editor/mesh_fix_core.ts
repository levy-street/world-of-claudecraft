// Mesh Fix brush: the pure stroke logic behind the Studio's Mesh Fix tool.
//
// A boolean cut through steep ground can leave the heightfield's stretched
// quads draped over a cave mouth, or hanging a little way inside it (SPACEY,
// 2026-09-18: "stretched polys that overlay the entrances ... add another
// tool that lets us select the terrain vertexs while in wire frame mode so we
// can remove these cursed bits of the mesh"). The terrain is re-meshed from
// the document at several camera LODs, so a literal vertex index means
// nothing a frame later; what persists is WHERE the bad polys are. The brush
// therefore stamps small knockout discs (x, z, r at the surface height y the
// cursor hit), and the chunk mesher drops every quad and clip triangle
// centred inside one at every LOD (render/terrain_chunk_build.ts). Render
// only: the sim's ground is untouched. DOM-free, deterministic.

import type { TerrainKnockout } from '../sim/types';

export const MESH_FIX_MIN_RADIUS = 0.3;
export const MESH_FIX_MAX_RADIUS = 8;

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Stamp a knockout at the hit point unless one of at least this size already
 *  covers it. Returns the SAME array when nothing changed. */
export function addKnockout(
  list: readonly TerrainKnockout[],
  x: number,
  y: number,
  z: number,
  radius: number,
  cap: number,
): { knockouts: readonly TerrainKnockout[]; capped: boolean } {
  const r = Math.min(MESH_FIX_MAX_RADIUS, Math.max(MESH_FIX_MIN_RADIUS, radius));
  for (const k of list) {
    if (k.r < r) continue;
    const d = Math.hypot(k.x - x, k.z - z);
    if (d <= k.r * 0.35 && Math.abs(k.y - y) <= Math.max(3, k.r * 2)) {
      return { knockouts: list, capped: false };
    }
  }
  if (list.length >= cap) return { knockouts: list, capped: true };
  return {
    knockouts: [...list, { x: round2(x), z: round2(z), y: round2(y), r: round2(r) }],
    capped: false,
  };
}

/** Remove every knockout whose centre lies under the brush (restore mode). */
export function eraseKnockouts(
  list: readonly TerrainKnockout[],
  x: number,
  z: number,
  radius: number,
): readonly TerrainKnockout[] {
  const kept = list.filter((k) => Math.hypot(k.x - x, k.z - z) > radius + k.r * 0.5);
  return kept.length === list.length ? list : kept;
}

/** The terrain region a set of knockouts touches, for the re-mesh. */
export function knockoutRegion(
  a: readonly TerrainKnockout[],
  b: readonly TerrainKnockout[],
): { minX: number; minZ: number; maxX: number; maxZ: number } | null {
  let minX = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  const seen = new Set(a);
  const other = new Set(b);
  for (const k of [...a, ...b]) {
    if (seen.has(k) && other.has(k)) continue; // unchanged between the two
    minX = Math.min(minX, k.x - k.r - 2);
    minZ = Math.min(minZ, k.z - k.r - 2);
    maxX = Math.max(maxX, k.x + k.r + 2);
    maxZ = Math.max(maxZ, k.z + k.r + 2);
  }
  return Number.isFinite(minX) ? { minX, minZ, maxX, maxZ } : null;
}
