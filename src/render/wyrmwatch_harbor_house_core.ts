// The Harbormaster's House camera cutaway, the pure decision (the painter is
// wyrmwatch_harbor_house.ts): which of the house's five shell parts (its four walls and its
// roof) stand between the camera and the player this frame, and how far each one fades.
// Three-, DOM- and i18n-free.
//
// The chase camera never changes its distance for scene geometry (the pinned rule of
// tests/graphics_overhaul_integration.test.ts): obstruction is opacity only. So a walk-in
// room, whose walls would otherwise fill the frame with their backs, takes the dungeon
// shells' idiom (dungeon_wall_occlusion.ts):
//  - player INSIDE the house (the eye over its floor): the cutaway. A wall whose inner face
//    the camera stands beyond is cut away outright (alpha 0), the roof too whenever the
//    camera's sight line to the player passes through it, so the room reads like a
//    dollhouse from any orbit, and from a camera zoomed in inside the room, nothing is cut
//    and the rafters close overhead.
//  - player OUTSIDE: the classic sightline ghost. When the sight line crosses the house's
//    footprint under its ridge, the whole shell ghosts to the standard 20% (occluder_fade_core),
//    so a player on the quay behind the house is never hidden by it.
// The frame, the floor and the furniture never fade: only the shell does.

import {
  HARBOR_HOUSE,
  HARBOR_HOUSE_FLOOR_ABOVE_WATER,
  HARBOR_HOUSE_INTERIOR,
} from '../sim/content/wyrmwatch_harbor_house';
import { OCCLUDER_FADE_ALPHA, occluderSegmentHitsObb } from './occluder_fade_core';

/** The shell parts of the model, in the order the painter keeps them. */
export const HOUSE_SHELL_PARTS = [
  'HouseWallNorth',
  'HouseWallSouth',
  'HouseWallEast',
  'HouseWallWest',
  'HouseRoof',
] as const;
export type HouseShellPart = (typeof HOUSE_SHELL_PARTS)[number];

/** The eye (the camera's look point) stands this high over the player's feet (renderer.ts
 *  eyeY = pivot + 2). */
export const HOUSE_EYE_OVER_FEET = 2.0;
/** The roof's underside stands this far under its shingled surface (the sarking and the
 *  rafters, build_harbor_house.py). */
export const HOUSE_ROOF_UNDERSIDE = 0.45;
/** Samples along the sight line for the roof test. */
const ROOF_SAMPLES = 16;
/** A camera this close behind a wall's inner face already sees its back. */
const WALL_MARGIN = 0.05;

/** This frame's decision: the mode, and per shell part (HOUSE_SHELL_PARTS order) whether
 *  it occludes. A caller keeps one and passes it back in (no per-frame allocation). */
export interface HouseShellState {
  inside: boolean;
  occluded: boolean[];
  /** The alpha an occluding part settles at: 0 inside (cut away), the ghost outside. */
  floor: number;
}

export function newHouseShellState(): HouseShellState {
  return {
    inside: false,
    occluded: HOUSE_SHELL_PARTS.map(() => false),
    floor: OCCLUDER_FADE_ALPHA,
  };
}

/** The house's world frame for a waterline height (houseShellOcclusion keeps the last one:
 *  the waterline never moves under the house, so nothing is allocated per frame). */
export function houseFrame(waterLevel: number) {
  const floorY = waterLevel + HARBOR_HOUSE_FLOOR_ABOVE_WATER;
  const plate = floorY + HARBOR_HOUSE.wallTop + HARBOR_HOUSE.roof.plateLift;
  const atRidge = floorY + HARBOR_HOUSE.ridge - HARBOR_HOUSE.roof.ridgeDrop;
  return {
    floorY,
    ridgeY: floorY + HARBOR_HOUSE.ridge,
    /** Roof surface height falls this much per yard away from the ridge line. */
    slope: (atRidge - plate) / HARBOR_HOUSE.hd,
    atRidge,
  };
}

/** Whether a player's eye stands in the house: over its footprint (the doorway included),
 *  no lower than a body standing on the floor. */
export function eyeInHouse(eyeX: number, eyeY: number, eyeZ: number, floorY: number): boolean {
  const h = HARBOR_HOUSE;
  if (Math.abs(eyeX - h.x) > h.hw || Math.abs(eyeZ - h.z) > h.hd) return false;
  const feet = eyeY - HOUSE_EYE_OVER_FEET;
  return feet >= floorY - 0.5 && feet <= floorY + h.wallTop;
}

/** Whether the sight line from the eye to the camera passes through the roof: any sample
 *  over the roof's footprint (its overhangs included) at or above its underside. */
export function sightCrossesRoof(
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  camX: number,
  camY: number,
  camZ: number,
  frame: ReturnType<typeof houseFrame>,
): boolean {
  const h = HARBOR_HOUSE;
  const x0 = h.x - h.hw - h.roof.vergeOut;
  const x1 = h.x + h.hw + h.roof.vergeOut;
  const z0 = h.z - h.hd - h.roof.eaveOut;
  const z1 = h.z + h.hd + h.roof.eaveOut;
  for (let i = 1; i <= ROOF_SAMPLES; i++) {
    const t = i / ROOF_SAMPLES;
    const x = eyeX + (camX - eyeX) * t;
    const y = eyeY + (camY - eyeY) * t;
    const z = eyeZ + (camZ - eyeZ) * t;
    if (x < x0 || x > x1 || z < z0 || z > z1) continue;
    // the underside: the sarking and the rafters under the shingled surface
    const under = frame.atRidge - Math.abs(z - h.z) * frame.slope - HOUSE_ROOF_UNDERSIDE;
    if (y >= under) return true;
  }
  return false;
}

let cachedFrame: ReturnType<typeof houseFrame> | null = null;
let cachedWater = Number.NaN;

/**
 * Decide the shell for one frame, writing into `out`. `eye` is the camera's look point
 * over the player, `cam` the camera.
 */
export function houseShellOcclusion(
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  camX: number,
  camY: number,
  camZ: number,
  waterLevel: number,
  out: HouseShellState,
): HouseShellState {
  if (cachedFrame === null || cachedWater !== waterLevel) {
    cachedFrame = houseFrame(waterLevel);
    cachedWater = waterLevel;
  }
  const frame = cachedFrame;
  const h = HARBOR_HOUSE;
  const inside = eyeInHouse(eyeX, eyeY, eyeZ, frame.floorY);
  out.inside = inside;
  if (inside) {
    const i = HARBOR_HOUSE_INTERIOR;
    out.floor = 0;
    out.occluded[0] = camZ < i.z0 + WALL_MARGIN; // north
    out.occluded[1] = camZ > i.z1 - WALL_MARGIN; // south (the door wall)
    out.occluded[2] = camX > i.x1 - WALL_MARGIN; // east (the sea)
    out.occluded[3] = camX < i.x0 + WALL_MARGIN; // west (the land)
    out.occluded[4] = sightCrossesRoof(eyeX, eyeY, eyeZ, camX, camY, camZ, frame);
    return out;
  }
  out.floor = OCCLUDER_FADE_ALPHA;
  const hit = occluderSegmentHitsObb(
    h.x,
    h.z,
    h.hw,
    h.hd,
    0,
    frame.ridgeY,
    eyeX,
    eyeY,
    eyeZ,
    camX,
    camY,
    camZ,
  );
  for (let k = 0; k < out.occluded.length; k++) out.occluded[k] = hit;
  return out;
}
