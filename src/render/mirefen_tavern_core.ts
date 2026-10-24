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
//    wall is three parts (either side of the door, and the door's bay with the cross gable
//    over it) and the porch's awning and sign a fourth, and the doorway itself is open, so a
//    sight line in through the door ghosts nothing and one at an angle ghosts only the piece
//    of wall it crosses: the building never opens as a cutaway.
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
/** High and up: tankards, bread boards, jugs, the table candles, dice, firewood, straw, the
 *  stable's tack. */
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
export type Vol = readonly [number, number, number, number, number, number];

const H = TAVERN_HALL;
const W = TAVERN_WING;
const T = TAVERN_TOWER;

// ---- the hall roof (scripts/assets/mirefen_tavern/build_tavern.py ROOF_*, inn_roof.py): its
// ridge along the hall (x) midway between the jettied front's face and the back wall, its eaves
// over those two walls, its gables on the side walls, and a cross gable over the door
/** The front eave wall: the jettied upper storey's face. */
const ROOF_FRONT = H.z1 + TAVERN_JETTY.out;
const RIDGE_Z = (ROOF_FRONT + H.z0) / 2;
const ROOF_HALF = (ROOF_FRONT - H.z0) / 2;
/** The slates over the eave walls (their plates under them, at TAVERN_HALL.eave). */
const ROOF_EAVE = H.eave + 0.3;
const ROOF_EDGE = ROOF_HALF + H.eaveOut;
const ROOF_VERGE = H.x1 + H.vergeOut;
/** The bell-cast: its pitch at the eave walls over its mean pitch (build_tavern.py ROOF_BELL). */
const HALL_BELL = 0.72;
/** The roof's settling (inn_roof.py SAG, DROOP, KICK_UP): the ridge sagged at its middle, the
 *  eaves drooping between the gables and kicked up at the corners. */
const HALL_SAG = 0.7;
const HALL_DROOP = 0.3;
const HALL_KICK_UP = 0.3;
/** Slates over sarking over rafters (build_tavern.py ROOF_THICK), thinning out over the eaves. */
const HALL_THICK = 0.75;
/** The slates' hand-laid wobble (inn_roof.py's noise), taken off every underside: the roofs read
 *  a little low, so they ghost early, never late. */
const ROOF_WOBBLE = 0.12;
/** The cross gable over the door (inn_roof.py CROSS_*): its half width at its walls, its eaves'
 *  reach, its ridge, its front verge. */
const CROSS_HALF = 6.5;
const CROSS_EDGE = 7.25;
const CROSS_RIDGE = 17.7;
const CROSS_VERGE = ROOF_FRONT + 1.3;
/** The back eaves stop at the back wall from here on to the right verge, where the tower's hat
 *  and the wing's roof take over (inn_roof.py BACK_CUT). */
const BACK_CUT = -8.5;
/** How far the hammer beams reach in off the front and the back walls, and their undersides
 *  (inn_interior.py trusses). */
const HAMMER_REACH = 3.5;
const HAMMER_UNDER = 9.05;

const fire = TAVERN_PROPS.find((p) => p.kind === 'fireplace');
const FIRE_Z = fire?.z ?? 0;
/** The wall fire's chimney up the outside of the right gable (inn_hall.py _chimney_stack): its
 *  breast's half width along the gable, its reach out of it, its pots' tops. */
const CHIMNEY_HALF = 2.45;
const CHIMNEY_REACH = 2.3;
const CHIMNEY_TOP = 21.75;
/** The front wall's three parts meet this far either side of the door's middle: the door's
 *  posts go with the cross gable over it (build_tavern.py FRONT_SPLIT). */
export const TAVERN_FRONT_SPLIT = 3.2;
const D0 = TAVERN_DOOR.x - TAVERN_DOOR.width / 2;
const D1 = TAVERN_DOOR.x + TAVERN_DOOR.width / 2;
/** The doorway's arch springs here and rises to the door's height at its crown (inn_hall.py). */
const DOOR_SPRING = 4.2;
/** The front's wall line: a hand inside its inner face out to its face (over the door's head),
 *  and either side out over the battered foot of its stone. */
const FRONT = [H.z1 - H.wall - 0.1, H.z1 + 0.2] as const;
const FRONT_FOOT = H.z1 + 0.85;
/** The jettied upper storey stands out over the ground floor from under its bressumer up to the
 *  eaves (inn_hall.py): over the door its face and its chevron, either side its window boxes and
 *  shutters standing out from it; and over the door the cross gable jetties out again from its
 *  base (inn_hall.py cross_base) with its rose. */
const JETTY_Y = TAVERN_JETTY.y - 0.4;
const JETTY_Z = ROOF_FRONT + 0.35;
const WINDOWS_Z = ROOF_FRONT + 0.75;
const CROSS_BASE = ROOF_EAVE - 0.9;
/** The eave walls' plates and the inner faces' last course, up in the roof's slab over them. */
const EAVE_TOP = ROOF_EAVE + 0.6;
/** Every wall's stone runs on down under the ground floor into the falling ground (its plinth). */
const PLINTH = -4.5;
/** The gable ends' faces jetty out, their casements' shutters out from them. */
const GABLE_OUT = 1.3;

/** Each box-shaped shell part's volumes (the roofs, the tower and the pillar are shaped,
 *  below). The doorway is open: a sight line through it crosses no part of the front. */
const BOX_VOLUMES: Partial<Record<TavernShellPart, readonly Vol[]>> = {
  // the door's bay up to the cross gable's rake, the door's posts either side of it, the arch's
  // haunches down either side of its crown and the threshold (the doorway's middle stays open)
  HallWallFront: [
    [-TAVERN_FRONT_SPLIT, TAVERN_FRONT_SPLIT, TAVERN_DOOR.height, CROSS_RIDGE, FRONT[0], FRONT[1]],
    [-TAVERN_FRONT_SPLIT, TAVERN_FRONT_SPLIT, JETTY_Y, CROSS_RIDGE, FRONT[0], JETTY_Z],
    [-TAVERN_FRONT_SPLIT, TAVERN_FRONT_SPLIT, CROSS_BASE, CROSS_RIDGE, FRONT[0], WINDOWS_Z],
    [-TAVERN_FRONT_SPLIT, D0, PLINTH, TAVERN_DOOR.height, FRONT[0], FRONT[1]],
    [D1, TAVERN_FRONT_SPLIT, PLINTH, TAVERN_DOOR.height, FRONT[0], FRONT[1]],
    [D0, D0 + 1.1, DOOR_SPRING, TAVERN_DOOR.height, FRONT[0], FRONT[1]],
    [D1 - 1.1, D1, DOOR_SPRING, TAVERN_DOOR.height, FRONT[0], FRONT[1]],
    [D0, D1, PLINTH, 0.15, FRONT[0], FRONT[1]],
  ],
  // either side: the front up under the eaves, and the cross gable's half over the door's bay
  HallWallFrontLeft: [
    [H.x0 - 0.45, -TAVERN_FRONT_SPLIT, PLINTH, EAVE_TOP, FRONT[0], FRONT_FOOT],
    [H.x0 - 0.45, -TAVERN_FRONT_SPLIT, JETTY_Y, EAVE_TOP, FRONT[0], WINDOWS_Z],
    [-CROSS_HALF - 0.3, -TAVERN_DOOR.width / 2, JETTY_Y, 14.4, FRONT[0], WINDOWS_Z],
  ],
  HallWallFrontRight: [
    [TAVERN_FRONT_SPLIT, H.x1 + 0.45, PLINTH, EAVE_TOP, FRONT[0], FRONT_FOOT],
    [TAVERN_FRONT_SPLIT, H.x1 + 0.45, JETTY_Y, EAVE_TOP, FRONT[0], WINDOWS_Z],
    [TAVERN_DOOR.width / 2, CROSS_HALF + 0.3, JETTY_Y, 14.4, FRONT[0], WINDOWS_Z],
  ],
  // the porch's awning (its canvas and valance over a body walking in), its two posts on the
  // parapets' ends, and the tankard on its arm under the eaves
  HallPorch: [
    [
      TAVERN_PORCH.x0 - 0.7,
      TAVERN_PORCH.x1 + 0.7,
      4.55,
      5.5,
      ROOF_FRONT - 0.1,
      TAVERN_PORCH.z1 + 0.2,
    ],
    [
      TAVERN_PORCH.x0 - 0.25,
      TAVERN_PORCH.x0 + 0.25,
      0.9,
      5.1,
      TAVERN_PORCH.z1 - 0.5,
      TAVERN_PORCH.z1,
    ],
    [
      TAVERN_PORCH.x1 - 0.25,
      TAVERN_PORCH.x1 + 0.25,
      0.9,
      5.1,
      TAVERN_PORCH.z1 - 0.5,
      TAVERN_PORCH.z1,
    ],
    [8.1, 11.4, 4.7, 8.75, ROOF_FRONT - 0.1, ROOF_FRONT + 4.2],
  ],
  HallWallBack: [[H.x0 - 0.45, H.x1 + 0.45, PLINTH, EAVE_TOP, H.z0 - 0.8, H.z0 + H.wall + 0.1]],
  // the gable ends up under the verges; the loft door's hay hoist out of the left one, its sack
  // swinging under it
  HallWallLeft: [
    [H.x0 - GABLE_OUT, H.x0 + H.wall + 0.1, PLINTH, H.ridge + 0.1, H.z0, ROOF_FRONT + 0.2],
    [H.x0 - 3.2, H.x0, 12.9, 19.2, RIDGE_Z - 1.15, RIDGE_Z + 1.15],
  ],
  // the right one, and the wall fire's chimney up it through the verge
  HallWallRight: [
    [H.x1 - H.wall - 0.1, H.x1 + GABLE_OUT, PLINTH, H.ridge + 0.1, H.z0, ROOF_FRONT + 0.2],
    [H.x1, H.x1 + CHIMNEY_REACH, PLINTH, CHIMNEY_TOP, FIRE_Z - CHIMNEY_HALF, FIRE_Z + CHIMNEY_HALF],
  ],
  WingWallEast: [[W.x1 - W.wall - 0.1, W.x1 + 0.5, PLINTH, W.eave + 0.2, W.z0, W.z1]],
  WingWallBack: [[W.x0 - 0.3, W.x1 + 0.3, PLINTH, W.ridge, W.z0 - 0.9, W.z0 + W.wall]],
  WingWallWest: [[W.x0 - 0.5, W.x0 + W.wall + 0.1, PLINTH, W.eave + 0.2, W.z0, W.z1]],
};

/** A box-shaped shell part's fade volumes (local), or undefined for a shaped one (the roofs, the
 *  tower's ring, the bar's pillar). */
export function tavernShellVolumes(part: TavernShellPart): readonly Vol[] | undefined {
  return BOX_VOLUMES[part];
}

/** Everything the shell draws (local): the hall and its porch, sign, chimney and hay hoist, the
 *  wing, the tower's hat. */
const TAVERN_BOUNDS: Vol = [
  H.x0 - 3.4,
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

function hallRoofLine(d: number): number {
  const rise = H.ridge - ROOF_EAVE;
  if (d <= ROOF_HALF) {
    const t = (ROOF_HALF - d) / ROOF_HALF;
    return ROOF_EAVE + rise * (HALL_BELL * t + (1 - HALL_BELL) * t * t);
  }
  return ROOF_EAVE - (rise / ROOF_HALF) * HALL_BELL * (d - ROOF_HALF);
}

/** The hall roof's slates over a local point (inn_roof.py Roof.height, short of its wobble). */
function hallRoofTop(x: number, z: number): number {
  const d = Math.abs(z - RIDGE_Z);
  const s = Math.max(0, 1 - (x / ROOF_VERGE) ** 2);
  const out = Math.min(1.2, d / ROOF_EDGE);
  return (
    hallRoofLine(d) -
    HALL_SAG * s * Math.max(0, 1 - out) ** 0.8 -
    HALL_DROOP * s * out ** 3 +
    HALL_KICK_UP * (1 - s) ** 2 * out ** 4
  );
}

function hallRoofThick(d: number): number {
  if (d <= ROOF_HALF) return HALL_THICK;
  return HALL_THICK + (0.3 - HALL_THICK) * Math.min(1, (d - ROOF_HALF) / (ROOF_EDGE - ROOF_HALF));
}

/** The cross gable's slates |x| out from its ridge (inn_roof.py Roof.cross_top, short of its
 *  sag). */
function crossRoofTop(ax: number): number {
  const rise = CROSS_RIDGE - ROOF_EAVE;
  if (ax <= CROSS_HALF) {
    const t = (CROSS_HALF - ax) / CROSS_HALF;
    return ROOF_EAVE + rise * (HALL_BELL * t + (1 - HALL_BELL) * t * t);
  }
  return ROOF_EAVE - (rise / CROSS_HALF) * HALL_BELL * (ax - CROSS_HALF);
}

/** The hall roof's underside over a local point: its sarking, and along the front and the back
 *  walls inside the hall the hammer beams under it (the lowest timber of it); +Infinity where it
 *  has none (off its footprint, over the door's bay out front where the cross gable's own roof
 *  takes over, and behind the back wall from the tower on). */
export function hallRoofUnderside(x: number, z: number): number {
  const d = Math.abs(z - RIDGE_Z);
  if (Math.abs(x) > ROOF_VERGE || d > ROOF_EDGE) return Infinity;
  // (in the door's bay the main slab stops in the jettied storey's wall, under the cross loft)
  if (z > H.z1 + 0.6 && Math.abs(x) < CROSS_HALF) return Infinity;
  if (z < H.z0 && x > BACK_CUT) return Infinity;
  const under = hallRoofTop(x, z) - hallRoofThick(d) - ROOF_WOBBLE;
  const inHall = Math.abs(x) <= H.x1 - H.wall && z >= H.z0 + H.wall && z <= H.z1 - H.wall;
  const byWall = z <= H.z0 + H.wall + HAMMER_REACH || z >= H.z1 - H.wall - HAMMER_REACH;
  return inHall && byWall ? Math.min(under, HAMMER_UNDER) : under;
}

/** Whether a local point stands in (or over) the hall roof: over its underside, except under the
 *  cross gable, whose loft between the main roof's slates and its own slopes is open air. */
export function inHallRoof(x: number, y: number, z: number): boolean {
  const ax = Math.abs(x);
  if (ax <= CROSS_EDGE && z >= RIDGE_Z && z <= CROSS_VERGE) {
    const cross = crossRoofTop(ax);
    const cut = z > H.z1 + 0.6 && ax < CROSS_HALF;
    const main = cut ? Number.NEGATIVE_INFINITY : hallRoofTop(x, z);
    if (cross > main) {
      if (y >= cross - (ax <= CROSS_HALF ? 0.55 : 0.26) - ROOF_WOBBLE) return true;
      return y >= hallRoofUnderside(x, z) && y <= main + ROOF_WOBBLE;
    }
  }
  return y >= hallRoofUnderside(x, z);
}

const WING_MID = (W.x0 + W.x1) / 2;
const WING_HALF = (W.x1 - W.x0) / 2;
const WING_PITCH = (W.ridge - W.eave) / WING_HALF;

/** The wing roof's slates d out from its ridge line (inn_wing.py Wing.top, short of its sag). */
function wingRoofTop(d: number): number {
  return d <= WING_HALF ? W.ridge - WING_PITCH * d : W.eave - 0.36 * (d - WING_HALF);
}

/** The wing roof's underside (over the wing, its tie beams at the eaves), or +Infinity off it.
 *  At the hall it runs on up over the hall roof's back slope, as far as the valleys where it
 *  meets those slates. */
export function wingRoofUnderside(x: number, z: number): number {
  const d = Math.abs(x - WING_MID);
  // The kitchen meets only the hall's rear slope; the falling front slope
  // must not create a second, disconnected wing-roof region.
  if (d > WING_HALF + W.eaveOut || z < W.z0 - W.vergeOut || z > RIDGE_Z) return Infinity;
  const top = wingRoofTop(d);
  if (z > W.z1) {
    const hall = hallRoofTop(x, z);
    if (top <= hall) return Infinity;
    return Math.max(top - 0.75, hall - ROOF_WOBBLE);
  }
  return Math.min(top - (d <= WING_HALF ? 0.5 : 0.22) - 0.25, W.eave - 0.4);
}

/** The tower's hat (inn_tower.py Tower.prof): its slates' height at each radius off its axis,
 *  from its kicked-out eaves up to its tip. */
const TOWER_HAT: readonly (readonly [number, number])[] = [
  [T.rOut + T.eaveOut + 0.15, T.wallTop - 0.35],
  [7.0, T.wallTop + 0.35],
  [6.0, 12.6],
  [4.8, 14.15],
  [3.6, 15.85],
  [2.45, 17.7],
  [1.35, 19.6],
  [0.55, 21.1],
  [0.06, T.peak],
];
const TOWER_EAVE_R = TOWER_HAT[0][0];
/** How far the hat's tip leans off the drum's axis (inn_tower.py LEAN). */
const TOWER_LEAN_X = 0.85;
const TOWER_LEAN_Z = -0.55;

function towerHat(r: number): number {
  if (r >= TOWER_HAT[0][0]) return TOWER_HAT[0][1];
  // (indexed reads: the camera's cutaway samples this every frame, so no tuple destructuring)
  for (let i = 1; i < TOWER_HAT.length; i++) {
    const r1 = TOWER_HAT[i][0];
    if (r >= r1) {
      const r0 = TOWER_HAT[i - 1][0];
      const y0 = TOWER_HAT[i - 1][1];
      return y0 + ((TOWER_HAT[i][1] - y0) * (r0 - r)) / (r0 - r1);
    }
  }
  return T.peak;
}

/** The tower hat's underside, or +Infinity off it. Over the hall it rises out of the hall roof's
 *  back slope (nothing of it dips under those slates), and inside it the plaster gable over the
 *  hall's back wall closes it off from the hall roof (inn_tower.py _seal), from the back wall's
 *  plate up. */
export function towerRoofUnderside(x: number, z: number): number {
  const r0 = Math.hypot(x - T.x, z - T.z);
  if (r0 > TOWER_EAVE_R + 0.3) return Infinity;
  const lean = Math.max(0, 1 - r0 / TOWER_EAVE_R) ** 2.5;
  const r = Math.hypot(x - T.x - TOWER_LEAN_X * lean, z - T.z - TOWER_LEAN_Z * lean);
  let under = towerHat(r) - 0.42 - 0.3;
  if (z > H.z0) under = Math.max(under, hallRoofTop(x, z) - 0.31 - ROOF_WOBBLE);
  if (z <= H.z0 && z >= H.z0 - 0.3 && r0 <= T.rOut) under = Math.min(under, H.eave - 0.6);
  return under;
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

/** The tower's drum climbs up into its hat (inn_tower.py drum_top): its top at the inner face. */
const TOWER_DRUM_TOP = towerHat(T.rIn) - 0.42 + 0.2;

/** Whether a local point stands in the tower's wall ring (open under the arch to the hall). */
export function inTowerWall(x: number, y: number, z: number): boolean {
  if (y < 0 || y > TOWER_DRUM_TOP) return false;
  const dx = x - T.x;
  const dz = z - T.z;
  const r = Math.hypot(dx, dz);
  if (r < T.rIn - 0.15 || r > T.rOut + 0.55) return false;
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
    if (!hallRoof && inHallRoof(x, y, z)) hallRoof = true;
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
