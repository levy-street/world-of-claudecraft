import { describe, expect, it } from 'vitest';
import { resampleHdrRgba } from '../src/render/hdr_resample';

describe('HDR PMREM resampling', () => {
  it('preserves RGBA samples and the equirect aspect ratio', () => {
    const source = new Uint16Array(8 * 4 * 4);
    for (let i = 0; i < source.length; i++) source[i] = i;
    const out = resampleHdrRgba(source, 8, 4, 4);
    expect(out.width).toBe(4);
    expect(out.height).toBe(2);
    expect(out.data).toBeInstanceOf(Uint16Array);
    expect(out.data.length).toBe(4 * 2 * 4);
    // Centre-sampled source pixels: x=1,3,5,7 and y=1,3.
    expect([...out.data.slice(0, 4)]).toEqual([
      ...source.slice((1 * 8 + 1) * 4, (1 * 8 + 1) * 4 + 4),
    ]);
    expect([...out.data.slice(-4)]).toEqual([
      ...source.slice((3 * 8 + 7) * 4, (3 * 8 + 7) * 4 + 4),
    ]);
  });

  it('returns the original allocation when no resize is needed', () => {
    const source = new Float32Array(4 * 2 * 4);
    const out = resampleHdrRgba(source, 4, 2, 8);
    expect(out.data).toBe(source);
    expect(out.width).toBe(4);
    expect(out.height).toBe(2);
  });
});
