// Pure geometry and tuning for Ignivar's expanding Forge Wave.
// The encounter coordinator owns timing and damage; render reuses the same
// radius and gap contract so every host shows the authoritative danger shape.

import type { DungeonDifficulty } from './types';

export interface IgnivarForgeWavePoint {
  x: number;
  z: number;
}

export const IGNIVAR_FIRST_FORGE_WAVE_SECONDS = 50;
export const IGNIVAR_FORGE_WAVE_EVERY = 60;
export const IGNIVAR_FORGE_WAVE_WINDUP_SECONDS = 2.5;
export const IGNIVAR_FORGE_WAVE_ACTIVE_SECONDS = 3;
// Covers the farthest pair of vertices in the 66 by 66 octagonal arena even
// when Ignivar is tanked against one wall (ceil(hypot(66, 28))).
export const IGNIVAR_FORGE_WAVE_RANGE = 72;
export const IGNIVAR_FORGE_WAVE_GAP_HALF_ANGLE = Math.PI / 12;
export const IGNIVAR_FORGE_WAVE_WALL_HALF_THICKNESS = 0.75;
export const IGNIVAR_FORGE_WAVE_DAMAGE_MAX_HP = 0.5;
export const IGNIVAR_FORGE_WAVE_DAMAGE_MAX_HP_HEROIC = 0.8;
// Normal keeps the brief impact nudge. Heroic carries victims farther toward
// the arena moat while the expanding wall still damages each player only once.
export const IGNIVAR_FORGE_WAVE_KNOCKBACK_NORMAL = 4;
export const IGNIVAR_FORGE_WAVE_KNOCKBACK_HEROIC = 6;

const TAU = Math.PI * 2;

export function ignivarForgeWaveKnockback(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? IGNIVAR_FORGE_WAVE_KNOCKBACK_HEROIC
    : IGNIVAR_FORGE_WAVE_KNOCKBACK_NORMAL;
}

export function ignivarForgeWaveDamageMaxHp(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? IGNIVAR_FORGE_WAVE_DAMAGE_MAX_HP_HEROIC
    : IGNIVAR_FORGE_WAVE_DAMAGE_MAX_HP;
}

function angleDistance(a: number, b: number): number {
  const wrapped = (((a - b + Math.PI) % TAU) + TAU) % TAU;
  return Math.abs(wrapped - Math.PI);
}

export function ignivarForgeWaveRadius(activeRemaining: number): number {
  const progress = Math.min(
    1,
    Math.max(0, 1 - activeRemaining / IGNIVAR_FORGE_WAVE_ACTIVE_SECONDS),
  );
  return IGNIVAR_FORGE_WAVE_RANGE * progress;
}

export function ignivarPointInForgeWaveGap(
  origin: IgnivarForgeWavePoint,
  gapFacing: number,
  point: IgnivarForgeWavePoint,
): boolean {
  const dx = point.x - origin.x;
  const dz = point.z - origin.z;
  if (Math.hypot(dx, dz) < 1e-4) return false;
  const angle = Math.atan2(dx, dz);
  return (
    angleDistance(angle, gapFacing) <= IGNIVAR_FORGE_WAVE_GAP_HALF_ANGLE ||
    angleDistance(angle, gapFacing + Math.PI) <= IGNIVAR_FORGE_WAVE_GAP_HALF_ANGLE
  );
}

export function ignivarPointSweptByForgeWave(
  origin: IgnivarForgeWavePoint,
  gapFacing: number,
  previousRadius: number,
  nextRadius: number,
  point: IgnivarForgeWavePoint,
): boolean {
  if (ignivarPointInForgeWaveGap(origin, gapFacing, point)) return false;
  const radius = Math.hypot(point.x - origin.x, point.z - origin.z);
  const inner = Math.max(
    0,
    Math.min(previousRadius, nextRadius) - IGNIVAR_FORGE_WAVE_WALL_HALF_THICKNESS,
  );
  const outer = Math.max(previousRadius, nextRadius) + IGNIVAR_FORGE_WAVE_WALL_HALF_THICKNESS;
  return radius >= inner && radius <= outer;
}
