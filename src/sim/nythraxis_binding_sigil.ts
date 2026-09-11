// Binding Sigil: the pull mechanic. A sigil of the old wards flares on the
// floor within NYTHRAXIS_SIGIL_MAX_DIST of Nythraxis and he begins Deathless
// Ascension, gaining a stack of damage and haste every few seconds. The tank
// has the bind window to drag him onto the sigil. Bound: the Ascension is
// purged, he is stunned, and he takes extra damage for the burn window.
// Unbound: a raid-wide hit and a lasting damage bonus until the next binding.
//
// Placement spends no shared rng: it hashes the cast key, the way Grave
// Eruption does, and the driver injects the floor predicate (arena bounds,
// pillars, wardstone clearance, live fire on normal) so this leaf stays pure.
//
// `src/sim`-pure: no rng stream, no wall clock, no DOM.

import type { DungeonDifficulty } from './types';

export interface NythraxisSigilPoint {
  x: number;
  z: number;
}

/** The live sigil on the encounter state (absent when none is up). */
export interface NythraxisBindingSigil {
  castKey: number;
  x: number;
  z: number;
  /** seconds left to bind before the sigil fails */
  remaining: number;
  /** seconds until the next Deathless Ascension stack */
  ascensionTimer: number;
  ascensionStacks: number;
}

/** Reconnect-safe presentation row: the client draws the sigil decal. */
export interface ActiveNythraxisBindingSigil extends NythraxisSigilPoint {
  id: string;
  sourceId: number;
  radius: number;
  duration: number;
  remaining: number;
}

export const NYTHRAXIS_SIGIL_CAST_ID = 'Binding Sigil';
export const NYTHRAXIS_ASCENSION_AURA_ID = 'nythraxis_ascension';
export const NYTHRAXIS_ASCENSION_AURA_NAME = 'Deathless Ascension';
export const NYTHRAXIS_ASCENSION_HASTE_AURA_ID = 'nythraxis_ascension_haste';
export const NYTHRAXIS_BOUND_AURA_ID = 'nythraxis_bound';
export const NYTHRAXIS_BOUND_AURA_NAME = 'Bound';
export const NYTHRAXIS_BOUND_STUN_AURA_ID = 'nythraxis_bound_stun';
export const NYTHRAXIS_UNBOUND_AURA_ID = 'nythraxis_unbound';
export const NYTHRAXIS_UNBOUND_AURA_NAME = 'Unbound';
export const NYTHRAXIS_UNBOUND_CAST_ID = 'Unbound';

export const NYTHRAXIS_SIGIL_FIRST_SECONDS = 30;
export const NYTHRAXIS_SIGIL_EVERY_NORMAL = 45;
export const NYTHRAXIS_SIGIL_EVERY_HEROIC = 40;
/**
 * Where a sigil lands (owner call, 2026-09-11): beside the boss on the raid's
 * left or right, NYTHRAXIS_SIGIL_SIDE_OFFSET yd out along the hall's x axis,
 * alternating sides every cast, so the tank always knows which way the drag
 * goes. The hall's open floor between the dais (r 10) and the pillar rows
 * (x 32) is where the offset lands; a blocked spot walks the fallback ladder
 * below (nudges along z, then closer in) before the placement gives up.
 */
export const NYTHRAXIS_SIGIL_SIDE_OFFSET = 22;
/** The closer-in fallback offset when the primary spot is blocked. */
export const NYTHRAXIS_SIGIL_SIDE_OFFSET_NEAR = 16;
/** Fallback nudges along the hall axis, tried in this order at each offset. */
export const NYTHRAXIS_SIGIL_SIDE_NUDGES_Z: readonly number[] = [0, 6, -6, 12, -12, 18, -18];
export type NythraxisSigilSide = 1 | -1;
export const NYTHRAXIS_SIGIL_RADIUS_NORMAL = 4;
export const NYTHRAXIS_SIGIL_RADIUS_HEROIC = 3;
export const NYTHRAXIS_SIGIL_BIND_SECONDS_NORMAL = 15;
export const NYTHRAXIS_SIGIL_BIND_SECONDS_HEROIC = 12;
export const NYTHRAXIS_SIGIL_WARDSTONE_CLEARANCE = 6;
/** How long the rune-circle flare that announces a sigil lasts; the sigil
 *  decal itself is a reconnect-safe readout (activeNythraxisBindingSigils)
 *  the client paints for the whole bind window, and it vanishes the tick the
 *  sigil resolves, which a long one-shot flare could not. */
export const NYTHRAXIS_SIGIL_FLARE_SECONDS = 2;
/** Clearance from a pillar or wall the floor predicate is asked to keep. */
export const NYTHRAXIS_SIGIL_FLOOR_CLEARANCE = 2;
export const NYTHRAXIS_ASCENSION_EVERY = 2;
export const NYTHRAXIS_ASCENSION_PER_STACK_NORMAL = 0.04;
export const NYTHRAXIS_ASCENSION_PER_STACK_HEROIC = 0.05;
export const NYTHRAXIS_BOUND_STUN_SECONDS_NORMAL = 4;
export const NYTHRAXIS_BOUND_STUN_SECONDS_HEROIC = 3;
export const NYTHRAXIS_BOUND_VULNERABILITY = 0.25;
export const NYTHRAXIS_BOUND_SECONDS_NORMAL = 10;
export const NYTHRAXIS_BOUND_SECONDS_HEROIC = 8;
export const NYTHRAXIS_UNBOUND_HIT_MAX_HP_NORMAL = 0.4;
export const NYTHRAXIS_UNBOUND_HIT_MAX_HP_HEROIC = 0.6;
export const NYTHRAXIS_UNBOUND_DAMAGE_BONUS_NORMAL = 0.2;
export const NYTHRAXIS_UNBOUND_DAMAGE_BONUS_HEROIC = 0.25;
/** Unbound is a standing bonus; it is removed by the next successful binding. */
export const NYTHRAXIS_UNBOUND_AURA_SECONDS = 600;

export function nythraxisSigilCadence(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic' ? NYTHRAXIS_SIGIL_EVERY_HEROIC : NYTHRAXIS_SIGIL_EVERY_NORMAL;
}

export function nythraxisSigilRadius(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic' ? NYTHRAXIS_SIGIL_RADIUS_HEROIC : NYTHRAXIS_SIGIL_RADIUS_NORMAL;
}

export function nythraxisSigilBindSeconds(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_SIGIL_BIND_SECONDS_HEROIC
    : NYTHRAXIS_SIGIL_BIND_SECONDS_NORMAL;
}

export function nythraxisAscensionPerStack(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_ASCENSION_PER_STACK_HEROIC
    : NYTHRAXIS_ASCENSION_PER_STACK_NORMAL;
}

export function nythraxisBoundStunSeconds(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_BOUND_STUN_SECONDS_HEROIC
    : NYTHRAXIS_BOUND_STUN_SECONDS_NORMAL;
}

/** How long the Bound burn window (the vulnerability) lasts. */
export function nythraxisBoundSeconds(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic' ? NYTHRAXIS_BOUND_SECONDS_HEROIC : NYTHRAXIS_BOUND_SECONDS_NORMAL;
}

export function nythraxisUnboundHitMaxHp(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_UNBOUND_HIT_MAX_HP_HEROIC
    : NYTHRAXIS_UNBOUND_HIT_MAX_HP_NORMAL;
}

export function nythraxisUnboundDamageBonus(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_UNBOUND_DAMAGE_BONUS_HEROIC
    : NYTHRAXIS_UNBOUND_DAMAGE_BONUS_NORMAL;
}

/** On heroic the sigil may land in live fire; on normal it never does. */
export function nythraxisSigilMayLandInFire(difficulty: DungeonDifficulty): boolean {
  return difficulty === 'heroic';
}

export function nythraxisSigilId(bossId: number, castKey: number): string {
  return `${bossId}:sig:${castKey}`;
}

/** The floor facts the placement needs, injected by the driver. */
export interface NythraxisSigilFloor {
  /** true when a sigil centered here would sit on open floor (bounds, pillars, walls) */
  openFloor(point: NythraxisSigilPoint): boolean;
  wardstones: readonly NythraxisSigilPoint[];
  /** live fire the sigil must avoid on normal: center plus radius */
  fires: readonly (NythraxisSigilPoint & { radius: number })[];
}

/**
 * The `attempt`-th candidate on the given side: the primary offset with each
 * z nudge in order, then the near offset with the same nudges. No hash and no
 * rng: the spot is a fixed function of the boss's position and the side, so
 * the raid can learn it.
 */
export function nythraxisSigilCandidate(
  attempt: number,
  boss: NythraxisSigilPoint,
  side: NythraxisSigilSide,
): NythraxisSigilPoint {
  const nudges = NYTHRAXIS_SIGIL_SIDE_NUDGES_Z;
  const offset =
    attempt < nudges.length ? NYTHRAXIS_SIGIL_SIDE_OFFSET : NYTHRAXIS_SIGIL_SIDE_OFFSET_NEAR;
  const nudge = nudges[attempt % nudges.length];
  return { x: boss.x + side * offset, z: boss.z + nudge };
}

/** The side the next cast lands on: the raid's right (+x) first, then alternating. */
export function nythraxisSigilNextSide(previous: NythraxisSigilSide | null): NythraxisSigilSide {
  return previous === null ? 1 : previous === 1 ? -1 : 1;
}

/** True when a sigil of `radius` at `point` obeys every placement rule. */
export function nythraxisSigilPlacementValid(
  point: NythraxisSigilPoint,
  radius: number,
  floor: NythraxisSigilFloor,
  allowFire: boolean,
): boolean {
  return floor.openFloor(point) && nythraxisSigilClearOfHazards(point, radius, floor, allowFire);
}

/**
 * Pick the first valid hash candidate; when none of them is valid the sigil
 * falls back to the first candidate that is at least open floor, and finally
 * to the first candidate outright, so a cast never silently vanishes and the
 * sigil is never under the boss (that would bind him for free on the spot).
 */
export function nythraxisSigilPlacement(
  boss: NythraxisSigilPoint,
  side: NythraxisSigilSide,
  radius: number,
  floor: NythraxisSigilFloor,
  allowFire: boolean,
): NythraxisSigilPoint {
  let fallback: NythraxisSigilPoint | null = null;
  const candidates = NYTHRAXIS_SIGIL_SIDE_NUDGES_Z.length * 2;
  for (let attempt = 0; attempt < candidates; attempt++) {
    const candidate = nythraxisSigilCandidate(attempt, boss, side);
    const open = floor.openFloor(candidate);
    if (open && nythraxisSigilClearOfHazards(candidate, radius, floor, allowFire)) return candidate;
    if (!fallback && open) fallback = candidate;
  }
  return fallback ?? nythraxisSigilCandidate(0, boss, side);
}

/** The wardstone and (on normal) fire rules alone, floor already checked. */
function nythraxisSigilClearOfHazards(
  point: NythraxisSigilPoint,
  radius: number,
  floor: NythraxisSigilFloor,
  allowFire: boolean,
): boolean {
  for (const ward of floor.wardstones) {
    if (Math.hypot(point.x - ward.x, point.z - ward.z) < NYTHRAXIS_SIGIL_WARDSTONE_CLEARANCE)
      return false;
  }
  if (!allowFire) {
    for (const fire of floor.fires) {
      if (Math.hypot(point.x - fire.x, point.z - fire.z) < fire.radius + radius) return false;
    }
  }
  return true;
}

/** True when the boss stands on the sigil (center inside the radius, inclusive). */
export function nythraxisBossOnSigil(
  boss: NythraxisSigilPoint,
  sigil: NythraxisSigilPoint,
  radius: number,
): boolean {
  return Math.hypot(boss.x - sigil.x, boss.z - sigil.z) <= radius + 1e-9;
}

/** Projects the live sigil into a reconnect-safe presentation row. */
export function activeNythraxisBindingSigils(
  bossId: number,
  sigil: NythraxisBindingSigil | null | undefined,
  difficulty: DungeonDifficulty,
): ActiveNythraxisBindingSigil[] {
  if (!sigil || sigil.remaining <= 0) return [];
  return [
    {
      id: nythraxisSigilId(bossId, sigil.castKey),
      sourceId: bossId,
      x: sigil.x,
      z: sigil.z,
      radius: nythraxisSigilRadius(difficulty),
      duration: nythraxisSigilBindSeconds(difficulty),
      remaining: Math.min(sigil.remaining, nythraxisSigilBindSeconds(difficulty)),
    },
  ];
}
