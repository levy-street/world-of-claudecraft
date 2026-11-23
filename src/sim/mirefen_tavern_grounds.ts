// The Mirefen tavern's grounds (content/mirefen_tavern_grounds.ts): the open stable's walls,
// partition and posts as the boxes and circles the sim collides with, and the grounds' footprint
// the scatter and the grass keep off. The loose pieces outside (the terrace's tables and benches,
// the trough, the hay, the cart, the woodpile, the casks and crates, the lantern posts, the dog)
// are TAVERN_PROPS and collide through mirefen_tavern.ts like the furniture inside.
//
// Pure leaf: content only, deterministic, no rng, no world.ts (the terrain under each piece is
// the content's `baseY`, pinned against the live terrain by the asset test).

import { TAVERN_ORIGIN } from './content/mirefen_tavern';
import {
  TAVERN_FORECOURT,
  TAVERN_GROUNDS_PROPS,
  TAVERN_STABLE,
} from './content/mirefen_tavern_grounds';

/** A local box on the grounds: [x0, x1, z0, z1]. */
export type TavernGroundBox = readonly [number, number, number, number];

/** The stable's solid walls (local boxes): the back wall, the two side walls and the stall
 *  partition. Its front stands open between its posts (tavernStablePosts). */
export function tavernStableWalls(): TavernGroundBox[] {
  const s = TAVERN_STABLE;
  const t = s.wall;
  return [
    [s.x0, s.x1, s.z0, s.z0 + t],
    [s.x0, s.x0 + t, s.z0, s.z1],
    [s.x1 - t, s.x1, s.z0, s.z1],
    [s.partitionX - 0.1, s.partitionX + 0.1, s.z0 + t, s.z0 + t + s.partitionTo],
  ];
}

/** The stable's front posts (local x, z, radius): the two corners and the one between the
 *  stalls, carrying the front eave. */
export function tavernStablePosts(): { x: number; z: number; r: number }[] {
  const s = TAVERN_STABLE;
  const r = 0.2;
  return [
    { x: s.x0 + s.wall / 2, z: s.z1 - r, r },
    { x: s.partitionX, z: s.z1 - r, r },
    { x: s.x1 - s.wall / 2, z: s.z1 - r, r },
  ];
}

/** Every local rectangle the grounds cover: the forecourt, the stable under its roof, and the
 *  footprint of each piece on the grounds (grown by its reach). */
export function tavernGroundsRects(): TavernGroundBox[] {
  const s = TAVERN_STABLE;
  const out: TavernGroundBox[] = [
    ...TAVERN_FORECOURT,
    [s.x0 - 0.3, s.x1 + 0.3, s.z0 - s.eaveOut, s.z1 + s.eaveOut],
  ];
  for (const p of TAVERN_GROUNDS_PROPS) {
    if (p.baseY === undefined) continue;
    const reach = p.r ?? Math.hypot(p.hw ?? 0.5, p.hd ?? 0.5);
    out.push([p.x - reach, p.x + reach, p.z - reach, p.z + reach]);
  }
  return out;
}

const RECTS = tavernGroundsRects();

/** Whether world (x, z) stands on the tavern's grounds (the forecourt, the stable, a piece
 *  outside), grown by `pad`: the footprint the scatter and the grass keep off. */
export function mirefenTavernGroundsCovers(x: number, z: number, pad = 0): boolean {
  const lx = TAVERN_ORIGIN.z - z;
  const lz = x - TAVERN_ORIGIN.x;
  for (const r of RECTS) {
    if (lx >= r[0] - pad && lx <= r[1] + pad && lz >= r[2] - pad && lz <= r[3] + pad) return true;
  }
  return false;
}
