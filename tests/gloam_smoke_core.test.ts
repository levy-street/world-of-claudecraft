// The pure half of Gloamveil's shadow smoke: a fixed pool of puffs, which one
// gives way when the pool is full, and how a puff swells and thins.
import { describe, expect, it } from 'vitest';
import {
  type GloamPuff,
  GloamSmokePool,
  gloamPuffAlpha,
  gloamPuffSize,
} from '../src/render/gloam_smoke_core';

function puff(overrides: Partial<GloamPuff> = {}): GloamPuff {
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    size: 1,
    grow: 2,
    life: 1,
    peak: 0.5,
    tint: 0,
    rot: 0,
    spin: 0,
    ...overrides,
  };
}

describe('a puff over its life', () => {
  it('swells fast and ends at its grown size', () => {
    expect(gloamPuffSize(0.5, 3, 0)).toBe(0.5);
    expect(gloamPuffSize(0.5, 3, 1)).toBe(1.5);
    // Past the half way point of its swell by a quarter of its life.
    const quarter = gloamPuffSize(0.5, 3, 0.25);
    expect(quarter).toBeGreaterThan(0.5 + (1.5 - 0.5) * 0.4);
    let last = 0;
    for (let age = 0; age <= 1.0001; age += 0.05) {
      const size = gloamPuffSize(0.5, 3, Math.min(1, age));
      expect(size).toBeGreaterThanOrEqual(last);
      last = size;
    }
  });

  it('fades in quickly, holds its peak, and thins out to nothing', () => {
    expect(gloamPuffAlpha(0.6, 0)).toBe(0);
    expect(gloamPuffAlpha(0.6, 0.07)).toBeCloseTo(0.3, 12);
    expect(gloamPuffAlpha(0.6, 0.14)).toBeCloseTo(0.6, 12);
    expect(gloamPuffAlpha(0.6, 0.3)).toBeCloseTo(0.6, 12);
    expect(gloamPuffAlpha(0.6, 0.65)).toBeCloseTo(0.6 * 0.25, 12);
    expect(gloamPuffAlpha(0.6, 1)).toBe(0);
    for (let age = 0; age <= 1; age += 0.01) {
      expect(gloamPuffAlpha(0.6, age)).toBeLessThanOrEqual(0.6 + 1e-12);
    }
  });
});

describe('GloamSmokePool', () => {
  it('fills the next free slot until the pool is full', () => {
    const pool = new GloamSmokePool(3);
    expect(pool.count).toBe(0);
    expect(pool.add(puff({ x: 1 }))).toBe(0);
    expect(pool.add(puff({ x: 2 }))).toBe(1);
    expect(pool.add(puff({ x: 3 }))).toBe(2);
    expect(pool.count).toBe(3);
    expect([...pool.position].filter((_, i) => i % 3 === 0)).toEqual([1, 2, 3]);
    // A new puff starts invisible at its own size: the fade in is the step's.
    expect([...pool.alpha]).toEqual([0, 0, 0]);
    expect([...pool.size]).toEqual([1, 1, 1]);
  });

  it('gives a full pool slot of the puff nearest its end, never the count', () => {
    const pool = new GloamSmokePool(3);
    pool.add(puff({ x: 1, life: 4 }));
    pool.add(puff({ x: 2, life: 1 }));
    pool.add(puff({ x: 3, life: 2 }));
    pool.step(0.5);
    // Slot 1 has half its life left, the least of the three.
    expect(pool.remaining(0)).toBeCloseTo(0.875, 6);
    expect(pool.remaining(1)).toBeCloseTo(0.5, 6);
    expect(pool.remaining(2)).toBeCloseTo(0.75, 6);
    expect(pool.add(puff({ x: 9, life: 5 }))).toBe(1);
    expect(pool.count).toBe(3);
    expect(pool.position[3]).toBe(9);
    expect(pool.remaining(1)).toBe(1);
    // The other two were not touched.
    expect(pool.position[0]).toBe(1);
    expect(pool.position[6]).toBe(3);
  });

  it('drops a puff that ended and keeps the live ones packed at the front', () => {
    const pool = new GloamSmokePool(4);
    pool.add(puff({ x: 1, life: 0.2 }));
    pool.add(puff({ x: 2, life: 5 }));
    pool.add(puff({ x: 3, life: 0.2 }));
    pool.add(puff({ x: 4, life: 5 }));
    pool.step(0.3);
    expect(pool.count).toBe(2);
    const alive = [pool.position[0], pool.position[3]].sort();
    expect(alive).toEqual([2, 4]);
    // The slots past the count are free again.
    expect(pool.add(puff({ x: 7 }))).toBe(2);
  });

  it('rises, drags sideways, turns, swells and fades as it steps', () => {
    const pool = new GloamSmokePool(1);
    pool.add(puff({ vx: 2, vy: 1, vz: -2, size: 0.4, grow: 3, life: 2, peak: 0.8, spin: 1 }));
    pool.step(0.5);
    // Vertical speed is kept; sideways speed is dragged.
    expect(pool.position[1]).toBeCloseTo(0.5, 6);
    expect(pool.position[0]).toBeGreaterThan(0);
    expect(pool.position[0]).toBeLessThan(1);
    expect(pool.position[2]).toBeCloseTo(-pool.position[0], 6);
    expect(pool.rot[0]).toBeCloseTo(0.5, 6);
    expect(pool.size[0]).toBeCloseTo(gloamPuffSize(0.4, 3, 0.25), 6);
    expect(pool.alpha[0]).toBeCloseTo(gloamPuffAlpha(0.8, 0.25), 6);
  });

  it('refuses a puff that would never show, and a pool of nothing', () => {
    const pool = new GloamSmokePool(2);
    expect(pool.add(puff({ life: 0 }))).toBe(-1);
    expect(pool.add(puff({ life: -1 }))).toBe(-1);
    expect(pool.add(puff({ life: Number.NaN }))).toBe(-1);
    expect(pool.count).toBe(0);
    expect(new GloamSmokePool(0).add(puff())).toBe(-1);
  });

  it('empties on clear and steps an empty pool as a no-op', () => {
    const pool = new GloamSmokePool(2);
    pool.add(puff());
    pool.clear();
    expect(pool.count).toBe(0);
    pool.step(1);
    expect(pool.count).toBe(0);
    expect(pool.remaining(0)).toBe(0);
  });
});
