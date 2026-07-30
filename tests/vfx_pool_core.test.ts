import { describe, expect, it } from 'vitest';
import {
  packActiveParticleSlotsInto,
  pointSpriteBoundingRadius,
  spriteEarlyRejectRadiusSq,
} from '../src/render/vfx_pool_core';

const CELL_SIZE = 8;
const ATLAS_WIDTH = CELL_SIZE;

function cell(): Uint8ClampedArray {
  return new Uint8ClampedArray(CELL_SIZE * CELL_SIZE * 4);
}

function setPixel(
  pixels: Uint8ClampedArray,
  x: number,
  y: number,
  value: number,
  atlasWidth = CELL_SIZE,
  channel?: 0 | 1 | 2,
): void {
  const offset = (y * atlasWidth + x) * 4;
  if (channel === undefined) {
    pixels[offset] = value;
    pixels[offset + 1] = value;
    pixels[offset + 2] = value;
  } else {
    pixels[offset + channel] = value;
  }
  pixels[offset + 3] = 255;
}

describe('VFX particle pool core', () => {
  it('packs only live slots in the cloud original ascending blend order', () => {
    const life = new Float32Array([0, 0.2, -1, 0.7, 0, 0.1]);
    const slots = new Int32Array(life.length);

    expect(packActiveParticleSlotsInto(life, slots)).toBe(3);
    expect([...slots.subarray(0, 3)]).toEqual([1, 3, 5]);
  });

  it('bounds the full point square across live-camera FOV changes', () => {
    const pointProjectionScale = 1 / Math.tan(Math.PI / 6);

    expect(pointSpriteBoundingRadius(2, pointProjectionScale, pointProjectionScale)).toBeCloseTo(
      Math.SQRT2,
    );
    expect(pointSpriteBoundingRadius(2, pointProjectionScale, 1)).toBeCloseTo(Math.sqrt(6));
    expect(pointSpriteBoundingRadius(-2, pointProjectionScale, pointProjectionScale)).toBe(0);
    expect(pointSpriteBoundingRadius(2, Number.NaN, pointProjectionScale)).toBeCloseTo(Math.SQRT2);
    expect(pointSpriteBoundingRadius(2, pointProjectionScale, 0)).toBeCloseTo(Math.SQRT2);
    expect(
      pointSpriteBoundingRadius(2, Number.POSITIVE_INFINITY, pointProjectionScale),
    ).toBeCloseTo(Math.SQRT2);
    expect(
      pointSpriteBoundingRadius(2, pointProjectionScale, Number.POSITIVE_INFINITY),
    ).toBeCloseTo(Math.SQRT2);
  });

  it('bounds an interior bright texel with a conservative bilinear-filter halo', () => {
    const pixels = cell();
    setPixel(pixels, 3, 3, 255);

    const radiusSq = spriteEarlyRejectRadiusSq(pixels, ATLAS_WIDTH, 0, 0, CELL_SIZE);

    expect(radiusSq).toBeCloseTo(0.07036554300858901, 10);
    expect(radiusSq).toBeLessThan(0.5);
  });

  it('uses the exact 8-bit boundary for the conservative early threshold', () => {
    const pixels = cell();
    setPixel(pixels, 3, 3, 25);

    expect(spriteEarlyRejectRadiusSq(pixels, ATLAS_WIDTH, 0, 0, CELL_SIZE)).toBe(0);

    setPixel(pixels, 3, 3, 26);
    expect(spriteEarlyRejectRadiusSq(pixels, ATLAS_WIDTH, 0, 0, CELL_SIZE)).toBeGreaterThan(0);
  });

  it('disables early rejection when clamping can extend a bright edge texel', () => {
    const pixels = cell();
    setPixel(pixels, 0, 4, 255);

    expect(spriteEarlyRejectRadiusSq(pixels, ATLAS_WIDTH, 0, 0, CELL_SIZE)).toBe(0.5);
  });

  it('reads offset atlas cells and treats every RGB channel as visible energy', () => {
    const atlasWidth = CELL_SIZE * 2;
    const pixels = new Uint8ClampedArray(atlasWidth * atlasWidth * 4);

    for (const channel of [0, 1, 2] as const) {
      pixels.fill(0);
      setPixel(pixels, CELL_SIZE + 3, CELL_SIZE + 3, 26, atlasWidth, channel);
      expect(
        spriteEarlyRejectRadiusSq(pixels, atlasWidth, CELL_SIZE, CELL_SIZE, CELL_SIZE),
      ).toBeGreaterThan(0);
      expect(spriteEarlyRejectRadiusSq(pixels, atlasWidth, 0, 0, CELL_SIZE)).toBe(0);
    }
  });

  it('falls back to the full point for invalid atlas dimensions', () => {
    expect(spriteEarlyRejectRadiusSq(cell(), 0, 0, 0, CELL_SIZE)).toBe(0.5);
    expect(spriteEarlyRejectRadiusSq(cell(), ATLAS_WIDTH, 0, 0, 0)).toBe(0.5);
  });
});
