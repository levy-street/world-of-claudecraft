// The painted ground converter's maths (scripts/assets/painted_ground/lib/
// painted_ground_core.mjs): the seam heal, the low-frequency de-light, the
// directional isotropize, the colour landing, the height and the GL normal,
// driven on small synthetic tiles plus one real source, so a regression in
// any step fails here before it reaches a shipped layer.
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  binFrequency,
  cavityMap,
  delight,
  deriveHeight,
  deriveNormal,
  directionalAnisotropy,
  downsample2x,
  fft2d,
  fitMeanSd,
  GROUND_AO_PACK,
  isotropize,
  LUMA,
  linearToSrgb,
  luminance,
  normalizeColour,
  PAINTED_GROUND_RECIPES,
  periodicComponent,
  planeStats,
  planesFromSrgb8,
  planesMean,
  processPaintedLayer,
  srgbToLinear,
  wrapSeamRatio,
} from '../scripts/assets/painted_ground/lib/painted_ground_core.mjs';
import { PAINTED_GROUND_LAYERS } from '../src/render/terrain_painted_ground_core';

const ROOT = path.resolve(__dirname, '..');

/** Deterministic value noise in 0..1 (no Math.random in a test either). */
function noise(n: number, seed = 1): Float32Array {
  let s = seed >>> 0;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = s / 4294967296;
  }
  return out;
}

function grid(w: number, h: number, fn: (x: number, y: number) => number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = fn(x, y);
  return out;
}

describe('FFT', () => {
  it('round-trips and puts a cosine on its own bin', () => {
    const w = 32;
    const h = 16;
    const src = noise(w * h, 7);
    const re = Float64Array.from(src);
    const im = new Float64Array(w * h);
    fft2d(re, im, w, h, false);
    fft2d(re, im, w, h, true);
    for (let i = 0; i < src.length; i++) expect(re[i]).toBeCloseTo(src[i], 9);

    const cos = Float64Array.from(grid(w, h, (x) => Math.cos((2 * Math.PI * 3 * x) / w)));
    const ci = new Float64Array(w * h);
    fft2d(cos, ci, w, h, false);
    let peak = -1;
    let peakMag = 0;
    for (let i = 0; i < cos.length; i++) {
      const mag = Math.hypot(cos[i], ci[i]);
      if (mag > peakMag) {
        peakMag = mag;
        peak = i;
      }
    }
    expect(Math.abs(binFrequency(peak % w, w))).toBe(3);
    expect(Math.floor(peak / w)).toBe(0);
  });
});

describe('seam heal (periodicComponent)', () => {
  it('a strongly non-tiling tile comes out seamless with its mean and detail kept', () => {
    const w = 64;
    const h = 64;
    const n = noise(w * h, 3);
    // a ramp in both axes: the worst possible wrap edge, plus fine detail
    const src = grid(
      w,
      h,
      (x, y) => 0.2 + 0.5 * (x / w) * 0.6 + 0.3 * (y / h) + n[y * w + x] * 0.15,
    );
    const before = wrapSeamRatio(src, w, h);
    expect(before.x).toBeGreaterThan(3);
    expect(before.y).toBeGreaterThan(3);
    const p = periodicComponent(src, w, h);
    const after = wrapSeamRatio(p, w, h);
    // the wrap step is no larger than an ordinary neighbouring step
    expect(after.x).toBeLessThan(1.1);
    expect(after.y).toBeLessThan(1.1);
    expect(planeStats(p).mean).toBeCloseTo(planeStats(src).mean, 3);
    // what was removed is SMOOTH: the fine noise survives untouched
    const diff = grid(w, h, (x, y) => src[y * w + x] - p[y * w + x]);
    let rough = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        rough += Math.abs(4 * diff[i] - diff[i - 1] - diff[i + 1] - diff[i - w] - diff[i + w]);
      }
    }
    expect(rough / ((w - 2) * (h - 2))).toBeLessThan(0.002);
  });

  it('a real painted source tiles: its wrap edges match within an interior step', async () => {
    const { data, info } = await sharp(
      path.join(ROOT, 'scripts/assets/painted_ground/src/dirt.png'),
    )
      .resize(256, 256, { kernel: 'lanczos3' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const planes = planesFromSrgb8(data, 256, 256, info.channels);
    const before = wrapSeamRatio(luminance(planes), 256, 256);
    const healed = planes.map((p) => periodicComponent(p, 256, 256));
    const after = wrapSeamRatio(luminance(healed), 256, 256);
    expect(Math.max(before.x, before.y)).toBeGreaterThan(1.2);
    expect(after.x).toBeLessThan(1);
    expect(after.y).toBeLessThan(1);
  });

  it('refuses a tile that is not a power of two', () => {
    expect(() => periodicComponent(new Float32Array(12 * 12), 12, 12)).toThrow('power-of-two');
  });
});

describe('de-light', () => {
  it('divides out a baked gradient and vignette but keeps the fine detail', () => {
    const w = 64;
    const h = 64;
    const n = noise(w * h, 11);
    const light = (x: number, y: number) =>
      (0.6 + 0.4 * Math.cos((2 * Math.PI * x) / w)) * (0.8 + 0.2 * Math.sin((2 * Math.PI * y) / h));
    const src = grid(w, h, (x, y) => (0.3 + 0.2 * n[y * w + x]) * light(x, y));
    const [out] = delight([src, src, src], w, h, { sigmaCycles: 1.6, strength: 1 });
    const quadrant = (p: Float32Array, qx: number, qy: number) => {
      let s = 0;
      for (let y = qy * 32; y < qy * 32 + 32; y++)
        for (let x = qx * 32; x < qx * 32 + 32; x++) s += p[y * w + x];
      return s / 1024;
    };
    const qs = [quadrant(out, 0, 0), quadrant(out, 1, 0), quadrant(out, 0, 1), quadrant(out, 1, 1)];
    const qsBefore = [
      quadrant(src, 0, 0),
      quadrant(src, 1, 0),
      quadrant(src, 0, 1),
      quadrant(src, 1, 1),
    ];
    const spread = (q: number[]) =>
      (Math.max(...q) - Math.min(...q)) / (q.reduce((a, b) => a + b) / 4);
    expect(spread(qsBefore)).toBeGreaterThan(0.3);
    // a one-cycle light field is the band the de-light targets: most of it goes
    expect(spread(qs)).toBeLessThan(spread(qsBefore) / 4);
    // the detail is still there: neighbouring pixels still differ
    expect(wrapSeamRatio(out, w, h).x).toBeGreaterThan(0.3);
  });
});

describe('isotropize (generator banding)', () => {
  it('evens out same-way diagonal strokes and keeps the random detail', () => {
    // What an image generator leaves is a direction carrying more energy over
    // a broad band (strokes and bands all leaning one way), not one clean
    // sinusoid: model it as noise smeared along the diagonal over isotropic
    // noise.
    const w = 64;
    const h = 64;
    const n = noise(w * h, 5);
    const m = noise(w * h, 6);
    const at = (a: Float32Array, x: number, y: number) =>
      a[(((y % h) + h) % h) * w + (((x % w) + w) % w)];
    const streak = grid(w, h, (x, y) => {
      let acc = 0;
      for (let k = -6; k <= 6; k++) acc += at(m, x + k, y + k);
      return acc / 13 - 0.5;
    });
    const src = grid(w, h, (x, y) =>
      Math.exp(-1.2 + streak[y * w + x] * 2.2 + (n[y * w + x] - 0.5) * 0.3),
    );
    const opts = { minCycles: 2, maxCycles: 30 };
    const lg = (p: Float32Array) => Float32Array.from(p, (v) => Math.log(v + 1e-4));
    const before = directionalAnisotropy(lg(src), w, h, opts);
    // far more one-way than any generator banding (the real sources measure
    // 1.2 to 1.7), so one pass must take most of it out
    expect(before).toBeGreaterThan(4);
    const { planes, report } = isotropize([src, src, src], w, h, { ...opts, strength: 1 });
    const after = directionalAnisotropy(lg(planes[0]), w, h, opts);
    expect(after).toBeLessThan(before * 0.3);
    expect(report.after).toBeLessThan(report.before);
    // the noise detail survives: the log-domain spread stays substantial
    expect(planeStats(lg(planes[0])).sd).toBeGreaterThan(0.08);
    // strength 0 is the identity
    const id = isotropize([src, src, src], w, h, { ...opts, strength: 0 });
    for (let i = 0; i < src.length; i += 97) expect(id.planes[0][i]).toBeCloseTo(src[i], 4);
  });
});

describe('colour landing (normalizeColour)', () => {
  const w = 32;
  const h = 32;
  const n = noise(w * h * 3, 9);
  const green = [
    grid(w, h, (x, y) => 0.05 + n[y * w + x] * 0.06),
    grid(w, h, (x, y) => 0.1 + n[w * h + y * w + x] * 0.1),
    grid(w, h, (x, y) => 0.01 + n[2 * w * h + y * w + x] * 0.02),
  ];
  const lum = (c: number[]) => LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2];

  it('lands the mean luminance exactly and a grey target makes the mean tint-neutral', () => {
    const out = normalizeColour(green, { target: [0.42, 0.42, 0.42], chromaKeep: 0 });
    const m = planesMean(out);
    expect(lum(m)).toBeCloseTo(0.42, 2);
    expect(m[0]).toBeCloseTo(m[1], 2);
    expect(m[2]).toBeCloseTo(m[1], 2);
  });

  it('chromaKeep 1 keeps the painted hue; chromaVariation scales the colour variety', () => {
    const keep = normalizeColour(green, { target: [0.2, 0.2, 0.2], chromaKeep: 1 });
    const src = planesMean(green);
    const m = planesMean(keep);
    expect(m[1] / m[0]).toBeCloseTo(src[1] / src[0], 1);
    const chromaSd = (planes: Float32Array[]) => {
      const r = planes[0].map((v, i) => v / Math.max(1e-6, luminance(planes)[i]));
      return planeStats(r).sd;
    };
    const full = normalizeColour(green, { target: [0.4, 0.4, 0.4], chromaKeep: 0 });
    const half = normalizeColour(green, {
      target: [0.4, 0.4, 0.4],
      chromaKeep: 0,
      chromaVariation: 0.5,
    });
    expect(chromaSd(half)).toBeLessThan(chromaSd(full) * 0.65);
  });

  it('transfer functions invert', () => {
    for (const v of [0, 0.002, 0.04, 0.2, 0.5, 0.9, 1]) {
      expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 6);
    }
  });
});

describe('height, normal, cavity', () => {
  const w = 64;
  const h = 64;
  const disc = grid(w, h, (x, y) => (Math.hypot(x - 32, y - 32) < 8 ? 0.6 : 0.15));

  it('deriveHeight centres on 0.5 at the requested spread, a bright stone standing up', () => {
    const height = deriveHeight([disc, disc, disc], w, h, { detailSigmaPx: 10, spread: 0.17 });
    const st = planeStats(height);
    expect(st.mean).toBeCloseTo(0.5, 1);
    // the spread is set before the 0.02..0.98 clamp, which a two-level disc
    // leans on, so it lands a little under the requested 0.17
    expect(st.sd).toBeGreaterThan(0.09);
    expect(st.sd).toBeLessThan(0.18);
    expect(height[32 * w + 32]).toBeGreaterThan(height[4 * w + 4]);
    for (const v of height) {
      expect(v).toBeGreaterThanOrEqual(Math.fround(0.02));
      expect(v).toBeLessThanOrEqual(Math.fround(0.98));
    }
  });

  it('deriveNormal is flat on flat ground and follows the OpenGL convention (green up)', () => {
    const [r0, g0, b0] = deriveNormal(new Float32Array(w * h).fill(0.5), w, h, { strength: 8 });
    expect([r0[100], g0[100], b0[100]]).toEqual([0.5, 0.5, 1]);
    // height rising to the RIGHT tilts the normal to -x: red under 0.5
    const right = grid(w, h, (x) => 0.5 + 0.1 * Math.sin((2 * Math.PI * x) / w));
    const [rr, rg] = deriveNormal(right, w, h, { strength: 8 });
    expect(rr[10 * w + 3]).toBeLessThan(0.5);
    expect(rg[10 * w + 3]).toBeCloseTo(0.5, 6);
    // height rising DOWN the image (row index) faces the normal up it: green over 0.5
    const down = grid(w, h, (_x, y) => 0.5 + 0.1 * Math.sin((2 * Math.PI * y) / h));
    const [, dg] = deriveNormal(down, w, h, { strength: 8 });
    expect(dg[3 * w + 10]).toBeGreaterThan(0.5);
    // the normal tiles: column 0 reads column w-1 as its left neighbour
    const [wr] = deriveNormal(right, w, h, { strength: 8 });
    expect(wr[10 * w]).toBeCloseTo(
      wr[10 * w + w - 1] + (wr[10 * w + 1] - wr[10 * w + w - 1]) / 2,
      1,
    );
  });

  it('cavityMap darkens only what sits below its neighbourhood', () => {
    const pit = grid(w, h, (x, y) => (Math.hypot(x - 20, y - 20) < 4 ? 0.2 : 0.6));
    const cav = cavityMap(pit, w, h, { sigmaPx: 4, gain: 4 });
    expect(cav[20 * w + 20]).toBeLessThan(0.9);
    expect(cav[50 * w + 50]).toBe(1);
  });

  it('fitMeanSd lands a channel on the exact centring constants despite the clamp', () => {
    const skewed = noise(64 * 64, 13).map((v) => v * v);
    for (const spec of [GROUND_AO_PACK.r, GROUND_AO_PACK.g, GROUND_AO_PACK.b]) {
      const fit = fitMeanSd(skewed, spec.mean, spec.sd);
      expect(fit.mean).toBeCloseTo(spec.mean, 3);
      expect(fit.sd).toBeCloseTo(spec.sd, 3);
    }
  });

  it('downsample2x is a plain 2x2 box', () => {
    const p = Float32Array.from([1, 3, 5, 7, 2, 4, 6, 8, 0, 0, 1, 1, 0, 0, 1, 1]);
    expect(Array.from(downsample2x(p, 4, 4))).toEqual([2.5, 6.5, 0, 1]);
  });
});

describe('recipes', () => {
  it('every painted layer has a recipe, with a normal recipe exactly where it has a normal slot', () => {
    for (const layer of PAINTED_GROUND_LAYERS) {
      const recipe = PAINTED_GROUND_RECIPES[layer.source as keyof typeof PAINTED_GROUND_RECIPES];
      expect(recipe, layer.source).toBeDefined();
      expect(recipe.normal !== null, layer.source).toBe(layer.normalKey !== null);
    }
    // the relief channels are built from painted layers that exist
    for (const c of [GROUND_AO_PACK.r, GROUND_AO_PACK.g, GROUND_AO_PACK.b]) {
      expect(PAINTED_GROUND_LAYERS.some((l) => l.source === c.source)).toBe(true);
    }
  });

  it('processPaintedLayer heals the seam and lands the colour on a real source', async () => {
    const { data, info } = await sharp(
      path.join(ROOT, 'scripts/assets/painted_ground/src/grass.png'),
    )
      .resize(128, 128, { kernel: 'lanczos3' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const planes = planesFromSrgb8(data, 128, 128, info.channels);
    const { planes: out, report } = processPaintedLayer(
      planes,
      128,
      128,
      PAINTED_GROUND_RECIPES.grass,
    );
    expect(report.seamAfter.x).toBeLessThan(report.seamBefore.x);
    expect(report.seamAfter.x).toBeLessThan(1);
    // the generator's diagonal lean is measurably evened out
    expect(report.anisotropyAfter).toBeLessThan(report.anisotropyBefore);
    const m = planesMean(out);
    const target = PAINTED_GROUND_RECIPES.grass.colour.target;
    expect(LUMA[0] * m[0] + LUMA[1] * m[1] + LUMA[2] * m[2]).toBeCloseTo(
      LUMA[0] * target[0] + LUMA[1] * target[1] + LUMA[2] * target[2],
      2,
    );
    // the grass goes tint-neutral: no channel dominates its mean
    expect(Math.max(...m) / Math.min(...m)).toBeLessThan(1.05);
  });
});
