// Binding Sigil: the pull mechanic. A sigil of the old wards flares on one
// of the two platforms flanking the throne (NYTHRAXIS_SIGIL_SIDE_OFFSET yd to
// the raid's left or right of where Nythraxis stood at the pull, alternating
// every cast) and he begins Deathless Ascension, gaining a stack of damage
// and haste every few seconds. The tank has the bind window to drag him onto
// the sigil. Bound: the Ascension is purged, he is stunned, and he takes
// extra damage for the burn window. Unbound: a raid-wide hit and a lasting
// damage bonus until the next binding.
//
// Placement spends no shared rng and no hash: the spot is a fixed function
// of the spawn anchor and the side, and the driver injects the floor
// predicate (arena bounds, pillars, wardstone clearance, live fire on normal)
// so this leaf stays pure.
//
// `src/sim`-pure: no rng stream, no wall clock, no DOM.

import { NYTHRAXIS_PLATFORM_SIDE_OFFSET } from './dungeon_layout';
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
 * Where a sigil lands (owner call, 2026-09-11): on one of the two flanking
 * platforms, the crypt's raised dais reused in line with the boss's SPAWN
 * and NYTHRAXIS_SIGIL_SIDE_OFFSET yd to the raid's left and right of it
 * (dungeon_layout.ts NYTHRAXIS_LAYOUT.platforms owns the geometry; this
 * reads the same offset so the x can never drift, and the shared z, the
 * spawn's, is pinned by tests/dungeon_parkour.test.ts and the driver's
 * floor-lift assertion). Sides alternate every
 * cast, so the tank always knows which way the drag goes; the anchor is the
 * spawn, not the boss's current position, so the platforms are fixed spots
 * the raid can learn.
 */
export const NYTHRAXIS_SIGIL_SIDE_OFFSET = NYTHRAXIS_PLATFORM_SIDE_OFFSET;
/** +1 = world +x (the raid's left facing the dais), -1 = world -x (its right). */
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
 * The platform spot on the given side of the spawn anchor: the platform's
 * centre. No hash and no rng: the spot is a fixed function of the anchor
 * and the side, so the raid can learn it.
 */
export function nythraxisSigilCandidate(
  anchor: NythraxisSigilPoint,
  side: NythraxisSigilSide,
): NythraxisSigilPoint {
  return { x: anchor.x + side * NYTHRAXIS_SIGIL_SIDE_OFFSET, z: anchor.z };
}

/**
 * The side the next cast lands on, alternating from the raid's right. Side
 * +1 is world +x and -1 is world -x; the raid enters facing the dais along
 * +z, and a camera looking along +z has world +x on the LEFT of the screen,
 * so the raid's right is -1. The first cast lands there.
 */
export function nythraxisSigilNextSide(previous: NythraxisSigilSide | null): NythraxisSigilSide {
  return previous === null ? -1 : previous === 1 ? -1 : 1;
}

/**
 * The side of the anchor a placed sigil sits on: what the next cast
 * alternates from. The driver stores this, not the side it asked for, so a
 * blocked-platform crossover is remembered and the following cast goes to
 * the other platform instead of repeating the one he was just bound on.
 */
export function nythraxisSigilSideOf(
  anchor: NythraxisSigilPoint,
  point: NythraxisSigilPoint,
): NythraxisSigilSide {
  return point.x > anchor.x ? 1 : -1;
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
 * The asked platform when it obeys every placement rule; the other platform
 * when it does not (a wardstone or, on Normal, live fire on the asked one);
 * the asked platform regardless when neither does, so a cast never silently
 * vanishes and never falls back onto the anchor itself (a sigil under the
 * spawn would bind him for free at the pull). On Normal that last resort
 * can sit in live fire when BOTH platforms burn: a cast must land
 * somewhere, and a burning stage is the tank's to time, not a silent skip
 * (flagged for the owner in the v0.42.2 PR). `anchor` is the boss's spawn.
 */
export function nythraxisSigilPlacement(
  anchor: NythraxisSigilPoint,
  side: NythraxisSigilSide,
  radius: number,
  floor: NythraxisSigilFloor,
  allowFire: boolean,
): NythraxisSigilPoint {
  for (const trySide of [side, -side as NythraxisSigilSide]) {
    const candidate = nythraxisSigilCandidate(anchor, trySide);
    if (nythraxisSigilPlacementValid(candidate, radius, floor, allowFire)) return candidate;
  }
  return nythraxisSigilCandidate(anchor, side);
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
