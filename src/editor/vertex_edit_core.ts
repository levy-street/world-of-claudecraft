// Mesh Fix "Vertices" mode: the pure lattice + selection logic.
//
// SPACEY, 2026-09-20: "see all of the vertexes, select them in 1 by 1 like
// blender ... make it so you can select multiple at once ... wireframe with
// small square dots on each vertex highlighting yellow when u select them".
//
// The terrain mesh is generated, so a vertex has no stable identity across a
// re-mesh. What IS stable is its LATTICE COORDINATE: chunks are laid on a
// world-aligned grid and the densest band samples every VERTEX_LATTICE yards,
// so (col, row) names the same point at every LOD that reaches it. Selection,
// hit-testing and the stored edits all speak that lattice. DOM-free.
import { VERTEX_EDIT_RADIUS, VERTEX_LATTICE } from '../render/terrain_vertex_edits';
import type { TerrainVertexEdit } from '../sim/types';

/** A lattice node: integer grid coordinates, so it survives a re-mesh. */
export interface VertexKey {
  col: number;
  row: number;
}

/** Pack a lattice node into one integer for Set/Map use. Same bias as the
 *  render-side hash: world coords stay well inside +/- 4096 lattice steps. */
export function packVertex(col: number, row: number): number {
  return (col + 8192) * 65536 + (row + 8192);
}
export function unpackVertex(id: number): VertexKey {
  return { col: Math.floor(id / 65536) - 8192, row: (id % 65536) - 8192 };
}

/** World position of a lattice node. */
export function vertexWorld(col: number, row: number): { x: number; z: number } {
  return { x: col * VERTEX_LATTICE, z: row * VERTEX_LATTICE };
}

/** The lattice node nearest a world point. `| 0` is not decoration:
 *  Math.round(-0.3) is NEGATIVE zero, which compares equal to 0 but is a
 *  different key the moment anything stringifies it. */
export function nearestVertex(x: number, z: number): VertexKey {
  return { col: Math.round(x / VERTEX_LATTICE) | 0, row: Math.round(z / VERTEX_LATTICE) | 0 };
}

/** Every lattice node inside an axis-aligned world rect, capped so a careless
 *  drag across the whole map cannot allocate a million ids. */
export function verticesInRect(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  cap = 4096,
): number[] {
  const c0 = Math.ceil(Math.min(minX, maxX) / VERTEX_LATTICE);
  const c1 = Math.floor(Math.max(minX, maxX) / VERTEX_LATTICE);
  const r0 = Math.ceil(Math.min(minZ, maxZ) / VERTEX_LATTICE);
  const r1 = Math.floor(Math.max(minZ, maxZ) / VERTEX_LATTICE);
  const out: number[] = [];
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      out.push(packVertex(col, row));
      if (out.length >= cap) return out;
    }
  }
  return out;
}

/** Every lattice node within `radius` of a world point (the dot overlay's
 *  window, drawing the whole map's lattice is millions of points). */
export function verticesNear(x: number, z: number, radius: number, cap = 6000): number[] {
  const c = nearestVertex(x, z);
  const span = Math.floor(radius / VERTEX_LATTICE);
  const r2 = radius * radius;
  const out: number[] = [];
  for (let dr = -span; dr <= span; dr++) {
    for (let dc = -span; dc <= span; dc++) {
      const wx = (c.col + dc) * VERTEX_LATTICE - x;
      const wz = (c.row + dr) * VERTEX_LATTICE - z;
      if (wx * wx + wz * wz > r2) continue;
      out.push(packVertex(c.col + dc, c.row + dr));
      if (out.length >= cap) return out;
    }
  }
  return out;
}

export type SelectMode = 'replace' | 'add' | 'toggle' | 'remove';

/** Fold a batch of ids into a selection. Returns a NEW set only when the
 *  selection actually changed, so callers can skip a rebuild. */
export function applySelection(
  current: ReadonlySet<number>,
  ids: readonly number[],
  mode: SelectMode,
): ReadonlySet<number> {
  if (mode === 'replace') {
    if (current.size === ids.length && ids.every((i) => current.has(i))) return current;
    return new Set(ids);
  }
  const next = new Set(current);
  for (const id of ids) {
    if (mode === 'add') next.add(id);
    else if (mode === 'remove') next.delete(id);
    else if (next.has(id)) next.delete(id);
    else next.add(id);
  }
  if (next.size === current.size) {
    let same = true;
    for (const id of next) {
      if (!current.has(id)) {
        same = false;
        break;
      }
    }
    if (same) return current;
  }
  return next;
}

/** Fold a height nudge for every selected node into the edit list, merging
 *  with the edit already standing at that node so repeated drags accumulate
 *  instead of stacking entries. An edit that lands back at zero is dropped. */
export function moveVertices(
  edits: readonly TerrainVertexEdit[],
  selected: ReadonlySet<number>,
  dy: number,
  cap: number,
): readonly TerrainVertexEdit[] {
  if (selected.size === 0 || dy === 0) return edits;
  const byNode = new Map<number, number>();
  const kept: TerrainVertexEdit[] = [];
  edits.forEach((e) => {
    const v = nearestVertex(e.x, e.z);
    const id = packVertex(v.col, v.row);
    // Only an edit that really sits ON its node folds; a wider authored disc
    // (r set by hand) is left alone so this never silently rewrites it.
    if ((e.r ?? VERTEX_EDIT_RADIUS) <= VERTEX_EDIT_RADIUS && !byNode.has(id)) {
      byNode.set(id, kept.length);
      kept.push({ ...e });
    } else kept.push({ ...e });
  });
  let added = 0; // reported for callers that want to warn at the cap
  for (const id of selected) {
    const at = byNode.get(id);
    if (at !== undefined) {
      kept[at] = { ...kept[at], dy: round3(kept[at].dy + dy) };
      continue;
    }
    if (kept.length >= cap) break;
    const { col, row } = unpackVertex(id);
    const w = vertexWorld(col, row);
    kept.push({ x: round3(w.x), z: round3(w.z), dy: round3(dy) });
    added++;
  }
  const out = kept.filter((e) => Math.abs(e.dy) > 1e-4);
  return out;
}

/** Drop every edit standing on a selected node (Blender's "reset"). */
export function clearVertexEdits(
  edits: readonly TerrainVertexEdit[],
  selected: ReadonlySet<number>,
): readonly TerrainVertexEdit[] {
  if (selected.size === 0) return edits;
  const out = edits.filter((e) => {
    const v = nearestVertex(e.x, e.z);
    return !selected.has(packVertex(v.col, v.row));
  });
  return out.length === edits.length ? edits : out;
}

/** The terrain rect a set of edits touches, for the re-mesh. */
export function vertexEditRegion(
  a: readonly TerrainVertexEdit[],
  b: readonly TerrainVertexEdit[],
): { minX: number; minZ: number; maxX: number; maxZ: number } | null {
  let minX = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  const seen = new Set(a);
  const other = new Set(b);
  for (const e of [...a, ...b]) {
    if (seen.has(e) && other.has(e)) continue;
    const r = (e.r ?? VERTEX_EDIT_RADIUS) + VERTEX_LATTICE * 2;
    minX = Math.min(minX, e.x - r);
    minZ = Math.min(minZ, e.z - r);
    maxX = Math.max(maxX, e.x + r);
    maxZ = Math.max(maxZ, e.z + r);
  }
  return Number.isFinite(minX) ? { minX, minZ, maxX, maxZ } : null;
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;
