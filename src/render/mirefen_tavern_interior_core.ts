// The Mirefen tavern's interior for the indoor chase camera (interior_camera_core.ts): the
// air of the common room, its front doorway, the arch and the tower's nook as boxes in the
// tavern's local frame (content/mirefen_tavern.ts), each against the inner wall faces, the
// floors and the lowest roof timber, joined through the doorway and the arch, and turned
// into the world. Three-, DOM- and i18n-free.
//
//  - the common room: its floor (a hand under it, for the hearth pit) to TAVERN_HALL_AIR_TOP,
//    well under the hammer beams, the hood, the chandelier and the lanterns (nothing hangs
//    into the air: tests/mirefen_tavern_interior_core.test.ts); the wall fireplace's breast
//    is solid to the eaves and the barrel racks behind the bar are solid to their tops, so
//    the air steps round both (the bar's pillar is not: it cuts away for the sight line,
//    mirefen_tavern_core.ts);
//  - the front doorway, its outside face the tavern's one opening onto the world (the camera
//    may follow through it from outside, and the plates of the road show through it);
//  - the arch onto the tower's nook (its segmental head as two boxes), and the nook's round
//    shaft, exact (a box rounded by the ring's inner face), up into its cone.
//
// Every doorway box runs a yard and more into the rooms either side, so the union stays
// joined when the camera shrinks each box by its near-plane pad.

import {
  TAVERN_ARCH,
  TAVERN_BAR_PLATFORM,
  TAVERN_DOOR,
  TAVERN_FLOOR_Y,
  TAVERN_HALL,
  TAVERN_ORIGIN,
  TAVERN_PROPS,
  TAVERN_TOWER,
  tavernToWorld,
} from '../sim/content/mirefen_tavern';
import {
  type CameraInterior,
  cameraInterior,
  type InteriorBox,
  type InteriorOpening,
  type InteriorRound,
} from './interior_camera_core';

const H = TAVERN_HALL;
const T = TAVERN_TOWER;

/** The common room's air stops here: a yard and more under the lowest roof timber (the
 *  hammer beams, TAVERN_HALL.truss), the hood's rim, the chandelier and the lanterns. */
export const TAVERN_HALL_AIR_TOP = 9.0;
/** The nook's air: up into the tower's cone, under the crown of candles hung in it. */
export const TAVERN_TOWER_AIR_TOP = T.wallTop - 0.2;
/** A hand under the ground floor (the hearth pit's floor is 0.45 down). */
const FLOOR_AIR = -0.6;
/** How far each doorway's air runs into the rooms either side. */
const REACH = 1.6;

const ix0 = H.x0 + H.wall;
const ix1 = H.x1 - H.wall;
const iz0 = H.z0 + H.wall;
const iz1 = H.z1 - H.wall;
const fire = TAVERN_PROPS.find((p) => p.kind === 'fireplace');
const fireX0 = (fire?.x ?? ix1) - (fire?.hw ?? 0) - 0.1;
const fireZ0 = (fire?.z ?? 0) - (fire?.hd ?? 0) - 0.1;
const fireZ1 = (fire?.z ?? 0) + (fire?.hd ?? 0) + 0.1;

// the barrel racks behind the bar: solid from the back wall to a hand before their fronts,
// up to a hand over their top shelves
const racks = TAVERN_PROPS.filter((p) => p.kind === 'barrels');
const RACK_X0 = Math.min(...racks.map((p) => p.x - (p.hw ?? 0))) - 0.1;
const RACK_FRONT = Math.max(...racks.map((p) => p.z + (p.hd ?? 0))) + 0.1;
const RACK_TOP = TAVERN_BAR_PLATFORM.lift + Math.max(...racks.map((p) => p.height)) + 0.2;
// the gaps between the racks (the barkeep's spot at the kitchen hatch): open to the back wall
const RACK_GAPS: readonly (readonly [number, number])[] = racks
  .map((p) => [p.x - (p.hw ?? 0), p.x + (p.hw ?? 0)] as const)
  .sort((a, b) => a[0] - b[0])
  .flatMap((r, i, all) => (i + 1 < all.length ? [[r[1] + 0.1, all[i + 1][0] - 0.1] as const] : []))
  .filter(([a, b]) => b - a > 1);

// the arch's segmental head (tavern_shell.py hall_back): springing at 3.9, crowned at its
// height; the second box is the head's chord half a yard under the crown
const ARCH_SPRING = 3.9;
const archMid = (TAVERN_ARCH.x0 + TAVERN_ARCH.x1) / 2;
const archHalf = (TAVERN_ARCH.x1 - TAVERN_ARCH.x0) / 2;
const archRise = TAVERN_ARCH.height - ARCH_SPRING;
const archR = (archHalf * archHalf + archRise * archRise) / (2 * archRise);
const archCrownY = TAVERN_ARCH.height - 0.5;
const archCrownHalf = Math.sqrt(
  Math.max(0, archR * archR - (archCrownY - (TAVERN_ARCH.height - archR)) ** 2),
);

// the nook's shaft: the ring's inner face (its chords sit a hand inside the circle), cut off
// by the hall's back wall
const TOWER_AIR_R = T.rIn - 0.05;

/** The tavern's air in its local frame: [x0, x1, y0, y1, z0, z1]. */
export const TAVERN_INTERIOR_LOCAL: readonly InteriorBox[] = [
  // (the boxes overlap wide, so the union stays joined when each shrinks by the pad)
  // 0: the common room west of the barrel racks, floor to the air's top, back wall to front
  [ix0, RACK_X0, FLOOR_AIR, TAVERN_HALL_AIR_TOP, iz0, iz1],
  // 1: before the racks, as far as the wall fireplace's breast
  [ix0, fireX0, FLOOR_AIR, TAVERN_HALL_AIR_TOP, RACK_FRONT, iz1],
  // 2, 3: the whole width again, back and front of the breast
  [ix0, ix1, FLOOR_AIR, TAVERN_HALL_AIR_TOP, RACK_FRONT, fireZ0],
  [ix0, ix1, FLOOR_AIR, TAVERN_HALL_AIR_TOP, fireZ1, iz1],
  // 4, 5: over the barrel racks' tops, either side of the breast's back edge
  [ix0, fireX0, RACK_TOP, TAVERN_HALL_AIR_TOP, iz0, iz1],
  [ix0, ix1, RACK_TOP, TAVERN_HALL_AIR_TOP, iz0, fireZ0],
  // 6: the front doorway, out to the wall's outside face (the opening onto the road)
  [
    TAVERN_DOOR.x - TAVERN_DOOR.width / 2,
    TAVERN_DOOR.x + TAVERN_DOOR.width / 2,
    FLOOR_AIR,
    TAVERN_DOOR.height,
    iz1 - REACH,
    H.z1,
  ],
  // 7, 8: the arch onto the nook, under its springing and under its head
  [TAVERN_ARCH.x0, TAVERN_ARCH.x1, FLOOR_AIR, ARCH_SPRING, H.z0 - REACH, iz0 + REACH],
  [
    archMid - archCrownHalf,
    archMid + archCrownHalf,
    FLOOR_AIR,
    archCrownY,
    H.z0 - REACH,
    iz0 + REACH,
  ],
  // 9: the nook's shaft (rounded: TAVERN_TOWER_SHAFT)
  [
    T.x - T.rIn,
    T.x + T.rIn,
    FLOOR_AIR,
    TAVERN_TOWER_AIR_TOP,
    T.z - T.rIn,
    Math.min(T.z + T.rIn, H.z0),
  ],
  // 10 on: between the barrel racks, down to the floor, to the back wall (the kitchen hatch)
  ...RACK_GAPS.map(
    ([x0, x1]) => [x0, x1, FLOOR_AIR, TAVERN_HALL_AIR_TOP, iz0, RACK_FRONT + REACH] as InteriorBox,
  ),
];

/** The front doorway's box and its outside face (local +z, out of the door). */
export const TAVERN_FRONT_DOOR_BOX = 6;
/** The nook's box, rounded by the ring's inner face (local x, z, r). */
export const TAVERN_TOWER_SHAFT = { box: 9, x: T.x, z: T.z, r: TOWER_AIR_R } as const;

/** Local box to world: local z runs along world +x, local x along world -z. */
export function tavernBoxToWorld(b: InteriorBox): InteriorBox {
  const ox = TAVERN_ORIGIN.x;
  const oz = TAVERN_ORIGIN.z;
  const fy = TAVERN_FLOOR_Y;
  return [ox + b[4], ox + b[5], fy + b[2], fy + b[3], oz - b[1], oz - b[0]];
}

/** The tavern's interior, in the world, for the camera registry. */
export function mirefenTavernCameraInterior(): CameraInterior {
  // the door's outside face is local +z: world +x
  const openings: InteriorOpening[] = [{ box: TAVERN_FRONT_DOOR_BOX, axis: 0, side: 1 }];
  const shaft = TAVERN_TOWER_SHAFT;
  const centre = tavernToWorld(shaft.x, shaft.z);
  const rounds = new Map<number, InteriorRound>([[shaft.box, [centre.x, centre.z, shaft.r]]]);
  return cameraInterior(
    'mirefen_tavern',
    TAVERN_INTERIOR_LOCAL.map(tavernBoxToWorld),
    openings,
    rounds,
    'preserve-angle',
  );
}

/** Whether a player's eye at a local point is indoors (the shell's indoor test when the
 *  camera clamp is not running: in the air, and not only in the front doorway). */
export function eyeInTavernAir(x: number, y: number, z: number): boolean {
  const shaft = TAVERN_TOWER_SHAFT;
  for (let i = 0; i < TAVERN_INTERIOR_LOCAL.length; i++) {
    if (i === TAVERN_FRONT_DOOR_BOX) continue;
    const b = TAVERN_INTERIOR_LOCAL[i];
    if (x < b[0] || x > b[1] || y < b[2] || y > b[3] || z < b[4] || z > b[5]) continue;
    if (i === shaft.box && Math.hypot(x - shaft.x, z - shaft.z) > shaft.r) continue;
    return true;
  }
  return false;
}
