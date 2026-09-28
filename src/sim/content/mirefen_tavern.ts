// The Mirefen tavern: the walk-in inn on the Fenbridge road in Mirefen Marsh, north of the
// Gravecaller ground and east of the fen trolls. Data-as-code; the floor surface is
// ../mirefen_tavern_floor.ts, the colliders, rest area and keeper spawn are
// ../mirefen_tavern.ts, and the one Blender model (scripts/assets/mirefen_tavern/) reads
// THESE numbers through its layout.json, so what the player walks is what the model draws.
//
// Frame: everything below is in the tavern's LOCAL yards, origin at TAVERN_ORIGIN on the
// ground floor (TAVERN_FLOOR_Y), +z out of the front door, +x to the right of a player
// walking in, heights over the ground floor. The door faces the road (world +x), so a
// local point (lx, lz) stands at world (TAVERN_ORIGIN.x + lz, TAVERN_ORIGIN.z - lx):
// tavernToWorld below is the one conversion.
//
// One storey for players, open to the roof: an L with a round tower in its inner corner.
//  - the common room (the hall), 30.4 wide and 26.4 deep inside, open to its hammerbeam
//    roof (no timber crosses the room under TAVERN_HALL.truss): the front door in the
//    middle of its gable, a round hearth one step down in the middle of the floor, a
//    window booth either side of the door, a booth and the long table down the left wall
//    and the dice table by the door, the bard's stage in the back left corner, the wall
//    fireplace and its settle on the right, the bar on a raised platform in the back right
//    corner wrapped round a stone pillar, barrel racks behind it either side of the
//    kitchen's serving hatch;
//  - the round tower behind the hall's back wall, open to the room through a wide arch: a
//    flagged nook with a bench round its wall and two small tables, open up into its cone;
//  - the wing behind the hall's right half, the kitchen and the cellar, closed: only the
//    serving hatch looks into it. The rooms the innkeeper lets upstairs are never walked.
//
// Scale: the player stands 2.6 yd to the crown on a 0.5 yd body radius. The door clears
// 4.6 by 5.2, the side walls stand 10 to the eaves under a ridge at 20, the lowest roof
// timber across the room is at 10.2, table tops stand at 1.45, plain wooden seats (chairs,
// stools, the long table's and the porch's benches) at 0.9 and cushioned ones at 0.85.

import type { NpcDef } from '../types';
import { TAVERN_GROUNDS_PROPS } from './mirefen_tavern_grounds';

/** Where the tavern stands: the world point under its local origin (the hall's middle). */
export const TAVERN_ORIGIN = { x: -17, z: 408 } as const;
/** The ground floor's absolute height: 0.4 over the highest ground under the footprint. */
export const TAVERN_FLOOR_Y = 0.5;

/** Local (lx, lz) to world (x, z): the door faces world +x. */
export function tavernToWorld(lx: number, lz: number): { x: number; z: number } {
  return { x: TAVERN_ORIGIN.x + lz, z: TAVERN_ORIGIN.z - lx };
}
/** The model's yaw (three.js rotation.y) that turns local +z onto world +x. */
export const TAVERN_YAW = Math.PI / 2;

/** The common room's outer wall faces, wall thickness and heights. */
export const TAVERN_HALL = {
  x0: -16,
  x1: 16,
  z0: -14,
  z1: 14,
  wall: 0.8,
  /** The wall plate along both side walls (the eaves' line). */
  eave: 10.0,
  /** The ridge over the middle, running front to back (the front is a gable). */
  ridge: 20.0,
  /** The hammer beams' undersides and the beam the bar's pillar carries: no timber crosses
   *  the room under it (only the short braces under the hammer beams, hugging the side walls,
   *  dip a yard below; the camera's air stops under them all,
   *  render/mirefen_tavern_interior_core.ts). */
  truss: 10.2,
  /** The hammerbeam trusses' positions along the hall (local z). */
  trusses: [-10.0, -4.6, 0.0, 5.0, 10.0],
  /** The roof overhangs the side walls at the eaves and the gables at the verges: deep eaves,
   *  and at the front a verge that reaches on over the jettied upper storey (TAVERN_JETTY). */
  eaveOut: 1.6,
  vergeOut: 2.0,
} as const;

/** The front's jettied upper storey: from `y` over the ground floor up to the gable the front
 *  wall stands `out` further toward the road than the ground floor's face, on joists and carved
 *  brackets. Purely outside: the hall's inner wall face runs on straight up to the roof, there
 *  is no upper floor, and nothing of it stands where a body walks (well over any head). */
export const TAVERN_JETTY = { y: 5.9, out: 1.0 } as const;

/** The front doorway in the middle of the front gable. */
export const TAVERN_DOOR = { x: 0, width: 4.6, height: 5.2 } as const;

/** The stone porch before the door and the steps down from it to the road. */
export const TAVERN_PORCH = {
  x0: -4,
  x1: 4,
  z0: 14,
  z1: 16.4,
  /** The steps fall this much per yard toward the road until they meet the ground. */
  stepSlope: 0.5,
  stepHalfWidth: 3.6,
  /** The low parapets along the porch's two sides (their tops over the floor). */
  parapet: 1.0,
} as const;

/** How far the porch steps may run before they are certainly under the ground. */
export const TAVERN_STEPS_MAX_RUN = 8;

/** The wing behind the hall's right half: the kitchen and cellar under the keeper's floor,
 *  closed (the serving hatch looks into its kitchen). */
export const TAVERN_WING = {
  x0: 4,
  x1: 16,
  z0: -28,
  z1: -14,
  wall: 0.8,
  eave: 9.4,
  /** The keeper's floor over the kitchen (the band on its walls, outside). */
  floor: 6.0,
  /** The wing's ridge runs front to back over its middle, under the hall's back gable. */
  ridge: 13.3,
  eaveOut: 0.9,
  vergeOut: 0.6,
} as const;

/** The round tower in the L's inner corner: a nook on the ground floor, open up into its
 *  slate cone. */
export const TAVERN_TOWER = {
  x: -1.5,
  z: -18,
  rIn: 6.0,
  rOut: 6.8,
  wallTop: 11.2,
  /** The slate cone's point, over the hall's ridge: the tower's hat reads from the road. */
  peak: 22.0,
  eaveOut: 0.8,
} as const;

/** The arch in the hall's back wall that opens the room onto the tower's nook. */
export const TAVERN_ARCH = { x0: -5.5, x1: 2.4, height: 5.4 } as const;

/** The kitchen's serving hatch through the hall's back wall behind the bar: its span, its
 *  sill and its head over the ground floor. A body never passes it (the wall's collider
 *  runs on over it); the kitchen behind it is set dressing. */
export const TAVERN_HATCH = { x0: 8.2, x1: 10.8, sill: 1.9, head: 3.5 } as const;

/** The hearth pit: one step down round the round hearth, a ramped edge to walk it. */
export const TAVERN_PIT = { x: 0, z: 2.4, r: 5.4, rim: 5.85, depth: 0.45 } as const;

/** The bar's raised platform (the barkeep's aisle and the drinkers' side), its ramped
 *  front and left edges. It runs back to the hall's back wall. */
export const TAVERN_BAR_PLATFORM = {
  x0: 2.4,
  x1: 15.2,
  z0: -13.2,
  z1: -4.2,
  lift: 0.5,
  rim: 0.5,
} as const;

/** The bard's stage in the back left corner: a raised deck, its ramped front and right
 *  edges (the mirror of the bar platform's). */
export const TAVERN_STAGE = {
  x0: -15.2,
  x1: -9.4,
  z0: -13.2,
  z1: -8.4,
  lift: 0.45,
  rim: 0.5,
} as const;

/** A solid thing in the tavern: what the sim collides with and the model draws there.
 *  `level` is the floor it stands on: the ground floor, the bar platform, the stage or the
 *  hearth pit; heights are over that floor. */
export type TavernPropKind =
  | 'hearth'
  | 'bench'
  | 'table'
  | 'roundTable'
  | 'chair'
  | 'stool'
  | 'counter'
  | 'pillar'
  | 'settle'
  | 'fireplace'
  | 'chest'
  | 'barrels'
  | 'cask'
  | 'planter'
  | 'terraceTable'
  | 'terraceBench'
  | 'post'
  | 'crate'
  | 'trough'
  | 'hay'
  | 'cart'
  | 'woodpile'
  | 'dog';
export type TavernLevel = 'ground' | 'pit' | 'platform' | 'stage';

export interface TavernProp {
  kind: TavernPropKind;
  x: number;
  z: number;
  /** Yaw in the local frame (three.js rotation.y convention). */
  rot: number;
  r?: number;
  hw?: number;
  hd?: number;
  height: number;
  level: TavernLevel;
  /** For a piece outside on the terrain (the flower tubs at the foot of the porch steps and
   *  everything on the grounds, ./mirefen_tavern_grounds.ts): the ground's height under its
   *  middle, over the ground floor, in place of its level's floor. Everything else stands on
   *  its level. */
  baseY?: number;
  /** Furniture can be stood on (the harbor house idiom); the hearth, the wall fireplace,
   *  the barrel racks and the bar's pillar block at full height. A `cask` is one barrel
   *  standing on its end (the porch's), a `planter` a stone flower tub, both round. */
  standable?: boolean;
}

const DEG = Math.PI / 180;

function benchRing(): TavernProp[] {
  // five curved benches round the fire, the gaps facing the door and the four quarters
  const out: TavernProp[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (36 + 72 * i) * DEG;
    out.push({
      kind: 'bench',
      x: TAVERN_PIT.x + Math.sin(a) * 3.9,
      z: TAVERN_PIT.z + Math.cos(a) * 3.9,
      // the bench's long side runs across the radius
      rot: a,
      hw: 1.4,
      hd: 0.375,
      height: 0.85,
      level: 'pit',
      standable: true,
    });
  }
  return out;
}

/** The nook's bench round the tower's wall: five straight runs, their backs to the stone,
 *  from one side of the arch round the back to the other (angles as atan2(dx, dz) round
 *  the tower, 0 toward the hall). */
export const TAVERN_NOOK_BENCH_ANGLES: readonly number[] = [90, 135, 180, 225, 270].map(
  (a) => a * DEG,
);
/** The nook bench's radius (its middle) and the small tables' radius and angles. */
export const TAVERN_NOOK = { benchR: 5.25, tableR: 3.3, tableAngles: [145 * DEG, 215 * DEG] };

function nook(): TavernProp[] {
  const t = TAVERN_TOWER;
  const out: TavernProp[] = TAVERN_NOOK_BENCH_ANGLES.map((a) => ({
    kind: 'bench' as const,
    x: t.x + Math.sin(a) * TAVERN_NOOK.benchR,
    z: t.z + Math.cos(a) * TAVERN_NOOK.benchR,
    rot: a,
    hw: 1.85,
    hd: 0.38,
    height: 0.85,
    level: 'ground' as const,
    standable: true,
  }));
  for (const a of TAVERN_NOOK.tableAngles) {
    out.push({
      kind: 'roundTable',
      x: t.x + Math.sin(a) * TAVERN_NOOK.tableR,
      z: t.z + Math.cos(a) * TAVERN_NOOK.tableR,
      rot: 0,
      r: 0.8,
      height: 1.45,
      level: 'ground',
      standable: true,
    });
  }
  return out;
}

/** A booth: two high-backed settles facing each other across a table. `across` is the
 *  settles' spacing and `rot` the first settle's yaw (its back away from the table). */
function booth(
  x: number,
  z: number,
  rot: number,
  settleHw: number,
  tableHw: number,
  tableHd: number,
): TavernProp[] {
  // the settles stand 1.7 either side of the table along the booth's axis (local z)
  const dx = Math.sin(rot) * 1.7;
  const dz = Math.cos(rot) * 1.7;
  const settle = (sx: number, sz: number, r: number): TavernProp => ({
    kind: 'settle',
    x: sx,
    z: sz,
    rot: r,
    hw: settleHw,
    hd: 0.45,
    height: 0.85,
    level: 'ground',
    standable: true,
  });
  return [
    settle(x - dx, z - dz, rot),
    {
      kind: 'table',
      x,
      z,
      rot: 0,
      hw: tableHw,
      hd: tableHd,
      height: 1.45,
      level: 'ground',
      standable: true,
    },
    settle(x + dx, z + dz, rot + Math.PI),
  ];
}

export const TAVERN_PROPS: readonly TavernProp[] = [
  // the round hearth in the pit: a knee-high stone ring a spell sees over
  { kind: 'hearth', x: TAVERN_PIT.x, z: TAVERN_PIT.z, rot: 0, r: 1.7, height: 1.0, level: 'pit' },
  ...benchRing(),
  // the left side: the dice table by the door, the long table, the booth by the stage
  {
    kind: 'roundTable',
    x: -12.2,
    z: 9.0,
    rot: 0,
    r: 1.2,
    height: 1.45,
    level: 'ground',
    standable: true,
  },
  {
    kind: 'stool',
    x: -12.2,
    z: 11.1,
    rot: 0,
    r: 0.42,
    height: 0.9,
    level: 'ground',
    standable: true,
  },
  {
    kind: 'stool',
    x: -10.3,
    z: 8.0,
    rot: 0,
    r: 0.42,
    height: 0.9,
    level: 'ground',
    standable: true,
  },
  {
    kind: 'stool',
    x: -14.1,
    z: 8.0,
    rot: 0,
    r: 0.42,
    height: 0.9,
    level: 'ground',
    standable: true,
  },
  {
    kind: 'table',
    x: -12.4,
    z: 1.0,
    rot: 0,
    hw: 0.75,
    hd: 2.2,
    height: 1.45,
    level: 'ground',
    standable: true,
  },
  {
    kind: 'bench',
    x: -14.2,
    z: 1.0,
    rot: 0,
    hw: 0.35,
    hd: 2.0,
    height: 0.9,
    level: 'ground',
    standable: true,
  },
  {
    kind: 'bench',
    x: -10.6,
    z: 1.0,
    rot: 0,
    hw: 0.35,
    hd: 2.0,
    height: 0.9,
    level: 'ground',
    standable: true,
  },
  // the wall booth by the stage: the settles' backs to the stage and to the long table
  ...booth(-13.6, -4.6, 0, 1.5, 1.2, 0.6),
  // the window booths either side of the door, their backs across the room
  ...booth(-9.0, 11.75, Math.PI / 2, 1.25, 0.6, 1.05),
  ...booth(9.0, 11.75, Math.PI / 2, 1.25, 0.6, 1.05),
  // the bard's stage: the bard's stool and the costume chest in the corner
  {
    kind: 'stool',
    x: -12.3,
    z: -11.0,
    rot: 0,
    r: 0.42,
    height: 0.9,
    level: 'stage',
    standable: true,
  },
  {
    kind: 'chest',
    x: -14.3,
    z: -12.5,
    rot: 0.35,
    hw: 0.7,
    hd: 0.42,
    height: 0.9,
    level: 'stage',
    standable: true,
  },
  // the right side: the square table by the door, the wall fireplace and its settle
  {
    kind: 'table',
    x: 12.2,
    z: 9.0,
    rot: 0,
    hw: 1.1,
    hd: 1.1,
    height: 1.45,
    level: 'ground',
    standable: true,
  },
  {
    kind: 'chair',
    x: 12.2,
    z: 11.2,
    rot: Math.PI,
    r: 0.45,
    height: 0.9,
    level: 'ground',
    standable: true,
  },
  {
    kind: 'chair',
    x: 12.2,
    z: 6.8,
    rot: 0,
    r: 0.45,
    height: 0.9,
    level: 'ground',
    standable: true,
  },
  {
    kind: 'chair',
    x: 10.0,
    z: 9.0,
    rot: Math.PI / 2,
    r: 0.45,
    height: 0.9,
    level: 'ground',
    standable: true,
  },
  {
    kind: 'chair',
    x: 14.4,
    z: 9.0,
    rot: -Math.PI / 2,
    r: 0.45,
    height: 0.9,
    level: 'ground',
    standable: true,
  },
  {
    kind: 'fireplace',
    x: 14.6,
    z: 2.5,
    rot: 0,
    hw: 0.6,
    hd: 1.9,
    height: TAVERN_HALL.eave,
    level: 'ground',
  },
  {
    kind: 'settle',
    x: 11.4,
    z: 2.5,
    rot: Math.PI / 2,
    hw: 1.6,
    hd: 0.45,
    height: 0.85,
    level: 'ground',
    standable: true,
  },
  // the bar: the stone pillar at the elbow (up to the beam over the bar), the long counter
  // and the short one behind the pillar, the stools before it, the barrel racks against the
  // back wall either side of the kitchen hatch
  {
    kind: 'pillar',
    x: 4.3,
    z: -7.6,
    rot: 0,
    r: 1.1,
    height: TAVERN_HALL.truss - TAVERN_BAR_PLATFORM.lift,
    level: 'platform',
  },
  {
    kind: 'counter',
    x: 9.1,
    z: -6.9,
    rot: 0,
    hw: 3.7,
    hd: 0.5,
    height: 1.65,
    level: 'platform',
    standable: true,
  },
  {
    kind: 'counter',
    x: 4.3,
    z: -9.35,
    rot: 0,
    hw: 0.5,
    hd: 0.65,
    height: 1.65,
    level: 'platform',
    standable: true,
  },
  {
    kind: 'stool',
    x: 6.4,
    z: -5.5,
    rot: 0,
    r: 0.4,
    height: 1.0,
    level: 'platform',
    standable: true,
  },
  {
    kind: 'stool',
    x: 8.3,
    z: -5.5,
    rot: 0,
    r: 0.4,
    height: 1.0,
    level: 'platform',
    standable: true,
  },
  {
    kind: 'stool',
    x: 10.2,
    z: -5.5,
    rot: 0,
    r: 0.4,
    height: 1.0,
    level: 'platform',
    standable: true,
  },
  {
    kind: 'stool',
    x: 12.1,
    z: -5.5,
    rot: 0,
    r: 0.4,
    height: 1.0,
    level: 'platform',
    standable: true,
  },
  {
    kind: 'barrels',
    x: 5.25,
    z: -12.4,
    rot: 0,
    hw: 2.65,
    hd: 0.8,
    height: 3.6,
    level: 'platform',
  },
  {
    kind: 'barrels',
    x: 13.05,
    z: -12.4,
    rot: 0,
    hw: 1.95,
    hd: 0.8,
    height: 3.6,
    level: 'platform',
  },
  // the tower's nook
  ...nook(),
  // outside on the porch, clear of the doorway (x -2.3 to 2.3) and its posts: the porch
  // bench against the front wall left of the door, facing the road, a plain board seat at
  // the chairs' 0.9
  {
    kind: 'bench',
    x: -3.2,
    z: 14.5,
    rot: 0,
    hw: 0.6,
    hd: 0.35,
    height: 0.9,
    level: 'ground',
    standable: true,
  },
  // the porch casks right of the door, stood on end in a row against the wall and the
  // parapet, stepping down toward the steps
  {
    kind: 'cask',
    x: 3.3,
    z: 14.55,
    rot: 0,
    r: 0.42,
    height: 1.3,
    level: 'ground',
    standable: true,
  },
  // the porch's second cask
  {
    kind: 'cask',
    x: 3.32,
    z: 15.39,
    rot: 0.6,
    r: 0.4,
    height: 1.15,
    level: 'ground',
    standable: true,
  },
  // the porch's small keg by the top step
  {
    kind: 'cask',
    x: 3.38,
    z: 16.07,
    rot: 1.1,
    r: 0.3,
    height: 0.8,
    level: 'ground',
    standable: true,
  },
  // the flower tub left of the foot of the porch steps, on the terrain beside the last step
  {
    kind: 'planter',
    x: -4.45,
    z: 20.75,
    rot: 0,
    r: 0.5,
    height: 0.95,
    level: 'ground',
    baseY: -2.69,
    standable: true,
  },
  // the flower tub right of the foot of the porch steps
  {
    kind: 'planter',
    x: 4.45,
    z: 20.75,
    rot: 0.4,
    r: 0.5,
    height: 0.95,
    level: 'ground',
    baseY: -2.24,
    standable: true,
  },
  // the grounds outside: the terrace, the stable's trough, hay and cart, the woodpile, the
  // casks and crates at the corner, the lantern posts and the dog on the porch
  ...TAVERN_GROUNDS_PROPS,
];

/** The lanterns hung under the hammer beams' ends, high over the booths and tables, and
 *  the wheel chandelier over the entry: every one clear over the camera's air. (x, z, and
 *  the lantern's height over the floor.) The lit ones also light the room
 *  (render/mirefen_tavern.ts); the hearth, the wall fire, the stage's footlights, the bar's
 *  candles and the nook light it too. */
export const TAVERN_LANTERNS: readonly { x: number; z: number; y: number; lit: boolean }[] = [
  { x: -13.2, z: -10.0, y: 9.7, lit: false },
  { x: -13.2, z: 0.0, y: 9.7, lit: true },
  { x: -13.2, z: 10.0, y: 9.7, lit: false },
  { x: 13.2, z: -4.6, y: 9.7, lit: false },
  { x: 13.2, z: 5.0, y: 9.7, lit: true },
  { x: 13.2, z: 10.0, y: 9.7, lit: false },
];
export const TAVERN_CHANDELIER = { x: 0, z: 9.6, y: 9.8, r: 2.1 } as const;
/** The iron candle sconces on the walls, each at its wall's inner face (x, z), its candle
 *  this high over the floor, `nx`/`nz` the way it faces into the room: two flanking the
 *  stage, two in the tower's nook, one either side of the right wall's fire. */
export const TAVERN_SCONCES: readonly {
  x: number;
  z: number;
  y: number;
  nx: number;
  nz: number;
}[] = (() => {
  const t = TAVERN_TOWER;
  const ih = TAVERN_HALL.x1 - TAVERN_HALL.wall;
  const back = TAVERN_HALL.z0 + TAVERN_HALL.wall;
  const inNook = (a: number) => ({
    x: t.x + Math.sin(a * DEG) * t.rIn,
    z: t.z + Math.cos(a * DEG) * t.rIn,
    y: 3.6,
    nx: -Math.sin(a * DEG),
    nz: -Math.cos(a * DEG),
  });
  return [
    { x: -14.7, z: back, y: 3.8, nx: 0, nz: 1 },
    { x: -9.9, z: back, y: 3.8, nx: 0, nz: 1 },
    inNook(118),
    inNook(242),
    { x: ih, z: -1.4, y: 3.4, nx: -1, nz: 0 },
    { x: ih, z: 6.4, y: 3.4, nx: -1, nz: 0 },
  ];
})();
/** The copper hood high over the round hearth, clear over the camera's air: its rim's
 *  height and radius, its crown, its flue's top. */
export const TAVERN_HOOD = { rimY: 9.4, rimR: 3.0, topY: 12.2, topR: 0.8, flueTop: 21.8 } as const;

/** The rest area: the whole inside. A body counts as resting when its feet stand no further
 *  under the ground floor than this. */
export const TAVERN_REST_SINK = 0.6;

/** The innkeeper's reserved entity id (the singleton NPCs' 1_000_000_x namespace, types.ts
 *  STATIC_WORLD_SERVICE_ENTITY_ID_MIN's note; 000 to 006 and 010 to 014 are taken): she is
 *  spawned under it, outside the sequential allocator, so no other entity's id moves. */
export const TAVERN_KEEPER_ENTITY_ID = 1_000_000_020;
/** Where the innkeeper stands (local): behind the long counter, before the kitchen hatch,
 *  turned to the room. */
export const TAVERN_KEEPER_LOCAL = { x: 9.0, z: -8.8 } as const;
const KEEPER_WORLD = tavernToWorld(TAVERN_KEEPER_LOCAL.x, TAVERN_KEEPER_LOCAL.z);

/** The innkeeper: a classic inn's victualler (no quests). She sells bread and water for the
 *  road and the marsh's own fare at Fenbridge's prices (the Mirefen band's food and drink,
 *  the same records Provisioner Hale stocks). `dynamic`, so the world-init NPC loop skips
 *  her; ../mirefen_tavern.ts spawns her under her reserved id. She faces local +z (the
 *  room and the door), which is world +x. There is no hearthstone or bind point in this
 *  game, so an innkeeper has no binding service to offer. */
export const MIREFEN_TAVERN_NPCS: Record<string, NpcDef> = {
  innkeeper_maudie: {
    id: 'innkeeper_maudie',
    name: 'Maudie Tapwright',
    title: 'Innkeeper',
    pos: { x: KEEPER_WORLD.x, z: KEEPER_WORLD.z },
    facing: TAVERN_YAW,
    color: 0x8a2a2a,
    questIds: [],
    vendorItems: [
      'baked_bread',
      'spring_water',
      'fenbridge_rye',
      'marsh_mint_tea',
      'smoked_eel',
      'silvermist_cordial',
    ],
    dynamic: true,
    innkeeper: true,
    greeting:
      'Come in out of the damp, friend, and mind the step down to the fire. The kettle is on, the benches are warm, and the rooms upstairs are dry. Travelers from Fenbridge swear the marsh road is quiet by day, but nobody walks it after dark. Sit a while and rest your feet.',
  },
};
export const TAVERN_KEEPER_NPC_ID = 'innkeeper_maudie';
