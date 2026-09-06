import { describe, expect, it } from 'vitest';
import { copyPos, wrapAngle } from '../src/net/interp_math';

describe('interp_math (the online mirror helpers)', () => {
  it('wraps an angle delta into (-pi, pi] so a facing lerp takes the short way round', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI)).toBe(Math.PI);
    expect(wrapAngle(Math.PI + 0.5)).toBeCloseTo(-Math.PI + 0.5, 12);
    expect(wrapAngle(-Math.PI - 0.5)).toBeCloseTo(Math.PI - 0.5, 12);
    expect(wrapAngle(4 * Math.PI + 0.25)).toBeCloseTo(0.25, 12);
    expect(wrapAngle(-6 * Math.PI - 0.25)).toBeCloseTo(-0.25, 12);
  });

  it('copies a position into the live vector in place, never reallocating it', () => {
    const dst = { x: 0, y: 0, z: 0 };
    const src = { x: 1.5, y: -2, z: 40 };
    copyPos(dst, src);
    expect(dst).toEqual({ x: 1.5, y: -2, z: 40 });
    // A later change to the source does not leak through: the copy is by value.
    src.x = 99;
    expect(dst.x).toBe(1.5);
  });
});
