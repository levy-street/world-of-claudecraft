#!/usr/bin/env node
// Paints the stylized leaf-card atlases the Tree Generator scatters over its
// canopy volumes (src/render/tree_gen.ts). Project-owned art: every pixel here
// is drawn by this script, so the atlases carry the repo's own licence and can
// be retuned by editing the palettes/shapes below and re-running.
//
//   node scripts/assets/build_leaf_atlas.mjs [--only <set>] [--preview]
//
// Output: public/textures/foliage/leaves/<set>.png  (RGBA, straight alpha)
//         src/render/leaf_sets.generated.ts         (the renderer's registry)
//         tmp/leaf_preview.png                      (--preview contact sheet)
//
// HOW THE ART IS MADE
// Every leaf is an analytic shape, not a stamped bitmap: a leaflet is the set
// of points whose lateral distance from the leaf's own axis is under a width
// profile W(t), t running 0 (stem) to 1 (tip). That gives an exact silhouette
// at any resolution, lets veins/gradients be computed from the same local
// coordinates, and makes a compound leaf (maple, frond, needle sprig) simply a
// union of transformed leaflets. Cells are rendered at SS x resolution and box-
// downsampled, so edges are properly antialiased rather than stair-stepped.
//
// ANCHORS. A card is designed around the point where its stalk meets the twig,
// and tree_gen puts the leaf quad's pivot exactly there so a leaf droops and
// twists around its stalk like a real one. Upright sprigs anchor BOTTOM-CENTRE;
// hanging strands (willow) anchor TOP-CENTRE. Each set records which.
//
// The cluster geometry is the part that matters most: every leaf in a sprig is
// seated at `stem` units along its OWN axis from the anchor, so all the stalks
// converge on the anchor point instead of splaying out like insect legs.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(ROOT, 'public', 'textures', 'foliage', 'leaves');
const REGISTRY = join(ROOT, 'src', 'render', 'leaf_sets.generated.ts');

// Atlas geometry: 4x2 cells of 256px = a 1024x512 power-of-two sheet, so
// mipmaps stay clean. Eight variants per set is enough that a canopy never
// reads as one stamp repeated.
const CELL = 256;
const COLS = 4;
const ROWS = 2;
// Supersampling factor per axis (9 samples per output pixel at 3).
const SS = 3;
// Fraction of the cell left empty around a fitted card, so neighbouring cells
// never bleed into each other under bilinear filtering.
const MARGIN = 0.05;

// ---------------------------------------------------------------- rng + math

/** Deterministic PRNG (mulberry32): the same seed always paints the same sheet. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6));
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------------ palettes
// Colours are sRGB 0-255. `base` is the mid-leaf tone, `tip` the sunlit end,
// `deep` the shaded stem end, `vein` the midrib, `rim` the drawn edge line.
// `glow` marks palettes whose light parts should also drive an emissive map.

const PALETTES = {
  summer: {
    label: 'Summer',
    variants: [
      {
        deep: [58, 100, 44],
        base: [100, 154, 58],
        tip: [162, 206, 84],
        vein: [70, 116, 48],
        rim: [44, 78, 36],
      },
      {
        deep: [52, 94, 50],
        base: [90, 142, 68],
        tip: [148, 194, 94],
        vein: [64, 108, 56],
        rim: [40, 72, 40],
      },
      {
        deep: [68, 108, 40],
        base: [116, 166, 58],
        tip: [180, 216, 90],
        vein: [80, 124, 44],
        rim: [52, 84, 32],
      },
    ],
  },
  spring: {
    label: 'Spring',
    variants: [
      {
        deep: [96, 142, 54],
        base: [146, 190, 74],
        tip: [206, 230, 116],
        vein: [112, 156, 62],
        rim: [78, 118, 46],
      },
      {
        deep: [106, 152, 64],
        base: [160, 202, 88],
        tip: [220, 240, 138],
        vein: [124, 168, 72],
        rim: [88, 130, 54],
      },
      {
        deep: [88, 136, 58],
        base: [136, 182, 82],
        tip: [196, 224, 122],
        vein: [104, 150, 66],
        rim: [72, 112, 50],
      },
    ],
  },
  autumn: {
    label: 'Autumn',
    variants: [
      {
        deep: [150, 70, 28],
        base: [214, 116, 38],
        tip: [246, 176, 70],
        vein: [166, 84, 32],
        rim: [116, 50, 22],
      },
      {
        deep: [140, 48, 32],
        base: [196, 78, 50],
        tip: [232, 130, 72],
        vein: [152, 58, 38],
        rim: [104, 34, 26],
      },
      {
        deep: [158, 110, 30],
        base: [218, 166, 54],
        tip: [250, 212, 104],
        vein: [172, 124, 38],
        rim: [124, 86, 24],
      },
    ],
  },
  dry: {
    label: 'Dry',
    variants: [
      {
        deep: [110, 86, 48],
        base: [158, 128, 74],
        tip: [200, 174, 112],
        vein: [124, 98, 56],
        rim: [88, 68, 40],
      },
      {
        deep: [100, 82, 52],
        base: [144, 124, 80],
        tip: [186, 166, 118],
        vein: [112, 92, 60],
        rim: [80, 66, 42],
      },
      {
        deep: [122, 92, 44],
        base: [172, 138, 70],
        tip: [214, 186, 116],
        vein: [136, 104, 52],
        rim: [98, 72, 36],
      },
    ],
  },
  // Desert canopies: dusty grey-greens that sit right against sand and stone.
  sage: {
    label: 'Sage',
    variants: [
      {
        deep: [92, 108, 70],
        base: [138, 154, 102],
        tip: [186, 196, 142],
        vein: [104, 120, 78],
        rim: [74, 88, 56],
      },
      {
        deep: [86, 104, 78],
        base: [130, 150, 114],
        tip: [176, 192, 152],
        vein: [98, 116, 88],
        rim: [68, 84, 62],
      },
      {
        deep: [108, 118, 68],
        base: [156, 166, 106],
        tip: [200, 206, 146],
        vein: [120, 130, 76],
        rim: [86, 96, 54],
      },
    ],
  },
  // Dark forest: cold, near-black blue-greens with almost no highlight.
  dark: {
    label: 'Dark',
    variants: [
      {
        deep: [14, 26, 24],
        base: [26, 48, 42],
        tip: [48, 78, 64],
        vein: [18, 34, 30],
        rim: [8, 16, 16],
      },
      {
        deep: [16, 24, 32],
        base: [30, 44, 56],
        tip: [54, 72, 88],
        vein: [20, 30, 40],
        rim: [10, 14, 20],
      },
      {
        deep: [22, 30, 22],
        base: [40, 54, 38],
        tip: [68, 86, 58],
        vein: [28, 38, 28],
        rim: [12, 18, 14],
      },
    ],
  },
  // Magic groves: indigo blades running up to a luminous cyan-white edge.
  arcane: {
    label: 'Arcane',
    variants: [
      {
        deep: [38, 26, 82],
        base: [86, 62, 168],
        tip: [186, 158, 255],
        vein: [52, 36, 110],
        rim: [26, 18, 58],
      },
      {
        deep: [22, 44, 78],
        base: [46, 104, 168],
        tip: [138, 224, 255],
        vein: [30, 60, 104],
        rim: [14, 28, 54],
      },
      {
        deep: [46, 24, 74],
        base: [118, 60, 176],
        tip: [226, 168, 255],
        vein: [64, 34, 100],
        rim: [30, 16, 50],
      },
    ],
  },
  // Fire trees: charred blades whose edges are still burning.
  ember: {
    label: 'Ember',
    variants: [
      {
        deep: [26, 16, 14],
        base: [96, 34, 16],
        tip: [255, 158, 46],
        vein: [40, 20, 14],
        rim: [18, 10, 10],
      },
      {
        deep: [30, 14, 12],
        base: [128, 30, 14],
        tip: [255, 96, 32],
        vein: [48, 18, 12],
        rim: [20, 8, 8],
      },
      {
        deep: [22, 18, 16],
        base: [78, 44, 18],
        tip: [255, 216, 96],
        vein: [34, 24, 14],
        rim: [16, 12, 10],
      },
    ],
  },
};

// Palettes whose bright parts should also drive an emissive map, so the canopy
// throws light of its own at night.
const GLOW_PALETTES = new Set(['arcane', 'ember']);

// -------------------------------------------------------------- leaf profiles
// W(t) returns the HALF-WIDTH of a leaflet at t in [0, 1] as a fraction of its
// length. Everything downstream (veins, rim, shading) works in the same local
// (t, u) coordinates, u being lateral position normalized to the profile.

const PROFILES = {
  /** Egg-shaped with a drawn point: birch, aspen, generic broadleaf. */
  ovate: (t) => Math.sin(Math.PI * t ** 0.86) ** 0.78 * (1 - 0.25 * t),
  /** Long and narrow, widest low down: willow, olive. */
  lanceolate: (t) => Math.sin(Math.PI * t ** 1.25) ** 0.62,
  /** Oak: an ovate body with rounded lobes cut along its length. */
  lobed: (t) => {
    const body = Math.sin(Math.PI * t ** 0.8) ** 0.7 * (1 - 0.18 * t);
    const lobes = 1 + 0.3 * Math.cos(2 * Math.PI * 3.5 * t + 0.6);
    return body * lobes;
  },
  /** A single ray of a palmate leaf: broad shoulders, sharp point. */
  palmateRay: (t) => Math.sin(Math.PI * t ** 0.62) ** 0.9 * (1 - 0.45 * t * t),
  /** Needle: near-parallel sides, fading to a point. */
  needle: (t) => (1 - t * t * 0.85) * (0.55 + 0.45 * smooth(0, 0.12, t)),
  /** Frond leaflet: wide at the rachis, tapering hard. */
  pinna: (t) => Math.sin(Math.PI * t ** 0.7) ** 0.55 * (1 - 0.3 * t),
  /** Big tropical blade: broad and rounded almost to the blunt tip. */
  blade: (t) => Math.sin(Math.PI * t ** 0.5) ** 0.42 * (1 - 0.22 * t * t),
};

/**
 * One drawn leaflet. Positions are in card space: x in [-0.5, 0.5], y in
 * [0, 1], with the anchor at the origin for bottom-anchored cards.
 */
function leaflet(o) {
  return {
    x: o.x,
    y: o.y,
    angle: o.angle, // radians, 0 = pointing straight up
    len: o.len,
    wid: o.wid, // half-width multiplier applied to the profile
    profile: o.profile,
    veins: o.veins ?? 5,
    curl: o.curl ?? 0, // bends the axis sideways over the leaf's length
    serrate: o.serrate ?? 0,
    serrateFreq: o.serrateFreq ?? 14,
    /** Splits the blade with cuts to the midrib (banana/monstera look). */
    tear: o.tear ?? 0,
    tearFreq: o.tearFreq ?? 7,
    color: o.color ?? 0,
    shade: o.shade ?? 1, // brightness multiplier, gives a cluster depth
    stem: o.stem ?? 0, // stalk drawn back along the axis toward the anchor
    stemWidth: o.stemWidth ?? 0.009,
  };
}

/** Where a leaflet's blade STARTS, given it is seated `stem` back along its own
 *  axis from the point it hangs off. A leaf at angle A points along
 *  (-sin A, cos A), so its blade base is exactly one stalk-length up that
 *  direction from the anchor, which is what makes every stalk in a cluster
 *  converge on the same point instead of splaying out. */
function seat(anchorX, anchorY, angle, stem) {
  return { x: anchorX - Math.sin(angle) * stem, y: anchorY + Math.cos(angle) * stem };
}

/**
 * Sample a leaflet at a card-space point. Returns null outside the silhouette,
 * else { t, u, edge } where edge is 0 at the midrib and 1 at the outline.
 */
function sampleLeaflet(L, px, py) {
  const dx = px - L.x;
  const dy = py - L.y;
  const c = Math.cos(-L.angle);
  const s = Math.sin(-L.angle);
  let lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  if (L.stem > 0 && ly < 0 && ly > -L.stem && Math.abs(lx) < L.stemWidth) {
    return { t: 0, u: 0, edge: 1, stalk: true };
  }
  if (ly < 0 || ly > L.len) return null;
  const t = ly / L.len;
  // Curl bends the axis sideways as t rises, so the blade is not a straight bar.
  lx -= L.curl * L.len * t * t * 0.5;
  let half = L.wid * L.len * PROFILES[L.profile](t);
  if (L.serrate > 0) {
    const teeth = Math.abs(Math.sin(t * L.serrateFreq * Math.PI));
    half *= 1 - L.serrate * (1 - teeth) * smooth(0.05, 0.3, t) * (1 - smooth(0.82, 1, t));
  }
  if (half <= 1e-5 || Math.abs(lx) > half) return null;
  const u = lx / half;
  // Tears: wedges cut in from the edge toward the midrib, as a big tropical
  // blade splits along its veins.
  if (L.tear > 0) {
    const phase = t * L.tearFreq;
    const f = Math.abs(phase - Math.round(phase));
    const cut = (1 - smooth(0.06, 0.2, f)) * L.tear;
    if (cut > 0 && Math.abs(u) > 1 - cut) return null;
  }
  return { t, u, edge: Math.abs(u), stalk: false };
}

/**
 * Shade one hit: returns [r, g, b] in 0-255.
 *
 * FLAT AND CARTOON on purpose. These cards end up a few dozen pixels across in
 * a canopy, and anything busy at atlas scale turns to noise there: painterly
 * mottling reads as dirt, full-length vein chevrons read as cracks, and a hard
 * dark rim reads as a black outline around every leaf. So the card is a broad
 * flat fill, one soft base-to-tip lift, a single hairline midrib, and a rim
 * only on the outermost sliver of the blade - the same read the shipped kit
 * leaf sheets have.
 */
function shadeLeaflet(L, hit, palette, seed) {
  const v = palette.variants[L.color % palette.variants.length];
  if (hit.stalk) return [v.vein[0], v.vein[1], v.vein[2]];
  const { t, u, edge } = hit;
  // One gentle lift from the shaded stem end to the sunlit tip. Kept shallow:
  // a strong gradient makes every card look individually lit, which fights the
  // actual scene lighting once they are on a tree.
  const g = smooth(0, 1, t);
  let r = mix(v.base[0], v.tip[0], g * 0.75);
  let gg = mix(v.base[1], v.tip[1], g * 0.75);
  let b = mix(v.base[2], v.tip[2], g * 0.75);
  // The stem end darkens only in its lowest fifth, so the blade stays flat.
  const foot = 1 - smooth(0, 0.2, t);
  r = mix(r, v.deep[0], foot * 0.55);
  gg = mix(gg, v.deep[1], foot * 0.55);
  b = mix(b, v.deep[2], foot * 0.55);
  // A hairline midrib. No side veins at all.
  const ribW = 0.045 * (1 - 0.6 * t) + 0.008;
  const rib = (1 - smooth(ribW * 0.5, ribW, Math.abs(u))) * (1 - smooth(0.86, 1, t));
  r = mix(r, v.vein[0], rib * 0.42);
  gg = mix(gg, v.vein[1], rib * 0.42);
  b = mix(b, v.vein[2], rib * 0.42);
  // Rim: the outermost sliver only, and shallow. This is a drawn edge, not an
  // outline - an outline on a card this small eats the leaf.
  const rim = smooth(0.9, 1.0, edge);
  r = mix(r, v.rim[0], rim * 0.38);
  gg = mix(gg, v.rim[1], rim * 0.38);
  b = mix(b, v.rim[2], rim * 0.38);
  const lift = L.shade;
  return [
    clamp01((r * lift) / 255) * 255,
    clamp01((gg * lift) / 255) * 255,
    clamp01((b * lift) / 255) * 255,
  ];
}

// ------------------------------------------------------------ card auto-fit

/** Axis-aligned bounds of a card's drawn shape, sampled off the outlines. */
function cardBounds(leaves) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const add = (x, y) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const L of leaves) {
    const c = Math.cos(L.angle);
    const s = Math.sin(L.angle);
    // Local -> card is a rotation by +angle (sampleLeaflet does the inverse).
    const toCard = (lx, ly) => add(L.x + lx * c - ly * s, L.y + lx * s + ly * c);
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const half = L.wid * L.len * PROFILES[L.profile](t);
      const bend = L.curl * L.len * t * t * 0.5;
      const ly = t * L.len;
      toCard(bend - half, ly);
      toCard(bend + half, ly);
    }
    if (L.stem > 0) toCard(0, -L.stem);
  }
  return { minX, maxX, minY, maxY };
}

/**
 * Scale a card about its anchor so it fills the cell. The anchor stays put,  * that is the pivot tree_gen rotates the quad around, so the fit is symmetric
 * in x and one-sided in y.
 */
function fitCard(leaves, anchor) {
  const b = cardBounds(leaves);
  const halfX = Math.max(Math.abs(b.minX), Math.abs(b.maxX), 1e-4);
  // How far the card reaches AWAY from its anchor edge. The anchor itself sits
  // on the cell edge (that is the pivot), so the margin is only needed at the
  // far end and at the sides.
  const reach = Math.max(anchor === 'top' ? 1 - b.minY : b.maxY, 1e-4);
  const sx = (0.5 - MARGIN) / halfX;
  const sy = (1 - MARGIN) / reach;
  const k = Math.min(sx, sy);
  const originY = anchor === 'top' ? 1 : 0;
  for (const L of leaves) {
    L.x *= k;
    L.y = originY + (L.y - originY) * k;
    L.len *= k;
    L.stem *= k;
    L.stemWidth = Math.max(L.stemWidth * k, 0.004);
  }
  return leaves;
}

// ------------------------------------------------------------- card builders
// Each builder returns the leaflets of ONE atlas cell.

/** A fan of leaves off one twig: the everyday broadleaf sprig. All the stalks
 *  converge on the anchor because each blade is seated `stem` along its own
 *  axis, which is what stops the cluster growing spider legs. */
function sprigCard(rand, opts) {
  const out = [];
  const n = opts.count[0] + Math.floor(rand() * (opts.count[1] - opts.count[0] + 1));
  const spread = opts.spread ?? 1.05;
  // Paint back to front so the front leaves overlap the shaded ones.
  const order = [];
  for (let i = 0; i < n; i++) order.push(i);
  order.sort((a, b) => Math.abs(b - (n - 1) / 2) - Math.abs(a - (n - 1) / 2));
  for (const i of order) {
    const f = n === 1 ? 0.5 : i / (n - 1);
    const mid = 1 - Math.abs(f - 0.5) * 2; // 1 at the centre leaf, 0 at the edges
    const angle = (f - 0.5) * spread + (rand() - 0.5) * 0.14;
    // Outer leaves sit on longer stalks and are shorter: a real spray splays
    // wide at the twig and the middle leaf reaches furthest.
    const stem = opts.stem * (0.55 + 0.75 * (1 - mid)) * (0.85 + rand() * 0.3);
    const len = opts.len * (0.7 + 0.4 * mid) * (0.86 + rand() * 0.28);
    const s = seat(0, 0, angle, stem);
    out.push(
      leaflet({
        x: s.x,
        y: s.y,
        angle,
        len,
        wid: opts.wid * (0.9 + rand() * 0.2),
        profile: opts.profile,
        veins: opts.veins,
        curl: (rand() - 0.5) * (opts.curl ?? 0.6),
        serrate: opts.serrate ?? 0,
        serrateFreq: opts.serrateFreq ?? 14,
        color: Math.floor(rand() * 3),
        shade: 0.95 + 0.08 * mid,
        stem,
      }),
    );
  }
  return out;
}

/** One palmate leaf (maple/sycamore): rays radiating from a single point. */
function palmateCard(rand, opts) {
  const out = [];
  const rays = opts.rays ?? 5;
  const len = opts.len * (0.9 + rand() * 0.16);
  const lean = (rand() - 0.5) * 0.3;
  const color = Math.floor(rand() * 3);
  for (let i = 0; i < rays; i++) {
    const f = rays === 1 ? 0.5 : i / (rays - 1);
    const angle = (f - 0.5) * 1.85 + lean;
    const mid = 1 - Math.abs(f - 0.5) * 1.9;
    out.push(
      leaflet({
        x: 0,
        y: 0.1,
        angle,
        len: len * (0.6 + 0.44 * Math.max(0, mid)),
        wid: opts.wid * (0.92 + rand() * 0.16),
        profile: 'palmateRay',
        veins: 3,
        curl: (rand() - 0.5) * 0.25,
        serrate: 0.16,
        serrateFreq: 9,
        color,
        shade: 0.96 + 0.07 * Math.max(0, mid),
        stem: i === Math.floor(rays / 2) ? 0.12 : 0,
      }),
    );
  }
  return out;
}

/** A run of thin dark segments tracing a path: the woody twig a strand of
 *  leaves hangs off. The leaflet primitive has a straight axis, so a curved
 *  twig is drawn as a chain of short ones. */
function twigAlong(points, width, shade) {
  const segs = [];
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) continue;
    segs.push(
      leaflet({
        x: points[i].x,
        y: points[i].y,
        // The leaf axis points along (-sin A, cos A), so this aims the segment
        // straight at the next point.
        angle: Math.atan2(-dx, dy),
        len,
        wid: width / len,
        profile: 'needle',
        veins: 0,
        color: 0,
        shade,
        stem: 0,
      }),
    );
  }
  return segs;
}

/** Drooping strands hung from the TOP of the card: willow, wisteria. */
function strandCard(rand, opts) {
  const out = [];
  const strands = opts.strands ?? 3;
  const n = opts.count ?? 9;
  for (let k = 0; k < strands; k++) {
    // Strands hang from different points along the twig and swing apart.
    const rootX = strands === 1 ? 0 : (k / (strands - 1) - 0.5) * 0.36;
    const lean = rootX * 1.4 + (rand() - 0.5) * 0.22;
    const drop = (opts.drop ?? 0.9) * (0.72 + rand() * 0.32);
    const path = (f) => ({
      x: rootX + lean * f * f * 0.7 + Math.sin(f * 3.1 + k) * 0.025,
      y: 1 - f * drop,
    });
    // The twig first, so the leaves paint over where they join it.
    out.push(...twigAlong([0, 0.2, 0.4, 0.6, 0.8, 1].map(path), 0.006, 0.78));
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      const p = path(f);
      const side = i % 2 === 0 ? 1 : -1;
      // Leaves hang off the twig, swinging out and down rather than sticking
      // out sideways: a willow leaf falls under its own weight.
      const angle = side * (2.15 + rand() * 0.35) + lean * 0.6;
      const stem = 0.018;
      const s = seat(p.x, p.y, angle, stem);
      out.push(
        leaflet({
          x: s.x,
          y: s.y,
          angle,
          len: opts.len * (0.82 + rand() * 0.4) * (1 - 0.22 * f),
          wid: opts.wid,
          profile: 'lanceolate',
          veins: 0,
          curl: side * (0.5 + rand() * 0.4),
          color: Math.floor(rand() * 3),
          shade: 0.82 + rand() * 0.32,
          stem,
          stemWidth: 0.005,
        }),
      );
    }
  }
  return out;
}

/** A conifer sprig: needles in pairs along a woody shoot. */
function needleCard(rand, opts) {
  const out = [];
  const rows = opts.rows ?? 14;
  const lean = (rand() - 0.5) * 0.25;
  out.push(
    leaflet({
      x: 0,
      y: 0,
      angle: lean,
      len: 0.9,
      wid: 0.02,
      profile: 'needle',
      veins: 0,
      color: 0,
      shade: 0.8,
      stem: 0,
    }),
  );
  for (let i = 0; i < rows; i++) {
    const f = i / (rows - 1);
    const y = 0.06 + f * 0.84;
    const x = lean * y;
    // Needles sweep further back toward the tip of the shoot.
    const sweep = 0.7 + f * 0.5;
    for (const side of [-1, 1]) {
      out.push(
        leaflet({
          x,
          y,
          angle: side * sweep + lean + (rand() - 0.5) * 0.16,
          len: opts.len * (0.8 + rand() * 0.36) * (1 - 0.3 * f),
          wid: opts.wid,
          profile: 'needle',
          veins: 0,
          curl: -side * 0.25,
          color: Math.floor(rand() * 3),
          shade: 0.78 + rand() * 0.4,
          stem: 0,
        }),
      );
    }
  }
  return out;
}

/** A pinnate frond: leaflets down both sides of a rachis (palm, fern). */
function frondCard(rand, opts) {
  const out = [];
  const rows = opts.rows ?? 11;
  const arc = opts.arc ?? 0.5;
  out.push(
    leaflet({
      x: 0,
      y: 0,
      angle: 0,
      len: 0.95,
      wid: 0.016,
      profile: 'needle',
      veins: 0,
      color: 0,
      shade: 0.8,
      stem: 0,
    }),
  );
  for (let i = 0; i < rows; i++) {
    const f = i / (rows - 1);
    const y = 0.1 + f * 0.82;
    for (const side of [-1, 1]) {
      out.push(
        leaflet({
          x: 0,
          y,
          angle: side * (1.15 - f * arc) + (rand() - 0.5) * 0.1,
          len: opts.len * (0.55 + 0.6 * Math.sin(Math.PI * clamp01(f * 0.9 + 0.08))),
          wid: opts.wid,
          profile: 'pinna',
          veins: 2,
          curl: side * 0.55,
          color: Math.floor(rand() * 3),
          shade: 0.84 + rand() * 0.28,
          stem: 0,
        }),
      );
    }
  }
  return out;
}

/** One to three huge tropical blades, split along their veins. */
function bladeCard(rand, opts) {
  const out = [];
  const n = opts.count ?? 2;
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0.5 : i / (n - 1);
    const angle = (f - 0.5) * 0.95 + (rand() - 0.5) * 0.2;
    const stem = 0.1 + rand() * 0.1;
    const s = seat(0, 0, angle, stem);
    out.push(
      leaflet({
        x: s.x,
        y: s.y,
        angle,
        len: opts.len * (0.82 + rand() * 0.3),
        wid: opts.wid * (0.9 + rand() * 0.2),
        profile: 'blade',
        veins: 9,
        curl: (rand() - 0.5) * 0.5,
        tear: 0.5 + rand() * 0.25,
        tearFreq: 5 + Math.floor(rand() * 4),
        color: Math.floor(rand() * 3),
        shade: 0.85 + rand() * 0.28,
        stem,
        stemWidth: 0.014,
      }),
    );
  }
  return out;
}

/** Acacia/desert spray: tiny paired leaflets on thin twigs, held nearly flat. */
function acaciaCard(rand, opts) {
  const out = [];
  const twigs = opts.twigs ?? 3;
  const per = opts.per ?? 9;
  for (let k = 0; k < twigs; k++) {
    const f = twigs === 1 ? 0.5 : k / (twigs - 1);
    // Held wide and nearly flat: an acacia's crown is a plate, not a plume.
    const twigAngle = (f - 0.5) * 2.3 + (rand() - 0.5) * 0.18;
    const twigLen = opts.twigLen * (0.8 + rand() * 0.36);
    out.push(
      leaflet({
        x: 0,
        y: 0,
        angle: twigAngle,
        len: twigLen,
        wid: 0.012,
        profile: 'needle',
        veins: 0,
        color: 0,
        shade: 0.6,
        stem: 0,
      }),
    );
    for (let i = 0; i < per; i++) {
      const t = 0.16 + (i / (per - 1)) * 0.8;
      const px = Math.sin(twigAngle) * t * twigLen;
      const py = Math.cos(twigAngle) * t * twigLen;
      for (const side of [-1, 1]) {
        out.push(
          leaflet({
            x: px,
            y: py,
            angle: twigAngle + side * 1.18,
            len: opts.len * (0.8 + rand() * 0.4),
            wid: opts.wid,
            profile: 'ovate',
            veins: 0,
            color: Math.floor(rand() * 3),
            shade: 0.8 + rand() * 0.35,
            stem: 0,
          }),
        );
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ the sets
// `biomes` is advisory metadata the Tree panel groups its picker by.

const SETS = [
  {
    key: 'broadleaf',
    label: 'Broadleaf',
    anchor: 'bottom',
    palettes: ['summer', 'spring', 'autumn', 'dark', 'arcane', 'ember'],
    biomes: ['forest', 'standard'],
    seed: 1301,
    card: (rand) =>
      sprigCard(rand, {
        count: [3, 5],
        len: 0.42,
        wid: 0.34,
        stem: 0.12,
        profile: 'ovate',
        veins: 6,
        spread: 1.5,
        curl: 0.7,
        serrate: 0.1,
        serrateFreq: 11,
      }),
  },
  {
    key: 'oak',
    label: 'Oak',
    anchor: 'bottom',
    palettes: ['summer', 'autumn', 'dark'],
    biomes: ['forest', 'standard'],
    seed: 2207,
    card: (rand) =>
      sprigCard(rand, {
        count: [3, 4],
        len: 0.46,
        wid: 0.3,
        stem: 0.13,
        profile: 'lobed',
        veins: 4,
        spread: 1.3,
        curl: 0.5,
      }),
  },
  {
    key: 'birch',
    label: 'Birch',
    anchor: 'bottom',
    palettes: ['summer', 'spring', 'autumn'],
    biomes: ['forest', 'standard'],
    seed: 3391,
    card: (rand) =>
      sprigCard(rand, {
        count: [5, 7],
        len: 0.3,
        wid: 0.36,
        stem: 0.11,
        profile: 'ovate',
        veins: 5,
        spread: 1.9,
        curl: 0.8,
        serrate: 0.2,
        serrateFreq: 16,
      }),
  },
  {
    key: 'maple',
    label: 'Maple',
    anchor: 'bottom',
    palettes: ['summer', 'autumn', 'ember'],
    biomes: ['forest', 'standard'],
    seed: 4457,
    card: (rand) => palmateCard(rand, { rays: 5, len: 0.78, wid: 0.3 }),
  },
  {
    key: 'willow',
    label: 'Willow',
    anchor: 'top',
    palettes: ['summer', 'autumn', 'arcane'],
    biomes: ['forest', 'magic'],
    seed: 5527,
    card: (rand) => strandCard(rand, { strands: 3, count: 9, len: 0.22, wid: 0.16, drop: 0.92 }),
  },
  {
    key: 'needle',
    label: 'Conifer',
    anchor: 'bottom',
    palettes: ['summer', 'dry', 'dark'],
    biomes: ['forest', 'standard', 'dark'],
    seed: 6619,
    card: (rand) => needleCard(rand, { rows: 15, len: 0.24, wid: 0.045 }),
  },
  {
    key: 'frond',
    label: 'Palm frond',
    anchor: 'bottom',
    palettes: ['summer', 'dry'],
    biomes: ['tropical', 'desert'],
    seed: 7717,
    card: (rand) => frondCard(rand, { rows: 12, len: 0.42, wid: 0.11, arc: 0.55 }),
  },
  {
    key: 'jungle',
    label: 'Jungle blade',
    anchor: 'bottom',
    palettes: ['summer', 'spring'],
    biomes: ['tropical'],
    seed: 8821,
    card: (rand) => bladeCard(rand, { count: 2 + Math.floor(rand() * 2), len: 0.6, wid: 0.4 }),
  },
  {
    key: 'acacia',
    label: 'Acacia',
    anchor: 'bottom',
    palettes: ['sage', 'dry'],
    biomes: ['desert'],
    seed: 9923,
    card: (rand) => acaciaCard(rand, { twigs: 4, per: 9, twigLen: 0.5, len: 0.1, wid: 0.26 }),
  },
];

// ------------------------------------------------------------------ renderer

/** Render one atlas (COLS x ROWS cards) into a straight-alpha RGBA buffer. */
function renderAtlas(set, paletteKey) {
  const palette = PALETTES[paletteKey];
  const W = CELL * COLS;
  const H = CELL * ROWS;
  const rgba = new Uint8ClampedArray(W * H * 4);
  const cells = [];
  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      const idx = cy * COLS + cx;
      const rand = rng(set.seed + idx * 7919);
      cells.push({ cx, cy, leaves: fitCard(set.card(rand), set.anchor), seed: set.seed + idx });
    }
  }
  const inv = 1 / (SS * SS);
  for (const cell of cells) {
    const ox = cell.cx * CELL;
    const oy = cell.cy * CELL;
    for (let py = 0; py < CELL; py++) {
      for (let px = 0; px < CELL; px++) {
        let ar = 0;
        let ag = 0;
        let ab = 0;
        let aa = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            // Card space: x in [-0.5, 0.5] left to right, y in [0, 1] BOTTOM up.
            const fx = (px + (sx + 0.5) / SS) / CELL - 0.5;
            const fy = 1 - (py + (sy + 0.5) / SS) / CELL;
            // Front-most leaflet wins (the list is already back to front).
            let hit = null;
            let hitLeaf = null;
            for (const L of cell.leaves) {
              const h = sampleLeaflet(L, fx, fy);
              if (h) {
                hit = h;
                hitLeaf = L;
              }
            }
            if (!hit) continue;
            const [r, g, b] = shadeLeaflet(hitLeaf, hit, palette, cell.seed);
            ar += r;
            ag += g;
            ab += b;
            aa += 1;
          }
        }
        if (aa === 0) continue;
        const o = ((oy + py) * W + ox + px) * 4;
        // Straight alpha: colour is the average of the COVERED samples only, so
        // edge pixels keep full-strength leaf colour and only alpha falls off.
        rgba[o] = ar / aa;
        rgba[o + 1] = ag / aa;
        rgba[o + 2] = ab / aa;
        rgba[o + 3] = aa * inv * 255;
      }
    }
  }
  bleedAlpha(rgba, W, H);
  return { rgba, width: W, height: H };
}

/**
 * Push leaf colour outward into fully transparent pixels. Without this, mip
 * generation averages the black of empty texels into the leaf edge and the
 * canopy grows a dark fringe at distance.
 */
function bleedAlpha(rgba, W, H, passes = 6) {
  const solid = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) solid[i] = rgba[i * 4 + 3] > 0 ? 1 : 0;
  for (let p = 0; p < passes; p++) {
    const next = solid.slice();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (solid[i]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const j = ny * W + nx;
            if (!solid[j]) continue;
            r += rgba[j * 4];
            g += rgba[j * 4 + 1];
            b += rgba[j * 4 + 2];
            n++;
          }
        }
        if (!n) continue;
        rgba[i * 4] = r / n;
        rgba[i * 4 + 1] = g / n;
        rgba[i * 4 + 2] = b / n;
        rgba[i * 4 + 3] = 0; // stays invisible; only the colour bleeds
        next[i] = 1;
      }
    }
    solid.set(next);
  }
}

/** Fraction of texels with alpha above the cutout threshold. */
function coverage(rgba, threshold = 128) {
  let hit = 0;
  const n = rgba.length / 4;
  for (let i = 0; i < n; i++) if (rgba[i * 4 + 3] >= threshold) hit++;
  return hit / n;
}

// --------------------------------------------------------------------- main

async function main() {
  const args = process.argv.slice(2);
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
  const wantPreview = args.includes('--preview');
  await mkdir(OUT_DIR, { recursive: true });

  const entries = [];
  const previewFiles = [];
  for (const set of SETS) {
    if (only && set.key !== only) continue;
    for (const paletteKey of set.palettes) {
      const name = paletteKey === set.palettes[0] ? set.key : `${set.key}_${paletteKey}`;
      const { rgba, width, height } = renderAtlas(set, paletteKey);
      const file = join(OUT_DIR, `${name}.png`);
      await sharp(Buffer.from(rgba.buffer), { raw: { width, height, channels: 4 } })
        .png({ compressionLevel: 9, palette: false })
        .toFile(file);
      previewFiles.push(file);
      const cov = coverage(rgba);
      entries.push({
        key: name,
        label:
          paletteKey === set.palettes[0]
            ? set.label
            : `${set.label} (${PALETTES[paletteKey].label})`,
        shape: set.key,
        palette: paletteKey,
        anchor: set.anchor,
        biomes: set.biomes,
        glow: GLOW_PALETTES.has(paletteKey),
        coverage: Number(cov.toFixed(3)),
      });
      console.log(`  ${name}.png  ${width}x${height}  coverage ${(cov * 100).toFixed(1)}%`);
    }
  }

  if (!only) {
    const lines = entries
      .map(
        (e) =>
          `  {\n    key: '${e.key}',\n    label: '${e.label}',\n    shape: '${e.shape}',\n` +
          `    palette: '${e.palette}',\n    anchor: '${e.anchor}',\n` +
          `    biomes: [${e.biomes.map((b) => `'${b}'`).join(', ')}],\n` +
          `    glow: ${e.glow},\n    coverage: ${e.coverage},\n  },`,
      )
      .join('\n');
    const ts = `// GENERATED by scripts/assets/build_leaf_atlas.mjs - do not edit by hand.
// The painted leaf-card atlases the Tree Generator scatters over its canopy
// volumes. Every sheet is ${COLS}x${ROWS} cards of ${CELL}px. A card's stalk meets the
// anchor edge of its cell at u = 0.5, which is where the leaf quad's pivot
// sits, so leaves swing around their stalk instead of their middle.

export type LeafAnchor = 'bottom' | 'top';

export interface LeafSet {
  /** File key: public/textures/foliage/leaves/<key>.png */
  key: string;
  /** Maker-facing name in the Tree panel. */
  label: string;
  /** Shape family (sets sharing a shape differ only in palette). */
  shape: string;
  palette: string;
  /** Which cell edge the stalk meets: upright sprigs 'bottom', hanging
   *  strands 'top' (the quad is built hanging DOWN from its pivot). */
  anchor: LeafAnchor;
  /** Advisory: which biome groups the picker files this under. */
  biomes: readonly string[];
  /** The bright parts should also drive an emissive map (magic/fire sets). */
  glow: boolean;
  /** Fraction of the sheet that survives the alpha cutout (density tuning). */
  coverage: number;
}

export const LEAF_ATLAS_COLS = ${COLS};
export const LEAF_ATLAS_ROWS = ${ROWS};
export const LEAF_ATLAS_CELLS = ${COLS * ROWS};

export const LEAF_SETS: readonly LeafSet[] = [
${lines}
];

export const DEFAULT_LEAF_SET = '${entries[0]?.key ?? 'broadleaf'}';

export function leafSetPath(key: string): string {
  return \`textures/foliage/leaves/\${key}.png\`;
}

export function leafSet(key: string): LeafSet | null {
  return LEAF_SETS.find((s) => s.key === key) ?? null;
}
`;
    await writeFile(REGISTRY, ts);
    console.log(`\nwrote ${entries.length} atlases + ${REGISTRY.replace(`${ROOT}/`, '')}`);
  }

  if (wantPreview) {
    const TW = 512;
    const TH = 256;
    const cols = 3;
    const rows = Math.ceil(previewFiles.length / cols);
    const comps = [];
    for (let i = 0; i < previewFiles.length; i++) {
      comps.push({
        input: await sharp(previewFiles[i]).resize(TW, TH).toBuffer(),
        left: (i % cols) * TW,
        top: Math.floor(i / cols) * TH,
      });
    }
    await mkdir(join(ROOT, 'tmp'), { recursive: true });
    const out = join(ROOT, 'tmp', 'leaf_preview.png');
    await sharp({
      create: {
        width: cols * TW,
        height: rows * TH,
        channels: 4,
        background: { r: 92, g: 98, b: 106, alpha: 1 },
      },
    })
      .composite(comps)
      .png()
      .toFile(out);
    console.log(`preview: ${out}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
