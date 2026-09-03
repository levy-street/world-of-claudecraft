// Soulfire: the pool a Soul Rend mark leaves where it detonated.
//
// Every marked raider's position at detonation becomes a Soulfire pool (red
// fire) that burns for NYTHRAXIS_SOULFIRE_SECONDS, so the stack point has to
// move every cast and a careless raid fills its own floor. Pools never form
// within NYTHRAXIS_SOULFIRE_WARDSTONE_CLEARANCE of a wardstone, so a Deathless
// Rage channel is never forced through fire. Pools share the encounter's flame
// list with Grave Flame (nythraxis_grave_eruption.ts) under `kind: 'soul'`, so
// the driver's one flame tick, the readout, the wire, and the renderer all
// carry both fires; only the palette, radius, duration, and tick differ.
//
// `src/sim`-pure: no rng, no wall clock, no DOM.

import type { NythraxisGraveFlame, NythraxisGravePoint } from './nythraxis_grave_eruption';
import type { DungeonDifficulty } from './types';

export const NYTHRAXIS_SOULFIRE_CAST_ID = 'Soulfire';
export const NYTHRAXIS_SOULFIRE_RADIUS = 4;
export const NYTHRAXIS_SOULFIRE_SECONDS = 15;
export const NYTHRAXIS_SOULFIRE_TICK_SECONDS = 1;
export const NYTHRAXIS_SOULFIRE_TICK_MAX_HP_NORMAL = 0.08;
export const NYTHRAXIS_SOULFIRE_TICK_MAX_HP_HEROIC = 0.12;
export const NYTHRAXIS_SOULFIRE_WARDSTONE_CLEARANCE = 6;
/** Oldest pools expire first past this many live Soulfire pools. */
export const NYTHRAXIS_SOULFIRE_CAP = 12;

export function nythraxisSoulfireTickMaxHp(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_SOULFIRE_TICK_MAX_HP_HEROIC
    : NYTHRAXIS_SOULFIRE_TICK_MAX_HP_NORMAL;
}

/** True when a pool at `point` would sit too close to any wardstone. */
export function nythraxisSoulfireBlockedByWardstone(
  point: NythraxisGravePoint,
  wardstones: readonly NythraxisGravePoint[],
): boolean {
  return wardstones.some(
    (ward) =>
      Math.hypot(point.x - ward.x, point.z - ward.z) < NYTHRAXIS_SOULFIRE_WARDSTONE_CLEARANCE,
  );
}

/**
 * Append a Soulfire pool per detonation point (skipping the wardstone
 * clearance), expiring the oldest Soulfire pools past the cap while leaving
 * the Grave Flame patches in the same list untouched. Returns the next
 * sequence number.
 */
export function igniteNythraxisSoulfire(
  flames: NythraxisGraveFlame[],
  points: readonly NythraxisGravePoint[],
  wardstones: readonly NythraxisGravePoint[],
  seq: number,
): number {
  let next = seq;
  for (const point of points) {
    if (nythraxisSoulfireBlockedByWardstone(point, wardstones)) continue;
    flames.push({
      seq: next++,
      kind: 'soul',
      x: point.x,
      z: point.z,
      radius: NYTHRAXIS_SOULFIRE_RADIUS,
      remaining: NYTHRAXIS_SOULFIRE_SECONDS,
      tickTimer: NYTHRAXIS_SOULFIRE_TICK_SECONDS,
    });
  }
  let soulCount = 0;
  for (const flame of flames) if (flame.kind === 'soul') soulCount++;
  for (let i = 0; i < flames.length && soulCount > NYTHRAXIS_SOULFIRE_CAP; ) {
    if (flames[i].kind === 'soul') {
      flames.splice(i, 1);
      soulCount--;
    } else {
      i++;
    }
  }
  return next;
}
