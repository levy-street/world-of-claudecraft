// Behavior pins for the continent land-mask classifier (src/ui/continent_land_mask_core.ts),
// the pure half of the world map's zone wash.
//
// The mask is what makes a zone highlight follow the coastline instead of drawing
// the zone's world-space rectangle, so the load-bearing claims are: water reads as
// water, painted terrain reads as land whatever its hue, the coast gets a ramp
// rather than a hard edge, and an isolated misclassified pixel cannot show up as a
// speck of wash. Each is asserted on a hand-built pixel buffer; the last case runs
// the real shipped plate through the classifier so the thresholds are pinned
// against the art they were tuned on, not only against synthetic pixels.

import { describe, expect, it } from 'vitest';
import {
  buildLandMaskRgba,
  isOceanPixel,
  LAND_MASK_BLUR_RADIUS,
  LAND_MASK_EDGE_GAIN,
  OCEAN_BLUE_OVER_GREEN,
  OCEAN_BLUE_OVER_RED,
} from '../src/ui/continent_land_mask_core';

/** Real colors sampled from public/map_art/world_overview.webp. */
const DEEP_SEA: [number, number, number] = [7, 78, 122];
const OPEN_SEA: [number, number, number] = [23, 90, 129];
const SHALLOWS: [number, number, number] = [37, 119, 148];
const CANOPY: [number, number, number] = [81, 87, 33];
const GRASSLAND: [number, number, number] = [97, 108, 40];
const SNOWFIELD: [number, number, number] = [181, 201, 206];
const ROCK: [number, number, number] = [154, 149, 124];

/** Build an RGBA buffer from a per-pixel color picker. */
function plate(
  width: number,
  height: number,
  at: (x: number, y: number) => [number, number, number],
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = at(x, y);
      const p = (y * width + x) * 4;
      out[p] = r;
      out[p + 1] = g;
      out[p + 2] = b;
      out[p + 3] = 255;
    }
  }
  return out;
}

/** The mask's alpha at one pixel. */
function alphaAt(mask: Uint8ClampedArray, width: number, x: number, y: number): number {
  return mask[(y * width + x) * 4 + 3];
}

describe('continent land mask: classification', () => {
  it('reads every sampled sea tone as water and every terrain tone as land', () => {
    for (const [name, rgb] of [
      ['deep sea', DEEP_SEA],
      ['open sea', OPEN_SEA],
      ['shallows', SHALLOWS],
    ] as const) {
      expect(isOceanPixel(...rgb), name).toBe(true);
    }
    for (const [name, rgb] of [
      ['canopy', CANOPY],
      ['grassland', GRASSLAND],
      ['snowfield', SNOWFIELD],
      ['rock', ROCK],
    ] as const) {
      expect(isOceanPixel(...rgb), name).toBe(false);
    }
  });

  it('requires BOTH margins, so a merely blue-ish pixel stays land', () => {
    // The snowfield is the case that motivates the second margin: blue leads red
    // there by the whole red margin already (the frostveil ice sits one shade off
    // being classified as sea), and the green test is what actually holds it.
    expect(SNOWFIELD[2] - SNOWFIELD[0]).toBeGreaterThanOrEqual(OCEAN_BLUE_OVER_RED);
    expect(SNOWFIELD[2] - SNOWFIELD[1]).toBeLessThan(OCEAN_BLUE_OVER_GREEN);
    expect(isOceanPixel(...SNOWFIELD)).toBe(false);
    // One short of each margin is land; one past both is water.
    expect(isOceanPixel(100, 100, 100 + OCEAN_BLUE_OVER_RED)).toBe(false);
    expect(isOceanPixel(100, 100 + OCEAN_BLUE_OVER_RED, 100 + OCEAN_BLUE_OVER_RED + 1)).toBe(false);
    expect(isOceanPixel(100, 100, 100 + OCEAN_BLUE_OVER_RED + 1)).toBe(true);
  });
});

describe('continent land mask: mask buffer', () => {
  it('is opaque white over open land and fully transparent over open sea', () => {
    const size = 24;
    // Left half sea, right half grass, with the seam far from both samples.
    const mask = buildLandMaskRgba(
      plate(size, size, (x) => (x < size / 2 ? OPEN_SEA : GRASSLAND)),
      size,
      size,
    );
    expect(alphaAt(mask, size, size - 1, 12)).toBe(255);
    expect(alphaAt(mask, size, 0, 12)).toBe(0);
    // The color channels carry no tint of their own: the painter tints the mask
    // from a resolved --color-map-* token, so a colored mask would double-tint.
    const land = ((12 * size + size - 1) * 4) as number;
    expect([mask[land], mask[land + 1], mask[land + 2]]).toEqual([255, 255, 255]);
  });

  it('ramps across the coastline instead of cutting it, over the blur span', () => {
    const size = 24;
    const seam = size / 2;
    const mask = buildLandMaskRgba(
      plate(size, size, (x) => (x < seam ? OPEN_SEA : GRASSLAND)),
      size,
      size,
    );
    const row = Array.from({ length: size }, (_, x) => alphaAt(mask, size, x, 12));
    // Monotonic sea -> land, with at least one intermediate value (the ramp).
    for (let x = 1; x < size; x++) expect(row[x]).toBeGreaterThanOrEqual(row[x - 1]);
    expect(row.some((a) => a > 0 && a < 255)).toBe(true);
    // The ramp is bounded by the blur span on each side of the seam, so the wash
    // never bleeds a visible distance out to sea.
    const partial = row.map((a, x) => (a > 0 && a < 255 ? x : -1)).filter((x) => x >= 0);
    for (const x of partial) expect(Math.abs(x - seam)).toBeLessThanOrEqual(LAND_MASK_BLUR_RADIUS);
  });

  it('erases a lone misclassified pixel, which the gain is chosen to do', () => {
    const size = 16;
    const mask = buildLandMaskRgba(
      plate(size, size, (x, y) => (x === 8 && y === 8 ? GRASSLAND : OPEN_SEA)),
      size,
      size,
    );
    // One land pixel spread over the blur box keeps a few percent coverage even
    // after the gain: present in the buffer, invisible under a translucent wash.
    const speck = alphaAt(mask, size, 8, 8);
    expect(speck).toBeGreaterThan(0);
    expect(speck).toBeLessThan(255 * 0.1);
    expect(LAND_MASK_EDGE_GAIN).toBeGreaterThan(1);
  });

  it('leaves an inland lake unwashed (the reason the mask beats a rectangle)', () => {
    const size = 32;
    const inLake = (x: number, y: number): boolean => x >= 12 && x < 20 && y >= 12 && y < 20;
    const mask = buildLandMaskRgba(
      plate(size, size, (x, y) => (inLake(x, y) ? OPEN_SEA : CANOPY)),
      size,
      size,
    );
    expect(alphaAt(mask, size, 16, 16)).toBe(0);
    expect(alphaAt(mask, size, 2, 2)).toBe(255);
  });
});
