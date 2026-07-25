// PURE (unit-tested, Three-free): the water shore-depth sample. water.ts bakes
// this per vertex into the aShoreDepth attribute (foam band + shallow tint) at
// build time AND on every editor setLevel() rebuild, so both paths share one
// definition. It also owns the bounded fixed-step height-field tier plan.
// It reads the ACTIVE water surface (waterLevel(): the custom
// map's override when one is loaded, else the built-in constant) against the
// same deterministic terrainHeight the sim uses. Registered in
// RENDER_PURE_CORES (tests/architecture.test.ts).
import { terrainHeight, waterLevel } from '../sim/world';

export interface WaterGridPlan {
  size: number;
  segments: number;
}

export interface WaterSimulationPlan {
  resolution: number;
  stepHz: number;
}

export const WATER_IMPULSE_CAPACITY = 8;
export const WATER_SIM_ACTIVE_SECONDS = 6;
export const WATER_MAX_STEPS_PER_FRAME = 2;
export const WATER_MAX_GLOBAL_PASSES_PER_FRAME = 2;
export const WATER_SCHEDULE_WAKE = 1;
export const WATER_SCHEDULE_SLEEP = 2;

export interface WaterScheduleState {
  active: boolean;
  pendingCount: number;
  accumulator: number;
  awakeUntil: number;
  stepSeconds: number;
}

/** Maximum simultaneously resident height fields, independent of map lake count. */
export function waterResidentBodyBudget(tier: 'low' | 'medium' | 'high' | 'ultra'): number {
  if (tier === 'ultra') return 4;
  if (tier === 'high') return 3;
  if (tier === 'medium') return 2;
  return 1;
}

/** Fixed allocation size per tier, shared by every lake to avoid contact-frame resizes. */
export function waterSimulationTargetResolution(tier: 'low' | 'medium' | 'high' | 'ultra'): number {
  if (tier === 'ultra') return 128;
  if (tier === 'high') return 96;
  if (tier === 'medium') return 64;
  return 48;
}

/** Bounded height-field allocation and fixed simulation rate for one lake. */
export function waterSimulationPlan(
  _radius: number,
  tier: 'low' | 'medium' | 'high' | 'ultra',
): WaterSimulationPlan {
  return {
    resolution: waterSimulationTargetResolution(tier),
    stepHz: tier === 'ultra' ? 30 : tier === 'high' ? 24 : tier === 'medium' ? 20 : 15,
  };
}

/**
 * Allocation-free scheduler transition shared by the renderer and Node tests.
 * Invisible impulses are discarded instead of extending an unseen lake's wake.
 */
export function advanceWaterSchedule(
  state: WaterScheduleState,
  visible: boolean,
  time: number,
  dt: number,
): number {
  if (!visible) {
    state.pendingCount = 0;
    state.accumulator = 0;
    return state.active && time >= state.awakeUntil ? WATER_SCHEDULE_SLEEP : 0;
  }

  let flags = 0;
  if (state.pendingCount > 0) {
    state.active = true;
    state.awakeUntil = time + WATER_SIM_ACTIVE_SECONDS;
    state.accumulator = Math.max(state.accumulator, state.stepSeconds);
    flags |= WATER_SCHEDULE_WAKE;
  }
  if (!state.active) return flags;
  if (time >= state.awakeUntil && state.pendingCount === 0) {
    return flags | WATER_SCHEDULE_SLEEP;
  }
  state.accumulator = Math.min(
    state.accumulator + Math.max(0, dt),
    state.stepSeconds * WATER_MAX_STEPS_PER_FRAME,
  );
  return flags;
}

/**
 * Bounded water-grid density. The cap is important for editor-authored lakes:
 * a single oversized radius must not turn into an unbounded vertex upload.
 */
export function waterGridPlan(
  radius: number,
  vertexSpacing: number,
  minSegments: number,
  maxSegments: number,
): WaterGridPlan {
  const safeRadius = Math.max(0.01, radius);
  const safeSpacing = Math.max(0.01, vertexSpacing);
  const lo = Math.max(1, Math.floor(minSegments));
  const hi = Math.max(lo, Math.floor(maxSegments));
  return {
    size: safeRadius * 2,
    segments: Math.min(hi, Math.max(lo, Math.ceil((safeRadius * 2) / safeSpacing))),
  };
}

/** True when an axis-aligned grid cell touches the circular lake footprint. */
export function waterCellIntersectsDisc(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  radius: number,
): boolean {
  const nearestX = Math.max(Math.min(0, Math.max(x0, x1)), Math.min(x0, x1));
  const nearestZ = Math.max(Math.min(0, Math.max(z0, z1)), Math.min(z0, z1));
  return nearestX * nearestX + nearestZ * nearestZ <= radius * radius;
}

/** Fog-distance cull that keeps a whole lake visible until its near edge leaves range. */
export function waterBodyVisible(
  cameraX: number,
  cameraZ: number,
  centerX: number,
  centerZ: number,
  radius: number,
  visibleRange: number,
): boolean {
  const dx = cameraX - centerX;
  const dz = cameraZ - centerZ;
  const limit = Math.max(0, visibleRange) + Math.max(0, radius);
  return dx * dx + dz * dz <= limit * limit;
}

// Depth of the ACTIVE water surface above the terrain at (x, z): positive in
// open water, negative on dry land.
export function shoreDepthAt(x: number, z: number, seed: number): number {
  return waterLevel() - terrainHeight(x, z, seed);
}
