// The height a moving body actually rides over a spot, for slope gating: the
// waterline wherever the ground is submerged (inside a declared water body;
// waterLevelAt() is -Infinity everywhere else, so dry land is untouched), the
// ground itself otherwise. Swimmers and waders float over the bed, so gating
// their steps on the RAW lakebed height reads an uneven bed as a wall of
// cliffs: a wading player (too shallow to swim, ground within
// PLAYER_SWIM_DEPTH of the waterline) gets every step blocked and is eternally
// stuck in shore pockets and seam-crossed waterways. pathfind.ts already
// applies this clamp for swimming path queries; this module gives the movement
// kernel (player_motion.ts) the same view. `src/sim`-pure; draws no rng.

import { groundHeight, STEEPNESS_SAMPLE, terrainSteepnessAt, waterLevelAt } from './world';

// Clamp an already-sampled ground height to the local waterline.
export function rideHeight(x: number, z: number, h: number): number {
  const wl = waterLevelAt(x, z);
  return h < wl ? wl : h;
}

export function rideHeightAt(x: number, z: number, seed: number): number {
  return rideHeight(x, z, groundHeight(x, z, seed));
}

// The waterline governing a STEP between two points: the higher of the two
// local waterlines. Water-body footprints are finite, but real water can
// continue past them (a strait band into the open sea): a mover on the
// submerged bed just OUTSIDE a footprint must be able to step back in, so the
// step rides the body's surface if either end has one. Both ends dry gives
// -Infinity (no clamp anywhere on land).
export function stepWaterLevel(x0: number, z0: number, x1: number, z1: number): number {
  return Math.max(waterLevelAt(x0, z0), waterLevelAt(x1, z1));
}

// Feet-under-water test: the ground at (x, z) sits below a live waterline.
// Weaker than isSwimming (any submerged depth, not just swimmable depth).
// Order matters for the hot paths: waterLevelAt is a cheap footprint scan
// (-Infinity outside every declared lake), so the whole dry world answers
// false without ever sampling the full terrain stack.
export function isSubmergedAt(x: number, z: number, seed: number): boolean {
  const wl = waterLevelAt(x, z);
  return wl !== -Infinity && groundHeight(x, z, seed) < wl;
}

// Steepness of the ridden surface. Dry ground defers to the memoized
// terrainSteepnessAt view, keeping the pre-existing dry-land gates
// bit-identical; a submerged point measures the exact clamped gradient
// instead, so bed bumps flatten to the waterline and a shore reads as the
// true waterline-to-bank rise.
export function rideSteepnessAt(x: number, z: number, seed: number): number {
  if (!isSubmergedAt(x, z, seed)) return terrainSteepnessAt(x, z, seed);
  const e = STEEPNESS_SAMPLE;
  const hx = (rideHeightAt(x + e, z, seed) - rideHeightAt(x - e, z, seed)) / (2 * e);
  const hz = (rideHeightAt(x, z + e, seed) - rideHeightAt(x, z - e, seed)) / (2 * e);
  return Math.hypot(hx, hz);
}

// How far above the waterline a swimmer or wader can pull itself onto a bank
// whose face is too steep to walk up (climbing out at the pool's edge). It
// bounds the bank height over the WATER surface, not the total one-step rise:
// wading feet sit up to PLAYER_SWIM_DEPTH below the waterline, so the step
// out can cover ~1.7yd of ground height, deliberately more than the 1.125yd
// jump apex (leaving the water must be easier than a standing jump, or steep
// shores wedge players at the waterline forever). It is never usable from dry
// footing, and ridge/rim walls rise far past it, so no land climb limit moves.
export const SHORE_STEP_UP = 0.9;

// True when a step from submerged footing at (x0, z0) onto too-steep ground at
// (nx, nz) is a legal shore step-out: feet in the water, onto a bank no more
// than SHORE_STEP_UP above the waterline that is itself standable (so the
// step-out never lands on a slide-back slope).
export function shoreStepOut(
  x0: number,
  z0: number,
  nx: number,
  nz: number,
  seed: number,
  maxSlope: number,
): boolean {
  // The STEP waterline, so a mover on the submerged bed just outside a
  // footprint (real water continuing past the rect) gets the same pull-out.
  const wl = stepWaterLevel(x0, z0, nx, nz);
  return (
    // the cheap footprint test first: dry land (waterline -Infinity) answers
    // false before any terrain sampling (this runs inside the movement gates)
    wl !== -Infinity &&
    groundHeight(x0, z0, seed) < wl &&
    groundHeight(nx, nz, seed) <= wl + SHORE_STEP_UP &&
    rideSteepnessAt(nx, nz, seed) <= maxSlope
  );
}
