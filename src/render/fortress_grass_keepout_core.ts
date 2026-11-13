// The Forgefather's Isle fortress and the Last Keep rebuild (sim/forgefather_fortress.ts)
// stand on bare ground. Their wards, training yard, plazas and temple court were hand-placed
// when the Drakelands grew no grass at all, so nothing had to keep grass out of them; the
// open Drakelands grows a dry sward now (foliage.ts GRASS_BIOME_DENSITY), and without this
// it rooted through the keep's floors and filled its wards. The fortress is hand-placed:
// its ground stays exactly as it was laid.
//
// The rule is the placement table itself: a point within FORTRESS_GRASS_PAD yards of any
// placed fortress piece is the fortress's ground. The pieces stand a wall module apart, so
// that reach covers every ward wall to wall with no hole in the middle (pinned by the test).
// Pure: no Three, no DOM; the table is bucketed once into a grid, so a grass candidate
// anywhere else on the map costs four comparisons.
import { zoneAt } from '../sim/data';
import { FORGEFATHER_FORTRESS_PLACEMENTS } from '../sim/forgefather_fortress';

/** How far a fortress piece keeps grass off the ground round it, in yards. */
export const FORTRESS_GRASS_PAD = 8;

/** The same table also places Wyrmwatch's own pieces, far to the north: a town's turf grows
 *  up to its houses like any other town's, so only the pieces south of this line (the keep
 *  pad and the isle) keep grass out. */
export const FORTRESS_SITE_MIN_Z = 2100;

const CELL = FORTRESS_GRASS_PAD;

interface Site {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  cells: Map<number, { x: number; z: number }[]>;
}

const cellKey = (cx: number, cz: number): number => cx * 100003 + cz;

let site: Site | null = null;

function fortressSite(): Site {
  if (site) return site;
  const built: Site = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
    cells: new Map(),
  };
  for (const piece of FORGEFATHER_FORTRESS_PLACEMENTS) {
    if (piece.z < FORTRESS_SITE_MIN_Z) continue;
    built.minX = Math.min(built.minX, piece.x - FORTRESS_GRASS_PAD);
    built.maxX = Math.max(built.maxX, piece.x + FORTRESS_GRASS_PAD);
    built.minZ = Math.min(built.minZ, piece.z - FORTRESS_GRASS_PAD);
    built.maxZ = Math.max(built.maxZ, piece.z + FORTRESS_GRASS_PAD);
    const key = cellKey(Math.floor(piece.x / CELL), Math.floor(piece.z / CELL));
    const list = built.cells.get(key);
    if (list) list.push({ x: piece.x, z: piece.z });
    else built.cells.set(key, [{ x: piece.x, z: piece.z }]);
  }
  site = built;
  return built;
}

/** True on the fortress's own ground: within FORTRESS_GRASS_PAD of a placed piece of the
 *  isle fortress or the Last Keep, in the Drakelands of the active world. */
export function insideFortressGrassKeepout(x: number, z: number): boolean {
  const s = fortressSite();
  if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) return false;
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  const reach = FORTRESS_GRASS_PAD * FORTRESS_GRASS_PAD;
  let near = false;
  for (let i = cx - 1; i <= cx + 1 && !near; i++) {
    for (let j = cz - 1; j <= cz + 1 && !near; j++) {
      const list = s.cells.get(cellKey(i, j));
      if (!list) continue;
      for (const piece of list) {
        const dx = piece.x - x;
        const dz = piece.z - z;
        if (dx * dx + dz * dz < reach) {
          near = true;
          break;
        }
      }
    }
  }
  // The table is the built-in world's: a custom map that lays other land over these
  // coordinates is not the Drakelands there, and grows what its own zone grows.
  return near && zoneAt(x, z).biome === 'ember';
}
