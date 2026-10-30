import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPaintedGroundMacro,
  paintedGroundMacro,
  paintedGroundMacroVersion,
  recordPaintedGroundMacro,
  samplePaintedGroundMacro,
} from '../src/render/painted_ground_macro_core';
import { macroStatsOf } from '../src/render/terrain_painted_ground_core';

afterEach(() => clearPaintedGroundMacro());

/** A size x size RGBA readback whose red channel is `red(col, row)` (0..255),
 *  rows top to bottom like a canvas getImageData. */
function rgba(size: number, red: (col: number, row: number) => number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const i = (row * size + col) * 4;
      out[i] = red(col, row);
      out[i + 1] = 7;
      out[i + 2] = 9;
      out[i + 3] = 255;
    }
  }
  return out;
}

describe('painted ground macro core', () => {
  it('is recorded by the terrain measuring its macro texture, with its stats', () => {
    expect(paintedGroundMacro()).toBeNull();
    const bytes = rgba(8, (c, r) => (c * 13 + r * 29) % 256);
    const stats = macroStatsOf(bytes, 4);
    const macro = paintedGroundMacro();
    expect(macro).not.toBeNull();
    expect(macro?.size).toBe(8);
    expect(macro?.mean).toBe(stats.mean);
    expect(macro?.sd).toBe(stats.sd);
    // red channel only, scaled to 0..1
    expect(macro?.red[0]).toBeCloseTo(0, 9);
    expect(macro?.red[8 + 1]).toBeCloseTo(((13 + 29) % 256) / 255, 6);
  });

  it('ignores a readback that is not a square texture', () => {
    recordPaintedGroundMacro(new Uint8Array(3 * 4 * 4), 4, 1 / 255, 0.5, 0.1);
    expect(paintedGroundMacro()).toBeNull();
  });

  it('versions every record and clear', () => {
    const v0 = paintedGroundMacroVersion();
    recordPaintedGroundMacro(
      rgba(4, () => 100),
      4,
      1 / 255,
      0.4,
      0.1,
    );
    const v1 = paintedGroundMacroVersion();
    expect(v1).toBeGreaterThan(v0);
    expect(paintedGroundMacro()?.version).toBe(v1);
    clearPaintedGroundMacro();
    expect(paintedGroundMacroVersion()).toBeGreaterThan(v1);
    expect(paintedGroundMacro()).toBeNull();
  });

  it('samples like texture2D at full resolution: texel centres, bilinear, wrapped, flipY', () => {
    const size = 4;
    // a value per image cell: col + 10 * row (rows top to bottom)
    recordPaintedGroundMacro(
      rgba(size, (c, r) => c + 10 * r),
      4,
      1,
      0,
      1,
    );
    const macro = paintedGroundMacro();
    if (!macro) throw new Error('macro expected');
    const at = (u: number, v: number) => samplePaintedGroundMacro(macro, u, v);
    // the centre of texel (col 1) in texture row 0 = image row 3 (flipY)
    expect(at(1.5 / size, 0.5 / size)).toBeCloseTo(1 + 30, 9);
    // the top texture row is image row 0
    expect(at(2.5 / size, 3.5 / size)).toBeCloseTo(2, 9);
    // halfway between two texel centres along u
    expect(at(2 / size, 3.5 / size)).toBeCloseTo(1.5, 9);
    // wrapping in both axes, and whole periods away
    expect(at(1.5 / size + 3, 0.5 / size - 2)).toBeCloseTo(at(1.5 / size, 0.5 / size), 9);
    // between the last and the first column it blends across the seam
    expect(at(0, 3.5 / size)).toBeCloseTo((3 + 0) / 2, 9);
  });
});
