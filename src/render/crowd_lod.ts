// Crowd-adaptive character LOD budget (pure math, unit-tested).
//
// The per-frame cost of a crowd is GPU-bound on the renderer's submit phase: every
// visible articulated rig is rasterized (~6 draws) and, when close, re-rendered
// into the sun shadow map. Profiling a 50-player cluster on a discrete GPU shows
// submit growing ~6ms going from solo to the crowd while the CPU character work
// (animation/skinning) stays ~2ms, so the crowd lever is the GPU rig+shadow load,
// not CPU.
//
// When many rigs are visible at once (a city, a raid, a world boss) the marginal
// ones are visual mush, so the renderer pulls the articulated-LOD and
// articulated-shadow squared ranges IN as the visible-rig count climbs: distant
// crowd members collapse to their single-draw far LOD and hand their ground shadow
// to the cheap static proxy sooner.
//
// This sheds only COSMETIC richness (animation smoothness + distant per-rig shadow
// crispness). Position, nameplate, HP, debuffs and the target cast bar are HUD/sim
// state and are untouched, so the budget is gameplay-neutral
// (docs/design/graphics-settings-fairness.md): it never hides or delays actionable
// information, only how smoothly/shadowed a distant body in a dense crowd is drawn.

// Below SOFT visible rigs there is no reduction at all; the pull ramps linearly to
// its floor at/above HARD. Tuned so ordinary grouping (a 5-man, a few passers-by)
// is never touched and only genuine crowds pay.
export const CROWD_LOD_SOFT_RIGS = 16;
export const CROWD_LOD_HARD_RIGS = 48;

// Floors as a fraction of the BASE squared range, so the LINEAR range floor is the
// square root of these. Conservative on purpose: a rig you are meleeing or grouped
// with stays well inside both even at the hard knee.
//   shadow 0.40 -> ~0.63x linear (articulated shadow 25u -> ~16u at the hard knee)
//   lod    0.52 -> ~0.72x linear (articulated rig    58u -> ~42u at the hard knee)
// 42u is ~2x melee range and past the 30u nameplate-detail band, so a rig you are
// actually interacting with never collapses; only distant crowd bodies do.
export const CROWD_LOD_MIN_SHADOW_SQ_SCALE = 0.4;
export const CROWD_LOD_MIN_LOD_SQ_SCALE = 0.52;

// Linear ramp from 1.0 (at/below `soft` visible rigs) to `floorSqScale` (at/above
// `hard`). The result multiplies a BASE squared range; a floor of 0.45 therefore
// shrinks the linear range to sqrt(0.45) ~ 0.67x. Pure: no allocation, no clock,
// NaN-safe (a non-finite count yields no reduction).
export function crowdLodSqScale(
  rigs: number,
  floorSqScale: number,
  soft: number = CROWD_LOD_SOFT_RIGS,
  hard: number = CROWD_LOD_HARD_RIGS,
): number {
  if (!(rigs > soft)) return 1; // below the knee (or NaN): full detail
  const span = hard - soft;
  if (span <= 0) return floorSqScale;
  const t = Math.min(1, (rigs - soft) / span);
  // clamp so float rounding at t=1 cannot dip a hair below the floor
  return Math.max(floorSqScale, 1 + (floorSqScale - 1) * t);
}
