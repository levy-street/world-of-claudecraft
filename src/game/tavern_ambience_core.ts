// The Mirefen tavern's ambience bed (amb_tavern: talk, mugs, the hearth and a little music),
// decided from where the player stands (the avatar's eye, never the camera, which trails the
// player and can sit in the doorway while they stand in the hall): clear and full inside the
// common room and the tower's nook, muffled outside: loudest in front of the open door and
// fading out over TAVERN_AMBIENCE_RADIUS yards from it, a low murmur through the walls close
// round the rest. src/game/sfx.ts plays the bed as a non-positional stereo loop through a
// lowpass and hands this core that eye each frame.
//
// Pure and allocation-free: the caller owns the result object. The geometry is the tavern's
// own (src/sim/content/mirefen_tavern.ts, local frame: local (lx, lz) is world
// (ORIGIN.x + lz, ORIGIN.z - lx), the door in the front wall at local z = TAVERN_HALL.z1).
//
// Continuity: the listener only passes between inside and outside through the doorway, and
// across it the mix blends over TAVERN_AMBIENCE_BLEND yards from the door's inner mouth: at
// the mouth the inside mix IS the outside mix at that point, so walking (or the camera
// following) in and out never steps the level or the tone.

import {
  TAVERN_DOOR,
  TAVERN_FLOOR_Y,
  TAVERN_HALL,
  TAVERN_ORIGIN,
  TAVERN_TOWER,
  TAVERN_WING,
} from '../sim/content/mirefen_tavern';

/** The bed's loop gain inside (before the clip's manifest gain). */
export const TAVERN_AMBIENCE_INSIDE_GAIN = 0.34;
/** Just outside the open door, in front of it. */
export const TAVERN_AMBIENCE_DOOR_GAIN = 0.12;
/** Close outside a wall (beside or behind the building), through the timber and plaster. */
export const TAVERN_AMBIENCE_WALL_GAIN = 0.045;
/** Through the walls the murmur is gone this many yards from the building. */
export const TAVERN_AMBIENCE_WALL_RADIUS = 16;
/** Out of the door the level holds full over this many yards from it, then fades... */
export const TAVERN_AMBIENCE_NEAR = 4;
/** ...to silence at this many yards from the door. */
export const TAVERN_AMBIENCE_RADIUS = 30;
/** The lowpass inside: the room itself, clear. */
export const TAVERN_AMBIENCE_CLEAR_HZ = 7200;
/** Outside in front of the door (the talk spilling out of it). */
export const TAVERN_AMBIENCE_DOOR_HZ = 1400;
/** Outside through a wall: the murmur and the bass of the music only. */
export const TAVERN_AMBIENCE_WALL_HZ = 650;
/** How far past the door's inner mouth the mix blends from outside to inside. */
export const TAVERN_AMBIENCE_BLEND = 2.5;
/** Below this the bed is silent (the caller stops the loop). */
export const TAVERN_AMBIENCE_SILENT = 1e-3;

export interface TavernAmbienceMix {
  gain: number;
  cutoffHz: number;
}

export function newTavernAmbienceMix(): TavernAmbienceMix {
  return { gain: 0, cutoffHz: TAVERN_AMBIENCE_WALL_HZ };
}

const H = TAVERN_HALL;
const T = TAVERN_TOWER;
const IX0 = H.x0 + H.wall;
const IX1 = H.x1 - H.wall;
const IZ0 = H.z0 + H.wall;
const IZ1 = H.z1 - H.wall;
const DOOR_X0 = TAVERN_DOOR.x - TAVERN_DOOR.width / 2;
const DOOR_X1 = TAVERN_DOOR.x + TAVERN_DOOR.width / 2;
/** The door's middle at head height of a standing body (local y over the ground floor). */
const DOOR_Y = TAVERN_DOOR.height / 2;
/** How far back from the doorway's inner mouth (along the walls, outside) the door still
 *  counts as in front of the listener. */
const FRONT_BACK = 2.5;
/** The building's plan (the hall, the wing behind it and the tower in the corner). */
const PLAN_X0 = Math.min(H.x0, T.x - T.rOut);
const PLAN_X1 = Math.max(H.x1, TAVERN_WING.x1);
const PLAN_Z0 = Math.min(TAVERN_WING.z0, T.z - T.rOut);

function smoothstep(e0: number, e1: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Whether a local point stands in the tavern's rooms (the hall inside its walls, the nook). */
function insideRooms(lx: number, lz: number): boolean {
  if (lx > IX0 && lx < IX1 && lz > IZ0 && lz < IZ1) return true;
  return lz < H.z0 && Math.hypot(lx - T.x, lz - T.z) < T.rIn;
}

/** The outside mix at a local point, written into `out`. */
function outsideMix(lx: number, ly: number, lz: number, out: TavernAmbienceMix): void {
  // through the walls: a low murmur close round the building (the hall, the wing and the
  // tower all stand inside one plan rectangle), gone a few strides away
  const bx = Math.max(PLAN_X0 - lx, 0, lx - PLAN_X1);
  const bz = Math.max(PLAN_Z0 - lz, 0, lz - H.z1);
  const wall =
    TAVERN_AMBIENCE_WALL_GAIN *
    (1 - smoothstep(3, TAVERN_AMBIENCE_WALL_RADIUS, Math.hypot(bx, bz)));
  // out of the open door: the talk spilling out of it, whole from the doorway's inner mouth
  // outward, gone a few yards back along the walls or off to either side, fading with the
  // distance from the doorway's outer mouth
  const dx = lx < DOOR_X0 ? DOOR_X0 - lx : lx > DOOR_X1 ? lx - DOOR_X1 : 0;
  const d = Math.hypot(dx, ly - DOOR_Y, lz - H.z1);
  const front = smoothstep(-FRONT_BACK, 0, lz - IZ1) * (1 - smoothstep(4, 18, dx));
  const door =
    (TAVERN_AMBIENCE_DOOR_GAIN - TAVERN_AMBIENCE_WALL_GAIN) *
    front *
    (1 - smoothstep(TAVERN_AMBIENCE_NEAR, TAVERN_AMBIENCE_RADIUS, d));
  out.gain = wall + door;
  // the tone follows the door's share of what is heard (a lowpass's cutoff is heard as a
  // ratio, so it blends in the log domain)
  const share = door / (TAVERN_AMBIENCE_DOOR_GAIN - TAVERN_AMBIENCE_WALL_GAIN);
  out.cutoffHz =
    TAVERN_AMBIENCE_WALL_HZ * (TAVERN_AMBIENCE_DOOR_HZ / TAVERN_AMBIENCE_WALL_HZ) ** share;
}

/**
 * The bed's gain and lowpass cutoff for a listener at world (x, y, z), written into `out`
 * (returned). Silent (gain 0) beyond TAVERN_AMBIENCE_RADIUS yards from the door and
 * TAVERN_AMBIENCE_WALL_RADIUS yards from the walls.
 */
export function tavernAmbienceMix(
  x: number,
  y: number,
  z: number,
  out: TavernAmbienceMix,
): TavernAmbienceMix {
  const lx = TAVERN_ORIGIN.z - z;
  const ly = y - TAVERN_FLOOR_Y;
  const lz = x - TAVERN_ORIGIN.x;
  outsideMix(lx, ly, lz, out);
  if (!insideRooms(lx, lz)) return out;
  // inside: blend from the doorway's inner mouth into the room
  const dx = lx < DOOR_X0 ? DOOR_X0 - lx : lx > DOOR_X1 ? lx - DOOR_X1 : 0;
  const w = smoothstep(0, TAVERN_AMBIENCE_BLEND, Math.hypot(dx, IZ1 - lz));
  out.gain += (TAVERN_AMBIENCE_INSIDE_GAIN - out.gain) * w;
  out.cutoffHz *= (TAVERN_AMBIENCE_CLEAR_HZ / out.cutoffHz) ** w;
  return out;
}
