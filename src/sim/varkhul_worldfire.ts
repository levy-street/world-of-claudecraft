// Pure Heroic final-phase geometry and tuning for Varkhul's Worldfire.
// Encounter mutation and damage stay in encounters/varkhul.ts; render consumes
// the compact projection below. The room closes in discrete, deterministic
// bands so gameplay, reconnects, Low graphics, and reduced motion agree.

import type { VarkhulAssemblyDifficulty } from './varkhul_assembly';

export const VARKHUL_WORLDFIRE_ABILITY_ID = 'Worldfire';
export const VARKHUL_WORLDFIRE_TOTAL_SECONDS = 45;
export const VARKHUL_WORLDFIRE_FILL_SECONDS = 42;
export const VARKHUL_WORLDFIRE_STAGES = 6;
export const VARKHUL_WORLDFIRE_STAGE_SECONDS =
  VARKHUL_WORLDFIRE_FILL_SECONDS / VARKHUL_WORLDFIRE_STAGES;
export const VARKHUL_WORLDFIRE_ARENA_RADIUS = 40;
export const VARKHUL_WORLDFIRE_INITIAL_SAFE_RADIUS = 36;
export const VARKHUL_WORLDFIRE_TICK_SECONDS = 1;
export const VARKHUL_WORLDFIRE_DAMAGE_MAX_HP = 0.12;
export const VARKHUL_WORLDFIRE_FULL_DAMAGE_MAX_HP = 0.3;

export interface ActiveVarkhulWorldfire {
  bossId: number;
  centerX: number;
  centerZ: number;
  arenaRadius: number;
  safeRadius: number;
  stage: number;
  stages: number;
  remaining: number;
  untilFull: number;
  duration: number;
  full: boolean;
}

export function varkhulWorldfireStage(remaining: number): number {
  const safeRemaining = Math.max(0, Math.min(VARKHUL_WORLDFIRE_TOTAL_SECONDS, remaining));
  const elapsed = VARKHUL_WORLDFIRE_TOTAL_SECONDS - safeRemaining;
  return Math.min(
    VARKHUL_WORLDFIRE_STAGES,
    Math.floor((elapsed + 1e-9) / VARKHUL_WORLDFIRE_STAGE_SECONDS),
  );
}

export function varkhulWorldfireMarkerRemaining(remaining: number, permanent = false): number {
  if (permanent || !Number.isFinite(remaining)) return 0;
  return Math.max(0, remaining);
}

export function varkhulWorldfireSafeRadius(stage: number): number {
  const safeStage = Math.max(0, Math.min(VARKHUL_WORLDFIRE_STAGES, Math.floor(stage)));
  return (
    (VARKHUL_WORLDFIRE_INITIAL_SAFE_RADIUS * (VARKHUL_WORLDFIRE_STAGES - safeStage)) /
    VARKHUL_WORLDFIRE_STAGES
  );
}

export function varkhulWorldfireBurnsPosition(
  center: { x: number; z: number },
  position: { x: number; z: number },
  stage: number,
): boolean {
  const safeRadius = varkhulWorldfireSafeRadius(stage);
  if (safeRadius <= 0) return true;
  const dx = position.x - center.x;
  const dz = position.z - center.z;
  return dx * dx + dz * dz >= safeRadius * safeRadius;
}

export function varkhulWorldfireDamageMaxHp(stage: number): number {
  return Math.floor(stage) >= VARKHUL_WORLDFIRE_STAGES
    ? VARKHUL_WORLDFIRE_FULL_DAMAGE_MAX_HP
    : VARKHUL_WORLDFIRE_DAMAGE_MAX_HP;
}

export function activeVarkhulWorldfire(
  bossId: number,
  difficulty: VarkhulAssemblyDifficulty,
  triggered: boolean,
  remaining: number,
  center: { x: number; z: number },
): ActiveVarkhulWorldfire | null {
  if (difficulty !== 'heroic' || !triggered) return null;
  const safeRemaining = Math.max(0, Math.min(VARKHUL_WORLDFIRE_TOTAL_SECONDS, remaining));
  const stage = varkhulWorldfireStage(safeRemaining);
  return {
    bossId,
    centerX: center.x,
    centerZ: center.z,
    arenaRadius: VARKHUL_WORLDFIRE_ARENA_RADIUS,
    safeRadius: varkhulWorldfireSafeRadius(stage),
    stage,
    stages: VARKHUL_WORLDFIRE_STAGES,
    remaining: safeRemaining,
    untilFull: Math.max(
      0,
      safeRemaining - (VARKHUL_WORLDFIRE_TOTAL_SECONDS - VARKHUL_WORLDFIRE_FILL_SECONDS),
    ),
    duration: VARKHUL_WORLDFIRE_TOTAL_SECONDS,
    full: stage >= VARKHUL_WORLDFIRE_STAGES,
  };
}
