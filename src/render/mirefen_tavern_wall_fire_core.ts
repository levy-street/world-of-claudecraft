// The Mirefen tavern's wall fire, laid out in the fireplace's mouth (tavern local frame: x
// across the hall toward the fireplace's wall, y over the ground floor, z front to back; the
// breast is content TAVERN_PROPS' 'fireplace'). Pure: no three.js, so a Vitest reads it whole.
//
// The model's firebox is a shallow soot panel in the breast's face (TAVERN_WALL_FIRE_MOUTH: a
// few centimetres deep, measured on the shipped GLB), so a fire set back inside the breast
// burns hidden in solid stone: the fire stands in the mouth instead, on the hearthstone, its
// back to the soot. Everything here keeps in front of the panel, inside the opening's width
// and under its lintel (tests/mirefen_tavern_wall_fire_core.test.ts), and the render test
// checks the flames are in view from the room over the real model
// (tests/mirefen_tavern_render.test.ts).

import { TAVERN_PROPS } from '../sim/content/mirefen_tavern';

const fire = TAVERN_PROPS.find((p) => p.kind === 'fireplace');
const FACE = (fire?.x ?? 14.6) - (fire?.hw ?? 0.6);
const MID = fire?.z ?? 2.5;

/** The fireplace's mouth on the model: the breast's face (x), the soot panel just behind it,
 *  the opening's two sides (z), its lintel (y) and the hearthstone's top (y). */
export const TAVERN_WALL_FIRE_MOUTH = {
  face: FACE,
  back: FACE + 0.05,
  z0: MID - 0.95,
  z1: MID + 0.95,
  lintel: 1.85,
  hearth: 0.06,
} as const;

const M = TAVERN_WALL_FIRE_MOUTH;

/** The campfire flame's lathe (props.ts): its widest radius and its height, at scale 1. */
export const TAVERN_FLAME_RADIUS = 0.3;
export const TAVERN_FLAME_HEIGHT = 0.95;
/** The flicker's largest swell of a flame's radius and height (scenery_flame.ts). */
export const TAVERN_FLAME_SWELL = { r: 1.03, h: 1.16 } as const;

/** One flame tongue (local): the base of the flame, its size, and how deep it stands (a
 *  factor on its depth across the mouth: flatter than round, so it hugs the soot). */
export interface TavernWallFlame {
  x: number;
  y: number;
  z: number;
  scale: number;
  depth: number;
}

/** Three tongues over the logs: a tall middle one, two smaller either side. */
export const TAVERN_WALL_FIRE_FLAMES: readonly TavernWallFlame[] = [
  { x: M.back - 0.27, y: 0.1, z: MID, scale: 1.2, depth: 0.7 },
  { x: M.back - 0.22, y: 0.1, z: MID - 0.5, scale: 0.85, depth: 0.7 },
  { x: M.back - 0.23, y: 0.1, z: MID + 0.47, scale: 0.95, depth: 0.7 },
];

/** One log (local): its middle, its radius and length, and its lie (yaw about y from the z
 *  axis, then pitch up out of the hearth). */
export interface TavernWallFireLog {
  x: number;
  y: number;
  z: number;
  r: number;
  length: number;
  yaw: number;
  pitch: number;
}

/** The logs: a back log against the soot, a fore log across the front, and two split logs
 *  leant over them into the fire. */
export const TAVERN_WALL_FIRE_LOGS: readonly TavernWallFireLog[] = [
  { x: M.back - 0.15, y: M.hearth + 0.11, z: MID, r: 0.11, length: 1.55, yaw: 0, pitch: 0 },
  { x: M.back - 0.5, y: M.hearth + 0.1, z: MID - 0.05, r: 0.1, length: 1.3, yaw: 0.1, pitch: 0 },
  {
    x: M.back - 0.33,
    y: M.hearth + 0.24,
    z: MID - 0.3,
    r: 0.085,
    length: 0.95,
    yaw: -0.5,
    pitch: 0.3,
  },
  {
    x: M.back - 0.32,
    y: M.hearth + 0.23,
    z: MID + 0.32,
    r: 0.08,
    length: 0.9,
    yaw: 0.55,
    pitch: -0.28,
  },
];

/** The bed of embers under the logs: its footprint on the hearthstone and its crown. */
export const TAVERN_WALL_FIRE_EMBERS = {
  x0: M.back - 0.64,
  x1: M.back - 0.02,
  z0: MID - 0.78,
  z1: MID + 0.78,
  y: M.hearth,
  crown: 0.09,
} as const;

/** The firelight on the soot (a glow just proud of the panel) and on the hearthstone and the
 *  boards before it (a glow lying over them): middles and sizes, local. */
export const TAVERN_WALL_FIRE_GLOW = {
  back: { x: M.back - 0.02, y: 0.8, z: MID, width: 1.9, height: 1.6 },
  floor: { x: M.face - 0.75, y: M.hearth + 0.012, z: MID, width: 2.6, depth: 2.2 },
} as const;

/** The wall fire's point light (local): in the mouth, low over the logs. */
export const TAVERN_WALL_FIRE_LIGHT = { x: M.face - 0.7, y: 0.9, z: MID } as const;

/** The glows' flicker at clock `t` (seconds): around 1, never out, never past 1.2. Still (1)
 *  under reduced motion. */
export function tavernWallFireFlicker(t: number, reducedMotion = false): number {
  if (reducedMotion) return 1;
  return (
    0.95 + 0.1 * Math.sin(t * 8.3) + 0.06 * Math.sin(t * 21.7 + 1.3) + 0.04 * Math.sin(t * 3.1)
  );
}
