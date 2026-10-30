// The painted (LDR) sky encoder's pure core (scripts/assets/lib/
// sky_ldr_compression_core.mjs): the 2:1 resize plan, the sRGB round trip, the
// seam-free wrap blend, the zenith fill, the upload flip, the glow measurement,
// the job plan and the `ktx create` arguments. The shipped files themselves are
// pinned in tests/sky_ktx2_assets.test.ts; the script's I/O in
// tests/sky_ldr_compression_script.test.ts.
import { describe, expect, it } from 'vitest';
import {
  buildKtxLdrSkyArgs,
  decodeSrgb,
  equirectResizePlan,
  equirectSize,
  flipRowsInPlace,
  gaussianBlur,
  linearToSrgbByte,
  measureGlowU,
  POLE_FILL_DEG,
  parseArgs,
  poleFillInPlace,
  poleFillRows,
  poleSampleRows,
  prepareSkyPixels,
  removePointStarsInPlace,
  SKY_LDR_SOURCES,
  SKY_LDR_STEMS,
  SKY_SHARPEN,
  STAR_DENSITY_BLUR_DEG,
  STAR_REMOVE_RADIUS_AT_2K,
  sharpenSkyInPlace,
  skyLdrJobs,
  skyLdrPaths,
  srgbByteToLinear,
  starDensityAlpha,
  starRemoveRadius,
  WRAP_BLEND_DEG,
  wrapBandPx,
  wrapBlendInPlace,
  wrapBlendWeight,
} from '../scripts/assets/lib/sky_ldr_compression_core.mjs';

/** A W x H single-channel test image whose value is f(x, y). */
function image(width: number, height: number, f: (x: number, y: number) => number): Float64Array {
  const px = new Float64Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) px[y * width + x] = f(x, y);
  return px;
}

describe('the exact 2:1 resize plan', () => {
  it('maps every variant to an exact 2:1 equirect at its tier width', () => {
    expect(equirectSize('2k')).toEqual({ width: 2048, height: 1024 });
    expect(equirectSize('1k')).toEqual({ width: 1024, height: 512 });
    expect(equirectSize('512')).toEqual({ width: 512, height: 256 });
    expect(() => equirectSize('4k')).toThrow('unknown sky variant');
  });

  it('scales the delivered 1774x887 paintings by the same factor on both axes', () => {
    const plan = equirectResizePlan(1774, 887, '2k');
    expect(plan.width).toBe(2048);
    expect(plan.height).toBe(1024);
    expect(plan.scaleX).toBeCloseTo(2048 / 1774, 12);
    expect(plan.scaleY).toBeCloseTo(plan.scaleX, 12);
    expect(plan.aspectError).toBe(0);
  });

  it('stretches a source that is not 2:1 to fill, and reports how far off it was', () => {
    // A 3:2 source covers the same 360 x 180 degrees, so it is stretched, never
    // cropped; the anisotropy is reported rather than hidden.
    const plan = equirectResizePlan(1536, 1024, '1k');
    expect([plan.width, plan.height]).toEqual([1024, 512]);
    expect(plan.scaleX).toBeCloseTo(1024 / 1536, 12);
    expect(plan.scaleY).toBeCloseTo(0.5, 12);
    expect(plan.aspectError).toBeCloseTo(-0.25, 12);
    expect(equirectResizePlan(4096, 1024, '1k').aspectError).toBeCloseTo(1, 12);
  });

  it('refuses unreadable source dimensions', () => {
    expect(() => equirectResizePlan(0, 512, '1k')).toThrow('unreadable');
    expect(() => equirectResizePlan(1024.5, 512, '1k')).toThrow('unreadable');
    expect(() => equirectResizePlan(Number.NaN, 512, '1k')).toThrow('unreadable');
  });

  it('sizes the blend bands by angle, so every tier covers the same sky', () => {
    expect(wrapBandPx(2048)).toBe(Math.round((2048 * WRAP_BLEND_DEG) / 360));
    expect(wrapBandPx(512)).toBe(Math.round((512 * WRAP_BLEND_DEG) / 360));
    expect(poleFillRows(1024)).toBe(Math.round((1024 * POLE_FILL_DEG) / 180));
    expect(poleFillRows(256)).toBe(Math.round((256 * POLE_FILL_DEG) / 180));
    // Floors and ceilings for degenerate sizes.
    expect(wrapBandPx(4)).toBe(2);
    expect(poleSampleRows(4)).toBe(1);
    expect(poleFillRows(2)).toBe(2);
  });
});

describe('the sRGB round trip', () => {
  it('returns every byte unchanged, so pixels the blends never touch stay bit-exact', () => {
    for (let v = 0; v < 256; v++) expect(linearToSrgbByte(srgbByteToLinear(v))).toBe(v);
  });

  it('follows the IEC 61966-2-1 curve and clamps out-of-range light', () => {
    expect(srgbByteToLinear(0)).toBe(0);
    expect(srgbByteToLinear(255)).toBe(1);
    expect(srgbByteToLinear(128)).toBeCloseTo(0.2158605, 6);
    expect(linearToSrgbByte(-1)).toBe(0);
    expect(linearToSrgbByte(2)).toBe(255);
    expect(Array.from(decodeSrgb(Uint8Array.from([0, 255])))).toEqual([0, 1]);
  });
});

describe('the horizontal wrap blend', () => {
  it('weights the seam fully and fades to nothing at the band edge with zero slope', () => {
    expect(wrapBlendWeight(0, 10)).toBe(1);
    expect(wrapBlendWeight(10, 10)).toBe(0);
    expect(wrapBlendWeight(5, 10)).toBeCloseTo(0.5, 12);
    for (let k = 1; k <= 10; k++) {
      expect(wrapBlendWeight(k, 10)).toBeLessThan(wrapBlendWeight(k - 1, 10));
    }
    // Zero slope at both ends: the first and last steps are the smallest.
    const steps = Array.from(
      { length: 10 },
      (_, k) => wrapBlendWeight(k, 10) - wrapBlendWeight(k + 1, 10),
    );
    expect(steps[0]).toBeLessThan(steps[4]);
    expect(steps[9]).toBeLessThan(steps[5]);
  });

  it('makes the two edge columns meet in one colour and leaves the interior untouched', () => {
    // A horizontal ramp: the left edge is dark, the right edge bright, so the
    // raw seam steps from 1.0 straight back to 0.0.
    const width = 64;
    const height = 3;
    const px = image(width, height, (x) => x / (width - 1));
    const before = px.slice();
    wrapBlendInPlace(px, width, height, 1, 8);
    for (let y = 0; y < height; y++) {
      const row = y * width;
      // The seam: u = 1 meets u = 0 at the very same value, their mean.
      expect(px[row]).toBeCloseTo(0.5, 12);
      expect(px[row + width - 1]).toBeCloseTo(0.5, 12);
      // Mirror symmetry about the seam inside the band.
      for (let k = 0; k < 8; k++) {
        expect(px[row + k] + px[row + width - 1 - k]).toBeCloseTo(
          before[row + k] + before[row + width - 1 - k],
          12,
        );
      }
      // Nothing past the band moves.
      for (let x = 8; x < width - 8; x++) expect(px[row + x]).toBe(before[row + x]);
    }
  });

  it('leaves an image already symmetric about the seam exactly as it was', () => {
    const width = 32;
    const px = image(
      width,
      4,
      (x, y) => 0.25 + 0.1 * y + 0.2 * Math.cos((2 * Math.PI * (x + 0.5)) / width),
    );
    const before = px.slice();
    wrapBlendInPlace(px, width, 4, 1, 6);
    for (let i = 0; i < px.length; i++) expect(px[i]).toBeCloseTo(before[i], 12);
  });

  it('blends each channel on its own and never touches a band wider than half the image', () => {
    const width = 8;
    const px = new Float64Array(width * 2);
    for (let x = 0; x < width; x++) {
      px[x * 2] = x === 0 ? 1 : 0; // channel 0: a lone bright left edge
      px[x * 2 + 1] = 0.5; // channel 1: flat
    }
    wrapBlendInPlace(px, width, 1, 2, 100);
    expect(px[0]).toBeCloseTo(0.5, 12);
    expect(px[(width - 1) * 2]).toBeCloseTo(0.5, 12);
    for (let x = 0; x < width; x++) expect(px[x * 2 + 1]).toBe(0.5);
  });
});

describe('the zenith fill', () => {
  it('turns the top row into one colour, so the pole cannot pinch, and stops at its radius', () => {
    const width = 16;
    const height = 40;
    // Stripes along x: exactly what converges into a star at the zenith.
    const px = image(width, height, (x) => (x % 2 === 0 ? 0.2 : 0.6));
    const before = px.slice();
    const zenith = poleFillInPlace(px, width, height, 1, 10, 3);
    expect(zenith[0]).toBeCloseTo(0.4, 12);
    for (let x = 0; x < width; x++) expect(px[x]).toBeCloseTo(0.4, 12);
    // Rows ease back to the painting with depth...
    const spread = (y: number) => Math.abs(px[y * width] - px[y * width + 1]);
    for (let y = 1; y < 10; y++) expect(spread(y)).toBeGreaterThan(spread(y - 1));
    // ...and nothing from the fill radius down moves.
    for (let i = 10 * width; i < px.length; i++) expect(px[i]).toBe(before[i]);
  });

  it('weights the zenith colour by each sampled ring of sky', () => {
    // The top row is a smaller ring than the next, so it counts for less.
    const width = 4;
    const height = 10;
    const px = image(width, height, (_x, y) => (y === 0 ? 1 : 0));
    const zenith = poleFillInPlace(px.slice(), width, height, 1, 1, 2);
    const ring = (y: number) => Math.sin(((y + 0.5) / height) * Math.PI);
    expect(zenith[0]).toBeCloseTo(ring(0) / (ring(0) + ring(1)), 12);
    expect(zenith[0]).toBeLessThan(0.5);
  });
});

describe('the bottom-first flip and the glow measurement', () => {
  it('reverses the rows for the compressed upload, and flipping twice is the identity', () => {
    const px = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    flipRowsInPlace(px, 1, 3, 3);
    expect(Array.from(px)).toEqual([7, 8, 9, 4, 5, 6, 1, 2, 3]);
    flipRowsInPlace(px, 1, 3, 3);
    expect(Array.from(px)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('finds a painted glow just above the horizon, including one across the seam', () => {
    const width = 200;
    const height = 100;
    const glowAt = (u: number) =>
      image(width, height, (x, y) => {
        const du = Math.min(Math.abs(x / width - u), 1 - Math.abs(x / width - u));
        const aboveHorizon = y < height / 2 && y > height / 2 - 8;
        return aboveHorizon ? Math.exp(-((du / 0.03) ** 2)) : 0.05;
      });
    expect(measureGlowU(glowAt(0.665), width, height, 1)).toBeCloseTo(0.665, 2);
    expect(measureGlowU(glowAt(0.497), width, height, 1)).toBeCloseTo(0.497, 2);
    const seam = measureGlowU(glowAt(0.995), width, height, 1);
    expect(Math.min(seam, 1 - seam)).toBeLessThan(0.02);
  });

  it('runs the whole pre-process: seam, pole, then the flip, without touching its input', () => {
    const width = 72;
    const height = 36;
    const rgb = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 3;
        rgb[i] = (x * 3) % 256;
        rgb[i + 1] = 40 + y;
        rgb[i + 2] = x % 2 === 0 ? 120 : 200;
      }
    }
    const input = rgb.slice();
    const { pixels, zenith } = prepareSkyPixels(rgb, width, height, 3);
    expect(Array.from(rgb)).toEqual(Array.from(input));
    expect(zenith).toHaveLength(3);
    const at = (x: number, y: number, c: number) => pixels[(y * width + x) * 3 + c];
    // The LAST stored row is the zenith (bottom-first): one colour along it.
    for (let x = 1; x < width; x++) {
      for (let c = 0; c < 3; c++) expect(at(x, height - 1, c)).toBe(at(0, height - 1, c));
    }
    // Every stored row wraps: its two edge texels are the same colour.
    for (let y = 0; y < height; y++) {
      for (let c = 0; c < 3; c++) expect(at(0, y, c)).toBe(at(width - 1, y, c));
    }
    // The FIRST stored row is the painting's bottom row, outside both blends'
    // reach in the middle columns, so it is the input's bottom row bit for bit.
    for (let x = wrapBandPx(width); x < width - wrapBandPx(width); x++) {
      for (let c = 0; c < 3; c++)
        expect(at(x, 0, c)).toBe(input[((height - 1) * width + x) * 3 + c]);
    }
  });
});

describe('the job plan and the encoder arguments', () => {
  it('ships the day and the night as dome skies and the env as the PMREM source only', () => {
    expect(SKY_LDR_STEMS).toEqual(['vale_painted_day', 'vale_painted_env', 'vale_painted_night']);
    const jobs = skyLdrJobs();
    expect(jobs.map((j) => [j.source, j.target, j.width, j.height])).toEqual([
      ['vale_painted_day.png', 'vale_painted_day_2k.ktx2', 2048, 1024],
      ['vale_painted_day.png', 'vale_painted_day_1k.ktx2', 1024, 512],
      ['vale_painted_env.png', 'vale_painted_env_512.ktx2', 512, 256],
      ['vale_painted_night.png', 'vale_painted_night_2k.ktx2', 2048, 1024],
      ['vale_painted_night.png', 'vale_painted_night_1k.ktx2', 1024, 512],
    ]);
    expect(skyLdrJobs(['vale_painted_night'])).toHaveLength(2);
    expect(() => skyLdrJobs(['vale_day'])).toThrow('unknown painted sky stem');
    // every dome sky ships both dome tiers; the env ships the prefilter source alone
    for (const s of SKY_LDR_SOURCES) {
      if (s.stem === 'vale_painted_env') expect(s.variants).toEqual(['512']);
      else expect(s.variants.includes('2k') && s.variants.includes('1k'), s.stem).toBe(true);
    }
    const paths = skyLdrPaths(jobs[0], { srcDir: '/in', outDir: '/out' });
    expect(paths).toEqual({
      srcPath: '/in/vale_painted_day.png',
      dstPath: '/out/vale_painted_day_2k.ktx2',
    });
  });

  it('encodes UASTC LDR + zstd, sRGB, single level, deterministic', () => {
    const args = buildKtxLdrSkyArgs({ srcPath: 'in.png', dstPath: 'out.ktx2' });
    const line = args.join(' ');
    expect(args[0]).toBe('create');
    // UASTC, not ETC1S: the measured banding verdict (see the core).
    expect(line).toContain('--encode uastc');
    expect(line).not.toContain('basis-lz');
    expect(line).toContain('--zstd 18');
    // sRGB in the DFD is the whole colour-space story: the GPU decodes to linear.
    expect(line).toContain('--format R8G8B8_SRGB');
    expect(line).toContain('--assign-tf srgb');
    expect(line).toContain('--assign-primaries bt709');
    // One level: no mip chain, so no seam line from a mip pick at the u wrap.
    expect(line).not.toContain('mipmap');
    // Determinism: one encoder thread and single-threaded RDO.
    expect(line).toContain('--threads 1');
    expect(args).toContain('--uastc-rdo-m');
    expect(args.slice(-2)).toEqual(['in.png', 'out.ktx2']);
  });

  it('parses the source and output directories, the dry run and the stems', () => {
    const opts = parseArgs(['--src', 'a', '--out', 'b', '--dry-run', 'vale_painted_day'], {
      srcDir: 'skies_in',
      outDir: 'public/env',
    });
    expect(opts).toEqual({ srcDir: 'a', outDir: 'b', dryRun: true, stems: ['vale_painted_day'] });
    expect(parseArgs([], { srcDir: 's', outDir: 'o' })).toEqual({
      srcDir: 's',
      outDir: 'o',
      dryRun: false,
      stems: [],
    });
  });
});

describe('removePointStarsInPlace', () => {
  // A quarter of the 2k variant's width, so the big-star distances (which scale with
  // the variant) reach the 12 pixel arms painted below.
  const W = 512;
  const H = 256;
  const BG = 0.02;
  const make = () => {
    const px = new Float64Array(W * H * 3).fill(BG);
    const set = (x: number, y: number, v: number) => {
      const o = (y * W + x) * 3;
      px[o] = v;
      px[o + 1] = v;
      px[o + 2] = v;
    };
    // a 2x2 small star
    for (const [x, y] of [
      [10, 10],
      [11, 10],
      [10, 11],
      [11, 11],
    ])
      set(x, y, 0.9);
    // a BIG four-point star: a bright 3x3 core peaking at its centre, thin arms out
    // 12 pixels each way
    for (let d = -1; d <= 1; d++) for (let e = -1; e <= 1; e++) set(30 + d, 40 + e, 0.95);
    set(30, 40, 1);
    for (let k = 2; k <= 12; k++) {
      const v = 0.6 * (1 - k / 13);
      set(30 + k, 40, v);
      set(30 - k, 40, v);
      set(30, 40 + k, v);
      set(30, 40 - k, v);
    }
    // a moonlit cloud: a broad 16x10 body under a thin bright rim along its top
    for (let y = 16; y < 26; y++) for (let x = 60; x < 76; x++) set(x, y, 0.3);
    for (let x = 58; x < 78; x++) set(x, 15, 0.6);
    // a lone thin bright line with no star at its heart (a rim seen edge on)
    for (let x = 90; x < 112; x++) set(x, 50, 0.6);
    return px;
  };
  const at = (px: Float64Array, x: number, y: number) => px[(y * W + x) * 3];

  it('removes small stars and big four-point stars with their arms, filled with the sky round them', () => {
    const px = make();
    const removed = removePointStarsInPlace(px, W, H, 3, 3);
    expect(removed).toBeGreaterThanOrEqual(2);
    // The small star and the big star's core and arms are gone...
    expect(at(px, 10, 10)).toBeLessThan(0.05);
    expect(at(px, 30, 40)).toBeLessThan(0.05);
    for (const [x, y] of [
      [36, 40],
      [24, 40],
      [30, 46],
      [30, 34],
    ]) {
      expect(at(px, x, y)).toBeLessThan(0.05);
    }
    // ...filled with the sky's own colour, never a dark speck or a grey disc.
    expect(at(px, 10, 10)).toBeGreaterThan(BG * 0.8);
    expect(at(px, 30, 40)).toBeGreaterThan(BG * 0.8);
    // Untouched sky stays exactly as it was.
    expect(at(px, 3, 3)).toBe(BG);
  });

  it('keeps cloud bodies, their thin moonlit rims, and lone bright lines whole', () => {
    const px = make();
    removePointStarsInPlace(px, W, H, 3, 3);
    expect(at(px, 68, 20)).toBe(0.3);
    // A bare square opening flattened every rim thinner than its window; a line
    // crosses the isolation ring, so it is never taken for a star.
    for (let x = 60; x < 76; x += 3) expect(at(px, x, 15)).toBe(0.6);
    for (let x = 92; x < 110; x += 3) expect(at(px, x, 50)).toBe(0.6);
  });

  it('counts each removed star at its centre for the density map', () => {
    const px = make();
    const count = new Float64Array(W * H);
    const removed = removePointStarsInPlace(px, W, H, 3, 3, count);
    let total = 0;
    for (const v of count) total += v;
    expect(total).toBeGreaterThan(1);
    expect(total).toBeLessThanOrEqual(removed);
    // The big star is counted at its own centre, the rims and lines nowhere.
    expect(count[40 * W + 30]).toBeGreaterThan(0);
    for (let x = 58; x < 78; x++) expect(count[15 * W + x]).toBe(0);
    for (let x = 90; x < 112; x++) expect(count[50 * W + x]).toBe(0);
  });

  it('scales the radius with the variant width, never under one pixel', () => {
    expect(starRemoveRadius(2048)).toBe(STAR_REMOVE_RADIUS_AT_2K);
    expect(starRemoveRadius(1024)).toBe(Math.round(STAR_REMOVE_RADIUS_AT_2K / 2));
    expect(starRemoveRadius(64)).toBe(1);
  });

  it('is applied only to the night source', () => {
    const night = skyLdrJobs().filter((j) => j.removeStars);
    expect(night.length).toBeGreaterThan(0);
    expect(night.every((j) => j.stem === 'vale_painted_night')).toBe(true);
  });
});

describe('the star density alpha', () => {
  it('turns the removed stars into a smooth 0 to 1 map, densest where they cluster', () => {
    const W = 360;
    const H = 180;
    const count = new Float64Array(W * H);
    // A dense band of stars across the upper sky, a lone star elsewhere, none below.
    for (let x = 0; x < W; x += 3) count[40 * W + x] = 1;
    count[100 * W + 200] = 1;
    const alpha = starDensityAlpha(count, W, H);
    expect(Math.max(...alpha)).toBe(1);
    expect(Math.min(...alpha)).toBe(0);
    for (const v of alpha) expect(v).toBeGreaterThanOrEqual(0);
    // Densest along the band, faint round the lone star, empty far below.
    expect(alpha[40 * W + 90]).toBe(1);
    expect(alpha[100 * W + 200]).toBeLessThan(alpha[40 * W + 90]);
    expect(alpha[170 * W + 90]).toBe(0);
    // Smooth: blurred over STAR_DENSITY_BLUR_DEG of sky (a degree per pixel here).
    expect(alpha[(40 + STAR_DENSITY_BLUR_DEG) * W + 90]).toBeGreaterThan(0.3);
    // It wraps round the seam like the sky does.
    expect(alpha[40 * W]).toBeCloseTo(alpha[40 * W + 3], 6);
  });

  it('is all zero when the painting had no stars at all', () => {
    expect(Math.max(...starDensityAlpha(new Float64Array(64 * 32), 64, 32))).toBe(0);
  });
});

describe('the gaussian blur and the brush edge boost', () => {
  it('blurs with the energy kept, wrapping x round the seam and clamping y', () => {
    const W = 64;
    const H = 32;
    const src = new Float64Array(W * H);
    src[10 * W + 0] = 1;
    const out = gaussianBlur(src, W, H, 2);
    let total = 0;
    for (const v of out) total += v;
    expect(total).toBeCloseTo(1, 9);
    // Spread across the seam to the far edge, symmetrically.
    expect(out[10 * W + (W - 1)]).toBeCloseTo(out[10 * W + 1], 12);
    expect(Array.from(gaussianBlur(src, W, H, 0))).toEqual(Array.from(src));
  });

  it('crisps a soft brush edge without moving flat paint or the gradient between', () => {
    const W = 64;
    const H = 16;
    const px = new Float64Array(W * H * 3);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // a soft edge from sky blue to cloud white across x 28 to 36
        const t = Math.min(1, Math.max(0, (x - 28) / 8));
        const o = (y * W + x) * 3;
        px[o] = 0.1 + 0.6 * t;
        px[o + 1] = 0.2 + 0.55 * t;
        px[o + 2] = 0.5 + 0.3 * t;
      }
    }
    const before = px.slice();
    sharpenSkyInPlace(px, W, H, 3);
    const lum = (a: Float64Array, x: number) => {
      const o = (8 * W + x) * 3;
      return 0.2126 * a[o] + 0.7152 * a[o + 1] + 0.0722 * a[o + 2];
    };
    // The edge steepens: darker just below it, brighter just above it...
    expect(lum(px, 29)).toBeLessThan(lum(before, 29));
    expect(lum(px, 35)).toBeGreaterThan(lum(before, 35));
    // ...while flat paint far from it (and from the wrapped seam, which this test
    // image does not blend) is untouched, exactly.
    for (const x of [12, 16, 46, 50]) {
      for (let c = 0; c < 3; c++) expect(px[(8 * W + x) * 3 + c]).toBe(before[(8 * W + x) * 3 + c]);
    }
    // Hue is kept: each channel moves by the same ratio.
    const o = (8 * W + 35) * 3;
    expect(px[o] / before[o]).toBeCloseTo(px[o + 2] / before[o + 2], 9);
    // A zero amount is a no-op.
    const flat = before.slice();
    sharpenSkyInPlace(flat, W, H, 3, { ...SKY_SHARPEN, amount: 0 });
    expect(Array.from(flat)).toEqual(Array.from(before));
  });
});

describe('the pre-process output and the encoder flags', () => {
  it('writes the night as RGBA with its star density in alpha, the day as RGB', () => {
    const W = 96;
    const H = 48;
    const rgb = new Uint8Array(W * H * 3).fill(30);
    // a few bright 2x2 stars in the upper half
    for (const [x, y] of [
      [20, 10],
      [50, 12],
      [70, 8],
    ]) {
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]) {
        const o = ((y + dy) * W + x + dx) * 3;
        rgb[o] = 240;
        rgb[o + 1] = 240;
        rgb[o + 2] = 250;
      }
    }
    const day = prepareSkyPixels(rgb, W, H, 3, { sharpen: true });
    expect(day.channels).toBe(3);
    expect(day.pixels.length).toBe(W * H * 3);
    const night = prepareSkyPixels(rgb, W, H, 3, { removeStars: true, sharpen: true });
    expect(night.channels).toBe(4);
    expect(night.pixels.length).toBe(W * H * 4);
    // Stored bottom row first: the top (starry) rows are at the END of the buffer.
    const alphaAt = (x: number, row: number) => night.pixels[((H - 1 - row) * W + x) * 4 + 3];
    expect(alphaAt(50, 12)).toBeGreaterThan(alphaAt(50, 44));
    // The stars themselves are gone from the colour.
    const red = (x: number, row: number) => night.pixels[((H - 1 - row) * W + x) * 4];
    expect(red(50, 12)).toBeLessThan(80);
  });

  it('asks ktx for RGBA sRGB only when the alpha carries the density', () => {
    expect(buildKtxLdrSkyArgs({ srcPath: 'a', dstPath: 'b' })).toContain('R8G8B8_SRGB');
    const rgba = buildKtxLdrSkyArgs({ srcPath: 'a', dstPath: 'b', alpha: true });
    expect(rgba).toContain('R8G8B8A8_SRGB');
    expect(rgba).not.toContain('R8G8B8_SRGB');
    expect(rgba.join(' ')).toContain('--assign-tf srgb');
  });

  it('boosts brush edges on every dome variant and never on the PMREM source', () => {
    const jobs = skyLdrJobs();
    for (const job of jobs) expect(job.sharpen, job.target).toBe(job.variant !== '512');
    expect(jobs.filter((j) => j.removeStars).map((j) => j.target)).toEqual([
      'vale_painted_night_2k.ktx2',
      'vale_painted_night_1k.ktx2',
    ]);
  });
});
