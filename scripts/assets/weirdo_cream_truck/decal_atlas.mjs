// The Weirdo Cream truck's painted-signage atlas, rastered from pure arithmetic.
//
// Three regions share one square texture (see DECAL_REGIONS): the side banner
// that reads "Weirdo Cream", the driver portrait stamped on the rear shutter,
// and the round cone badge on the nose.
//
// The lettering and the badge are drawn from signed distance fields over
// hand-authored control points: no system font and no SVG rasterizer, because
// the shipped GLB carries a source fingerprint the tests recompute live, and a
// font substitution on another contributor's box would otherwise turn the asset
// red. The PORTRAIT is the one exception: it composites the owner-supplied
// reference photograph (REFERENCE_FACE, committed and fingerprinted, provenance
// in docs/design/weirdo-cream-truck/reference/reference-metadata.json), because
// the brief asked for that face stamped on the truck rather than an
// interpretation of it. Reproducibility survives: the input is a committed file
// and every operation applied to it is a deterministic sharp call.
//
// There is no Math.random anywhere in this module.
//
// Coordinates inside a region are normalized to [0, 1] with y running DOWN, the
// way texture space does, so a region's authored art reads top to bottom.

import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { DECAL_ATLAS_SIZE, DECAL_REGIONS } from './decal_regions.mjs';

/** The owner-supplied portrait stamped on the rear shutter. Committed under
 *  docs/ beside its provenance record, and listed in the asset's source
 *  fingerprint so a swap forces a re-export. */
const REFERENCE_FACE = fileURLToPath(
  new URL('../../../docs/design/weirdo-cream-truck/reference/luffy-face.jpg', import.meta.url),
);

/** Crop taken from the 903x762 source: a near-square window around the head,
 *  trimming the dark margins without clipping the hair. */
const FACE_CROP = Object.freeze({ left: 55, top: 15, width: 790, height: 747 });

/** Fraction of the portrait region's width the photo disc occupies. Matches the
 *  innermost badge ring in portraitLayers, so the photo sits inside the plate
 *  rather than overlapping its keyline. */
const FACE_DISC_FRACTION = 0.385;

/** How much of the disc the photograph itself fills. Below 1 on purpose: the
 *  head fills its source frame corner to corner, so scaling it to the disc's
 *  full width would push the hair outside the circle and the mask would shear it
 *  off at the temples. Fitting it inside a smaller box leaves the whole head
 *  within the plate. */
const FACE_FILL = 0.9;

export { DECAL_ATLAS_SIZE, DECAL_REGIONS };

/** Webp quality for the atlas. High: this is signage read at close range, and
 *  ringing around the lettering is the first thing that reads as cheap. */
const ATLAS_QUALITY = 92;

const PALETTE = Object.freeze({
  // The truck's own cream, so an untextured seam beside a decal disappears.
  cream: [0xf4, 0xec, 0xdc],
  creamShade: [0xdf, 0xd2, 0xba],
  mint: [0x8f, 0xcf, 0xc8],
  mintDeep: [0x4f, 0x9a, 0x96],
  cocoa: [0x4a, 0x33, 0x28],
  cocoaSoft: [0x6d, 0x4c, 0x3a],
  strawberry: [0xe8, 0x7f, 0x9c],
  cone: [0xd9, 0xa5, 0x5c],
  coneShade: [0xb8, 0x83, 0x40],
  // Portrait palette, sampled off the reference close-up: a bright yellow-green
  // skin that lifts toward the centre of the face, hot pink-red hair, dark olive
  // eyes with no catchlight, and the periwinkle robe at the collar.
  skin: [0x9f, 0xe0, 0x3d],
  skinShade: [0x6f, 0xb8, 0x28],
  skinLight: [0xc6, 0xef, 0x60],
  hair: [0xf5, 0x45, 0x62],
  hairShade: [0xc9, 0x33, 0x4a],
  eye: [0x59, 0x5f, 0x4d],
  robe: [0x6c, 0x7c, 0xd8],
  robeShade: [0x4d, 0x59, 0xa8],
  tusk: [0xf6, 0xf2, 0xe4],
});

// ---------------------------------------------------------------------------
// Signed distance fields. Every shape returns yards-free normalized distance in
// region space; negative is inside.
// ---------------------------------------------------------------------------

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

function sdEllipse(px, py, cx, cy, rx, ry) {
  // Cheap normalized-gradient approximation: exact enough for painted art and
  // free of the iterative solve a true ellipse SDF needs.
  const dx = (px - cx) / rx;
  const dy = (py - cy) / ry;
  const k = Math.hypot(dx, dy);
  return (k - 1) * Math.min(rx, ry);
}

function sdSegment(px, py, ax, ay, bx, by, halfWidth) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const lengthSq = abx * abx + aby * aby;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / lengthSq));
  return Math.hypot(apx - abx * t, apy - aby * t) - halfWidth;
}

function sdRoundedBox(px, py, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(px - cx) - (halfW - radius);
  const dy = Math.abs(py - cy) - (halfH - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

/** Union of a polyline's capsules: the one primitive every glyph is built of. */
function sdPolyline(px, py, points, halfWidth) {
  let best = Infinity;
  for (let index = 0; index + 1 < points.length; index++) {
    const [ax, ay] = points[index];
    const [bx, by] = points[index + 1];
    const distance = sdSegment(px, py, ax, ay, bx, by, halfWidth);
    if (distance < best) best = distance;
  }
  return best;
}

/** Sample an arc into a polyline. Angles in degrees, y DOWN, so a positive
 *  sweep runs clockwise on screen. */
function arcPoints(cx, cy, r, fromDeg, toDeg, segments = 24) {
  const points = [];
  for (let index = 0; index <= segments; index++) {
    const angle = ((fromDeg + ((toDeg - fromDeg) * index) / segments) * Math.PI) / 180;
    points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }
  return points;
}

// ---------------------------------------------------------------------------
// The hand-authored signage face.
//
// Each glyph is a list of polylines on a box whose baseline is y = 0 and whose
// cap height is 1, with y UP (flipped into region space by the layout below).
// x-height is 0.62. Strokes are rendered as round-capped capsules, which is what
// gives the letters their hand-painted, brush-stroke read.
// ---------------------------------------------------------------------------

const X_HEIGHT = 0.62;

/** Bowl of a lowercase round letter, shared by e/o/d/a. */
function bowl(cx, cy, r) {
  return arcPoints(cx, cy, r, 0, 360, 32);
}

const GLYPHS = Object.freeze({
  W: {
    advance: 1.06,
    strokes: [
      [
        [0, 1],
        [0.2, 0],
        [0.475, 0.66],
        [0.75, 0],
        [0.95, 1],
      ],
    ],
  },
  C: {
    advance: 1.0,
    // y is flipped at layout time, so the sweep is authored in maths-space.
    strokes: [arcPoints(0.47, 0.5, 0.44, 52, 308, 34)],
  },
  e: {
    advance: 0.72,
    strokes: [
      arcPoints(0.33, X_HEIGHT / 2, 0.31, 12, 340, 32),
      [
        [0.03, X_HEIGHT / 2],
        [0.63, X_HEIGHT / 2],
      ],
    ],
  },
  i: {
    advance: 0.3,
    strokes: [
      [
        [0.11, 0],
        [0.11, X_HEIGHT],
      ],
      bowl(0.11, 0.83, 0.045),
    ],
  },
  r: {
    advance: 0.56,
    strokes: [
      [
        [0.11, 0],
        [0.11, X_HEIGHT],
      ],
      arcPoints(0.37, 0.4, 0.26, 180, 62, 16),
    ],
  },
  d: {
    advance: 0.76,
    strokes: [
      bowl(0.32, X_HEIGHT / 2, 0.31),
      [
        [0.63, 0],
        [0.63, 1.0],
      ],
    ],
  },
  o: {
    advance: 0.73,
    strokes: [bowl(0.33, X_HEIGHT / 2, 0.31)],
  },
  a: {
    advance: 0.76,
    strokes: [
      bowl(0.32, X_HEIGHT / 2, 0.31),
      [
        [0.63, 0],
        [0.63, X_HEIGHT],
      ],
    ],
  },
  m: {
    advance: 1.24,
    strokes: [
      [
        [0.09, 0],
        [0.09, X_HEIGHT],
      ],
      arcPoints(0.34, 0.37, 0.25, 180, 0, 18),
      [
        [0.59, 0],
        [0.59, 0.37],
      ],
      arcPoints(0.84, 0.37, 0.25, 180, 0, 18),
      [
        [1.09, 0],
        [1.09, 0.37],
      ],
    ],
  },
  ' ': { advance: 0.42, strokes: [] },
});

/** Total advance of a string in em units, for centering. */
function measureText(text) {
  let width = 0;
  for (const character of text) {
    const glyph = GLYPHS[character];
    if (!glyph) throw new Error(`weirdo cream signage has no glyph for "${character}"`);
    width += glyph.advance;
  }
  return width;
}

/**
 * Lay a string out into region-space polylines.
 *
 * `em` is the cap height in region units and `baseline` the baseline's v, so a
 * caller positions text the way a sign painter would rather than by bounding
 * box. Glyph y is flipped here (glyph space is y-up, region space y-down).
 *
 * Coordinates are the painter's ASPECT SPACE (see paintRegion): x runs 0 to the
 * region's aspect ratio while y stays 0 to 1, which makes the space isotropic,
 * so a round letter comes out round on the 2:1 banner instead of stretched.
 */
function layoutText(text, { em, baseline, centerX, slant = 0 }) {
  const width = measureText(text) * em;
  let penX = centerX - width / 2;
  const strokes = [];
  for (const character of text) {
    const glyph = GLYPHS[character];
    for (const stroke of glyph.strokes) {
      strokes.push(
        stroke.map(([gx, gy]) => [penX + gx * em + gy * em * slant, baseline - gy * em]),
      );
    }
    penX += glyph.advance * em;
  }
  return strokes;
}

// ---------------------------------------------------------------------------
// Region painters. Each returns a list of layers evaluated in order; a layer is
// { sdf, color, softness } and the painter alpha-composites coverage over the
// accumulating pixel.
// ---------------------------------------------------------------------------

function bannerLayers(aspect) {
  const layers = [];
  const text = 'Weirdo Cream';
  // Cap height as a fraction of the panel height, then centred on the panel.
  // "Weirdo Cream" measures 8.83 em, so 0.19 leaves a margin either side of the
  // 2.0-wide panel for the sprinkles without crowding the keyline.
  const em = 0.19;
  const baseline = 0.63;
  const centerX = aspect / 2;

  // Painted ground: a cream field with a rounded mint keyline, so the decal
  // reads as a sign panel screwed to the body rather than a floating sticker.
  layers.push({ sdf: () => -1, color: PALETTE.cream });
  layers.push({
    sdf: (x, y) => sdRoundedBox(x, y, centerX, 0.5, centerX - 0.02, 0.47, 0.15),
    color: PALETTE.mint,
  });
  layers.push({
    sdf: (x, y) => sdRoundedBox(x, y, centerX, 0.5, centerX - 0.042, 0.448, 0.135),
    color: PALETTE.cream,
  });

  // The lettering: a cocoa drop shadow under a strawberry face, the two-pass
  // trick that makes painted signage pop at grazing angles.
  const strokes = layoutText(text, { em, baseline, centerX, slant: 0.06 });
  const textSpan = measureText(text) * em;

  // Sprinkle confetti in the margins the lettering leaves, placed by hand so the
  // spacing reads deliberate. Each is a short capsule at its own angle.
  const marginX = (aspect - textSpan) / 2;
  const sprinkles = [
    [marginX * 0.45, 0.24, 28, PALETTE.strawberry],
    [marginX * 0.6, 0.74, -40, PALETTE.mintDeep],
    [aspect - marginX * 0.45, 0.26, -22, PALETTE.mintDeep],
    [aspect - marginX * 0.62, 0.76, 44, PALETTE.strawberry],
    [centerX - textSpan * 0.22, 0.13, 12, PALETTE.strawberry],
    [centerX + textSpan * 0.26, 0.86, -14, PALETTE.mintDeep],
    [centerX + textSpan * 0.3, 0.12, 33, PALETTE.mintDeep],
  ];
  for (const [x, y, degrees, color] of sprinkles) {
    const radians = (degrees * Math.PI) / 180;
    const dx = Math.cos(radians) * 0.028;
    const dy = Math.sin(radians) * 0.028;
    layers.push({
      sdf: (px, py) => sdSegment(px, py, x - dx, y - dy, x + dx, y + dy, 0.011),
      color,
    });
  }

  // Stroke weights are fractions of the cap height, so retuning `em` keeps the
  // letterforms' proportions rather than fattening or starving them.
  const face = em * 0.115;
  const shadow = strokes.map((stroke) => stroke.map(([x, y]) => [x + em * 0.04, y + em * 0.05]));
  layers.push({
    sdf: (x, y) => Math.min(...shadow.map((stroke) => sdPolyline(x, y, stroke, face))),
    color: PALETTE.cocoa,
  });
  layers.push({
    sdf: (x, y) => Math.min(...strokes.map((stroke) => sdPolyline(x, y, stroke, face))),
    color: PALETTE.strawberry,
  });
  layers.push({
    sdf: (x, y) => Math.min(...strokes.map((stroke) => sdPolyline(x, y, stroke, face * 0.42))),
    color: PALETTE.cream,
  });
  return layers;
}

/**
 * The portrait's badge plate: the rings the photograph is then stamped into.
 *
 * Only the surround is drawn here. The face itself is the owner-supplied
 * photograph, composited over this plate by stampPortraitPhoto once the vector
 * layers are down, so the plate is what shows through wherever the photo is
 * keyed away (its black screen background) or falls outside the disc.
 */
function portraitLayers() {
  const layers = [];
  layers.push({ sdf: () => -1, color: PALETTE.cream });
  layers.push({ sdf: (u, v) => sdCircle(u, v, 0.5, 0.5, 0.465), color: PALETTE.cocoa });
  layers.push({ sdf: (u, v) => sdCircle(u, v, 0.5, 0.5, 0.44), color: PALETTE.mint });
  layers.push({ sdf: (u, v) => sdCircle(u, v, 0.5, 0.5, 0.405), color: PALETTE.cream });
  return layers;
}

/**
 * Composite the reference photograph into the portrait region.
 *
 * Three things happen to the source, all deterministic:
 *
 *  - A light blur before the downscale. The photo was taken of a display, so it
 *    carries panel moire that would otherwise alias into hard bands at atlas
 *    resolution; blurring first puts that energy above the sampling limit.
 *  - A soft black key. The subject was shot against a dark screen, and the
 *    corners of the disc would read as black wedges around the hair. Rather than
 *    a hard threshold (which frays on a noisy photo), pixels fade toward the
 *    plate cream across a luma band, so the background dissolves into the badge.
 *  - A soft-edged circular mask, so the photo ends on the plate's inner ring
 *    instead of on a visible square edge.
 */
async function stampPortraitPhoto(pixels, size) {
  const region = DECAL_REGIONS.portrait;
  const x0 = Math.round(region.u0 * size);
  const y0 = Math.round(region.v0 * size);
  const width = Math.round((region.u1 - region.u0) * size);
  const height = Math.round((region.v1 - region.v0) * size);
  const disc = Math.round(width * FACE_DISC_FRACTION * 2);
  // Fit the whole head inside the disc (aspect preserved), then centre it on a
  // black field. The black is not a hack: it matches the screen background the
  // photo already carries, and the key below dissolves both together.
  const inner = Math.round(disc * FACE_FILL);
  const fitted = await sharp(REFERENCE_FACE)
    .extract(FACE_CROP)
    .blur(1.1)
    .resize(inner, inner, { fit: 'inside', kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .toBuffer();
  // Take the channel count from sharp rather than assuming three: compositing
  // onto a created image can promote the pipeline to RGBA, and indexing a
  // 4-channel buffer with a stride of 3 shears every row against the next.
  const { data, info } = await sharp({
    create: { width: disc, height: disc, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite([{ input: fitted, gravity: 'centre' }])
    .raw()
    .toBuffer({ resolveWithObject: true });
  const stride = info.channels;

  // Luma band the screen background fades out across.
  const KEY_LOW = 26;
  const KEY_HIGH = 82;
  const radius = disc / 2;
  const centerX = x0 + width / 2;
  const centerY = y0 + height / 2;
  const left = Math.round(centerX - radius);
  const top = Math.round(centerY - radius);

  for (let y = 0; y < disc; y++) {
    for (let x = 0; x < disc; x++) {
      const dx = x - radius + 0.5;
      const dy = y - radius + 0.5;
      // One-pixel feather on the disc edge.
      const edge = Math.max(0, Math.min(1, radius - Math.hypot(dx, dy)));
      if (edge <= 0) continue;
      const source = (y * disc + x) * stride;
      const r = data[source];
      const g = data[source + 1];
      const b = data[source + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const keyed = Math.max(0, Math.min(1, (luma - KEY_LOW) / (KEY_HIGH - KEY_LOW)));
      const alpha = edge * keyed;
      if (alpha <= 0) continue;
      const destX = left + x;
      const destY = top + y;
      if (destX < x0 || destX >= x0 + width || destY < y0 || destY >= y0 + height) continue;
      const dest = (destY * size + destX) * 3;
      pixels[dest] = Math.round(pixels[dest] + (r - pixels[dest]) * alpha);
      pixels[dest + 1] = Math.round(pixels[dest + 1] + (g - pixels[dest + 1]) * alpha);
      pixels[dest + 2] = Math.round(pixels[dest + 2] + (b - pixels[dest + 2]) * alpha);
    }
  }
}

/** The nose badge: a cone emblem inside a ring. */
function badgeLayers() {
  const layers = [];
  layers.push({ sdf: () => -1, color: PALETTE.cream });
  layers.push({ sdf: (u, v) => sdCircle(u, v, 0.5, 0.5, 0.47), color: PALETTE.cocoa });
  layers.push({ sdf: (u, v) => sdCircle(u, v, 0.5, 0.5, 0.445), color: PALETTE.cream });
  layers.push({ sdf: (u, v) => sdCircle(u, v, 0.5, 0.5, 0.415), color: PALETTE.mint });
  layers.push({ sdf: (u, v) => sdCircle(u, v, 0.5, 0.5, 0.385), color: PALETTE.cream });

  // Waffle cone: a tapered body with a lattice scored across it.
  layers.push({
    sdf: (u, v) =>
      sdPolyline(
        u,
        v,
        [
          [0.5, 0.86],
          [0.5, 0.56],
        ],
        0.0,
      ) -
      (0.16 * (0.86 - Math.min(0.86, Math.max(0.56, v)))) / 0.3,
    color: PALETTE.cone,
  });
  for (let index = -3; index <= 3; index++) {
    const offset = index * 0.055;
    layers.push({
      sdf: (u, v) =>
        Math.max(
          sdSegment(u, v, 0.34 + offset, 0.54, 0.5 + offset, 0.88, 0.006),
          sdPolyline(
            u,
            v,
            [
              [0.5, 0.86],
              [0.5, 0.56],
            ],
            0.0,
          ) -
            (0.16 * (0.86 - Math.min(0.86, Math.max(0.56, v)))) / 0.3,
        ),
      color: PALETTE.coneShade,
    });
    layers.push({
      sdf: (u, v) =>
        Math.max(
          sdSegment(u, v, 0.66 - offset, 0.54, 0.5 - offset, 0.88, 0.006),
          sdPolyline(
            u,
            v,
            [
              [0.5, 0.86],
              [0.5, 0.56],
            ],
            0.0,
          ) -
            (0.16 * (0.86 - Math.min(0.86, Math.max(0.56, v)))) / 0.3,
        ),
      color: PALETTE.coneShade,
    });
  }

  // Two scoops and a cherry.
  layers.push({ sdf: (u, v) => sdCircle(u, v, 0.415, 0.5, 0.115), color: PALETTE.mintDeep });
  layers.push({ sdf: (u, v) => sdCircle(u, v, 0.4, 0.485, 0.095), color: PALETTE.mint });
  layers.push({ sdf: (u, v) => sdCircle(u, v, 0.585, 0.5, 0.115), color: PALETTE.creamShade });
  layers.push({ sdf: (u, v) => sdCircle(u, v, 0.6, 0.485, 0.095), color: PALETTE.strawberry });
  layers.push({ sdf: (u, v) => sdCircle(u, v, 0.5, 0.405, 0.125), color: PALETTE.creamShade });
  layers.push({ sdf: (u, v) => sdCircle(u, v, 0.492, 0.392, 0.105), color: PALETTE.cream });
  layers.push({ sdf: (u, v) => sdCircle(u, v, 0.5, 0.275, 0.045), color: PALETTE.strawberry });
  layers.push({
    sdf: (u, v) => sdSegment(u, v, 0.5, 0.24, 0.545, 0.19, 0.009),
    color: PALETTE.cocoaSoft,
  });
  return layers;
}

// ---------------------------------------------------------------------------
// Raster
// ---------------------------------------------------------------------------

/**
 * Paint one region's layers into the atlas buffer.
 *
 * Layers are evaluated in ASPECT SPACE: y stays 0 to 1 and x runs 0 to the
 * region's width/height ratio, which makes one unit the same number of pixels on
 * both axes. Square regions get aspect 1 and read as plain UVs; the 2:1 banner
 * gets 2, so its circles and round stroke caps stay circular.
 */
function paintRegion(pixels, size, region, buildLayers) {
  const x0 = Math.round(region.u0 * size);
  const y0 = Math.round(region.v0 * size);
  const x1 = Math.round(region.u1 * size);
  const y1 = Math.round(region.v1 * size);
  const width = x1 - x0;
  const height = y1 - y0;
  const aspect = width / height;
  const layers = buildLayers(aspect);
  // One pixel expressed in region units: the antialiasing band width.
  const texel = 1 / Math.min(width, height);
  for (let y = y0; y < y1; y++) {
    const v = (y - y0 + 0.5) / height;
    for (let x = x0; x < x1; x++) {
      const u = ((x - x0 + 0.5) / width) * aspect;
      let r = 0;
      let g = 0;
      let b = 0;
      for (const layer of layers) {
        const distance = layer.sdf(u, v);
        const band = texel * (layer.softness ?? 1);
        const coverage = Math.max(0, Math.min(1, 0.5 - distance / band));
        if (coverage <= 0) continue;
        r += (layer.color[0] - r) * coverage;
        g += (layer.color[1] - g) * coverage;
        b += (layer.color[2] - b) * coverage;
      }
      const offset = (y * size + x) * 3;
      pixels[offset] = Math.round(Math.max(0, Math.min(255, r)));
      pixels[offset + 1] = Math.round(Math.max(0, Math.min(255, g)));
      pixels[offset + 2] = Math.round(Math.max(0, Math.min(255, b)));
    }
  }
}

/** Build the signage atlas as webp bytes plus the raw field, for previews. */
export async function buildDecalAtlas(size = DECAL_ATLAS_SIZE) {
  const pixels = new Uint8Array(size * size * 3);
  paintRegion(pixels, size, DECAL_REGIONS.banner, bannerLayers);
  paintRegion(pixels, size, DECAL_REGIONS.portrait, portraitLayers);
  paintRegion(pixels, size, DECAL_REGIONS.badge, badgeLayers);
  await stampPortraitPhoto(pixels, size);
  const webp = await sharp(pixels, { raw: { width: size, height: size, channels: 3 } })
    .webp({ quality: ATLAS_QUALITY, effort: 6 })
    .toBuffer();
  return { size, pixels, webp };
}
