// The painted ground's macro noise texture as the CPU sees it: the very texels
// the terrain's splat material binds as uMacro, recorded at the one place the
// terrain reads them back (terrain_painted_ground_core.ts macroStatsOf, which
// terrain.ts calls at material build), together with the stats it measured. A
// CPU consumer that must agree with the painted ground (the meadow patch keeping
// blades off the cobbles and thinning them on leaf litter and bare earth,
// meadow_patch_core.ts) samples HERE instead of guessing: the texture is drawn
// off textures.ts's shared LCG, so it cannot be regenerated independently.
//
// Absent (null) where no splat material was built (Low, the iOS memory
// profile) or the painted ground is off (an authored map): those grounds draw no
// litter, earth or cobbles, so nothing should thin the grass there either.
//
// Pure: plain arrays, no Three, no DOM.

export interface PaintedGroundMacro {
  /** Texels per side: the texture is square and wraps (RepeatWrapping). */
  readonly size: number;
  /** Red channel in 0..1, image rows top to bottom (the canvas readback order). */
  readonly red: Float32Array;
  /** The stats the terrain measured (its masks work in z-scores of them). */
  readonly mean: number;
  readonly sd: number;
  /** Bumped on every record, so a consumer's cache knows the ground changed. */
  readonly version: number;
}

let current: PaintedGroundMacro | null = null;
let version = 0;

/**
 * Record the macro texture the terrain just measured: `rgba` is its readback
 * (one value per channel, `stride` values per texel, red first), `scale` maps a
 * value to 0..1, `mean` and `sd` the stats the terrain will bind. Only a square
 * readback is the macro texture; anything else is ignored.
 */
export function recordPaintedGroundMacro(
  rgba: ArrayLike<number>,
  stride: number,
  scale: number,
  mean: number,
  sd: number,
): void {
  const n = Math.floor(rgba.length / Math.max(1, stride));
  const size = Math.round(Math.sqrt(n));
  if (size < 2 || size * size !== n) return;
  const red = new Float32Array(n);
  for (let i = 0; i < n; i++) red[i] = rgba[i * stride] * scale;
  version++;
  current = { size, red, mean, sd, version };
}

/** The macro texture the terrain last bound, or null when none was built. */
export function paintedGroundMacro(): PaintedGroundMacro | null {
  return current;
}

/** Forget the recorded texture (a test, or a teardown that drops the ground). */
export function clearPaintedGroundMacro(): void {
  if (!current) return;
  current = null;
  version++;
}

/** Bumped on every record and clear. */
export function paintedGroundMacroVersion(): number {
  return version;
}

function wrapIndex(i: number, size: number): number {
  const m = i % size;
  return m < 0 ? m + size : m;
}

/**
 * The shader's `texture2D(uMacro, vec2(u, v)).r` at full resolution: bilinear
 * between texel centres, wrapped, with three's flipY upload (image row 0 is the
 * top of the texture, v near 1). The shader reads mipmaps with distance; blades
 * only stand near the camera, where the full-resolution level is the one read.
 */
export function samplePaintedGroundMacro(macro: PaintedGroundMacro, u: number, v: number): number {
  const s = macro.size;
  const gx = u * s - 0.5;
  const gy = v * s - 0.5;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const c0 = wrapIndex(x0, s);
  const c1 = wrapIndex(x0 + 1, s);
  // texture row j holds image row s - 1 - j
  const r0 = (s - 1 - wrapIndex(y0, s)) * s;
  const r1 = (s - 1 - wrapIndex(y0 + 1, s)) * s;
  const red = macro.red;
  const a = red[r0 + c0];
  const b = red[r0 + c1];
  const c = red[r1 + c0];
  const d = red[r1 + c1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
