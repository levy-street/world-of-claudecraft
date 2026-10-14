// Pure test for "the camera is UNDER THE WORLD" on an authored map: below the
// terrain sheet and not inside a cave tube or carve cavity. Three- and
// DOM-free; underworld.ts is the consumer.

import { DUNGEON_X_THRESHOLD } from '../../sim/data';
import { groundHeight, onUnderSheet } from '../../sim/world';

/** How far under the ground sheet the camera must sit before the void mask. */
export const UNDERWORLD_DEPTH = 3;

/** One ground sample a frame decides it. Never inside an instance (dungeon
 *  floors are their own world). */
export function cameraUnderWorld(x: number, y: number, z: number, seed: number): boolean {
  if (x > DUNGEON_X_THRESHOLD) return false;
  return y < groundHeight(x, z, seed) - UNDERWORLD_DEPTH && !onUnderSheet(x, z, seed, y);
}
