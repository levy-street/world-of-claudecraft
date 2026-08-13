// Pure policies shared by scenery whose detail can safely follow projected
// size. Painters provide the live camera projection and keep all gameplay
// visibility decisions outside this module.

import { clamp01 } from './num_clamp';

const GRASS_PROTECTED_RADIUS_FRACTION = 0.85;
const GRASS_MIN_PROJECTED_PIXELS = 6;
const GRASS_FULL_PROJECTED_PIXELS = 10;
const INSTANCE_TRANSITION_PER_SECOND = 0.75;
const INSTANCE_COUNT_DEADBAND = 1;
const FULL_RATE_PROJECTED_PIXELS = 10;
const MID_RATE_PROJECTED_PIXELS = 4;
const MID_RATE_INTERVAL_SECONDS = 1 / 20;
const FAR_RATE_INTERVAL_SECONDS = 1 / 10;
const INSTANCE_MATRIX_STRIDE = 16;
const INSTANCE_POSITION_X = 12;
const INSTANCE_POSITION_Z = 14;
const WORLD_RANK_QUANTIZATION = 1024;

export interface FarFieldDensityInput {
  /** Nearest XZ distance from the player to the whole immutable chunk. */
  nearDistance: number;
  activeRadius: number;
  /** Conservative projected height of a representative card in live pixels. */
  projectedPixels: number;
  /** Preset floor for a still-partly-visible far chunk. */
  minKeepFraction: number;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(Number.EPSILON, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Focal length in physical drawing-buffer pixels from a PerspectiveCamera matrix. */
export function projectionScalePixels(projectionY: number, drawingBufferHeight: number): number {
  if (
    !Number.isFinite(projectionY) ||
    !Number.isFinite(drawingBufferHeight) ||
    drawingBufferHeight <= 0
  ) {
    return 0;
  }
  return (Math.abs(projectionY) * drawingBufferHeight) / 2;
}

/** Perspective-projected size at a positive camera-space depth. */
export function projectedPixelSize(
  worldSize: number,
  viewDepth: number,
  projectionPixels: number,
): number {
  if (
    !Number.isFinite(worldSize) ||
    worldSize < 0 ||
    !Number.isFinite(viewDepth) ||
    viewDepth <= 0 ||
    !Number.isFinite(projectionPixels) ||
    projectionPixels <= 0
  ) {
    return Number.POSITIVE_INFINITY;
  }
  return (worldSize * projectionPixels) / viewDepth;
}

/**
 * Density for a stable ranked prefix.
 *
 * The near 85 percent of the grass radius remains byte-identical. The only
 * approximate band is already under the card shader's 70 to 100 percent alpha
 * erosion, and a chunk wholly beyond that erosion is exactly empty.
 */
export function farFieldDensityFraction(input: FarFieldDensityInput): number {
  return farFieldDensityFractionForValues(
    input.nearDistance,
    input.activeRadius,
    input.projectedPixels,
    input.minKeepFraction,
  );
}

/** Allocation-free scalar form for the foliage frame loop. */
export function farFieldDensityFractionForValues(
  nearDistance: number,
  activeRadius: number,
  projectedPixels: number,
  minKeepFraction: number,
): number {
  const radius = Math.max(0, activeRadius);
  if (!Number.isFinite(nearDistance) || radius <= 0) return 1;
  if (nearDistance >= radius) return 0;
  if (nearDistance <= radius * GRASS_PROTECTED_RADIUS_FRACTION) return 1;
  if (!Number.isFinite(projectedPixels)) return 1;

  const minKeep = clamp01(minKeepFraction);
  const projectedWeight = smoothstep(
    GRASS_MIN_PROJECTED_PIXELS,
    GRASS_FULL_PROJECTED_PIXELS,
    projectedPixels,
  );
  const projectedFraction = minKeep + (1 - minKeep) * projectedWeight;
  const farBandWeight = smoothstep(radius * GRASS_PROTECTED_RADIUS_FRACTION, radius, nearDistance);
  return 1 - (1 - projectedFraction) * farBandWeight;
}

export interface InstanceCountStep {
  count: number;
  /** Fractional instance budget carried across frames. */
  carry: number;
}

/**
 * Move an existing prefix without one-frame cohort changes or frame-rate
 * dependence. The caller retains the fractional budget between updates.
 */
export function advanceInstanceCountInto(
  output: InstanceCountStep,
  current: number,
  target: number,
  fullCount: number,
  dt: number,
  carry = 0,
): void {
  const full = Math.max(0, Math.floor(fullCount));
  const from = Math.min(full, Math.max(0, Math.round(current)));
  const to = Math.min(full, Math.max(0, Math.round(target)));
  const delta = to - from;
  if (Math.abs(delta) <= INSTANCE_COUNT_DEADBAND) {
    output.count = from;
    output.carry = 0;
    return;
  }
  const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
  const available =
    Math.max(0, Number.isFinite(carry) ? carry : 0) +
    full * INSTANCE_TRANSITION_PER_SECOND * elapsed;
  const maxStep = Math.floor(available);
  if (maxStep <= 0) {
    output.count = from;
    output.carry = available;
    return;
  }
  const step = Math.min(Math.abs(delta), maxStep);
  output.count = from + Math.sign(delta) * step;
  output.carry = step === Math.abs(delta) ? 0 : available - step;
}

/** Convenient allocating form for cold callers and direct policy tests. */
export function advanceInstanceCount(
  current: number,
  target: number,
  fullCount: number,
  dt: number,
  carry = 0,
): InstanceCountStep {
  const output = { count: 0, carry: 0 };
  advanceInstanceCountInto(output, current, target, fullCount, dt, carry);
  return output;
}

function stableRank(x: number, z: number, seed: number, familySalt: number): number {
  const qx = Math.round(x * WORLD_RANK_QUANTIZATION) | 0;
  const qz = Math.round(z * WORLD_RANK_QUANTIZATION) | 0;
  let hash = (seed ^ familySalt) | 0;
  hash = Math.imul(hash ^ qx, 0x27d4eb2d);
  hash = Math.imul(hash ^ qz, 0x165667b1);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  return hash >>> 0;
}

/**
 * Reorder one immutable instance buffer into a world-stable random prefix.
 * This runs only while a streamed chunk is built. Runtime LOD changes count,
 * never matrix or color bytes.
 */
export function reorderInstanceDataByStableRank(
  matrices: Float32Array,
  colors: Float32Array | null,
  count: number,
  seed: number,
  familySalt: number,
): void {
  const liveCount = Math.min(
    Math.max(0, Math.floor(count)),
    Math.floor(matrices.length / INSTANCE_MATRIX_STRIDE),
  );
  if (liveCount < 2) return;
  const matrixCapacity = Math.floor(matrices.length / INSTANCE_MATRIX_STRIDE);
  const colorStride =
    colors && matrixCapacity > 0 ? Math.max(0, Math.floor(colors.length / matrixCapacity)) : 0;
  const order = Array.from({ length: liveCount }, (_, index) => index);
  order.sort((left, right) => {
    const leftOffset = left * INSTANCE_MATRIX_STRIDE;
    const rightOffset = right * INSTANCE_MATRIX_STRIDE;
    const lx = matrices[leftOffset + INSTANCE_POSITION_X];
    const lz = matrices[leftOffset + INSTANCE_POSITION_Z];
    const rx = matrices[rightOffset + INSTANCE_POSITION_X];
    const rz = matrices[rightOffset + INSTANCE_POSITION_Z];
    return (
      stableRank(lx, lz, seed, familySalt) - stableRank(rx, rz, seed, familySalt) ||
      lx - rx ||
      lz - rz ||
      left - right
    );
  });

  const matrixPrefix = matrices.slice(0, liveCount * INSTANCE_MATRIX_STRIDE);
  const colorPrefix = colors && colorStride > 0 ? colors.slice(0, liveCount * colorStride) : null;
  for (let target = 0; target < liveCount; target++) {
    const source = order[target];
    matrices.set(
      matrixPrefix.subarray(source * INSTANCE_MATRIX_STRIDE, (source + 1) * INSTANCE_MATRIX_STRIDE),
      target * INSTANCE_MATRIX_STRIDE,
    );
    if (colors && colorPrefix && colorStride > 0) {
      colors.set(
        colorPrefix.subarray(source * colorStride, (source + 1) * colorStride),
        target * colorStride,
      );
    }
  }
}

/** Absolute-time cadence for non-actionable scenery motion. */
export function cadenceIntervalForProjectedPixels(projectedPixels: number): number {
  if (!Number.isFinite(projectedPixels) || projectedPixels >= FULL_RATE_PROJECTED_PIXELS) return 0;
  if (projectedPixels >= MID_RATE_PROJECTED_PIXELS) return MID_RATE_INTERVAL_SECONDS;
  return FAR_RATE_INTERVAL_SECONDS;
}

export function cadenceRefreshDue(
  now: number,
  lastRefreshAt: number,
  intervalSeconds: number,
): boolean {
  if (!Number.isFinite(now) || !Number.isFinite(lastRefreshAt)) return true;
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) return true;
  return now - lastRefreshAt + 1e-9 >= intervalSeconds;
}
