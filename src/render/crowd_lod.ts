// Crowd-adaptive character LOD policy. Pure (no DOM, no Three), so the renderer
// stays a thin consumer and the thresholds are unit-testable.
//
// As the visible rig count climbs, the ranges at which a character keeps its
// articulated shadow and its full-rate animation pull in toward a floor, so more
// of the throng collapses to the single-draw far LOD + static proxy shadow, and
// the mid band samples its clips less often. Below the knee (ordinary play, a
// handful of rigs) nothing changes: the scale is exactly 1 and the cadence is 2.
//
// FPS-first: in a crowd, a far pose that freezes a little sooner (and a mid-range
// pose that refreshes every 3rd or 4th frame instead of every 2nd) is a fair trade
// for staying above 60. Both are COSMETIC. Anything a player reacts to (the local
// player, the current target, an entity mid-cast) is exempted by the caller.

const CROWD_LOD_SOFT_RIGS = 14;
const CROWD_LOD_HARD_RIGS = 48;
const CROWD_LOD_MIN_SCALE = 0.6;

/** Squared distance scale for the LOD / shadow bands. Distances compare squared. */
export function crowdLodScaleSq(visibleRigs: number): number {
  if (visibleRigs <= CROWD_LOD_SOFT_RIGS) return 1;
  const span = CROWD_LOD_HARD_RIGS - CROWD_LOD_SOFT_RIGS;
  const t = Math.min(1, (visibleRigs - CROWD_LOD_SOFT_RIGS) / span);
  const scale = 1 - t * (1 - CROWD_LOD_MIN_SCALE);
  return scale * scale;
}

/**
 * How often a mid-band rig advances its AnimationMixer, in frames: every 2nd
 * when the scene is calm, stretching to every 4th once the crowd is dense.
 * Sampling clips and rebuilding bone matrices is the per-rig cost that scales
 * with the crowd, so this is the knob that flattens the curve.
 */
export function midAnimCadence(visibleRigs: number): number {
  if (visibleRigs <= CROWD_LOD_SOFT_RIGS) return 2;
  if (visibleRigs >= CROWD_LOD_HARD_RIGS) return 4;
  return 3;
}

/**
 * Whether an entity must advance its mixer EVERY frame regardless of how dense
 * the crowd is, because its pose carries information the player acts on rather
 * than mere cosmetic smoothness.
 *
 * This is the gameplay-fairness carve-out for the cadence above, and the repo
 * invariant it serves is: a performance knob may shed cosmetic richness but must
 * NEVER hide or delay actionable information. A cast windup is a telegraph, so a
 * caster keeps animating at full rate; so does the local player (whose own
 * animation is direct feedback) and the current target (whose pose the player is
 * actively reading).
 *
 * Pure so the carve-out is unit-tested rather than asserted in a comment: an
 * arm silently lost in a refactor is a real fairness regression.
 */
export function animatesEveryFrame(
  entityId: number,
  localPlayerId: number,
  targetId: number | null,
  castingAbility: string | null,
): boolean {
  return entityId === localPlayerId || entityId === targetId || castingAbility !== null;
}
