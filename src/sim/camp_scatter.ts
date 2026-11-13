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

import type { CampDef } from './types';

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

// Where camp slot `index` lands in world space: its authored spot when the camp
// pins one (CampDef.spots), else its scatter point about the camp center. The
// caller draws the two jitter values for EVERY slot, pinned or not, so pinning
// never changes the draw count.
export function campSlotPoint(
  camp: CampDef,
  index: number,
  jitterAngle: number,
  jitterFrac: number,
): { x: number; z: number } {
  const spot = camp.spots?.[index];
  if (spot) return { x: spot.x, z: spot.z };
  const off = campSpawnOffset(index, camp.count, camp.radius, jitterAngle, jitterFrac);
  return { x: camp.center.x + off.x, z: camp.center.z + off.z };
}

// Shared-stream draws one spawned camp slot makes in the Sim's camp loop, in
// order: jitter angle, jitter fraction, level, facing, wander pause. Every Rng
// method funnels through exactly one next() (src/sim/rng.ts).
export const CAMP_SLOT_DRAWS = 5;

/** Whether camp slot `index` is retired (CampDef.retiredSlots): it spawns nothing. */
export function isRetiredCampSlot(camp: CampDef, index: number): boolean {
  return index >= campSpawnedCount(camp);
}

/** Consume a retired slot's draws, so the stream after it is exactly as if it spawned. */
export function drawRetiredCampSlot(rng: { next(): number }): void {
  for (let i = 0; i < CAMP_SLOT_DRAWS; i++) rng.next();
}

/** Mobs the camp actually spawns: its slots less the retired ones. */
export function campSpawnedCount(camp: Pick<CampDef, 'count' | 'retiredSlots'>): number {
  return Math.max(0, camp.count - Math.max(0, Math.floor(camp.retiredSlots ?? 0)));
}

/**
 * The ground a camp's live mobs cover, as one enclosing circle (centroid plus
 * its farthest member; not minimal, plenty at map scale). Pinned slots
 * (CampDef.spots) count at their spots; any live unpinned slot scatters over
 * the camp disc, so the disc is enclosed whole. Retired slots spawn nothing
 * and count for nothing: a fully retired camp has no area (null). A camp with
 * no pinned live slot is exactly its own disc.
 */
export function campLiveArea(camp: CampDef): { x: number; z: number; radius: number } | null {
  const live = campSpawnedCount(camp);
  if (live === 0) return null;
  const pins: { x: number; z: number }[] = [];
  let scatters = false;
  for (let i = 0; i < live; i++) {
    const spot = camp.spots?.[i];
    if (spot) pins.push(spot);
    else scatters = true;
  }
  if (pins.length === 0) return { x: camp.center.x, z: camp.center.z, radius: camp.radius };
  const pts = scatters ? [...pins, camp.center] : pins;
  let cx = 0;
  let cz = 0;
  for (const p of pts) {
    cx += p.x;
    cz += p.z;
  }
  cx /= pts.length;
  cz /= pts.length;
  let r = 0;
  for (const p of pins) r = Math.max(r, Math.hypot(p.x - cx, p.z - cz));
  if (scatters) r = Math.max(r, Math.hypot(camp.center.x - cx, camp.center.z - cz) + camp.radius);
  return { x: cx, z: cz, radius: r };
}
