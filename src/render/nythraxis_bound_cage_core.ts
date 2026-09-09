// The Binding Sigil's cage, the pure half: when Nythraxis is Bound a ring of
// bone bars rises out of the floor around him and sinks back when the stun
// ends. This core turns the aura's timing into the cage's lift and scale
// without Three, DOM, clocks, or allocations; the painter owns the mesh.

import { NYTHRAXIS_BOUND_STUN_AURA_ID } from '../sim/nythraxis_binding_sigil';
import type { NYTHRAXIS_BOSS_ID } from '../sim/types';

/** Seconds the cage takes to rise out of the floor, and to sink back. */
export const NYTHRAXIS_CAGE_RISE_SECONDS = 0.35;
export const NYTHRAXIS_CAGE_SINK_SECONDS = 0.3;
/** Bar radius around an unscaled boss; the roster carries no footprint, only a scale. */
export const NYTHRAXIS_CAGE_BASE_RADIUS = 1.6;
/** Never smaller than this radius, whatever the boss's scale says. */
export const NYTHRAXIS_CAGE_MIN_RADIUS = 4;

export interface NythraxisCageAuraLike {
  id: string;
  remaining: number;
  duration: number;
}

export interface NythraxisCageFootprint {
  scale?: number;
}

export interface NythraxisCageBossLike extends NythraxisCageFootprint {
  id: number;
  templateId: typeof NYTHRAXIS_BOSS_ID | string;
  dead: boolean;
  pos: { x: number; y: number; z: number };
  auras: readonly NythraxisCageAuraLike[];
}

/** The Bound stun on a boss, or null. */
export function nythraxisBoundStunOf(boss: NythraxisCageBossLike): NythraxisCageAuraLike | null {
  if (boss.dead) return null;
  for (const aura of boss.auras) if (aura.id === NYTHRAXIS_BOUND_STUN_AURA_ID) return aura;
  return null;
}

/** Ease-out for the rise: fast off the floor, settling at the top. */
export function nythraxisCageEase(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  return 1 - (1 - t) * (1 - t) * (1 - t);
}

/**
 * How far the cage is lifted, as a fraction of its height: 0 fully sunk, 1
 * fully risen. Rising is timed from the stun's start (its elapsed time,
 * `duration - remaining`); sinking from the moment the stun ended.
 */
export function nythraxisCageLift(stunElapsed: number, sinkElapsed: number | null): number {
  if (sinkElapsed !== null) {
    return 1 - nythraxisCageEase(sinkElapsed / NYTHRAXIS_CAGE_SINK_SECONDS);
  }
  return nythraxisCageEase(stunElapsed / NYTHRAXIS_CAGE_RISE_SECONDS);
}

/** True once a sinking cage is fully back in the floor and can be dropped. */
export function nythraxisCageSunk(sinkElapsed: number): boolean {
  return sinkElapsed >= NYTHRAXIS_CAGE_SINK_SECONDS;
}

/** The radius the cage's bars stand at around this boss. */
export function nythraxisCageRadiusFor(boss: NythraxisCageFootprint): number {
  const scale = boss.scale ?? 1;
  return Math.max(NYTHRAXIS_CAGE_MIN_RADIUS, NYTHRAXIS_CAGE_BASE_RADIUS * Math.max(1, scale));
}

/**
 * Uniform scale that takes a prepared cage model of `assetWidth` (its bars'
 * outer diameter in the model's normalized space) to the wanted radius.
 */
export function nythraxisCageScaleFor(wantedRadius: number, assetWidth: number): number {
  if (!(assetWidth > 1e-4)) return 1;
  return (wantedRadius * 2) / assetWidth;
}
