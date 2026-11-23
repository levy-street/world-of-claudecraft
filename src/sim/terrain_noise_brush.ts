// The Noise sculpt brush (the Level tool's Noise style): natural, multi-scale
// undulation painted across the whole brush disc.
//
// A noise stamp is an ordinary `add` HeightStamp whose falloff-weighted delta is
// scaled by a seeded fractal field sampled in WORLD space. Every dab of one
// stroke carries the stroke's seed, bump size and roughness, so the overlapping
// dabs add up to ONE coherent pattern that builds as you drag, instead of the
// row of brush-centre blobs the old per-dab bump made (SPACEY, 2026-09-15: "it
// just smooths the middle of the brush"). A second stroke rolls a new seed and
// layers fresh detail over the first.
//
// The field is domain-warped value-noise fbm on noise2's lattice (the stateless
// hash the whole heightfield uses). Each octave is rotated by the exact 3-4-5
// angle and scaled by 2.03, so no two lattices line up and the grid never
// shows; the sum is normalised by its RMS amplitude, so Roughness changes the
// character of the ground and not its height. No trig, no pow, no randomness:
// the sim, the server, the renderer and the zone-build workers all compute
// bit-identical terrain from the stamp record alone.

import { noise2 } from './rng';
import type { HeightStamp } from './types';

/** The Bump size range the brush offers, in yards (a sanitised document may
 *  carry anything in NOISE_SIZE_LIMIT; the UI stays inside this). */
export const NOISE_SIZE_MIN = 3;
export const NOISE_SIZE_MAX = 48;
export const NOISE_SIZE_DEFAULT = 6;
export const NOISE_ROUGH_DEFAULT = 0.5;
/** Hard bounds for a stored stamp (map_doc sanitizer). */
export const NOISE_SIZE_LIMIT = { min: 1, max: 64 } as const;

/** The terrain vertex spacing a chunk carrying noise meshes at: fine enough
 *  that the smallest octave (about 1.5 yd, see noiseBrushOctaves) renders as
 *  bumps instead of aliasing into facets, and so the drawn ground stays on the
 *  collision surface. The static hub band is 1.2 yd, the wilderness 2.6 yd. */
export const NOISE_MESH_SPACING = 0.9;

// Normalised so the field's standard deviation is about 0.45: typical crests
// and dips sit near +-1, the stamp's delta is the height of a typical bump.
const FIELD_GAIN = 2.1;
// Lattice units per octave step (a touch past 2 so octaves never realign).
const LACUNARITY = 2.03;
// The finest octave stops at this lattice cell, in yards: finer detail than
// this cannot be drawn by a 0.9-yd mesh and only shows as jitter.
const FINEST_CELL_YD = 1.4;
const MAX_OCTAVES = 5;
// Domain warp: a low-frequency meander (in lattice units) that bends the
// bumps into winding swells and swales instead of a field of round domes.
const WARP_FREQ = 0.37;
const WARP_AMP = 0.9;

/** Octave count for a bump size: layers are added until the next one would be
 *  finer than FINEST_CELL_YD, so big bumps still carry small detail on top. */
export function noiseBrushOctaves(size: number): number {
  let octaves = 1;
  for (let cell = size / LACUNARITY; cell >= FINEST_CELL_YD && octaves < MAX_OCTAVES; ) {
    octaves++;
    cell /= LACUNARITY;
  }
  return Math.max(2, octaves);
}

/** How fast each octave fades: 0 = soft rolling swells (fine layers barely
 *  show), 1 = craggy ground (fine layers nearly as strong as the base). */
function octaveGain(rough: number): number {
  const r = rough >= 0 && rough <= 1 ? rough : NOISE_ROUGH_DEFAULT;
  return 0.3 + 0.4 * r;
}

/**
 * The brush's noise field at world (x, z): zero-centred, standard deviation
 * about 0.45 (so roughly -1..1), deterministic in (x, z, size, rough, seed).
 */
export function noiseBrushField(
  x: number,
  z: number,
  size: number,
  rough: number,
  seed: number,
): number {
  const s = size > NOISE_SIZE_LIMIT.min ? size : NOISE_SIZE_LIMIT.min;
  let px = x / s;
  let pz = z / s;
  const wx = noise2(px * WARP_FREQ + 5.2, pz * WARP_FREQ + 1.3, seed + 7) - 0.5;
  const wz = noise2(px * WARP_FREQ + 9.7, pz * WARP_FREQ + 4.1, seed + 11) - 0.5;
  px += wx * 2 * WARP_AMP;
  pz += wz * 2 * WARP_AMP;
  const gain = octaveGain(rough);
  const octaves = noiseBrushOctaves(s);
  let amp = 1;
  let sum = 0;
  let power = 0;
  for (let i = 0; i < octaves; i++) {
    sum += (noise2(px, pz, seed + 101 + i * 1013) - 0.5) * amp;
    power += amp * amp;
    amp *= gain;
    // Rotate by the 3-4-5 angle (exact: cos 0.8, sin 0.6) and step up.
    const nx = (px * 0.8 - pz * 0.6) * LACUNARITY + 17.3;
    pz = (px * 0.6 + pz * 0.8) * LACUNARITY + 3.9;
    px = nx;
  }
  return (sum / Math.sqrt(power)) * FIELD_GAIN;
}

/**
 * A noise dab's radial weight: a soft PLATEAU (the smoothstep taken over t^2)
 * instead of the round brush's dome, so the detail covers the whole disc and
 * still fades to nothing with a flat tangent at the rim. At half radius it
 * keeps 84% (the dome keeps 50%), which is what stops a stroke from reading
 * as "only the middle of the brush changed".
 */
export function noisePlateau(t: number): number {
  if (t >= 1) return 0;
  const u = t * t;
  return 1 - u * u * (3 - 2 * u);
}

/** Summed plateau weight a point on a stroke's centre line receives from the
 *  overlapping dabs laid every half radius (2.69 on a dab, 2.79 between):
 *  the editor divides a stroke's target height by this to get one dab's. */
export const NOISE_STROKE_OVERLAP = 2.75;

// One-entry memo: applyEditLayer walks a point's stamps back to back, and the
// dabs of one stroke share seed/size/rough, so a stroke costs one field
// evaluation per sample point instead of one per overlapping dab. A pure
// cache of a pure function, so results stay bit-identical.
let memoX = Number.NaN;
let memoZ = Number.NaN;
let memoSeed = Number.NaN;
let memoSize = Number.NaN;
let memoRough = Number.NaN;
let memoValue = 0;

function stampField(e: HeightStamp, size: number, x: number, z: number): number {
  const seed = e.noiseSeed ?? 0;
  const rough = e.noiseRough ?? NOISE_ROUGH_DEFAULT;
  if (x === memoX && z === memoZ && seed === memoSeed && size === memoSize && rough === memoRough) {
    return memoValue;
  }
  memoValue = noiseBrushField(x, z, size, rough, seed);
  memoX = x;
  memoZ = z;
  memoSeed = seed;
  memoSize = size;
  memoRough = rough;
  return memoValue;
}

/**
 * What a Noise-brush `add` stamp multiplies its delta by at (x, z), `t` the
 * distance over the radius (0 centre, < 1 inside): the plateau falloff times
 * the noise field. world.ts applyStamp routes only stamps carrying
 * `noiseSize` here; every other stamp keeps its `delta * w` untouched.
 */
export function noiseStampWeight(e: HeightStamp, x: number, z: number, t: number): number {
  const size = e.noiseSize;
  if (size === undefined) return 0;
  const w = noisePlateau(t);
  return w > 0 ? w * stampField(e, size, x, z) : 0;
}

// The noise stamps' footprints, cached per edits array, its length and the
// content generation, so a chunk asking "do I carry noise?" never rescans the
// whole 10k-stamp list. All three are needed: a stroke PUSHES its dabs and
// only bumps the generation at pointer-up (the length catches every dab, undo
// and redo), while an in-place move keeps the length and bumps the generation.
let footprintEdits: readonly HeightStamp[] | null = null;
let footprintLen = -1;
let footprintGen = Number.NaN;
let footprints: HeightStamp[] = [];

/**
 * The vertex spacing noise stamps ask for inside a rectangle:
 * NOISE_MESH_SPACING when any noise stamp's disc reaches it, otherwise
 * Infinity (no opinion). Pass the content generation the edits belong to.
 */
export function noiseStampSpacingIn(
  edits: readonly HeightStamp[] | undefined,
  generation: number,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): number {
  if (!edits || edits.length === 0) return Number.POSITIVE_INFINITY;
  if (edits !== footprintEdits || edits.length !== footprintLen || generation !== footprintGen) {
    footprintEdits = edits;
    footprintLen = edits.length;
    footprintGen = generation;
    footprints = edits.filter((e) => e.noiseSize !== undefined && e.mode !== 'level');
  }
  for (const e of footprints) {
    if (
      e.x + e.radius >= minX &&
      e.x - e.radius <= maxX &&
      e.z + e.radius >= minZ &&
      e.z - e.radius <= maxZ
    ) {
      return NOISE_MESH_SPACING;
    }
  }
  return Number.POSITIVE_INFINITY;
}
