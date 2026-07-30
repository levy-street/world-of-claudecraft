// Camp mob placement: where each mob of a camp lands relative to the camp center.
//
// The old placement drew each mob's angle and radius INDEPENDENTLY and uniformly
// over the camp disc (r = sqrt(u) * radius). Independent uniform sampling has no
// minimum-spacing guarantee, so two mobs routinely landed almost on top of each
// other. Dense clusters favor ranged classes (they pull and peel a stacked pack
// from a safe distance while melee must wade into the pile), which is exactly the
// imbalance we are correcting.
//
// This module replaces independent sampling with a deterministic sunflower (Vogel)
// spiral: N points spread with even nearest-neighbor spacing across the disc by
// construction, keeping the same overall footprint (the sqrt keeps the density
// uniform per unit area). A small deterministic jitter breaks the perfectly regular
// look without letting any two mobs collapse together.
//
// Determinism contract: this is a PURE function. It draws no rng; the two random
// values are passed in by the caller, which draws them from `Sim.rng` in the SAME
// order and count as the old placement (one `range(0, 2*PI)` then one `next()`).
// Preserving the draw order/count means the global rng stream position is unchanged,
// so only spawn POSITIONS move (the whole point) while every downstream seed-stable
// roll stays put.

// Golden angle (radians): consecutive spiral points are offset by this angle, the
// irrational rotation that yields the even, non-repeating sunflower packing.
export const CAMP_GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// Jitter magnitude as a fraction of the camp's nominal nearest-neighbor spacing.
// Two adjacent points can each jitter toward each other, so kept well below 0.5 to
// bound the worst-case closing (up to 2 * 0.4 * spacing) and keep the even spacing
// intact: the guaranteed floor is asserted empirically in camp_scatter.test.ts.
export const CAMP_SCATTER_JITTER = 0.4;

// Offset of camp mob `index` (of `count` total) from the camp center, within a disc
// of `camp.radius`. `jitterAngle` in radians and `jitterFrac` in [0, 1) are the two
// rng values the caller drew (reused from the old angle/radius draws).
export function campSpawnOffset(
  index: number,
  count: number,
  radius: number,
  jitterAngle: number,
  jitterFrac: number,
): { x: number; z: number } {
  // Sunflower base point. The +0.5 centers the sampling so the innermost point sits
  // off-center rather than exactly at (0, 0), and the last point stays inside the rim.
  const t = count > 1 ? (index + 0.5) / count : 0;
  const baseR = Math.sqrt(t) * radius;
  const baseAng = index * CAMP_GOLDEN_ANGLE;
  // Nominal nearest-neighbor spacing of a sunflower disc of `count` points in
  // `radius`: proportional to radius / sqrt(count). Jitter is scaled to this so a
  // sparse camp jitters more (it has room) and a dense camp jitters less.
  const spacing = count > 0 ? radius / Math.sqrt(count) : radius;
  const jitterMag = jitterFrac * spacing * CAMP_SCATTER_JITTER;
  return {
    x: Math.sin(baseAng) * baseR + Math.sin(jitterAngle) * jitterMag,
    z: Math.cos(baseAng) * baseR + Math.cos(jitterAngle) * jitterMag,
  };
}
