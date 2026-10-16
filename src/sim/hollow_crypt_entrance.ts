// The Fallen Chapel: the world entrance of the Hollow Crypt (door (80, 90),
// Eastbrook Vale). The roofless mother church of the Chapel of the Sleep: the
// south gable with its empty rose window (z 68), the broken nave walls round
// the old ruin ring, the chancel and apse, and at the door the vaulted crypt
// stair-house whose portal jambs ARE the door's jambs, two mourners flanking
// it, a dead yew behind it; the dragged altar slab, the fallen bell, the
// ledger lectern, the vestry nook, the shrouded font, two clusters of
// headstones outside the walls and the lychgate on the approach. The models
// are four Blender GLBs drawn by src/render/hollow_crypt_entrance.ts; THIS
// module is the one source of truth for what collides, shared by the sim
// (dungeon_door_jambs.ts hands these in place of the generic jambs) and the
// tests.
//
// Local coordinates are door-relative: lx = x - door.x (+x is WEST), lz =
// z - door.z (+z is NORTH), and every height is above terrainHeight at the
// door, the one height the GLBs are seated at. The authoring tool, its terrain
// probe and its review renders are docs/design/dungeon-rework/entrance/.

import type { Collider } from './colliders';
import { terrainHeight } from './world';

export const HOLLOW_CRYPT_ENTRANCE_DUNGEON_ID = 'hollow_crypt';

/** Half width of the open walk-in lane between the portal's jambs: inside
 *  DOOR_TRIGGER_RADIUS (2), so nobody crosses the arch untriggered. */
export const HOLLOW_CRYPT_ENTRANCE_LANE_HALF_WIDTH = 1.3;

/** The old ruin ring whose site the chapel stands on (ZONE1_PROPS.ruinRings):
 *  it is `bare` now (no kit columns, no toppled relics), the nave's own
 *  masonry piers stand in its place, and it keeps its terrain pad. */
export const HOLLOW_CRYPT_NAVE_RING = { x: 80, z: 78 } as const;

export interface CryptEntranceColliderRow {
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
  /** A low standable top above the door's terrain height (tomb lids, yard walls). */
  readonly standTop?: number;
}

/**
 * Every solid piece of the set piece, measured from the Blender build
 * (stats.json of build_crypt_entrance.py): the stair-house's two sides (their
 * inner faces are the lane edges) and its dark back, the mourners' pedestals,
 * the gable either side of its open doorway and its corner buttresses, the
 * nave wall runs between their breaches and their buttresses, the six nave
 * piers and the fallen one, the chancel
 * shoulders, the apse, the yew, the bell, the altar slab, the lectern, the
 * vestry nook, the font, the headstones and table tombs, the lychgate's cheek
 * walls and the churchyard wall. The flags, the candles, the drag scars, the
 * rubble, the fallen blocks and all the growth are walk-over dressing.
 */
export const HOLLOW_CRYPT_ENTRANCE_COLLIDERS: readonly CryptEntranceColliderRow[] = [
  { name: 'mourner_e', type: 'obb', lx: -2.05, lz: -1.15, hw: 0.42, hd: 0.42, rot: 0, top: 3.3 },
  { name: 'mourner_w', type: 'obb', lx: 2.05, lz: -1.15, hw: 0.42, hd: 0.42, rot: 0, top: 3.3 },
  {
    name: 'stairhouse_e',
    type: 'obb',
    lx: -2.35,
    lz: 2.275,
    hw: 1.05,
    hd: 3.025,
    rot: 0,
    top: 7.2,
  },
  { name: 'stairhouse_w', type: 'obb', lx: 2.35, lz: 2.275, hw: 1.05, hd: 3.025, rot: 0, top: 7.2 },
  { name: 'stairhouse_back', type: 'obb', lx: 0, lz: 3.2, hw: 1.3, hd: 2.1, rot: 0, top: 4.2 },
  {
    name: 'gable_buttress_e',
    type: 'obb',
    lx: -9.25,
    lz: -23.55,
    hw: 0.7,
    hd: 1.4,
    rot: 0,
    top: 5.6,
  },
  {
    name: 'gable_buttress_w',
    type: 'obb',
    lx: 9.25,
    lz: -23.55,
    hw: 0.7,
    hd: 1.4,
    rot: 0,
    top: 9.2,
  },
  { name: 'gable_wall_e', type: 'obb', lx: -5.925, lz: -22, hw: 3.675, hd: 0.68, rot: 0, top: 12 },
  { name: 'gable_wall_w', type: 'obb', lx: 5.925, lz: -22, hw: 3.675, hd: 0.68, rot: 0, top: 17.6 },
  { name: 'fallen_bell', type: 'circle', lx: 5.1, lz: 4.5, r: 1.15, top: 1.5 },
  { name: 'altar_slab', type: 'obb', lx: -4.7, lz: 4.3, hw: 0.72, hd: 1.42, rot: 0.35, top: 1 },
  { name: 'lectern', type: 'circle', lx: 5.6, lz: -4.3, r: 0.55, top: 1.75 },
  { name: 'vestry_wall', type: 'obb', lx: -7, lz: -4.6, hw: 0.4, hd: 1.85, rot: 0, top: 2.4 },
  { name: 'vestry_return', type: 'obb', lx: -5.85, lz: -2.85, hw: 0.95, hd: 0.4, rot: 0, top: 1.5 },
  { name: 'font', type: 'circle', lx: 5.4, lz: -19.4, r: 0.9, top: 1.7 },
  { name: 'nave_buttress_e_20', type: 'circle', lx: -9.6, lz: -17.66, r: 0.6, top: 7.38 },
  { name: 'nave_buttress_e_62', type: 'circle', lx: -9.6, lz: -9.701, r: 0.6, top: 2.6 },
  {
    name: 'nave_wall_e_0',
    type: 'obb',
    lx: -8.5,
    lz: -17.186,
    hw: 0.58,
    hd: 4.264,
    rot: 0,
    top: 7.76,
  },
  {
    name: 'nave_wall_e_1',
    type: 'obb',
    lx: -8.5,
    lz: -8.28,
    hw: 0.58,
    hd: 2.748,
    rot: 0,
    top: 4.04,
  },
  {
    name: 'nave_wall_e_2',
    type: 'obb',
    lx: -8.5,
    lz: -3.258,
    hw: 0.58,
    hd: 0.758,
    rot: 0,
    top: 1.4,
  },
  { name: 'nave_buttress_w_20', type: 'circle', lx: 9.6, lz: -17.66, r: 0.6, top: 6.23 },
  { name: 'nave_buttress_w_62', type: 'circle', lx: 9.6, lz: -9.701, r: 0.6, top: 3.59 },
  { name: 'nave_buttress_w_96', type: 'circle', lx: 9.6, lz: -3.258, r: 0.6, top: 1.2 },
  {
    name: 'nave_wall_w_0',
    type: 'obb',
    lx: 8.5,
    lz: -17.944,
    hw: 0.58,
    hd: 3.506,
    rot: 0,
    top: 7.34,
  },
  {
    name: 'nave_wall_w_1',
    type: 'obb',
    lx: 8.5,
    lz: -10.27,
    hw: 0.58,
    hd: 2.274,
    rot: 0,
    top: 4.79,
  },
  { name: 'nave_wall_w_2', type: 'obb', lx: 8.5, lz: -4.395, hw: 0.58, hd: 1.895, rot: 0, top: 2 },
  { name: 'nave_pier_0', type: 'circle', lx: 4.6, lz: -17.6, r: 0.85, top: 2.2, standTop: 2 },
  { name: 'nave_pier_1', type: 'circle', lx: 4.6, lz: -12.6, r: 0.85, top: 5 },
  { name: 'nave_pier_2', type: 'circle', lx: 4.6, lz: -7.6, r: 0.85, top: 1.5, standTop: 1.3 },
  { name: 'nave_pier_3', type: 'circle', lx: -4.6, lz: -17.6, r: 0.85, top: 3.7 },
  { name: 'nave_pier_4', type: 'circle', lx: -4.6, lz: -12.6, r: 0.85, top: 1.8, standTop: 1.6 },
  { name: 'nave_pier_5', type: 'circle', lx: -4.6, lz: -7.6, r: 0.85, top: 5.8 },
  {
    name: 'fallen_pier',
    type: 'obb',
    lx: -2.67,
    lz: -15.57,
    hw: 1.7,
    hd: 0.62,
    rot: -0.47,
    top: 1.05,
    standTop: 1,
  },
  { name: 'chancel_wall_e', type: 'obb', lx: -7.8, lz: 0, hw: 0.52, hd: 2.5, rot: 0, top: 2.4 },
  { name: 'chancel_wall_w', type: 'obb', lx: 7.8, lz: 0, hw: 0.52, hd: 2.5, rot: 0, top: 2.4 },
  {
    name: 'apse_wall_0',
    type: 'obb',
    lx: 6.658,
    lz: 5.258,
    hw: 2.985,
    hd: 0.5,
    rot: -1.964,
    top: 4,
  },
  {
    name: 'apse_wall_1',
    type: 'obb',
    lx: 3.435,
    lz: 9.098,
    hw: 2.346,
    hd: 0.5,
    rot: -2.662,
    top: 4,
  },
  {
    name: 'apse_wall_2',
    type: 'obb',
    lx: -3.435,
    lz: 9.098,
    hw: 2.346,
    hd: 0.5,
    rot: 2.662,
    top: 4,
  },
  {
    name: 'apse_wall_3',
    type: 'obb',
    lx: -6.658,
    lz: 5.258,
    hw: 2.985,
    hd: 0.5,
    rot: 1.964,
    top: 4,
  },
  {
    name: 'headstone_-14.5_-11.6',
    type: 'obb',
    lx: -14.464,
    lz: -11.59,
    hw: 0.421,
    hd: 0.22,
    rot: 0.006,
    top: 1.84,
  },
  {
    name: 'headstone_-16.9_-9.5',
    type: 'obb',
    lx: -16.878,
    lz: -9.546,
    hw: 0.429,
    hd: 0.22,
    rot: -0.168,
    top: 1.38,
  },
  {
    name: 'headstone_-12.6_-8.5',
    type: 'obb',
    lx: -12.618,
    lz: -8.543,
    hw: 0.462,
    hd: 0.22,
    rot: 0.196,
    top: 1.32,
  },
  {
    name: 'headstone_-12.5_-10.7',
    type: 'obb',
    lx: -12.454,
    lz: -10.72,
    hw: 0.451,
    hd: 0.22,
    rot: -0.11,
    top: 1.8,
  },
  {
    name: 'headstone_-17.5_-6.5',
    type: 'obb',
    lx: -17.483,
    lz: -6.531,
    hw: 0.518,
    hd: 0.22,
    rot: -0.111,
    top: 2.05,
  },
  {
    name: 'headstone_-15.0_-6.7',
    type: 'obb',
    lx: -14.983,
    lz: -6.665,
    hw: 0.549,
    hd: 0.22,
    rot: -0.127,
    top: 1.34,
  },
  {
    name: 'headstone_-14.2_-8.4',
    type: 'obb',
    lx: -14.2,
    lz: -8.405,
    hw: 0.464,
    hd: 0.22,
    rot: 0.101,
    top: 1.55,
  },
  {
    name: 'headstone_-12.2_-6.9',
    type: 'obb',
    lx: -12.244,
    lz: -6.942,
    hw: 0.548,
    hd: 0.22,
    rot: 0.168,
    top: 1.52,
  },
  {
    name: 'table_tomb_8',
    type: 'obb',
    lx: -14.1,
    lz: -5.4,
    hw: 0.62,
    hd: 1.12,
    rot: 0.2,
    top: 1,
    standTop: 0.94,
  },
  {
    name: 'headstone_16.7_-15.4',
    type: 'obb',
    lx: 16.702,
    lz: -15.416,
    hw: 0.453,
    hd: 0.22,
    rot: 0.09,
    top: 1.31,
  },
  {
    name: 'headstone_15.2_-15.7',
    type: 'obb',
    lx: 15.226,
    lz: -15.704,
    hw: 0.454,
    hd: 0.22,
    rot: 0.21,
    top: 1.82,
  },
  {
    name: 'headstone_12.0_-14.1',
    type: 'obb',
    lx: 12.003,
    lz: -14.131,
    hw: 0.497,
    hd: 0.22,
    rot: -0.294,
    top: 1.43,
  },
  {
    name: 'headstone_11.6_-16.0',
    type: 'obb',
    lx: 11.559,
    lz: -16.038,
    hw: 0.476,
    hd: 0.22,
    rot: 0.079,
    top: 1.94,
  },
  {
    name: 'headstone_16.6_-17.2',
    type: 'obb',
    lx: 16.646,
    lz: -17.172,
    hw: 0.499,
    hd: 0.22,
    rot: 0.171,
    top: 1.96,
  },
  {
    name: 'headstone_11.4_-18.3',
    type: 'obb',
    lx: 11.401,
    lz: -18.271,
    hw: 0.446,
    hd: 0.22,
    rot: -0.215,
    top: 2.08,
  },
  {
    name: 'headstone_14.3_-17.3',
    type: 'obb',
    lx: 14.303,
    lz: -17.34,
    hw: 0.539,
    hd: 0.22,
    rot: -0.068,
    top: 1.33,
  },
  {
    name: 'table_tomb_15',
    type: 'obb',
    lx: 14.6,
    lz: -12.9,
    hw: 0.62,
    hd: 1.12,
    rot: 0.2,
    top: 1,
    standTop: 0.94,
  },
  { name: 'lychgate_wall_e', type: 'obb', lx: -4.85, lz: -31, hw: 0.45, hd: 1.4, rot: 0, top: 4.6 },
  { name: 'lychgate_wall_w', type: 'obb', lx: -0.15, lz: -31, hw: 0.45, hd: 1.4, rot: 0, top: 4.6 },
  {
    name: 'yard_wall_0',
    type: 'obb',
    lx: 3.7,
    lz: -30.6,
    hw: 3.324,
    hd: 0.38,
    rot: -0.121,
    top: 1.55,
    standTop: 1.45,
  },
  {
    name: 'yard_wall_-5',
    type: 'obb',
    lx: -8.2,
    lz: -30.4,
    hw: 2.864,
    hd: 0.38,
    rot: -2.93,
    top: 1.4,
    standTop: 1.3,
  },
  {
    name: 'yard_wall_9',
    type: 'obb',
    lx: 10.35,
    lz: -29.15,
    hw: 1.812,
    hd: 0.38,
    rot: -0.427,
    top: 1.1,
    standTop: 1,
  },
  { name: 'yew', type: 'circle', lx: -3.9, lz: 6.3, r: 0.85, top: 9.5 },
];

export interface CryptEntranceFooting {
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
 * the sim's own terrain sampled every half yard. Each one sits below the
 * ground at all of its corners (no gap) and no deeper than its design burial
 * (no sinking); tests/hollow_crypt_entrance.test.ts pins both against
 * groundHeight. Walls and buttresses 0.45 under their lowest ground (the
 * stair-house 0.5), headstones 0.35, the yew 0.3, the furnishings a few
 * centimetres.
 */
export const HOLLOW_CRYPT_ENTRANCE_FOOTINGS: readonly CryptEntranceFooting[] = [
  { name: 'stairhouse', lx: 0, lz: 2.275, hw: 3.4, hd: 3.025, rot: 0, bottom: -0.646 },
  { name: 'mourner_e', lx: -2.05, lz: -1.15, hw: 0.45, hd: 0.45, rot: 0, bottom: 0.002 },
  { name: 'mourner_w', lx: 2.05, lz: -1.15, hw: 0.45, hd: 0.45, rot: 0, bottom: -0.217 },
  { name: 'gable_wall', lx: 0, lz: -22, hw: 9.6, hd: 0.6, rot: 0, bottom: -0.355 },
  { name: 'gable_buttress_e', lx: -9.25, lz: -23.65, hw: 0.65, hd: 1.25, rot: 0, bottom: -0.355 },
  { name: 'gable_buttress_w', lx: 9.25, lz: -23.65, hw: 0.65, hd: 1.25, rot: 0, bottom: -0.355 },
  { name: 'altar_slab', lx: -4.6, lz: 4.1, hw: 0.4, hd: 0.8, rot: 0.3, bottom: 0.088 },
  { name: 'fallen_bell', lx: 4.9, lz: 4.5, hw: 0.7, hd: 0.7, rot: 0, bottom: -0.511 },
  { name: 'lectern', lx: 5.6, lz: -4.3, hw: 0.45, hd: 0.45, rot: 0, bottom: -0.225 },
  { name: 'vestry_wall', lx: -7, lz: -4.6, hw: 0.31, hd: 1.75, rot: 0, bottom: -0.351 },
  { name: 'font', lx: 5.4, lz: -19.4, hw: 0.7, hd: 0.7, rot: 0, bottom: 0.005 },
  { name: 'nave_wall_e', lx: -8.5, lz: -11.975, hw: 0.5, hd: 9.475, rot: 0, bottom: -0.355 },
  { name: 'nave_wall_w', lx: 8.5, lz: -11.975, hw: 0.5, hd: 9.475, rot: 0, bottom: -0.607 },
  { name: 'nave_pier_0', lx: 4.6, lz: -17.6, hw: 0.6, hd: 0.6, rot: 0, bottom: -0.035 },
  { name: 'nave_pier_1', lx: 4.6, lz: -12.6, hw: 0.6, hd: 0.6, rot: 0, bottom: -0.035 },
  { name: 'nave_pier_2', lx: 4.6, lz: -7.6, hw: 0.6, hd: 0.6, rot: 0, bottom: -0.128 },
  { name: 'nave_pier_3', lx: -4.6, lz: -17.6, hw: 0.6, hd: 0.6, rot: 0, bottom: -0.035 },
  { name: 'nave_pier_4', lx: -4.6, lz: -12.6, hw: 0.6, hd: 0.6, rot: 0, bottom: -0.035 },
  { name: 'nave_pier_5', lx: -4.6, lz: -7.6, hw: 0.6, hd: 0.6, rot: 0, bottom: -0.033 },
  { name: 'fallen_pier', lx: -2.67, lz: -15.57, hw: 1.4, hd: 0.4, rot: -0.47, bottom: -0.055 },
  { name: 'chancel_wall_e', lx: -7.8, lz: 0, hw: 0.46, hd: 2.5, rot: 0, bottom: -0.343 },
  { name: 'chancel_wall_w', lx: 7.8, lz: 0, hw: 0.46, hd: 2.5, rot: 0, bottom: -0.605 },
  { name: 'apse_0', lx: 7.565, lz: 3.834, hw: 1.354, hd: 0.4, rot: -1.745, bottom: -0.59 },
  { name: 'apse_1', lx: 6.652, lz: 6.341, hw: 1.354, hd: 0.4, rot: -2.094, bottom: -0.564 },
  { name: 'apse_2', lx: 4.938, lz: 8.384, hw: 1.354, hd: 0.4, rot: -2.443, bottom: -0.401 },
  { name: 'apse_3', lx: 2.627, lz: 9.718, hw: 1.354, hd: 0.4, rot: -2.792, bottom: -0.254 },
  { name: 'apse_4', lx: 0, lz: 10.182, hw: 1.354, hd: 0.4, rot: -3.142, bottom: -0.225 },
  { name: 'apse_5', lx: -2.627, lz: 9.718, hw: 1.354, hd: 0.4, rot: 2.792, bottom: -0.235 },
  { name: 'apse_6', lx: -4.938, lz: 8.384, hw: 1.354, hd: 0.4, rot: 2.443, bottom: -0.262 },
  { name: 'apse_7', lx: -6.652, lz: 6.341, hw: 1.354, hd: 0.4, rot: 2.094, bottom: -0.291 },
  { name: 'apse_8', lx: -7.565, lz: 3.834, hw: 1.354, hd: 0.4, rot: 1.745, bottom: -0.317 },
  {
    name: 'headstone_-14.5_-11.6',
    lx: -14.464,
    lz: -11.59,
    hw: 0.321,
    hd: 0.1,
    rot: 0.006,
    bottom: -0.254,
  },
  {
    name: 'headstone_-16.9_-9.5',
    lx: -16.878,
    lz: -9.546,
    hw: 0.329,
    hd: 0.1,
    rot: -0.168,
    bottom: -0.254,
  },
  {
    name: 'headstone_-12.6_-8.5',
    lx: -12.618,
    lz: -8.543,
    hw: 0.362,
    hd: 0.1,
    rot: 0.196,
    bottom: -0.253,
  },
  {
    name: 'headstone_-12.5_-10.7',
    lx: -12.454,
    lz: -10.72,
    hw: 0.351,
    hd: 0.1,
    rot: -0.11,
    bottom: -0.254,
  },
  {
    name: 'headstone_-17.5_-6.5',
    lx: -17.483,
    lz: -6.531,
    hw: 0.418,
    hd: 0.1,
    rot: -0.111,
    bottom: -0.251,
  },
  {
    name: 'headstone_-15.0_-6.7',
    lx: -14.983,
    lz: -6.665,
    hw: 0.449,
    hd: 0.1,
    rot: -0.127,
    bottom: -0.251,
  },
  {
    name: 'headstone_-14.2_-8.4',
    lx: -14.2,
    lz: -8.405,
    hw: 0.364,
    hd: 0.1,
    rot: 0.101,
    bottom: -0.253,
  },
  {
    name: 'headstone_-12.2_-6.9',
    lx: -12.244,
    lz: -6.942,
    hw: 0.448,
    hd: 0.1,
    rot: 0.168,
    bottom: -0.252,
  },
  { name: 'table_tomb_8', lx: -14.1, lz: -5.4, hw: 0.5, hd: 1, rot: 0.2, bottom: 0.05 },
  {
    name: 'headstone_16.7_-15.4',
    lx: 16.702,
    lz: -15.416,
    hw: 0.353,
    hd: 0.1,
    rot: 0.09,
    bottom: -0.255,
  },
  {
    name: 'headstone_15.2_-15.7',
    lx: 15.226,
    lz: -15.704,
    hw: 0.354,
    hd: 0.1,
    rot: 0.21,
    bottom: -0.255,
  },
  {
    name: 'headstone_12.0_-14.1',
    lx: 12.003,
    lz: -14.131,
    hw: 0.397,
    hd: 0.1,
    rot: -0.294,
    bottom: -0.255,
  },
  {
    name: 'headstone_11.6_-16.0',
    lx: 11.559,
    lz: -16.038,
    hw: 0.376,
    hd: 0.1,
    rot: 0.079,
    bottom: -0.255,
  },
  {
    name: 'headstone_16.6_-17.2',
    lx: 16.646,
    lz: -17.172,
    hw: 0.399,
    hd: 0.1,
    rot: 0.171,
    bottom: -0.255,
  },
  {
    name: 'headstone_11.4_-18.3',
    lx: 11.401,
    lz: -18.271,
    hw: 0.346,
    hd: 0.1,
    rot: -0.215,
    bottom: -0.255,
  },
  {
    name: 'headstone_14.3_-17.3',
    lx: 14.303,
    lz: -17.34,
    hw: 0.439,
    hd: 0.1,
    rot: -0.068,
    bottom: -0.255,
  },
  { name: 'table_tomb_15', lx: 14.6, lz: -12.9, hw: 0.5, hd: 1, rot: 0.2, bottom: 0.045 },
  { name: 'lychgate_wall_e', lx: -4.85, lz: -31, hw: 0.35, hd: 1.3, rot: 0, bottom: -0.305 },
  { name: 'lychgate_wall_w', lx: -0.15, lz: -31, hw: 0.35, hd: 1.3, rot: 0, bottom: -0.305 },
  { name: 'yard_wall_0', lx: 3.7, lz: -30.6, hw: 3.324, hd: 0.3, rot: -0.121, bottom: -0.255 },
  { name: 'yard_wall_-5', lx: -8.2, lz: -30.4, hw: 2.864, hd: 0.3, rot: -2.93, bottom: -0.255 },
  { name: 'yard_wall_9', lx: 10.35, lz: -29.15, hw: 1.812, hd: 0.3, rot: -0.427, bottom: -0.255 },
  { name: 'yew', lx: -3.9, lz: 6.3, hw: 0.4, hd: 0.4, rot: 0, bottom: -0.129 },
];

/** World colliders for the set piece at a door, seated on the door's terrain height. */
export function hollowCryptEntranceColliders(
  seed: number,
  door: { readonly x: number; readonly z: number },
): Collider[] {
  const base = terrainHeight(door.x, door.z, seed);
  const out: Collider[] = [];
  for (const row of HOLLOW_CRYPT_ENTRANCE_COLLIDERS) {
    const x = door.x + row.lx;
    const z = door.z + row.lz;
    const stand =
      row.standTop === undefined ? {} : { moveTopY: base + row.standTop, standable: true as const };
    if (row.type === 'obb') {
      out.push({
        type: 'obb',
        x,
        z,
        hw: row.hw ?? 0,
        hd: row.hd ?? 0,
        rot: row.rot ?? 0,
        cameraTopY: base + row.top,
        ...stand,
      });
    } else {
      out.push({ type: 'circle', x, z, r: row.r ?? 0, cameraTopY: base + row.top, ...stand });
    }
  }
  return out;
}
