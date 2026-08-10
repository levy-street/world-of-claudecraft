// Pure transition policy shared by the render-side atmosphere consumers.
// The Three adapters own colors, textures, and scene writes; this core only
// advances deterministic scalar and keyed blend state from caller-provided dt.

import { clamp01 } from './num_clamp';

/** Response for fog, tint, and lighting targets. About 97 percent settled in 5 seconds. */
export const ZONE_ENVIRONMENT_RESPONSE = 0.7;

/** Response for the HDR sky pair. Slightly quicker than the rest of the grade. */
export const SKY_ENVIRONMENT_RESPONSE = 0.75;

/** Response for precipitation opacity at an outdoor zone boundary. */
export const WEATHER_ENVIRONMENT_RESPONSE = 0.8;

/** IBL fades quickly to a low contribution before its non-blendable PMREM swap. */
export const ENVIRONMENT_MAP_FADE_RESPONSE = 3;
export const ENVIRONMENT_MAP_RECOVER_RESPONSE = ZONE_ENVIRONMENT_RESPONSE;
export const ENVIRONMENT_MAP_FADE_FLOOR = 0.12;
export const ENVIRONMENT_MAP_SWAP_THRESHOLD = 0.16;

const BLEND_EDGE_EPSILON = 0.01;

export interface EnvironmentBlend<K extends string> {
  from: K;
  to: K;
  t: number;
}

export interface EnvironmentMapTransition<K extends string> {
  current: K;
  pending: K | null;
  intensity: number;
}

/** Exponential damping alpha, stable across frame rates for the same elapsed time. */
export function transitionAlpha(dt: number, response: number): number {
  if (dt <= 0 || response <= 0) return 0;
  return 1 - Math.exp(-dt * response);
}

export function dampedValue(current: number, target: number, dt: number, response: number): number {
  return current + (target - current) * transitionAlpha(dt, response);
}

/** Ease atmospheric range changes while honoring an independently computed residency ceiling. */
export function easedFogFar(
  current: number,
  atmosphericTarget: number,
  residencyFar: number,
  dt: number,
): number {
  return Math.max(
    0,
    Math.min(dampedValue(current, atmosphericTarget, dt, ZONE_ENVIRONMENT_RESPONSE), residencyFar),
  );
}

/** Keep the near plane valid if residency has to pull the far plane inward immediately. */
export function easedFogNear(
  current: number,
  atmosphericTarget: number,
  liveFar: number,
  dt: number,
): number {
  return Math.max(
    0,
    Math.min(
      dampedValue(current, atmosphericTarget, dt, ZONE_ENVIRONMENT_RESPONSE),
      liveFar * 0.55,
    ),
  );
}

export function createEnvironmentBlend<K extends string>(
  initial: EnvironmentBlend<K>,
): EnvironmentBlend<K> {
  return { from: initial.from, to: initial.to, t: clamp01(initial.t) };
}

function advanceMix<K extends string>(
  state: EnvironmentBlend<K>,
  target: number,
  dt: number,
  response: number,
): boolean {
  state.t = dampedValue(state.t, target, dt, response);
  if (Math.abs(target - state.t) > BLEND_EDGE_EPSILON) return false;
  state.t = target;
  return true;
}

/**
 * Advance a two-texture blend without replacing either texture at a non-zero
 * contribution. When consecutive spatial pairs share an endpoint, the old
 * pair finishes at that endpoint before the new pair begins. An unrelated
 * teleport first settles to its visible dominant endpoint, then bridges from
 * that endpoint to the new pair.
 */
export function stepEnvironmentBlend<K extends string>(
  state: EnvironmentBlend<K>,
  target: EnvironmentBlend<K>,
  dt: number,
  response: number,
): void {
  const targetMix = clamp01(target.t);
  if (state.from === target.from && state.to === target.to) {
    advanceMix(state, targetMix, dt, response);
    return;
  }

  let shared: K | null = null;
  let stateEdge = 0;
  let targetEdge = 0;
  if (state.to === target.from) {
    shared = state.to;
    stateEdge = 1;
    targetEdge = 0;
  } else if (state.from === target.from) {
    shared = state.from;
    stateEdge = 0;
    targetEdge = 0;
  } else if (state.to === target.to) {
    shared = state.to;
    stateEdge = 1;
    targetEdge = 1;
  } else if (state.from === target.to) {
    shared = state.from;
    stateEdge = 0;
    targetEdge = 1;
  }

  if (shared !== null) {
    if (!advanceMix(state, stateEdge, dt, response)) return;
    state.from = target.from;
    state.to = target.to;
    state.t = target.from === target.to ? 0 : targetEdge;
    return;
  }

  const dominantEdge = state.t < 0.5 ? 0 : 1;
  if (!advanceMix(state, dominantEdge, dt, response)) return;
  const dominant = dominantEdge === 0 ? state.from : state.to;
  state.from = dominant;
  state.to = target.from;
  state.t = dominant === target.from ? 1 : 0;
}

export function createEnvironmentMapTransition<K extends string>(
  current: K,
  intensity: number,
): EnvironmentMapTransition<K> {
  return { current, pending: null, intensity: Math.max(0, intensity) };
}

/**
 * Advance the one-map IBL handoff. Returns the new key only after the current
 * map has faded to a low contribution, so the Three adapter can swap the PMREM
 * and rotation without a bright material-lighting pop.
 */
export function stepEnvironmentMapTransition<K extends string>(
  state: EnvironmentMapTransition<K>,
  target: K,
  settledIntensity: number,
  dt: number,
): K | null {
  const full = Math.max(0, settledIntensity);
  if (target === state.current) {
    state.pending = null;
    state.intensity = dampedValue(state.intensity, full, dt, ENVIRONMENT_MAP_RECOVER_RESPONSE);
    return null;
  }

  state.pending = target;
  const floor = full * ENVIRONMENT_MAP_FADE_FLOOR;
  state.intensity = dampedValue(state.intensity, floor, dt, ENVIRONMENT_MAP_FADE_RESPONSE);
  const swapAt = Math.max(0.001, full * ENVIRONMENT_MAP_SWAP_THRESHOLD);
  if (state.intensity > swapAt) return null;

  state.current = target;
  state.pending = null;
  return target;
}
