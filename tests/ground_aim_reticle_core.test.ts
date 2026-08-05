import { describe, expect, it } from 'vitest';
import { sameGroundAimGeometry } from '../src/render/ground_aim_reticle_core';

describe('ground aim reticle core', () => {
  it('matches only byte-identical terrain geometry inputs', () => {
    const previous = { x: 3, z: 7, radius: 5 };

    expect(sameGroundAimGeometry(previous, 3, 7, 5)).toBe(true);
    expect(sameGroundAimGeometry(previous, 3.000_001, 7, 5)).toBe(false);
    expect(sameGroundAimGeometry(previous, 3, 7.000_001, 5)).toBe(false);
    expect(sameGroundAimGeometry(previous, 3, 7, 5.000_001)).toBe(false);
    expect(sameGroundAimGeometry({ x: Number.NaN, z: 7, radius: 5 }, 3, 7, 5)).toBe(false);
  });
});
