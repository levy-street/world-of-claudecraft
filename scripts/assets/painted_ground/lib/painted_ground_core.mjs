// Pure image maths for the painted ground pipeline (build_painted_ground.mjs).
//
// Everything here works on PLANAR float images: one Float32Array per channel,
// row-major, row 0 at the top, values in LINEAR light 0..1 unless a function
// says otherwise. No sharp, no fs: the driver decodes and encodes, this module
// only computes, so a Vitest can drive every step on small synthetic images.
//
// The steps, in the order the driver runs them:
//   periodicComponent  the seam heal. Moisan's periodic plus smooth
//                      decomposition (J. Math. Imaging Vis. 39, 2011): the
//                      image minus the unique smooth field that carries its
//                      edge mismatch. It tiles with no seam and no cross, and
//                      unlike an offset-and-feather heal it never cross-fades
//                      two different parts of the painting into a ghost.
//   delight            divides out each channel's lowest spatial frequencies
//                      (baked gradients, vignettes, one big bright blotch), so
//                      a tile carries no shape large enough to show its repeat.
//   isotropize         evens out DIRECTIONAL spectral energy, band by band: the
//                      faint diagonal banding and the same-way brush strokes
//                      image generators leave are one orientation carrying more
//                      energy than the rest, while the painting's own random
//                      detail is spread evenly around every frequency ring.
//   normalizeColour    moves the tile's linear mean onto the colour the splat
//                      shader's per-biome tint was tuned against.
//   deriveHeight       a band-limited luminance height (painted highlights sit
//                      on top of stones and tufts, gaps are painted dark), which
//                      the terrain height-blends its layers with.
//   deriveNormal       a gentle OpenGL-convention tangent normal from that
//                      height (green points up the image).
//   cavityMap / fitMeanSd  the GroundAO_Packed relief channels, fitted to the
//                      exact mean and spread the shader centres them on.

/** Rec. 709 luminance weights, for LINEAR light. */
export const LUMA = Object.freeze([0.2126, 0.7152, 0.0722]);

export function srgbToLinear(v) {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(v) {
  const c = Math.min(1, Math.max(0, v));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

// ---- planar image helpers --------------------------------------------------

/** Interleaved 8-bit sRGB (3 or 4 channels) to three linear float planes. */
export function planesFromSrgb8(data, w, h, channels) {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = srgbToLinear(i / 255);
  const planes = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)];
  for (let i = 0, p = 0; p < w * h; p++, i += channels) {
    planes[0][p] = lut[data[i]];
    planes[1][p] = lut[data[i + 1]];
    planes[2][p] = lut[data[i + 2]];
  }
  return planes;
}

/** Three linear float planes to interleaved 8-bit sRGB RGB. */
export function srgb8FromPlanes(planes, w, h) {
  const out = new Uint8Array(w * h * 3);
  for (let p = 0; p < w * h; p++) {
    for (let c = 0; c < 3; c++) out[p * 3 + c] = Math.round(linearToSrgb(planes[c][p]) * 255);
  }
  return out;
}

/** One 0..1 plane to 8-bit grey (no transfer function: data, not colour). */
export function grey8FromPlane(plane) {
  const out = new Uint8Array(plane.length);
  for (let i = 0; i < plane.length; i++) {
    out[i] = Math.round(Math.min(1, Math.max(0, plane[i])) * 255);
  }
  return out;
}

export function luminance(planes) {
  const n = planes[0].length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = LUMA[0] * planes[0][i] + LUMA[1] * planes[1][i] + LUMA[2] * planes[2][i];
  }
  return out;
}

export function planeStats(plane) {
  let sum = 0;
  for (let i = 0; i < plane.length; i++) sum += plane[i];
  const mean = sum / plane.length;
  let sq = 0;
  for (let i = 0; i < plane.length; i++) sq += (plane[i] - mean) ** 2;
  return { mean, sd: Math.sqrt(sq / plane.length) };
}

export function planesMean(planes) {
  return planes.map((p) => planeStats(p).mean);
}

// ---- FFT -------------------------------------------------------------------

export function isPowerOfTwo(n) {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

const twiddleCache = new Map();
function twiddles(n) {
  let t = twiddleCache.get(n);
  if (!t) {
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) {
      cos[k] = Math.cos((2 * Math.PI * k) / n);
      sin[k] = Math.sin((2 * Math.PI * k) / n);
    }
    t = { cos, sin };
    twiddleCache.set(n, t);
  }
  return t;
}

/** In-place iterative radix-2 FFT. `inverse` uses +i and scales by 1/n. */
export function fft1d(re, im, inverse = false) {
  const n = re.length;
  if (!isPowerOfTwo(n)) throw new Error(`fft1d: length ${n} is not a power of two`);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  const { cos, sin } = twiddles(n);
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sign * sin[k * step];
        const a = i + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

/** In-place 2D FFT over a w x h row-major complex image. */
export function fft2d(re, im, w, h, inverse = false) {
  const rowRe = new Float64Array(w);
  const rowIm = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) {
      rowRe[x] = re[o + x];
      rowIm[x] = im[o + x];
    }
    fft1d(rowRe, rowIm, inverse);
    for (let x = 0; x < w; x++) {
      re[o + x] = rowRe[x];
      im[o + x] = rowIm[x];
    }
  }
  const colRe = new Float64Array(h);
  const colIm = new Float64Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      colRe[y] = re[y * w + x];
      colIm[y] = im[y * w + x];
    }
    fft1d(colRe, colIm, inverse);
    for (let y = 0; y < h; y++) {
      re[y * w + x] = colRe[y];
      im[y * w + x] = colIm[y];
    }
  }
}

/** Signed frequency of FFT bin k in an n-point transform (cycles per tile). */
export function binFrequency(k, n) {
  return k <= n / 2 ? k : k - n;
}

/** Forward FFT of a real plane. */
function spectrum(plane, w, h) {
  const re = Float64Array.from(plane);
  const im = new Float64Array(w * h);
  fft2d(re, im, w, h, false);
  return { re, im };
}

/** Inverse FFT back to a real plane (the imaginary residue is round-off). */
function realFromSpectrum(re, im, w, h) {
  fft2d(re, im, w, h, true);
  return Float32Array.from(re);
}

// ---- seam heal -------------------------------------------------------------

/**
 * Moisan's periodic component of one plane: u - s, where s is the smooth
 * (harmonic inside) field whose Laplacian is the boundary mismatch of u. The
 * result has the same mean as u and tiles without a value step.
 */
export function periodicComponent(plane, w, h) {
  if (!isPowerOfTwo(w) || !isPowerOfTwo(h)) {
    throw new Error(`periodicComponent: ${w}x${h} is not a power-of-two tile`);
  }
  const v = new Float64Array(w * h);
  for (let x = 0; x < w; x++) {
    const d = plane[(h - 1) * w + x] - plane[x];
    v[x] += d;
    v[(h - 1) * w + x] -= d;
  }
  for (let y = 0; y < h; y++) {
    const d = plane[y * w + w - 1] - plane[y * w];
    v[y * w] += d;
    v[y * w + w - 1] -= d;
  }
  const im = new Float64Array(w * h);
  fft2d(v, im, w, h, false);
  for (let y = 0; y < h; y++) {
    const cy = 2 * Math.cos((2 * Math.PI * y) / h);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (i === 0) {
        v[0] = 0;
        im[0] = 0;
        continue;
      }
      const denom = 2 * Math.cos((2 * Math.PI * x) / w) + cy - 4;
      v[i] /= denom;
      im[i] /= denom;
    }
  }
  const smooth = realFromSpectrum(v, im, w, h);
  const out = new Float32Array(w * h);
  // u - s can step a hair outside 0..1 near a strongly mismatched edge; the
  // downstream log-domain steps need a valid light value, so clamp here.
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, Math.max(0, plane[i] - smooth[i]));
  return out;
}

/**
 * How visible the wrap seam is: the mean absolute step across the wrap edge
 * (last column to first, last row to first) over the mean step between
 * neighbouring interior pixels. About 1 for a seamless tile; a painted source
 * that was "nearly seamless" measures 1.3 to 2.
 */
export function wrapSeamRatio(plane, w, h) {
  let edgeX = 0;
  let edgeY = 0;
  let inner = 0;
  let innerCount = 0;
  for (let y = 0; y < h; y++) edgeX += Math.abs(plane[y * w + w - 1] - plane[y * w]);
  for (let x = 0; x < w; x++) edgeY += Math.abs(plane[(h - 1) * w + x] - plane[x]);
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      inner += Math.abs(plane[i + 1] - plane[i]) + Math.abs(plane[i + w] - plane[i]);
      innerCount += 2;
    }
  }
  const step = inner / innerCount || 1e-9;
  return { x: edgeX / h / step, y: edgeY / w / step };
}

// ---- low-frequency removal ---------------------------------------------------

/** Gaussian low-pass by FFT: keeps frequencies well under `sigmaCycles`
 *  cycles per tile. The plane must be periodic (run the seam heal first). */
export function lowpassCycles(plane, w, h, sigmaCycles) {
  const { re, im } = spectrum(plane, w, h);
  const s2 = 2 * sigmaCycles * sigmaCycles;
  for (let y = 0; y < h; y++) {
    const fy = binFrequency(y, h);
    for (let x = 0; x < w; x++) {
      const fx = binFrequency(x, w);
      const g = Math.exp(-(fx * fx + fy * fy) / s2);
      re[y * w + x] *= g;
      im[y * w + x] *= g;
    }
  }
  return realFromSpectrum(re, im, w, h);
}

/** Wrap-around separable Gaussian blur with sigma in PIXELS (small sigma). */
export function blurWrap(plane, w, h, sigmaPx) {
  if (sigmaPx <= 0) return Float32Array.from(plane);
  const radius = Math.max(1, Math.ceil(sigmaPx * 3));
  const kernel = new Float64Array(radius * 2 + 1);
  let ksum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigmaPx * sigmaPx));
    kernel[i + radius] = v;
    ksum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= ksum;
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        acc += plane[y * w + ((((x + k) % w) + w) % w)] * kernel[k + radius];
      }
      tmp[y * w + x] = acc;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        acc += tmp[((((y + k) % h) + h) % h) * w + x] * kernel[k + radius];
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

const LOG_EPS = 1e-4;
const safeLog = (v) => Math.log(Math.max(0, v) + LOG_EPS);

/**
 * Flatten each channel's lowest frequencies multiplicatively (in log space, so
 * a baked gradient divides out the same in a dark and a bright region). The
 * channel mean is kept. `strength` 1 removes the band fully, 0 is identity.
 */
export function delight(planes, w, h, { sigmaCycles, strength = 1 }) {
  if (strength <= 0) return planes.map((p) => Float32Array.from(p));
  return planes.map((plane) => {
    const lg = new Float32Array(plane.length);
    for (let i = 0; i < plane.length; i++) lg[i] = safeLog(plane[i]);
    const low = lowpassCycles(lg, w, h, sigmaCycles);
    const { mean } = planeStats(lg);
    const out = new Float32Array(plane.length);
    for (let i = 0; i < plane.length; i++) {
      const gain = Math.exp((mean - low[i]) * strength);
      out[i] = Math.max(0, (plane[i] + LOG_EPS) * gain - LOG_EPS);
    }
    return out;
  });
}

/** Orientation bin of a frequency vector, folded onto [0, pi). */
function orientationAngle(fx, fy) {
  let a = Math.atan2(fy, fx);
  if (a < 0) a += Math.PI;
  return a >= Math.PI ? a - Math.PI : a;
}

/**
 * Mean spectral energy per orientation over the [minCycles, maxCycles] band,
 * in `bins` orientation bins across [0, pi). Returns the per-bin means.
 */
function orientationEnergy(re, im, w, h, minCycles, maxCycles, bins) {
  const sum = new Float64Array(bins);
  const count = new Float64Array(bins);
  for (let y = 0; y < h; y++) {
    const fy = binFrequency(y, h);
    for (let x = 0; x < w; x++) {
      const fx = binFrequency(x, w);
      const r = Math.hypot(fx, fy);
      if (r < minCycles || r > maxCycles) continue;
      const b = Math.min(bins - 1, Math.floor((orientationAngle(fx, fy) / Math.PI) * bins));
      const i = y * w + x;
      sum[b] += re[i] * re[i] + im[i] * im[i];
      count[b] += 1;
    }
  }
  return Array.from(sum, (v, b) => (count[b] > 0 ? v / count[b] : 0));
}

/**
 * How directional a plane's texture is in a frequency band: the strongest
 * orientation's mean spectral energy over the mean across orientations. An
 * isotropic painting reads close to 1; the diagonal strokes and bands an image
 * generator leaves read well above it.
 */
export function directionalAnisotropy(plane, w, h, { minCycles, maxCycles, bins = 18 }) {
  const { re, im } = spectrum(plane, w, h);
  const e = orientationEnergy(re, im, w, h, minCycles, maxCycles, bins);
  const mean = e.reduce((a, b) => a + b, 0) / e.length;
  return mean > 0 ? Math.max(...e) / mean : 1;
}

/**
 * Even out directional energy: per half-octave radius band and orientation
 * bin, scale the spectrum's amplitude toward the band's orientation-average
 * energy (phase kept), `strength` 1 fully isotropic, 0 identity. Runs on each
 * channel in log space, so an oriented band of value AND hue (the generator's
 * yellow-green diagonal) evens out, while the radial power spectrum (how much
 * fine versus broad detail the painting has) is untouched.
 */
export function isotropize(planes, w, h, { minCycles, maxCycles, strength, bins = 18 }) {
  const bandsPerOctave = 2;
  const bandOf = (r) => Math.log2(r / minCycles) * bandsPerOctave;
  const bandCount = Math.floor(bandOf(maxCycles)) + 1;
  const report = { before: 0, after: 0 };
  const out = planes.map((plane, c) => {
    const lg = new Float32Array(plane.length);
    for (let i = 0; i < plane.length; i++) lg[i] = safeLog(plane[i]);
    const { re, im } = spectrum(lg, w, h);
    // energy table [band][orientation]
    const sum = Array.from({ length: bandCount }, () => new Float64Array(bins));
    const cnt = Array.from({ length: bandCount }, () => new Float64Array(bins));
    forEachBin(w, h, minCycles, maxCycles, (i, fx, fy, r) => {
      const band = Math.min(bandCount - 1, Math.floor(bandOf(r)));
      const o = Math.min(bins - 1, Math.floor((orientationAngle(fx, fy) / Math.PI) * bins));
      sum[band][o] += re[i] * re[i] + im[i] * im[i];
      cnt[band][o] += 1;
    });
    // log amplitude gain per [band][orientation], circularly smoothed
    const gain = sum.map((row, band) => {
      const e = Array.from(row, (v, o) => (cnt[band][o] > 0 ? v / cnt[band][o] : 0));
      const smooth = e.map(
        (_, o) => 0.25 * e[(o + bins - 1) % bins] + 0.5 * e[o] + 0.25 * e[(o + 1) % bins],
      );
      const mean = smooth.reduce((a, b) => a + b, 0) / bins;
      // Attenuation may go deep (a strong band is the thing to remove); a
      // boost of a weak direction stays mild, so empty orientations never
      // turn their noise floor up into new detail.
      return smooth.map((v) =>
        v > 0 && mean > 0
          ? Math.min(Math.log(2), Math.max(Math.log(0.1), 0.5 * strength * Math.log(mean / v)))
          : 0,
      );
    });
    if (c === 1) report.before = directionalAnisotropy(lg, w, h, { minCycles, maxCycles, bins });
    forEachBin(w, h, minCycles, maxCycles, (i, fx, fy, r) => {
      // bilinear in (band centre, orientation centre) so no gain steps ring
      const bf = Math.min(bandCount - 1, Math.max(0, bandOf(r) - 0.5));
      const b0 = Math.floor(bf);
      const b1 = Math.min(bandCount - 1, b0 + 1);
      const tb = bf - b0;
      const of = (orientationAngle(fx, fy) / Math.PI) * bins - 0.5;
      const o0 = ((Math.floor(of) % bins) + bins) % bins;
      const o1 = (o0 + 1) % bins;
      const to = of - Math.floor(of);
      const g0 = gain[b0][o0] * (1 - to) + gain[b0][o1] * to;
      const g1 = gain[b1][o0] * (1 - to) + gain[b1][o1] * to;
      const k = Math.exp(g0 * (1 - tb) + g1 * tb);
      re[i] *= k;
      im[i] *= k;
    });
    const fixed = realFromSpectrum(re, im, w, h);
    if (c === 1) report.after = directionalAnisotropy(fixed, w, h, { minCycles, maxCycles, bins });
    const res = new Float32Array(plane.length);
    for (let i = 0; i < plane.length; i++) res[i] = Math.max(0, Math.exp(fixed[i]) - LOG_EPS);
    return res;
  });
  return { planes: out, report };
}

function forEachBin(w, h, minCycles, maxCycles, fn) {
  for (let y = 0; y < h; y++) {
    const fy = binFrequency(y, h);
    for (let x = 0; x < w; x++) {
      const fx = binFrequency(x, w);
      const r = Math.hypot(fx, fy);
      if (r < minCycles || r > maxCycles) continue;
      fn(y * w + x, fx, fy, r);
    }
  }
}

// ---- colour ----------------------------------------------------------------

/**
 * Move the tile's linear mean colour toward `target` (linear RGB). Each pixel
 * splits into its luminance and its chromaticity (channel over luminance):
 * - the mean LUMINANCE lands on the target's exactly, with `contrast`
 *   scaling every pixel's log-distance from it (1 keeps the value range);
 * - the mean CHROMATICITY keeps `chromaKeep` of the painting's own (1 keeps
 *   the painted hue, 0 takes the target's, which a grey target makes
 *   tint-neutral);
 * - each pixel's chromatic DEVIATION from that mean is scaled by
 *   `chromaVariation` (1 keeps the painted colour variety; under 1 calms a
 *   channel the neutralising gain would otherwise amplify, such as the near
 *   empty blue of a green painting).
 * Values over 1 are soft-shouldered instead of clipped.
 */
export function normalizeColour(
  planes,
  { target, chromaKeep = 1, contrast = 1, chromaVariation = 1 },
) {
  const n = planes[0].length;
  const lumOf = (c) => LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2];
  const mean = planesMean(planes);
  const srcLum = Math.max(lumOf(mean), 1e-6);
  const tgtLum = lumOf(target);
  const srcRatio = mean.map((m) => m / srcLum);
  const mixed = [0, 1, 2].map(
    (c) => srcRatio[c] ** chromaKeep * (target[c] / tgtLum) ** (1 - chromaKeep),
  );
  const ratio = mixed.map((r) => r / lumOf(mixed));
  const want = ratio.map((r) => r * tgtLum);
  const base = planes.map(() => new Float32Array(n));
  for (let i = 0; i < n; i++) {
    const v = [planes[0][i], planes[1][i], planes[2][i]];
    const lum = lumOf(v);
    const lumOut = tgtLum * ((lum + LOG_EPS) / (srcLum + LOG_EPS)) ** contrast;
    for (let c = 0; c < 3; c++) {
      const dev = lum > 1e-5 ? v[c] / lum / srcRatio[c] - 1 : 0;
      base[c][i] = Math.max(0, lumOut * ratio[c] * (1 + chromaVariation * dev));
    }
  }
  // re-aim: the shoulder and the per-pixel chroma terms shift the means
  const gain = [1, 1, 1];
  const out = planes.map(() => new Float32Array(n));
  for (let pass = 0; pass < 8; pass++) {
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < n; i++) out[c][i] = softShoulder(base[c][i] * gain[c]);
    }
    const got = planesMean(out);
    let worst = 0;
    for (let c = 0; c < 3; c++) {
      worst = Math.max(worst, Math.abs(got[c] - want[c]) / want[c]);
      gain[c] *= want[c] / Math.max(got[c], 1e-6);
    }
    if (worst < 1e-3) break;
  }
  return out;
}

/** Identity below 0.8, then an exponential shoulder that approaches 1. */
export function softShoulder(v) {
  if (v <= 0.8) return Math.max(0, v);
  return 0.8 + 0.2 * (1 - Math.exp(-(v - 0.8) / 0.2));
}

// ---- height, normal, cavity --------------------------------------------------

/**
 * A band-limited height from luminance: log luminance minus its own blur at
 * `detailSigmaPx` (so a whole dark stone is not a pit, only its edges are),
 * mixed with `broad` of the unfiltered log luminance, smoothed by `smoothPx`,
 * then mapped to mean 0.5 with `spread` per standard deviation, clamped.
 */
export function deriveHeight(
  planes,
  w,
  h,
  { detailSigmaPx, broad = 0.35, smoothPx = 1, spread = 0.17 },
) {
  const lum = luminance(planes);
  const lg = new Float32Array(lum.length);
  for (let i = 0; i < lum.length; i++) lg[i] = safeLog(lum[i]);
  const base = blurWrap(lg, w, h, detailSigmaPx);
  const raw = new Float32Array(lg.length);
  for (let i = 0; i < lg.length; i++) raw[i] = lg[i] - base[i] * (1 - broad);
  const smooth = blurWrap(raw, w, h, smoothPx);
  const { mean, sd } = planeStats(smooth);
  const out = new Float32Array(smooth.length);
  const k = spread / Math.max(sd, 1e-6);
  for (let i = 0; i < smooth.length; i++) {
    out[i] = Math.min(0.98, Math.max(0.02, 0.5 + (smooth[i] - mean) * k));
  }
  return out;
}

/**
 * OpenGL-convention tangent normal from a 0..1 height plane (wrapping, so the
 * normal tiles too): x = -dh/dx, y = +dh/d(row) (green points UP the image),
 * z = 1, with the slope scaled by `strength` (height units per pixel). Output
 * is three 0..1 planes (r, g, b) ready to encode.
 */
export function deriveNormal(height, w, h, { strength, blurPx = 0 }) {
  const hf = blurPx > 0 ? blurWrap(height, w, h, blurPx) : height;
  const r = new Float32Array(w * h);
  const g = new Float32Array(w * h);
  const b = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const up = ((y - 1 + h) % h) * w;
    const down = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) {
      const left = (x - 1 + w) % w;
      const right = (x + 1) % w;
      const dx = (hf[y * w + right] - hf[y * w + left]) * 0.5 * strength;
      const dDown = (hf[down + x] - hf[up + x]) * 0.5 * strength;
      const nx = -dx;
      const ny = dDown;
      const inv = 1 / Math.hypot(nx, ny, 1);
      const i = y * w + x;
      r[i] = nx * inv * 0.5 + 0.5;
      g[i] = ny * inv * 0.5 + 0.5;
      b[i] = inv * 0.5 + 0.5;
    }
  }
  return [r, g, b];
}

/** AO-like cavity: dark only where the height sits below its neighbourhood. */
export function cavityMap(height, w, h, { sigmaPx, gain = 4 }) {
  const local = blurWrap(height, w, h, sigmaPx);
  const out = new Float32Array(height.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = 1 - Math.min(1, Math.max(0, local[i] - height[i]) * gain);
  }
  return out;
}

/**
 * Affinely remap a plane onto an exact mean and standard deviation, clamped
 * to 0..1. The clamp moves both statistics, so the fit iterates on what the
 * clamped result actually measures. Returns the plane and what it achieved.
 */
export function fitMeanSd(plane, targetMean, targetSd) {
  const src = planeStats(plane);
  let scale = targetSd / Math.max(src.sd, 1e-9);
  let offset = targetMean;
  const out = new Float32Array(plane.length);
  let got = src;
  for (let pass = 0; pass < 40; pass++) {
    for (let i = 0; i < plane.length; i++) {
      out[i] = Math.min(1, Math.max(0, (plane[i] - src.mean) * scale + offset));
    }
    got = planeStats(out);
    if (Math.abs(got.mean - targetMean) < 2e-4 && Math.abs(got.sd - targetSd) < 2e-4) break;
    scale *= targetSd / Math.max(got.sd, 1e-9);
    offset += targetMean - got.mean;
  }
  return { plane: out, mean: got.mean, sd: got.sd };
}

// ---- recipes -----------------------------------------------------------------

/**
 * The photo layers' TRUE linear mean colours (mean of each pixel's decoded
 * value, what mip averaging resolves to on screen), measured from the shipped
 * ambientCG files the painted layers replace. The per-biome vertex tints and
 * the far terrain's tones were tuned against these, so the replacements land
 * their mean luminance here.
 */
export const PHOTO_LAYER_MEANS = Object.freeze({
  Grass001: [0.0603, 0.1091, 0.0226],
  Ground023: [0.1532, 0.1137, 0.0761],
  Rock026: [0.3831, 0.3837, 0.3723],
});

/** sRGB-byte colour to linear RGB (for writing targets readably). */
const linearOf = (r, g, b) => [r, g, b].map((v) => srgbToLinear(v / 255));

/**
 * Per-source processing. `colour.target` is a linear RGB mean (its luminance is
 * matched exactly; `chromaKeep` 1 keeps the painting's own mean hue, 0 takes
 * the target's). `height` and `normal` drive deriveHeight / deriveNormal at
 * the 1024 working size. `isotropize` evens out the generator's diagonal
 * banding and same-way strokes.
 */
export const PAINTED_GROUND_RECIPES = Object.freeze({
  grass: {
    // TINT-NEUTRAL: the bake arm lifts it onto the blade bake's mean and the
    // vertex tint paints it the zone's green (both full strength), exactly
    // how the baked strokes it mixes with are coloured. Half its relative hue
    // (yellow tufts, blue-green moss) is kept; the mean goes grey, and the
    // halving keeps the neutralising gain (about 28x on the painting's near
    // empty blue) from turning paint noise into speckle.
    delight: { sigmaCycles: 1.6, strength: 1 },
    isotropize: { minCycles: 2, maxCycles: 160, strength: 1 },
    colour: { target: [0.42, 0.42, 0.42], chromaKeep: 0, contrast: 0.85, chromaVariation: 0.5 },
    height: { detailSigmaPx: 6, broad: 0.3, smoothPx: 1, spread: 0.16 },
    // relief that reads at the chase camera: about twice the first cut, on
    // a broader blur so tuft-scale forms carry it and brush noise does not
    normal: { strength: 13, blurPx: 2 },
  },
  dirt: {
    // On the Ground023 mean luminance with a third of its painted ochre
    // kept: the vale's 35% dirt tint warms it again on the road.
    delight: { sigmaCycles: 1.6, strength: 1 },
    isotropize: { minCycles: 2, maxCycles: 160, strength: 0.85 },
    colour: { target: PHOTO_LAYER_MEANS.Ground023, chromaKeep: 0.35, contrast: 1 },
    height: { detailSigmaPx: 10, broad: 0.25, smoothPx: 1, spread: 0.17 },
    normal: { strength: 17, blurPx: 2 },
  },
  rock: {
    // On the Rock026 mean (the shader still folds 38% toward chalk grey, so
    // the cliff composite keeps its shipped value), most of the painted cool
    // blue-grey and moss kept.
    delight: { sigmaCycles: 1.4, strength: 1 },
    isotropize: { minCycles: 2, maxCycles: 160, strength: 0.75 },
    colour: { target: PHOTO_LAYER_MEANS.Rock026, chromaKeep: 0.6, contrast: 0.9 },
    height: { detailSigmaPx: 24, broad: 0.4, smoothPx: 1.5, spread: 0.17 },
    normal: { strength: 20, blurPx: 1.6 },
  },
  cobble: {
    // Pale worn town cobbles: lifted to a light warm grey so the laid stone
    // reads against the packed earth it is worn back to.
    delight: { sigmaCycles: 1.4, strength: 1 },
    isotropize: { minCycles: 2, maxCycles: 160, strength: 0.6 },
    colour: { target: linearOf(150, 142, 128), chromaKeep: 0.55, contrast: 0.9 },
    // smoothed into domes: the shader's height relief bevels the stones off
    // this height (no normal map), so it must be rounded, not stepped
    height: { detailSigmaPx: 28, broad: 0.35, smoothPx: 4.5, spread: 0.18 },
    normal: null,
  },
  leaves: {
    // Warm leaf litter at a mid value, pulled well off the painting's orange
    // toward ochre-brown: in game the zone's warm key light and the biome
    // tint push it redder still, and at the painting's own hue a patch read
    // as a red splash rather than fallen leaves.
    delight: { sigmaCycles: 1.6, strength: 1 },
    isotropize: { minCycles: 2, maxCycles: 160, strength: 0.8 },
    colour: {
      target: linearOf(112, 94, 68),
      chromaKeep: 0.4,
      contrast: 0.9,
      chromaVariation: 0.6,
    },
    height: { detailSigmaPx: 12, broad: 0.3, smoothPx: 1.5, spread: 0.17 },
    normal: null,
  },
});

/**
 * GroundAO_Packed.png (512px RGBA), sampled by terrain.ts GROUND_RELIEF_GLSL
 * at each layer's own albedo tiling, so a channel built from the painted
 * layer lines up with it. Every channel is FITTED to the mean and spread the
 * shader centres it on (the WOC_PARALLAX_AMP, WOC_GRASS_H_* and the
 * `- 0.812 / 0.897 / 0.623 / 0.883` constants), which keeps every relief
 * term calibrated without touching a shader constant. Alpha stays the
 * ambientCG Ground080 sand AO: sand is still the photo layer.
 */
export const GROUND_AO_PACK = Object.freeze({
  size: 512,
  r: { source: 'grass', kind: 'cavity', sigmaPx: 4, gain: 4, mean: 0.812, sd: 0.0775 },
  g: { source: 'dirt', kind: 'cavity', sigmaPx: 5, gain: 4, mean: 0.897, sd: 0.1168 },
  b: { source: 'rock', kind: 'height', smoothPx: 1, mean: 0.623, sd: 0.1136 },
  a: { photo: 'Ground080_AmbientOcclusion.jpg' },
});

/** One layer through the colour pipeline. `planes` must be a power-of-two
 *  tile; returns the processed planes and a report of what each step did. */
export function processPaintedLayer(planes, w, h, recipe) {
  const lumBefore = luminance(planes);
  const seamBefore = wrapSeamRatio(lumBefore, w, h);
  let p = planes.map((plane) => periodicComponent(plane, w, h));
  const seamAfter = wrapSeamRatio(luminance(p), w, h);
  p = delight(p, w, h, recipe.delight);
  const iso = isotropize(p, w, h, recipe.isotropize);
  p = normalizeColour(iso.planes, recipe.colour);
  return {
    planes: p,
    report: {
      seamBefore,
      seamAfter,
      anisotropyBefore: iso.report.before,
      anisotropyAfter: iso.report.after,
      mean: planesMean(p),
    },
  };
}

/** 2x2 box downsample of a plane (both sides must be even). */
export function downsample2x(plane, w, h) {
  const ow = w >> 1;
  const oh = h >> 1;
  const out = new Float32Array(ow * oh);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const i = 2 * y * w + 2 * x;
      out[y * ow + x] = (plane[i] + plane[i + 1] + plane[i + w] + plane[i + w + 1]) * 0.25;
    }
  }
  return out;
}

/** One GroundAO_Packed relief channel from a layer's 512px height. */
export function groundAoChannel(height, w, h, spec) {
  const raw =
    spec.kind === 'cavity'
      ? cavityMap(height, w, h, { sigmaPx: spec.sigmaPx, gain: spec.gain })
      : blurWrap(height, w, h, spec.smoothPx ?? 0);
  return fitMeanSd(raw, spec.mean, spec.sd);
}

// ---- macro noise emulation ----------------------------------------------------

/**
 * A stand-in for src/render/textures.ts macroNoiseTexture (256px, #808080,
 * 160 wrapped radial blobs of 18 to 64 px at 30% alpha), drawn the way a 2D
 * canvas composites them, from its own LCG start. It matches the game's
 * texture in DISTRIBUTION, not blob for blob (the game's depends on how far
 * the shared LCG has run), which is all the preview and the coverage tests
 * need: the painted masks work in z-scores of whatever texture they get.
 */
export function emulateMacroNoise(seed = 12345) {
  let st = seed;
  const rnd = () => {
    st = (st * 1103515245 + 12345) & 0x7fffffff;
    return st / 0x7fffffff;
  };
  const s = 256;
  const f = new Float64Array(s * s).fill(128);
  for (let i = 0; i < 160; i++) {
    const x = rnd() * s;
    const y = rnd() * s;
    const r = 18 + rnd() * 46;
    const v = 40 + rnd() * 175;
    for (const ox of [-s, 0, s]) {
      for (const oy of [-s, 0, s]) {
        const cx = x + ox;
        const cy = y + oy;
        for (let py = Math.max(0, Math.floor(cy - r)); py <= Math.min(s - 1, cy + r); py++) {
          for (let px = Math.max(0, Math.floor(cx - r)); px <= Math.min(s - 1, cx + r); px++) {
            const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
            if (d >= r) continue;
            const a = 0.3 * (1 - d / r);
            f[py * s + px] = v * a + f[py * s + px] * (1 - a);
          }
        }
      }
    }
  }
  const bytes = Uint8Array.from(f, (v) => Math.round(v));
  /** Wrapped bilinear lookup, (u, v) in texture units, 0..1 out. */
  const sample = (u, v) => {
    const x = (((u % 1) + 1) % 1) * s - 0.5;
    const y = (((v % 1) + 1) % 1) * s - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const g = (xx, yy) => bytes[(((yy % s) + s) % s) * s + (((xx % s) + s) % s)] / 255;
    return (
      (g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) +
      (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty
    );
  };
  return { bytes, sample };
}
