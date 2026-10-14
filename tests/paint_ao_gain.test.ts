import { describe, expect, it } from 'vitest';

import { measureAo } from '../src/render/terrain_paint_layers';

const W = 64;

/** An RGBA buffer from a greyscale generator, the shape measureAo reads. */
function sheet(gen: (x: number, y: number) => number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * W * 4);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const v = Math.max(0, Math.min(255, Math.round(gen(x, y) * 255)));
      const o = (y * W + x) * 4;
      px[o] = v;
      px[o + 1] = v;
      px[o + 2] = v;
      px[o + 3] = 255;
    }
  }
  return px;
}

function gainOf(px: Uint8ClampedArray): number {
  const mean = new Float32Array(1).fill(1);
  const gain = new Float32Array(1);
  measureAo(px, 0, mean, gain, W);
  return gain[0];
}

// Normalising a low-contrast AO sheet by 1/sd amplifies its 8x8 JPEG block
// seams along with its relief. At gain 30 that drew a grid of pale squares
// over painted cobbles (SPACEY, 2026-09-22). The gain must therefore be bounded
// by the MEASURED seam, not by sd alone.
describe('AO normalisation gain', () => {
  it('caps a low-contrast sheet that carries 8px block seams', () => {
    // Gentle relief (real signal) plus a step at every 8th column (the seam).
    const blocky = gainOf(
      sheet((x, y) => 0.93 + 0.02 * Math.sin(x / 19) * Math.cos(y / 23) + (x % 8 === 0 ? 0.02 : 0)),
    );
    const clean = gainOf(sheet((x, y) => 0.93 + 0.02 * Math.sin(x / 19) * Math.cos(y / 23)));
    // Same contrast, so 1/sd is nearly identical, only the seam differs.
    expect(blocky).toBeLessThan(clean);
    expect(blocky).toBeGreaterThan(0);
  });

  it('never exceeds the ceiling, however flat the sheet', () => {
    // sd ~0.001: 1/sd would be ~1000 and the old code allowed 55.
    expect(gainOf(sheet((x) => 0.98 + 0.001 * Math.sin(x / 7)))).toBeLessThanOrEqual(24);
  });

  it('leaves a contrasty, clean sheet at its natural 1/sd', () => {
    // sd ~0.14 -> 1/sd ~7, well under every cap; it must not be reduced.
    const px = sheet((x, y) => 0.5 + 0.2 * Math.sin(x / 11) * Math.cos(y / 13));
    expect(gainOf(px)).toBeGreaterThan(3);
    expect(gainOf(px)).toBeLessThan(10);
  });

  it('reports no relief for a sheet that is flat to the bit', () => {
    expect(gainOf(sheet(() => 0.93))).toBe(0);
  });
});
