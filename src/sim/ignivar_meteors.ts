// Deterministic placement and collision math for Ignivar's independent meteor rain.
// The encounter driver owns cadence and damage, while render consumes the emitted
// warning event. Keeping the footprint here prevents warning and impact drift.

import { hash2 } from './rng';

export interface IgnivarMeteorPoint {
  x: number;
  z: number;
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

export const IGNIVAR_METEOR_COUNT = 5;
export const IGNIVAR_METEOR_RADIUS = 2.4;
export const IGNIVAR_METEOR_MIN_RANGE = 9;
export const IGNIVAR_METEOR_MAX_RANGE = 25;
export const IGNIVAR_METEOR_MIN_SEPARATION = 6;
export const IGNIVAR_METEOR_CAST_ID = 'Falling Cinders';
export const IGNIVAR_FIRST_METEOR_SECONDS = 13;
export const IGNIVAR_METEOR_EVERY = 17;
export const IGNIVAR_METEOR_TELEGRAPH_SECONDS = 2.5;
export const IGNIVAR_METEOR_REVEAL_DELAY_SECONDS = 0.75;
export const IGNIVAR_METEOR_DAMAGE_MAX_HP = 0.35;

const IGNIVAR_METEOR_CANDIDATES = 48;

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
): IgnivarMeteorPoint {
  const sample = meteorIndex * IGNIVAR_METEOR_CANDIDATES + attempt;
  const angle = hash2(castKey, sample, 0x715f1e) * Math.PI * 2;
  const radiusNoise = hash2(castKey, sample, 0xc1d3a5);
  const radius = Math.sqrt(
    IGNIVAR_METEOR_MIN_RANGE ** 2 +
      radiusNoise * (IGNIVAR_METEOR_MAX_RANGE ** 2 - IGNIVAR_METEOR_MIN_RANGE ** 2),
  );
  return {
    x: arenaOrigin.x + Math.sin(angle) * radius,
    z: arenaOrigin.z + Math.cos(angle) * radius,
  };
}

function clearOfPlacedMeteors(
  point: IgnivarMeteorPoint,
  placed: readonly IgnivarMeteorPoint[],
): boolean {
  return placed.every(
    (other) => Math.hypot(point.x - other.x, point.z - other.z) >= IGNIVAR_METEOR_MIN_SEPARATION,
  );
}

/** Builds one repeatable, random-looking meteor pattern from the authoritative cast key. */
export function ignivarMeteorPattern(
  castKey: number,
  arenaOrigin: IgnivarMeteorPoint,
): IgnivarMeteorPoint[] {
  const placed: IgnivarMeteorPoint[] = [];
  for (let meteorIndex = 0; meteorIndex < IGNIVAR_METEOR_COUNT; meteorIndex++) {
    let point: IgnivarMeteorPoint | null = null;
    for (let attempt = 0; attempt < IGNIVAR_METEOR_CANDIDATES; attempt++) {
      const candidate = meteorCandidate(castKey, meteorIndex, attempt, arenaOrigin);
      if (!clearOfPlacedMeteors(candidate, placed)) continue;
      point = candidate;
      break;
    }
    if (!point) {
      const phase = hash2(castKey, meteorIndex, 0xfa11ba) * Math.PI * 2;
      const angle = phase + (meteorIndex * Math.PI * 2) / IGNIVAR_METEOR_COUNT;
      point = {
        x: arenaOrigin.x + Math.sin(angle) * IGNIVAR_METEOR_MAX_RANGE,
        z: arenaOrigin.z + Math.cos(angle) * IGNIVAR_METEOR_MAX_RANGE,
      };
    }
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
