// Gravefire: Nythraxis's traveling line of grave-fire (the Coldflame).
//
// Every cast a line ignites at the boss's feet and runs toward a random
// eligible raider's position, growing NYTHRAXIS_GRAVEFIRE_SPEED yards per
// second to NYTHRAXIS_GRAVEFIRE_LENGTH. Each yard burns for the difficulty's
// burn time from the moment the head reached it, so the lit part is a window
// that slides along the line: the tail extinguishes while the head is still
// advancing, then the tail chases the head off the end. Anyone standing inside
// the lit window (within the half-width of the line) takes the per-second tick.
// The pure pieces live here (tuning, the window math, the point test, the
// reconnect-safe readout); the driver in encounters/nythraxis.ts owns cadence,
// the rng target pick, and damage.
//
// `src/sim`-pure: no rng, no wall clock, no DOM.

import type { DungeonDifficulty } from './types';

export interface NythraxisGravefirePoint {
  x: number;
  z: number;
}

/** One live Gravefire line on the encounter state. */
export interface NythraxisGravefire {
  seq: number;
  /** ignition point (the boss's feet at cast) */
  x: number;
  z: number;
  /** unit direction the line travels */
  dirX: number;
  dirZ: number;
  /** seconds since ignition */
  elapsed: number;
  /** seconds until the next damage tick */
  tickTimer: number;
}

/** The lit window along the line, in yards from the ignition point. */
export interface NythraxisGravefireExtent {
  tail: number;
  head: number;
}

/** Reconnect-safe presentation row: the client draws the lit window. */
export interface ActiveNythraxisGravefire extends NythraxisGravefirePoint {
  id: string;
  sourceId: number;
  dirX: number;
  dirZ: number;
  tail: number;
  head: number;
  halfWidth: number;
  /** seconds until the line is fully burnt out */
  remaining: number;
}

export const NYTHRAXIS_GRAVEFIRE_CAST_ID = 'Gravefire';
export const NYTHRAXIS_GRAVEFIRE_EVERY_NORMAL = 12;
export const NYTHRAXIS_GRAVEFIRE_EVERY_HEROIC = 10;
/** Phase 2 opens with the line a few seconds after the settle delay. */
export const NYTHRAXIS_GRAVEFIRE_FIRST_SECONDS = 9;
export const NYTHRAXIS_GRAVEFIRE_SPEED = 12;
export const NYTHRAXIS_GRAVEFIRE_LENGTH = 40;
export const NYTHRAXIS_GRAVEFIRE_HALF_WIDTH = 1.5;
export const NYTHRAXIS_GRAVEFIRE_BURN_SECONDS_NORMAL = 6;
export const NYTHRAXIS_GRAVEFIRE_BURN_SECONDS_HEROIC = 8;
export const NYTHRAXIS_GRAVEFIRE_TICK_SECONDS = 1;
export const NYTHRAXIS_GRAVEFIRE_TICK_MAX_HP_NORMAL = 0.1;
export const NYTHRAXIS_GRAVEFIRE_TICK_MAX_HP_HEROIC = 0.15;
/** Oldest lines expire first past this many live lines. */
export const NYTHRAXIS_GRAVEFIRE_CAP = 6;

export function nythraxisGravefireCadence(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_GRAVEFIRE_EVERY_HEROIC
    : NYTHRAXIS_GRAVEFIRE_EVERY_NORMAL;
}

export function nythraxisGravefireBurnSeconds(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_GRAVEFIRE_BURN_SECONDS_HEROIC
    : NYTHRAXIS_GRAVEFIRE_BURN_SECONDS_NORMAL;
}

export function nythraxisGravefireTickMaxHp(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_GRAVEFIRE_TICK_MAX_HP_HEROIC
    : NYTHRAXIS_GRAVEFIRE_TICK_MAX_HP_NORMAL;
}

/** Total lifetime of one line: the head's travel plus the tail's burn. */
export function nythraxisGravefireLifetime(burnSeconds: number): number {
  return NYTHRAXIS_GRAVEFIRE_LENGTH / NYTHRAXIS_GRAVEFIRE_SPEED + burnSeconds;
}

export function nythraxisGravefireId(bossId: number, seq: number): string {
  return `${bossId}:gfl:${seq}`;
}

/**
 * The lit window at `elapsed` seconds, or null once the whole line has burnt
 * out. The head advances at the travel speed until the full length; the tail
 * follows one burn time behind it. At ignition the window is the single
 * origin point (tail and head both 0): live, so the readout carries the line
 * from its very first tick, just not yet reaching anyone.
 */
export function nythraxisGravefireExtent(
  elapsed: number,
  burnSeconds: number,
): NythraxisGravefireExtent | null {
  if (elapsed < 0) return null;
  const head = Math.min(NYTHRAXIS_GRAVEFIRE_LENGTH, elapsed * NYTHRAXIS_GRAVEFIRE_SPEED);
  const tail = Math.max(0, (elapsed - burnSeconds) * NYTHRAXIS_GRAVEFIRE_SPEED);
  if (tail >= NYTHRAXIS_GRAVEFIRE_LENGTH) return null;
  return { tail, head };
}

/** Unit direction from the ignition point toward the target, or +z when they coincide. */
export function nythraxisGravefireDirection(
  origin: NythraxisGravefirePoint,
  target: NythraxisGravefirePoint,
): { dirX: number; dirZ: number } {
  const dx = target.x - origin.x;
  const dz = target.z - origin.z;
  const length = Math.hypot(dx, dz);
  if (length <= 1e-6) return { dirX: 0, dirZ: 1 };
  return { dirX: dx / length, dirZ: dz / length };
}

/**
 * True when a point stands inside the lit window: its projection along the
 * line falls inside [tail, head] and its distance from the line is within the
 * half-width. Both edges are inclusive so a raider on the boundary burns.
 */
export function pointInNythraxisGravefire(
  line: Pick<NythraxisGravefire, 'x' | 'z' | 'dirX' | 'dirZ'>,
  extent: NythraxisGravefireExtent,
  point: NythraxisGravefirePoint,
): boolean {
  const rx = point.x - line.x;
  const rz = point.z - line.z;
  const along = rx * line.dirX + rz * line.dirZ;
  if (along < extent.tail - 1e-9 || along > extent.head + 1e-9) return false;
  const across = Math.abs(rx * line.dirZ - rz * line.dirX);
  return across <= NYTHRAXIS_GRAVEFIRE_HALF_WIDTH + 1e-9;
}

/** Append a line, expiring the oldest past the cap. Returns the next sequence number. */
export function igniteNythraxisGravefire(
  lines: NythraxisGravefire[],
  origin: NythraxisGravefirePoint,
  target: NythraxisGravefirePoint,
  seq: number,
): number {
  const { dirX, dirZ } = nythraxisGravefireDirection(origin, target);
  lines.push({
    seq,
    x: origin.x,
    z: origin.z,
    dirX,
    dirZ,
    elapsed: 0,
    tickTimer: NYTHRAXIS_GRAVEFIRE_TICK_SECONDS,
  });
  while (lines.length > NYTHRAXIS_GRAVEFIRE_CAP) lines.shift();
  return seq + 1;
}

/** Projects the live lines into reconnect-safe presentation rows. */
export function activeNythraxisGravefires(
  bossId: number,
  lines: readonly NythraxisGravefire[],
  difficulty: DungeonDifficulty,
): ActiveNythraxisGravefire[] {
  const burn = nythraxisGravefireBurnSeconds(difficulty);
  const lifetime = nythraxisGravefireLifetime(burn);
  const rows: ActiveNythraxisGravefire[] = [];
  for (const line of lines) {
    const extent = nythraxisGravefireExtent(line.elapsed, burn);
    if (!extent) continue;
    rows.push({
      id: nythraxisGravefireId(bossId, line.seq),
      sourceId: bossId,
      x: line.x,
      z: line.z,
      dirX: line.dirX,
      dirZ: line.dirZ,
      tail: extent.tail,
      head: extent.head,
      halfWidth: NYTHRAXIS_GRAVEFIRE_HALF_WIDTH,
      remaining: Math.max(0, lifetime - line.elapsed),
    });
  }
  return rows;
}
