import { describe, expect, it, vi } from 'vitest';
import { PROPS } from '../src/sim/data';
import { buildDecorPropColliders } from '../src/sim/decor_prop_colliders';
import { groundHeight } from '../src/sim/world';

// Direct unit coverage for src/sim/decor_prop_colliders.ts, extracted out of
// src/sim/colliders.ts (see that module's header for the contract). These
// cases exercise every branch the extraction and the standableTop addition
// touch, independent of any specific zone's placed content.

const SEED = 42;
const X = 10;
const Z = 20;

describe('buildDecorPropColliders', () => {
  it('r 0/absent is walk-through dressing: no collider at all', () => {
    expect(buildDecorPropColliders(SEED, [{ key: 'k', x: X, z: Z }])).toEqual([]);
    expect(buildDecorPropColliders(SEED, [{ key: 'k', x: X, z: Z, r: 0 }])).toEqual([]);
  });

  it('a plain circle (no standableTop) collides full-height', () => {
    const [c] = buildDecorPropColliders(SEED, [{ key: 'k', x: X, z: Z, r: 2 }]);
    expect(c.type).toBe('circle');
    if (c.type !== 'circle') return;
    expect(c.x).toBe(X);
    expect(c.z).toBe(Z);
    expect(c.r).toBe(2);
    expect(c.moveTopY).toBeUndefined();
    expect(c.standable).toBeUndefined();
    expect(c.cameraTopY).toBeCloseTo(groundHeight(X, Z, SEED) + 4, 6); // h defaults to 4
  });

  it('a plain box (hw + hd, no standableTop) collides full-height, oriented by rot', () => {
    const [c] = buildDecorPropColliders(SEED, [
      { key: 'k', x: X, z: Z, r: 3, hw: 1.5, hd: 0.8, rot: 0.4 },
    ]);
    expect(c.type).toBe('obb');
    if (c.type !== 'obb') return;
    expect(c.hw).toBe(1.5);
    expect(c.hd).toBe(0.8);
    expect(c.rot).toBeCloseTo(0.4, 6);
    expect(c.moveTopY).toBeUndefined();
    expect(c.standable).toBeUndefined();
  });

  it('a circle with standableTop is a landable platform, not a wall', () => {
    const [c] = buildDecorPropColliders(SEED, [
      { key: 'k', x: X, z: Z, r: 1.2, standableTop: 2.25 },
    ]);
    expect(c.type).toBe('circle');
    if (c.type !== 'circle') return;
    expect(c.standable).toBe(true);
    expect(c.moveTopY).toBeCloseTo(groundHeight(X, Z, SEED) + 2.25, 6);
  });

  it('a box with standableTop is a landable platform', () => {
    const [c] = buildDecorPropColliders(SEED, [
      { key: 'k', x: X, z: Z, hw: 1, hd: 1, standableTop: 1.6 },
    ]);
    expect(c.type).toBe('obb');
    if (c.type !== 'obb') return;
    expect(c.standable).toBe(true);
    expect(c.moveTopY).toBeCloseTo(groundHeight(X, Z, SEED) + 1.6, 6);
  });

  it('standableTop with no footprint at all warns and degrades to walk-through, never throws', () => {
    // This builder is called every tick from colliders.ts gridFor, which
    // caches only on success: a throw here would re-fire forever against a
    // bad custom map (setActiveWorldContent, the world editor's play-test
    // entry) instead of failing once. See tests/decor_prop_colliders.test.ts
    // "every shipped standableTop entry has a footprint" below for the hard
    // gate on shipped content.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = buildDecorPropColliders(SEED, [{ key: 'no_r', x: X, z: Z, standableTop: 2 }]);
    expect(result).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/standableTop/);
    warn.mockRestore();
  });

  it('the h field drives cameraTopY independently of standableTop', () => {
    const [c] = buildDecorPropColliders(SEED, [
      { key: 'k', x: X, z: Z, r: 1, h: 8, standableTop: 1.6 },
    ]);
    expect(c.cameraTopY).toBeCloseTo(groundHeight(X, Z, SEED) + 8, 6);
    if (c.type === 'circle') expect(c.moveTopY).toBeCloseTo(groundHeight(X, Z, SEED) + 1.6, 6);
  });
});

describe('shipped decorProps content', () => {
  it('every standableTop entry has a footprint (r, or hw+hd)', () => {
    for (const d of PROPS.decorProps ?? []) {
      if (d.standableTop === undefined) continue;
      const hasFootprint = !!d.r || (d.hw !== undefined && d.hd !== undefined);
      expect(
        hasFootprint,
        `decorProps '${d.key}' at (${d.x}, ${d.z}) sets standableTop with no footprint`,
      ).toBe(true);
    }
  });
});
