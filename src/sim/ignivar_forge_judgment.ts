// Pure geometry and timing for Ignivar's Forge Judgment intermission.
// One random rotation produces three well-separated shelters. The simulation
// and renderer share every point and radius so the unique safe refuge cannot
// drift across hosts, reconnects, or graphics tiers.

import type { DungeonDifficulty } from './types';

export interface IgnivarJudgmentPoint {
  x: number;
  z: number;
}

export type IgnivarJudgmentShelterIndex = 0 | 1 | 2;

export const IGNIVAR_JUDGMENT_HP_THRESHOLD = 0.45;
export const IGNIVAR_JUDGMENT_WARNING_SECONDS = 4;
export const IGNIVAR_JUDGMENT_ACTIVE_SECONDS = 8;
export const IGNIVAR_JUDGMENT_DURATION_SECONDS =
  IGNIVAR_JUDGMENT_WARNING_SECONDS + IGNIVAR_JUDGMENT_ACTIVE_SECONDS;
export const IGNIVAR_JUDGMENT_SHELTER_COUNT = 3;
export const IGNIVAR_JUDGMENT_LAYOUT_SLOTS = 24;
export const IGNIVAR_JUDGMENT_SHELTER_RADIUS = 5.5;
export const IGNIVAR_JUDGMENT_ARENA_RADIUS = 34;
export const IGNIVAR_JUDGMENT_PULSE_SECONDS = 0.5;
export const IGNIVAR_JUDGMENT_BURN_DAMAGE_MAX_HP = 0.2;
export const IGNIVAR_JUDGMENT_BURN_DAMAGE_MAX_HP_HEROIC = 0.35;

export function ignivarJudgmentBurnDamageMaxHp(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? IGNIVAR_JUDGMENT_BURN_DAMAGE_MAX_HP_HEROIC
    : IGNIVAR_JUDGMENT_BURN_DAMAGE_MAX_HP;
}

const SHELTER_RING_RADIUS = 16;
const SHELTER_RADIUS_JITTER = 2.25;
const SHELTER_ANGLE_JITTER = 0.2;

export function ignivarForgeLayoutFacing(
  slot: number,
  safeIndex: IgnivarJudgmentShelterIndex,
): number {
  const normalizedSlot =
    ((Math.trunc(slot) % IGNIVAR_JUDGMENT_LAYOUT_SLOTS) + IGNIVAR_JUDGMENT_LAYOUT_SLOTS) %
    IGNIVAR_JUDGMENT_LAYOUT_SLOTS;
  return (safeIndex * IGNIVAR_JUDGMENT_LAYOUT_SLOTS + normalizedSlot) / 100;
}

export function ignivarForgeLayoutFromFacing(facing: number): {
  rotation: number;
  safeIndex: IgnivarJudgmentShelterIndex;
} {
  const maxCode = IGNIVAR_JUDGMENT_LAYOUT_SLOTS * IGNIVAR_JUDGMENT_SHELTER_COUNT - 1;
  const code = Math.max(0, Math.min(maxCode, Math.round(facing * 100)));
  const safeIndex = Math.floor(code / IGNIVAR_JUDGMENT_LAYOUT_SLOTS) as IgnivarJudgmentShelterIndex;
  const slot = code % IGNIVAR_JUDGMENT_LAYOUT_SLOTS;
  return {
    rotation: (slot * Math.PI * 2) / IGNIVAR_JUDGMENT_LAYOUT_SLOTS,
    safeIndex,
  };
}

export function ignivarForgeShelterOffsets(rotation: number): IgnivarJudgmentPoint[] {
  return Array.from({ length: IGNIVAR_JUDGMENT_SHELTER_COUNT }, (_, index) => {
    const angle =
      rotation +
      (index * Math.PI * 2) / IGNIVAR_JUDGMENT_SHELTER_COUNT +
      Math.sin(rotation * 1.7 + index * 4.1) * SHELTER_ANGLE_JITTER;
    const radius =
      SHELTER_RING_RADIUS + Math.sin(rotation * 2.3 + index * 2.7) * SHELTER_RADIUS_JITTER;
    return {
      x: Math.sin(angle) * radius,
      z: Math.cos(angle) * radius,
    };
  });
}

export function ignivarForgeShelterPoints(
  origin: IgnivarJudgmentPoint,
  rotation: number,
): IgnivarJudgmentPoint[] {
  return ignivarForgeShelterOffsets(rotation).map((offset) => ({
    x: origin.x + offset.x,
    z: origin.z + offset.z,
  }));
}

export function ignivarClosestForgeShelterIndex(
  origin: IgnivarJudgmentPoint,
  rotation: number,
  point: IgnivarJudgmentPoint,
): IgnivarJudgmentShelterIndex {
  const shelters = ignivarForgeShelterPoints(origin, rotation);
  let closest: IgnivarJudgmentShelterIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < shelters.length; index++) {
    const dx = point.x - shelters[index].x;
    const dz = point.z - shelters[index].z;
    const distance = dx * dx + dz * dz;
    if (distance >= closestDistance) continue;
    closest = index as IgnivarJudgmentShelterIndex;
    closestDistance = distance;
  }
  return closest;
}

export function ignivarPointInForgeShelter(
  origin: IgnivarJudgmentPoint,
  rotation: number,
  safeIndex: IgnivarJudgmentShelterIndex,
  point: IgnivarJudgmentPoint,
): boolean {
  const shelter = ignivarForgeShelterPoints(origin, rotation)[safeIndex];
  const dx = point.x - shelter.x;
  const dz = point.z - shelter.z;
  return dx * dx + dz * dz <= IGNIVAR_JUDGMENT_SHELTER_RADIUS ** 2 + Number.EPSILON * 16;
}

export function ignivarPointOnJudgmentFire(
  origin: IgnivarJudgmentPoint,
  rotation: number,
  safeIndex: IgnivarJudgmentShelterIndex,
  point: IgnivarJudgmentPoint,
): boolean {
  const distance = Math.hypot(point.x - origin.x, point.z - origin.z);
  if (distance > IGNIVAR_JUDGMENT_ARENA_RADIUS + Number.EPSILON * 16) return false;
  return !ignivarPointInForgeShelter(origin, rotation, safeIndex, point);
}
