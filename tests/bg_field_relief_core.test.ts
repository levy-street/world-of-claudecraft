// The shared Thornhollow Fields relief rasterizer (src/ui/bg_field_relief_core.ts): the
// pure half of both battleground map backgrounds (the M-key field plan and the
// cached minimap raster). Node-testable by construction, so these are behavior
// assertions on the pixels, not source-text guesses.
//
// What is worth pinning here is what a painter would silently get wrong: that
// the buffer is fully painted and opaque (a half-filled sheet blits as a
// transparent hole), that the hypsometric ordering matches the real field (the
// sunken Ruin Courtyard must not read like a keep terrace), and above all that
// the origin/pxPerYard mapping runs in the map's direction, +x toward column 0
// and +z toward row 0. That last one cannot be caught by comparing terrain
// samples: the field is point-symmetric, so a mirrored raster still shows a
// plausible field. It IS caught by shifting the origin by a known offset and
// asserting the raster shifts the matching way.

import { describe, expect, it } from 'vitest';
import { BG_HALF_X, BG_HALF_Z } from '../src/sim/battleground_layout';
import { TH_GRAVEYARDS, TH_PAINT_SWATCHES } from '../src/sim/thornhollow_field.generated';
import {
  BG_SURFACE_DIRT,
  BG_SURFACE_FLAGSTONE,
  BG_SURFACE_GRASS,
  BG_SURFACE_GRAVE,
  bgFieldSurfaceAt,
  paintBgFieldAtlas,
  paintBgFieldRelief,
} from '../src/ui/bg_field_relief_core';

const CHANNELS = 4;

function paint(
  w: number,
  h: number,
  pxPerYard: number,
  originX: number,
  originZ: number,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * CHANNELS);
  paintBgFieldRelief(data, w, h, pxPerYard, originX, originZ);
  return data;
}

/** The rgb of pixel (ix, iy) in a `w`-wide buffer. */
function pixel(data: Uint8ClampedArray, w: number, ix: number, iy: number): number[] {
  const k = (iy * w + ix) * CHANNELS;
  return [data[k], data[k + 1], data[k + 2], data[k + 3]];
}

/** Perceived brightness, the one thing the hypsometric ramp is ordered by. */
function luma(rgb: number[]): number {
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}

/** One field point, sampled with no left neighbour so hillshade cannot tilt it. */
function tone(x: number, z: number): number {
  return luma(pixel(paint(1, 1, 1, x + 0.5, z + 0.5), 1, 0, 0));
}

describe('bg_field_relief_core: the shaded field underlay', () => {
  it('fills every pixel opaquely (a partial sheet would blit as a hole)', () => {
    const w = 40;
    const h = 70;
    const data = paint(w, h, 1, BG_HALF_X, BG_HALF_Z);
    expect(data).toHaveLength(w * h * CHANNELS);
    for (let i = 0; i < w * h; i++) {
      expect(data[i * CHANNELS + 3]).toBe(255);
    }
    // and it is not one flat colour: the sheet crosses the terrace front.
    const distinct = new Set<string>();
    for (let i = 0; i < w * h; i++) {
      distinct.add(`${data[i * CHANNELS]},${data[i * CHANNELS + 1]},${data[i * CHANNELS + 2]}`);
    }
    expect(distinct.size).toBeGreaterThan(8);
  });

  it('is deterministic: same buffer for the same request', () => {
    const a = paint(24, 24, 2, 40, 40);
    const b = paint(24, 24, 2, 40, 40);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('orders the ramp by real field height: bowl darkest, keep terrace lightest', () => {
    // Four rungs of the ACTUAL field, deepest first. The relief is shallow by
    // design (about five yards top to bottom), which is exactly why the ramp
    // has to stay ordered: a ramp packed for the old 40yd field would flatten
    // all four of these into one tone.
    const bowl = tone(0, 0); // the bottom of the Ruin Courtyard bowl, about -2.3yd
    const shoulder = tone(0, -30); // the bowl's shoulder, about -1.4yd
    const chamber = tone(0, -90); // the field chamber the flag run crosses, about 0.2yd
    const terrace = tone(0, -120); // the Crimson keep terrace, about 2.1yd
    expect(bowl).toBeLessThan(shoulder);
    expect(shoulder).toBeLessThan(chamber);
    expect(chamber).toBeLessThan(terrace);
    // And the spread is worth having: the deepest and highest ground on the
    // field must be visibly different, not two neighbouring greys.
    expect(terrace - bowl).toBeGreaterThan(30);
  });

  it('maps +x toward column 0 (the map is drawn east-left)', () => {
    // Two sheets over the same ground, the second's origin one yard further
    // along -x: every column of the second must reproduce the NEXT column of
    // the first. A raster built with the x axis the other way round would
    // reproduce the PREVIOUS one instead, which is the mirrored plan bug.
    const w = 12;
    const a = paint(w, 3, 1, 45, 45);
    const b = paint(w, 3, 1, 44, 45);
    for (let iy = 0; iy < 3; iy++) {
      // column 0 of each sheet has no left neighbour, so start at 1.
      for (let ix = 1; ix < w - 1; ix++) {
        expect(pixel(b, w, ix, iy)).toEqual(pixel(a, w, ix + 1, iy));
      }
    }
  });

  it('maps +z toward row 0 (the away half is drawn up)', () => {
    const w = 6;
    const h = 12;
    const a = paint(w, h, 1, 45, 45);
    const b = paint(w, h, 1, 45, 44);
    for (let iy = 0; iy < h - 1; iy++) {
      for (let ix = 1; ix < w; ix++) {
        expect(pixel(b, w, ix, iy)).toEqual(pixel(a, w, ix, iy + 1));
      }
    }
  });

  it('honours pxPerYard: a finer sheet covers the same ground in more pixels', () => {
    // Both sheets span the same 8x8yd window off the same origin, one at 1 and
    // one at 2 px/yd, so they must describe the same ground rather than two
    // different windows. Compared as mean tone, since the finer sheet samples
    // between the coarse one's cells (bilinear heights) and shades against
    // nearer neighbours.
    const mean = (data: Uint8ClampedArray): number => {
      let sum = 0;
      const n = data.length / CHANNELS;
      for (let i = 0; i < n; i++) {
        sum += luma([data[i * CHANNELS], data[i * CHANNELS + 1], data[i * CHANNELS + 2]]);
      }
      return sum / n;
    };
    // Sampled over FLAT ground (the floor of the courtyard bowl): the
    // hillshade reads a per-PIXEL height difference, so on a slope the two
    // resolutions legitimately shade differently and would prove nothing about
    // the mapping.
    const coarse = mean(paint(8, 8, 1, 4, 4));
    const fine = mean(paint(16, 16, 2, 4, 4));
    expect(Math.abs(fine - coarse)).toBeLessThan(3);
    expect(coarse).toBeGreaterThan(0);
    // and the ramp really is doing work: the same-sized window over the keep
    // terrace front is a different tone entirely.
    const terrace = mean(paint(8, 8, 1, 4, -108));
    expect(Math.abs(terrace - coarse)).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// The ATLAS plate raster (the M-map's field surface), the second style over the
// same field. Everything above still holds for the minimap's wash; what is new
// here is the authored GROUND PAINT driving the base colour, and the fact that
// the away team's view is produced by walking the field the other way round
// rather than by rotating a finished raster.

function atlas(
  w: number,
  h: number,
  pxPerYard: number,
  originX: number,
  originZ: number,
  axis: 1 | -1,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * CHANNELS);
  paintBgFieldAtlas(data, w, h, pxPerYard, originX, originZ, axis);
  return data;
}

/** Mean channel-by-channel colour of a whole buffer. */
function meanRgb(data: Uint8ClampedArray): number[] {
  const out = [0, 0, 0];
  const n = data.length / CHANNELS;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) out[c] += data[i * CHANNELS + c];
  }
  return out.map((v) => v / n);
}

describe('bg_field_relief_core: the authored ground paint the atlas plate reads', () => {
  it('sorts every authored swatch into one of the three drawn families', () => {
    // The classifier reads the swatch's TEXTURE name, so a re-authored map that
    // swaps one grass for another keeps painting grass. A map that grows a
    // FOURTH kind of surface should show up here as an unclassified texture
    // rather than silently reading as turf on the plate.
    const seen = new Set<number>();
    for (const swatch of TH_PAINT_SWATCHES) {
      expect(swatch.texture).toMatch(/^(?:Grass|Cobblestone|Ground)/);
      seen.add(
        swatch.texture.startsWith('Cobblestone')
          ? BG_SURFACE_FLAGSTONE
          : swatch.texture.startsWith('Ground')
            ? BG_SURFACE_DIRT
            : BG_SURFACE_GRASS,
      );
    }
    expect([...seen].sort()).toEqual([BG_SURFACE_GRASS, BG_SURFACE_FLAGSTONE, BG_SURFACE_DIRT]);
  });

  it('reads the real authored surface under named places on the field', () => {
    // Ground truth from the map: the heart ruin and the keep courts are paved,
    // the graveyard plot is grave ground, the open field chamber is turf. A grid
    // read with the axes crossed would answer these with each other's values.
    expect(bgFieldSurfaceAt(0, 0)).toBe(BG_SURFACE_FLAGSTONE); // the hollow heart ruin
    expect(bgFieldSurfaceAt(0, -118)).toBe(BG_SURFACE_FLAGSTONE); // the Crimson flag stand
    expect(bgFieldSurfaceAt(33, -130)).toBe(BG_SURFACE_GRAVE); // the Crimson graveyard plot
    expect(bgFieldSurfaceAt(0, -82)).toBe(BG_SURFACE_GRASS); // the Crimson field chamber
    // The worn dirt lanes are still a family of their own: the graveyard stamp
    // replaced the plots, not every scrap of dirt on the field.
    const lanes: number[] = [];
    for (let x = -48; x <= 48; x += 1) {
      for (let z = -138; z <= 138; z += 1) lanes.push(bgFieldSurfaceAt(x, z));
    }
    expect(lanes.filter((f) => f === BG_SURFACE_DIRT).length).toBeGreaterThan(0);
  });

  it('stamps both graveyard plots as their own surface, edge to edge and no wider', () => {
    // The plot is drawn GROUND on the plate rather than a flat rectangle laid
    // over it, which is what earns it the hypsometric tint, the mottle, the
    // hillshade and the inked boundary. Decisive on both sides: every cell
    // inside the authored rails reads grave, and the ground a stride outside
    // the rails does not (a stamp that leaked would swallow the keep terrace).
    expect(TH_GRAVEYARDS.length).toBe(2);
    for (const plot of TH_GRAVEYARDS) {
      for (const dx of [-0.9, -0.5, 0, 0.5, 0.9]) {
        for (const dz of [-0.9, -0.5, 0, 0.5, 0.9]) {
          expect(
            bgFieldSurfaceAt(plot.x + dx * plot.hw, plot.z + dz * plot.hd),
            `inside the plot at (${plot.x}, ${plot.z})`,
          ).toBe(BG_SURFACE_GRAVE);
        }
      }
      for (const [ox, oz] of [
        [plot.hw + 2, 0],
        [-plot.hw - 2, 0],
        [0, plot.hd + 2],
        [0, -plot.hd - 2],
      ]) {
        expect(
          bgFieldSurfaceAt(plot.x + ox, plot.z + oz),
          `outside the plot at (${plot.x}, ${plot.z})`,
        ).not.toBe(BG_SURFACE_GRAVE);
      }
    }
    // and nowhere else on the field is grave ground.
    let graveCells = 0;
    for (let x = -50; x <= 50; x += 0.5) {
      for (let z = -140; z <= 140; z += 0.5) {
        if (bgFieldSurfaceAt(x, z) !== BG_SURFACE_GRAVE) continue;
        graveCells++;
        const plot = TH_GRAVEYARDS.find(
          (p) => Math.abs(x - p.x) <= p.hw && Math.abs(z - p.z) <= p.hd,
        );
        expect(plot, `grave ground at (${x}, ${z}) is on no authored plot`).toBeTruthy();
      }
    }
    expect(graveCells).toBeGreaterThan(100);
  });

  it('is point-symmetric, the fairness invariant the turned plate rests on', () => {
    for (let x = -48; x <= 48; x += 3) {
      for (let z = -138; z <= 138; z += 7) {
        expect(bgFieldSurfaceAt(x, z), `surface at (${x}, ${z}) is not mirrored`).toBe(
          bgFieldSurfaceAt(-x, -z),
        );
      }
    }
  });
});

describe('bg_field_relief_core: the atlas plate raster', () => {
  it('fills every pixel opaquely, and paints a rich plate rather than a wash', () => {
    const w = 40;
    const h = 70;
    const data = atlas(w, h, 1, BG_HALF_X, BG_HALF_Z, 1);
    for (let i = 0; i < w * h; i++) expect(data[i * CHANNELS + 3]).toBe(255);
    const distinct = new Set<string>();
    for (let i = 0; i < w * h; i++) {
      distinct.add(`${data[i * CHANNELS]},${data[i * CHANNELS + 1]},${data[i * CHANNELS + 2]}`);
    }
    // The mottle, the contours and the inked surface edges mean an atlas plate
    // carries far more distinct tones than the minimap's flat hypsometric wash
    // over the same window.
    expect(distinct.size).toBeGreaterThan(
      new Set(
        Array.from({ length: w * h }, (_v, i) => {
          const wash = paint(w, h, 1, BG_HALF_X, BG_HALF_Z);
          return `${wash[i * CHANNELS]},${wash[i * CHANNELS + 1]},${wash[i * CHANNELS + 2]}`;
        }),
      ).size,
    );
  });

  it('is deterministic: same request, same pixels, so the plate cannot drift', () => {
    // The plate is built once per size and blitted forever after, so nothing at
    // runtime would ever notice it changing. Every source of variation in it
    // (the fbm mottle included) is seeded from the authored map.
    const a = atlas(24, 40, 2, 40, 40, 1);
    const b = atlas(24, 40, 2, 40, 40, 1);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('paints the away view as the SAME ground walked the other way round', () => {
    // The mirror-honesty rule. The home view starts at (+halfX, +halfZ) and
    // walks toward -x/-z; the away view starts at the opposite corner and walks
    // back. Because the field, its heightfield and its ground paint are all
    // point-symmetric, the two rasters describe the same picture, and crucially
    // BOTH are lit from the screen's northwest: a rotated raster would carry
    // the light around with it.
    const w = 30;
    const h = 60;
    const home = atlas(w, h, 1.6, BG_HALF_X, BG_HALF_Z, 1);
    const away = atlas(w, h, 1.6, -BG_HALF_X, -BG_HALF_Z, -1);
    let worst = 0;
    for (let i = 0; i < w * h * CHANNELS; i++) worst = Math.max(worst, Math.abs(home[i] - away[i]));
    // Not byte-identical only because the bilinear height sum adds its terms in
    // the mirrored order; a lighting or axis mistake moves whole regions, not
    // one count of one channel.
    expect(worst).toBeLessThanOrEqual(2);
  });

  it('takes its base colour from the authored surface, not from height alone', () => {
    // Two windows at nearly the same elevation on opposite surfaces: the turf
    // of the Crimson field chamber and the paving of the courtyard mouth. The
    // hypsometric ramp alone would give these the same tone; the plate must
    // read one as green and the other as stone.
    const turf = meanRgb(atlas(10, 10, 1, 4, -78, 1));
    const paving = meanRgb(atlas(10, 10, 1, 4, -52, 1));
    expect(bgFieldSurfaceAt(0, -82)).toBe(BG_SURFACE_GRASS);
    expect(bgFieldSurfaceAt(0, -56)).toBe(BG_SURFACE_FLAGSTONE);
    // Green dominant on turf; the paving is near-neutral and lighter overall.
    expect(turf[1] - turf[0]).toBeGreaterThan(8);
    expect(Math.abs(paving[1] - paving[0])).toBeLessThan(8);
    expect(paving[2]).toBeGreaterThan(turf[2]);
  });

  it('draws the graveyard plot as ground, not as a flat rectangle of colour', () => {
    // The bug this replaced: the plot was a solid fill stamped over the finished
    // plate, which read as a rendering error. As a surface family it takes the
    // whole atlas treatment, so what has to be true is (a) it is its own tone,
    // not the turf beside it, (b) it is textured rather than flat, and (c) its
    // boundary carries the same inked verge every other surface edge does.
    const plot = TH_GRAVEYARDS[0];
    const inside = atlas(10, 10, 1, plot.x + 5, plot.z + 5, 1);
    const beside = atlas(10, 10, 1, plot.x + 5, plot.z + plot.hd + 14, 1);
    const luma3 = (rgb: number[]): number => 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    expect(bgFieldSurfaceAt(plot.x, plot.z)).toBe(BG_SURFACE_GRAVE);
    expect(bgFieldSurfaceAt(plot.x, plot.z + plot.hd + 9)).toBe(BG_SURFACE_GRASS);
    // Turned earth reads warm (red over green); the turf a few yards up the
    // terrace reads green over red. Luma alone would not separate them.
    const graveRgb = meanRgb(inside);
    const turfRgb = meanRgb(beside);
    expect(graveRgb[0] - graveRgb[1]).toBeGreaterThan(5);
    expect(turfRgb[1] - turfRgb[0]).toBeGreaterThan(3);
    // Textured: a flat fill would be exactly one colour over the whole window.
    const tones = new Set<string>();
    for (let i = 0; i < 100; i++) {
      tones.add(`${inside[i * CHANNELS]},${inside[i * CHANNELS + 1]},${inside[i * CHANNELS + 2]}`);
    }
    expect(tones.size).toBeGreaterThan(20);
    // Inked: a window straddling the rails carries pixels well darker than
    // anything inside the plot.
    const straddle = atlas(10, 10, 1, plot.x + 5, plot.z + plot.hd + 3, 1);
    let darkestInside = Infinity;
    for (let i = 0; i < 100; i++) {
      darkestInside = Math.min(darkestInside, luma3(pixel(inside, 10, i % 10, (i / 10) | 0)));
    }
    let darkestStraddle = Infinity;
    for (let i = 0; i < 100; i++) {
      darkestStraddle = Math.min(darkestStraddle, luma3(pixel(straddle, 10, i % 10, (i / 10) | 0)));
    }
    expect(darkestStraddle).toBeLessThan(darkestInside * 0.9);
  });

  it('still reads elevation: the courtyard bowl is darker than a keep terrace', () => {
    // Both are paved, so this is the hypsometric tint doing its job THROUGH the
    // surface colour rather than instead of it.
    const bowl = meanRgb(atlas(8, 8, 1, 4, 4, 1));
    const terrace = meanRgb(atlas(8, 8, 1, 4, -114, 1));
    expect(bgFieldSurfaceAt(0, 0)).toBe(BG_SURFACE_FLAGSTONE);
    expect(bgFieldSurfaceAt(0, -118)).toBe(BG_SURFACE_FLAGSTONE);
    const luma3 = (rgb: number[]): number => 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    expect(luma3(terrace) - luma3(bowl)).toBeGreaterThan(10);
  });

  it('reads the row above, not just the row it is on', () => {
    // The second hillshade axis and the contour banding both need the previous
    // row. Painting the same window one row at a time starves every row of it,
    // so the two renders must differ; a plate that only ever looked sideways
    // would come out identical.
    const w = 16;
    const h = 12;
    const px = 1.5;
    const whole = atlas(w, h, px, 30, -100, 1);
    const rowwise = new Uint8ClampedArray(w * h * CHANNELS);
    for (let iy = 0; iy < h; iy++) {
      const row = atlas(w, 1, px, 30, -100 - iy / px, 1);
      rowwise.set(row, iy * w * CHANNELS);
    }
    let differing = 0;
    for (let i = 0; i < w * h; i++) {
      if (whole[i * CHANNELS] !== rowwise[i * CHANNELS]) differing++;
    }
    expect(differing).toBeGreaterThan(w); // more than the one row that legitimately matches
  });
});
