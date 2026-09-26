// The Harbormaster's House (content/wyrmwatch_harbor_house.ts): its walls with the doorway
// left open, the solid furniture and cargo inside, the chimney stack outside, and the rest
// area over its floor. The floor itself is the harbor's `houseFloor` deck (the ferry pier
// surface query), so world.ts groundHeight walks it like the quays.
//
// The walls are the Last Keep's idiom (walls minus doorways, colliders.ts layoutColliders)
// on one room: a box per wall, the south wall cut in two either side of the doorway, each
// full height to movement (a jump never clears one) and topped at the wall plate for sight,
// so a spell or a sight line stops at the wall as it would at any building.
//
// The rest area reuses the inn rule (progression/xp.ts isResting): standing on the house's
// floor, out of combat, accrues rested experience like an inn. A swimmer under the stilts
// is not on the floor, so is not resting.
//
// Deterministic and rng-free. The colliders join the static grid with the rest of the
// harbor (wyrmwatch_harbor.ts, built-in world only); the harbormaster is spawned at world
// init under her reserved id (spawnHarborHouseKeeper, from sim.ts), so the sequential id
// stream every other entity takes is untouched.

import type { Collider } from './colliders';
import {
  HARBOR_HOUSE,
  HARBOR_HOUSE_FLOOR_ABOVE_WATER,
  HARBOR_HOUSE_INTERIOR,
  HARBOR_HOUSE_KEEPER_ENTITY_ID,
  HARBOR_HOUSE_PROPS,
  HARBOR_HOUSE_REST_SINK,
  type HarborHouseProp,
} from './content/wyrmwatch_harbor_house';
import { createNpc } from './entity';
import type { SimContext } from './sim_context';
import type { WorldContent } from './types';
import { groundHeight, WATER_LEVEL } from './world';

/** One wall box: centre, half extents along x and z (walls run along the world axes). */
export interface HarborHouseWall {
  id: 'north' | 'south' | 'southEast' | 'east' | 'west';
  x: number;
  z: number;
  hw: number;
  hd: number;
}

/** The walls, minus the doorway: the south wall is two pieces either side of it. */
export function harborHouseWalls(): HarborHouseWall[] {
  const { x, z, hw, hd, wall, door } = HARBOR_HOUSE;
  const half = wall / 2;
  const x0 = x - hw;
  const x1 = x + hw;
  const doorW = door.x - door.width / 2;
  const doorE = door.x + door.width / 2;
  return [
    { id: 'north', x, z: z - hd + half, hw, hd: half },
    { id: 'west', x: x0 + half, z, hw: half, hd },
    { id: 'east', x: x1 - half, z, hw: half, hd },
    { id: 'south', x: (x0 + doorW) / 2, z: z + hd - half, hw: (doorW - x0) / 2, hd: half },
    { id: 'southEast', x: (doorE + x1) / 2, z: z + hd - half, hw: (x1 - doorE) / 2, hd: half },
  ];
}

/** The floor's height above the waterline (the houseFloor deck). */
export function harborHouseFloorY(): number {
  return WATER_LEVEL + HARBOR_HOUSE_FLOOR_ABOVE_WATER;
}

/** One furnishing's collider, seated on the floor (or, outside, the ground) under it. */
export function harborHousePropCollider(prop: HarborHouseProp, seed: number): Collider {
  const base = groundHeight(prop.x, prop.z, seed);
  const top = base + prop.height;
  const move = prop.standable ? { moveTopY: top, standable: true as const } : {};
  if (prop.r !== undefined) {
    return { type: 'circle', x: prop.x, z: prop.z, r: prop.r, cameraTopY: top, ...move };
  }
  return {
    type: 'obb',
    x: prop.x,
    z: prop.z,
    hw: prop.hw ?? 0.5,
    hd: prop.hd ?? 0.5,
    rot: prop.rot,
    cameraTopY: top,
    ...move,
  };
}

/** Every collider of the house: the walls, then the furnishings and the chimney. */
export function harborHouseColliders(seed: number): Collider[] {
  const top = harborHouseFloorY() + HARBOR_HOUSE.wallTop;
  const out: Collider[] = harborHouseWalls().map((w) => ({
    type: 'obb' as const,
    x: w.x,
    z: w.z,
    hw: w.hw,
    hd: w.hd,
    rot: 0,
    cameraTopY: top,
  }));
  for (const prop of HARBOR_HOUSE_PROPS) out.push(harborHousePropCollider(prop, seed));
  return out;
}

/** Whether a body at (x, y, z) stands in the house's rest area: over the interior's floor,
 *  its feet between the floor and the wall plate (a swimmer under the stilts is not in it). */
export function harborHouseRestsAt(x: number, y: number, z: number): boolean {
  const i = HARBOR_HOUSE_INTERIOR;
  if (x < i.x0 || x > i.x1 || z < i.z0 || z > i.z1) return false;
  const floor = harborHouseFloorY();
  return y >= floor - HARBOR_HOUSE_REST_SINK && y <= floor + HARBOR_HOUSE.wallTop;
}

/** The keeper's id in the NPC table. */
export const HARBOR_HOUSE_KEEPER_NPC_ID = 'harbormaster_tamsin';

/** Spawn the harbormaster on the house's floor behind the chart table, under her reserved id,
 *  when the world carries her (the built-in world). Idempotent; draws no rng. */
export function spawnHarborHouseKeeper(ctx: SimContext, world: WorldContent): void {
  const def = world.npcs[HARBOR_HOUSE_KEEPER_NPC_ID];
  if (!def?.dynamic) return;
  if (ctx.entities.has(HARBOR_HOUSE_KEEPER_ENTITY_ID)) return;
  ctx.addEntity(createNpc(HARBOR_HOUSE_KEEPER_ENTITY_ID, def, ctx.groundPos(def.pos.x, def.pos.z)));
}
