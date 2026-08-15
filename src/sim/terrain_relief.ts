// Natural-relief math for the world heightfield.
//
// The classic heightfield was one smooth value-noise fbm per biome: every
// hill the same rounded blob, mountains included. This module adds the three
// standard techniques the literature uses to make procedural terrain read as
// real landforms, composed by baseHeight (world.ts):
//
// - Domain warping (Quilez, "warp"): the hill layer is sampled through a
//   low-frequency coordinate warp, so contours meander and drainage-like
//   irregularity appears instead of uniform noise blobs.
// - Gradient-damped fbm (Quilez, "morenoise"; the erosion-flavored fbm):
//   each octave's amplitude is divided by the accumulated gradient of the
//   octaves before it, so valley floors come out smooth (sediment) while
//   uplands keep their roughness. Needs value noise with ANALYTIC
//   derivatives, provided here on the exact lattice noise2 uses.
// - Ridged multifractal (Musgrave): folded noise whose octaves are weighted
//   by the running signal, producing connected sharp ridgelines and crags
//   instead of round hilltops. baseHeight masks it to highlands so ranges
//   crown the hills that are already tall (proportional mountains, smooth
//   lowlands).
//
// Everything here is a pure function of (x, z, seed) through the same
// stateless hash the sim's noise2/fbm2 use: no Math.random, no clocks, no
// state. Every host (offline browser Sim, authoritative server, headless RL
// env) and every player computes bit-identical terrain from the one shipped
// WORLD_SEED; the renderer samples the same functions, so the drawn mesh and
// the collision surface can never drift apart.

import { hash2, noise2 } from './rng';

// Quintic fade (Perlin's improved-noise curve), NOT noise2's cubic: the
// gradient-damped fbm divides by accumulated derivatives, and with a cubic
// fade those derivatives are only C0 at lattice cell edges, which puts
// visible creases (locally cliff-steep kinks) into the damped field. The
// quintic's second derivative vanishes at the cell edges, so the damping
// factor stays smooth everywhere.
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const dFade = (t: number): number => 30 * t * t * (t - 1) * (t - 1);

// Scratch for noise2d: baseHeight runs for every terrain sample in the world
// (movement, pathfinding, chunk meshing), so the derivative variant must not
// allocate. Callers consume all three fields before the next call (same
// discipline as world.ts shapeScratch).
const n2dScratch = { v: 0, dx: 0, dy: 0 };

/**
 * Value noise with analytic derivatives on noise2's exact lattice: returns
 * the noise value in [0,1] plus d/dx and d/dy, without extra taps. The
 * bilinear form n = a + (b-a)u + (c-a)v + (a-b-c+d)uv differentiates to
 * dn/dx = ((b-a) + (a-b-c+d)v) * u'(xf) (Quilez, morenoise).
 */
export function noise2d(x: number, y: number, seed: number): { v: number; dx: number; dy: number } {
  const xi = Math.floor(x),
    yi = Math.floor(y);
  const xf = x - xi,
    yf = y - yi;
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  const u = fade(xf),
    v = fade(yf);
  const k3 = a - b - c + d;
  n2dScratch.v = a + (b - a) * u + (c - a) * v + k3 * u * v;
  n2dScratch.dx = (b - a + k3 * v) * dFade(xf);
  n2dScratch.dy = (c - a + k3 * u) * dFade(yf);
  return n2dScratch;
}

/**
 * Fractal noise in [0,1] whose octaves damp on the accumulated gradient:
 * where earlier octaves already built a steep slope, later octaves fade, so
 * flats stay smooth and relief keeps its character (the erosion look).
 * `erosion` 0 degenerates to plain fbm2's layering.
 */
export function erodedFbm2(
  x: number,
  y: number,
  seed: number,
  octaves: number,
  erosion: number,
): number {
  let sum = 0,
    amp = 0.5,
    freq = 1,
    total = 0,
    gx = 0,
    gy = 0;
  for (let i = 0; i < octaves; i++) {
    const n = noise2d(x * freq, y * freq, seed + i * 1013);
    gx += n.dx * freq;
    gy += n.dy * freq;
    sum += (amp * n.v) / (1 + erosion * (gx * gx + gy * gy));
    total += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / total;
}

/**
 * Ridged multifractal in [0,1]: fold the noise around its midline so crests
 * become sharp lines, square for spikiness, and weight each octave by the
 * running signal (Musgrave) so detail concentrates on the ridges themselves.
 * High values are ridgelines; the floors between ridges sit near 0.
 */
export function ridged2(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0,
    amp = 0.5,
    freq = 1,
    total = 0,
    weight = 1;
  for (let i = 0; i < octaves; i++) {
    const n = noise2(x * freq, y * freq, seed + i * 1013);
    let r = 1 - Math.abs(2 * n - 1);
    r = r * r * weight;
    // the running-signal weight: octaves only roughen where a ridge exists
    weight = Math.min(1, r * 1.9);
    sum += r * amp;
    total += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / total;
}

// ---------------------------------------------------------------------------
// The composed relief layers baseHeight consumes. Frequencies are per-yard.
// ---------------------------------------------------------------------------

// The coordinate warp: ~220yd wavelength, +-WARP_AMP/2 yards of meander.
// Strong enough that hill contours wander organically, gentle enough that no
// fixed feature (hub, camp, dock anchor) drifts off its flattened pad.
const WARP_FREQ = 0.0045;
const WARP_AMP = 30;

// The crag layer's ridge spacing: ~70yd primary ridgelines, three octaves
// down to ~18yd members, which the densest chunk lattice (1.2yd) carries
// cleanly and the 2.6yd wilderness lattice still resolves.
const CRAG_FREQ = 0.014;

// Scratch for warpedCoords (same no-allocation discipline as noise2d).
const warpScratch = { x: 0, z: 0 };

/** The shared domain warp: hill and crag layers sample through this, so the
 *  two agree on where a slope actually lies. `ampScale` in [0, 1] eases the
 *  meander off (baseHeight passes its road-calm factor: a warp fold can
 *  locally double the terrain gradient, which a graded way must not carry). */
export function warpedCoords(
  x: number,
  z: number,
  seed: number,
  ampScale: number,
): { x: number; z: number } {
  const amp = WARP_AMP * ampScale;
  if (amp <= 0) {
    warpScratch.x = x;
    warpScratch.z = z;
    return warpScratch;
  }
  const wx = noise2(x * WARP_FREQ, z * WARP_FREQ, seed + 271);
  const wz = noise2(x * WARP_FREQ + 39.7, z * WARP_FREQ - 17.3, seed + 277);
  warpScratch.x = x + (wx - 0.5) * amp;
  warpScratch.z = z + (wz - 0.5) * amp;
  return warpScratch;
}

// The gradient damping shifts the raw eroded field's distribution (measured
// over the shipped world seed: mean 0.321, sd 0.124, vs the old plain fbm2
// hill layer's mean 0.509, sd 0.134). The affine correction below restores
// the old layer's mean and spread so world-wide height statistics, coast
// lines, and the minLand floor all stay where the old field put them; the
// erosion CHARACTER (smooth valley floors, rough uplands) is spatially
// varying and survives a global affine map untouched.
const RELIEF_EROSION = 0.9;
const RELIEF_RAW_MEAN = 0.321;
const RELIEF_GAIN = 1.08;

/** The rolling-hill base in [0,1]: gradient-damped fbm over warped
 *  coordinates, affine-corrected to the old plain-fbm2 hill layer's mean and
 *  spread (drop-in replacement at the same frequency and octave count). */
export function reliefBase(wx: number, wz: number, seed: number, hillScale: number): number {
  const raw = erodedFbm2(wx * hillScale + 100, wz * hillScale + 100, seed, 4, RELIEF_EROSION);
  return 0.5 + (raw - RELIEF_RAW_MEAN) * RELIEF_GAIN;
}

/** How "upland" a base value is, in [0,1]: the mask that keys the crag layer
 *  and the detail roughness to ground that already stands high, so mountains
 *  grow from hills and valley floors stay calm. */
export function highlandMask(baseV: number): number {
  const t = (baseV - 0.54) / (0.78 - 0.54);
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** The crag layer in [0,1]: ridged multifractal over the shared warp.
 *  baseHeight scales it by the biome's crag amplitude times highlandMask. */
export function cragLayer(wx: number, wz: number, seed: number): number {
  return ridged2(wx * CRAG_FREQ, wz * CRAG_FREQ, seed + 11, 3);
}
