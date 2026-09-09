// Soulfire: the pool a Soul Rend mark leaves where it detonated.
//
// A marked raider's position at detonation becomes a Soulfire pool (purple
// fire) that burns for NYTHRAXIS_SOULFIRE_SECONDS, so the stack point has to
// move every cast and a careless raid fills its own floor. Pools never form
// within NYTHRAXIS_SOULFIRE_WARDSTONE_CLEARANCE of a wardstone, so a Deathless
// Rage channel is never forced through fire. Pools share the encounter's flame
// list with Grave Flame (nythraxis_grave_eruption.ts) under `kind: 'soul'`, so
// the driver's one flame tick, the readout, the wire, and the renderer all
// carry both fires; only the palette, radius, duration, and tick differ.
//
// Normal: one pool per mark, ticks apply independently per pool (unchanged).
// Heroic: the marks in one stacked group leave a single pool at the group's
// centroid instead of one per mark (nythraxisSoulfireGroupCentroids, over the
// same NYTHRAXIS_SOUL_REND_STACK_RANGE the split-damage rule already uses),
// and standing in more than one live pool, or catching two staggered casts,
// still costs at most one normal-strength tick per second
// (admitNythraxisSoulfireTick, keyed on each player's last applied tick time).
//
// `src/sim`-pure: no rng, no wall clock, no DOM.

import type { NythraxisGraveFlame, NythraxisGravePoint } from './nythraxis_grave_eruption';
import type { DungeonDifficulty } from './types';

export const NYTHRAXIS_SOULFIRE_CAST_ID = 'Soulfire';
export const NYTHRAXIS_SOULFIRE_RADIUS = 4;
export const NYTHRAXIS_SOULFIRE_SECONDS_NORMAL = 15;
export const NYTHRAXIS_SOULFIRE_SECONDS_HEROIC = 12;
export const NYTHRAXIS_SOULFIRE_TICK_SECONDS = 1;
export const NYTHRAXIS_SOULFIRE_TICK_MAX_HP_NORMAL = 0.08;
export const NYTHRAXIS_SOULFIRE_TICK_MAX_HP_HEROIC = 0.12;
export const NYTHRAXIS_SOULFIRE_WARDSTONE_CLEARANCE = 6;
/** Oldest pools expire first past this many live Soulfire pools. */
export const NYTHRAXIS_SOULFIRE_CAP = 12;

export function nythraxisSoulfireSeconds(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_SOULFIRE_SECONDS_HEROIC
    : NYTHRAXIS_SOULFIRE_SECONDS_NORMAL;
}

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
  seconds: number = NYTHRAXIS_SOULFIRE_SECONDS_NORMAL,
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
      remaining: seconds,
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

/**
 * Groups detonation points into connected-proximity clusters (an edge when
 * two points sit within `groupRange` of each other, transitive closure over
 * the edges) and returns one centroid per cluster: a stacked group leaves one
 * Soulfire pool instead of one per mark, an isolated point keeps its own pool,
 * and separate groups stay separate. `points` is sorted into a canonical
 * order FIRST, and every later pass (the union-find, the centroid sums) walks
 * that same order: connectivity is order-independent already, but a
 * fractional-coordinate sum is not strictly associative, so a fixed
 * evaluation order is what makes the result identical for any input
 * permutation, not just its output position. Pure geometry, draws no rng.
 */
export function nythraxisSoulfireGroupCentroids(
  points: readonly NythraxisGravePoint[],
  groupRange: number,
): NythraxisGravePoint[] {
  const ordered = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  const parent = ordered.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      if (Math.hypot(ordered[i].x - ordered[j].x, ordered[i].z - ordered[j].z) > groupRange)
        continue;
      const rootI = find(i);
      const rootJ = find(j);
      if (rootI !== rootJ) parent[rootI] = rootJ;
    }
  }
  const groups = new Map<number, NythraxisGravePoint[]>();
  for (let i = 0; i < ordered.length; i++) {
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(ordered[i]);
    else groups.set(root, [ordered[i]]);
  }
  const centroids = [...groups.values()].map((group) => {
    const sum = group.reduce((acc, p) => ({ x: acc.x + p.x, z: acc.z + p.z }), { x: 0, z: 0 });
    return { x: sum.x / group.length, z: sum.z / group.length };
  });
  centroids.sort((a, b) => a.x - b.x || a.z - b.z);
  return centroids;
}

/** One player's last applied heroic Soulfire tick, keyed to the boss clock. */
export interface NythraxisSoulfireTickMark {
  playerId: number;
  at: number;
}

/**
 * True (and records `now`) when this player may take a heroic Soulfire tick
 * from this boss: never more than one per NYTHRAXIS_SOULFIRE_TICK_SECONDS,
 * even across multiple overlapping pools or two staggered casts whose
 * per-pool tick timers are out of phase. Mutates `marks` in place, the same
 * convention as igniteNythraxisSoulfire's `flames` list.
 */
export function admitNythraxisSoulfireTick(
  marks: NythraxisSoulfireTickMark[],
  playerId: number,
  now: number,
): boolean {
  const mark = marks.find((m) => m.playerId === playerId);
  if (!mark) {
    marks.push({ playerId, at: now });
    return true;
  }
  if (now - mark.at < NYTHRAXIS_SOULFIRE_TICK_SECONDS - 1e-6) return false;
  mark.at = now;
  return true;
}
