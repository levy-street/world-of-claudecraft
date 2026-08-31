// Pure targeting, interception geometry, and tuning for Varkhul's moving
// player-to-boss ray. Encounter mutation stays in encounters/varkhul.ts;
// snapshot projection and render consume the same authoritative corridor.

import type { VarkhulAssemblyDifficulty } from './varkhul_assembly';

export type VarkhulInterceptBeamCandidate =
  | { id: number; x: number; z: number; dead: boolean }
  | { id: number; pos: { x: number; z: number }; dead: boolean };

export interface VarkhulInterceptBeamHit {
  blockerId: number;
  x: number;
  z: number;
  progress: number;
}

export interface ActiveVarkhulInterceptBeam {
  sourceId: number;
  targetId: number;
  blockerId: number | null;
  sourceX: number;
  sourceZ: number;
  targetX: number;
  targetZ: number;
  blockerX: number | null;
  blockerZ: number | null;
  width: number;
  duration: number;
  remaining: number;
}

export interface VarkhulInterceptBeamProjectionState {
  interceptBeamTargetId: number | null;
  interceptBeamBlockerId: number | null;
  interceptBeamCastRemaining: number;
}

export const VARKHUL_INTERCEPT_BEAM_CAST_ID = 'Tempering Ray';
export const VARKHUL_INTERCEPT_BEAM_DEBUFF_AURA_ID = 'varkhul_tempered_wound';
export const VARKHUL_INTERCEPT_BEAM_DEBUFF_NAME = 'Tempered Wound';
export const VARKHUL_INTERCEPT_BEAM_CAST_SECONDS = 5;
export const VARKHUL_INTERCEPT_BEAM_FIRST_SECONDS = 17;
export const VARKHUL_INTERCEPT_BEAM_EVERY_SECONDS = 32;
export const VARKHUL_INTERCEPT_BEAM_HALF_WIDTH = 1.35;
export const VARKHUL_INTERCEPT_BEAM_DEBUFF_SECONDS = 30;
export const VARKHUL_INTERCEPT_BEAM_DEBUFF_DAMAGE_TAKEN = 0.5;
export const VARKHUL_INTERCEPT_BEAM_BLOCKED_DAMAGE_MAX_HP_NORMAL = 0.7;
export const VARKHUL_INTERCEPT_BEAM_BLOCKED_DAMAGE_MAX_HP_HEROIC = 0.85;
export const VARKHUL_INTERCEPT_BEAM_UNBLOCKED_DAMAGE_MAX_HP_NORMAL = 0.9;
export const VARKHUL_INTERCEPT_BEAM_UNBLOCKED_DAMAGE_MAX_HP_HEROIC = 1.2;

const PROGRESS_EPSILON = 1e-9;

export function varkhulInterceptBeamDamageMaxHp(
  difficulty: VarkhulAssemblyDifficulty,
  blocked: boolean,
): number {
  if (blocked) {
    return difficulty === 'heroic'
      ? VARKHUL_INTERCEPT_BEAM_BLOCKED_DAMAGE_MAX_HP_HEROIC
      : VARKHUL_INTERCEPT_BEAM_BLOCKED_DAMAGE_MAX_HP_NORMAL;
  }
  return difficulty === 'heroic'
    ? VARKHUL_INTERCEPT_BEAM_UNBLOCKED_DAMAGE_MAX_HP_HEROIC
    : VARKHUL_INTERCEPT_BEAM_UNBLOCKED_DAMAGE_MAX_HP_NORMAL;
}

/** The first living body crossed by the ray owns the impact. */
export function varkhulInterceptBeamBlocker(
  source: { x: number; z: number },
  target: { x: number; z: number },
  targetId: number,
  candidates: readonly VarkhulInterceptBeamCandidate[],
): VarkhulInterceptBeamHit | null {
  const dx = target.x - source.x;
  const dz = target.z - source.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq <= PROGRESS_EPSILON) return null;

  let best: VarkhulInterceptBeamHit | null = null;
  for (const candidate of candidates) {
    if (candidate.dead || candidate.id === targetId) continue;
    const candidateX = 'pos' in candidate ? candidate.pos.x : candidate.x;
    const candidateZ = 'pos' in candidate ? candidate.pos.z : candidate.z;
    const progress = ((candidateX - source.x) * dx + (candidateZ - source.z) * dz) / lengthSq;
    if (progress <= PROGRESS_EPSILON || progress >= 1 - PROGRESS_EPSILON) continue;
    const x = source.x + dx * progress;
    const z = source.z + dz * progress;
    const offsetX = candidateX - x;
    const offsetZ = candidateZ - z;
    if (
      offsetX * offsetX + offsetZ * offsetZ >
      VARKHUL_INTERCEPT_BEAM_HALF_WIDTH * VARKHUL_INTERCEPT_BEAM_HALF_WIDTH
    ) {
      continue;
    }
    if (
      best &&
      (progress > best.progress + PROGRESS_EPSILON ||
        (Math.abs(progress - best.progress) <= PROGRESS_EPSILON && candidate.id >= best.blockerId))
    ) {
      continue;
    }
    best = { blockerId: candidate.id, x, z, progress };
  }
  return best;
}

export function activeVarkhulInterceptBeam(
  sourceId: number,
  source: { x: number; z: number },
  state: VarkhulInterceptBeamProjectionState,
  entityOf: (entityId: number) => { pos: { x: number; z: number }; dead: boolean } | undefined,
): ActiveVarkhulInterceptBeam | null {
  if (
    state.interceptBeamTargetId === null ||
    state.interceptBeamCastRemaining <= 0 ||
    !Number.isFinite(state.interceptBeamCastRemaining)
  ) {
    return null;
  }
  const target = entityOf(state.interceptBeamTargetId);
  if (!target || target.dead) return null;
  const blocker =
    state.interceptBeamBlockerId === null ? undefined : entityOf(state.interceptBeamBlockerId);
  const liveBlocker = blocker && !blocker.dead ? blocker : undefined;
  return {
    sourceId,
    targetId: state.interceptBeamTargetId,
    blockerId: liveBlocker ? state.interceptBeamBlockerId : null,
    sourceX: source.x,
    sourceZ: source.z,
    targetX: target.pos.x,
    targetZ: target.pos.z,
    blockerX: liveBlocker ? liveBlocker.pos.x : null,
    blockerZ: liveBlocker ? liveBlocker.pos.z : null,
    width: VARKHUL_INTERCEPT_BEAM_HALF_WIDTH,
    duration: VARKHUL_INTERCEPT_BEAM_CAST_SECONDS,
    remaining: Math.min(VARKHUL_INTERCEPT_BEAM_CAST_SECONDS, state.interceptBeamCastRemaining),
  };
}
