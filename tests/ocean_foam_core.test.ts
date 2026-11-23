import { describe, expect, it } from 'vitest';
import { buildOceanFoamTexels, OCEAN_FOAM_SIZE } from '../src/render/ocean/ocean_foam_core';

describe('ocean foam texture', () => {
  const texels = buildOceanFoamTexels();
  const at = (x: number, y: number, c: number) =>
    texels[
      ((((y % OCEAN_FOAM_SIZE) + OCEAN_FOAM_SIZE) % OCEAN_FOAM_SIZE) * OCEAN_FOAM_SIZE +
        (((x % OCEAN_FOAM_SIZE) + OCEAN_FOAM_SIZE) % OCEAN_FOAM_SIZE)) *
        4 +
        c
    ];

  it('is deterministic (no Math.random): every client draws the same foam', () => {
    expect(Array.from(buildOceanFoamTexels().slice(0, 4096))).toEqual(
      Array.from(texels.slice(0, 4096)),
    );
  });

  it('tiles: the wrap seam is no rougher than the texture inside it', () => {
    for (const c of [0, 1, 2]) {
      let seam = 0;
      let inner = 0;
      for (let i = 0; i < OCEAN_FOAM_SIZE; i++) {
        seam += Math.abs(at(OCEAN_FOAM_SIZE - 1, i, c) - at(0, i, c));
        seam += Math.abs(at(i, OCEAN_FOAM_SIZE - 1, c) - at(i, 0, c));
        inner += Math.abs(at(99, i, c) - at(100, i, c));
        inner += Math.abs(at(i, 99, c) - at(i, 100, c));
      }
      expect(seam, `channel ${c}`).toBeLessThan(inner * 1.6 + 1);
    }
  });

  it('carries real structure in each channel, not a flat fill', () => {
    for (const c of [0, 1, 2]) {
      let lo = 255;
      let hi = 0;
      for (let i = c; i < texels.length; i += 4) {
        lo = Math.min(lo, texels[i]);
        hi = Math.max(hi, texels[i]);
      }
      expect(hi - lo, `channel ${c}`).toBeGreaterThan(120);
    }
  });
});
