// Heroic-only meteor pattern chained from Anvil's Decree. Stateless hash
// placement avoids consuming the encounter RNG stream and makes reconnect
// warnings reproducible from compact state.

import { hash2 } from './rng';

export interface VarkhulAnvilMeteorPoint {
  x: number;
  z: number;
}

export interface VarkhulAnvilMeteorState {
  castKey: number;
  strikeIndex: number;
  remaining: number;
  points: readonly VarkhulAnvilMeteorPoint[];
}

export interface ActiveVarkhulAnvilMeteorWarning extends VarkhulAnvilMeteorPoint {
  id: string;
  radius: number;
  duration: number;
  remaining: number;
  warningLead: number;
}

export const VARKHUL_ANVIL_METEOR_CAST_ID = 'Hammerfall Meteors';
export const VARKHUL_ANVIL_METEOR_COUNT = 3;
export const VARKHUL_ANVIL_METEOR_WARNING_SECONDS = 1.8;
export const VARKHUL_ANVIL_METEOR_RADIUS = 3.5;
export const VARKHUL_ANVIL_METEOR_DAMAGE_MAX_HP = 0.75;

export function varkhulAnvilMeteorId(
  bossId: number,
  castKey: number,
  strikeIndex: number,
  meteorIndex: number,
): string {
  return `varkhul-anvil:${bossId}:${castKey}:${strikeIndex}:${meteorIndex}`;
}

export function varkhulAnvilMeteorPattern(
  castKey: number,
  strikeIndex: number,
  origin: VarkhulAnvilMeteorPoint,
): VarkhulAnvilMeteorPoint[] {
  const phase = hash2(castKey, strikeIndex, 0xa7711) * Math.PI * 2;
  const radii = [12, 18, 24] as const;
  return radii.map((radius, meteorIndex) => {
    const angle = phase + (meteorIndex * Math.PI * 2) / VARKHUL_ANVIL_METEOR_COUNT;
    return {
      x: origin.x + Math.sin(angle) * radius,
      z: origin.z + Math.cos(angle) * radius,
    };
  });
}

export function activeVarkhulAnvilMeteorWarnings(
  bossId: number,
  state: VarkhulAnvilMeteorState,
): ActiveVarkhulAnvilMeteorWarning[] {
  if (!Number.isFinite(state.remaining) || state.remaining <= 0 || !Array.isArray(state.points)) {
    return [];
  }
  return state.points.map((point, meteorIndex) => ({
    id: varkhulAnvilMeteorId(bossId, state.castKey, state.strikeIndex, meteorIndex),
    x: point.x,
    z: point.z,
    radius: VARKHUL_ANVIL_METEOR_RADIUS,
    duration: VARKHUL_ANVIL_METEOR_WARNING_SECONDS,
    remaining: Math.min(state.remaining, VARKHUL_ANVIL_METEOR_WARNING_SECONDS),
    warningLead: 0,
  }));
}
