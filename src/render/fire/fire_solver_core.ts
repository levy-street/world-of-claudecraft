// The 3D fluid fire solver's plain numbers and CPU mirrors: the per-tier voxel
// grid and ray-march plan, the 3D-to-2D tiled atlas coordinate arithmetic the
// GPU passes mirror line for line, the perceptual-LOD hysteresis thresholds,
// and the deterministic draft and combustion step. Three-free and DOM-free,
// registered in RENDER_PURE_CORES and tested in tests/fire_solver_core.test.ts.

import type { OceanTier } from '../ocean/ocean_spectrum_core';

export type FireTier = OceanTier;

export interface FirePlan {
  /** Voxel grid width (X) and depth (Z). */
  gridXZ: number;
  /** Voxel grid height (Y, vertical plume axis). */
  gridY: number;
  /** Number of Z-slice tiles across the 2D atlas horizontally. */
  tilesX: number;
  /** Number of Z-slice tiles down the 2D atlas vertically. */
  tilesZ: number;
  /** Total 2D atlas width in texels (gridXZ * tilesX). */
  atlasWidth: number;
  /** Total 2D atlas height in texels (gridY * tilesZ). */
  atlasHeight: number;
  /** Warm-started Poisson pressure Jacobi iterations per step. */
  jacobiIterations: number;
  /** Volumetric ray-march steps through the bounding hull. */
  marchSteps: number;
  /** Screen-space heat shimmer refraction strength (0 compiles refraction out). */
  shimmerStrength: number;
  /** Maximum simulation steps per second before post-shed scaling. */
  stepHz: number;
}

/**
 * Projected screen height (in pixels) at which a scenery campfire switches from
 * its cheap distant lathe to the volumetric 3D ray-marched hull, with hysteresis
 * on the exit threshold so a camera hovering near the boundary never chatters.
 */
export const FIRE_VOLUME_ENTER_PIXELS = 18;
export const FIRE_VOLUME_EXIT_PIXELS = 14;

/** Period at which the fire shader clock wraps (matches OCEAN_LOOP_SECONDS). */
export const FIRE_LOOP_SECONDS = 600;

const TIER_PLANS: Record<
  FireTier,
  {
    gridXZ: number;
    gridY: number;
    tilesX: number;
    tilesZ: number;
    jacobiIterations: number;
    marchSteps: number;
    shimmerStrength: number;
    stepHz: number;
  }
> = {
  low: {
    gridXZ: 24,
    gridY: 48,
    tilesX: 6,
    tilesZ: 4,
    jacobiIterations: 5,
    marchSteps: 14,
    shimmerStrength: 0,
    stepHz: 30,
  },
  medium: {
    gridXZ: 24,
    gridY: 48,
    tilesX: 6,
    tilesZ: 4,
    jacobiIterations: 6,
    marchSteps: 16,
    shimmerStrength: 0,
    stepHz: 30,
  },
  high: {
    gridXZ: 32,
    gridY: 64,
    tilesX: 8,
    tilesZ: 4,
    jacobiIterations: 8,
    marchSteps: 24,
    shimmerStrength: 0.014,
    stepHz: 45,
  },
  ultra: {
    gridXZ: 32,
    gridY: 64,
    tilesX: 8,
    tilesZ: 4,
    jacobiIterations: 10,
    marchSteps: 30,
    shimmerStrength: 0.018,
    stepHz: 60,
  },
  insane: {
    gridXZ: 32,
    gridY: 64,
    tilesX: 8,
    tilesZ: 4,
    jacobiIterations: 10,
    marchSteps: 32,
    shimmerStrength: 0.018,
    stepHz: 60,
  },
};

/**
 * Returns the 3D fluid simulation and ray-march plan for a shader tier, or null
 * for an unknown tier.
 */
export function firePlanForTier(tier: FireTier): FirePlan | null {
  const spec = TIER_PLANS[tier];
  if (!spec) return null;
  return {
    ...spec,
    atlasWidth: spec.gridXZ * spec.tilesX,
    atlasHeight: spec.gridY * spec.tilesZ,
  };
}

/**
 * Hysteresis gate deciding whether a scenery flame should draw the volumetric
 * 3D hull at its current projected pixel height.
 */
export function shouldUseFireVolume(
  projectedPixels: number,
  currentlyVolumetric: boolean,
): boolean {
  const threshold = currentlyVolumetric ? FIRE_VOLUME_EXIT_PIXELS : FIRE_VOLUME_ENTER_PIXELS;
  return projectedPixels >= threshold;
}

/**
 * Maps integer 3D voxel coordinates (vx in 0..gridXZ-1, vy in 0..gridY-1,
 * vz in 0..gridXZ-1) into 2D atlas texel coordinates (px, py).
 * Mirrors the GLSL `voxelToAtlas` helper line for line.
 */
export function fireVoxelToAtlasTexel(
  vx: number,
  vy: number,
  vz: number,
  plan: Pick<FirePlan, 'gridXZ' | 'gridY' | 'tilesX' | 'tilesZ'>,
): { px: number; py: number } {
  const cx = Math.max(0, Math.min(plan.gridXZ - 1, Math.floor(vx)));
  const cy = Math.max(0, Math.min(plan.gridY - 1, Math.floor(vy)));
  const cz = Math.max(0, Math.min(plan.gridXZ - 1, Math.floor(vz)));
  const tileX = cz % plan.tilesX;
  const tileZ = Math.floor(cz / plan.tilesX);
  return {
    px: tileX * plan.gridXZ + cx,
    py: tileZ * plan.gridY + cy,
  };
}

/**
 * Inverse of `fireVoxelToAtlasTexel`: maps a 2D atlas texel (px, py) back to
 * its 3D voxel coordinates (vx, vy, vz). Mirrors the GLSL fragment pass header.
 */
export function fireAtlasTexelToVoxel(
  px: number,
  py: number,
  plan: Pick<FirePlan, 'gridXZ' | 'gridY' | 'tilesX' | 'tilesZ'>,
): { vx: number; vy: number; vz: number } {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const vx = ((ix % plan.gridXZ) + plan.gridXZ) % plan.gridXZ;
  const vy = ((iy % plan.gridY) + plan.gridY) % plan.gridY;
  const tileX = Math.floor(ix / plan.gridXZ);
  const tileZ = Math.floor(iy / plan.gridY);
  const vz = tileZ * plan.tilesX + tileX;
  return { vx, vy, vz };
}

/**
 * Deterministic fuel-injection and draft pulse for a fire seed at `time`
 * (seconds). Feeds both the GPU emitter uniform and CPU light-flicker scaling
 * so lights and flames breathe together without GPU readback.
 */
export function fireDraftPulse(time: number, seed = 0): number {
  const s = seed * 1.731;
  const slow = Math.sin(time * 2.1 + s) * 0.11;
  const mid = Math.sin(time * 5.3 + s * 2.3) * 0.08;
  const fast = Math.sin(time * 11.7 + s * 3.7) * 0.04;
  return Math.max(0.72, Math.min(1.28, 1 + slow + mid + fast));
}

export interface FireCombustState {
  fuel: number;
  temperature: number;
  smoke: number;
  vy: number;
}

export interface FireCombustParams {
  burnRate?: number;
  heatYield?: number;
  coolingRate?: number;
  smokeYield?: number;
  smokeDecay?: number;
  buoyancy?: number;
  gravity?: number;
}

/**
 * CPU mirror of the GPU combustion, radiative cooling, smoke generation and
 * thermal buoyancy update on a single voxel.
 */
export function fireCombustStep(
  state: FireCombustState,
  dt: number,
  params: FireCombustParams = {},
): FireCombustState {
  const clampedDt = Math.max(0, Math.min(0.1, dt));
  const burnRate = params.burnRate ?? 3.6;
  const heatYield = params.heatYield ?? 1.45;
  const coolingRate = params.coolingRate ?? 1.15;
  const smokeYield = params.smokeYield ?? 0.28;
  const smokeDecay = params.smokeDecay ?? 1.6;
  const buoyancy = params.buoyancy ?? 4.2;
  const gravity = params.gravity ?? 0.45;

  const startFuel = Math.max(0, state.fuel);
  const burn = Math.min(startFuel, startFuel * burnRate * clampedDt);
  const nextFuel = Math.max(0, startFuel - burn);

  const rawTemp = Math.max(0, state.temperature) + burn * heatYield;
  // Quartic radiative cooling (T^4) using explicit products so peak core heat
  // self-limits while warm tails linger.
  const t2 = rawTemp * rawTemp;
  const cooling = coolingRate * rawTemp + 0.35 * t2 * t2;
  const nextTemp = Math.max(0, rawTemp - cooling * clampedDt);

  // Light smoke wisps form where reacting gas cools through the upper tip band.
  const tipBand = Math.max(0, Math.min(1, rawTemp * 1.8)) * Math.max(0, 1 - rawTemp * 0.85);
  const smokeBorn = (burn * 0.6 + tipBand * 0.35 * clampedDt) * smokeYield;
  const nextSmoke = Math.max(
    0,
    Math.min(1, state.smoke * Math.exp(-smokeDecay * clampedDt) + smokeBorn),
  );

  const accelY = nextTemp * buoyancy - nextSmoke * gravity;
  const nextVy = state.vy + accelY * clampedDt;

  return {
    fuel: nextFuel,
    temperature: nextTemp,
    smoke: nextSmoke,
    vy: nextVy,
  };
}
