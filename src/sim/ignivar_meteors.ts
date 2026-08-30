// Deterministic placement and collision math for Ignivar's independent meteor rain.
// The encounter driver owns cadence and damage, while render consumes the emitted
// warning event. Keeping the footprint here prevents warning and impact drift.

import { hash2 } from './rng';
import type { DungeonDifficulty } from './types';

export interface IgnivarMeteorPoint {
  x: number;
  z: number;
}

export interface IgnivarMeteorTarget extends IgnivarMeteorPoint {
  id: number;
}

export interface ActiveIgnivarMeteorWarning extends IgnivarMeteorPoint {
  id: string;
  radius: number;
  duration: number;
  remaining: number;
  warningLead: number;
}

export interface IgnivarMeteorWarningState {
  meteorCastKey: number;
  meteorImpactRemaining: number;
  meteorPoints: readonly IgnivarMeteorPoint[];
}

export type IgnivarMeteorDifficulty = 'normal' | 'heroic';

export const IGNIVAR_METEOR_COUNT_NORMAL = 5;
export const IGNIVAR_METEOR_COUNT_HEROIC = 7;
/** Backward-compatible Normal-mode tuning alias. */
export const IGNIVAR_METEOR_COUNT = IGNIVAR_METEOR_COUNT_NORMAL;
export const IGNIVAR_METEOR_RADIUS = 2.4;
export const IGNIVAR_METEOR_MIN_RANGE = 9;
export const IGNIVAR_METEOR_MAX_RANGE = 25;
export const IGNIVAR_METEOR_MIN_SEPARATION = 6;
export const IGNIVAR_METEOR_MAX_RANGE_HEROIC = 27;
export const IGNIVAR_METEOR_MIN_SEPARATION_HEROIC = 8;
export const IGNIVAR_METEOR_CAST_ID = 'Falling Cinders';
export const IGNIVAR_FIRST_METEOR_SECONDS = 13;
export const IGNIVAR_METEOR_EVERY = 17;
export const IGNIVAR_METEOR_TELEGRAPH_SECONDS = 2.5;
export const IGNIVAR_METEOR_REVEAL_DELAY_SECONDS = 0.75;
export const IGNIVAR_METEOR_DAMAGE_MAX_HP = 0.5;
export const IGNIVAR_METEOR_DAMAGE_MAX_HP_HEROIC = 0.8;

export function ignivarMeteorDamageMaxHp(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? IGNIVAR_METEOR_DAMAGE_MAX_HP_HEROIC
    : IGNIVAR_METEOR_DAMAGE_MAX_HP;
}

const IGNIVAR_METEOR_CANDIDATES = 48;
const IGNIVAR_METEOR_TARGET_SCATTER_MAX = 13;

export function ignivarMeteorWarningId(
  bossId: number,
  castKey: number,
  meteorIndex: number,
): string {
  return `${bossId}:${castKey}:${meteorIndex}`;
}

/** Projects the authoritative cast into persistent, reconnect-safe presentation state. */
export function activeIgnivarMeteorWarnings(
  bossId: number,
  state: IgnivarMeteorWarningState,
): ActiveIgnivarMeteorWarning[] {
  if (state.meteorImpactRemaining <= 0) return [];
  return state.meteorPoints.map((point, meteorIndex) => ({
    id: ignivarMeteorWarningId(bossId, state.meteorCastKey, meteorIndex),
    x: point.x,
    z: point.z,
    radius: IGNIVAR_METEOR_RADIUS,
    duration: IGNIVAR_METEOR_TELEGRAPH_SECONDS,
    remaining: Math.min(state.meteorImpactRemaining, IGNIVAR_METEOR_TELEGRAPH_SECONDS),
    warningLead: IGNIVAR_METEOR_REVEAL_DELAY_SECONDS,
  }));
}

function meteorCandidate(
  castKey: number,
  meteorIndex: number,
  attempt: number,
  arenaOrigin: IgnivarMeteorPoint,
  maxRange: number,
): IgnivarMeteorPoint {
  const sample = meteorIndex * IGNIVAR_METEOR_CANDIDATES + attempt;
  const angle = hash2(castKey, sample, 0x715f1e) * Math.PI * 2;
  const radiusNoise = hash2(castKey, sample, 0xc1d3a5);
  const radius = Math.sqrt(
    IGNIVAR_METEOR_MIN_RANGE ** 2 + radiusNoise * (maxRange ** 2 - IGNIVAR_METEOR_MIN_RANGE ** 2),
  );
  return {
    x: arenaOrigin.x + Math.sin(angle) * radius,
    z: arenaOrigin.z + Math.cos(angle) * radius,
  };
}

function clampMeteorToArena(
  point: IgnivarMeteorPoint,
  arenaOrigin: IgnivarMeteorPoint,
  maxRange: number,
): IgnivarMeteorPoint {
  const dx = point.x - arenaOrigin.x;
  const dz = point.z - arenaOrigin.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= maxRange || distance <= Number.EPSILON) return { x: point.x, z: point.z };
  const scale = maxRange / distance;
  return { x: arenaOrigin.x + dx * scale, z: arenaOrigin.z + dz * scale };
}

function targetedMeteorCandidate(
  castKey: number,
  meteorIndex: number,
  attempt: number,
  anchor: IgnivarMeteorPoint,
  arenaOrigin: IgnivarMeteorPoint,
  maxRange: number,
): IgnivarMeteorPoint {
  if (attempt === 0) return clampMeteorToArena(anchor, arenaOrigin, maxRange);
  const angle =
    hash2(castKey, meteorIndex * IGNIVAR_METEOR_CANDIDATES + attempt, 0x2a77e7) * Math.PI * 2;
  const radius =
    IGNIVAR_METEOR_RADIUS * 2 +
    hash2(castKey, meteorIndex * IGNIVAR_METEOR_CANDIDATES + attempt, 0x5ca77e) *
      (IGNIVAR_METEOR_TARGET_SCATTER_MAX - IGNIVAR_METEOR_RADIUS * 2);
  return clampMeteorToArena(
    { x: anchor.x + Math.sin(angle) * radius, z: anchor.z + Math.cos(angle) * radius },
    arenaOrigin,
    maxRange,
  );
}

/** Selects distinct meteor anchors without spending shared encounter RNG. */
export function ignivarMeteorTargetOrder(
  castKey: number,
  targets: readonly IgnivarMeteorTarget[],
  currentTankId: number | null,
  count: number,
): IgnivarMeteorTarget[] {
  return [...targets]
    .sort((first, second) => {
      const firstTank = first.id === currentTankId ? 1 : 0;
      const secondTank = second.id === currentTankId ? 1 : 0;
      if (firstTank !== secondTank) return firstTank - secondTank;
      const firstScore = hash2(castKey, first.id, 0x71a6e7);
      const secondScore = hash2(castKey, second.id, 0x71a6e7);
      return firstScore - secondScore || first.id - second.id;
    })
    .slice(0, count);
}

function clearOfPlacedMeteors(
  point: IgnivarMeteorPoint,
  placed: readonly IgnivarMeteorPoint[],
  minSeparation: number,
): boolean {
  return placed.every((other) => Math.hypot(point.x - other.x, point.z - other.z) >= minSeparation);
}

function fallbackMeteorPattern(
  castKey: number,
  arenaOrigin: IgnivarMeteorPoint,
  count: number,
  maxRange: number,
): IgnivarMeteorPoint[] {
  const phase = hash2(castKey, count, 0xfa11ba) * Math.PI * 2;
  return Array.from({ length: count }, (_, meteorIndex) => {
    const angle = phase + (meteorIndex * Math.PI * 2) / count;
    return {
      x: arenaOrigin.x + Math.sin(angle) * maxRange,
      z: arenaOrigin.z + Math.cos(angle) * maxRange,
    };
  });
}

/** Builds one repeatable, random-looking meteor pattern from the authoritative cast key. */
export function ignivarMeteorPattern(
  castKey: number,
  arenaOrigin: IgnivarMeteorPoint,
  difficulty: IgnivarMeteorDifficulty = 'normal',
  targets: readonly IgnivarMeteorTarget[] = [],
): IgnivarMeteorPoint[] {
  const heroic = difficulty === 'heroic';
  const count = heroic ? IGNIVAR_METEOR_COUNT_HEROIC : IGNIVAR_METEOR_COUNT_NORMAL;
  const maxRange = heroic ? IGNIVAR_METEOR_MAX_RANGE_HEROIC : IGNIVAR_METEOR_MAX_RANGE;
  const minSeparation = heroic
    ? IGNIVAR_METEOR_MIN_SEPARATION_HEROIC
    : IGNIVAR_METEOR_MIN_SEPARATION;
  const placed: IgnivarMeteorPoint[] = [];
  for (let meteorIndex = 0; meteorIndex < count; meteorIndex++) {
    let point: IgnivarMeteorPoint | null = null;
    const anchor = targets[meteorIndex];
    for (let attempt = 0; attempt < IGNIVAR_METEOR_CANDIDATES; attempt++) {
      const candidate = anchor
        ? targetedMeteorCandidate(castKey, meteorIndex, attempt, anchor, arenaOrigin, maxRange)
        : meteorCandidate(castKey, meteorIndex, attempt, arenaOrigin, maxRange);
      if (!clearOfPlacedMeteors(candidate, placed, minSeparation)) continue;
      point = candidate;
      break;
    }
    if (!point && anchor) {
      for (let attempt = 0; attempt < IGNIVAR_METEOR_CANDIDATES; attempt++) {
        const candidate = meteorCandidate(castKey, meteorIndex, attempt, arenaOrigin, maxRange);
        if (!clearOfPlacedMeteors(candidate, placed, minSeparation)) continue;
        point = candidate;
        break;
      }
    }
    if (!point) return fallbackMeteorPattern(castKey, arenaOrigin, count, maxRange);
    placed.push(point);
  }
  return placed;
}

/** True when a player is inside the exact circular warning footprint. */
export function pointInIgnivarMeteor(
  meteor: IgnivarMeteorPoint,
  point: IgnivarMeteorPoint,
): boolean {
  const dx = point.x - meteor.x;
  const dz = point.z - meteor.z;
  return dx * dx + dz * dz <= IGNIVAR_METEOR_RADIUS ** 2 + Number.EPSILON * 16;
}
