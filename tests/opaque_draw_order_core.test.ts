import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type OpaqueDrawItem, opaqueFrontToBackSort } from '../src/render/opaque_draw_order_core';

function item(
  id: number,
  z: number,
  materialId: number,
  alphaTest = 0,
  groupOrder = 0,
  renderOrder = 0,
): OpaqueDrawItem {
  return {
    id,
    z,
    groupOrder,
    renderOrder,
    material: { id: materialId, alphaTest },
  };
}

describe('opaque front-to-back draw order', () => {
  it('installs after graphics detection only for standard-material tiers', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const gfxInit = renderer.indexOf('initGfxTier(this.webgl)');
    const install = renderer.indexOf(
      'if (GFX.standardMaterials) this.webgl.setOpaqueSort(opaqueFrontToBackSort)',
    );

    expect(gfxInit).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(gfxInit);
    expect(renderer.match(/setOpaqueSort\(/g)).toHaveLength(1);
  });

  it('preserves explicit group and render-order constraints ahead of depth', () => {
    const draws = [item(1, -0.8, 1, 0, 1, 0), item(2, 0.6, 2, 0, 0, 1), item(3, -0.6, 3, 0, 0, 0)];

    draws.sort(opaqueFrontToBackSort);

    expect(draws.map((draw) => draw.id)).toEqual([3, 2, 1]);
  });

  it('preserves explicit barriers ahead of the solid and alpha-tested classes', () => {
    const draws = [
      item(1, 0.8, 1, 0.4, 0, 5),
      item(2, -0.8, 2, 0, 0, 6),
      item(3, -0.9, 3, 0, 1, -100),
    ];

    draws.sort(opaqueFrontToBackSort);

    expect(draws.map((draw) => draw.id)).toEqual([1, 2, 3]);
  });

  it('draws solid opaques before alpha-tested cards so walls can reject hidden foliage', () => {
    const draws = [item(1, -0.8, 1, 0.4), item(2, 0.6, 2), item(3, -0.6, 3, 0.01), item(4, 0.8, 4)];

    draws.sort(opaqueFrontToBackSort);

    expect(draws.map((draw) => draw.id)).toEqual([2, 4, 1, 3]);
  });

  it('sorts each opaque class by projected depth before material identity', () => {
    const draws = [
      item(1, 0.7, 1),
      item(2, -0.7, 99),
      item(3, 0.6, 2, 0.5),
      item(4, -0.6, 98, 0.5),
    ];

    draws.sort(opaqueFrontToBackSort);

    expect(draws.map((draw) => draw.id)).toEqual([2, 1, 4, 3]);
  });

  it('uses material then object identity as deterministic equal-depth ties', () => {
    const draws = [item(8, 0.2, 4), item(3, 0.2, 4), item(5, 0.2, 2)];

    draws.sort(opaqueFrontToBackSort);

    expect(draws.map((draw) => draw.id)).toEqual([5, 3, 8]);
  });
});
