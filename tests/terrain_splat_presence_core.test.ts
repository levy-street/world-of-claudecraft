import { describe, expect, it } from 'vitest';
import {
  terrainSplatPresence,
  terrainSplatPresenceMask,
} from '../src/render/terrain_splat_presence_core';

describe('terrain splat presence', () => {
  it('marks only channels with a non-zero vertex value', () => {
    const splats = new Float32Array([1, 0, 0, 0, 0.25, 0, Number.NaN, -0]);
    const extras = new Float32Array([0, 0, 1, 1, -0, 0.5, 0, 0]);

    const presence = terrainSplatPresence(splats, extras);
    expect(presence).toEqual({
      splat: [true, false, true, false],
      extra: [false, true],
    });
    expect(terrainSplatPresenceMask(presence)).toBe(37);
  });

  it('packs dirt, sand, mud, and malformed extras into their stable bits', () => {
    const presence = terrainSplatPresence(
      new Float32Array([0, 0.25, 0, 1]),
      new Float32Array([0.5, Number.NaN, 0, 0]),
    );

    expect(presence).toEqual({
      splat: [false, true, false, true],
      extra: [true, true],
    });
    expect(terrainSplatPresenceMask(presence)).toBe(58);
  });

  it('keeps every channel absent for Lambert geometry', () => {
    expect(terrainSplatPresence(null, null)).toEqual({
      splat: [false, false, false, false],
      extra: [false, false],
    });
  });
});
