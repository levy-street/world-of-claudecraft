// Grave Eruption and Grave Flame: Nythraxis's telegraphed floor circles and the
// burning ground they leave behind.
//
// Every cast, skeletal hands burst from the floor under distinct random players
// (the aggro holder sorted last): a 3 yd warning ring for the telegraph window,
// then a max-hp burst to anyone still inside, and a Grave Flame patch on the
// same circle that keeps burning for a while. Placement, target order, and the
// reconnect-safe readouts live here; the driver in encounters/nythraxis.ts owns
// cadence, damage, and the flame drain. Placement spends NO shared encounter
// rng: it hashes the cast key, the way Ignivar's meteors do, so adding the
// mechanic moves no other draw.
//
// `src/sim`-pure: no rng stream, no wall clock, no DOM.

import { NYTHRAXIS_FLAME_PERMANENT_SECONDS, nythraxisSoulfireSeconds } from './nythraxis_soulfire';
import { hash2 } from './rng';
import type { DungeonDifficulty } from './types';

export interface NythraxisGravePoint {
  x: number;
  z: number;
}

export interface NythraxisGraveTarget extends NythraxisGravePoint {
  id: number;
}

/** Which fire a patch is: Grave Flame (an eruption's residue) or Soulfire (a
 *  Soul Rend detonation's pool, nythraxis_soulfire.ts). Both ride this one
 *  list so the driver's flame tick, the readout, the wire, and the renderer
 *  carry both; only palette, radius, duration, and tick differ by kind. */
export type NythraxisFlameKind = 'grave' | 'soul';

/** A live burning patch on the encounter state. */
export interface NythraxisGraveFlame extends NythraxisGravePoint {
  seq: number;
  kind: NythraxisFlameKind;
  radius: number;
  remaining: number;
  tickTimer: number;
}

/** The slice of encounter state the eruption readouts project. */
export interface NythraxisGraveEruptionState {
  eruptionCastKey: number;
  eruptionImpactRemaining: number;
  eruptionPoints: readonly NythraxisGravePoint[];
  graveFlames: readonly NythraxisGraveFlame[];
}

/** Same shape as the meteor warnings so the renderer's warning ring path is shared. */
export interface ActiveNythraxisGraveEruption extends NythraxisGravePoint {
  id: string;
  radius: number;
  duration: number;
  remaining: number;
  warningLead: number;
}

export interface ActiveNythraxisGraveFlame extends NythraxisGravePoint {
  id: string;
  sourceId: number;
  kind: NythraxisFlameKind;
  radius: number;
  duration: number;
  remaining: number;
}

export const NYTHRAXIS_GRAVE_ERUPTION_CAST_ID = 'Grave Eruption';
export const NYTHRAXIS_GRAVE_FLAME_CAST_ID = 'Grave Flame';
export const NYTHRAXIS_GRAVE_ERUPTION_FIRST_SECONDS = 8;
export const NYTHRAXIS_GRAVE_ERUPTION_EVERY_NORMAL = 15;
export const NYTHRAXIS_GRAVE_ERUPTION_EVERY_HEROIC = 12;
export const NYTHRAXIS_GRAVE_ERUPTION_COUNT_NORMAL = 4;
export const NYTHRAXIS_GRAVE_ERUPTION_COUNT_HEROIC = 6;
export const NYTHRAXIS_GRAVE_ERUPTION_RADIUS = 3;
export const NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS = 2.5;
export const NYTHRAXIS_GRAVE_ERUPTION_REVEAL_DELAY_SECONDS = 0.75;
export const NYTHRAXIS_GRAVE_ERUPTION_DAMAGE_MAX_HP_NORMAL = 0.45;
export const NYTHRAXIS_GRAVE_ERUPTION_DAMAGE_MAX_HP_HEROIC = 0.75;
export const NYTHRAXIS_GRAVE_FLAME_SECONDS_NORMAL = 12;
// Heroic patches never time out (they clear with the transition or a reset):
// the floor fills unless the raid keeps moving.
export const NYTHRAXIS_GRAVE_FLAME_SECONDS_HEROIC = NYTHRAXIS_FLAME_PERMANENT_SECONDS;
export const NYTHRAXIS_GRAVE_FLAME_TICK_SECONDS = 1;
export const NYTHRAXIS_GRAVE_FLAME_TICK_MAX_HP_NORMAL = 0.06;
export const NYTHRAXIS_GRAVE_FLAME_TICK_MAX_HP_HEROIC = 0.09;
/** Oldest patches expire first past this many live flames. */
export const NYTHRAXIS_GRAVE_FLAME_CAP = 24;
// How far from the boss spawn an eruption may land: the raid fights inside this
// band of the crypt hall, and the arena walls sit far beyond it.
export const NYTHRAXIS_GRAVE_ERUPTION_MAX_RANGE = 32;
export const NYTHRAXIS_GRAVE_ERUPTION_MIN_SEPARATION = 5;

const ERUPTION_CANDIDATES = 32;
const ERUPTION_TARGET_SCATTER_MAX = 9;

export function nythraxisGraveEruptionCadence(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_GRAVE_ERUPTION_EVERY_HEROIC
    : NYTHRAXIS_GRAVE_ERUPTION_EVERY_NORMAL;
}

export function nythraxisGraveEruptionCount(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_GRAVE_ERUPTION_COUNT_HEROIC
    : NYTHRAXIS_GRAVE_ERUPTION_COUNT_NORMAL;
}

export function nythraxisGraveEruptionDamageMaxHp(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_GRAVE_ERUPTION_DAMAGE_MAX_HP_HEROIC
    : NYTHRAXIS_GRAVE_ERUPTION_DAMAGE_MAX_HP_NORMAL;
}

export function nythraxisGraveFlameSeconds(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_GRAVE_FLAME_SECONDS_HEROIC
    : NYTHRAXIS_GRAVE_FLAME_SECONDS_NORMAL;
}

export function nythraxisGraveFlameTickMaxHp(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_GRAVE_FLAME_TICK_MAX_HP_HEROIC
    : NYTHRAXIS_GRAVE_FLAME_TICK_MAX_HP_NORMAL;
}

export function nythraxisGraveEruptionId(
  bossId: number,
  castKey: number,
  eruptionIndex: number,
): string {
  return `${bossId}:ge:${castKey}:${eruptionIndex}`;
}

export function nythraxisGraveFlameId(bossId: number, seq: number): string {
  return `${bossId}:gf:${seq}`;
}

/** Projects the live warning window into reconnect-safe presentation rows. */
export function activeNythraxisGraveEruptions(
  bossId: number,
  state: NythraxisGraveEruptionState,
): ActiveNythraxisGraveEruption[] {
  if (state.eruptionImpactRemaining <= 0) return [];
  return state.eruptionPoints.map((point, eruptionIndex) => ({
    id: nythraxisGraveEruptionId(bossId, state.eruptionCastKey, eruptionIndex),
    x: point.x,
    z: point.z,
    radius: NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
    duration: NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS,
    remaining: Math.min(state.eruptionImpactRemaining, NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS),
    warningLead: NYTHRAXIS_GRAVE_ERUPTION_REVEAL_DELAY_SECONDS,
  }));
}

/** How long a patch of this kind burns from ignition. */
export function nythraxisFlameSeconds(
  kind: NythraxisFlameKind,
  difficulty: DungeonDifficulty,
): number {
  return kind === 'soul'
    ? nythraxisSoulfireSeconds(difficulty)
    : nythraxisGraveFlameSeconds(difficulty);
}

/** Projects every burning patch (Grave Flame and Soulfire) into reconnect-safe rows. */
export function activeNythraxisGraveFlames(
  bossId: number,
  state: NythraxisGraveEruptionState,
  difficulty: DungeonDifficulty,
): ActiveNythraxisGraveFlame[] {
  const flames: ActiveNythraxisGraveFlame[] = [];
  for (const flame of state.graveFlames) {
    if (flame.remaining <= 0) continue;
    const duration = nythraxisFlameSeconds(flame.kind, difficulty);
    flames.push({
      id: nythraxisGraveFlameId(bossId, flame.seq),
      sourceId: bossId,
      kind: flame.kind,
      x: flame.x,
      z: flame.z,
      radius: flame.radius,
      duration,
      remaining: Math.min(flame.remaining, duration),
    });
  }
  return flames;
}

/** Distinct anchors without spending shared rng: the aggro holder sorts last. */
export function nythraxisGraveEruptionTargetOrder(
  castKey: number,
  targets: readonly NythraxisGraveTarget[],
  aggroTargetId: number | null,
  count: number,
): NythraxisGraveTarget[] {
  return [...targets]
    .sort((first, second) => {
      const firstTank = first.id === aggroTargetId ? 1 : 0;
      const secondTank = second.id === aggroTargetId ? 1 : 0;
      if (firstTank !== secondTank) return firstTank - secondTank;
      const firstScore = hash2(castKey, first.id, 0x6e7a11);
      const secondScore = hash2(castKey, second.id, 0x6e7a11);
      return firstScore - secondScore || first.id - second.id;
    })
    .slice(0, count);
}

function clampToRange(
  point: NythraxisGravePoint,
  origin: NythraxisGravePoint,
  maxRange: number,
): NythraxisGravePoint {
  const dx = point.x - origin.x;
  const dz = point.z - origin.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= maxRange || distance <= Number.EPSILON) return { x: point.x, z: point.z };
  const scale = maxRange / distance;
  return { x: origin.x + dx * scale, z: origin.z + dz * scale };
}

function anchoredCandidate(
  castKey: number,
  eruptionIndex: number,
  attempt: number,
  anchor: NythraxisGravePoint,
  origin: NythraxisGravePoint,
): NythraxisGravePoint {
  if (attempt === 0) return clampToRange(anchor, origin, NYTHRAXIS_GRAVE_ERUPTION_MAX_RANGE);
  const sample = eruptionIndex * ERUPTION_CANDIDATES + attempt;
  const angle = hash2(castKey, sample, 0x3b9e11) * Math.PI * 2;
  const radius =
    NYTHRAXIS_GRAVE_ERUPTION_RADIUS * 2 +
    hash2(castKey, sample, 0x51de77) *
      (ERUPTION_TARGET_SCATTER_MAX - NYTHRAXIS_GRAVE_ERUPTION_RADIUS * 2);
  return clampToRange(
    { x: anchor.x + Math.sin(angle) * radius, z: anchor.z + Math.cos(angle) * radius },
    origin,
    NYTHRAXIS_GRAVE_ERUPTION_MAX_RANGE,
  );
}

function freeCandidate(
  castKey: number,
  eruptionIndex: number,
  attempt: number,
  origin: NythraxisGravePoint,
): NythraxisGravePoint {
  const sample = eruptionIndex * ERUPTION_CANDIDATES + attempt;
  const angle = hash2(castKey, sample, 0x715f1e) * Math.PI * 2;
  const radius = Math.sqrt(hash2(castKey, sample, 0xc1d3a5)) * NYTHRAXIS_GRAVE_ERUPTION_MAX_RANGE;
  return { x: origin.x + Math.sin(angle) * radius, z: origin.z + Math.cos(angle) * radius };
}

function clearOfPlaced(
  point: NythraxisGravePoint,
  placed: readonly NythraxisGravePoint[],
): boolean {
  return placed.every(
    (other) =>
      Math.hypot(point.x - other.x, point.z - other.z) >= NYTHRAXIS_GRAVE_ERUPTION_MIN_SEPARATION,
  );
}

function fallbackPattern(
  castKey: number,
  origin: NythraxisGravePoint,
  count: number,
): NythraxisGravePoint[] {
  const phase = hash2(castKey, count, 0xfa11ba) * Math.PI * 2;
  const ring = NYTHRAXIS_GRAVE_ERUPTION_MAX_RANGE / 2;
  return Array.from({ length: count }, (_, eruptionIndex) => {
    const angle = phase + (eruptionIndex * Math.PI * 2) / count;
    return { x: origin.x + Math.sin(angle) * ring, z: origin.z + Math.cos(angle) * ring };
  });
}

/**
 * One repeatable eruption pattern from the cast key: under each ordered target
 * when the circles fit, scattered nearby when they collide, and a ring of free
 * circles for any slot without a target.
 */
export function nythraxisGraveEruptionPattern(
  castKey: number,
  origin: NythraxisGravePoint,
  count: number,
  targets: readonly NythraxisGraveTarget[],
): NythraxisGravePoint[] {
  const placed: NythraxisGravePoint[] = [];
  for (let eruptionIndex = 0; eruptionIndex < count; eruptionIndex++) {
    let point: NythraxisGravePoint | null = null;
    const anchor = targets[eruptionIndex];
    for (let attempt = 0; attempt < ERUPTION_CANDIDATES; attempt++) {
      const candidate = anchor
        ? anchoredCandidate(castKey, eruptionIndex, attempt, anchor, origin)
        : freeCandidate(castKey, eruptionIndex, attempt, origin);
      if (!clearOfPlaced(candidate, placed)) continue;
      point = candidate;
      break;
    }
    if (!point && anchor) {
      for (let attempt = 0; attempt < ERUPTION_CANDIDATES; attempt++) {
        const candidate = freeCandidate(castKey, eruptionIndex, attempt, origin);
        if (!clearOfPlaced(candidate, placed)) continue;
        point = candidate;
        break;
      }
    }
    if (!point) return fallbackPattern(castKey, origin, count);
    placed.push(point);
  }
  return placed;
}

/** True when a point is inside a circle of `radius` (edge inclusive). */
export function pointInNythraxisCircle(
  circle: NythraxisGravePoint,
  radius: number,
  point: NythraxisGravePoint,
): boolean {
  const dx = point.x - circle.x;
  const dz = point.z - circle.z;
  return dx * dx + dz * dz <= radius * radius + Number.EPSILON * 16;
}

/** True when a point is inside the exact eruption footprint (the warning ring). */
export function pointInNythraxisGraveCircle(
  circle: NythraxisGravePoint,
  point: NythraxisGravePoint,
): boolean {
  return pointInNythraxisCircle(circle, NYTHRAXIS_GRAVE_ERUPTION_RADIUS, point);
}

/**
 * Append the Grave Flame patches an impact leaves behind, expiring the oldest
 * Grave Flame past the cap while leaving any Soulfire pools in the same list
 * untouched. Returns the next sequence number.
 */
export function igniteNythraxisGraveFlames(
  flames: NythraxisGraveFlame[],
  points: readonly NythraxisGravePoint[],
  seq: number,
  duration: number,
): number {
  let next = seq;
  for (const point of points) {
    flames.push({
      seq: next++,
      kind: 'grave',
      radius: NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
      x: point.x,
      z: point.z,
      remaining: duration,
      tickTimer: NYTHRAXIS_GRAVE_FLAME_TICK_SECONDS,
    });
  }
  let graveCount = 0;
  for (const flame of flames) if (flame.kind === 'grave') graveCount++;
  for (let i = 0; i < flames.length && graveCount > NYTHRAXIS_GRAVE_FLAME_CAP; ) {
    if (flames[i].kind === 'grave') {
      flames.splice(i, 1);
      graveCount--;
    } else {
      i++;
    }
  }
  return next;
}
