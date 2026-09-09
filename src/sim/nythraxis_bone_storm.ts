// Bone Storm: Nythraxis's phase 3 signature (the Marrowgar idiom).
//
// For NYTHRAXIS_BONE_STORM_SECONDS he ignores threat and whirls, dealing a
// max-hp tick every second to anyone within NYTHRAXIS_BONE_STORM_RADIUS, and
// charges living, non-impaled raiders in sequence: one target per charge
// window, at NYTHRAXIS_BONE_STORM_SPEED_MULT times his move speed. When he
// reaches a target (or the window runs out) he Bone Slams everyone around him
// and a Gravefire line runs on down the charge direction, then he whirls in
// place until the next window opens. One Bone Spike cast lands mid-storm. When
// the storm ends the threat table is intact, the top-threat tank picks him up,
// and Gravebreaker re-arms shortly after.
//
// Target order spends no shared rng: each window ranks the eligible raiders by
// a hash of the cast key, the window index, and the raider id, the idiom
// Grave Eruption and the Binding Sigil use, so adding the storm moves no other
// draw. The pure pieces live here (tuning, the window math, the target rank,
// the reach and radius tests); the driver in encounters/nythraxis.ts owns the
// movement, the damage, the spike, and the pickup.
//
// `src/sim`-pure: no rng stream, no wall clock, no DOM.

import { hash2 } from './rng';
import type { DungeonDifficulty } from './types';

export interface NythraxisBoneStormPoint {
  x: number;
  z: number;
}

/** The live storm on the encounter state (absent between storms). */
export interface NythraxisBoneStorm {
  castKey: number;
  /** seconds since the storm began */
  elapsed: number;
  /** the charge window in progress (0-based) */
  chargeIndex: number;
  chargeTargetId: number | null;
  /** this window's Bone Slam has landed; he whirls in place until the next window */
  slammed: boolean;
  /** seconds until the next whirl tick */
  whirlTickTimer: number;
  /** the mid-storm Bone Spike has been cast */
  spikeCast: boolean;
  /** raiders already charged this storm, so no one is charged twice while others remain */
  chargedIds: number[];
}

export const NYTHRAXIS_BONE_STORM_CAST_ID = 'Bone Storm';
export const NYTHRAXIS_BONE_SLAM_CAST_ID = 'Bone Slam';
export const NYTHRAXIS_BONE_STORM_AURA_ID = 'nythraxis_bone_storm';
export const NYTHRAXIS_BONE_STORM_AURA_NAME = 'Bone Storm';

/** Seconds into phase 3 the first storm begins. */
export const NYTHRAXIS_BONE_STORM_FIRST_SECONDS = 8;
export const NYTHRAXIS_BONE_STORM_EVERY_NORMAL = 50;
export const NYTHRAXIS_BONE_STORM_EVERY_HEROIC = 40;
export const NYTHRAXIS_BONE_STORM_SECONDS = 12;
export const NYTHRAXIS_BONE_STORM_CHARGES = 4;
export const NYTHRAXIS_BONE_STORM_CHARGE_SECONDS = 3;
export const NYTHRAXIS_BONE_STORM_SPEED_MULT = 2.2;
export const NYTHRAXIS_BONE_STORM_RADIUS = 9;
export const NYTHRAXIS_BONE_STORM_WHIRL_TICK_SECONDS = 1;
export const NYTHRAXIS_BONE_STORM_WHIRL_TICK_MAX_HP_NORMAL = 0.1;
export const NYTHRAXIS_BONE_STORM_WHIRL_TICK_MAX_HP_HEROIC = 0.2;
export const NYTHRAXIS_BONE_SLAM_MAX_HP_NORMAL = 0.35;
export const NYTHRAXIS_BONE_SLAM_MAX_HP_HEROIC = 0.55;
/** He has reached his charge target inside this distance. */
export const NYTHRAXIS_BONE_STORM_ARRIVE_DIST = 3;
/** Seconds into the storm the mid-storm Bone Spike lands. */
export const NYTHRAXIS_BONE_STORM_SPIKE_AT_SECONDS = 6;
/** Seconds after the storm ends before Gravebreaker is charged again. */
export const NYTHRAXIS_BONE_STORM_GRAVEBREAKER_REARM_SECONDS = 3;

export function nythraxisBoneStormCadence(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_BONE_STORM_EVERY_HEROIC
    : NYTHRAXIS_BONE_STORM_EVERY_NORMAL;
}

export function nythraxisBoneStormWhirlTickMaxHp(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_BONE_STORM_WHIRL_TICK_MAX_HP_HEROIC
    : NYTHRAXIS_BONE_STORM_WHIRL_TICK_MAX_HP_NORMAL;
}

export function nythraxisBoneSlamDamageMaxHp(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_BONE_SLAM_MAX_HP_HEROIC
    : NYTHRAXIS_BONE_SLAM_MAX_HP_NORMAL;
}

/** The charge window open at `elapsed` seconds into the storm. */
export function nythraxisBoneStormChargeIndex(elapsed: number): number {
  return Math.min(
    NYTHRAXIS_BONE_STORM_CHARGES - 1,
    Math.max(0, Math.floor(elapsed / NYTHRAXIS_BONE_STORM_CHARGE_SECONDS)),
  );
}

export function nythraxisBoneStormDone(elapsed: number): boolean {
  return elapsed >= NYTHRAXIS_BONE_STORM_SECONDS;
}

/** True once the storm has run long enough for its mid-storm Bone Spike. */
export function nythraxisBoneStormSpikeDue(elapsed: number): boolean {
  return elapsed >= NYTHRAXIS_BONE_STORM_SPIKE_AT_SECONDS;
}

/**
 * The raider this window charges: the lowest hash rank among the eligible
 * raiders, preferring anyone not yet charged this storm while such raiders
 * remain. Null when nobody is eligible.
 */
export function nythraxisBoneStormChargeTarget(
  castKey: number,
  chargeIndex: number,
  eligible: readonly { id: number }[],
  alreadyCharged: readonly number[],
): number | null {
  if (eligible.length === 0) return null;
  const fresh = eligible.filter((raider) => !alreadyCharged.includes(raider.id));
  const pool = fresh.length > 0 ? fresh : eligible;
  let best: { id: number } | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const raider of pool) {
    const rank = hash2(raider.id, chargeIndex, castKey ^ 0xb04e5);
    if (rank < bestRank || (rank === bestRank && best !== null && raider.id < best.id)) {
      best = raider;
      bestRank = rank;
    }
  }
  return best?.id ?? null;
}

/** True when the boss has reached his charge target. */
export function nythraxisBoneStormReached(
  boss: NythraxisBoneStormPoint,
  target: NythraxisBoneStormPoint,
): boolean {
  return Math.hypot(boss.x - target.x, boss.z - target.z) <= NYTHRAXIS_BONE_STORM_ARRIVE_DIST;
}

/** True when a point is inside the whirl (and the Bone Slam) radius, edge inclusive. */
export function pointInNythraxisBoneStorm(
  boss: NythraxisBoneStormPoint,
  point: NythraxisBoneStormPoint,
): boolean {
  return Math.hypot(boss.x - point.x, boss.z - point.z) <= NYTHRAXIS_BONE_STORM_RADIUS + 1e-9;
}

/** A fresh storm state at the moment it begins. */
export function beginNythraxisBoneStorm(castKey: number): NythraxisBoneStorm {
  return {
    castKey,
    elapsed: 0,
    chargeIndex: 0,
    chargeTargetId: null,
    slammed: false,
    whirlTickTimer: NYTHRAXIS_BONE_STORM_WHIRL_TICK_SECONDS,
    spikeCast: false,
    chargedIds: [],
  };
}
