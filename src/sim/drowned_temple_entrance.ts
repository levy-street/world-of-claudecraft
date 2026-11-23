// The Moon Stair: the world entrance of the Drowned Temple (door (-70, 792),
// Thornpeak Heights). A scrying house of the Court on the Glimmermere. The
// door stands at the head of a steep gully that falls six yards to a flat
// shelf of the old lake bed; the mere itself has sunk away into the pit beyond
// it, and what is left of it up here is what the Court's masonry still holds.
// From the far shore inward: the Glimmer Weir, a curved dam round the head of
// the pit holding a shallow mirror of still water on the shelf; the two
// penitents of the Pale Choir standing in it; the Moon Stair climbing the
// gully between stepped cheek walls, the colonnade on the gully's shoulders;
// the moongate ring on its dais, whose foot is the door's lane; and on the
// terrace behind it the moon pool and its stelae. The models are three Blender
// GLBs drawn by src/render/drowned_temple_entrance.ts (which also draws the
// mirror's water: it is dressing, never sim water); THIS module is the one
// source of truth for what collides, shared by the sim (dungeon_door_jambs.ts
// hands these in place of the generic jambs) and the tests. What is walked on
// (the dais and the flight, which ride above the gully's own floor) is the
// leaf src/sim/drowned_temple_stair.ts, summed into groundHeight by
// walk_lifts.ts.
//
// Local coordinates are door-relative: lx = x - door.x (+x is WEST), lz =
// z - door.z (+z is NORTH), and every height is above terrainHeight at the
// door, the one height the GLBs are seated at. The authoring tool, its terrain
// probe and its review renders are docs/design/dungeon-rework/entrance/.

import type { Collider } from './colliders';
import { terrainHeight } from './world';

export const DROWNED_TEMPLE_ENTRANCE_DUNGEON_ID = 'drowned_temple';

/** Half width of the open walk-in lane over the ring's sill: inside
 *  DOOR_TRIGGER_RADIUS (2), so nobody crosses the door untriggered. */
export const DROWNED_TEMPLE_ENTRANCE_LANE_HALF_WIDTH = 1.5;

/** The set piece's levels above the door's terrain height: the dais floor,
 *  the ring's centre and radii, the mirror's water and the old tide line. */
export const DROWNED_TEMPLE_ENTRANCE_LEVELS = {
  dais: 0.8,
  ringCentre: 5.6,
  ringInner: 4.55,
  ringOuter: 5.85,
  water: -5.85,
  tide: -3.95,
} as const;

export interface TempleEntranceColliderRow {
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
 * (stats.json of build_temple_entrance.py): the ring's two feet either side
 * of the lane, the stair's cheek walls (the west one in two runs, either side
 * of the breach beside Ondrel's post), the colonnade's six plinths and the
 * drums of the fallen column, the two penitents, the runs of the weir whose
 * outer face stands more than a stride over the pit, and the three stelae.
 * The dais, the treads, the low runs of the weir, the pool's kerb, the rubble
 * and all the growth are walk-over dressing.
 */
export const DROWNED_TEMPLE_ENTRANCE_COLLIDERS: readonly TempleEntranceColliderRow[] = [
  { name: 'moongate_foot_e', type: 'obb', lx: -3.75, lz: 0, hw: 2.2, hd: 1.15, rot: 0, top: 7.6 },
  { name: 'moongate_foot_w', type: 'obb', lx: 3.75, lz: 0, hw: 2.2, hd: 1.15, rot: 0, top: 7.6 },
  { name: 'cheek_e', type: 'obb', lx: -3.4, lz: -6.74, hw: 0.45, hd: 4.14, rot: 0, top: 2.2 },
  { name: 'cheek_w_upper', type: 'obb', lx: 3.4, lz: -3.52, hw: 0.45, hd: 0.92, rot: 0, top: 2.2 },
  { name: 'cheek_w_lower', type: 'obb', lx: 3.4, lz: -9.04, hw: 0.45, hd: 1.84, rot: 0, top: -0.8 },
  { name: 'column_w_5', type: 'circle', lx: 5.2, lz: -4.6, r: 0.95, top: 8.71 },
  { name: 'column_e_5', type: 'circle', lx: -5.2, lz: -4.6, r: 0.95, top: 7.69 },
  { name: 'column_w_9', type: 'circle', lx: 5.2, lz: -8.6, r: 0.95, top: 6.52 },
  { name: 'column_e_9', type: 'circle', lx: -5.2, lz: -8.6, r: 0.95, top: 0.05 },
  { name: 'column_w_12', type: 'circle', lx: 5.2, lz: -12.4, r: 0.95, top: -0.02 },
  { name: 'fallen_drums', type: 'circle', lx: -10.3, lz: -14.7, r: 1.5, top: -4.75 },
  { name: 'column_e_12', type: 'circle', lx: -5.2, lz: -12.4, r: 0.95, top: -3.63 },
  { name: 'penitent_e', type: 'circle', lx: -6.7, lz: -15.7, r: 1.3, top: -0.53 },
  { name: 'penitent_w', type: 'circle', lx: 6.7, lz: -15.7, r: 1.3, top: -0.53 },
  { name: 'weir_0', type: 'obb', lx: 11.6, lz: -16.55, hw: 2.25, hd: 0.52, rot: 2.92, top: -5.61 },
  { name: 'weir_1', type: 'obb', lx: 7.6, lz: -17.8, hw: 2.354, hd: 0.52, rot: 2.761, top: -5.61 },
  { name: 'weir_2', type: 'obb', lx: 4.5, lz: -19.9, hw: 1.903, hd: 0.52, rot: 2.273, top: -5.61 },
  { name: 'weir_3', type: 'obb', lx: 3.05, lz: -22.7, hw: 1.74, hd: 0.52, rot: 1.8, top: -5.61 },
  { name: 'weir_4', type: 'obb', lx: 1.5, lz: -25.35, hw: 1.862, hd: 0.52, rot: 2.377, top: -5.61 },
  {
    name: 'weir_5',
    type: 'obb',
    lx: -1.6,
    lz: -27.15,
    hw: 2.208,
    hd: 0.52,
    rot: 2.812,
    top: -5.61,
  },
  {
    name: 'weir_6',
    type: 'obb',
    lx: -6.25,
    lz: -28.1,
    hw: 2.966,
    hd: 0.52,
    rot: 3.033,
    top: -5.61,
  },
  { name: 'weir_7', type: 'obb', lx: -12, lz: -28.35, hw: 3.2, hd: 0.52, rot: -3.125, top: -5.61 },
  {
    name: 'weir_8',
    type: 'obb',
    lx: -17.25,
    lz: -27.7,
    hw: 2.529,
    hd: 0.52,
    rot: -2.881,
    top: -5.61,
  },
  { name: 'stela_112', type: 'circle', lx: 2.745, lz: 19.271, r: 0.95, top: 9.13 },
  { name: 'stela_162', type: 'circle', lx: -0.31, lz: 19.892, r: 0.95, top: 10.13 },
  { name: 'stela_214', type: 'circle', lx: -3.395, lz: 18.907, r: 0.95, top: 7.43 },
];

export interface TempleEntranceFooting {
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
 * The GLBs' terrain contract: every footing's underside, modelled against the
 * sim's own terrain sampled every half yard. The gully is steep and V-shaped,
 * so each footing is cut a fixed depth under the LOWEST ground anywhere under
 * it (a half-yard grid): it never floats at any point, and at that lowest
 * point it is no deeper than its design burial;
 * tests/drowned_temple_entrance.test.ts pins both against terrainHeight (the
 * natural ground: the walk surface above it is the masonry's own top).
 */
export const DROWNED_TEMPLE_ENTRANCE_FOOTINGS: readonly TempleEntranceFooting[] = [
  { name: 'dais', lx: 0, lz: -0.1, hw: 7.2, hd: 2.5, rot: 0, bottom: -2.012 },
  { name: 'stair', lx: 0, lz: -8.58, hw: 3, hd: 5.98, rot: 0, bottom: -6.712 },
  { name: 'pier_e_0', lx: -3.43, lz: -3.06, hw: 0.55, hd: 0.55, rot: 0, bottom: -2.382 },
  { name: 'cheek_e_2', lx: -3.35, lz: -3.98, hw: 0.35, hd: 0.46, rot: 0, bottom: -2.868 },
  { name: 'cheek_e_4', lx: -3.35, lz: -4.9, hw: 0.35, hd: 0.46, rot: 0, bottom: -3.453 },
  { name: 'cheek_e_6', lx: -3.35, lz: -5.82, hw: 0.35, hd: 0.46, rot: 0, bottom: -4.053 },
  { name: 'pier_e_8', lx: -3.43, lz: -6.74, hw: 0.55, hd: 0.55, rot: 0, bottom: -4.722 },
  { name: 'cheek_e_10', lx: -3.35, lz: -7.66, hw: 0.35, hd: 0.46, rot: 0, bottom: -5.212 },
  { name: 'cheek_e_12', lx: -3.35, lz: -8.58, hw: 0.35, hd: 0.46, rot: 0, bottom: -5.716 },
  { name: 'cheek_e_14', lx: -3.35, lz: -9.5, hw: 0.35, hd: 0.46, rot: 0, bottom: -6.123 },
  { name: 'pier_e_16', lx: -3.43, lz: -10.42, hw: 0.55, hd: 0.55, rot: 0, bottom: -6.446 },
  { name: 'pier_w_0', lx: 3.43, lz: -3.06, hw: 0.55, hd: 0.55, rot: 0, bottom: -1.542 },
  { name: 'cheek_w_2', lx: 3.35, lz: -3.98, hw: 0.35, hd: 0.46, rot: 0, bottom: -1.988 },
  { name: 'cheek_w_4', lx: 3.35, lz: -4.9, hw: 0.35, hd: 0.46, rot: 0, bottom: -2.571 },
  { name: 'cheek_w_6', lx: 3.35, lz: -5.82, hw: 0.35, hd: 0.46, rot: 0, bottom: -3.163 },
  { name: 'pier_w_8', lx: 3.43, lz: -6.74, hw: 0.55, hd: 0.55, rot: 0, bottom: -3.834 },
  { name: 'cheek_w_10', lx: 3.35, lz: -7.66, hw: 0.35, hd: 0.46, rot: 0, bottom: -4.27 },
  { name: 'cheek_w_12', lx: 3.35, lz: -8.58, hw: 0.35, hd: 0.46, rot: 0, bottom: -4.793 },
  { name: 'cheek_w_14', lx: 3.35, lz: -9.5, hw: 0.35, hd: 0.46, rot: 0, bottom: -5.287 },
  { name: 'pier_w_16', lx: 3.43, lz: -10.42, hw: 0.55, hd: 0.55, rot: 0, bottom: -5.807 },
  { name: 'column_w_5', lx: 5.2, lz: -4.6, hw: 0.85, hd: 0.85, rot: 0, bottom: -2.071 },
  { name: 'column_e_5', lx: -5.2, lz: -4.6, hw: 0.85, hd: 0.85, rot: 0, bottom: -3.257 },
  { name: 'column_w_9', lx: 5.2, lz: -8.6, hw: 0.85, hd: 0.85, rot: 0, bottom: -4.609 },
  { name: 'column_e_9', lx: -5.2, lz: -8.6, hw: 0.85, hd: 0.85, rot: 0, bottom: -5.582 },
  { name: 'column_w_12', lx: 5.2, lz: -12.4, hw: 0.85, hd: 0.85, rot: 0, bottom: -6.431 },
  { name: 'column_e_12', lx: -5.2, lz: -12.4, hw: 0.85, hd: 0.85, rot: 0, bottom: -6.702 },
  { name: 'penitent_e', lx: -6.7, lz: -15.7, hw: 1.15, hd: 1.15, rot: 0, bottom: -6.812 },
  { name: 'penitent_w', lx: 6.7, lz: -15.7, hw: 1.15, hd: 1.15, rot: 0, bottom: -7.301 },
  { name: 'weir_0', lx: 11.6, lz: -16.55, hw: 2.05, hd: 0.46, rot: 2.92, bottom: -7.734 },
  { name: 'weir_1', lx: 7.6, lz: -17.8, hw: 2.154, hd: 0.46, rot: 2.761, bottom: -7.73 },
  { name: 'weir_2', lx: 4.5, lz: -19.9, hw: 1.703, hd: 0.46, rot: 2.273, bottom: -7.086 },
  { name: 'weir_3', lx: 3.05, lz: -22.7, hw: 1.54, hd: 0.46, rot: 1.8, bottom: -7.375 },
  { name: 'weir_4', lx: 1.5, lz: -25.35, hw: 1.662, hd: 0.46, rot: 2.377, bottom: -7.514 },
  { name: 'weir_5', lx: -1.6, lz: -27.15, hw: 2.008, hd: 0.46, rot: 2.812, bottom: -7.507 },
  { name: 'weir_6', lx: -6.25, lz: -28.1, hw: 2.766, hd: 0.46, rot: 3.033, bottom: -7.275 },
  { name: 'weir_7', lx: -12, lz: -28.35, hw: 3, hd: 0.46, rot: -3.125, bottom: -7.573 },
  { name: 'weir_8', lx: -17.25, lz: -27.7, hw: 2.329, hd: 0.46, rot: -2.881, bottom: -7.569 },
  { name: 'weir_9', lx: -21.05, lz: -25.75, hw: 2.055, hd: 0.46, rot: -2.425, bottom: -6.822 },
  { name: 'moon_pool', lx: 0, lz: 13.6, hw: 3.4, hd: 3.4, rot: 0, bottom: 3.262 },
  { name: 'stela_112', lx: 2.745, lz: 19.271, hw: 0.45, hd: 0.45, rot: 0, bottom: 3.734 },
  { name: 'stela_162', lx: -0.31, lz: 19.892, hw: 0.45, hd: 0.45, rot: 0, bottom: 3.734 },
  { name: 'stela_214', lx: -3.395, lz: 18.907, hw: 0.45, hd: 0.45, rot: 0, bottom: 3.727 },
];

/** World colliders for the set piece at a door, seated on the door's terrain height. */
export function drownedTempleEntranceColliders(
  seed: number,
  door: { readonly x: number; readonly z: number },
): Collider[] {
  const base = terrainHeight(door.x, door.z, seed);
  const out: Collider[] = [];
  for (const row of DROWNED_TEMPLE_ENTRANCE_COLLIDERS) {
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
