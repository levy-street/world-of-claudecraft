// The Smith's Seal Gate: the world entrance of the Gravewyrm Sanctum (door
// (0, 858), Thornpeak Heights). Two black stone pylons and a cracked lintel
// stand at the foot of a rock spur of the mountain, with the rock-cut gate
// tunnel behind them running back into the wall (z 860 to 886), the gate
// plaza in front (z 842 to 856), the fallen chain's heap, the Vigil cairn, the
// cult's sledge and brazier, and two clusters of old headstones by the
// flanking ruin rings (which stay). The models are three Blender GLBs drawn
// by src/render/sanctum_seal_gate.ts; THIS module is the one source of truth
// for what collides, shared by the sim (dungeon_door_jambs.ts hands these in
// place of the generic jambs) and the tests.
//
// Local coordinates are door-relative: lx = x - door.x (+x is WEST), lz =
// z - door.z (+z is NORTH), and every height is above terrainHeight at the
// door, the one height the GLBs are seated at. The authoring tool, its terrain
// probe and its review renders are docs/design/dungeon-rework/entrance/.

import type { Collider } from './colliders';
import { terrainHeight } from './world';

export const SANCTUM_SEAL_GATE_DUNGEON_ID = 'gravewyrm_sanctum';

/** Half width of the open walk-in lane between the pylons' plinths: inside
 *  DOOR_TRIGGER_RADIUS (2), so nobody crosses the gate line untriggered. */
export const SANCTUM_SEAL_GATE_LANE_HALF_WIDTH = 2.0;

/** The gate plaza (door-local): the forecourt the moved key shards and
 *  sigils lie in. */
export const SANCTUM_SEAL_GATE_PLAZA = { x0: -10, x1: 10, z0: -16, z1: -2 } as const;

export interface SealGateColliderRow {
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
  /** A low standable top above the door's terrain height (the heap, the sledge bed). */
  readonly standTop?: number;
}

/**
 * Every solid piece of the set piece, measured from the Blender build
 * (stats.json of build_sanctum_entrance.py): the pylons (their inner faces
 * are the lane edges), the rock spur's flanks (an axis-aligned slab per
 * station interval plus a wedge along the skirt line, 0.35 inside the visual
 * skirt), the tunnel's end wall, the chain heap, the brazier, the sledge, the
 * cairn and the eleven headstones. The pavers, the tunnel floor, the fallen
 * chain's trail, the goad irons and the rubble are walk-over dressing.
 */
export const SANCTUM_SEAL_GATE_COLLIDERS: readonly SealGateColliderRow[] = [
  { name: 'pylon_e', type: 'obb', lx: -3.65, lz: 0.3, hw: 1.65, hd: 2.5, rot: 0, top: 13.9 },
  { name: 'pylon_w', type: 'obb', lx: 3.65, lz: 0.3, hw: 1.65, hd: 2.5, rot: 0, top: 13.9 },
  { name: 'rock_w_2.2', type: 'obb', lx: 4.275, lz: 3.1, hw: 0.675, hd: 0.95, rot: 0, top: 16.6 },
  {
    name: 'rock_w_2.2_skirt',
    type: 'obb',
    lx: 4.885,
    lz: 3.222,
    hw: 0.385,
    hd: 0.949,
    rot: 0.322,
    top: 16.6,
  },
  { name: 'rock_e_2.2', type: 'obb', lx: -4.225, lz: 3.1, hw: 0.625, hd: 0.95, rot: 0, top: 16.6 },
  { name: 'rock_w_4', type: 'obb', lx: 4.575, lz: 5, hw: 0.975, hd: 1.05, rot: 0, top: 17.4 },
  {
    name: 'rock_w_4_skirt',
    type: 'obb',
    lx: 5.83,
    lz: 5.484,
    hw: 0.748,
    hd: 1.312,
    rot: 0.705,
    top: 17.4,
  },
  { name: 'rock_e_4', type: 'obb', lx: -4.225, lz: 5, hw: 0.625, hd: 1.05, rot: 0, top: 17.4 },
  { name: 'rock_w_6', type: 'obb', lx: 5.425, lz: 7, hw: 1.825, hd: 1.05, rot: 0, top: 18 },
  {
    name: 'rock_w_6_skirt',
    type: 'obb',
    lx: 7.578,
    lz: 7.514,
    hw: 0.769,
    hd: 1.345,
    rot: 0.733,
    top: 18,
  },
  { name: 'rock_e_6', type: 'obb', lx: -4.325, lz: 7, hw: 0.725, hd: 1.05, rot: 0, top: 18 },
  {
    name: 'rock_e_6_skirt',
    type: 'obb',
    lx: -4.979,
    lz: 7.111,
    hw: 0.387,
    hd: 1.044,
    rot: -0.291,
    top: 18,
  },
  { name: 'rock_w_8', type: 'obb', lx: 6.325, lz: 9.25, hw: 2.725, hd: 1.3, rot: 0, top: 18.8 },
  {
    name: 'rock_w_8_skirt',
    type: 'obb',
    lx: 9.072,
    lz: 9.527,
    hw: 0.641,
    hd: 1.387,
    rot: 0.448,
    top: 18.8,
  },
  { name: 'rock_e_8', type: 'obb', lx: -4.625, lz: 9.25, hw: 1.025, hd: 1.3, rot: 0, top: 18.8 },
  {
    name: 'rock_e_8_skirt',
    type: 'obb',
    lx: -5.962,
    lz: 9.8,
    hw: 0.881,
    hd: 1.601,
    rot: -0.675,
    top: 18.8,
  },
  { name: 'rock_w_10.5', type: 'obb', lx: 6.925, lz: 12, hw: 3.325, hd: 1.55, rot: 0, top: 19.6 },
  {
    name: 'rock_w_10.5_skirt',
    type: 'obb',
    lx: 10.18,
    lz: 12.125,
    hw: 0.486,
    hd: 1.552,
    rot: 0.261,
    top: 19.6,
  },
  { name: 'rock_e_10.5', type: 'obb', lx: -5.625, lz: 12, hw: 2.025, hd: 1.55, rot: 0, top: 19.6 },
  {
    name: 'rock_e_10.5_skirt',
    type: 'obb',
    lx: -7.954,
    lz: 12.584,
    hw: 0.987,
    hd: 1.86,
    rot: -0.633,
    top: 19.6,
  },
  { name: 'rock_w_13.5', type: 'obb', lx: 7.325, lz: 15.25, hw: 3.725, hd: 1.8, rot: 0, top: 20.6 },
  {
    name: 'rock_w_13.5_skirt',
    type: 'obb',
    lx: 10.953,
    lz: 15.284,
    hw: 0.299,
    hd: 1.761,
    rot: 0.114,
    top: 20.6,
  },
  {
    name: 'rock_e_13.5',
    type: 'obb',
    lx: -6.725,
    lz: 15.25,
    hw: 3.125,
    hd: 1.8,
    rot: 0,
    top: 20.6,
  },
  {
    name: 'rock_e_13.5_skirt',
    type: 'obb',
    lx: -9.792,
    lz: 15.41,
    hw: 0.581,
    hd: 1.82,
    rot: -0.278,
    top: 20.6,
  },
  { name: 'rock_w_17', type: 'obb', lx: 7.425, lz: 19, hw: 3.825, hd: 2.05, rot: 0, top: 21.8 },
  { name: 'rock_e_17', type: 'obb', lx: -7.225, lz: 19, hw: 3.625, hd: 2.05, rot: 0, top: 21.8 },
  { name: 'rock_w_21', type: 'obb', lx: 7.225, lz: 23, hw: 3.625, hd: 2.05, rot: 0, top: 23 },
  {
    name: 'rock_w_21_skirt',
    type: 'obb',
    lx: 10.752,
    lz: 22.97,
    hw: 0.299,
    hd: 2.01,
    rot: -0.1,
    top: 23,
  },
  { name: 'rock_e_21', type: 'obb', lx: -7.225, lz: 23, hw: 3.625, hd: 2.05, rot: 0, top: 23 },
  { name: 'rock_w_25', type: 'obb', lx: 7.125, lz: 26.5, hw: 3.525, hd: 1.55, rot: 0, top: 24 },
  { name: 'rock_e_25', type: 'obb', lx: -7.125, lz: 26.5, hw: 3.525, hd: 1.55, rot: 0, top: 24 },
  { name: 'rock_w_28', type: 'obb', lx: 5.325, lz: 30, hw: 5.325, hd: 2.05, rot: 0, top: 26.5 },
  { name: 'rock_e_28', type: 'obb', lx: -5.325, lz: 30, hw: 5.325, hd: 2.05, rot: 0, top: 26.5 },
  { name: 'rock_w_32', type: 'obb', lx: 5.325, lz: 34, hw: 5.325, hd: 2.05, rot: 0, top: 30 },
  {
    name: 'rock_w_32_skirt',
    type: 'obb',
    lx: 10.552,
    lz: 34.03,
    hw: 0.299,
    hd: 2.01,
    rot: 0.1,
    top: 30,
  },
  { name: 'rock_e_32', type: 'obb', lx: -5.425, lz: 34, hw: 5.425, hd: 2.05, rot: 0, top: 30 },
  {
    name: 'rock_e_32_skirt',
    type: 'obb',
    lx: -10.752,
    lz: 34.03,
    hw: 0.299,
    hd: 2.01,
    rot: -0.1,
    top: 30,
  },
  { name: 'tunnel_end', type: 'obb', lx: 0, lz: 28.6, hw: 3.8, hd: 0.7, rot: 0, top: 24 },
  { name: 'chain_heap', type: 'circle', lx: 5.2, lz: -10, r: 1.7, top: 0.95, standTop: 0.75 },
  { name: 'toppled_brazier', type: 'circle', lx: 6.3, lz: -2.9, r: 0.85, top: 1.27 },
  {
    name: 'sledge',
    type: 'obb',
    lx: -9.6,
    lz: -10.2,
    hw: 1.1,
    hd: 2.15,
    rot: -0.45,
    top: 1.64,
    standTop: 0.52,
  },
  { name: 'vigil_cairn', type: 'circle', lx: -4, lz: -16.5, r: 1.05, top: 2.32 },
  {
    name: 'headstone_-19.4_1.2',
    type: 'obb',
    lx: -19.4,
    lz: 1.2,
    hw: 0.475,
    hd: 0.2,
    rot: 0.25,
    top: 3.12,
  },
  {
    name: 'headstone_-20.8_4.2',
    type: 'obb',
    lx: -20.8,
    lz: 4.2,
    hw: 0.425,
    hd: 0.2,
    rot: 0.1,
    top: 3.36,
  },
  {
    name: 'headstone_-19.6_7.6',
    type: 'obb',
    lx: -19.6,
    lz: 7.6,
    hw: 0.5,
    hd: 0.2,
    rot: -0.15,
    top: 3.59,
  },
  {
    name: 'headstone_-21.9_9.6',
    type: 'obb',
    lx: -21.9,
    lz: 9.6,
    hw: 0.4,
    hd: 0.2,
    rot: 0.35,
    top: 3.81,
  },
  {
    name: 'headstone_-17.8_10.8',
    type: 'obb',
    lx: -17.8,
    lz: 10.8,
    hw: 0.45,
    hd: 0.2,
    rot: -0.3,
    top: 3.72,
  },
  {
    name: 'headstone_-22.6_2',
    type: 'obb',
    lx: -22.6,
    lz: 2,
    hw: 0.4,
    hd: 0.2,
    rot: 0.5,
    top: 3.54,
  },
  {
    name: 'headstone_13.2_-8.6',
    type: 'obb',
    lx: 13.2,
    lz: -8.6,
    hw: 0.475,
    hd: 0.2,
    rot: -0.2,
    top: 1.32,
  },
  {
    name: 'headstone_15.6_-9.8',
    type: 'obb',
    lx: 15.6,
    lz: -9.8,
    hw: 0.425,
    hd: 0.2,
    rot: -0.4,
    top: 1.2,
  },
  {
    name: 'headstone_12.4_-11.6',
    type: 'obb',
    lx: 12.4,
    lz: -11.6,
    hw: 0.5,
    hd: 0.2,
    rot: 0.05,
    top: 1.4,
  },
  {
    name: 'headstone_16.4_-12.8',
    type: 'obb',
    lx: 16.4,
    lz: -12.8,
    hw: 0.4,
    hd: 0.2,
    rot: -0.55,
    top: 1.12,
  },
  {
    name: 'headstone_14.2_-14.2',
    type: 'obb',
    lx: 14.2,
    lz: -14.2,
    hw: 0.45,
    hd: 0.2,
    rot: -0.25,
    top: 1.32,
  },
];

export interface SealGateFooting {
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
 * (no sinking); tests/sanctum_seal_gate.test.ts pins both against
 * groundHeight. Plinths 0.55 under their lowest corner, the rock spur's skirt
 * 0.9 under its own vertex, headstones 0.35, the cairn 0.3.
 */
export const SANCTUM_SEAL_GATE_FOOTINGS: readonly SealGateFooting[] = [
  { name: 'plinth_e', lx: -3.65, lz: 0.75, hw: 1.65, hd: 2.05, rot: 0, bottom: -0.635 },
  { name: 'plinth_w', lx: 3.65, lz: 0.75, hw: 1.65, hd: 2.05, rot: 0, bottom: -0.61 },
  { name: 'outcrop_w_2.2', lx: 5.3, lz: 2.2, hw: 0.4, hd: 0.4, rot: 0, bottom: -0.163 },
  { name: 'outcrop_e_2.2', lx: -5.3, lz: 2.2, hw: 0.4, hd: 0.4, rot: 0, bottom: -0.496 },
  { name: 'outcrop_w_4', lx: 5.9, lz: 4, hw: 0.4, hd: 0.4, rot: 0, bottom: 0.42 },
  { name: 'outcrop_e_4', lx: -5.2, lz: 4, hw: 0.4, hd: 0.4, rot: 0, bottom: 0.165 },
  { name: 'outcrop_w_6', lx: 7.6, lz: 6, hw: 0.4, hd: 0.4, rot: 0, bottom: 0.94 },
  { name: 'outcrop_e_6', lx: -5.4, lz: 6, hw: 0.4, hd: 0.4, rot: 0, bottom: 0.802 },
  { name: 'outcrop_w_8', lx: 9.4, lz: 8, hw: 0.4, hd: 0.4, rot: 0, bottom: 1.183 },
  { name: 'outcrop_e_8', lx: -6, lz: 8, hw: 0.4, hd: 0.4, rot: 0, bottom: 1.29 },
  { name: 'outcrop_w_10.5', lx: 10.6, lz: 10.5, hw: 0.4, hd: 0.4, rot: 0, bottom: 0.868 },
  { name: 'outcrop_e_10.5', lx: -8, lz: 10.5, hw: 0.4, hd: 0.4, rot: 0, bottom: 1.658 },
  { name: 'outcrop_w_13.5', lx: 11.4, lz: 13.5, hw: 0.4, hd: 0.4, rot: 0, bottom: 0.959 },
  { name: 'outcrop_e_13.5', lx: -10.2, lz: 13.5, hw: 0.4, hd: 0.4, rot: 0, bottom: 1.561 },
  { name: 'outcrop_w_17', lx: 11.8, lz: 17, hw: 0.4, hd: 0.4, rot: 0, bottom: 1.908 },
  { name: 'outcrop_e_17', lx: -11.2, lz: 17, hw: 0.4, hd: 0.4, rot: 0, bottom: 3.337 },
  { name: 'outcrop_w_21', lx: 11.6, lz: 21, hw: 0.4, hd: 0.4, rot: 0, bottom: 5.769 },
  { name: 'outcrop_e_21', lx: -11.4, lz: 21, hw: 0.4, hd: 0.4, rot: 0, bottom: 7.106 },
  { name: 'outcrop_w_25', lx: 11.2, lz: 25, hw: 0.4, hd: 0.4, rot: 0, bottom: 6.732 },
  { name: 'outcrop_e_25', lx: -11.2, lz: 25, hw: 0.4, hd: 0.4, rot: 0, bottom: 7.528 },
  { name: 'outcrop_w_28', lx: 11, lz: 28, hw: 0.4, hd: 0.4, rot: 0, bottom: 6.971 },
  { name: 'outcrop_e_28', lx: -11, lz: 28, hw: 0.4, hd: 0.4, rot: 0, bottom: 7.414 },
  { name: 'chain_heap', lx: 5.2, lz: -10, hw: 1.5, hd: 1.5, rot: 0, bottom: -0.399 },
  { name: 'toppled_brazier', lx: 6.3, lz: -2.9, hw: 0.45, hd: 0.45, rot: 0, bottom: -0.306 },
  { name: 'sledge', lx: -9.6, lz: -10.2, hw: 0.75, hd: 1.7, rot: -0.45, bottom: -0.227 },
  { name: 'cairn', lx: -4, lz: -16.5, hw: 0.9, hd: 0.9, rot: 0, bottom: -0.532 },
  {
    name: 'headstone_-19.4_1.2',
    lx: -19.4,
    lz: 1.2,
    hw: 0.425,
    hd: 0.106,
    rot: 0.25,
    bottom: 0.803,
  },
  {
    name: 'headstone_-20.8_4.2',
    lx: -20.8,
    lz: 4.2,
    hw: 0.375,
    hd: 0.123,
    rot: 0.1,
    bottom: 1.398,
  },
  {
    name: 'headstone_-19.6_7.6',
    lx: -19.6,
    lz: 7.6,
    hw: 0.45,
    hd: 0.106,
    rot: -0.15,
    bottom: 1.316,
  },
  {
    name: 'headstone_-21.9_9.6',
    lx: -21.9,
    lz: 9.6,
    hw: 0.35,
    hd: 0.139,
    rot: 0.35,
    bottom: 2.046,
  },
  {
    name: 'headstone_-17.8_10.8',
    lx: -17.8,
    lz: 10.8,
    hw: 0.4,
    hd: 0.138,
    rot: -0.3,
    bottom: 1.814,
  },
  { name: 'headstone_-22.6_2', lx: -22.6, lz: 2, hw: 0.35, hd: 0.135, rot: 0.5, bottom: 1.869 },
  {
    name: 'headstone_13.2_-8.6',
    lx: 13.2,
    lz: -8.6,
    hw: 0.425,
    hd: 0.128,
    rot: -0.2,
    bottom: -0.567,
  },
  {
    name: 'headstone_15.6_-9.8',
    lx: 15.6,
    lz: -9.8,
    hw: 0.375,
    hd: 0.11,
    rot: -0.4,
    bottom: -0.48,
  },
  {
    name: 'headstone_12.4_-11.6',
    lx: 12.4,
    lz: -11.6,
    hw: 0.45,
    hd: 0.105,
    rot: 0.05,
    bottom: -0.606,
  },
  {
    name: 'headstone_16.4_-12.8',
    lx: 16.4,
    lz: -12.8,
    hw: 0.35,
    hd: 0.111,
    rot: -0.55,
    bottom: -0.449,
  },
  {
    name: 'headstone_14.2_-14.2',
    lx: 14.2,
    lz: -14.2,
    hw: 0.4,
    hd: 0.137,
    rot: -0.25,
    bottom: -0.502,
  },
];

/** World colliders for the set piece at a door, seated on the door's terrain height. */
export function sanctumSealGateColliders(
  seed: number,
  door: { readonly x: number; readonly z: number },
): Collider[] {
  const base = terrainHeight(door.x, door.z, seed);
  const out: Collider[] = [];
  for (const row of SANCTUM_SEAL_GATE_COLLIDERS) {
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
