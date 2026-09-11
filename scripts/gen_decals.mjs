#!/usr/bin/env node
// Built-in ground-decal library generator.
//
// Every decal in public/textures/decals/ is drawn HERE, from shape math and
// hash noise, no third-party art, no attribution burden, and nothing to
// re-license (same approach as the paint tool's brush alphas in
// src/editor/brush_alphas.ts). Output is RGBA WebP: the RGB carries the
// decal's own colour detail (blood reads red without tinting) and the ALPHA
// carries coverage, so the renderer can tint, fade, and glow one image.
//
//   node scripts/gen_decals.mjs            # write images + the TS manifest
//   node scripts/gen_decals.mjs --check    # fail if the checked-in output is stale
//
// Generation is DETERMINISTIC (seeded integer hashes, never Math.random), so a
// re-run reproduces the same bytes and the diff stays empty unless a decal's
// recipe actually changed.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public/textures/decals');
const MANIFEST = join(ROOT, 'src/render/decal_library.generated.ts');
const SIZE = 512;
// Lossy colour with near-lossless alpha: the coverage edge is what the eye
// reads on a decal, and lossy alpha frays thin rune strokes into a halo.
const WEBP = { quality: 84, alphaQuality: 100, effort: 6 };

// ---- deterministic noise ----------------------------------------------------

function hash01(x, y, salt) {
  let h =
    (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(salt, 2246822519)) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y, salt) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash01(x0, y0, salt);
  const b = hash01(x0 + 1, y0, salt);
  const c = hash01(x0, y0 + 1, salt);
  const d = hash01(x0 + 1, y0 + 1, salt);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Fractal noise in [0,1], `oct` octaves starting at `freq` cycles per unit. */
function fbm(x, y, freq, salt, oct = 4) {
  let v = 0;
  let amp = 0.5;
  let norm = 0;
  let f = freq;
  for (let i = 0; i < oct; i++) {
    v += amp * valueNoise(x * f, y * f, salt + i * 17);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return v / norm;
}

/** Distances to the two nearest points of a jittered lattice (worley F1/F2). */
function worley2(x, y, freq, salt) {
  const fx = x * freq;
  const fy = y * freq;
  const cx = Math.floor(fx);
  const cy = Math.floor(fy);
  let f1 = 9;
  let f2 = 9;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const gx = cx + ox + hash01(cx + ox, cy + oy, salt);
      const gy = cy + oy + hash01(cy + oy, cx + ox, salt + 7);
      const d = Math.hypot(fx - gx, fy - gy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) f2 = d;
    }
  }
  return [f1, f2];
}

/** Distance to the nearest of a jittered point lattice (worley F1), 0..~1. */
function worley(x, y, freq, salt) {
  return worley2(x, y, freq, salt)[0];
}

// ---- small maths ------------------------------------------------------------

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (e0, e1, v) => {
  const t = clamp01((v - e0) / (e1 - e0 || 1e-6));
  return t * t * (3 - 2 * t);
};
/** 1 inside the shape, 0 outside, antialiased over `w` (in uv units). */
const inside = (sd, w = 0.006) => 1 - smoothstep(-w, w, sd);
/** A soft band centred on the isoline sd = 0, `half` wide. */
const band = (sd, half, soft = 0.004) => 1 - smoothstep(half - soft, half + soft, Math.abs(sd));

const sdCircle = (x, y, r) => Math.hypot(x, y) - r;

function sdSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = clamp01((wx * vx + wy * vy) / (vx * vx + vy * vy || 1e-6));
  return Math.hypot(wx - vx * t, wy - vy * t);
}

/** Signed distance to a closed polygon (negative inside). */
function sdPolygon(x, y, pts) {
  let d = Number.POSITIVE_INFINITY;
  let winding = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j];
    const [bx, by] = pts[i];
    d = Math.min(d, sdSegment(x, y, ax, ay, bx, by));
    // Crossing number, robust for the convex/star shapes used here.
    const cond = ay > y !== by > y;
    if (cond && x < ((bx - ax) * (y - ay)) / (by - ay || 1e-6) + ax) winding++;
  }
  return winding % 2 === 1 ? -d : d;
}

/**
 * Radius multiplier that makes a circle edge ragged (burn / splat rims).
 *
 * The noise is sampled on a SMALL circle in noise space, which keeps it exactly
 * periodic in angle and, the part that matters, keeps the wobble LOW
 * frequency. Sampling on a wide circle (the obvious first try) puts several
 * noise cells inside one degree of sweep, and every splat comes out as a
 * radial sea-urchin instead of a blob with a torn edge. `lobes` is that
 * circle's radius: 2 is a lazy amoeba, 4 is a torn rag.
 */
function raggedR(ang, salt, amount = 0.12, lobes = 2.5) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const n1 = valueNoise(c * lobes + 11.3, s * lobes + 7.1, salt) - 0.5;
  const n2 = valueNoise(c * lobes * 2 + 3.7, s * lobes * 2 + 19.4, salt + 5) - 0.5;
  return 1 + (n1 * 1.7 + n2 * 0.75) * amount;
}

/** Domain-warped position: shoves (x,y) around by low-frequency noise so a
 *  radial falloff comes out blotchy instead of perfectly concentric. */
function warp(x, y, amount, salt) {
  return [
    x + (fbm(x + 2, y + 2, 1.5, salt) - 0.5) * amount,
    y + (fbm(x + 9, y + 9, 1.5, salt + 3) - 0.5) * amount,
  ];
}

// ---- the library ------------------------------------------------------------
//
// Each entry draws one texel at a time. (x, y) run -1..1 across the image, so
// radius 1 is the decal's authored footprint edge. Return [r, g, b, a] in 0..1;
// `a` is coverage and rgb is the decal's own colour.

/** Arcane glyph strokes around a ring, the rune band shared by the circles. */
function runeBand(x, y, r0, r1, count, salt) {
  const ang = Math.atan2(y, x);
  const rad = Math.hypot(x, y);
  if (rad < r0 - 0.02 || rad > r1 + 0.02) return 0;
  const slot = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * count);
  const local = ((ang + Math.PI) / (Math.PI * 2)) * count - slot;
  // Each slot draws 2-3 strokes from a hashed alphabet: verticals, a bar, a
  // diagonal. Enough variety to read as writing at a glance.
  const seedA = hash01(slot, 1, salt);
  const seedB = hash01(slot, 2, salt);
  const seedC = hash01(slot, 3, salt);
  const u = (local - 0.5) * 2; // -1..1 across the slot
  const v = ((rad - r0) / (r1 - r0) - 0.5) * 2; // -1..1 across the band
  if (Math.abs(u) > 0.72 || Math.abs(v) > 0.95) return 0;
  const w = 0.16;
  let s = 9;
  s = Math.min(s, Math.abs(u + (seedA - 0.5) * 0.7)); // stem
  if (seedB > 0.35) s = Math.min(s, sdSegment(u, v, -0.45, -0.6 + seedB * 0.5, 0.45, -0.2));
  if (seedC > 0.5) s = Math.min(s, sdSegment(u, v, -0.4, 0.55, 0.4, 0.15));
  if (seedC < 0.25) s = Math.min(s, Math.abs(v - (seedA - 0.5) * 0.8));
  return 1 - smoothstep(w * 0.6, w, s);
}

const DECALS = [
  // ---- arcane -------------------------------------------------------------
  {
    key: 'pentagram',
    name: 'Pentagram',
    category: 'arcane',
    size: 10,
    glow: 0.35,
    tint: 0xd94f4f,
    draw(x, y) {
      const r = Math.hypot(x, y);
      const rag = raggedR(Math.atan2(y, x), 101, 0.025, 3);
      // Unicursal five-point star: the chord set of a {5/2} polygram.
      let star = 9;
      const pts = [];
      for (let i = 0; i < 5; i++) {
        const a = (i * 2 * Math.PI) / 5 - Math.PI / 2;
        pts.push([Math.cos(a) * 0.78, Math.sin(a) * 0.78]);
      }
      for (let i = 0; i < 5; i++) {
        const a = pts[i];
        const b = pts[(i + 2) % 5];
        star = Math.min(star, sdSegment(x, y, a[0], a[1], b[0], b[1]));
      }
      const strokes =
        (1 - smoothstep(0.016, 0.03, star)) * 0.95 +
        band(sdCircle(x, y, 0.86 * rag), 0.016) +
        band(sdCircle(x, y, 0.97 * rag), 0.01) * 0.8 +
        runeBand(x, y, 0.87, 0.96, 22, 77) * 0.85;
      // Scorched ground under the sigil, so it sits IN the dirt not on it.
      const soot =
        smoothstep(1.02, 0.55, r) * (0.35 + 0.4 * fbm(x * 3 + 5, y * 3 + 5, 2.5, 31)) * 0.55;
      const a = clamp01(Math.max(clamp01(strokes) * (r < 1.08 ? 1 : 0), soot));
      const line = clamp01(strokes);
      // Ember-bright strokes fading to charcoal wash.
      const rr = 0.1 + line * 0.85 + soot * 0.06;
      const gg = 0.06 + line * 0.16 + soot * 0.04;
      const bb = 0.07 + line * 0.12 + soot * 0.05;
      return [rr, gg, bb, a];
    },
  },
  {
    key: 'summon_circle',
    name: 'Summoning Circle',
    category: 'arcane',
    size: 12,
    glow: 0.45,
    tint: 0x7f6bff,
    draw(x, y) {
      const r = Math.hypot(x, y);
      const ang = Math.atan2(y, x);
      let s = 0;
      s += band(sdCircle(x, y, 0.96), 0.012);
      s += band(sdCircle(x, y, 0.82), 0.008) * 0.7;
      s += band(sdCircle(x, y, 0.52), 0.01) * 0.85;
      s += band(sdCircle(x, y, 0.2), 0.007) * 0.6;
      s += runeBand(x, y, 0.84, 0.94, 26, 211) * 0.9;
      // Inner triangle + its inverse, the classic double-invocation frame.
      const tri = [];
      const tri2 = [];
      for (let i = 0; i < 3; i++) {
        const a1 = (i * 2 * Math.PI) / 3 - Math.PI / 2;
        const a2 = a1 + Math.PI / 3;
        tri.push([Math.cos(a1) * 0.5, Math.sin(a1) * 0.5]);
        tri2.push([Math.cos(a2) * 0.5, Math.sin(a2) * 0.5]);
      }
      s += band(sdPolygon(x, y, tri), 0.009) * 0.9;
      s += band(sdPolygon(x, y, tri2), 0.007) * 0.55;
      // Spokes between the rings.
      const spoke = Math.abs(((ang + Math.PI) % (Math.PI / 6)) - Math.PI / 12);
      if (r > 0.52 && r < 0.82) s += (1 - smoothstep(0.012, 0.03, spoke * r)) * 0.5;
      const a = clamp01(s) * (r < 1.0 ? 1 : 0);
      const glow = clamp01(s);
      return [0.42 + glow * 0.45, 0.34 + glow * 0.5, 0.85 + glow * 0.15, a];
    },
  },
  {
    key: 'rune_circle',
    name: 'Rune Circle',
    category: 'arcane',
    size: 8,
    glow: 0.4,
    tint: 0x59c6ff,
    draw(x, y) {
      const r = Math.hypot(x, y);
      let s = band(sdCircle(x, y, 0.94), 0.01) + band(sdCircle(x, y, 0.66), 0.008) * 0.8;
      s += runeBand(x, y, 0.68, 0.92, 18, 409);
      const a = clamp01(s) * (r < 0.99 ? 1 : 0);
      return [0.35 + a * 0.4, 0.72 + a * 0.25, 0.95, a];
    },
  },
  {
    key: 'hexagram',
    name: 'Hexagram Seal',
    category: 'arcane',
    size: 10,
    glow: 0.4,
    tint: 0xffc857,
    draw(x, y) {
      const r = Math.hypot(x, y);
      const t1 = [];
      const t2 = [];
      for (let i = 0; i < 3; i++) {
        const a1 = (i * 2 * Math.PI) / 3 - Math.PI / 2;
        t1.push([Math.cos(a1) * 0.8, Math.sin(a1) * 0.8]);
        t2.push([Math.cos(a1 + Math.PI / 3) * 0.8, Math.sin(a1 + Math.PI / 3) * 0.8]);
      }
      let s = band(sdPolygon(x, y, t1), 0.014) + band(sdPolygon(x, y, t2), 0.014);
      s += band(sdCircle(x, y, 0.92), 0.012) + band(sdCircle(x, y, 0.4), 0.008) * 0.7;
      s += runeBand(x, y, 0.82, 0.9, 12, 613) * 0.7;
      const a = clamp01(s) * (r < 0.98 ? 1 : 0);
      return [0.98, 0.78 + a * 0.15, 0.34, a];
    },
  },
  {
    key: 'ward_seal',
    name: 'Ward Seal',
    category: 'arcane',
    size: 9,
    glow: 0.3,
    tint: 0x8fe3c1,
    draw(x, y) {
      const r = Math.max(Math.abs(x), Math.abs(y));
      const sq = (k) => Math.max(Math.abs(x), Math.abs(y)) - k;
      let s = band(sq(0.9), 0.012) + band(sq(0.72), 0.007) * 0.7;
      // Corner nodes + binding diagonals.
      for (const [cx, cy] of [
        [-0.81, -0.81],
        [0.81, -0.81],
        [-0.81, 0.81],
        [0.81, 0.81],
      ]) {
        s += inside(sdCircle(x - cx, y - cy, 0.07), 0.008) * 0.9;
      }
      s += (1 - smoothstep(0.01, 0.024, sdSegment(x, y, -0.72, -0.72, 0.72, 0.72))) * 0.55;
      s += (1 - smoothstep(0.01, 0.024, sdSegment(x, y, -0.72, 0.72, 0.72, -0.72))) * 0.55;
      s += band(sdCircle(x, y, 0.36), 0.01) * 0.9;
      s += runeBand(x, y, 0.0, 0.3, 4, 811) * 0.5;
      const a = clamp01(s) * (r < 0.95 ? 1 : 0);
      return [0.56, 0.92, 0.78, a];
    },
  },
  {
    key: 'teleport_pad',
    name: 'Teleport Pad',
    category: 'arcane',
    size: 7,
    glow: 0.55,
    tint: 0x69f0ff,
    draw(x, y) {
      const r = Math.hypot(x, y);
      const ang = Math.atan2(y, x);
      let s = band(sdCircle(x, y, 0.95), 0.014) + band(sdCircle(x, y, 0.3), 0.02);
      // Three arc segments per ring, rotating like an iris.
      for (const [rad, off, width] of [
        [0.78, 0, 0.9],
        [0.6, 0.7, 0.7],
        [0.45, 1.5, 0.5],
      ]) {
        const seg = ((ang + off + Math.PI * 4) % ((Math.PI * 2) / 3)) - Math.PI / 3;
        if (Math.abs(seg) < width) s += band(sdCircle(x, y, rad), 0.016) * 0.9;
      }
      const a = clamp01(s) * (r < 0.99 ? 1 : 0) + smoothstep(0.34, 0.0, r) * 0.35;
      return [0.45, 0.95, 1.0, clamp01(a)];
    },
  },
  {
    key: 'blood_rune',
    name: 'Blood Rune',
    category: 'arcane',
    size: 6,
    glow: 0.15,
    tint: 0xa11d1d,
    draw(x, y) {
      // A jagged bind-rune, painted rather than engraved: thick, uneven strokes.
      const wob = (fbm(x * 4, y * 4, 3, 97) - 0.5) * 0.05;
      const px = x + wob;
      const py = y + wob;
      let s = 9;
      s = Math.min(s, sdSegment(px, py, 0, -0.75, 0, 0.75));
      s = Math.min(s, sdSegment(px, py, 0, -0.3, 0.5, -0.66));
      s = Math.min(s, sdSegment(px, py, 0, 0.1, -0.52, -0.26));
      s = Math.min(s, sdSegment(px, py, 0, 0.42, 0.46, 0.72));
      const stroke = 1 - smoothstep(0.05, 0.085, s);
      // Drips off the low ends.
      const drip = 1 - smoothstep(0.02, 0.05, sdSegment(px, py, 0.02, 0.6, 0.05, 0.92));
      const a = clamp01(stroke + drip * 0.7) * (0.7 + 0.3 * fbm(x * 6, y * 6, 4, 13));
      return [0.62, 0.07, 0.08, clamp01(a)];
    },
  },

  // ---- destruction --------------------------------------------------------
  {
    key: 'blast_scorch',
    name: 'Blast Scorch',
    category: 'burn',
    size: 8,
    tint: 0xffffff,
    draw(x, y) {
      // Warp the falloff so the burn is blotchy, not a perfect airbrush ring.
      const [wx, wy] = warp(x, y, 0.34, 27);
      const ang = Math.atan2(wy, wx);
      const r = Math.hypot(wx, wy) / raggedR(ang, 5, 0.2, 2.6);
      const body = smoothstep(1.0, 0.2, r);
      const patch = fbm(x * 2.4, y * 2.4, 2.2, 23, 5);
      const a = clamp01(body * (0.42 + patch * 1.05));
      // Charcoal core through soot to a faint dusty rim.
      const core = smoothstep(0.5, 0.0, r);
      const l = 0.05 + core * 0.02 + (1 - body) * 0.16 + patch * 0.1;
      return [l * 1.14, l * 0.97, l * 0.87, a];
    },
  },
  {
    key: 'impact_crater',
    name: 'Impact Crater',
    category: 'burn',
    size: 12,
    tint: 0xffffff,
    draw(x, y) {
      const ang = Math.atan2(y, x);
      const rag = raggedR(ang, 61, 0.13, 2.2);
      const r = Math.hypot(x, y) / rag;
      const bowl = smoothstep(0.74, 0.1, r);
      // Raised rim: a bright ring of thrown-up earth around the bowl.
      const rim = band(r - 0.76, 0.12, 0.08);
      // Ejecta: a handful of chunky rays, not a fringe of hairs.
      const rays =
        Math.max(0, valueNoise(Math.cos(ang) * 2.2 + 5, Math.sin(ang) * 2.2 + 5, 71) - 0.42) * 2.6;
      const ejecta = smoothstep(1.2, 0.78, r) * smoothstep(0.74, 0.92, r) * rays;
      const grain = fbm(x * 3, y * 3, 2.5, 89, 5);
      const a = clamp01((bowl * 0.98 + rim * 0.85 + ejecta) * (0.65 + grain * 0.6));
      // Dark bowl, pale rim/ejecta: the read that says "something hit here".
      const l = 0.05 + bowl * 0.02 + rim * 0.26 + ejecta * 0.3 + grain * 0.07;
      return [l * 1.16, l * 1.0, l * 0.84, a];
    },
  },
  {
    key: 'scorch_streak',
    name: 'Scorch Streak',
    category: 'burn',
    size: 9,
    tint: 0xffffff,
    draw(x, y) {
      // A directional smear: dense at the strike point, trailing along +y.
      // A blast that came in at an angle: dense char at the strike end (-y),
      // thinning into a long soot tail toward +y.
      const t = clamp01((y + 1) / 2);
      const width = 0.62 * (1 - t * 0.5);
      const d = Math.abs(x + Math.sin(t * 3.4) * 0.1) / (width + 1e-4);
      const along = (1 - t * 0.55) * smoothstep(1.0, 0.92, Math.abs(y));
      const grain = fbm(x * 3.4, y * 1.5, 2.2, 151, 5);
      const strike = smoothstep(0.55, 0.0, Math.hypot(x * 1.5, y + 0.72));
      const a = clamp01((smoothstep(1.0, 0.05, d) * along * (0.85 + grain * 0.8) + strike) * 1.1);
      const l = 0.045 + grain * 0.13 - strike * 0.02;
      return [l * 1.14, l * 0.96, l * 0.85, a];
    },
  },
  {
    key: 'ash_burst',
    name: 'Ash Burst',
    category: 'burn',
    size: 7,
    tint: 0xffffff,
    draw(x, y) {
      const r = Math.hypot(x, y);
      const ang = Math.atan2(y, x);
      // Tongues of soot flung out from the centre, a handful of broad lobes
      // (low-frequency angular noise), each fading out into loose speckle.
      const streak = valueNoise(Math.cos(ang) * 2.6 + 4, Math.sin(ang) * 2.6 + 4, 173);
      const reach = 0.42 + streak * 0.58;
      const body = smoothstep(reach, reach * 0.2, r);
      const speck = fbm(x * 5, y * 5, 3.5, 19, 5);
      const dust = smoothstep(reach * 1.35, reach * 0.7, r) * Math.max(0, speck - 0.52) * 2.2;
      const a = clamp01(body * (0.3 + speck * 0.95) + dust);
      const l = 0.08 + speck * 0.12;
      return [l, l * 0.95, l * 0.91, a];
    },
  },
  {
    key: 'crack_star',
    name: 'Ground Fracture',
    category: 'damage',
    size: 9,
    tint: 0xffffff,
    draw(x, y) {
      const r = Math.hypot(x, y);
      // Six primary fissures with hashed branch angles, tapering outward.
      let crack = 0;
      for (let i = 0; i < 6; i++) {
        const base = (i * Math.PI * 2) / 6 + (hash01(i, 3, 233) - 0.5) * 0.7;
        const len = 0.6 + hash01(i, 5, 233) * 0.38;
        const bend = (hash01(i, 7, 233) - 0.5) * 0.6;
        const ex = Math.cos(base + bend) * len;
        const ey = Math.sin(base + bend) * len;
        const d = sdSegment(x, y, 0, 0, ex, ey);
        const taper = 0.03 * (1 - Math.min(1, r / (len + 0.05)) * 0.75);
        crack = Math.max(crack, 1 - smoothstep(taper * 0.55, taper, d));
        // One branch per fissure, from two-thirds along.
        const bx = ex * 0.6;
        const by = ey * 0.6;
        const ba = base + (hash01(i, 11, 233) - 0.5) * 1.6;
        const bl = len * 0.42;
        const d2 = sdSegment(x, y, bx, by, bx + Math.cos(ba) * bl, by + Math.sin(ba) * bl);
        crack = Math.max(crack, (1 - smoothstep(0.01, 0.019, d2)) * 0.85);
      }
      const hub = smoothstep(0.16, 0.0, r) * 0.8;
      const a = clamp01(Math.max(crack, hub) * (0.8 + fbm(x * 8, y * 8, 4, 7) * 0.4));
      const l = 0.05 + (1 - a) * 0.05;
      return [l, l * 0.96, l * 0.92, a];
    },
  },
  {
    key: 'crack_web',
    name: 'Crazed Cracks',
    category: 'damage',
    size: 7,
    tint: 0xffffff,
    draw(x, y) {
      // F2-F1 is ~0 exactly on a cell BORDER, which is the craze line itself
      // (|F1 - const| would draw a circle around every seed point instead).
      const [f1, f2] = worley2(x, y, 2.4, 331);
      const edge = 1 - smoothstep(0.02, 0.085, f2 - f1);
      const r = Math.hypot(x, y);
      const a = clamp01(edge * smoothstep(1.0, 0.3, r) * (0.55 + fbm(x * 5, y * 5, 3, 57) * 0.8));
      const l = 0.05 + (1 - a) * 0.04;
      return [l, l * 0.95, l * 0.9, a];
    },
  },
  {
    key: 'claw_marks',
    name: 'Claw Marks',
    category: 'damage',
    size: 5,
    tint: 0xffffff,
    draw(x, y) {
      let s = 0;
      for (let i = 0; i < 4; i++) {
        const off = (i - 1.5) * 0.32;
        const curve = Math.sin((y + 1) * 1.1) * 0.12;
        const d = Math.abs(x - off - curve);
        // Gouges are deepest mid-stroke and taper at both ends.
        const along = smoothstep(0.95, 0.55, Math.abs(y)) * (0.7 + hash01(i, 1, 5) * 0.3);
        const wdt = 0.028 * (0.6 + along);
        s = Math.max(s, (1 - smoothstep(wdt * 0.5, wdt, d)) * along);
      }
      const a = clamp01(s * (0.8 + fbm(x * 9, y * 9, 3, 67) * 0.35));
      const l = 0.07;
      return [l * 1.1, l * 0.9, l * 0.8, a];
    },
  },
  {
    key: 'shrapnel_pocks',
    name: 'Shrapnel Pocks',
    category: 'damage',
    size: 6,
    tint: 0xffffff,
    draw(x, y) {
      let s = 0;
      for (let i = 0; i < 30; i++) {
        // Denser toward the centre (sqrt-biased radius), sizes falling off
        // outward, so it reads as one burst rather than even confetti.
        const ang = hash01(i, 3, 419) * Math.PI * 2;
        const rad = Math.sqrt(hash01(i, 9, 419)) * 0.95;
        const bx = Math.cos(ang) * rad;
        const by = Math.sin(ang) * rad;
        const br = (0.03 + hash01(i, 15, 419) * 0.075) * (1 - rad * 0.45);
        const d = Math.hypot(x - bx, y - by);
        s = Math.max(s, (1 - smoothstep(br * 0.55, br, d)) * (0.7 + hash01(i, 21, 419) * 0.3));
      }
      const a = clamp01(s);
      const l = 0.06 + fbm(x * 8, y * 8, 3, 5) * 0.05;
      return [l, l * 0.94, l * 0.88, a];
    },
  },

  // ---- gore ---------------------------------------------------------------
  {
    key: 'blood_pool',
    name: 'Blood Pool',
    category: 'gore',
    size: 4,
    tint: 0xffffff,
    draw(x, y) {
      const ang = Math.atan2(y, x);
      const r = Math.hypot(x, y) / raggedR(ang, 907, 0.16, 2.4);
      const body = smoothstep(0.92, 0.78, r);
      // A few satellite droplets around the rim.
      let drops = 0;
      for (let i = 0; i < 9; i++) {
        const a2 = hash01(i, 1, 53) * Math.PI * 2;
        const rr = 0.9 + hash01(i, 2, 53) * 0.25;
        const br = 0.03 + hash01(i, 3, 53) * 0.06;
        drops = Math.max(
          drops,
          1 - smoothstep(br * 0.6, br, Math.hypot(x - Math.cos(a2) * rr, y - Math.sin(a2) * rr)),
        );
      }
      const a = clamp01(Math.max(body, drops * 0.9));
      // Dark clotted rim, brighter wet centre.
      const wet = smoothstep(0.85, 0.1, r);
      const rr = 0.16 + wet * 0.42;
      return [rr, 0.02 + wet * 0.05, 0.02 + wet * 0.05, a];
    },
  },
  {
    key: 'blood_splatter',
    name: 'Blood Splatter',
    category: 'gore',
    size: 5,
    tint: 0xffffff,
    draw(x, y) {
      let s = 0;
      for (let i = 0; i < 46; i++) {
        const a2 = hash01(i, 1, 149) * Math.PI * 2;
        const rr = hash01(i, 2, 149) ** 0.6;
        const bx = Math.cos(a2) * rr;
        const by = Math.sin(a2) * rr;
        // Droplets elongate away from the centre, as thrown spatter does.
        const br = 0.02 + (1 - rr) * 0.11 * hash01(i, 3, 149);
        const ux = Math.cos(a2);
        const uy = Math.sin(a2);
        const stretch = 1 + rr * 2.2;
        const dx = x - bx;
        const dy = y - by;
        const along = (dx * ux + dy * uy) / stretch;
        const across = dx * -uy + dy * ux;
        s = Math.max(s, 1 - smoothstep(br * 0.6, br, Math.hypot(along, across)));
      }
      const a = clamp01(s);
      return [0.45, 0.035, 0.03, a];
    },
  },
  {
    key: 'blood_drag',
    name: 'Drag Smear',
    category: 'gore',
    size: 7,
    tint: 0xffffff,
    draw(x, y) {
      const t = clamp01((y + 1) / 2);
      const width = 0.5 * (1 - t * 0.55);
      const d = Math.abs(x + Math.sin(t * 4.2) * 0.12) / (width + 1e-4);
      // Fine lengthwise striations: the fingers a body leaves being dragged.
      const streak = fbm(x * 14, y * 1.6, 3, 181, 5);
      const a = clamp01(smoothstep(1.0, 0.05, d) * (1 - t * 0.62) * (0.7 + streak * 0.9));
      return [0.3 + streak * 0.2, 0.025, 0.025, a];
    },
  },

  // ---- nature / wear ------------------------------------------------------
  {
    key: 'moss_patch',
    name: 'Moss Patch',
    category: 'nature',
    size: 6,
    tint: 0xffffff,
    draw(x, y) {
      const r = Math.hypot(x, y);
      const n = fbm(x * 2 + 3, y * 2 + 3, 2.2, 263, 5);
      const a = clamp01(smoothstep(0.95, 0.45, r) * 1.4 * (n * 1.5 - 0.25));
      const speck = worley(x, y, 9, 271);
      const l = 0.22 + n * 0.3 + (1 - smoothstep(0.0, 0.3, speck)) * 0.12;
      return [l * 0.55, l * 0.95, l * 0.36, a];
    },
  },
  {
    key: 'puddle',
    name: 'Puddle',
    category: 'nature',
    size: 5,
    tint: 0xffffff,
    draw(x, y) {
      const ang = Math.atan2(y, x);
      const r = Math.hypot(x, y) / raggedR(ang, 337, 0.15, 2.2);
      const body = smoothstep(0.95, 0.86, r);
      const sheen = smoothstep(0.9, 0.2, r) * (0.5 + fbm(x * 2.5, y * 2.5, 2, 349) * 0.7);
      const a = clamp01(body * 0.88);
      const l = 0.16 + sheen * 0.3;
      return [l * 0.72, l * 0.86, l, a];
    },
  },
  {
    key: 'mud_splat',
    name: 'Mud Splat',
    category: 'nature',
    size: 5,
    tint: 0xffffff,
    draw(x, y) {
      const ang = Math.atan2(y, x);
      const r = Math.hypot(x, y) / raggedR(ang, 443, 0.26, 3.2);
      const n = fbm(x * 3.5, y * 3.5, 3, 457);
      const a = clamp01(smoothstep(1.0, 0.5, r) * (0.4 + n * 1.1));
      const l = 0.2 + n * 0.16;
      return [l * 1.0, l * 0.78, l * 0.55, a];
    },
  },
  {
    key: 'dirt_wear',
    name: 'Worn Dirt',
    category: 'nature',
    size: 8,
    tint: 0xffffff,
    draw(x, y) {
      const ang = Math.atan2(y, x);
      const r = Math.hypot(x, y) / raggedR(ang, 521, 0.2, 2.0);
      const n = fbm(x * 2.4, y * 2.4, 2.4, 541);
      const a = clamp01(smoothstep(1.0, 0.25, r) * (0.35 + n * 0.85));
      const l = 0.3 + n * 0.2;
      return [l * 1.0, l * 0.85, l * 0.66, a];
    },
  },
  {
    key: 'gravel_scatter',
    name: 'Gravel Scatter',
    category: 'nature',
    size: 6,
    tint: 0xffffff,
    draw(x, y) {
      // Scattered pebbles: each an irregular blob with a lit top and a dark
      // contact shadow, so the patch reads as loose stone on the ground.
      let s = 0;
      let lit = 0;
      for (let i = 0; i < 40; i++) {
        const ang = hash01(i, 1, 601) * Math.PI * 2;
        const rad = Math.sqrt(hash01(i, 2, 601)) * 0.98;
        const bx = Math.cos(ang) * rad;
        const by = Math.sin(ang) * rad;
        const br = 0.035 + hash01(i, 3, 601) ** 1.7 * 0.075;
        const sq = 0.7 + hash01(i, 4, 601) * 0.6; // squash: pebbles are not discs
        const d = Math.hypot((x - bx) / sq, (y - by) * sq) / br;
        const v = 1 - smoothstep(0.82, 1.0, d);
        if (v > s) {
          s = v;
          // Top-left lit, bottom-right shaded.
          lit = clamp01(0.5 - (x - bx + (y - by)) / (br * 3.4)) * hash01(i, 5, 601);
        }
      }
      const a = clamp01(s * smoothstep(1.12, 0.35, Math.hypot(x, y)));
      const shade = 0.24 + lit * 0.4;
      return [shade * 1.02, shade * 0.98, shade * 0.92, a];
    },
  },
  {
    key: 'leaf_litter',
    name: 'Leaf Litter',
    category: 'nature',
    size: 6,
    tint: 0xffffff,
    draw(x, y) {
      let s = 0;
      let hue = 0;
      for (let i = 0; i < 26; i++) {
        const bx = (hash01(i, 1, 701) - 0.5) * 1.9;
        const by = (hash01(i, 2, 701) - 0.5) * 1.9;
        const a2 = hash01(i, 3, 701) * Math.PI;
        const dx = x - bx;
        const dy = y - by;
        // Elongated ellipse = a leaf lying flat.
        const lx = dx * Math.cos(a2) + dy * Math.sin(a2);
        const ly = -dx * Math.sin(a2) + dy * Math.cos(a2);
        const d = Math.hypot(lx / 0.13, ly / 0.055);
        const v = 1 - smoothstep(0.75, 1.0, d);
        if (v > s) {
          s = v;
          hue = hash01(i, 4, 701);
        }
      }
      const a = clamp01(s * smoothstep(1.15, 0.4, Math.hypot(x, y)));
      // Autumn range: ochre through rust.
      return [0.42 + hue * 0.3, 0.26 + hue * 0.16, 0.08 + hue * 0.06, a];
    },
  },
  {
    key: 'sand_drift',
    name: 'Sand Drift',
    category: 'nature',
    size: 9,
    tint: 0xffffff,
    draw(x, y) {
      // Wind ripples: sharp crests running across the drift, bent by a slow
      // noise so the lines wander like real dune corrugation.
      const bend = (fbm(x * 1.2, y * 0.7, 1.2, 787) - 0.5) * 2.6;
      const ripple = 0.5 + 0.5 * Math.sin(y * 11 + bend + Math.sin(x * 2.3) * 0.8);
      const crest = ripple ** 1.7;
      const r = Math.hypot(x * 0.82, y * 1.2);
      const a = clamp01(smoothstep(1.0, 0.15, r) * (0.45 + crest * 0.75));
      const l = 0.5 + crest * 0.34;
      return [l, l * 0.9, l * 0.66, a];
    },
  },
  {
    key: 'snow_drift',
    name: 'Snow Drift',
    category: 'nature',
    size: 9,
    tint: 0xffffff,
    draw(x, y) {
      const n = fbm(x * 2, y * 2, 2, 823, 5);
      const r = Math.hypot(x, y * 1.15);
      const a = clamp01(smoothstep(1.0, 0.25, r) * (0.35 + n * 0.95));
      const l = 0.82 + n * 0.18;
      return [l * 0.96, l * 0.98, l, a];
    },
  },
  {
    key: 'oil_stain',
    name: 'Oil Stain',
    category: 'nature',
    size: 5,
    tint: 0xffffff,
    draw(x, y) {
      const ang = Math.atan2(y, x);
      const r = Math.hypot(x, y) / raggedR(ang, 859, 0.22, 2.6);
      const body = smoothstep(0.98, 0.7, r);
      const n = fbm(x * 3, y * 3, 2.5, 877);
      const a = clamp01(body * (0.6 + n * 0.6));
      // Faint iridescent sheen so it does not read as a flat black hole.
      const sheen = smoothstep(0.8, 0.1, r) * n;
      return [0.05 + sheen * 0.12, 0.05 + sheen * 0.16, 0.07 + sheen * 0.22, a];
    },
  },

  // ---- tracks / markers ---------------------------------------------------
  {
    key: 'boot_prints',
    name: 'Boot Prints',
    category: 'tracks',
    size: 4,
    tint: 0xffffff,
    draw(x, y) {
      // Four staggered prints walking toward -y. Each is a rounded forefoot
      // and a separate heel with a gap between, the shape that reads as a
      // BOOT at a glance, where one blob just reads as a smudge.
      let s = 0;
      for (let i = 0; i < 4; i++) {
        const px = i % 2 === 0 ? -0.2 : 0.2;
        const py = 0.72 - i * 0.48;
        const sway = i % 2 === 0 ? -0.1 : 0.1; // toes splayed out slightly
        const dx = (x - px) * Math.cos(sway) + (y - py) * Math.sin(sway);
        const dy = -(x - px) * Math.sin(sway) + (y - py) * Math.cos(sway);
        // Forefoot: wide at the toes, narrowing to the arch.
        const fw = 0.115 * (1 - clamp01((dy + 0.16) / 0.3) * 0.28);
        const fore = 1 - smoothstep(0.85, 1.0, Math.hypot(dx / fw, (dy + 0.05) / 0.14));
        const heel = 1 - smoothstep(0.8, 1.0, Math.hypot(dx / 0.085, (dy - 0.16) / 0.075));
        s = Math.max(s, Math.max(fore, heel));
      }
      const a = clamp01(s * (0.72 + fbm(x * 8, y * 8, 3, 941) * 0.45));
      const l = 0.16;
      return [l * 1.06, l * 0.85, l * 0.6, a];
    },
  },
  {
    key: 'paw_prints',
    name: 'Beast Tracks',
    category: 'tracks',
    size: 4,
    tint: 0xffffff,
    draw(x, y) {
      let s = 0;
      for (let i = 0; i < 4; i++) {
        const px = i % 2 === 0 ? -0.26 : 0.26;
        const py = -0.72 + i * 0.48;
        const dx = x - px;
        const dy = y - py;
        // Pad + four toes.
        s = Math.max(s, 1 - smoothstep(0.1, 0.135, Math.hypot(dx, (dy + 0.03) / 0.85)));
        for (let t = 0; t < 4; t++) {
          const ta = -Math.PI / 2 + (t - 1.5) * 0.42;
          const tx = px + Math.cos(ta + Math.PI) * 0.0 + Math.sin((t - 1.5) * 0.7) * 0.13;
          const ty = py - 0.17 - Math.abs(t - 1.5) * 0.012;
          s = Math.max(s, 1 - smoothstep(0.042, 0.062, Math.hypot(x - tx, y - ty)));
        }
      }
      const a = clamp01(s * (0.7 + fbm(x * 9, y * 9, 3, 971) * 0.4));
      const l = 0.17;
      return [l * 1.0, l * 0.84, l * 0.62, a];
    },
  },
  {
    key: 'wagon_ruts',
    name: 'Wagon Ruts',
    category: 'tracks',
    size: 10,
    tint: 0xffffff,
    draw(x, y) {
      const wob = (fbm(x, y * 1.5, 1.2, 1009) - 0.5) * 0.12;
      let s = 0;
      for (const off of [-0.34, 0.34]) {
        const d = Math.abs(x - off - wob);
        s = Math.max(s, 1 - smoothstep(0.05, 0.11, d));
      }
      const grain = fbm(x * 5, y * 2, 3, 1013);
      const a = clamp01(s * (0.5 + grain * 0.8) * smoothstep(1.05, 0.85, Math.abs(y)));
      const l = 0.24 + grain * 0.12;
      return [l * 1.0, l * 0.86, l * 0.66, a];
    },
  },
  {
    key: 'arrow_marker',
    name: 'Arrow Marker',
    category: 'marker',
    size: 5,
    glow: 0.2,
    tint: 0xffd166,
    draw(x, y) {
      // Points toward -y (the decal's "forward" before rotation).
      const head = sdPolygon(x, y, [
        [0, -0.85],
        [0.55, -0.1],
        [0.22, -0.1],
        [0.22, 0.8],
        [-0.22, 0.8],
        [-0.22, -0.1],
        [-0.55, -0.1],
      ]);
      const a = clamp01(inside(head, 0.008) * 0.95);
      return [1.0, 0.85, 0.4, a];
    },
  },
  {
    key: 'hazard_ring',
    name: 'Hazard Ring',
    category: 'marker',
    size: 8,
    glow: 0.25,
    tint: 0xff7043,
    draw(x, y) {
      const r = Math.hypot(x, y);
      const ang = Math.atan2(y, x);
      // Dashed outer ring + solid inner ring.
      const dash = Math.sin(ang * 16) > 0 ? 1 : 0;
      let s = band(sdCircle(x, y, 0.94), 0.035) * dash;
      s += band(sdCircle(x, y, 0.7), 0.012);
      const a = clamp01(s) * (r < 1.0 ? 1 : 0);
      return [1.0, 0.5, 0.2, a];
    },
  },
  {
    key: 'campfire_soot',
    name: 'Campfire Scar',
    category: 'burn',
    size: 4,
    tint: 0xffffff,
    draw(x, y) {
      const ang = Math.atan2(y, x);
      const r = Math.hypot(x, y) / raggedR(ang, 1093, 0.09, 2.8);
      const grain = fbm(x * 5, y * 5, 3.5, 1097, 5);
      // Pale ash bed, ringed by the black scorch the fire ate into the ground.
      const ash = smoothstep(0.58, 0.05, r) * (0.55 + grain * 0.7);
      const burn = smoothstep(0.92, 0.5, r);
      const a = clamp01(Math.max(burn * (0.75 + grain * 0.35), ash));
      const l = 0.045 + ash * (0.34 + grain * 0.24);
      return [l * 1.06, l * 1.0, l * 0.96, a];
    },
  },
];

// ---- render + write ---------------------------------------------------------

function renderDecal(spec) {
  const px = Buffer.alloc(SIZE * SIZE * 4);
  for (let j = 0; j < SIZE; j++) {
    const y = ((j + 0.5) / SIZE) * 2 - 1;
    for (let i = 0; i < SIZE; i++) {
      const x = ((i + 0.5) / SIZE) * 2 - 1;
      const [r, g, b, a] = spec.draw(x, y);
      const o = (j * SIZE + i) * 4;
      px[o] = Math.round(clamp01(r) * 255);
      px[o + 1] = Math.round(clamp01(g) * 255);
      px[o + 2] = Math.round(clamp01(b) * 255);
      px[o + 3] = Math.round(clamp01(a) * 255);
    }
  }
  return px;
}

function manifestSource(entries) {
  const rows = entries
    .map((e) => {
      const bits = [
        `key: '${e.key}'`,
        `name: '${e.name}'`,
        `category: '${e.category}'`,
        `size: ${e.size}`,
      ];
      if (e.glow) bits.push(`glow: ${e.glow}`);
      if (e.tint !== 0xffffff) bits.push(`tint: 0x${e.tint.toString(16).padStart(6, '0')}`);
      bits.push(`bytes: ${e.bytes}`);
      return `  { ${bits.join(', ')} },`;
    })
    .join('\n');
  return `// GENERATED by scripts/gen_decals.mjs -- do not edit by hand.
//
// The built-in ground-decal library: every image under public/textures/decals/
// is drawn by that script from shape math and hash noise (original work, no
// third-party assets). Re-run \`node scripts/gen_decals.mjs\` after editing a
// recipe there.

export type DecalCategory = 'arcane' | 'burn' | 'damage' | 'gore' | 'nature' | 'tracks' | 'marker';

export interface DecalDef {
  /** File stem under public/textures/decals/ and the id half of \`builtin:<key>\`. */
  key: string;
  /** Display name (editor UI is English-only; see the i18n deferral note). */
  name: string;
  category: DecalCategory;
  /** Default stamp footprint in yards (diameter). */
  size: number;
  /** Default emissive strength 0..1 (magic circles read as lit). */
  glow?: number;
  /** Default tint (0xRRGGBB) multiplied into the art; absent = untinted. */
  tint?: number;
  /** Encoded size in bytes, for the budget report. */
  bytes: number;
}

export const DECAL_LIBRARY: readonly DecalDef[] = [
${rows}
];

export const DECAL_CATEGORY_ORDER: readonly DecalCategory[] = [
  'arcane',
  'burn',
  'damage',
  'gore',
  'nature',
  'tracks',
  'marker',
];
`;
}

async function main() {
  const check = process.argv.includes('--check');
  await mkdir(OUT_DIR, { recursive: true });
  const entries = [];
  let total = 0;
  const stale = [];
  for (const spec of DECALS) {
    const raw = renderDecal(spec);
    const webp = await sharp(raw, { raw: { width: SIZE, height: SIZE, channels: 4 } })
      .webp(WEBP)
      .toBuffer();
    const path = join(OUT_DIR, `${spec.key}.webp`);
    const prior = await readFile(path).catch(() => null);
    const same =
      prior &&
      createHash('sha256').update(prior).digest('hex') ===
        createHash('sha256').update(webp).digest('hex');
    if (!same) {
      if (check) stale.push(spec.key);
      else await writeFile(path, webp);
    }
    total += webp.length;
    entries.push({ ...spec, bytes: webp.length });
    if (!check) {
      console.log(`  ${spec.key.padEnd(18)} ${(webp.length / 1024).toFixed(1).padStart(7)} KB`);
    }
  }
  const src = manifestSource(entries);
  const priorSrc = await readFile(MANIFEST, 'utf8').catch(() => null);
  if (priorSrc !== src) {
    if (check) stale.push('decal_library.generated.ts');
    else await writeFile(MANIFEST, src);
  }
  if (check) {
    if (stale.length > 0) {
      console.error(`Stale decal output: ${stale.join(', ')}. Run: node scripts/gen_decals.mjs`);
      process.exit(1);
    }
    console.log(`decals up to date (${DECALS.length} entries)`);
    return;
  }
  console.log(
    `\n${DECALS.length} decals, ${(total / 1024).toFixed(0)} KB total (avg ${(total / DECALS.length / 1024).toFixed(1)} KB)`,
  );
}

await main();
