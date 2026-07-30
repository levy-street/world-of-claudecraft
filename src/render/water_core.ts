// PURE (unit-tested, Three-free): the water shore-depth sample. water.ts bakes
// this per vertex into the aShoreDepth attribute (foam band + shallow tint) at
// build time AND on every editor setLevel() rebuild, so both paths share one
// definition. It also owns the bounded fixed-step height-field tier plan.
// It reads the ACTIVE water surface (waterLevel(): the custom
// map's override when one is loaded, else the built-in constant) against the
// same deterministic terrainHeight the sim uses. Registered in
// RENDER_PURE_CORES (tests/architecture.test.ts).
import { terrainHeight, waterLevel } from '../sim/world';

export interface WaterFieldPlan {
  /** Height-field texels per side (square). */
  resolution: number;
  /** World yards per texel. */
  cellSize: number;
  /** World yards covered per side. */
  size: number;
  stepHz: number;
}

export const WATER_IMPULSE_CAPACITY = 8;
export const WATER_SIM_ACTIVE_SECONDS = 6;
export const WATER_MAX_STEPS_PER_FRAME = 2;
export const WATER_MAX_GLOBAL_PASSES_PER_FRAME = 2;
export const WATER_SCHEDULE_WAKE = 1;
export const WATER_SCHEDULE_SLEEP = 2;

// World yards per height-field texel. The surface is continuous (zone strips
// plus the horizon apron), so the field is a camera-anchored WINDOW rather than
// one texture per lake: sized for a ~1 yard character wake to read clearly.
export const WATER_FIELD_CELL_SIZE = 0.7;
// Fraction of the field, in UV, over which its contribution ramps from nothing
// to full at the window border. The field is a WINDOW, not the whole sea, so
// something has to happen at its edge. Cutting it off hard puts a step in the
// surface NORMAL (the slope drives N with a large gain), and because the window
// is a camera-anchored square that step draws straight-edged seams across open
// water that travel with the camera and survive any amount of colour tuning.
// Feathering costs a band of reduced wake detail at ~34 yards (high tier) where
// a character wake is already sub-pixel, and buys a seamless sea.
export const WATER_FIELD_EDGE_FEATHER_UV = 0.12;
// Re-anchor once the camera has drifted this fraction of the field half-size.
// Hysteresis matters: re-anchoring every frame would scroll the state every
// frame, and each scroll costs a full-field pass.
export const WATER_FIELD_REANCHOR_FRACTION = 0.3;

export interface WaterScheduleState {
  active: boolean;
  pendingCount: number;
  accumulator: number;
  awakeUntil: number;
  stepSeconds: number;
}

/** Fixed allocation size per tier, so re-anchoring never resizes an attachment. */
export function waterSimulationTargetResolution(tier: 'low' | 'medium' | 'high' | 'ultra'): number {
  if (tier === 'ultra') return 128;
  if (tier === 'high') return 96;
  if (tier === 'medium') return 64;
  return 48;
}

/** Bounded height-field allocation and fixed rate for the camera-anchored field. */
export function waterFieldPlan(tier: 'low' | 'medium' | 'high' | 'ultra'): WaterFieldPlan {
  const resolution = waterSimulationTargetResolution(tier);
  return {
    resolution,
    cellSize: WATER_FIELD_CELL_SIZE,
    size: resolution * WATER_FIELD_CELL_SIZE,
    stepHz: tier === 'ultra' ? 30 : tier === 'high' ? 24 : tier === 'medium' ? 20 : 15,
  };
}

/**
 * Snap a field edge to the texel lattice. Anchoring on exact cell multiples
 * keeps every re-anchor an INTEGER texel shift, so the scroll pass resamples
 * nothing and standing waves never shimmer as the camera walks.
 */
export function snapWaterFieldOrigin(value: number, cellSize: number): number {
  const step = Math.max(cellSize, 0.0001);
  return Math.round(value / step) * step;
}

/** True once the camera has drifted far enough from the anchor to re-center. */
export function waterFieldNeedsReanchor(
  cameraX: number,
  cameraZ: number,
  anchorX: number,
  anchorZ: number,
  size: number,
): boolean {
  const limit = Math.max(0, size) * 0.5 * WATER_FIELD_REANCHOR_FRACTION;
  return Math.abs(cameraX - anchorX) > limit || Math.abs(cameraZ - anchorZ) > limit;
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

// Depth of the ACTIVE water surface above the terrain at (x, z): positive in
// open water, negative on dry land.
export function shoreDepthAt(x: number, z: number, seed: number): number {
  return waterLevel() - terrainHeight(x, z, seed);
}

/**
 * Deepest the terrain generator ever puts the seabed below the water line.
 * Measured across a 30 sample coastline survey: every sample tops out at
 * exactly this, and depth 15 is reached by none of them. The colour ramp
 * therefore cannot be widened, there is no deeper water to grade into.
 */
export const WATER_SEABED_CLAMP_YARDS = 6;
/** Width of the surf band measured ALONG THE GROUND from the waterline. */
export const WATER_FOAM_WIDTH_YARDS = 4.5;

// Half-width of the central difference used for the seabed gradient, in yards.
// The zone plane bakes at ~2 yard vertex spacing, so sampling wider than that
// would smear a cove's slope into its neighbour's.
const SHORE_SLOPE_SAMPLE_HALF_WIDTH = 1.5;
// Below this the seabed is flat enough that depth carries no direction, and
// dividing by it would explode the derived shoreline distance.
const MIN_SHORE_SLOPE = 1e-3;

/**
 * Magnitude of the seabed gradient at (x, z): yards of depth gained per yard
 * travelled. Pairs with shoreDepthAt to recover the HORIZONTAL distance to the
 * waterline (depth / slope), which is the only shore signal that behaves the
 * same on a steep shelf and a flat one.
 *
 * Measured motivation (30 coastline samples): the seabed is hard clamped at 6
 * yards, and shelves range from reaching 3.2 yards in 4 yards of run to sitting
 * at 0.2 yards deep for 40 yards. A single depth threshold cannot serve both,
 * so foam keyed on depth alone either floods a flat bay or vanishes on a steep
 * one.
 */
export function shoreSlopeAt(x: number, z: number, seed: number): number {
  const h = SHORE_SLOPE_SAMPLE_HALF_WIDTH;
  const dx = shoreDepthAt(x + h, z, seed) - shoreDepthAt(x - h, z, seed);
  const dz = shoreDepthAt(x, z + h, seed) - shoreDepthAt(x, z - h, seed);
  return Math.max(Math.hypot(dx, dz) / (2 * h), MIN_SHORE_SLOPE);
}
