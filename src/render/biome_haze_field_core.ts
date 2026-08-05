// Pure core for the biome haze field: the world-space lookup that lets a
// DISTANT zone carry its own atmosphere instead of borrowing the camera
// zone's.
//
// The problem it solves. On the vista tiers the outdoor fog is parked out at
// the horizon haze band (far_terrain_core.ts horizonHazePlan), so everything
// between about 150 and 2000 yards renders with no aerial perspective at all
// and with the CAMERA zone's sky and light grade over it. Looking across a
// bay from the Amberfall at the Nightbloom downs and the Palmreach canopy,
// the ground colours differ but the air does not: the frame is uniformly
// amber until you walk over the border, and then the whole world swaps at
// once. That swap is the surprise the field removes.
//
// The field itself. A low-resolution grid over the world rect (plus the far
// mesh's apron margin) where each texel holds the LOCAL zone's haze colour
// and a haze strength, both taken from that biome's outdoor fog preset. The
// grid is blurred so a zone border cross-fades over a few dozen yards rather
// than drawing a line across the vista, and the consumer shaders sample it by
// the FRAGMENT's world xz, so distant land is tinted by the air of the place
// it belongs to. The blend amount is a distance ramp from the camera
// (aerialHazeAmount): nothing at gameplay range, gentle and saturating out at
// vista range.
//
// Everything here is host-agnostic math (no Three, no DOM) so a Vitest drives
// every decision directly; the Three half (the DataTexture, the shared
// uniforms and the GLSL snippet the consumer shaders splice in) is
// biome_haze_field.ts.

import { WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_X, WORLD_MIN_Z } from '../sim/data';
import type { BiomeId } from '../sim/types';
import { zoneBiomeAt } from '../sim/world';
import { FAR_WORLD_MARGIN } from './far_terrain_core';

/** World yards per field texel. Small enough that a zone band (360 yards on
 *  its short axis) is fifteen texels across, large enough that the shipped
 *  world is a 95 x 159 texel, 60 KB texture. The build is one zoneBiomeAt tap
 *  per texel and costs about 10 ms once per session (measured warm in Node),
 *  which is why it is memoized and never rebuilt on a terrain swap. */
export const HAZE_FIELD_CELL = 24;

/** How far past the zone rects the field reaches: exactly the far mesh's own
 *  apron, so every fragment the vista can draw has a defined haze. Beyond it
 *  the texture clamps, which is the same answer the apron would give. */
export const HAZE_FIELD_MARGIN = FAR_WORLD_MARGIN;

/** Separable 1-2-1 blur passes over the rasterized field. Three passes plus
 *  the sampler's own bilinear cross-fade a border over about 120 yards (the
 *  10 to 90 percent span, pinned in tests/biome_haze_field_core.test.ts):
 *  wide enough that no border ever reads as a drawn line, tight enough that a
 *  360 yard zone band still owns a couple of hundred yards of its own air. */
export const HAZE_BLUR_PASSES = 3;

// Haze strength from the biome's fog `far`. A realm whose fog preset closes in
// at 150 yards has genuinely thick air and should read murky from across the
// world; one that stays clear to 700 should read as distance, not soup. The
// span is the real spread of BIOME_FOG.far (volcano 145 through gale 645).
export const HAZE_DENSITY_THICK_FAR = 150;
export const HAZE_DENSITY_CLEAR_FAR = 700;
/** Strength of the clearest realm's air, as a fraction of the murkiest. */
export const HAZE_STRENGTH_MIN = 0.66;

// The distance ramp. Onset well past every gameplay distance (nothing a
// player fights, loots or reads is ever hazed), then a Gaussian-shouldered
// rise so there is no onset ring, saturating a little past half a kilometre.
// HAZE_AERIAL_MAX is the ceiling for the murkiest realm; the clear realms land
// at HAZE_STRENGTH_MIN of it, so the far end of the ramp spans roughly 22 to
// 34 percent. Never a paint-over: the distant ground keeps its own colour.
export const HAZE_AERIAL_ONSET = 150;
export const HAZE_AERIAL_REF = 350;
export const HAZE_AERIAL_MAX = 0.34;

/** The subset of a biome's outdoor fog preset the field needs. The renderer
 *  owns the preset table and passes it in, so the haze can never drift from
 *  the atmosphere the player meets when they cross the border. */
export interface BiomeHazePreset {
  /** sRGB hex, the fog colour the biome grades to on entry. */
  color: number;
  /** The preset's fog `far`, which is what "thick air" means here. */
  far: number;
}

export interface HazeFieldLayout {
  /** World xz of the field's low corner (texel 0,0 centre is half a cell in). */
  originX: number;
  originZ: number;
  cell: number;
  cols: number;
  rows: number;
  /** cols * cell, rows * cell: the rect a shader normalizes against. */
  sizeX: number;
  sizeZ: number;
}

export interface BiomeHazeFieldData {
  layout: HazeFieldLayout;
  /** Row-major RGBA8. RGB is the haze colour sRGB-ENCODED (the texture is
   *  uploaded as sRGB so the sampler hands the shader linear values, matching
   *  what THREE.Color.setHex gives the scene fog); A is the linear strength.
   *  Pinned to a plain ArrayBuffer: THREE.DataTexture will not take the
   *  SharedArrayBuffer arm of the default typed-array generic. */
  rgba: Uint8Array<ArrayBuffer>;
}

export interface HazeSample {
  /** Linear-space haze colour, the same space scene fog's colour lives in. */
  r: number;
  g: number;
  b: number;
  strength: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** sRGB transfer, the same curve THREE.Color.setHex applies. */
function srgbToLinear(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
  return c < 0.0031308 ? c * 12.92 : 1.055 * c ** 0.41666 - 0.055;
}

/** The field's world rect: the zone bounding box plus the far mesh apron. */
export function hazeFieldLayout(): HazeFieldLayout {
  const originX = WORLD_MIN_X - HAZE_FIELD_MARGIN;
  const originZ = WORLD_MIN_Z - HAZE_FIELD_MARGIN;
  const cols = Math.ceil((WORLD_MAX_X + HAZE_FIELD_MARGIN - originX) / HAZE_FIELD_CELL);
  const rows = Math.ceil((WORLD_MAX_Z + HAZE_FIELD_MARGIN - originZ) / HAZE_FIELD_CELL);
  return {
    originX,
    originZ,
    cell: HAZE_FIELD_CELL,
    cols,
    rows,
    sizeX: cols * HAZE_FIELD_CELL,
    sizeZ: rows * HAZE_FIELD_CELL,
  };
}

/**
 * Haze strength for a biome, from its fog `far`. 1 at the murkiest end,
 * HAZE_STRENGTH_MIN at the clearest, linear between: the Wraithwood reads
 * heavier across a valley than the Evergarden does, which is the whole point
 * of showing a zone's atmosphere before you enter it.
 */
export function hazeStrengthForFogFar(fogFar: number): number {
  const density = clamp01(
    (HAZE_DENSITY_CLEAR_FAR - fogFar) / (HAZE_DENSITY_CLEAR_FAR - HAZE_DENSITY_THICK_FAR),
  );
  return HAZE_STRENGTH_MIN + (1 - HAZE_STRENGTH_MIN) * density;
}

/**
 * How much of the sampled haze a fragment takes, from its distance to the
 * camera. The Node twin of the GLSL in biome_haze_field.ts: both are
 * `max * strength * (1 - exp(-t^2))` over `t = (dist - onset) / ref`, so a
 * test can pin the curve the shader actually runs.
 */
export function aerialHazeAmount(distance: number, strength: number): number {
  const t = Math.max(0, distance - HAZE_AERIAL_ONSET) / HAZE_AERIAL_REF;
  return HAZE_AERIAL_MAX * strength * (1 - Math.exp(-t * t));
}

/**
 * Rasterize and blur the field. One `biomeAt` tap per texel (about 15k taps
 * for the shipped world; those taps are nearly the whole ~10 ms, the blur is
 * noise beside them), then a separable 1-2-1 blur in LINEAR colour so the
 * cross-fade at a border is the honest average of the two atmospheres rather
 * than a gamma-bent one.
 *
 * `presets` is injected rather than imported so the renderer's own fog table
 * stays the single source of truth; `biomeAt` is injected only so a test can
 * drive a synthetic world.
 */
export function buildBiomeHazeFieldData(
  presets: Readonly<Record<BiomeId, BiomeHazePreset>>,
  biomeAt: (x: number, z: number) => BiomeId = zoneBiomeAt,
): BiomeHazeFieldData {
  const layout = hazeFieldLayout();
  const { cols, rows, cell, originX, originZ } = layout;
  const n = cols * rows;
  // Four planes rather than an interleaved buffer: the blur below is a
  // straight strided pass per plane, and the whole field is 60 KB either way.
  let src = new Float32Array(n * 4);
  let dst = new Float32Array(n * 4);

  // Per-biome linear colour + strength, resolved once: the raster loop is
  // thousands of taps and must not redo the transfer curve for each.
  const resolved = new Map<BiomeId, [number, number, number, number]>();
  const resolve = (biome: BiomeId): [number, number, number, number] => {
    let entry = resolved.get(biome);
    if (!entry) {
      const preset = presets[biome];
      const hex = preset?.color ?? 0xffffff;
      entry = [
        srgbToLinear(((hex >> 16) & 0xff) / 255),
        srgbToLinear(((hex >> 8) & 0xff) / 255),
        srgbToLinear((hex & 0xff) / 255),
        hazeStrengthForFogFar(preset?.far ?? HAZE_DENSITY_CLEAR_FAR),
      ];
      resolved.set(biome, entry);
    }
    return entry;
  };

  for (let r = 0; r < rows; r++) {
    const wz = originZ + (r + 0.5) * cell;
    for (let c = 0; c < cols; c++) {
      const wx = originX + (c + 0.5) * cell;
      const [lr, lg, lb, strength] = resolve(biomeAt(wx, wz));
      const i = (r * cols + c) * 4;
      src[i] = lr;
      src[i + 1] = lg;
      src[i + 2] = lb;
      src[i + 3] = strength;
    }
  }

  for (let pass = 0; pass < HAZE_BLUR_PASSES; pass++) {
    blurAxis(src, dst, cols, rows, 4, true);
    blurAxis(dst, src, cols, rows, 4, false);
  }

  const rgba = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    rgba[o] = Math.round(clamp01(linearToSrgb(src[o])) * 255);
    rgba[o + 1] = Math.round(clamp01(linearToSrgb(src[o + 1])) * 255);
    rgba[o + 2] = Math.round(clamp01(linearToSrgb(src[o + 2])) * 255);
    rgba[o + 3] = Math.round(clamp01(src[o + 3]) * 255);
  }
  // Both scratch planes are dropped here; only the byte field escapes.
  src = dst = new Float32Array(0);
  return { layout, rgba };
}

/** One separable 1-2-1 pass, clamping at the field edge. */
function blurAxis(
  src: Float32Array,
  dst: Float32Array,
  cols: number,
  rows: number,
  stride: number,
  horizontal: boolean,
): void {
  const outer = horizontal ? rows : cols;
  const inner = horizontal ? cols : rows;
  const step = horizontal ? stride : cols * stride;
  const jump = horizontal ? cols * stride : stride;
  for (let o = 0; o < outer; o++) {
    const base = o * jump;
    for (let i = 0; i < inner; i++) {
      const here = base + i * step;
      const prev = base + (i > 0 ? i - 1 : 0) * step;
      const next = base + (i + 1 < inner ? i + 1 : inner - 1) * step;
      for (let ch = 0; ch < stride; ch++) {
        dst[here + ch] = (src[prev + ch] + 2 * src[here + ch] + src[next + ch]) * 0.25;
      }
    }
  }
}

/**
 * Bilinear read of the field in world space, clamping at the rect edge: the
 * Node twin of the GPU's sampler (which decodes sRGB per texel and then
 * filters, exactly as this does), so a test can assert what a fragment sees.
 */
export function sampleBiomeHazeField(field: BiomeHazeFieldData, x: number, z: number): HazeSample {
  const { cols, rows, cell, originX, originZ } = field.layout;
  const fx = Math.min(Math.max((x - originX) / cell - 0.5, 0), cols - 1);
  const fz = Math.min(Math.max((z - originZ) / cell - 0.5, 0), rows - 1);
  const c0 = Math.floor(fx);
  const r0 = Math.floor(fz);
  const c1 = Math.min(c0 + 1, cols - 1);
  const r1 = Math.min(r0 + 1, rows - 1);
  const tx = fx - c0;
  const tz = fz - r0;
  const out: HazeSample = { r: 0, g: 0, b: 0, strength: 0 };
  const corners: [number, number][] = [
    [c0, r0],
    [c1, r0],
    [c0, r1],
    [c1, r1],
  ];
  const weights = [(1 - tx) * (1 - tz), tx * (1 - tz), (1 - tx) * tz, tx * tz];
  for (let k = 0; k < 4; k++) {
    const w = weights[k];
    if (w === 0) continue;
    const o = (corners[k][1] * cols + corners[k][0]) * 4;
    out.r += srgbToLinear(field.rgba[o] / 255) * w;
    out.g += srgbToLinear(field.rgba[o + 1] / 255) * w;
    out.b += srgbToLinear(field.rgba[o + 2] / 255) * w;
    out.strength += (field.rgba[o + 3] / 255) * w;
  }
  return out;
}
