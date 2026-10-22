// The storey overhead: the lowest walkable ramp deck or 'collider/plane' floor
// above a height at a point. Decks and planes are raised ground with no
// underside of their own, so without this a body rising under one (a hop in
// the cabin below a castle deck, under a staircase) carried its head through
// the floor above. player_motion.ts verticalPass bumps a rising head on it,
// exactly as it does on a cave or carve rock roof (world.ts sheetCeilingAt).
import { DUNGEON_X_THRESHOLD, getActiveWorldContent, isBgPos } from './data';
import { placementRampCeilingAt } from './placement_ramps';
import { planeFloorAt } from './plane_floor';
import { terrainHeight } from './world';
import { layoutDeckCeilingAt } from './world_layout/decks';

/** The lowest deck or plane floor strictly above `aboveY` at (x, z), or
 *  Infinity. Open world only, like the deck folding in world.ts groundHeightFor
 *  (the battleground band and the dungeon interiors own their floors). */
export function deckCeilingAt(seed: number, x: number, z: number, aboveY: number): number {
  if (isBgPos(x) || x > DUNGEON_X_THRESHOLD) return Number.POSITIVE_INFINITY;
  const content = getActiveWorldContent();
  let best = Math.min(
    placementRampCeilingAt(content, seed, x, z, aboveY),
    layoutDeckCeilingAt(
      content.sceneryDecks,
      x,
      z,
      (sx, sz) => terrainHeight(sx, sz, seed),
      aboveY,
    ),
  );
  for (const v of content.colliderVolumes ?? []) {
    if (v.kind !== 'plane') continue;
    const base =
      (v.detached ? (v.groundY ?? 0) : terrainHeight(v.x, v.z, seed)) + (v.offsetY ?? 0) + v.sizeY;
    const floor = planeFloorAt(v, x - v.x, z - v.z, base);
    if (floor !== null && floor > aboveY && floor < best) best = floor;
  }
  return best;
}
