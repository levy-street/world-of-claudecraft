// Stateless private draws for Fire and Fly (the camp_private_rng pattern): each
// draw builds an Rng from a hash of the session seed, a stream and the draw
// site's own keys, so the session stays plain data and never touches the world
// stream.

import { Rng } from '../rng';

export const TURRET_STREAM = {
  spawnAngle: 1,
  spawnGap: 2,
  throwDeviation: 3,
  barrelBearing: 4,
  barrelRadius: 5,
  barrelThrow: 6,
} as const;

function mixAll(values: readonly number[]): number {
  let h = 0x811c9dc5;
  for (const n of values) {
    h = (h ^ (n >>> 0)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Session seed from stable inputs, so a replay of the same session draws the same values. */
export function turretSessionSeed(worldSeed: number, ownerId: number, startTick: number): number {
  return mixAll([worldSeed, ownerId, startTick, 0x7475]);
}

/** One uniform value in [0, 1) for a draw site. */
export function turretDraw(seed: number, stream: number, a: number, b = 0): number {
  return new Rng(mixAll([seed, stream, a, b])).next();
}
