// Pure helpers for the painted (LDR) sky KTX2 conversion (scripts/assets/
// compress_sky_ldr.mjs) and its guard suites (tests/sky_ldr_compression_core.test.ts,
// tests/sky_ktx2_assets.test.ts). No sharp or child_process imports here: the tests
// import this module directly, so it must stay light. Pixel buffers are plain typed
// arrays, row-major, TOP row first, channels interleaved.
import path from 'node:path';

/**
 * The painted equirect skies under skies_in/ that src/render/sky.ts references, and
 * the variants each one ships. The DAY sky is the dome alone: a clear painted base the
 * painted cloud layer drifts over (src/render/sky_clouds_core.ts). The IBL is prefiltered
 * from the ENV sky, the day sky as first painted with its big clouds, so the scene's
 * ambient light carries the cloud cover the dome shows (the clear base alone lights the
 * world twice as blue). The NIGHT sky is a dome-only layer (the night IBL stays the day
 * env darkened by the cycle), so a 512 of it would be bytes nothing reads.
 * Restated rather than derived because the encoder is a plain Node script and cannot
 * import the TypeScript tables; tests/sky_ktx2_assets.test.ts pins this list against
 * the urls sky.ts asks for, in both directions.
 */
export const SKY_LDR_SOURCES = [
  { stem: 'vale_painted_day', variants: ['2k', '1k'] },
  { stem: 'vale_painted_env', variants: ['512'] },
  // The night's painted stars are removed (removePointStarsInPlace): a painted star is a
  // few source pixels, which the dome magnifies to a soft four-pixel blob, so the dome's
  // own procedural painted stars (crisp at any resolution) carry them instead, at the
  // density the painter used, which the night carries in its alpha (starDensityAlpha).
  { stem: 'vale_painted_night', variants: ['2k', '1k'], removeStars: true },
];

export const SKY_LDR_STEMS = SKY_LDR_SOURCES.map((source) => source.stem);

/** Pixel width of each variant: the two dome tiers sky.ts picks between (BIOME_SKY_2K
 *  on the full tier, BIOME_SKY_1K on the lite one) and the 512 PMREM source, whose
 *  width is the one cubeUV size a session prefilters at (sky.ts ENV_HDRI_WIDTH). */
export const SKY_LDR_VARIANT_WIDTH = { '2k': 2048, '1k': 1024, 512: 512 };

/** Azimuth each side of the u = 0 / u = 1 seam the wrap blend spans, in degrees. */
export const WRAP_BLEND_DEG = 6;
/** Angular radius of the zenith cap filled toward one colour, in degrees. The fill is
 *  half strength at half this radius; 15 clears the painted skies' pinch and the
 *  radial streaks around it, measured on a looking-up projection of both paintings. */
export const POLE_FILL_DEG = 15;
/** Angular radius of the top rows averaged for that zenith colour, in degrees. */
export const POLE_SAMPLE_DEG = 3;

/** UASTC level; 3 measured identical to 2 on the painted skies (49.7 against 49.6 dB). */
export const SKY_LDR_UASTC_QUALITY = 2;
/**
 * UASTC rate-distortion settings: lambda 1 with the smooth-block guard raised (block
 * error scale 100, smooth deviation 64, from the defaults 10 and 18), so the RDO spends
 * its savings on the brushy cloud blocks and leaves the smooth sky gradient alone.
 * Measured on a 2048x1024 zenith-to-horizon test gradient: largest vertical step 4 LSB
 * (no RDO: 3, plain lambda 0.5: 5), 1.9 percent of steps at 2 LSB or more; on the
 * painted day 2k: 1.23 MB at 48.9 dB, against 1.64 MB at 49.6 dB without RDO.
 */
export const SKY_LDR_RDO = { lambda: 1, smoothBlockScale: 100, smoothBlockStdDev: 64 };
/** Zstandard level, matching the other KTX2 pipelines (`--zstd 18`). */
export const SKY_LDR_ZSTD_LEVEL = 18;

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const smoothstep01 = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

/** The exact 2:1 equirect size of one variant. */
export function equirectSize(variant) {
  const width = SKY_LDR_VARIANT_WIDTH[variant];
  if (!width) throw new Error(`unknown sky variant: ${variant}`);
  return { width, height: width / 2 };
}

/**
 * The resize one variant takes from its source. A painted panorama spans 360 by 180
 * degrees whatever its pixel aspect, so a source that is not 2:1 is STRETCHED to fill,
 * never cropped (a crop would cut sky off a pole or off the seam). `aspectError` is the
 * source's departure from 2:1 (0 for an exact source), which the script reports so a
 * badly framed source is visible in the run log rather than silently squashed.
 */
export function equirectResizePlan(srcWidth, srcHeight, variant) {
  if (!Number.isInteger(srcWidth) || !Number.isInteger(srcHeight)) {
    throw new Error(`unreadable source dimensions ${srcWidth}x${srcHeight}`);
  }
  if (srcWidth <= 0 || srcHeight <= 0) {
    throw new Error(`unreadable source dimensions ${srcWidth}x${srcHeight}`);
  }
  const { width, height } = equirectSize(variant);
  return {
    width,
    height,
    scaleX: width / srcWidth,
    scaleY: height / srcHeight,
    aspectError: srcWidth / srcHeight / 2 - 1,
  };
}

/** Pixels the wrap blend spans at a given width (at least two, at most half). */
export function wrapBandPx(width) {
  return Math.min(Math.floor(width / 2), Math.max(2, Math.round((width * WRAP_BLEND_DEG) / 360)));
}

/** Rows the zenith fill spans at a given height. */
export function poleFillRows(height) {
  return Math.min(height, Math.max(2, Math.round((height * POLE_FILL_DEG) / 180)));
}

/** Rows averaged for the zenith colour at a given height. */
export function poleSampleRows(height) {
  return Math.min(height, Math.max(1, Math.round((height * POLE_SAMPLE_DEG) / 180)));
}

/** IEC 61966-2-1 decode of one 8-bit sRGB value to linear light. */
export function srgbByteToLinear(value) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** The matching encode, rounded to the nearest byte. Every byte survives the round
 *  trip through srgbByteToLinear unchanged, so untouched pixels stay bit-exact. */
export function linearToSrgbByte(value) {
  const c = clamp01(value);
  const encoded = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(clamp01(encoded) * 255);
}

const SRGB_TO_LINEAR = Float64Array.from({ length: 256 }, (_, i) => srgbByteToLinear(i));

/** Decode an 8-bit sRGB buffer to linear light (a new Float64Array). */
export function decodeSrgb(bytes) {
  const out = new Float64Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = SRGB_TO_LINEAR[bytes[i]];
  return out;
}

/** Encode a linear buffer back to 8-bit sRGB (a new Uint8Array). */
export function encodeSrgb(linear) {
  const out = new Uint8Array(linear.length);
  for (let i = 0; i < linear.length; i++) out[i] = linearToSrgbByte(linear[i]);
  return out;
}

/** Weight the wrap blend gives column k of a band: 1 at the seam (k = 0), easing to 0
 *  at the band's inner edge with zero slope there, so the blend has no visible start. */
export function wrapBlendWeight(k, band) {
  if (band <= 0) return 0;
  return 1 - smoothstep01(k / band);
}

/**
 * Make the equirect wrap with no seam line: a mirror crossfade over `bandPx` columns
 * each side of u = 0. Column k from the left edge and column k from the right edge (the
 * two texels k away from the seam on either side of it) move toward their mean by
 * wrapBlendWeight(k): at the seam both edge columns BECOME that mean, so bilinear
 * filtering across u = 1 to u = 0 meets one colour, and past the band nothing changes.
 * The near-seam strip mirrors softly about the seam, which a few degrees of soft painted
 * cloud never shows; a colour step at the edges is spread across both bands instead.
 * Mutates `px` (linear light) and returns it.
 */
export function wrapBlendInPlace(px, width, height, channels, bandPx) {
  const band = Math.min(Math.floor(bandPx), Math.floor(width / 2));
  if (band <= 0) return px;
  for (let y = 0; y < height; y++) {
    const row = y * width * channels;
    for (let k = 0; k < band; k++) {
      const w = wrapBlendWeight(k, band);
      if (w <= 0) continue;
      const left = row + k * channels;
      const right = row + (width - 1 - k) * channels;
      for (let c = 0; c < channels; c++) {
        const a = px[left + c];
        const b = px[right + c];
        const mean = (a + b) * 0.5;
        px[left + c] = a + (mean - a) * w;
        px[right + c] = b + (mean - b) * w;
      }
    }
  }
  return px;
}

/**
 * Fill the zenith cap toward one colour so the pole does not pinch. Each equirect row
 * is one ring of the sky and the top row is a single point, so colour that varies along
 * the top rows converges into a star of streaks at the zenith. The zenith colour is the
 * mean of the top `sampleRows` rows, each row weighted by its ring's solid angle
 * (sin of its polar angle); row y then blends toward it by 1 - smoothstep(y / fillRows):
 * wholly on the top row, not at all from `fillRows` down. Mutates `px` (linear light)
 * and returns the zenith colour.
 */
export function poleFillInPlace(px, width, height, channels, fillRows, sampleRows) {
  const rows = Math.min(height, Math.max(1, Math.floor(sampleRows)));
  const zenith = new Array(channels).fill(0);
  let weight = 0;
  for (let y = 0; y < rows; y++) {
    const ring = Math.sin(((y + 0.5) / height) * Math.PI);
    const row = y * width * channels;
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) zenith[c] += px[row + x * channels + c] * ring;
    }
    weight += ring * width;
  }
  for (let c = 0; c < channels; c++) zenith[c] /= weight;
  const fill = Math.min(height, Math.max(0, Math.floor(fillRows)));
  for (let y = 0; y < fill; y++) {
    const w = 1 - smoothstep01(y / fill);
    if (w <= 0) continue;
    const row = y * width * channels;
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        const i = row + x * channels + c;
        px[i] += (zenith[c] - px[i]) * w;
      }
    }
  }
  return zenith;
}

/**
 * Reverse the row order in place, so the buffer runs bottom row first. three uploads a
 * compressed texture with its FIRST row at v = 0 and ignores flipY for it, while the
 * dome samples the zenith at v = 1, so the flip is baked here or the sky draws upside
 * down (the HDR twin bakes the same flip with basisu `-y_flip`). Returns `px`.
 */
export function flipRowsInPlace(px, width, height, channels) {
  const stride = width * channels;
  const scratch = new px.constructor(stride);
  for (let top = 0, bottom = height - 1; top < bottom; top++, bottom--) {
    const a = top * stride;
    const b = bottom * stride;
    scratch.set(px.subarray(a, a + stride));
    px.copyWithin(a, b, b + stride);
    px.set(scratch, b);
  }
  return px;
}

/**
 * The u (0 to 1, at a texel centre) of the brightest stretch of the band `loDeg` to
 * `hiDeg` above the horizon: the painted sun or moonlit glow sky.ts turns to its anchor
 * (HDRI_SUN_U, PAINTED_NIGHT_GLOW_U). The horizon is the image's middle row; each
 * column's mean luminance over the band is box-smoothed over `smoothFrac` of the width,
 * wrapping across the seam, and the first maximum wins. `px` is linear light, top row
 * first.
 */
export function measureGlowU(px, width, height, channels, opts = {}) {
  const { loDeg = 1, hiDeg = 12, smoothFrac = 0.04 } = opts;
  const y0 = Math.max(0, Math.round(height / 2 - (hiDeg / 180) * height));
  const y1 = Math.min(height, Math.max(y0 + 1, Math.round(height / 2 - (loDeg / 180) * height)));
  const column = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = y0; y < y1; y++) {
      const i = (y * width + x) * channels;
      sum += channels >= 3 ? 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2] : px[i];
    }
    column[x] = sum / (y1 - y0);
  }
  const radius = Math.max(0, Math.round(width * smoothFrac));
  let best = -Infinity;
  let bestX = 0;
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += column[(((x + k) % width) + width) % width];
    if (sum > best) {
      best = sum;
      bestX = x;
    }
  }
  return (bestX + 0.5) / width;
}

/** Star removal radius in pixels at the 2k variant; it scales with the variant width. */
export const STAR_REMOVE_RADIUS_AT_2K = 3;

/** Linear-luminance excess over the opened background where a point is fully removed
 * (above the high edge) or kept (below the low edge), with a smooth ramp between. */
export const STAR_REMOVE_EXCESS = [0.012, 0.05];

/**
 * The BIG painted stars (four-point twinkles with a soft glow and long thin arms): a
 * peak at or above BIG_STAR_PEAK linear luminance, isolated on a ring of
 * BIG_STAR_RING_AT_2K pixels, loses a glow disk of BIG_STAR_GLOW_AT_2K pixels and each
 * arm out to BIG_STAR_ARM_AT_2K pixels. All three distances scale with the variant.
 */
export const BIG_STAR_PEAK = 0.8;
export const BIG_STAR_GLOW_AT_2K = 11;
export const BIG_STAR_RING_AT_2K = 18;
export const BIG_STAR_ARM_AT_2K = 70;

/**
 * The star density the night carries in its ALPHA channel for the dome's procedural
 * painted stars (src/render/sky_painted_stars_glsl.ts): the removed stars, counted at
 * their centres, blurred over STAR_DENSITY_BLUR_DEG of sky and normalized so the
 * STAR_DENSITY_PERCENTILE of the map reads 1. So the procedural field is densest where
 * the painter put the most stars (the milky band) and empty where they put none (the
 * clouds, the horizon haze).
 */
export const STAR_DENSITY_BLUR_DEG = 4;
export const STAR_DENSITY_PERCENTILE = 0.98;

/**
 * The "brush edge" boost every dome variant gets before encode, so the clouds and the
 * milky glow read crisper under the dome's roughly fourfold magnification without
 * losing the painted look: a band-pass of the luminance (a fine Gaussian minus a coarse
 * one, sigmas in VARIANT pixels) added back `amount` times, in a square-root (roughly
 * perceptual) luminance domain and applied to RGB as a ratio, so hue is kept and dark
 * night tones are not crushed. Differences under `threshold` (the same domain) are
 * left alone with a soft knee, so smooth gradients and faint grain are not amplified.
 * The PMREM source is not sharpened: the prefilter blurs it anyway. Measured at 2k: the
 * day grows 2.5 percent on disk, the night about 1 percent.
 */
export const SKY_SHARPEN = { fineSigmaPx: 0.8, coarseSigmaPx: 2.4, amount: 1, threshold: 0.004 };

/** The removal radius for a variant `width` (never under one pixel). */
export function starRemoveRadius(width) {
  return Math.max(1, Math.round((STAR_REMOVE_RADIUS_AT_2K * width) / 2048));
}

const smoothRamp = (lo, hi, v) => {
  const t = clamp01((v - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};

/** Index of (x, y) with x wrapping round the equirect seam and y clamped. */
function wrapIndex(x, y, width, height) {
  const yy = y < 0 ? 0 : y >= height ? height - 1 : y;
  return yy * width + (((x % width) + width) % width);
}

function slidingExtreme(src, dst, width, height, radius, horizontal, takeMin) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let best = takeMin ? Infinity : -Infinity;
      for (let k = -radius; k <= radius; k++) {
        const v = horizontal
          ? src[wrapIndex(x + k, y, width, height)]
          : src[wrapIndex(x, y + k, width, height)];
        if (takeMin ? v < best : v > best) best = v;
      }
      dst[y * width + x] = best;
    }
  }
}

/**
 * Separable Gaussian blur of a single-channel image (a new Float64Array): x wraps round
 * the equirect seam, y clamps at the poles. A sigma of zero or less returns a copy.
 */
export function gaussianBlur(src, width, height, sigma) {
  if (!(sigma > 0)) return Float64Array.from(src);
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float64Array(2 * radius + 1);
  let sum = 0;
  for (let k = -radius; k <= radius; k++) {
    kernel[k + radius] = Math.exp(-(k * k) / (2 * sigma * sigma));
    sum += kernel[k + radius];
  }
  for (let k = 0; k < kernel.length; k++) kernel[k] /= sum;
  const tmp = new Float64Array(width * height);
  const out = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++)
        acc += src[wrapIndex(x + k, y, width, height)] * kernel[k + radius];
      tmp[y * width + x] = acc;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++)
        acc += tmp[wrapIndex(x, y + k, width, height)] * kernel[k + radius];
      out[y * width + x] = acc;
    }
  }
  return out;
}

function luminanceOf(px, n, channels) {
  const lum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * channels;
    lum[i] = 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
  }
  return lum;
}

/**
 * Remove the painted stars from a linear-light night sky in place, keeping the clouds,
 * their thin moonlit rims and the milky band's glow. The dome draws its own crisp
 * procedural stars instead (a painted star is a few texels the dome magnifies into a
 * soft blob). Two kinds:
 *
 * - SMALL points: a local maximum of the excess over a square morphological opening
 *   (erode then dilate, `radius`) is a star only if its light drops off by a ring of
 *   2 * radius + 2 pixels round it. A cloud rim is a line, which crosses that ring, so
 *   it is never taken for a star (a bare square opening flattened every thin rim into
 *   blocky squares).
 * - BIG four-point stars (BIG_STAR_*): a bright peak whose ring is dark except where
 *   its own arms cross it; its glow disk and each arm (followed outward while it stands
 *   above the ring's floor) are removed whole.
 *
 * Removed pixels are filled from their surroundings, not scaled down: a normalized
 * convolution of the KEPT pixels (two scales, the wider one for the big glow holes)
 * gives each hole the colour around it, so no dark speck or grey disc is left behind.
 * When `starCount` (a Float64Array of width * height) is given, each removed star adds
 * its weight at its centre pixel, the input of starDensityAlpha. Returns how many stars
 * were removed. Deterministic.
 */
export function removePointStarsInPlace(px, width, height, channels, radius, starCount = null) {
  const n = width * height;
  const scale = width / 2048;
  const r = Math.max(1, Math.floor(radius));
  const lum = luminanceOf(px, n, channels);
  const at = (x, y) => lum[wrapIndex(x, y, width, height)];
  const opened = new Float64Array(n);
  const scratch = new Float64Array(n);
  slidingExtreme(lum, scratch, width, height, r, true, true);
  slidingExtreme(scratch, opened, width, height, r, false, true);
  slidingExtreme(opened, scratch, width, height, r, true, false);
  slidingExtreme(scratch, opened, width, height, r, false, false);
  const [lo, hi] = STAR_REMOVE_EXCESS;
  const mark = new Float64Array(n);
  const stamp = (cx, cy, rad, weight) => {
    const reach = Math.ceil(rad);
    for (let dy = -reach; dy <= reach; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= height) continue;
      for (let dx = -reach; dx <= reach; dx++) {
        if (dx * dx + dy * dy > rad * rad) continue;
        const i = wrapIndex(cx + dx, y, width, height);
        if (weight > mark[i]) mark[i] = weight;
      }
    }
  };
  let removed = 0;

  // Big four-point stars first: their glow and arms would otherwise read as rims.
  const glowR = Math.max(3, BIG_STAR_GLOW_AT_2K * scale);
  const ringR = Math.max(5, Math.round(BIG_STAR_RING_AT_2K * scale));
  const armMax = Math.max(4, Math.round(BIG_STAR_ARM_AT_2K * scale));
  const peakR = Math.max(2, Math.round(4 * scale));
  const ringN = 32;
  const bigRing = [];
  for (let k = 0; k < ringN; k++) {
    const t = (k / ringN) * 2 * Math.PI;
    bigRing.push([Math.round(Math.cos(t) * ringR), Math.round(Math.sin(t) * ringR)]);
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const v = lum[i];
      if (v < BIG_STAR_PEAK) continue;
      let isPeak = true;
      for (let dy = -peakR; dy <= peakR && isPeak; dy++) {
        for (let dx = -peakR; dx <= peakR; dx++) {
          if (dx === 0 && dy === 0) continue;
          const j = wrapIndex(x + dx, y + dy, width, height);
          if (lum[j] > v || (lum[j] === v && j < i)) {
            isPeak = false;
            break;
          }
        }
      }
      if (!isPeak) continue;
      const ring = bigRing.map(([dx, dy]) => at(x + dx, y + dy)).sort((p, q) => p - q);
      const floor = ring[Math.floor(ringN * 0.3)];
      // Isolated: at most a few ring samples (its own arms) stand well above the floor.
      if (ring[Math.floor(ringN * 0.75)] - floor > 0.2 * (v - floor)) continue;
      removed++;
      if (starCount) starCount[i] += 1;
      stamp(x, y, glowR, 1);
      const armFloor = floor + 0.015 * (v - floor) + 0.003;
      for (const [sx, sy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        let misses = 0;
        for (let s = 2; s <= armMax; s++) {
          const ax = x + sx * s;
          const ay = y + sy * s;
          if (ay < 0 || ay >= height) break;
          let brightest = 0;
          for (let q = -2; q <= 2; q++) {
            brightest = Math.max(brightest, at(ax + (sy ? q : 0), ay + (sx ? q : 0)));
          }
          if (brightest < armFloor && s > glowR) {
            if (++misses > 3) break;
          } else {
            misses = 0;
          }
          for (let q = -2; q <= 2; q++) {
            const k = wrapIndex(ax + (sy ? q : 0), ay + (sx ? q : 0), width, height);
            const weight = q === -2 || q === 2 ? 0.6 : 1;
            if (weight > mark[k]) mark[k] = weight;
          }
        }
      }
    }
  }

  // Small points: an excess maximum whose light is gone by the ring round it.
  const pointR = 2 * r + 2;
  const pointRing = [];
  for (let k = 0; k < 16; k++) {
    const t = (k / 16) * 2 * Math.PI;
    pointRing.push([Math.round(Math.cos(t) * pointR), Math.round(Math.sin(t) * pointR)]);
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const e = lum[i] - opened[i];
      if (e < lo || mark[i] >= 1) continue;
      let isPeak = true;
      for (let dy = -r; dy <= r && isPeak; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -r; dx <= r; dx++) {
          if (dx === 0 && dy === 0) continue;
          const j = wrapIndex(x + dx, yy, width, height);
          const ej = lum[j] - opened[j];
          if (ej > e || (ej === e && j < i)) {
            isPeak = false;
            break;
          }
        }
      }
      if (!isPeak) continue;
      let ringMax = 0;
      for (const [dx, dy] of pointRing) ringMax = Math.max(ringMax, at(x + dx, y + dy));
      const pointness = smoothRamp(0.35, 0.7, (lum[i] - ringMax) / (e + 1e-9));
      if (pointness <= 0) continue;
      removed++;
      if (starCount) starCount[i] += pointness;
      stamp(x, y, r + 1, pointness * smoothRamp(lo, hi, e));
    }
  }

  // Fill every hole from the kept pixels round it (normalized convolution).
  const weight = new Float64Array(n);
  const keep = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const m = mark[i];
    weight[i] = m >= 1 ? 1 : m * smoothRamp(lo * 0.25, lo, lum[i] - opened[i]);
    keep[i] = 1 - weight[i];
  }
  const fine = r + 1;
  const coarse = Math.max(2 * fine, 6 * scale);
  const keepFine = gaussianBlur(keep, width, height, fine);
  const keepCoarse = gaussianBlur(keep, width, height, coarse);
  const channel = new Float64Array(n);
  for (let c = 0; c < Math.min(channels, 3); c++) {
    for (let i = 0; i < n; i++) channel[i] = px[i * channels + c] * keep[i];
    const sumFine = gaussianBlur(channel, width, height, fine);
    const sumCoarse = gaussianBlur(channel, width, height, coarse);
    for (let i = 0; i < n; i++) {
      const w = weight[i];
      if (w <= 0) continue;
      const near = keepFine[i] > 1e-6 ? sumFine[i] / keepFine[i] : 0;
      const wide = keepCoarse[i] > 1e-6 ? sumCoarse[i] / keepCoarse[i] : px[i * channels + c];
      const trust = smoothRamp(0.15, 0.4, keepFine[i]);
      const fill = near * trust + wide * (1 - trust);
      px[i * channels + c] += (fill - px[i * channels + c]) * w;
    }
  }
  return removed;
}

/**
 * The star density map (a new Float64Array, 0 to 1) from removePointStarsInPlace's
 * `starCount`: blurred over STAR_DENSITY_BLUR_DEG of sky and normalized at the
 * STAR_DENSITY_PERCENTILE, so a few dense knots do not leave the rest of the band dim.
 */
export function starDensityAlpha(starCount, width, height) {
  const blurred = gaussianBlur(starCount, width, height, (STAR_DENSITY_BLUR_DEG / 360) * width);
  const sorted = Float64Array.from(blurred).sort();
  const reference =
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * STAR_DENSITY_PERCENTILE))];
  const out = new Float64Array(blurred.length);
  if (!(reference > 0)) return out;
  for (let i = 0; i < out.length; i++) out[i] = clamp01(blurred[i] / reference);
  return out;
}

/**
 * The brush edge boost (SKY_SHARPEN) in place on a linear-light sky. Deterministic;
 * a zero amount leaves the pixels untouched.
 */
export function sharpenSkyInPlace(px, width, height, channels, opts = SKY_SHARPEN) {
  const { fineSigmaPx, coarseSigmaPx, amount, threshold } = opts;
  if (!(amount > 0)) return px;
  const n = width * height;
  const lum = luminanceOf(px, n, channels);
  const root = new Float64Array(n);
  for (let i = 0; i < n; i++) root[i] = Math.sqrt(Math.max(0, lum[i]));
  const fine = gaussianBlur(root, width, height, fineSigmaPx);
  const coarse = gaussianBlur(root, width, height, coarseSigmaPx);
  for (let i = 0; i < n; i++) {
    const band = fine[i] - coarse[i];
    const knee = threshold > 0 ? clamp01((Math.abs(band) - threshold) / threshold) : 1;
    if (knee <= 0 || root[i] <= 1e-6) continue;
    const lifted = Math.max(0, root[i] + amount * band * knee);
    const ratio = (lifted * lifted) / (root[i] * root[i]);
    const o = i * channels;
    for (let c = 0; c < Math.min(channels, 3); c++) px[o + c] = Math.min(1, px[o + c] * ratio);
  }
  return px;
}

/**
 * The whole pre-process for one resized variant: decode to linear light, remove the
 * night's painted stars (`removeStars`, recording their density), boost the brush
 * edges (`sharpen`), wrap blend, zenith fill, measure the glow, re-encode to sRGB, then
 * flip bottom row first for the compressed upload. With `removeStars` the result is
 * RGBA (4 channels, the star density in alpha, wrap-blended and zenith-filled like the
 * colour); otherwise RGB. `rgb` is the resized 8-bit sRGB buffer (top row first,
 * `channels` interleaved); it is not mutated.
 */
export function prepareSkyPixels(rgb, width, height, channels = 3, opts = {}) {
  const linear = decodeSrgb(rgb);
  let density = null;
  if (opts.removeStars) {
    const starCount = new Float64Array(width * height);
    removePointStarsInPlace(linear, width, height, channels, starRemoveRadius(width), starCount);
    density = starDensityAlpha(starCount, width, height);
  }
  if (opts.sharpen) sharpenSkyInPlace(linear, width, height, channels);
  wrapBlendInPlace(linear, width, height, channels, wrapBandPx(width));
  const zenith = poleFillInPlace(
    linear,
    width,
    height,
    channels,
    poleFillRows(height),
    poleSampleRows(height),
  );
  const glowU = measureGlowU(linear, width, height, channels);
  const colour = encodeSrgb(linear);
  if (!density) {
    return { pixels: flipRowsInPlace(colour, width, height, channels), channels, zenith, glowU };
  }
  wrapBlendInPlace(density, width, height, 1, wrapBandPx(width));
  poleFillInPlace(density, width, height, 1, poleFillRows(height), poleSampleRows(height));
  const n = width * height;
  const rgba = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    rgba[i * 4] = colour[i * channels];
    rgba[i * 4 + 1] = colour[i * channels + 1];
    rgba[i * 4 + 2] = colour[i * channels + 2];
    rgba[i * 4 + 3] = Math.round(clamp01(density[i]) * 255);
  }
  return { pixels: flipRowsInPlace(rgba, width, height, 4), channels: 4, zenith, glowU };
}

/**
 * `ktx create` arguments for one painted sky. UASTC LDR + zstd rather than ETC1S
 * (BasisLZ) on the measured banding: on the 2048x1024 test gradient every ETC1S quality
 * level (default, clevel 4 qlevel 255, and the 16128-cluster maximum) moved ALL of its
 * change onto 4x4 block edges, with vertical steps up to 10 LSB where the source never
 * steps more than 1 (11 percent of steps 2 LSB or more, 43.5 to 44 dB), which is the
 * banding a smooth painted sky shows first. ETC1S is far smaller (225 KB against
 * 1.23 MB for the painted day 2k) but posterizes it (34.8 dB, flat runs over twice the
 * source's), so the size goes to UASTC, with RDO tuned to keep the gradient (above).
 *
 * sRGB: `R8G8B8_SRGB` plus the sRGB transfer and BT.709 primaries in the DFD, which is
 * what makes three's KTX2Loader tag the texture SRGBColorSpace and upload it to an sRGB
 * internal format, so the GPU decodes each texel to linear light before the dome or the
 * PMREM generator sees it. No `--generate-mipmap`: the dome magnifies the texture (about
 * four screen pixels per texel at 2k), the PMREM source is read at its own size, and a
 * single level under LinearFilter has no mip selection, so the u wrap's derivative jump
 * at the seam cannot pick a coarser level and draw a seam line. `--threads 1` and
 * `--uastc-rdo-m` make the encode deterministic (verified byte-identical across runs;
 * multithreaded runs differ). `alpha` (the night, whose alpha carries the star density)
 * selects `R8G8B8A8_SRGB`: the alpha channel of an sRGB format is linear, as a density
 * must be.
 */
export function buildKtxLdrSkyArgs({ srcPath, dstPath, alpha = false }) {
  return [
    'create',
    '--format',
    alpha ? 'R8G8B8A8_SRGB' : 'R8G8B8_SRGB',
    '--encode',
    'uastc',
    '--uastc-quality',
    String(SKY_LDR_UASTC_QUALITY),
    '--uastc-rdo',
    '--uastc-rdo-l',
    String(SKY_LDR_RDO.lambda),
    '--uastc-rdo-b',
    String(SKY_LDR_RDO.smoothBlockScale),
    '--uastc-rdo-s',
    String(SKY_LDR_RDO.smoothBlockStdDev),
    '--uastc-rdo-m',
    '--zstd',
    String(SKY_LDR_ZSTD_LEVEL),
    '--threads',
    '1',
    '--assign-tf',
    'srgb',
    '--assign-primaries',
    'bt709',
    srcPath,
    dstPath,
  ];
}

/** The `.ktx2` file one variant writes. */
export function skyLdrTargetName(stem, variant) {
  return `${stem}_${variant}.ktx2`;
}

/** Every (source, target) pair the converter runs for `stems`, in a stable order. */
export function skyLdrJobs(stems = SKY_LDR_STEMS, sources = SKY_LDR_SOURCES) {
  const jobs = [];
  for (const stem of stems) {
    const source = sources.find((entry) => entry.stem === stem);
    if (!source) throw new Error(`unknown painted sky stem: ${stem}`);
    for (const variant of source.variants) {
      jobs.push({
        stem,
        variant,
        removeStars: source.removeStars === true,
        // Every dome variant takes the brush edge boost; the PMREM source does not.
        sharpen: variant !== '512',
        source: `${stem}.png`,
        target: skyLdrTargetName(stem, variant),
        ...equirectSize(variant),
      });
    }
  }
  return jobs;
}

/** Absolute paths for one job. */
export function skyLdrPaths(job, { srcDir, outDir }) {
  return { srcPath: path.join(srcDir, job.source), dstPath: path.join(outDir, job.target) };
}

export function parseArgs(argv, defaults) {
  const opts = { srcDir: defaults.srcDir, outDir: defaults.outDir, dryRun: false, stems: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--src') opts.srcDir = argv[++i];
    else if (a === '--out') opts.outDir = argv[++i];
    else if (a === '--dry-run') opts.dryRun = true;
    else opts.stems.push(a);
  }
  return opts;
}
