// Mesh Fix vertex moves: the render-only height override behind the Studio's
// Mesh Fix "Vertices" mode.
//
// terrain_mesh_height.ts is the single place the DRAWN terrain height is
// decided ("A future feature sharper than the lattice subtracts itself here
// the same way"), and this is that feature. A boolean cut through steep
// ground leaves stretched quads draped over a cave mouth; the knockout brush
// deletes them wholesale, and this lets a maker instead pull the offending
// vertices back into the rock.
//
// RENDER-ONLY on purpose, exactly like TerrainKnockout: the sim keeps sampling
// terrainHeight, so nothing a player stands on moves and no invisible wall can
// be authored with it.
//
// An edit is a disc, not a vertex index: the terrain re-meshes at several
// camera LODs and a literal index means nothing a frame later, but a small
// disc at a lattice point catches exactly the vertex under it at every LOD
// that samples there.
import { getActiveWorldContent, getContentGeneration } from '../sim/data';
import type { TerrainVertexEdit, WorldContent } from '../sim/types';

/** The densest chunk vertex spacing (render/terrain.ts LOD ladder, high tier
 *  inside 95 yd). Dots in the editor sit on this lattice. */
export const VERTEX_LATTICE = 1.2;
/** Default disc radius: just under half a lattice cell, so one edit grabs the
 *  one vertex it was dropped on and never its neighbour. */
export const VERTEX_EDIT_RADIUS = 0.55;

// Hash-grid cell, yards. Big enough that a default edit lands in one or two
// cells, small enough that a dense cluster still narrows to a handful.
const CELL = 4;

let cachedGen = -1;
let grid: Map<number, TerrainVertexEdit[]> | null = null;

// World coordinates reach a few hundred yards either way; the +4096 bias and
// the 8192 stride keep this a collision-free integer key, not a hash.
const cellKey = (cx: number, cz: number): number => (cx + 4096) * 8192 + (cz + 4096);

function rebuild(content: WorldContent): void {
  const list = content.terrainVertexEdits;
  if (!list || list.length === 0) {
    grid = null;
    return;
  }
  const next = new Map<number, TerrainVertexEdit[]>();
  for (const e of list) {
    const r = e.r ?? VERTEX_EDIT_RADIUS;
    const cx0 = Math.floor((e.x - r) / CELL);
    const cx1 = Math.floor((e.x + r) / CELL);
    const cz0 = Math.floor((e.z - r) / CELL);
    const cz1 = Math.floor((e.z + r) / CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const k = cellKey(cx, cz);
        const bucket = next.get(k);
        if (bucket) bucket.push(e);
        else next.set(k, [e]);
      }
    }
  }
  grid = next;
}

/** The height nudge at (x, z), or 0. Hot path: this runs per terrain vertex on
 *  every chunk build, so the no-edits case is one generation compare and a
 *  null check, and the edited case is one hash-grid lookup. */
export function terrainVertexDelta(x: number, z: number): number {
  const gen = getContentGeneration();
  if (gen !== cachedGen) {
    cachedGen = gen;
    rebuild(getActiveWorldContent());
  }
  if (grid === null) return 0;
  const bucket = grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (bucket === undefined) return 0;
  let dy = 0;
  for (const e of bucket) {
    const r = e.r ?? VERTEX_EDIT_RADIUS;
    const dx = x - e.x;
    const dz = z - e.z;
    if (dx * dx + dz * dz <= r * r) dy += e.dy;
  }
  return dy;
}

/** Drop the memo. The editor mutates the edit array in place and bumps the
 *  content generation, which is enough, this exists for tests. */
export function resetTerrainVertexEdits(): void {
  cachedGen = -1;
  grid = null;
}
