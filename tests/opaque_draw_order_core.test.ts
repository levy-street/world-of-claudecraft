import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  OPAQUE_FRONT_TO_BACK_MAX_FOCUS_SPEED,
  OPAQUE_FRONT_TO_BACK_MIN_DRAW_CALLS,
  type OpaqueDrawItem,
  type OpaqueSortPolicyInput,
  opaqueFrontToBackSort,
  opaqueMaterialFirstSort,
  shouldUseFrontToBackOpaqueSort,
} from '../src/render/opaque_draw_order_core';

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

const POLICY_SAMPLE: OpaqueSortPolicyInput = {
  drawCalls: OPAQUE_FRONT_TO_BACK_MIN_DRAW_CALLS,
  elapsedSeconds: 1 / 120,
  focusX: 0,
  focusZ: 0,
  previousFocusX: 0,
  previousFocusZ: 0,
};

function policy(overrides: Partial<OpaqueSortPolicyInput> = {}): boolean {
  return shouldUseFrontToBackOpaqueSort({ ...POLICY_SAMPLE, ...overrides });
}

describe('opaque front-to-back draw order', () => {
  it('selects the comparator after graphics detection only for standard-material tiers', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const gfxInit = renderer.indexOf('initGfxTier(this.webgl)');
    const tierGate = renderer.indexOf('if (!GFX.standardMaterials) return');
    const selection = renderer.indexOf(
      'useFrontToBack ? opaqueFrontToBackSort : opaqueMaterialFirstSort',
    );

    expect(gfxInit).toBeGreaterThan(-1);
    expect(tierGate).toBeGreaterThan(gfxInit);
    expect(selection).toBeGreaterThan(tierGate);
    expect(renderer.match(/setOpaqueSort\(/g)).toHaveLength(1);
    expect(renderer.match(/this\.updateOpaqueDrawOrder\(dt\)/g)).toHaveLength(2);
    expect(renderer).toContain('private opaqueFrontToBackActive: boolean | null = null');
    expect(renderer).toMatch(
      /input\.drawCalls = this\.drawStats\s+\? this\.drawStats\.currentFrame\(\)\.calls\s+: this\.webgl\.info\.render\.calls/,
    );
    expect(renderer).toContain('input.previousFocusX = focusX');
    expect(renderer).toContain('input.previousFocusZ = focusZ');
  });

  it('pins the measured density and translation knees', () => {
    expect(OPAQUE_FRONT_TO_BACK_MIN_DRAW_CALLS).toBe(560);
    expect(OPAQUE_FRONT_TO_BACK_MAX_FOCUS_SPEED).toBe(1);
  });

  it('uses front-to-back only for a dense frame with a stationary view focus', () => {
    expect(policy()).toBe(true);
    expect(policy({ focusX: 0.1 })).toBe(false);
    expect(policy({ focusZ: 0.1 })).toBe(false);
    expect(
      policy({
        elapsedSeconds: 1,
        focusX: OPAQUE_FRONT_TO_BACK_MAX_FOCUS_SPEED,
      }),
    ).toBe(true);
  });

  it('falls back to material-first ordering for sparse scenes and the first frame', () => {
    expect(policy({ drawCalls: OPAQUE_FRONT_TO_BACK_MIN_DRAW_CALLS - 1 })).toBe(false);
    for (const override of [
      { previousFocusX: Number.NaN },
      { previousFocusZ: Number.NaN },
      { elapsedSeconds: Number.NaN },
      { elapsedSeconds: 0 },
    ]) {
      expect(policy(override)).toBe(false);
    }
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

  it('keeps solids ahead of foliage then uses material-first fallback ordering', () => {
    const draws = [
      item(1, 0.5, 1, 0, 1, 0),
      item(2, 0.5, 1, 0, 0, 2),
      item(3, 0.5, 0, 0.4, 0, 1),
      item(4, 0.5, 9, 0, 0, 1),
      item(5, 0.5, 9, 0, 0, 1),
      item(6, -0.5, 9, 0, 0, 1),
      item(7, 0.9, 1, 0, 0, 1),
    ];

    draws.sort(opaqueMaterialFirstSort);

    expect(draws.map((draw) => draw.id)).toEqual([7, 6, 4, 5, 3, 2, 1]);
  });
});
