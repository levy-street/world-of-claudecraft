// The Drowned Gate Tower: the world entrance of the Sunken Bastion (door
// (45, 515), Mirefen Marsh). The barbican of the Court's drowned keep, taken
// to its shoulders by the peat knoll the north fen road climbs: two truncated
// round towers leaning outward, the gate front between them with its outer
// arch, jammed portcullis and star-glass rosette, an open gate court, and at
// the door the inner arch whose piers ARE the door's jambs, with the flood
// sill across it and the roofed passage running on into the mound; a curtain
// wall stepping down the east slope into rubble and a heap of the east
// tower's fallen blocks beside the road. The models are three Blender GLBs drawn by
// src/render/sunken_bastion_entrance.ts; THIS module is the one source of
// truth for what collides, shared by the sim (dungeon_door_jambs.ts hands
// these in place of the generic jambs) and the tests.
//
// Local coordinates are door-relative: lx = x - door.x (+x is WEST), lz =
// z - door.z (+z is NORTH), and every height is above terrainHeight at the
// door, the one height the GLBs are seated at. The authoring tool, its terrain
// probe and its review renders are docs/design/dungeon-rework/entrance/.

import type { Collider } from './colliders';
import { terrainHeight } from './world';

export const SUNKEN_BASTION_ENTRANCE_DUNGEON_ID = 'sunken_bastion';

/** Half width of the open walk-in lane between the inner arch's piers: inside
 *  DOOR_TRIGGER_RADIUS (2), so nobody crosses the door untriggered. */
export const SUNKEN_BASTION_ENTRANCE_LANE_HALF_WIDTH = 1.25;

/** Half width of the outer arch (the gate court's mouth), under the portcullis. */
export const SUNKEN_BASTION_ENTRANCE_GATE_HALF_WIDTH = 2.2;

/** The procedural scatter the gatehouse stands on (decoration_exclusions.ts
 *  drops it): a rock inside the west tower's drum, and a broadleaf whose
 *  trunk stood against the east tower and whose crown filled the hoarding. */
export const SUNKEN_BASTION_ENTRANCE_CLEARED_SCATTER = [
  { x: 53.64584932429716, z: 511.6929228263907 },
  { x: 37.96934285759926, z: 518.8265399737284 },
] as const;

export interface BastionEntranceColliderRow {
  readonly name: string;
  readonly type: 'obb' | 'circle';
  readonly lx: number;
  readonly lz: number;
  readonly hw?: number;
  readonly hd?: number;
  readonly rot?: number;
  readonly r?: number;
  /** Visual top above the door's terrain height (camera sight checks). */
  readonly top: number;
}

/**
 * Every solid piece of the set piece, measured from the Blender build
 * (stats.json of build_bastion_entrance.py): the two tower drums, the gate
 * front either side of the outer arch, the court's two side walls and the
 * winch on the west one, the inner arch's two piers (their inner faces are
 * the lane edges), the flood sill and the black water behind it (closed: the
 * walk-in trigger takes a body first), the roofed passage's two walls, the
 * two curtain runs and the heap of fallen blocks. The causeway setts, the
 * peat, the standing water, the scattered rubble and all the growth are
 * walk-over dressing.
 */
export const SUNKEN_BASTION_ENTRANCE_COLLIDERS: readonly BastionEntranceColliderRow[] = [
  { name: 'tower_w', type: 'circle', lx: 7.2, lz: -1.2, r: 3.05, top: 14.4 },
  { name: 'tower_e', type: 'circle', lx: -7.2, lz: -1.2, r: 3.05, top: 7.99 },
  { name: 'front_wall_e', type: 'obb', lx: -3.4, lz: -3, hw: 1.2, hd: 0.65, rot: 0, top: 9.05 },
  { name: 'front_wall_w', type: 'obb', lx: 3.4, lz: -3, hw: 1.2, hd: 0.65, rot: 0, top: 9.05 },
  { name: 'court_wall_e', type: 'obb', lx: -2.65, lz: -1.45, hw: 0.45, hd: 0.9, rot: 0, top: 6.1 },
  { name: 'court_wall_w', type: 'obb', lx: 2.65, lz: -1.45, hw: 0.45, hd: 0.9, rot: 0, top: 6.4 },
  { name: 'door_pier_e', type: 'obb', lx: -2.175, lz: 0, hw: 0.925, hd: 0.55, rot: 0, top: 5.6 },
  { name: 'door_pier_w', type: 'obb', lx: 2.175, lz: 0, hw: 0.925, hd: 0.55, rot: 0, top: 5.6 },
  { name: 'flood_sill', type: 'obb', lx: 0, lz: 2.85, hw: 1.35, hd: 2.75, rot: 0, top: 4.2 },
  {
    name: 'passage_wall_e',
    type: 'obb',
    lx: -1.62,
    lz: 3.075,
    hw: 0.28,
    hd: 2.525,
    rot: 0,
    top: 4.6,
  },
  {
    name: 'passage_wall_w',
    type: 'obb',
    lx: 1.62,
    lz: 3.075,
    hw: 0.28,
    hd: 2.525,
    rot: 0,
    top: 4.6,
  },
  { name: 'winch', type: 'obb', lx: 1.92, lz: -1.55, hw: 0.3, hd: 0.5, rot: 0, top: 0.71 },
  {
    name: 'curtain_0',
    type: 'obb',
    lx: -12.3,
    lz: 1.55,
    hw: 3.134,
    hd: 0.75,
    rot: -2.549,
    top: 6.08,
  },
  {
    name: 'curtain_1',
    type: 'obb',
    lx: -17.25,
    lz: 5.1,
    hw: 2.96,
    hd: 0.75,
    rot: -2.488,
    top: 1.93,
  },
  { name: 'fallen_stones', type: 'circle', lx: -10.6, lz: -8.6, r: 2.1, top: -0.4 },
];

export interface BastionEntranceFooting {
  readonly name: string;
  readonly lx: number;
  readonly lz: number;
  readonly hw: number;
  readonly hd: number;
  readonly rot: number;
  /** The footing's underside above the door's terrain height. */
  readonly bottom: number;
}

/**
 * The GLBs' terrain contract: every footing's underside, modelled against
 * the sim's own terrain sampled every half yard. The knoll is steep (a yard
 * of fall in two), so each footing is cut a fixed depth under the LOWEST
 * ground at its centre and four corners: it never floats at any of them, and
 * at that lowest corner it is no deeper than its design burial;
 * tests/sunken_bastion_entrance.test.ts pins both against groundHeight. The
 * towers 0.8 under the lowest corner of the square round their drum, walls
 * 0.5 to 0.6, the flood sill 0.3, the winch's feet 0.12; the fallen blocks
 * lie sunk in the peat.
 */
export const SUNKEN_BASTION_ENTRANCE_FOOTINGS: readonly BastionEntranceFooting[] = [
  { name: 'tower_w', lx: 7.2, lz: -1.2, hw: 2.9, hd: 2.9, rot: 0, bottom: -6.722 },
  { name: 'tower_e', lx: -7.2, lz: -1.2, hw: 2.9, hd: 2.9, rot: 0, bottom: -2.295 },
  { name: 'gate_front', lx: 0, lz: -3, hw: 4.6, hd: 0.65, rot: 0, bottom: -3.506 },
  { name: 'court_wall_e', lx: -2.65, lz: -1.45, hw: 0.45, hd: 0.9, rot: 0, bottom: -1.42 },
  { name: 'court_wall_w', lx: 2.65, lz: -1.45, hw: 0.45, hd: 0.9, rot: 0, bottom: -2.281 },
  { name: 'inner_arch', lx: 0, lz: 0, hw: 3.1, hd: 0.55, rot: 0, bottom: -1.382 },
  { name: 'flood_sill', lx: 0, lz: 0.3, hw: 1.25, hd: 0.2, rot: 0, bottom: -0.48 },
  { name: 'passage_wall_e', lx: -1.62, lz: 3.075, hw: 0.28, hd: 2.525, rot: 0, bottom: 0.04 },
  { name: 'passage_wall_w', lx: 1.62, lz: 3.075, hw: 0.28, hd: 2.525, rot: 0, bottom: -0.609 },
  { name: 'winch', lx: 1.92, lz: -1.55, hw: 0.25, hd: 0.45, rot: 0, bottom: -1.382 },
  { name: 'curtain_0', lx: -12.3, lz: 1.55, hw: 3.134, hd: 0.75, rot: -2.549, bottom: -0.655 },
  { name: 'curtain_1', lx: -17.25, lz: 5.1, hw: 2.96, hd: 0.75, rot: -2.488, bottom: -3.535 },
  { name: 'fallen_stones', lx: -10.6, lz: -8.6, hw: 0.6, hd: 0.6, rot: 0, bottom: -2.887 },
];

/** World colliders for the set piece at a door, seated on the door's terrain height. */
export function sunkenBastionEntranceColliders(
  seed: number,
  door: { readonly x: number; readonly z: number },
): Collider[] {
  const base = terrainHeight(door.x, door.z, seed);
  const out: Collider[] = [];
  for (const row of SUNKEN_BASTION_ENTRANCE_COLLIDERS) {
    const x = door.x + row.lx;
    const z = door.z + row.lz;
    if (row.type === 'obb') {
      out.push({
        type: 'obb',
        x,
        z,
        hw: row.hw ?? 0,
        hd: row.hd ?? 0,
        rot: row.rot ?? 0,
        cameraTopY: base + row.top,
      });
    } else {
      out.push({ type: 'circle', x, z, r: row.r ?? 0, cameraTopY: base + row.top });
    }
  }
  return out;
}
