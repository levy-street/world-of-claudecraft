// The Harbormaster's House at the Wyrmwatch cliff harbor (content/wyrmwatch_harbor.ts): the
// walk-in timber house on stilts at the north end of the harbor, grown seaward from the old
// harbormaster's shack over the water north of the pier, never onto the land. Data-as-code;
// the colliders and the rest area are built by ../wyrmwatch_harbor_house.ts, its floor is the
// harbor's `houseFloor` deck (content/wyrmwatch_harbor.ts, the ferry pier surface query), and
// the model is part of the one harbor GLB (scripts/assets/wyrmwatch_harbor/, reading THESE
// numbers through layout.json; render/wyrmwatch_harbor_house.ts cuts its walls and roof away
// when the camera would look through them).
//
// The layout, world yards (x east, z south; heights over the floor unless named otherwise):
//  - the footprint's outer wall faces run x 487.9..498.3 and z 1880.8..1890.4: the west wall
//    stands where the north yard's landward rail stood, the rest stands over the sea, so the
//    house reads from the water as the harbor's main building while the ferry's lanes, the
//    gangplank, the route marker and the stair keep every yard they had;
//  - the door is in the south wall, on the north yard, facing the pier: a walk of eight
//    yards from the pier's root, straight in;
//  - inside: the hearth on the landward (west) wall with the rest corner before it, the big
//    wall map of the two ferry routes on the north wall (the first thing seen from the door),
//    the chart table under it where the harbormaster stands, cargo in the south-east corner.
//
// Scale: the player stands 2.6 yd to the crown on a 0.5 yd body radius, so the door clears
// 2.4 by 3.8, the room stands 7 yd to the wall plate (the tie beams at 6.6), and the
// furniture is sized generously so the player reads small in it.

import type { NpcDef } from '../types';

/** The floor stands at the harbor quays' plank height (WYRMWATCH_QUAY_ABOVE_WATER). */
export const HARBOR_HOUSE_FLOOR_ABOVE_WATER = 2.64;

/** The house's frame, in world yards. */
export const HARBOR_HOUSE = {
  /** The footprint's centre (the outer wall faces). */
  x: 493.1,
  z: 1885.6,
  /** Outer half extents along x and z. */
  hw: 5.2,
  hd: 4.8,
  /** Wall thickness (the colliders' depth; the model's boards and posts stand in it). */
  wall: 0.45,
  /** The wall plate over the floor (the eaves' line), and the tie beams under it. */
  wallTop: 7.0,
  tieBeam: 6.6,
  /** The ridge over the floor (the roof runs east to west, its gables facing the sea and
   *  the land). */
  ridge: 12.3,
  /** The roof's surface: it runs from `ridgeDrop` under the ridge down to `plateLift` over
   *  the wall plate, and overhangs the walls by `eaveOut` at the eaves and `vergeOut` at the
   *  gables (the model builds it from these; the camera cutaway tests against them). */
  roof: { ridgeDrop: 0.28, plateLift: 0.1, eaveOut: 1.0, vergeOut: 0.6 },
  /** The doorway in the south (+z) wall: its centre x, clear width and height. */
  door: { x: 490.2, width: 2.4, height: 3.8 },
} as const;

/** The interior's floor rectangle (inside the walls), world yards. */
export const HARBOR_HOUSE_INTERIOR = {
  x0: HARBOR_HOUSE.x - HARBOR_HOUSE.hw + HARBOR_HOUSE.wall,
  x1: HARBOR_HOUSE.x + HARBOR_HOUSE.hw - HARBOR_HOUSE.wall,
  z0: HARBOR_HOUSE.z - HARBOR_HOUSE.hd + HARBOR_HOUSE.wall,
  z1: HARBOR_HOUSE.z + HARBOR_HOUSE.hd - HARBOR_HOUSE.wall,
} as const;

/** A solid thing in or on the house: what the sim collides with and the model draws there.
 *  Heights are over the floor (or, outside, the ground under its centre). */
export type HarborHousePropKind =
  | 'hearth'
  | 'chimney'
  | 'chartTable'
  | 'armchair'
  | 'settle'
  | 'sideTable'
  | 'crateStack'
  | 'barrel';

export interface HarborHouseProp {
  kind: HarborHousePropKind;
  x: number;
  z: number;
  /** Yaw, three.js rotation.y convention. */
  rot: number;
  r?: number;
  hw?: number;
  hd?: number;
  height: number;
  /** Furniture and cargo can be stood on (the camp crates' idiom); the hearth and the
   *  chimney are full height. */
  standable?: boolean;
}

export const HARBOR_HOUSE_PROPS: readonly HarborHouseProp[] = [
  // the stone hearth against the landward wall, its chimney breast rising to the tie beams,
  // and the stack outside it standing on the shingle below
  { kind: 'hearth', x: 488.95, z: 1884.5, rot: 0, hw: 0.6, hd: 1.45, height: 7.0 },
  { kind: 'chimney', x: 487.3, z: 1884.5, rot: 0, hw: 0.6, hd: 0.95, height: 16 },
  // the rest corner before the fire: a high-backed settle against the north wall, an
  // armchair turned to the hearth, and a small table between them
  { kind: 'settle', x: 490.5, z: 1881.72, rot: 0, hw: 1.2, hd: 0.45, height: 1.0, standable: true },
  { kind: 'armchair', x: 492.0, z: 1883.1, rot: 0, r: 0.55, height: 1.0, standable: true },
  { kind: 'sideTable', x: 492.95, z: 1882.1, rot: 0, r: 0.35, height: 0.9, standable: true },
  // the chart table in the middle of the room, under the wall map
  {
    kind: 'chartTable',
    x: 494.3,
    z: 1886.4,
    rot: 0,
    hw: 1.4,
    hd: 0.8,
    height: 1.25,
    standable: true,
  },
  // cargo in the south-east corner, clear of the door and the walk to the table
  {
    kind: 'crateStack',
    x: 496.8,
    z: 1889.0,
    rot: 0,
    hw: 0.9,
    hd: 0.8,
    height: 1.6,
    standable: true,
  },
  { kind: 'barrel', x: 497.25, z: 1887.25, rot: 0, r: 0.5, height: 1.35, standable: true },
  { kind: 'barrel', x: 495.2, z: 1889.35, rot: 0, r: 0.45, height: 1.2, standable: true },
];

/** The wall map of the two ferry routes on the north wall's inner face: its centre x, width,
 *  and bottom and top over the floor (framed; the world is tall, north to south, so the
 *  map is too). Decorative: no timetable, clock or ship state. */
export const HARBOR_HOUSE_MAP = { x: 493.8, width: 2.7, bottom: 0.9, top: 6.4 } as const;

/** The lanterns hung on rods from the tie beams (world x, z; the drop from the tie beam to
 *  the lantern's middle): over the rest corner, between the chart table and the map, and
 *  over the cargo. The first two also light the room (render/wyrmwatch_harbor_house.ts). */
export const HARBOR_HOUSE_LANTERNS: readonly {
  x: number;
  z: number;
  drop: number;
  lit: boolean;
}[] = [
  { x: 491.2, z: 1883.7, drop: 2.2, lit: true },
  { x: 493.8, z: 1883.9, drop: 2.0, lit: true },
  { x: 496.4, z: 1888.6, drop: 2.3, lit: false },
];

/** Where the harbormaster stands: behind the chart table, turned toward the door. */
export const HARBOR_HOUSE_NPC_POS = { x: 494.3, z: 1884.5 } as const;
export const HARBOR_HOUSE_NPC_FACING = Math.atan2(
  HARBOR_HOUSE.door.x - HARBOR_HOUSE_NPC_POS.x,
  HARBOR_HOUSE.z + HARBOR_HOUSE.hd - HARBOR_HOUSE_NPC_POS.z,
);

/** The rest area: the interior's floor, at the floor's height (a swimmer under the house
 *  is not in it). A body counts as resting when its feet are no further under the floor. */
export const HARBOR_HOUSE_REST_SINK = 0.5;

/** The harbormaster's reserved entity id (the singleton NPCs' 1_000_000_x namespace, types.ts
 *  STATIC_WORLD_SERVICE_ENTITY_ID_MIN's note): she spawns under it, outside the sequential
 *  allocator, so no other entity's id moves and no parity golden changes. */
export const HARBOR_HOUSE_KEEPER_ENTITY_ID = 1_000_000_005;

/** The harbormaster who keeps the house: gossip only (no quests, no stock). `dynamic`, so the
 *  world-init NPC loop skips her; ../wyrmwatch_harbor_house.ts spawns her under her reserved
 *  id (the FURY / Crucible vendor idiom). */
export const WYRMWATCH_HARBOR_NPCS: Record<string, NpcDef> = {
  harbormaster_tamsin: {
    id: 'harbormaster_tamsin',
    name: 'Harbormaster Tamsin',
    title: 'Keeper of the Wyrmwatch Quays',
    pos: { x: HARBOR_HOUSE_NPC_POS.x, z: HARBOR_HOUSE_NPC_POS.z },
    facing: HARBOR_HOUSE_NPC_FACING,
    color: 0x3a5a8a,
    questIds: [],
    dynamic: true,
    greeting:
      'Come in off the quay and warm your hands. The ship at our pier sails up the long east coast to Wickharbor and back again. Far to the west, the other ferry runs between Eastbrook and the Nightbloom. The map on the wall shows both crossings. Rest by the fire before the climb to Wyrmwatch.',
  },
};
