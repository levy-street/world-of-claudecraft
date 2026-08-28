// The cast-VFX readiness gate (src/render/cast_vfx_readiness_core.ts): the
// painter draws nothing until every cast program is linked, counts what it
// refused, and latches once ready.

import { describe, expect, it } from 'vitest';
import { createCastVfxReadiness } from '../src/render/cast_vfx_readiness_core';

interface Mat {
  id: string;
  linked: boolean;
}

function harness(materials: Mat[], staged = true) {
  const state = { staged, materials };
  const readiness = createCastVfxReadiness<Mat>({
    materials: () => state.materials,
    staged: () => state.staged,
    linked: (material) => material.linked,
  });
  return { readiness, state };
}

describe('createCastVfxReadiness', () => {
  it('refuses while any cast material is unlinked, and counts each refusal', () => {
    const { readiness, state } = harness([
      { id: 'ring', linked: true },
      { id: 'decal', linked: false },
    ]);
    expect(readiness.admit()).toBe(false);
    expect(readiness.admit()).toBe(false);
    expect(readiness.snapshot()).toEqual({ ready: false, refused: 2, pending: 1 });

    state.materials[1].linked = true;
    expect(readiness.admit()).toBe(true);
    expect(readiness.snapshot()).toEqual({ ready: true, refused: 2, pending: 0 });
  });

  it('refuses until the lazy stand-ins are staged, whatever the pools say', () => {
    const { readiness, state } = harness([{ id: 'ring', linked: true }], false);
    expect(readiness.admit()).toBe(false);
    expect(readiness.snapshot()).toMatchObject({ ready: false, pending: null });
    state.staged = true;
    expect(readiness.admit()).toBe(true);
  });

  it('latches ready: a material that arrives later never re-closes the gate', () => {
    // A linked program stays linked for its material's life, and the pools
    // and stand-ins are never disposed; a material minted live (a cast's own
    // clone) shares an already-linked program.
    const { readiness, state } = harness([{ id: 'ring', linked: true }]);
    expect(readiness.admit()).toBe(true);
    state.materials.push({ id: 'live-clone', linked: false });
    expect(readiness.admit()).toBe(true);
    expect(readiness.snapshot().refused).toBe(0);
  });

  it('answers a per-frame consult without counting it', () => {
    const { readiness, state } = harness([{ id: 'ring', linked: false }]);
    expect(readiness.ready()).toBe(false);
    expect(readiness.ready()).toBe(false);
    expect(readiness.snapshot().refused).toBe(0);
    state.materials[0].linked = true;
    expect(readiness.ready()).toBe(true);
  });

  it('is ready with nothing to link once staged', () => {
    const { readiness } = harness([]);
    expect(readiness.admit()).toBe(true);
  });
});
