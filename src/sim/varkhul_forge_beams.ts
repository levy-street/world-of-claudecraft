// Pure geometry and tuning for the Master's Assembly forge-beam objective.
// Encounter mutation stays in encounters/varkhul.ts; render and wire consume
// the projected lane endpoints produced from this contract.

import type { VarkhulAssemblyDifficulty } from './varkhul_assembly';

export type VarkhulForgeBeamIndex = 0 | 1;

export interface VarkhulForgeBeamCandidate {
  id: number;
  x: number;
  z: number;
  dead: boolean;
}

export interface VarkhulForgeBeamAssignment {
  index: VarkhulForgeBeamIndex;
  blockerId: number | null;
  impactX: number;
  impactZ: number;
}

export const VARKHUL_FORGE_BEAM_COUNT = 2;
export const VARKHUL_FORGE_BEAM_COLUMN_DISTANCE = 28;
export const VARKHUL_FORGE_BEAM_BLOCKER_RADIUS = 1.35;
export const VARKHUL_FORGE_BEAM_MIN_PROGRESS = 0.12;
export const VARKHUL_FORGE_BEAM_MAX_PROGRESS = 0.8;
export const VARKHUL_FORGE_BEAM_WARMUP_SECONDS = 3;
export const VARKHUL_FORGE_BEAM_BLOCK_DAMAGE_TICK_SECONDS = 1;
export const VARKHUL_FORGE_BEAM_OVERHEAT_PER_UNBLOCKED_SECOND = 0.06;
export const VARKHUL_FORGE_BEAM_COOLING_PER_BLOCKED_SECOND = 0.02;
export const VARKHUL_FORGE_BEAM_IDLE_COOLING_PER_SECOND_NORMAL = 0.03;
export const VARKHUL_FORGE_QUAKE_OVERHEAT = 0.08;
export const VARKHUL_FORGE_MELTDOWN_TICK_SECONDS = 1;
export const VARKHUL_FORGE_MELTDOWN_DURATION_SECONDS = 5;
const PROGRESS_EPSILON = 1e-9;

export function varkhulForgeBeamColumns(forge: {
  x: number;
  z: number;
}): Array<{ index: VarkhulForgeBeamIndex; x: number; z: number }> {
  return [
    { index: 0, x: forge.x - VARKHUL_FORGE_BEAM_COLUMN_DISTANCE, z: forge.z },
    { index: 1, x: forge.x + VARKHUL_FORGE_BEAM_COLUMN_DISTANCE, z: forge.z },
  ];
}

function candidateProgress(
  column: { x: number; z: number },
  forge: { x: number; z: number },
  candidate: VarkhulForgeBeamCandidate,
): { progress: number; impactX: number; impactZ: number } | null {
  if (candidate.dead) return null;
  const dx = forge.x - column.x;
  const dz = forge.z - column.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq <= 0) return null;
  const progress = ((candidate.x - column.x) * dx + (candidate.z - column.z) * dz) / lengthSq;
  if (
    progress < VARKHUL_FORGE_BEAM_MIN_PROGRESS - PROGRESS_EPSILON ||
    progress > VARKHUL_FORGE_BEAM_MAX_PROGRESS + PROGRESS_EPSILON
  ) {
    return null;
  }
  const impactX = column.x + dx * progress;
  const impactZ = column.z + dz * progress;
  const perpendicularX = candidate.x - impactX;
  const perpendicularZ = candidate.z - impactZ;
  if (
    perpendicularX * perpendicularX + perpendicularZ * perpendicularZ >
    VARKHUL_FORGE_BEAM_BLOCKER_RADIUS * VARKHUL_FORGE_BEAM_BLOCKER_RADIUS
  ) {
    return null;
  }
  return { progress, impactX, impactZ };
}

export function varkhulForgeBeamImpactPosition(
  forge: { x: number; z: number },
  index: VarkhulForgeBeamIndex,
  candidate: VarkhulForgeBeamCandidate | null,
): { x: number; z: number } {
  if (!candidate) return { x: forge.x, z: forge.z };
  const column = varkhulForgeBeamColumns(forge)[index];
  const hit = candidateProgress(column, forge, candidate);
  return hit ? { x: hit.impactX, z: hit.impactZ } : { x: forge.x, z: forge.z };
}

/** The first living body hit from each column owns that beam's healer check. */
export function varkhulForgeBeamAssignments(
  forge: { x: number; z: number },
  candidates: readonly VarkhulForgeBeamCandidate[],
): VarkhulForgeBeamAssignment[] {
  const columns = varkhulForgeBeamColumns(forge);
  const usedPlayerIds = new Set<number>();
  return columns.map((column) => {
    let blockerId: number | null = null;
    let bestProgress = Number.POSITIVE_INFINITY;
    let impactX = forge.x;
    let impactZ = forge.z;
    for (const candidate of candidates) {
      if (usedPlayerIds.has(candidate.id)) continue;
      const hit = candidateProgress(column, forge, candidate);
      if (!hit) continue;
      if (
        hit.progress > bestProgress ||
        (hit.progress === bestProgress && blockerId !== null && candidate.id >= blockerId)
      ) {
        continue;
      }
      blockerId = candidate.id;
      bestProgress = hit.progress;
      impactX = hit.impactX;
      impactZ = hit.impactZ;
    }
    if (blockerId !== null) usedPlayerIds.add(blockerId);
    return { index: column.index, blockerId, impactX, impactZ };
  });
}

export function varkhulForgeBeamOverheatAfterTick(
  current: number,
  difficulty: VarkhulAssemblyDifficulty,
  activeBeamCount: number,
  blockedCount: number,
  dt: number,
): number {
  const safeActiveBeamCount = Math.max(
    0,
    Math.min(VARKHUL_FORGE_BEAM_COUNT, Math.floor(activeBeamCount)),
  );
  const safeBlockedCount = Math.max(0, Math.min(safeActiveBeamCount, Math.floor(blockedCount)));
  const unblockedCount = safeActiveBeamCount - safeBlockedCount;
  const deltaPerSecond =
    safeActiveBeamCount === 0
      ? difficulty === 'normal'
        ? -VARKHUL_FORGE_BEAM_IDLE_COOLING_PER_SECOND_NORMAL
        : 0
      : unblockedCount * VARKHUL_FORGE_BEAM_OVERHEAT_PER_UNBLOCKED_SECOND -
        (difficulty === 'normal'
          ? safeBlockedCount * VARKHUL_FORGE_BEAM_COOLING_PER_BLOCKED_SECOND
          : 0);
  return Math.max(0, Math.min(1, current + deltaPerSecond * Math.max(0, dt)));
}

export function varkhulForgeOverheatAfterQuake(
  current: number,
  difficulty: VarkhulAssemblyDifficulty,
): number {
  const addedHeat = difficulty === 'heroic' ? 0.1 : VARKHUL_FORGE_QUAKE_OVERHEAT;
  return Math.max(0, Math.min(1, current + addedHeat));
}

export function varkhulForgeBeamBlockDamageMaxHp(
  difficulty: VarkhulAssemblyDifficulty,
  exposureStack: number,
): number {
  const safeStack = Math.max(1, Math.floor(exposureStack));
  const base = difficulty === 'heroic' ? 0.1 : 0.07;
  const growth = difficulty === 'heroic' ? 0.03 : 0.02;
  return base + (safeStack - 1) * growth;
}

export function varkhulForgeBeamExposureResetSeconds(
  difficulty: VarkhulAssemblyDifficulty,
): number {
  return difficulty === 'heroic' ? 60 : 10;
}

export function varkhulForgeMeltdownInitialDamageMaxHp(
  difficulty: VarkhulAssemblyDifficulty,
): number {
  return difficulty === 'heroic' ? 0.75 : 0.65;
}

export function varkhulForgeMeltdownTickDamageMaxHp(difficulty: VarkhulAssemblyDifficulty): number {
  return difficulty === 'heroic' ? 0.2 : 0.15;
}
