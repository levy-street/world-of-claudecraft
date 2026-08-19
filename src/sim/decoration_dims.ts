// Physical dimensions of scatter decorations, in world yards, and whether a
// decoration is solid at all. THE single source of truth: `src/render/foliage.ts`
// scales each rock GLB to exactly the height this returns, and `src/sim/colliders.ts`
// uses the same number as the collider's movement top, so a stone's silhouette and the
// surface you stand on (or stride over) can never drift apart again. The same sharing
// applies to solidity: `decorationHasCollider` is what `colliders.ts` gates a rock's
// collider on, and what the render side's low-tier triangle-count trim
// (`src/render/foliage_decimation_core.ts`) reads before ever dropping one, so a
// graphics preset can never hide something a player can be blocked by.
//
// Why this module exists: the rock collider top used to be a hand-guessed
// `1.25 * scale`, while the rendered stone stood about `0.84 * scale` tall.
// Every field stone therefore carried an invisible wall roughly 40 percent
// taller than the rock you could see, which is what made walking over small
// stones impossible. The heights below are derived from the shipped rock GLB
// bounds (`public/models/foliage/rock_[1-3].glb`, about 2.16 model units tall
// before the renderer's 0.3-unit sink), so they describe the real silhouette.
//
// Radii deliberately stay slightly INSIDE the visual footprint (a rendered
// rock is an ellipse roughly `1.08 * scale` across the mean axis; the collider
// is a circle a little tighter). Forgiving horizontal collision is standard
// practice and costs the player nothing; a too-tall collider, by contrast,
// reads as a bug because you can see over the obstacle you cannot pass.
//
// Pure and deterministic: `hash2` only, no rng draw, no wall clock.

import { hash2 } from './rng';
import type { Decoration } from './world';

/**
 * How far a rock model is sunk below the terrain, in MODEL units, so its
 * underside buries on slopes. Owned here because the height contract is a
 * two-sided deal: the renderer scales each variant so that
 * `(bboxTop - ROCK_SINK_UNITS) * scale` equals `rockHeight()`, and the sim
 * publishes that same height as the collider top.
 */
export const ROCK_SINK_UNITS = 0.3;
/** Mean rendered height of a rock per unit of `Decoration.scale` (yards). */
export const ROCK_HEIGHT_PER_SCALE = 0.84;
/** Collider radius per unit of `Decoration.scale` (yards). */
export const ROCK_RADIUS_PER_SCALE = 0.7;
/** Only rocks at least this big carry a collider; smaller ones are dressing. */
export const ROCK_COLLIDER_MIN_SCALE = 0.8;

// Per-rock variation, stable under a fixed seed. The decoration's own (x, z)
// keys the draw, quantized so a float wobble can never flip a rock's size.
function rockVariation(x: number, z: number, seed: number): number {
  return hash2(Math.round(x * 8), Math.round(z * 8), seed + 10);
}

/**
 * Height of this rock above the terrain it sits on (yards). Rocks are squat:
 * a scale-0.8 stone lands near 0.7 yd, inside the character step height, so a
 * walking body strides over it; a scale-1.6 boulder lands near 1.4 yd and asks
 * for a jump. The spread is what makes the field read as varied rather than
 * as one repeated prop.
 */
export function rockHeight(x: number, z: number, scale: number, seed: number): number {
  return scale * ROCK_HEIGHT_PER_SCALE * (0.8 + rockVariation(x, z, seed) * 0.5);
}

/** Convenience overload for a whole decoration record. */
export function rockHeightOf(d: Decoration, seed: number): number {
  return rockHeight(d.x, d.z, d.scale, seed);
}

/** Collider radius for this rock (yards). */
export function rockRadius(scale: number): number {
  return ROCK_RADIUS_PER_SCALE * scale;
}

/**
 * Whether `colliders.ts` gives this decoration a real physical collider.
 * A rock only clears the bar at or above `ROCK_COLLIDER_MIN_SCALE`; every
 * tree/tree2 gets an unconditional trunk collider. The single home for this
 * check so `colliders.ts` (which builds the collider) and any render-side
 * candidate selection (which must never hide one, root CLAUDE.md's
 * graphics-fairness invariant) can't drift apart on what counts as solid.
 */
export function decorationHasCollider(d: Decoration): boolean {
  return d.kind !== 'rock' || d.scale >= ROCK_COLLIDER_MIN_SCALE;
}
