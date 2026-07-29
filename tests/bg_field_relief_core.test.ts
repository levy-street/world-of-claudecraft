// The shared Ravenrift relief rasterizer (src/ui/bg_field_relief_core.ts): the
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
import { paintBgFieldRelief } from '../src/ui/bg_field_relief_core';

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
