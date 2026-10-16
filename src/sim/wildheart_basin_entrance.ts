// The Jaguar Maw: the world entrance of the Wildheart Basin (door (-237, 1093),
// the Palmreach). The Sunken Idol opened: a round head of cyclopean limestone
// carved as a roaring jaguar, standing on the low rise beside the Sunken
// Idol's ring of columns where the road comes up from the south, backed into
// the knoll over the Sapphire Lagoon and leaning west and forward over whoever
// walks up to it. The door is its open maw: the muzzle's two halves are the
// door's jambs, the lower teeth edge the walk-in lane and black water stands
// in the throat behind. A causeway of heaved flagstones climbs the rise to it
// between the Sunbone's two great tusks and two troll fire bowls, and the
// idol's east ear lies where it fell at the foot of the east cheek.
// The models are three Blender GLBs drawn by
// src/render/wildheart_basin_entrance.ts; THIS module is the one source of
// truth for what collides, shared by the sim (dungeon_door_jambs.ts hands
// these in place of the generic jambs) and the tests.
//
// The rise is the door's own: a dungeon door calms the ground round it to the
// classic field (terrain_calm_anchors.ts), which domes here two yards over
// the flat. Move the door and the ground moves with it, so the GLBs, these
// tables and the door position change together.
//
// Local coordinates are door-relative: lx = x - door.x (+x is WEST), lz =
// z - door.z (+z is NORTH), and every height is above terrainHeight at the
// door, the one height the GLBs are seated at. The authoring tool, its terrain
// probe and its review renders are docs/design/dungeon-rework/entrance/.

import type { Collider } from './colliders';
import { terrainHeight } from './world';

export const WILDHEART_BASIN_ENTRANCE_DUNGEON_ID = 'wildheart_basin';

/** Half width of the open walk-in lane between the lower teeth: inside
 *  DOOR_TRIGGER_RADIUS (2), so nobody crosses the door untriggered. */
export const WILDHEART_BASIN_ENTRANCE_LANE_HALF_WIDTH = 1.35;

/** The Palmreach palms the set piece stands on (decoration_exclusions.ts
 *  drops them; reachPalmSpots honours it): the great palm that grew on the
 *  door itself, in the walk-in lane under the upper fangs, and the palm in
 *  the forecourt, four yards off the way in from the road, whose trunk and
 *  crown stood between the road's end and the maw. */
export const WILDHEART_BASIN_ENTRANCE_CLEARED_SCATTER = [
  { x: -237.19542878307402, z: 1093.0744675970636 },
  { x: -246.96982042654417, z: 1079.8916892490815 },
] as const;

/** The Sunken Idol's ring of columns (its guardian camps inside it): the set
 *  piece keeps every solid `clear` yards outside the ring's own radius. */
export const WILDHEART_BASIN_ENTRANCE_RING = { x: -256, z: 1090, radius: 8, clear: 4 } as const;

/**
 * The ways in, door-local polylines the set piece keeps open (the Blender
 * build plants no solid and no tall growth in them, and
 * tests/wildheart_basin_entrance.test.ts walks them): up the causeway, whose
 * foot swings a yard and a half east toward the road; from the road's end at
 * (-256, 1072); and from the west gap of the ring of columns.
 */
export const WILDHEART_BASIN_ENTRANCE_WAYS: readonly {
  readonly name: string;
  readonly points: readonly (readonly [number, number])[];
}[] = [
  {
    name: 'causeway',
    points: [
      [-1.6, -14.6],
      [-1.0, -10.0],
      [-0.3, -6.5],
      [0.0, -4.0],
      [0.0, -0.5],
    ],
  },
  {
    name: 'road',
    points: [
      [-19.0, -21.0],
      [-6.5, -17.0],
      [-1.6, -14.6],
    ],
  },
  {
    name: 'ring',
    points: [
      [-11.0, -3.0],
      [-5.6, -7.5],
      [-0.5, -7.0],
    ],
  },
];

/** The causeway's plan (door-local), the Blender build's APRON, apron_c and
 *  apron_hw: flagstones from the flat at the rise's foot (z0) into the maw
 *  (z1), 2.3 yd either side between the lower teeth, fanning from 3 to 3.6 at
 *  the tusks, the centre line swinging 1.6 yd east from lz -4.5 to its foot. */
const CAUSEWAY = {
  z0: -14.6,
  z1: 1.1,
  halfIn: 2.3,
  halfMouth: 3.0,
  halfFar: 3.6,
  swing: -1.6,
  swingFrom: -4.5,
  muzzle: -1.8,
} as const;

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Whether a world point lies on the causeway's flagstones (within `pad`
 *  yards of them): the paving the meadow's grass does not grow through. */
export function onWildheartBasinEntranceCauseway(
  door: { readonly x: number; readonly z: number },
  x: number,
  z: number,
  pad = 0,
): boolean {
  const c = CAUSEWAY;
  const lz = z - door.z;
  if (lz < c.z0 - pad || lz > c.z1) return false;
  const centre = c.swing * smoothstep(c.swingFrom, c.z0, lz);
  const half =
    lz > c.muzzle ? c.halfIn : c.halfMouth + (c.halfFar - c.halfMouth) * smoothstep(-3, -13, lz);
  return Math.abs(x - door.x - centre) < half + pad;
}

export interface WildheartEntranceColliderRow {
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
 * (stats.json of build_wildheart_entrance.py): the idol's round head (it
 * closes the lane behind the door: the walk-in trigger takes a body first),
 * the muzzle's two halves either side of the lane (a box along each chord of
 * its curved front), the two fire bowls on their plinths beside the maw, the
 * two tusks at the causeway's foot and the heap of the fallen ear in the
 * corner of the muzzle and the east cheek. The causeway's flagstones and
 * kerbs, the blocks sunk down the bank and in the shallows, the fig's roots
 * and all the growth are walk-over dressing.
 */
export const WILDHEART_BASIN_ENTRANCE_COLLIDERS: readonly WildheartEntranceColliderRow[] = [
  { name: 'head', type: 'circle', lx: 0.0, lz: 8.8, r: 8.05, top: 15.8 },
  {
    name: 'muzzle_w',
    type: 'obb',
    lx: 3.74,
    lz: 0.968,
    hw: 2.83,
    hd: 1.45,
    rot: -0.4455,
    top: 8.4,
  },
  {
    name: 'muzzle_e',
    type: 'obb',
    lx: -3.74,
    lz: 0.968,
    hw: 2.83,
    hd: 1.45,
    rot: -2.6961,
    top: 8.4,
  },
  { name: 'brazier_w', type: 'circle', lx: 4.4, lz: -3.4, r: 1.0, top: 1.27 },
  { name: 'brazier_e', type: 'circle', lx: -4.4, lz: -3.4, r: 1.0, top: 1.27 },
  { name: 'tusk_w', type: 'circle', lx: 3.7, lz: -11.4, r: 0.75, top: 4.92 },
  { name: 'tusk_e', type: 'circle', lx: -6.3, lz: -12.2, r: 0.75, top: 4.42 },
  { name: 'fallen_ear', type: 'circle', lx: -6.5, lz: 2.8, r: 1.5, top: 0.31 },
];

export interface WildheartEntranceFooting {
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
 * the sim's own terrain sampled every half yard. The rise falls away on every
 * side of the door (four yards from the maw round to the lagoon side of the
 * head), so each footing is cut a fixed depth under the LOWEST ground under
 * it: it never floats; tests/wildheart_basin_entrance.test.ts pins it against
 * groundHeight at its centre and four corners. The head a yard under the
 * lowest ground round its drum (its box here is the square inscribed in the
 * drum), the muzzle 0.9 (its wrapped ends reach seven yards out), the fire
 * bowls' plinths 0.5, the tusks 1.3 under their own foot; the fallen ear's
 * stones lie sunk in the turf.
 */
export const WILDHEART_BASIN_ENTRANCE_FOOTINGS: readonly WildheartEntranceFooting[] = [
  { name: 'head', lx: 0.0, lz: 8.8, hw: 5.6, hd: 5.6, rot: 0.0, bottom: -5.09 },
  { name: 'muzzle', lx: 0.0, lz: -0.1, hw: 7.0, hd: 1.9, rot: 0.0, bottom: -3.503 },
  { name: 'brazier_w', lx: 4.4, lz: -3.4, hw: 0.8, hd: 0.8, rot: 0.0, bottom: -2.614 },
  { name: 'brazier_e', lx: -4.4, lz: -3.4, hw: 0.8, hd: 0.8, rot: 0.0, bottom: -1.82 },
  { name: 'tusk_w', lx: 3.7, lz: -11.4, hw: 0.45, hd: 0.45, rot: 0.0, bottom: -3.985 },
  { name: 'tusk_e', lx: -6.3, lz: -12.2, hw: 0.45, hd: 0.45, rot: 0.0, bottom: -3.68 },
  { name: 'fallen_ear', lx: -6.5, lz: 2.8, hw: 0.6, hd: 0.6, rot: 0.0, bottom: -1.335 },
];

/** World colliders for the set piece at a door, seated on the door's terrain height. */
export function wildheartBasinEntranceColliders(
  seed: number,
  door: { readonly x: number; readonly z: number },
): Collider[] {
  const base = terrainHeight(door.x, door.z, seed);
  const out: Collider[] = [];
  for (const row of WILDHEART_BASIN_ENTRANCE_COLLIDERS) {
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
