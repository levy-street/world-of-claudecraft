// foliage_editor_scope.ts: the host-set scope the procedural foliage build
// reads (moved out of foliage.ts). Both switches default to "the whole world,
// no mirrors", which is the shipped game's build.

import { afterEach, describe, expect, it } from 'vitest';
import {
  appendFarPlacementDecos,
  foliageFarPlacementsActive,
  outsideFoliageBounds,
  setFoliageBounds,
  setFoliageFarPlacements,
} from '../src/render/foliage_editor_scope';
import type { Decoration } from '../src/sim/world';

const deco = (x: number, z: number): Decoration => ({ x, z }) as unknown as Decoration;

afterEach(() => {
  setFoliageBounds(null);
  setFoliageFarPlacements([]);
});

describe('foliage editor scope', () => {
  it('defaults to the whole world with no placement mirrors', () => {
    expect(outsideFoliageBounds(1e6, -1e6)).toBe(false);
    expect(foliageFarPlacementsActive()).toBe(false);
    const out: Decoration[] = [];
    appendFarPlacementDecos(out);
    expect(out).toEqual([]);
  });

  it('isolate bounds are half-open and copied, not aliased', () => {
    const rect = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 };
    setFoliageBounds(rect);
    rect.maxX = 1000;
    expect(outsideFoliageBounds(0, 0)).toBe(false);
    expect(outsideFoliageBounds(9.99, 9.99)).toBe(false);
    expect(outsideFoliageBounds(10, 5)).toBe(true);
    expect(outsideFoliageBounds(5, -0.01)).toBe(true);
  });

  it('appends only the mirrors inside the bounds, in order', () => {
    const a = deco(1, 1);
    const b = deco(50, 1);
    const c = deco(2, 3);
    setFoliageFarPlacements([a, b, c]);
    expect(foliageFarPlacementsActive()).toBe(true);
    setFoliageBounds({ minX: 0, maxX: 10, minZ: 0, maxZ: 10 });
    const out: Decoration[] = [deco(-5, -5)];
    appendFarPlacementDecos(out);
    expect(out.slice(1)).toEqual([a, c]);
  });
});
