// Distance LOD for the small ground-VFX terrain drapes.
//
// The ability-VFX ground marks ride the selection-ring drape idiom: every
// vertex of the mesh samples its own terrain height so the mark follows a slope
// instead of burying its uphill half (see ./selection_ring). That drape is the
// single most expensive thing those pools do, because the sampler is the sim's
// real `groundHeight` chain, at roughly 3 microseconds a sample on desktop and
// several times that on a phone. A buff ground aura re-drapes a 42-vertex disc
// EVERY frame its wearer moves, per band, per buffed character in view, which
// is the one steady-state drape cost in a fight.
//
// This module thins that sampling with camera distance: sample a subset of the
// rim exactly and fill the vertices between two samples by interpolating in the
// disc's own angular parameter space.
//
// SCOPE, and it is deliberate: this is for the SMALL discs only (buff auras and
// dissolve decals, one to a few yards across). The wide shockwave rings keep
// their exact per-vertex drape. Measured over the walkable overworld, thinning
// a 1.5 yard aura disc costs a p99 of about 11 cm of vertical drape error and a
// p95 of 4 cm, invisible on a 0.18-opacity annulus 20+ yards away; the same
// treatment on a 10 to 20 yard shockwave footprint costs YARDS, because at that
// span the exact mesh is already the coarsest honest description of the ground.
// The `maxSampleSpacing` cap below is what enforces that split by construction:
// a mark whose vertices are already far apart in world space cannot be thinned
// at all, whatever its distance.
//
// Two further properties are load-bearing and pinned by
// tests/drape_lod_core.test.ts:
//
//   1. Only the drape's vertical fidelity changes. Every sampled vertex keeps
//      its exact world XZ, and every sample taken is one the exact drape would
//      also have taken, so a mark's footprint, radius and position are
//      byte-identical at every stride. Nothing a player reads and reacts to
//      (where an AoE wavefront actually is) moves.
//   2. The policy reads camera DISTANCE and the mark's own geometry, and
//      nothing else: no graphics tier, no preset, no frame-budget governor. Two
//      players standing in the same spot get the same drape whatever their
//      settings, which keeps this well clear of
//      docs/design/graphics-settings-fairness.md.
//
// Three/DOM-free and deterministic (a registered RENDER_PURE_CORE).

import { drapeRingLocalY, type HeightSampler } from './selection_ring';

/** Squared camera distances at which the drape steps down one stride. Inside
 *  the first band the drape is always exact. */
const STRIDE_BANDS_SQ = [20 * 20, 40 * 40, 70 * 70];
export const MAX_DRAPE_STRIDE = 4;

/** How far apart, in yards, two consecutive SAMPLED vertices may end up. The
 *  interpolation fills the gap with a straight line, so this is the length of
 *  terrain a fill is allowed to span; past about 40 yards from the camera the
 *  looser bound applies. Both are well inside the aura and decal geometries and
 *  well outside the wide shockwave footprints, which is the point. */
const MAX_SAMPLE_SPACING_NEAR = 0.6;
const MAX_SAMPLE_SPACING_FAR = 1;

/** Never decimate a rim below this many sampled points, whatever the numbers
 *  above say: a disc described by fewer than this stops reading as a disc. */
const MIN_FAN_SAMPLES = 8;

/**
 * Drape stride for a mark whose center is `distanceSq` (squared yards) from the
 * camera and whose adjacent vertices sit `vertexSpacing` yards apart: 1 is the
 * exact per-vertex drape, N samples every Nth vertex.
 *
 * An unknown distance (negative or non-finite) means "assume it is right in
 * front of the player" and drapes exactly, so a caller that has not seen a
 * camera yet can never look worse than the old code.
 */
export function drapeStrideFor(distanceSq: number, vertexSpacing: number): number {
  if (!Number.isFinite(distanceSq) || distanceSq < 0) return 1;
  if (!Number.isFinite(vertexSpacing) || vertexSpacing <= 0) return 1;
  let byDistance = 1;
  for (const band of STRIDE_BANDS_SQ) {
    if (distanceSq <= band) break;
    byDistance++;
  }
  const maxSpacing =
    distanceSq > STRIDE_BANDS_SQ[1] ? MAX_SAMPLE_SPACING_FAR : MAX_SAMPLE_SPACING_NEAR;
  const bySpacing = Math.floor(maxSpacing / vertexSpacing);
  return Math.max(1, Math.min(MAX_DRAPE_STRIDE, byDistance, bySpacing));
}

/** Yards between two adjacent rim vertices of a `segments`-sided disc of the
 *  given radius: the input `drapeStrideFor` needs to bound its fills. */
export function fanVertexSpacing(radius: number, segments: number): number {
  return (2 * Math.PI * Math.abs(radius)) / Math.max(1, segments);
}

function clampFanStride(stride: number, rimSpan: number): number {
  if (!Number.isFinite(stride) || stride <= 1) return 1;
  const maxStride = Math.floor(rimSpan / Math.max(1, MIN_FAN_SAMPLES - 1));
  return Math.max(1, Math.min(Math.floor(stride), maxStride));
}

/**
 * Drape a triangle-fan disc (three's CircleGeometry layout: index 0 is the
 * center, indices 1..n-1 walk the rim in angular order and the last one closes
 * the seam on the first).
 *
 * `stride` 1 is exactly `drapeRingLocalY`. Above that, the center and every
 * `stride`-th rim vertex are sampled (the seam-closing last index always is),
 * and the rim vertices between two samples are linearly interpolated.
 */
export function drapeFanLocalY(
  localXZ: ArrayLike<number>,
  cx: number,
  cz: number,
  baseY: number,
  scale: number,
  lift: number,
  sample: HeightSampler,
  outY: Float32Array,
  stride = 1,
): Float32Array {
  const n = outY.length;
  const rimSpan = n - 1; // rim indices 1..n-1
  const step = clampFanStride(stride, rimSpan);
  if (step <= 1 || rimSpan < 2) {
    return drapeRingLocalY(localXZ, cx, cz, baseY, scale, lift, sample, outY);
  }
  const invScale = scale !== 0 ? 1 / scale : 1;
  const sampleInto = (i: number): void => {
    const h = sample(cx + scale * localXZ[i * 2], cz + scale * localXZ[i * 2 + 1]);
    outY[i] = (h + lift - baseY) * invScale;
  };
  sampleInto(0);
  sampleInto(1);
  let prev = 1;
  const last = n - 1;
  while (prev < last) {
    const next = Math.min(prev + step, last);
    sampleInto(next);
    const spanY = outY[next] - outY[prev];
    const invSpan = 1 / (next - prev);
    for (let j = prev + 1; j < next; j++) outY[j] = outY[prev] + spanY * (j - prev) * invSpan;
    prev = next;
  }
  return outY;
}
