// The Mirefen tavern's pure decisions (the painter is mirefen_tavern.ts): which named parts
// of the one Blender model a graphics tier keeps, and, every frame, which shell parts (the
// walls, the roofs, the porch and the bar's pillar) stand between the camera and the player
// and how far each one fades. Three-, DOM- and i18n-free.
//
// Fairness (docs/design/graphics-settings-fairness.md): everything a player walks on, bumps
// into or steers by is kept on EVERY tier: the floors, the hearth, the bar, the stage, every
// wall and roof, every piece of furniture the sim collides with, and every light (the
// hearth, the lanterns, the chandelier, the candles: the landmarks). A lower preset sheds only
// dressing nothing collides with: the iron and brass trim below medium, the tankards, plates,
// dice, lute, firewood and rugs below high. The tier is the STATIC effects tier
// (GFX.effectsTier), never the frame-rate governor.
//
// The camera and the shell:
//  - lens INSIDE (the camera in the tavern's air, mirefen_tavern_interior_core.ts): the
//    indoor camera clamp (interior_camera.ts, the one authored-interior exception to the
//    pinned no-pull-in rule of tests/graphics_overhaul_integration.test.ts) keeps the camera
//    in that air, so the outer shell (the walls, the roofs, the tower) is never between the
//    lens and the player and never opens: from inside the tavern the outside never shows.
//    Only the bar's pillar, which stands in the air, cuts away when the sight line crosses it;
//  - lens OUTSIDE (a player outdoors, or the camera following a player in through the front
//    door): the sightline ghost. Each part the sight line passes through ghosts to the
//    standard 20% (occluder_fade_core); outdoors the chase camera never pulls in. The front
//    wall is three parts (either side of the door and the gable over it) and the porch's
//    canopy and sign a fourth, and the doorway itself is open, so a sight line in through the
//    door ghosts nothing and one at an angle ghosts only the piece of wall it crosses: the
//    building never opens as a cutaway.
// The frame, the floors, the furniture and the lights never fade: only the shell does.

import {
  TAVERN_BAR_PLATFORM,
  TAVERN_DOOR,
  TAVERN_FLOOR_Y,
  TAVERN_HALL,
  TAVERN_JETTY,
  TAVERN_ORIGIN,
  TAVERN_PORCH,
  TAVERN_PROPS,
  TAVERN_TOWER,
  TAVERN_WING,
} from '../sim/content/mirefen_tavern';
import type { GfxTier } from './gfx';
import { eyeInTavernAir } from './mirefen_tavern_interior_core';
import { OCCLUDER_FADE_ALPHA } from './occluder_fade_core';

/** The shell parts of the model, in the order the painter keeps them. */
export const TAVERN_SHELL_PARTS = [
  'HallWallFront',
  'HallWallFrontLeft',
  'HallWallFrontRight',
  'HallWallBack',
  'HallWallLeft',
  'HallWallRight',
  'HallRoof',
  'WingWallEast',
  'WingWallBack',
  'WingWallWest',
  'WingRoof',
  'TowerWall',
  'TowerRoof',
  'HallPorch',
  'BarPillar',
] as const;
export type TavernShellPart = (typeof TAVERN_SHELL_PARTS)[number];

/** The dog asleep on the porch: its own mesh round its own origin, so the painter can make it
 *  breathe (mirefen_tavern_dog_core.ts). */
export const TAVERN_DOG_PART = 'TavernDog';

/** Walkable structure, solids, the shell and the landmarks: never shed. The grounds (the
 *  forecourt's bed, the terrace's tables and benches, the lantern posts and strings, the stable,
 *  the trough, the hay, the cart, the woodpile) collide or light the way on every tier, and the
 *  dog has a collider, so it stays too. */
export const TAVERN_CRITICAL_PARTS = [
  'TavernFrame',
  'TavernFurnishings',
  'TavernLights',
  'TavernGrounds',
  TAVERN_DOG_PART,
  ...TAVERN_SHELL_PARTS,
] as const;
/** Medium and up: iron bands, the brass foot rail, braces, stretchers, rivets, the forecourt's
 *  cobbles, the chalkboard menu. */
export const TAVERN_TRIM_PARTS = ['TavernTrim'] as const;
/** High and up: tankards, plates, dice, the lute, firewood, rugs, the cat, the moss cushions
 *  on the roof and the plinth, straw, sacks, the stable's tack. */
export const TAVERN_OPTIONAL_PARTS = ['TavernClutter'] as const;

const TIER_RANK: Readonly<Record<GfxTier, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  ultra: 3,
  insane: 4,
};

/** The model's named parts a tier draws. */
export function mirefenTavernParts(tier: GfxTier): readonly string[] {
  const rank = TIER_RANK[tier];
  const parts: string[] = [...TAVERN_CRITICAL_PARTS];
  if (rank >= TIER_RANK.medium) parts.push(...TAVERN_TRIM_PARTS);
  if (rank >= TIER_RANK.high) parts.push(...TAVERN_OPTIONAL_PARTS);
  return parts;
}

// ---------------------------------------------------------------------------
// The camera cutaway
// ---------------------------------------------------------------------------

/** The eye (the camera's look point) stands this high over the player's feet (renderer.ts
 *  eyeY = pivot + 2). */
export const TAVERN_EYE_OVER_FEET = 2.0;
/** A roof's underside stands this far under its line (the sarking, rafters and purlins). */
export const TAVERN_ROOF_UNDERSIDE = 0.8;
/** Samples along the sight line for the roofs and the tower's ring. */
const SAMPLES = 24;

/** A local axis-aligned volume: [x0, x1, y0, y1, z0, z1] over the ground floor. */
type Vol = readonly [number, number, number, number, number, number];

const H = TAVERN_HALL;
const W = TAVERN_WING;
const T = TAVERN_TOWER;
const HALL_PITCH = (H.ridge - H.eave) / H.x1;
const WING_MID = (W.x0 + W.x1) / 2;
const WING_PITCH = (W.ridge - W.eave) / ((W.x1 - W.x0) / 2);
const TOWER_EAVE_R = T.rOut + T.eaveOut;

const fire = TAVERN_PROPS.find((p) => p.kind === 'fireplace');
const FIRE_Z0 = (fire?.z ?? 0) - (fire?.hd ?? 0);
const FIRE_Z1 = (fire?.z ?? 0) + (fire?.hd ?? 0);
/** The front wall's three parts meet this far either side of the door's middle: the door's
 *  posts go with the gable over it (build_tavern.py FRONT_SPLIT). */
export const TAVERN_FRONT_SPLIT = 3.2;
const D0 = TAVERN_DOOR.x - TAVERN_DOOR.width / 2;
const D1 = TAVERN_DOOR.x + TAVERN_DOOR.width / 2;
const FRONT = [H.z1 - H.wall - 0.1, H.z1 + 0.2] as const;
/** The jettied upper storey stands this far out over the ground floor, from under its
 *  bressumer (build: tavern_jetty.py) up to the gable. */
const JETTY_Y = TAVERN_JETTY.y - 0.4;
const JETTY_Z = H.z1 + TAVERN_JETTY.out + 0.35;

/** Each box-shaped shell part's volumes (the roofs, the tower and the pillar are shaped,
 *  below). The doorway is open: a sight line through it crosses no part of the front. */
const BOX_VOLUMES: Partial<Record<TavernShellPart, readonly Vol[]>> = {
  // the gable over the door and the door's posts either side of it
  HallWallFront: [
    [-TAVERN_FRONT_SPLIT, TAVERN_FRONT_SPLIT, TAVERN_DOOR.height, H.ridge, FRONT[0], FRONT[1]],
    [-TAVERN_FRONT_SPLIT, TAVERN_FRONT_SPLIT, JETTY_Y, H.ridge, FRONT[0], JETTY_Z],
    [-TAVERN_FRONT_SPLIT, D0, 0, TAVERN_DOOR.height, FRONT[0], FRONT[1]],
    [D1, TAVERN_FRONT_SPLIT, 0, TAVERN_DOOR.height, FRONT[0], FRONT[1]],
  ],
  HallWallFrontLeft: [
    [H.x0, -TAVERN_FRONT_SPLIT, 0, H.ridge, FRONT[0], FRONT[1]],
    [H.x0, -TAVERN_FRONT_SPLIT, JETTY_Y, H.ridge, FRONT[0], JETTY_Z],
  ],
  HallWallFrontRight: [
    [TAVERN_FRONT_SPLIT, H.x1, 0, H.ridge, FRONT[0], FRONT[1]],
    [TAVERN_FRONT_SPLIT, H.x1, JETTY_Y, H.ridge, FRONT[0], JETTY_Z],
  ],
  // the porch's canopy over the door, its two brackets, and the tankard on its arm
  HallPorch: [
    [TAVERN_PORCH.x0 - 0.3, TAVERN_PORCH.x1 + 0.3, 5.9, 8.8, H.z1, TAVERN_PORCH.z1 + 0.9],
    [-3.55, -3.05, 3.8, 6.1, H.z1, H.z1 + 2.6],
    [3.05, 3.55, 3.8, 6.1, H.z1, H.z1 + 2.6],
    [6.9, 10.6, 6.2, 12.4, H.z1, H.z1 + 5.0],
  ],
  HallWallBack: [[H.x0, H.x1, 0, H.ridge, H.z0, H.z0 + H.wall]],
  HallWallLeft: [[H.x0, H.x0 + H.wall, 0, H.eave + 0.4, H.z0, H.z1]],
  // the right wall, the fireplace's breast inside it and the chimney outside
  HallWallRight: [
    [H.x1 - H.wall, H.x1, 0, H.eave + 0.4, H.z0, H.z1],
    [H.x1 - 2.0, H.x1, 0, H.eave, FIRE_Z0, FIRE_Z1],
    [H.x1, H.x1 + 2.0, 0, H.eave + 4.9, FIRE_Z0, FIRE_Z1],
  ],
  WingWallEast: [[W.x1 - W.wall, W.x1, 0, W.eave + 0.2, W.z0, W.z1]],
  WingWallBack: [[W.x0, W.x1, 0, W.ridge, W.z0, W.z0 + W.wall]],
  WingWallWest: [[W.x0, W.x0 + W.wall, 0, W.eave + 0.2, W.z0, T.z - 2.2]],
};

/** Everything the shell draws (local): the hall and its porch, sign and chimney, the wing,
 *  the tower's hat. */
const TAVERN_BOUNDS: Vol = [
  H.x0 - H.eaveOut - 0.5,
  H.x1 + 2.5,
  -4,
  T.peak + 3,
  W.z0 - W.vergeOut - 0.5,
  H.z1 + 5.5,
];

/** World (x, y, z) to the tavern's local frame (the door faces world +x). */
export function tavernLocal(x: number, y: number, z: number): { x: number; y: number; z: number } {
  return { x: TAVERN_ORIGIN.z - z, y: y - TAVERN_FLOOR_Y, z: x - TAVERN_ORIGIN.x };
}

/** Whether a player's eye (local) stands inside the tavern: over the floor of the hall (the
 *  doorway included) or the tower's nook, no lower than a body in the hearth pit, no higher
 *  than the roof. */
export function eyeInTavern(ex: number, ey: number, ez: number): boolean {
  const feet = ey - TAVERN_EYE_OVER_FEET;
  if (feet < -1.0 || feet > H.ridge) return false;
  if (ex > H.x0 && ex < H.x1 && ez > H.z0 && ez < H.z1 + 0.3) return true;
  return Math.hypot(ex - T.x, ez - T.z) < T.rOut;
}

// the slab test's running interval (module scratch: the per-frame path allocates nothing)
let slabT0 = 0;
let slabT1 = 1;

function slab(o: number, d: number, lo: number, hi: number): boolean {
  if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
  let ta = (lo - o) / d;
  let tb = (hi - o) / d;
  if (ta > tb) {
    const s = ta;
    ta = tb;
    tb = s;
  }
  if (ta > slabT0) slabT0 = ta;
  if (tb < slabT1) slabT1 = tb;
  return slabT0 <= slabT1;
}

/** Whether a local segment crosses an axis-aligned volume (slab test). */
export function segmentHitsVol(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  v: Vol,
): boolean {
  slabT0 = 0;
  slabT1 = 1;
  return (
    slab(ax, bx - ax, v[0], v[1]) && slab(ay, by - ay, v[2], v[3]) && slab(az, bz - az, v[4], v[5])
  );
}

/** Whether a body whose feet stand at world (x, y, z) is inside the tavern (the weather
 *  stops falling on it). */
export function tavernShelters(x: number, y: number, z: number): boolean {
  return eyeInTavern(
    TAVERN_ORIGIN.z - z,
    y - TAVERN_FLOOR_Y + TAVERN_EYE_OVER_FEET,
    x - TAVERN_ORIGIN.x,
  );
}

/** How far in from the side walls the hammer beams reach (tavern_shell.py hammerbeam_truss). */
const HAMMER_REACH = 2.5;

/** Along the side walls the braces under the hammer beams spring this far under them. */
const HAMMER_BRACE = 1.1;

/** The hall roof's underside over a local point (its rafters, purlins and the hammerbeam
 *  trusses: along the side walls the hammer beams and the braces under them, the lowest
 *  timber of it), or +Infinity off its footprint. */
export function hallRoofUnderside(x: number, z: number): number {
  if (Math.abs(x) > H.x1 + H.eaveOut || z < H.z0 - 0.2 || z > H.z1 + H.vergeOut) return Infinity;
  const line = H.ridge - Math.abs(x) * HALL_PITCH - TAVERN_ROOF_UNDERSIDE;
  return Math.abs(x) >= H.x1 - H.wall - HAMMER_REACH
    ? Math.min(line, H.truss - HAMMER_BRACE)
    : line;
}

/** The wing roof's underside (its tie beams at the eaves), or +Infinity off its footprint. */
export function wingRoofUnderside(x: number, z: number): number {
  const half = (W.x1 - W.x0) / 2 + W.eaveOut;
  if (Math.abs(x - WING_MID) > half || z < W.z0 - W.vergeOut || z > W.z1) return Infinity;
  const line = W.ridge - Math.abs(x - WING_MID) * WING_PITCH - TAVERN_ROOF_UNDERSIDE;
  return Math.min(line, W.eave - 0.4);
}

/** The tower cone's underside, or +Infinity off it (its hall side stops at the back wall). */
export function towerRoofUnderside(x: number, z: number): number {
  const r = Math.hypot(x - T.x, z - T.z);
  if (r > TOWER_EAVE_R || z > H.z0) return Infinity;
  return T.wallTop + ((TOWER_EAVE_R - r) * (T.peak - T.wallTop)) / TOWER_EAVE_R - 0.4;
}

const ARCH_HALF = (48 * Math.PI) / 180;

const pillar = TAVERN_PROPS.find((p) => p.kind === 'pillar');
/** The bar's pillar: its axis, its reach (the shaft, its plinth and the capital round it),
 *  its foot and its head (over the ground floor). */
const PILLAR = {
  x: pillar?.x ?? 0,
  z: pillar?.z ?? 0,
  reach: (pillar?.r ?? 0) + 0.45,
  y0: TAVERN_BAR_PLATFORM.lift - 0.5,
  y1: H.truss,
};

/** Whether a local point stands in the bar's pillar (its plinth to its capital). */
export function inPillar(x: number, y: number, z: number): boolean {
  if (!pillar || y < PILLAR.y0 || y > PILLAR.y1) return false;
  return Math.hypot(x - PILLAR.x, z - PILLAR.z) < PILLAR.reach;
}

/** Whether a local point stands in the tower's wall ring (open under the arch to the hall). */
export function inTowerWall(x: number, y: number, z: number): boolean {
  if (y < 0 || y > T.wallTop) return false;
  const dx = x - T.x;
  const dz = z - T.z;
  const r = Math.hypot(dx, dz);
  if (r < T.rIn - 0.15 || r > T.rOut + 0.15) return false;
  return Math.abs(Math.atan2(dx, dz)) > ARCH_HALF;
}

/** How close (yards, past its reach) the lens may pass the bar's pillar before it cuts away:
 *  a pillar filling the foreground beside the lens goes as one on the sight line does. */
export const PILLAR_LENS_CLEARANCE = 1.4;

/** Whether the sight line (a to b, local) crosses the bar's pillar, or the lens (b) stands
 *  in it or hard by it. */
function pillarOnSightLine(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): boolean {
  if (
    pillar &&
    by >= PILLAR.y0 &&
    by <= PILLAR.y1 &&
    Math.hypot(bx - PILLAR.x, bz - PILLAR.z) < PILLAR.reach + PILLAR_LENS_CLEARANCE
  ) {
    return true;
  }
  for (let s = 1; s < SAMPLES; s++) {
    const t = s / SAMPLES;
    if (inPillar(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t)) return true;
  }
  return false;
}

/** This frame's decision: the mode, and per shell part (TAVERN_SHELL_PARTS order) whether it
 *  occludes. A caller keeps one and passes it back in (no per-frame allocation). */
export interface TavernShellState {
  inside: boolean;
  occluded: boolean[];
  /** The alpha an occluding part settles at: 0 inside (cut away), the ghost outside. */
  floor: number;
}

export function newTavernShellState(): TavernShellState {
  return {
    inside: false,
    occluded: TAVERN_SHELL_PARTS.map(() => false),
    floor: OCCLUDER_FADE_ALPHA,
  };
}

const HALL_ROOF = TAVERN_SHELL_PARTS.indexOf('HallRoof');
const WING_ROOF = TAVERN_SHELL_PARTS.indexOf('WingRoof');
const TOWER_WALL = TAVERN_SHELL_PARTS.indexOf('TowerWall');
const TOWER_ROOF = TAVERN_SHELL_PARTS.indexOf('TowerRoof');
const BAR_PILLAR = TAVERN_SHELL_PARTS.indexOf('BarPillar');

/**
 * Decide the shell for one frame, writing into `out`. `eye` is the camera's look point over
 * the player, `cam` the camera, both in world coordinates. `indoors`, when given, is the
 * indoor camera clamp's own verdict this frame (interior_camera.ts, from the avatar's eye),
 * so the shell and the clamp never disagree while the lagged look point crosses the doorway;
 * without it the look point decides.
 */
export function tavernShellOcclusion(
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  camX: number,
  camY: number,
  camZ: number,
  out: TavernShellState,
  indoors?: boolean,
): TavernShellState {
  const ax = TAVERN_ORIGIN.z - eyeZ;
  const ay = eyeY - TAVERN_FLOOR_Y;
  const az = eyeX - TAVERN_ORIGIN.x;
  const bx = TAVERN_ORIGIN.z - camZ;
  const by = camY - TAVERN_FLOOR_Y;
  const bz = camX - TAVERN_ORIGIN.x;
  const inside = indoors ?? eyeInTavernAir(ax, ay, az);
  out.inside = inside;
  out.floor = inside ? 0 : OCCLUDER_FADE_ALPHA;
  // a sight line nowhere near the building (the whole road past it) decides in one test
  if (!inside && !segmentHitsVol(ax, ay, az, bx, by, bz, TAVERN_BOUNDS)) {
    for (let i = 0; i < out.occluded.length; i++) out.occluded[i] = false;
    return out;
  }
  if (inside) {
    // the camera stands in the air with the player: the outer shell stays whole, and only the
    // bar's pillar, standing in the air, cuts away for the sight line (or round the lens)
    for (let i = 0; i < out.occluded.length; i++) out.occluded[i] = false;
    out.occluded[BAR_PILLAR] = pillarOnSightLine(ax, ay, az, bx, by, bz);
    return out;
  }
  for (let i = 0; i < TAVERN_SHELL_PARTS.length; i++) {
    const vols = BOX_VOLUMES[TAVERN_SHELL_PARTS[i]];
    let hit = false;
    if (vols) {
      for (let k = 0; k < vols.length && !hit; k++) {
        hit = segmentHitsVol(ax, ay, az, bx, by, bz, vols[k]);
      }
    }
    out.occluded[i] = hit;
  }
  // the shaped parts: sampled along the sight line
  let hallRoof = false;
  let wingRoof = false;
  let towerWall = false;
  let towerRoof = false;
  for (let s = 1; s <= SAMPLES; s++) {
    const t = s / SAMPLES;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    const z = az + (bz - az) * t;
    if (!hallRoof && y >= hallRoofUnderside(x, z)) hallRoof = true;
    if (!wingRoof && y >= wingRoofUnderside(x, z)) wingRoof = true;
    if (!towerRoof && y >= towerRoofUnderside(x, z)) towerRoof = true;
    if (!towerWall && inTowerWall(x, y, z)) towerWall = true;
  }
  out.occluded[HALL_ROOF] = hallRoof;
  out.occluded[WING_ROOF] = wingRoof;
  out.occluded[TOWER_WALL] = towerWall;
  out.occluded[TOWER_ROOF] = towerRoof;
  out.occluded[BAR_PILLAR] = pillarOnSightLine(ax, ay, az, bx, by, bz);
  return out;
}
