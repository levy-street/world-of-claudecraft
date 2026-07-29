// Stubble, scruff, buzz and crew as a TEXTURE DECAL on the bare head.
//
// These four styles are not hair you can see the shape of, they are skin you
// can see through hair. Modelled as geometry (a shell) they read as a helmet;
// modelled as a flat-coloured translucent copy of the head's own faces (what
// shipped before this) they read as a smudge, because a constant alpha over a
// whole region has no grain and its outline lands wherever the head's own
// coarse triangles happen to fall. What they actually need is a MASK with an
// edge finer than the mesh and a stipple finer than that, which is a texture.
//
// So the decal is:
//   * the head's own surface, trimmed to the region a decal can reach,
//     subdivided for UV accuracy and lifted a fraction of a millimetre;
//   * unwrapped by an AZIMUTHAL EQUIDISTANT projection about the head's own
//     centre, a whole-head map with no seam and exactly one singular direction
//     (straight down, under the jaw), which the trim removes;
//   * painted with a generated RGBA texture whose alpha carries both the
//     footprint (analytic, evaluated per texel, so a hairline is crisp at a
//     resolution the mesh could never afford) and the stipple.
//
// Everything here is derived from the head geometry at runtime, no authoring
// pass, no new asset, and nothing in the GLB. The four layers the GLB still
// carries (`M_Fuzz_buzz`, `M_Stub_stubble`, …) are dead and no longer picked.
//
// Why a plain map and not a shader
// --------------------------------
// `tintedMaterial` REBUILDS every character material as Lambert on the low
// graphics tier, so an injected shader (the `addRimGlow` hook) silently
// vanishes there. A `map` survives that path, and three multiplies its ALPHA
// into the fragment, so one RGBA texture carries the whole effect on both
// tiers. The colour comes from the material tint (the hair colour) exactly as
// it did before.
//
// Why the mask is analytic rather than baked off the old meshes
// -------------------------------------------------------------
// The footprints below were MEASURED off the layers that shipped before
// (tmp/_head_profile.mjs), and the facial landmarks they have to respect were
// measured off the head's own morph targets, `mouth_*` moves exactly the lip
// ring, `nose_up` exactly the nose, so "leave the lips bare" and "stop under
// the nose" are numbers, not guesses. Evaluating that per texel is what makes
// the line clean: the old clip ran per FACE on a mesh whose lower half is a
// handful of big triangles, and no amount of subdivision fixed the sawtooth.
import * as THREE from 'three';
import {
  type BeardDecal,
  type Gender,
  MAT_STUBBLE,
  type StubbleSelection,
  type UnderhairStyle,
} from './modular';

// ---------------------------------------------------------------------------
// The head frame
// ---------------------------------------------------------------------------
//
// Every primitive in the modular GLB is meshopt-quantized into its OWN integer
// range (see rig_merge.ts), so "head local space" is a different space for the
// male and the female head, and neither is Blender's. Deriving the frame from
// the head's own bounding box sidesteps all of it: the box maps to the unit
// sphere, so one set of angles describes both heads (their proportions differ
// by ~3%) whatever units the asset is in.

export interface HeadFrame {
  /** bbox centre */
  cx: number;
  cy: number;
  cz: number;
  /** bbox half-extents; also the per-axis normalization */
  hx: number;
  hy: number;
  hz: number;
}

export function headFrame(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): HeadFrame {
  let lox = Infinity;
  let loy = Infinity;
  let loz = Infinity;
  let hix = -Infinity;
  let hiy = -Infinity;
  let hiz = -Infinity;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    if (x < lox) lox = x;
    if (y < loy) loy = y;
    if (z < loz) loz = z;
    if (x > hix) hix = x;
    if (y > hiy) hiy = y;
    if (z > hiz) hiz = z;
  }
  return {
    cx: (lox + hix) / 2,
    cy: (loy + hiy) / 2,
    cz: (loz + hiz) / 2,
    hx: Math.max(1e-6, (hix - lox) / 2),
    hy: Math.max(1e-6, (hiy - loy) / 2),
    hz: Math.max(1e-6, (hiz - loz) / 2),
  };
}

/** Head height in the geometry's own units, the scale every offset here is
 *  expressed as a fraction of, so the lift is the same real distance on both
 *  heads however each was quantized. */
export function headHeight(f: HeadFrame): number {
  return f.hy * 2;
}

const DEG = 180 / Math.PI;

/**
 * Direction of a head-local point in the normalized frame, as
 * `[theta, azimuth]` in DEGREES: theta 0 at the crown and 180 straight down,
 * azimuth 0 dead ahead (the face) and ±180 at the nape.
 */
export function headAngles(f: HeadFrame, x: number, y: number, z: number): [number, number] {
  const nx = (x - f.cx) / f.hx;
  const ny = (y - f.cy) / f.hy;
  const nz = (z - f.cz) / f.hz;
  const len = Math.hypot(nx, ny, nz) || 1;
  const theta = Math.acos(Math.max(-1, Math.min(1, ny / len))) * DEG;
  const az = Math.atan2(nx / len, nz / len) * DEG;
  return [theta, az];
}

// ---------------------------------------------------------------------------
// The unwrap: azimuthal equidistant about the crown
// ---------------------------------------------------------------------------
//
// r = theta / 360 (so the whole sphere lands in the disc inscribed in the UV
// square), u = 0.5 + r*cos(az), v = 0.5 + r*sin(az).
//
// The point of this projection over the obvious lat-long one is that it is
// CONTINUOUS and injective everywhere except the single antipodal direction.
// Lat-long has a seam down the back of the head and a degenerate pole at the
// crown, and both fall inside a buzz cut's footprint: a triangle straddling the
// seam interpolates its UV across the whole texture and paints the wrong thing.
// Here the only bad direction is straight down under the jaw, and `TRIM_THETA`
// removes the faces around it before they can be drawn.
//
// It is not area-preserving, the tangential stretch is theta/sin(theta), so
// the underside of the jaw spends far more texels than its area deserves. That
// costs nothing but texture space, because the stipple is evaluated from the
// DIRECTION rather than in texel space, so its dots stay round wherever they
// land, and the mask is analytic and so is crisp at any magnification.

export function decalUv(theta: number, az: number): [number, number] {
  const r = theta / 360;
  const a = az / DEG;
  return [0.5 + r * Math.sin(a), 0.5 + r * Math.cos(a)];
}

/** Polar angle the decal geometry is cut at. Past this is the underside of the
 *  neck (which no style reaches) and, at 180, the projection's singular point. */
const TRIM_THETA = 168;

// ---------------------------------------------------------------------------
// Footprints
// ---------------------------------------------------------------------------

/** Hermite-ish smoothstep, clamped, and happy with a > b (a falling ramp). */
function smoothstep(a: number, b: number, x: number): number {
  if (a === b) return x < a ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Cosine-interpolated lookup over a flat `[x0, y0, x1, y1, ...]` table, C1 at
 *  the samples, so a boundary traced from one has no kinks where the table
 *  changes slope. Flat because this runs per texel over a megapixel. */
function curve(table: Float64Array, x: number): number {
  const k = x < 0 ? -x : x;
  if (k <= table[0]) return table[1];
  for (let i = 2; i < table.length; i += 2) {
    const x1 = table[i];
    if (k <= x1) {
      const x0 = table[i - 2];
      const y0 = table[i - 1];
      const t = (k - x0) / (x1 - x0);
      return y0 + (table[i + 1] - y0) * (0.5 - 0.5 * Math.cos(Math.PI * t));
    }
  }
  return table[table.length - 1];
}

/**
 * The scalp cuts, as the polar angle the hairline sits at.
 *
 * A buzz and a crew cut are not one shape at two lengths: the buzz is
 * clipper-uniform with a LOW hairline that follows the real one down past the
 * temples, and the crew has a hairline lifted well clear of the brow with the
 * length falling away to nothing at the rim. As a decal the length is density,
 * so `rim` is how much of the crown's density survives at the cut line.
 *
 * `front` and `side` are measured off the layers that shipped before this (see
 * the header): the front of the cut is a good 20 degrees higher than the sides,
 * and the blend between them tracks how much of the direction faces forward.
 */
/** The full under-hair pattern library (UNDERHAIR_STYLES in modular.ts, the
 *  compiler holds these Records complete). Beyond the base line:
 *  `peak` extends the hairline DOWN at the centre (a widow's peak, degrees),
 *  `temple` moves it at ±35° of azimuth (negative = receded temples, the
 *  M-shaped line), `band` bares the crown, growth only past that polar angle
 *  (the horseshoe), `taper` widens the fade band above the line (fades). */
const SCALP_CUTS: Record<
  UnderhairStyle,
  {
    front: number;
    side: number;
    rim: number;
    peak?: number;
    temple?: number;
    band?: number;
    taper?: number;
  }
> = {
  buzz: { front: 65.5, side: 85, rim: 0.88 },
  crew: { front: 51, side: 74, rim: 0.42 },
  solid: { front: 63, side: 84, rim: 0.96 },
  solid_high: { front: 49, side: 72, rim: 0.95 },
  widow: { front: 55, side: 80, rim: 0.94, peak: 11 },
  receded: { front: 60, side: 82, rim: 0.92, temple: -16 },
  low_fade: { front: 68, side: 88, rim: 0, taper: 42 },
  high_fade: { front: 52, side: 74, rim: 0, taper: 34 },
  sparse: { front: 66, side: 86, rim: 0.9 },
  horseshoe: { front: 88, side: 96, rim: 0.95, band: 62 },
};

/** How each scalp style is PAINTED, once its footprint has said where: `alpha`
 *  is the growth at its densest, `floor` how much survives between the
 *  stipple's dots. Buzz runs dense (Troy, 2026-08-05: the under-hair growth
 *  read too sparse at the hairline): the floor is what carries density at a
 *  distance, the dots ride on top of it. floor 1 = a SOLID wash (no stipple
 *  modulation, the per-dot colour noise still keeps it organic). */
const SCALP_SPECS: Record<UnderhairStyle, { alpha: number; floor: number }> = {
  buzz: { alpha: 0.84, floor: 0.44 },
  crew: { alpha: 0.8, floor: 0.3 },
  solid: { alpha: 0.97, floor: 1 },
  solid_high: { alpha: 0.97, floor: 1 },
  widow: { alpha: 0.95, floor: 1 },
  receded: { alpha: 0.92, floor: 0.8 },
  low_fade: { alpha: 0.86, floor: 0.5 },
  high_fade: { alpha: 0.86, floor: 0.5 },
  sparse: { alpha: 0.55, floor: 0.08 },
  horseshoe: { alpha: 0.92, floor: 0.85 },
};

/** A soft bump of azimuth, for hairline features pinned to a direction. */
function azBump(az: number, at: number, width: number): number {
  const d = az - at;
  return Math.exp(-(d * d) / (2 * width * width));
}

export function scalpLimit(style: UnderhairStyle, az: number): number {
  const s = SCALP_CUTS[style];
  const facing = Math.cos(az / DEG);
  let limit = s.front + (s.side - s.front) * smoothstep(0.64, 0.02, facing);
  if (s.peak) limit += s.peak * azBump(az, 0, 13);
  if (s.temple) limit += s.temple * (azBump(az, 35, 12) + azBump(az, -35, 12));
  return limit;
}

/** Coverage of the scalp decal at a direction, 0..1. */
export function scalpCoverage(style: UnderhairStyle, theta: number, az: number): number {
  const s = SCALP_CUTS[style];
  const limit = scalpLimit(style, az);
  // A crisp line, anti-aliased over ~1.5 degrees...
  const edge = smoothstep(limit + 0.7, limit - 0.8, theta);
  if (edge <= 0) return 0;
  // ...with the last few degrees before it thinner than the crown, which is
  // what stops a clipper line reading as a decal's cut edge.
  const taper = s.rim + (1 - s.rim) * smoothstep(limit, limit - (s.taper ?? 22), theta);
  let cover = edge * taper;
  // The horseshoe bares the crown: growth only past the band angle.
  if (s.band) cover *= smoothstep(s.band - 1.5, s.band + 2.5, theta);
  return cover;
}

/**
 * The beard line: the polar angle the growth starts at, by azimuth. Flat pairs,
 * `[az, theta, az, theta, ...]`.
 *
 * Measured off the layer that shipped before this (which was itself clipped to
 * the full beard's silhouette): a shallow dip under the cheek climbing into the
 * sideburn, then falling away behind the ear. It is the measurement unchanged,
 * the nose it appears to run into is dealt with by removing the overhang from
 * the decal surface (`isNoseUnderside`) rather than by moving the line, because
 * moving the line far enough to clear the nose costs the whole moustache.
 */
const BEARD_TOP = new Float64Array([
  0, 112, 10, 112, 20, 111, 30, 110, 40, 107, 50, 105.5, 60, 102, 70, 99, 80, 96.5, 90, 96, 100,
  101, 110, 118,
]);
/** Azimuth the sideburn stops at (behind it is the ear, and then the nape). */
const BEARD_BACK = 104;
/** Under the jaw the growth thins out rather than ending on a line. */
const BEARD_BOTTOM = 156;
const BEARD_BOTTOM_END = TRIM_THETA;
/**
 * The lips, as a region in (theta, azimuth). Hair does not grow on the
 * vermilion, and covering it is what buries the mouth line under the wash.
 *
 * Straight off the head's own mouth morphs, which move exactly the lip ring:
 * theta 119..126 at the midline, narrowing to a single vertex at 120 out at 30
 * degrees of azimuth. That is a lens with a RISE, a mouth line turning up at
 * the corners, and a plain ellipse cannot hold it: sized to reach the corners
 * it swallows the chin, and sized to the midline it leaves the corners of the
 * mouth painted. So the centre line rises with azimuth and the falloff is a
 * superellipse, which is flat-topped enough to follow the ring without spilling
 * onto the skin around it.
 */
const LIP = { theta: 122.6, rise: 2.2, halfTheta: 4.6, halfAz: 35.5, power: 3 };

const BEARD_SPECS: Record<BeardDecal, { grow: number; floor: number; alpha: number }> = {
  // one day: a shadow, mostly stipple
  stubble: { grow: 0, floor: 0.1, alpha: 0.52 },
  // several: higher up the cheek, and filled in enough to read as growth
  scruff: { grow: 4.5, floor: 0.34, alpha: 0.74 },
};

export function beardLimit(style: BeardDecal, az: number): number {
  // The longer growth eases off toward the midline: there is a nose there, its
  // tip reaches to 107 degrees, and a flat four degrees of extra growth at the
  // centre puts stubble on the end of it.
  const room = 0.15 + 0.85 * smoothstep(6, 26, Math.abs(az));
  return curve(BEARD_TOP, az) - BEARD_SPECS[style].grow * room;
}

/** Coverage of the beard decal at a direction, 0..1. */
export function beardCoverage(style: BeardDecal, theta: number, az: number): number {
  const limit = beardLimit(style, az);
  let c = smoothstep(limit - 0.7, limit + 0.8, theta);
  if (c <= 0) return 0;
  c *= smoothstep(BEARD_BACK + 3, BEARD_BACK - 3, Math.abs(az));
  if (c <= 0) return 0;
  c *= smoothstep(BEARD_BOTTOM_END, BEARD_BOTTOM, theta);
  if (c <= 0) return 0;
  // thinner right at the jaw line, same reason as the scalp's taper
  c *= 0.62 + 0.38 * smoothstep(limit, limit + 9, theta);
  // ...and the lips stay bare
  const da = az / LIP.halfAz;
  const dt = (theta - (LIP.theta - LIP.rise * da * da)) / LIP.halfTheta;
  const p = LIP.power;
  const lip = (Math.abs(dt) ** p + Math.abs(da) ** p) ** (1 / p);
  return c * smoothstep(0.9, 1.1, lip);
}

// ---------------------------------------------------------------------------
// The stipple
// ---------------------------------------------------------------------------
//
// Stubble is thousands of points, not a wash, and the points have to be round
// and evenly spaced ON THE HEAD, which rules out a dot field laid out in UV
// space, because the projection stretches the jaw by three to four times and
// every dot down there would come out as a streak.
//
// So the field is a jittered lattice of cells over the SPHERE OF DIRECTIONS:
// rings in theta, and within each ring a WHOLE NUMBER of columns, so the
// lattice closes on itself and there is no seam down the back of the head. Each
// cell holds one dot, offset within it and sized at random.
//
// Two things the first version got wrong, both visible only at close range and
// both obvious once seen:
//   * dots must be at least a texel or two across. 1024 texels over 360 degrees
//     is 2.84 per degree, so a "realistic" 0.2-degree dot is sub-texel and the
//     stipple degenerates into noise. Cells are 2-3 degrees for that reason;
//     finer wants a bigger map, not a smaller dot.
//   * with the offset budgeted to keep a dot inside its own cell (which is what
//     makes a single cell lookup sufficient), the dots sit near their ring
//     centres and the field reads as horizontal ROWS. Testing the ring above
//     and below as well buys a full cell of jitter in theta, which is what
//     scatters them.
// Flat, not an array of objects: this is the hot loop of a texture that is
// built on demand while the player flips through styles, and reading the
// parameters out of a Float64Array instead of three shaped objects is most of
// the difference between a hitch and no hitch.
// [cell, phase, radiusMin, radiusSpan, salt] x 3
const LATTICES = new Float64Array([
  2.4, 0.0, 0.5, 0.22, 0x9e3779b1, 1.85, 0.37, 0.38, 0.17, 0x85ebca6b, 3.15, 0.71, 0.62, 0.33,
  0xc2b2ae35,
]);
const LATTICE_STRIDE = 5;
/** Offset within the cell, as a fraction of it: free in theta (the neighbouring
 *  rings are tested), but bounded in azimuth so a dot cannot reach the next
 *  column along. */
const JITTER_THETA = 0.5;
const JITTER_AZ = 0.13;

/** One 32-bit hash per cell, read as THREE 10-bit fields (offset, offset,
 *  radius). Three separate hashes is the obvious way to write it and is three
 *  times the cost of the only thing this loop spends its time on. */
function hash(a: number, b: number, salt: number): number {
  let h = (Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}
const FIELD = 1 / 1023;

/**
 * Stipple at a direction, 0..1 to 1 at the core of a dot, 0 between them.
 *
 * `theta`/`az` in degrees, and distances are measured as ARC (the azimuth
 * shrinks by sin(theta)), or the dots stretch into arcs toward the crown.
 */
export function stipple(theta: number, az: number): number {
  let best = 0;
  const turn = az + 180;
  for (let l = 0; l < LATTICES.length; l += LATTICE_STRIDE) {
    const cell = LATTICES[l];
    const phase = LATTICES[l + 1];
    const rMin = LATTICES[l + 2];
    const rSpan = LATTICES[l + 3];
    const salt = LATTICES[l + 4];
    const home = Math.floor(theta / cell + phase);
    for (let ring = home - 1; ring <= home + 1; ring++) {
      const thetaMid = (ring - phase + 0.5) * cell;
      const sin = Math.max(0.02, Math.sin(thetaMid / DEG));
      // whole number of columns, so column 0 and column n-1 are neighbours
      const cols = Math.max(1, Math.round((360 * sin) / cell));
      const colWidth = 360 / cols;
      const col = Math.floor(turn / colWidth);
      const h = hash(ring, col, salt);
      const jt = ((h & 1023) * FIELD - 0.5) * 2 * JITTER_THETA * cell;
      const radius = rMin + rSpan * (((h >>> 20) & 1023) * FIELD);
      const dTheta = theta - thetaMid - jt;
      if (dTheta > radius || dTheta < -radius) continue;
      const ja = (((h >>> 10) & 1023) * FIELD - 0.5) * 2 * JITTER_AZ * cell;
      let dCol = turn / colWidth - (col + 0.5);
      // wrap: the ring is a circle, so the far side of the seam is one cell away
      if (dCol > cols / 2) dCol -= cols;
      else if (dCol < -cols / 2) dCol += cols;
      const dAz = dCol * colWidth * sin - ja;
      const d = Math.sqrt(dTheta * dTheta + dAz * dAz);
      const v = smoothstep(radius, radius * 0.3, d);
      if (v > best) best = v;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Texture
// ---------------------------------------------------------------------------

/** Side of the generated decal map. The whole head lands in the inscribed disc,
 *  so a degree of arc is `SIZE/360` texels across the face, fine enough for a
 *  hairline to be a line rather than a staircase. */
export const DECAL_TEX_SIZE = 1024;

export function decalKey(sel: StubbleSelection): string {
  return `${sel.scalp ?? '-'}|${sel.beard ?? '-'}`;
}

/**
 * The RGBA bytes of a decal map.
 *
 * Alpha is footprint x stipple; RGB is a near-white with a little per-dot
 * variation, so the material's own colour (the hair colour) decides the hue and
 * a single generated map serves every character.
 *
 * Pure and synchronous, a test can assert the mask lands where the face is
 * without a GL context.
 */
export function decalTextureData(
  sel: StubbleSelection,
  size = DECAL_TEX_SIZE,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(size * size * 4));
  // RGB is filled EVERYWHERE, alpha only where there is growth. three multiplies
  // the whole texel into the fragment, so a transparent texel left at black
  // bleeds through bilinear filtering and rings every dot with a dark halo, the
  // colour channel of an alpha map has to stay valid outside the shape.
  const BASE = 232;
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = BASE;
    out[i * 4 + 1] = BASE;
    out[i * 4 + 2] = BASE;
  }
  const scalp = sel.scalp;
  const beard = sel.beard;
  if (!scalp && !beard) return out;
  const beardAlpha = beard ? BEARD_SPECS[beard].alpha : 0;
  const beardFloor = beard ? BEARD_SPECS[beard].floor : 0;
  // The scalp reads a touch heavier than a jaw shadow at the same density.
  const scalpAlpha = scalp ? SCALP_SPECS[scalp].alpha : 0;
  const scalpFloor = scalp ? SCALP_SPECS[scalp].floor : 0;
  for (let row = 0; row < size; row++) {
    const v = (row + 0.5) / size - 0.5;
    for (let colIdx = 0; colIdx < size; colIdx++) {
      const u = (colIdx + 0.5) / size - 0.5;
      const r = Math.sqrt(u * u + v * v);
      if (r > 0.5) continue; // outside the disc: no direction maps here
      const theta = r * 360;
      if (theta > TRIM_THETA) continue;
      const az = Math.atan2(u, v) * DEG;
      let cover = 0;
      let floor = 0;
      let alpha = 0;
      if (scalp) {
        const c = scalpCoverage(scalp, theta, az);
        if (c > cover) {
          cover = c;
          floor = scalpFloor;
          alpha = scalpAlpha;
        }
      }
      if (beard) {
        const c = beardCoverage(beard, theta, az);
        if (c > cover) {
          cover = c;
          floor = beardFloor;
          alpha = beardAlpha;
        }
      }
      if (cover <= 0.002) continue;
      const dot = stipple(theta, az);
      const a = cover * alpha * (floor + (1 - floor) * dot);
      if (a <= 0.002) continue;
      const i = (row * size + colIdx) * 4;
      // a little value noise on the colour so a dense patch is not one flat tone
      const shade = 208 + Math.round(47 * dot);
      out[i] = shade;
      out[i + 1] = shade;
      out[i + 2] = shade;
      out[i + 3] = Math.min(255, Math.round(a * 255));
    }
  }
  return out;
}

const textureCache = new Map<string, THREE.DataTexture>();

export function decalTexture(sel: StubbleSelection): THREE.DataTexture {
  const key = decalKey(sel);
  const hit = textureCache.get(key);
  if (hit) return hit;
  const tex = new THREE.DataTexture(
    decalTextureData(sel),
    DECAL_TEX_SIZE,
    DECAL_TEX_SIZE,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  tex.name = `stubble_${key}`;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  // The projection oversamples the jaw badly (see the unwrap note), so one
  // screen pixel can span many texels one way and few the other. Without
  // anisotropy that reads as a blurred chin.
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  textureCache.set(key, tex);
  return tex;
}

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

/** The shared (untinted) decal material for a selection. `recolored()` clones
 *  it per hair colour, exactly as it does for the skin and hair materials. */
export function decalMaterial(sel: StubbleSelection): THREE.MeshStandardMaterial {
  const key = decalKey(sel);
  const hit = materialCache.get(key);
  if (hit) return hit;
  const mat = new THREE.MeshStandardMaterial({
    name: MAT_STUBBLE,
    map: decalTexture(sel),
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  // It sits a fraction of a millimetre off the face so that it can never fold
  // through itself in a crease; that close it would z-fight without a bias.
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -1;
  mat.polygonOffsetUnits = -1;
  materialCache.set(key, mat);
  return mat;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** How far off the skin the decal floats, as a fraction of head height. Enough
 *  that a smooth-shaded dome's wandering normals cannot poke through it, small
 *  enough that it cannot self-intersect in the mouth crease. (The old layer sat
 *  at nearly twice this and folded through itself wherever the face is concave
 *  tighter than the offset, an alpha layer crossed twice is visibly darker,
 *  which is most of what "it's kinda not uniform" was.) */
export const DECAL_LIFT = 0.004;
/** Subdivision levels. The UV is exact at the vertices and interpolated across
 *  the face, and the head's lower half is a handful of big triangles: at the
 *  shipped density a beard line wanders by a couple of millimetres inside one.
 *  Each level quarters that. */
const SUBDIVISIONS = 2;

/** The patch of head a decal is cut from, as an angular window. Exported so
 *  another decal (makeup.ts) can reuse the cutter without inventing a second
 *  copy of the subdivide/lift/morph-inherit pass, which is the part that is
 *  subtle rather than the part that is specific to stubble. */
export interface DecalRegion {
  minTheta: number;
  maxTheta: number;
  maxAz: number;
}
type Region = DecalRegion;

function decalRegion(sel: StubbleSelection): Region {
  let minTheta = 999;
  let maxTheta = -999;
  let maxAz = 0;
  if (sel.scalp) {
    minTheta = 0;
    maxTheta = Math.max(maxTheta, SCALP_CUTS[sel.scalp].side + 6);
    maxAz = 180;
  }
  if (sel.beard) {
    let top = 999;
    for (let i = 1; i < BEARD_TOP.length; i += 2) top = Math.min(top, BEARD_TOP[i]);
    minTheta = Math.min(minTheta, top - BEARD_SPECS[sel.beard].grow - 6);
    maxTheta = TRIM_THETA;
    maxAz = Math.max(maxAz, BEARD_BACK + 10);
  }
  return { minTheta, maxTheta: Math.min(maxTheta, TRIM_THETA), maxAz };
}

function inRegion(r: Region, theta: number, az: number): boolean {
  return theta >= r.minTheta && theta <= r.maxTheta && Math.abs(az) <= r.maxAz;
}

/**
 * The underside of the nose, which no decal may touch.
 *
 * The head is not star-shaped and the nose is where that bites: it OVERHANGS
 * the philtrum, so the nostril underside and the skin below it point in the
 * same direction to within a degree or two. A directional unwrap sends both to
 * the same texel and no mask can separate them, which is the whole reason the
 * layer that shipped before this had to choose between painting the underside
 * of the nose and having no moustache at all.
 *
 * Removing the overhang from the decal SURFACE settles it: the beard line can
 * then be the one that was measured off the old footprint, the philtrum gets
 * its growth, and the nose stays clean because there is nothing there to draw.
 *
 * The test is deliberately narrow, a window around the nose, and a face
 * pointing steeply down inside it. The general form ("is another surface closer
 * to the head centre along this ray") sounds better and is wrong: the mouth is
 * modelled as a deep crease, so its inner wall sits at 0.58 of the radius of
 * the chin in front of it and the general test carves a rectangle out of the
 * skin under the lower lip.
 */
const NOSE_WINDOW = { minTheta: 96, maxTheta: 121, maxAz: 27, down: -0.32 };

export function isNoseUnderside(theta: number, az: number, ny: number): boolean {
  return (
    theta >= NOSE_WINDOW.minTheta &&
    theta <= NOSE_WINDOW.maxTheta &&
    Math.abs(az) <= NOSE_WINDOW.maxAz &&
    ny < NOSE_WINDOW.down
  );
}

/** Attributes a decal copy carries over from the head. `uv` is generated. */
const CARRIED = ['position', 'normal', 'skinIndex', 'skinWeight'] as const;

/**
 * Cut a decal surface out of the head's own geometry.
 *
 * Cut, not projected: every decal vertex is a barycentric combination of head
 * vertices, so applying that same combination to the head's morph deltas keeps
 * the offset from the DEFORMED head exactly what it was in the rest pose, and
 * a midpoint of a triangle edge is still on that triangle, which is why
 * subdividing first costs nothing in fidelity. Re-deriving the deltas by
 * evaluating a deformation at the decal's own position (the obvious thing) does
 * NOT track what is on screen: the renderer draws the piecewise-linear
 * interpolation of the head's sparse samples, and a finer layer reproducing the
 * true field separates from it by more than the lift.
 *
 * Here the combination is a plain edge midpoint, so "apply it to the deltas" is
 * just averaging them, exact, and it falls out of the subdivision for free.
 */
export function buildDecalGeometry(
  head: THREE.BufferGeometry,
  frame: HeadFrame,
  sel: StubbleSelection,
): THREE.BufferGeometry | null {
  return buildRegionDecalGeometry(head, frame, decalRegion(sel));
}

/** As {@link buildDecalGeometry}, but for an explicit angular window rather
 *  than a stubble selection. */
export function buildRegionDecalGeometry(
  head: THREE.BufferGeometry,
  frame: HeadFrame,
  region: DecalRegion,
): THREE.BufferGeometry | null {
  const src = head.getAttribute('position');
  if (!src) return null;
  const index = head.getIndex();
  const triCount = index ? index.count / 3 : src.count / 3;

  // 1. which head vertices are in the region at all
  const theta = new Float32Array(src.count);
  const azim = new Float32Array(src.count);
  const inside = new Uint8Array(src.count);
  for (let i = 0; i < src.count; i++) {
    const [t, a] = headAngles(frame, src.getX(i), src.getY(i), src.getZ(i));
    theta[i] = t;
    azim[i] = a;
    inside[i] = inRegion(region, t, a) ? 1 : 0;
  }

  // 2. keep a face when ANY corner is in the region, but never one that reaches
  //    past the trim, a face spanning the antipode has no sane UV.
  const faces: number[][] = [];
  for (let f = 0; f < triCount; f++) {
    const a = index ? index.getX(f * 3) : f * 3;
    const b = index ? index.getX(f * 3 + 1) : f * 3 + 1;
    const c = index ? index.getX(f * 3 + 2) : f * 3 + 2;
    if (theta[a] > TRIM_THETA || theta[b] > TRIM_THETA || theta[c] > TRIM_THETA) continue;
    if (!inside[a] && !inside[b] && !inside[c]) continue;
    faces.push([a, b, c]);
  }
  if (!faces.length) return null;

  // 3. compact the used vertices, carrying every attribute and every morph
  const remap = new Map<number, number>();
  const order: number[] = [];
  for (const f of faces) {
    for (let k = 0; k < 3; k++) {
      if (!remap.has(f[k])) {
        remap.set(f[k], order.length);
        order.push(f[k]);
      }
      f[k] = remap.get(f[k]) as number;
    }
  }

  const attrs = new Map<string, { data: number[]; size: number }>();
  for (const name of CARRIED) {
    const a = head.getAttribute(name);
    if (!a) continue;
    const size = a.itemSize;
    const data: number[] = [];
    for (const i of order) for (let c = 0; c < size; c++) data.push(a.getComponent(i, c));
    attrs.set(name, { data, size });
  }
  const morphSrc = head.morphAttributes.position ?? [];
  const morphs = morphSrc.map((m) => {
    const data: number[] = [];
    for (const i of order) {
      data.push(m.getX(i), m.getY(i), m.getZ(i));
    }
    return data;
  });

  // 4. subdivide, sharing an edge's midpoint between the two faces on it
  let tris = faces;
  for (let level = 0; level < SUBDIVISIONS; level++) {
    const mid = new Map<number, number>();
    const midpoint = (i: number, j: number): number => {
      const key = i < j ? i * 1e7 + j : j * 1e7 + i;
      const hit = mid.get(key);
      if (hit !== undefined) return hit;
      const n = attrs.get('position')?.data.length ?? 0;
      const at = n / 3;
      for (const [name, a] of attrs) {
        if (name === 'skinIndex' || name === 'skinWeight') continue;
        for (let c = 0; c < a.size; c++) {
          a.data.push((a.data[i * a.size + c] + a.data[j * a.size + c]) / 2);
        }
      }
      // The skinning is a (bone -> weight) MAP, not four numbers to average:
      // averaging the indices of bones 3 and 7 gives bone 5, which is a
      // different bone. Merge the two influence sets, keep the four heaviest,
      // renormalize. (On this head it changes nothing, the whole decal region
      // rides one bone, but a rig where it mattered would fail silently and
      // look like a skinning bug in the asset.)
      const si = attrs.get('skinIndex');
      const sw = attrs.get('skinWeight');
      if (si && sw) {
        const merged = new Map<number, number>();
        for (const v of [i, j]) {
          for (let c = 0; c < 4; c++) {
            const w = sw.data[v * 4 + c] / 2;
            if (w <= 0) continue;
            const bone = si.data[v * 4 + c];
            merged.set(bone, (merged.get(bone) ?? 0) + w);
          }
        }
        const top = [...merged.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4);
        const sum = top.reduce((acc, [, w]) => acc + w, 0) || 1;
        for (let c = 0; c < 4; c++) {
          si.data.push(top[c]?.[0] ?? 0);
          sw.data.push(top[c] ? top[c][1] / sum : 0);
        }
      }
      for (const m of morphs) {
        for (let c = 0; c < 3; c++) m.push((m[i * 3 + c] + m[j * 3 + c]) / 2);
      }
      mid.set(key, at);
      return at;
    };
    const next: number[][] = [];
    for (const [a, b, c] of tris) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    tris = next;
  }

  // 4b. drop the underside of the nose, AFTER subdividing so its edge is as
  //     fine as the rest of the decal. (Culling whole head faces here instead
  //     takes a bite out of the philtrum, which is the very thing the cull
  //     exists to keep.) The vertices it orphans cost a few hundred bytes and
  //     are never referenced.
  const nrmData = attrs.get('normal');
  const posData = attrs.get('position');
  if (nrmData && posData) {
    tris = tris.filter(([a, b, c]) => {
      let mt = 0;
      let ma = 0;
      let ny = 0;
      for (const v of [a, b, c]) {
        const [t, az] = headAngles(
          frame,
          posData.data[v * 3],
          posData.data[v * 3 + 1],
          posData.data[v * 3 + 2],
        );
        mt += t / 3;
        ma += az / 3;
        const nx = nrmData.data[v * 3];
        const nyv = nrmData.data[v * 3 + 1];
        const nz = nrmData.data[v * 3 + 2];
        ny += nyv / (Math.hypot(nx, nyv, nz) || 1) / 3;
      }
      return !isNoseUnderside(mt, ma, ny);
    });
    if (!tris.length) return null;
  }

  // 5. UV from the projection, then lift along the (renormalized) normal
  const pos = attrs.get('position');
  const nrm = attrs.get('normal');
  if (!pos) return null;
  const count = pos.data.length / 3;
  const uv = new Float32Array(count * 2);
  const lift = headHeight(frame) * DECAL_LIFT;
  for (let i = 0; i < count; i++) {
    const x = pos.data[i * 3];
    const y = pos.data[i * 3 + 1];
    const z = pos.data[i * 3 + 2];
    const [t, a] = headAngles(frame, x, y, z);
    const [u, v] = decalUv(t, a);
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
    if (nrm) {
      const nx = nrm.data[i * 3];
      const ny = nrm.data[i * 3 + 1];
      const nz = nrm.data[i * 3 + 2];
      const len = Math.hypot(nx, ny, nz) || 1;
      nrm.data[i * 3] = nx / len;
      nrm.data[i * 3 + 1] = ny / len;
      nrm.data[i * 3 + 2] = nz / len;
      pos.data[i * 3] = x + (nx / len) * lift;
      pos.data[i * 3 + 1] = y + (ny / len) * lift;
      pos.data[i * 3 + 2] = z + (nz / len) * lift;
    }
  }

  const geo = new THREE.BufferGeometry();
  for (const [name, a] of attrs) {
    const arr = name === 'skinIndex' ? new Uint16Array(a.data) : new Float32Array(a.data);
    geo.setAttribute(name, new THREE.BufferAttribute(arr, a.size));
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(tris.flat());
  if (morphs.length) {
    geo.morphAttributes.position = morphs.map(
      (m) => new THREE.BufferAttribute(new Float32Array(m), 3),
    );
    geo.morphTargetsRelative = head.morphTargetsRelative;
  }
  geo.computeBoundingSphere();
  return geo;
}

const geometryCache = new Map<string, THREE.BufferGeometry | null>();

function decalGeometry(
  head: THREE.BufferGeometry,
  frame: HeadFrame,
  sel: StubbleSelection,
): THREE.BufferGeometry | null {
  // SkeletonUtils clones share geometry with the parsed asset, so one head mesh
  // serves every composed variant and this key is stable per (head, styles).
  //
  // The STYLES have to be in it, not just which slots are filled: the trim is
  // sized to the footprint, and a buzz cut's hairline is 11 degrees lower than a
  // crew's. Keying on "has a scalp decal" hands buzz the geometry cut for crew
  // and slices the bottom off its hairline.
  const key = `${head.uuid}|${decalKey(sel)}`;
  if (geometryCache.has(key)) return geometryCache.get(key) ?? null;
  const geo = buildDecalGeometry(head, frame, sel);
  geometryCache.set(key, geo);
  return geo;
}

const frameCache = new WeakMap<THREE.BufferGeometry, HeadFrame>();

/** The head's own normalized frame, derived once per head geometry. Exported
 *  so a second decal (makeup.ts) shares the cache rather than re-deriving a
 *  frame that must agree with this one to the degree. */
export function cachedHeadFrame(geo: THREE.BufferGeometry): HeadFrame | null {
  return cachedFrame(geo);
}

function cachedFrame(geo: THREE.BufferGeometry): HeadFrame | null {
  const hit = frameCache.get(geo);
  if (hit) return hit;
  const pos = geo.getAttribute('position');
  if (!pos) return null;
  const f = headFrame(pos);
  frameCache.set(geo, f);
  return f;
}

/** The head mesh a decal rides. Named parts survive `mergeSkinnedParts`
 *  untouched, because a part carrying morph targets is never merged. */
export function headNodeName(gender: Gender): string {
  return gender === 'female' ? 'F_Head' : 'M_Head';
}

/**
 * Build the decal mesh for a composed character, or null when no decal style is
 * selected (in which case NOTHING is added and the face is exactly the head).
 */
export function buildStubbleDecal(
  head: THREE.SkinnedMesh,
  sel: StubbleSelection,
): THREE.SkinnedMesh | null {
  if (!sel.scalp && !sel.beard) return null;
  const frame = cachedFrame(head.geometry);
  if (!frame) return null;
  const geo = decalGeometry(head.geometry, frame, sel);
  if (!geo) return null;
  const decal = new THREE.SkinnedMesh(geo, decalMaterial(sel));
  decal.name = 'ModStubbleDecal';
  decal.position.copy(head.position);
  decal.quaternion.copy(head.quaternion);
  decal.scale.copy(head.scale);
  decal.frustumCulled = head.frustumCulled;
  decal.renderOrder = head.renderOrder;
  decal.layers.mask = head.layers.mask;
  // A translucent wash has no business casting a shadow of its own, and the
  // head under it already casts one.
  decal.castShadow = false;
  decal.receiveShadow = head.receiveShadow;
  decal.bindMode = head.bindMode;
  decal.bind(head.skeleton, head.bindMatrix);
  // Same targets, same names, applyMorphs drives both off the head's own
  // dictionary, so a slider moves the skin and the stubble on it together.
  if (head.morphTargetDictionary) {
    decal.morphTargetDictionary = head.morphTargetDictionary;
    decal.morphTargetInfluences = new Array(geo.morphAttributes.position?.length ?? 0).fill(0);
  }
  if (geo.boundingSphere) decal.boundingSphere = geo.boundingSphere.clone();
  return decal;
}
