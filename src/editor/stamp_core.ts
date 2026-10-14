// Pure sculpt-tool math for the map editor: the Smooth, Flatten, Sharpen,
// Noise and Terrace stamp builders, the Erase hit tests, and the Select-mode
// placement pick test. No DOM, no Three, no i18n; the terrain sampler is
// injected so a Vitest drives these with a synthetic heightfield
// (tests/editor_stamp_core.test.ts).
//
// Level-stamp semantics (src/sim/world.ts applyEditLayer): a stamp with
// mode 'level' pulls the height toward the absolute height `delta`, weighted by
// the falloff (1 at the centre for 'smooth', constant 1 for 'flat').

import { NOISE_SIZE_MAX, NOISE_SIZE_MIN, NOISE_STROKE_OVERLAP } from '../sim/terrain_noise_brush';
import type { HeightStamp } from '../sim/types';
import type { AssetPlacement } from './custom_map';

export type HeightSampler = (x: number, z: number) => number;

/**
 * Global gentleness scale for the Smooth and Flatten LEVEL brushes: every stamp
 * moves the ground only this fraction of the way it otherwise would, so fine
 * sculpting no longer overshoots. 1/5 = "5x gentler" while the brush-strength
 * slider keeps the exact same steps (a fifth the power per stamp, same range).
 * Smooth scales its blend factor by it; Flatten scales its pull toward the
 * captured target height. Raise/Lower (the `add` brushes) are unaffected.
 */
export const SCULPT_POWER_SCALE = 1 / 5;

/**
 * The five sample points the Smooth tool averages: the cursor plus four points
 * at half the brush radius on the +x/-x/+z/-z axes.
 */
export function smoothSamplePoints(
  x: number,
  z: number,
  radius: number,
): { x: number; z: number }[] {
  const h = radius / 2;
  return [
    { x, z },
    { x: x + h, z },
    { x: x - h, z },
    { x, z: z + h },
    { x, z: z - h },
  ];
}

/**
 * How wide Smooth looks, as a fraction of the brush radius. This is the dial
 * SPACEY asked for on 2026-09-09 ("smooth out the ridges but keep the shape of
 * the land"): a GENTLE stroke averages over a tenth of the brush, so only
 * detail finer than that is taken off, while a strong stroke reaches the legacy
 * half-radius and genuinely reshapes the ground. Strength used to change only
 * how FAST the brush converged, never what it converged to, which is why even
 * the lowest setting eventually flattened a headland.
 */
export function smoothKernelSpread(strength: number): number {
  const t = Math.min(1, Math.max(0, strength / 10));
  return 0.1 + 0.4 * t;
}

/** A 3x3 binomial kernel (weights 4/2/1) at `reach` yards: the diagonals sit at
 *  the same distance as the axes, so the kernel is isotropic and a jagged edge
 *  reads the same from any direction. A symmetric kernel leaves a planar slope
 *  exactly where it is, which is the property the whole brush rests on. */
function kernelAt(x: number, z: number, reach: number): { x: number; z: number; w: number }[] {
  const d = reach * Math.SQRT1_2;
  return [
    { x, z, w: 4 },
    { x: x + reach, z, w: 2 },
    { x: x - reach, z, w: 2 },
    { x, z: z + reach, w: 2 },
    { x, z: z - reach, w: 2 },
    { x: x + d, z: z + d, w: 1 },
    { x: x - d, z: z + d, w: 1 },
    { x: x + d, z: z - d, w: 1 },
    { x: x - d, z: z - d, w: 1 },
  ];
}

/** Weighted mean height over a kernel. */
function kernelMean(pts: { x: number; z: number; w: number }[], sample: HeightSampler): number {
  let sum = 0;
  let wsum = 0;
  for (const p of pts) {
    sum += sample(p.x, p.z) * p.w;
    wsum += p.w;
  }
  return wsum > 0 ? sum / wsum : 0;
}

/** Least-squares slope of the ground over a kernel, in yards per yard. The
 *  kernel is symmetric about its centre, so the normal equations collapse to
 *  these two independent sums. */
function kernelSlope(
  cx: number,
  cz: number,
  pts: { x: number; z: number; w: number }[],
  sample: HeightSampler,
): { gx: number; gz: number } {
  let sxx = 0;
  let szz = 0;
  let sxh = 0;
  let szh = 0;
  for (const p of pts) {
    const dx = p.x - cx;
    const dz = p.z - cz;
    const h = sample(p.x, p.z);
    sxx += p.w * dx * dx;
    szz += p.w * dz * dz;
    sxh += p.w * dx * h;
    szh += p.w * dz * h;
  }
  return { gx: sxx > 1e-9 ? sxh / sxx : 0, gz: szz > 1e-9 ? szh / szz : 0 };
}

/**
 * Keep the target plane inside the ground the brush can actually see.
 *
 * A least-squares fit across a sea cliff reports several yards per yard;
 * extrapolated to the brush rim that plane sits a hundred yards under the water,
 * and a few strokes tore the headland off (measured on the Deepglass rim before
 * this guard). The bound is taken along the fitted slope's OWN direction, two
 * samples, uphill and downhill at the brush radius, so the plane may rise
 * exactly as far as the real ground does and no further.
 *
 * On planar ground those two samples ARE the plane, so nothing is scaled and
 * Smooth stays an exact no-op there. Where the ground doubles back within the
 * brush the allowance goes to zero and the target flattens out, which is the
 * safe reading of "this fit does not describe this ground".
 */
function clampSlope(
  g: { gx: number; gz: number },
  cx: number,
  cz: number,
  delta: number,
  radius: number,
  sample: HeightSampler,
): { gx: number; gz: number } {
  const mag = Math.hypot(g.gx, g.gz);
  if (mag <= 1e-9 || radius <= 0) return g;
  const ux = g.gx / mag;
  const uz = g.gz / mag;
  const up = sample(cx + ux * radius, cz + uz * radius);
  const down = sample(cx - ux * radius, cz - uz * radius);
  const allowed = Math.max(0, Math.min(up - delta, delta - down));
  const reach = mag * radius;
  if (reach <= allowed * (1 + 1e-9)) return g;
  return { gx: (g.gx * allowed) / reach, gz: (g.gz * allowed) / reach };
}

/**
 * Smooth: a level-mode stamp that pulls the ground toward its own local TREND
 * PLANE, the average height at the cursor, tilted by the slope the ground
 * already has across the brush.
 *
 * Two kernels do two jobs. The tight one (smoothKernelSpread, driven by the
 * strength slider) supplies the average, so a gentle stroke only takes off
 * detail finer than a tenth of the brush. The wide one supplies the slope,
 * measured across the whole brush so the target plane never extrapolates a
 * local wrinkle out to the rim.
 *
 * The consequence that matters: on planar ground the target IS the ground, so
 * the stamp is a no-op at any strength. The old version levelled the whole disc
 * toward a single height, which pressed every slope it touched into a terrace
 * and is what "ruins the shape of the land" meant.
 *
 * `strength` is the editor's EFFECTIVE brush strength (the 1..50 slider divided
 * by 5, i.e. 0.2..10; slider 5 == the legacy 1).
 */
export function smoothStamp(
  x: number,
  z: number,
  radius: number,
  strength: number,
  sample: HeightSampler,
): HeightStamp {
  const detail = kernelAt(x, z, radius * smoothKernelSpread(strength));
  // The trend is measured across the WHOLE brush, because that is the ground
  // the target plane gets applied to: a plane fitted over a narrow kernel and
  // extrapolated to the rim is how a cliff lip turns into a 100-yard spike.
  const trend = kernelAt(x, z, radius);
  const avg = kernelMean(detail, sample);
  const { gx, gz } = clampSlope(kernelSlope(x, z, trend, sample), x, z, avg, radius, sample);
  // Modest strength scaling: the floor sits at a fifth of the legacy floor so
  // slider 1 really is 5x gentler; 10 (slider 50) pulls most of the way. The
  // whole curve is then scaled by SCULPT_POWER_SCALE so the brush is a further
  // 5x gentler across every slider step (its twin is flattenStamp below).
  const k = Math.min(0.65, Math.max(0.016, strength / 40)) * SCULPT_POWER_SCALE;
  const stamp: HeightStamp = {
    x,
    z,
    radius,
    // The target is the honest local surface (the smoothed height plus the
    // ground's own slope) and the pull is carried separately, so on planar
    // ground the target IS the ground and the stamp cancels at any strength.
    delta: avg,
    falloff: 'smooth',
    mode: 'level',
    strength: k,
  };
  if (gx !== 0) stamp.gx = gx;
  if (gz !== 0) stamp.gz = gz;
  return stamp;
}

/**
 * Flatten: a level-mode stamp that pulls the ground toward the height captured
 * at the drag START point. `hardEdge` selects the 'flat' falloff (a sheer
 * plateau edge) over the default eased taper.
 *
 * `strength` eases the pull: the stamp targets only `strength` of the way from
 * the CURRENT surface height (`currentHeight`) toward `targetHeight`, so a value
 * below 1 converges over more strokes instead of snapping in one. Both default
 * to a full hard snap (`currentHeight = targetHeight`, `strength = 1`) so older
 * callers and tests are unchanged; the editor passes SCULPT_POWER_SCALE for the
 * 5x-gentler brush.
 */
export function flattenStamp(
  x: number,
  z: number,
  radius: number,
  targetHeight: number,
  hardEdge: boolean,
  currentHeight = targetHeight,
  strength = 1,
): HeightStamp {
  return {
    x,
    z,
    radius,
    delta: currentHeight + (targetHeight - currentHeight) * strength,
    falloff: hardEdge ? 'flat' : 'smooth',
    mode: 'level',
  };
}

/**
 * Sharpen: the INVERSE of Smooth, a level-mode stamp that pushes the height
 * AWAY from the local average, so ridges crest harder and gullies bite deeper
 * (Blender's Sharpen/Enhance Details, on a heightfield). Same gentleness
 * scaling as smoothStamp so the two feel like opposite ends of one dial.
 */
export function sharpenStamp(
  x: number,
  z: number,
  radius: number,
  strength: number,
  sample: HeightSampler,
): HeightStamp {
  const pts = smoothSamplePoints(x, z, radius);
  let sum = 0;
  for (const p of pts) sum += sample(p.x, p.z);
  const avg = sum / pts.length;
  const here = sample(x, z);
  const k = Math.min(0.65, Math.max(0.016, strength / 40)) * SCULPT_POWER_SCALE;
  return {
    x,
    z,
    radius,
    delta: here + (here - avg) * k * 2,
    falloff: 'smooth',
    mode: 'level',
  };
}

/**
 * How tall a finished Noise stroke's bumps are, per yard of bump size and per
 * unit of effective brush strength. Tuned on the field's measured slope: at the
 * default slider (30, effective 6) a stroke's ground averages about a 12-degree
 * grade (gentle undulation), at the top (50, effective 10) about 20 degrees
 * with 35-degree crags; the height grows with the bump size, so big swells and
 * fine grain keep the same character.
 */
export const NOISE_HEIGHT_PER_SIZE = 0.02;

/**
 * Noise: an add-mode stamp that paints natural undulation across the WHOLE
 * brush. The runtime scales its delta by a seeded fractal field in world space
 * (src/sim/terrain_noise_brush.ts), so every dab of a stroke (one `seed` per
 * stroke) adds to one coherent pattern, and dragging builds rolling ground
 * instead of the brush-centre blob the old random-sign bump laid.
 *
 * `size` is the bump size in yards (the widest layer; finer layers ride on
 * top), `rough` 0..1 how strongly the finer layers show. `strength` is the
 * editor's EFFECTIVE brush strength (slider / 5).
 */
export function noiseStamp(
  x: number,
  z: number,
  radius: number,
  strength: number,
  size: number,
  rough: number,
  seed: number,
): HeightStamp {
  const bump = Math.min(NOISE_SIZE_MAX, Math.max(NOISE_SIZE_MIN, size));
  const height = bump * NOISE_HEIGHT_PER_SIZE * Math.max(0, strength);
  return {
    x,
    z,
    radius,
    // A stroke lays a dab every half radius, so a point on its centre line
    // collects about NOISE_STROKE_OVERLAP dabs' worth of weight.
    delta: height / NOISE_STROKE_OVERLAP,
    falloff: 'smooth',
    noiseSize: bump,
    noiseSeed: seed,
    noiseRough: Math.min(1, Math.max(0, rough)),
  };
}

/**
 * Terrace: a level-mode stamp that pulls the ground toward the nearest
 * multiple of `stepHeight`, stroke across a slope and it steps into ledges
 * (the terrace/plateau brush). Eased by the same power scale so repeated
 * passes converge instead of snapping.
 */
export function terraceStamp(
  x: number,
  z: number,
  radius: number,
  stepHeight: number,
  sample: HeightSampler,
): HeightStamp {
  const step = Math.max(0.25, stepHeight);
  const here = sample(x, z);
  const target = Math.round(here / step) * step;
  return {
    x,
    z,
    radius,
    delta: here + (target - here) * (SCULPT_POWER_SCALE * 3),
    falloff: 'smooth',
    mode: 'level',
  };
}

/**
 * Erase hit test for sculpt stamps: the index of the MOST RECENT stamp whose
 * disc contains the click point, or -1. Later stamps sit "on top", so erasing
 * peels newest-first.
 */
export function eraseStampIndex(stamps: readonly HeightStamp[], x: number, z: number): number {
  for (let i = stamps.length - 1; i >= 0; i--) {
    const s = stamps[i];
    const dx = x - s.x;
    const dz = z - s.z;
    if (dx * dx + dz * dz <= s.radius * s.radius) return i;
  }
  return -1;
}

/**
 * Erase hit test for placements: the index of the NEAREST placement within
 * `radius` of the click point, or -1.
 */
export function erasePlacementIndex(
  placements: readonly AssetPlacement[],
  x: number,
  z: number,
  radius: number,
): number {
  let best = -1;
  let bestD2 = radius * radius;
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    const dx = x - p.x;
    const dz = z - p.z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= bestD2) {
      best = i;
      bestD2 = d2;
    }
  }
  return best;
}

// Select-mode placement picking (2D top-down view): screen-space forgiveness
// (px) so a small placement stays clickable however far the view is zoomed
// out, and a scale multiplier mirroring the 3D viewport's pickPlacement
// (src/editor/3d/viewport.ts), which widens its own pick radius to
// `scale * 2` around whichever placement anchor the raycast lands nearest.
export const PLACEMENT_PICK_SLOP_PX = 8;
export const PLACEMENT_PICK_SCALE_MULT = 2;
/** Mirrors pickPlacement's no-raycast-hit floor (yards). */
export const PLACEMENT_PICK_MIN_RADIUS = 1.5;

/**
 * Select-mode pick radius for one placement (world yards): the largest of a
 * fixed floor, the current zoom's screen-space forgiveness converted to
 * yards, and the placement's own scale (mirroring the 3D formula).
 */
export function placementPickRadius(scale: number, pxPerYard: number): number {
  const forgiveness = PLACEMENT_PICK_SLOP_PX / Math.max(0.01, pxPerYard);
  return Math.max(PLACEMENT_PICK_MIN_RADIUS, forgiveness, (scale || 1) * PLACEMENT_PICK_SCALE_MULT);
}

/**
 * Select-mode hit test for placements: the index of the NEAREST placement
 * whose own scale-and-zoom-aware radius (`placementPickRadius`) contains the
 * click point, or -1. Unlike `erasePlacementIndex` (the Erase tool's single
 * uniform brush radius), each placement gets its own radius here, so a big
 * scaled-up prop stays as easy to click as it looks and a small one at low
 * zoom does not vanish to a couple of world-yard pixels.
 */
export function pickPlacementIndex(
  placements: readonly AssetPlacement[],
  x: number,
  z: number,
  pxPerYard: number,
): number {
  let best = -1;
  let bestD2 = Number.POSITIVE_INFINITY;
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    const dx = x - p.x;
    const dz = z - p.z;
    const d2 = dx * dx + dz * dz;
    const r = placementPickRadius(p.scale, pxPerYard);
    if (d2 <= r * r && d2 < bestD2) {
      best = i;
      bestD2 = d2;
    }
  }
  return best;
}

/** World-space bounds of one stamp's influence (for region-local remeshing). */
export function stampRegion(stamp: HeightStamp): {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
} {
  return {
    minX: stamp.x - stamp.radius,
    minZ: stamp.z - stamp.radius,
    maxX: stamp.x + stamp.radius,
    maxZ: stamp.z + stamp.radius,
  };
}

/** Union of two regions (accumulating a stroke's dirty bounds). */
export function unionRegion(
  a: { minX: number; minZ: number; maxX: number; maxZ: number } | null,
  b: { minX: number; minZ: number; maxX: number; maxZ: number },
): { minX: number; minZ: number; maxX: number; maxZ: number } {
  if (!a) return { ...b };
  return {
    minX: Math.min(a.minX, b.minX),
    minZ: Math.min(a.minZ, b.minZ),
    maxX: Math.max(a.maxX, b.maxX),
    maxZ: Math.max(a.maxZ, b.maxZ),
  };
}
