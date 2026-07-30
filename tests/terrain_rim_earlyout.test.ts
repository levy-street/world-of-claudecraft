import { describe, expect, it } from 'vitest';
import { WORLD_MAX_Z } from '../src/sim/data';
import { northRimWeight, ridgePassWeight, terrainHeight } from '../src/sim/world';

// The release/v0.26.0 optimization was written for the old strip world. This
// branch uses a two-dimensional realm grid, so these assertions pin the same
// exact-zero early-out against its border and wandering north-rim formulas.
// Full terrain behavior remains pinned by the parity golden suite.
describe('terrain ridge and rim early-outs (issue #1620)', () => {
  it('returns exact +0 before the wandering north rim can begin', () => {
    const earliestOnset = WORLD_MAX_Z - 53;
    for (const x of [-540, -180, 0, 180, 540]) {
      for (const z of [-500, 0, 900, earliestOnset - 1, earliestOnset]) {
        const weight = northRimWeight(x, z);
        expect(weight).toBe(0);
        expect(Object.is(weight, 0)).toBe(true);
      }
    }
  });

  it('still evaluates the active north rim', () => {
    for (const x of [-540, -180, 0, 180, 540]) {
      expect(northRimWeight(x, WORLD_MAX_Z)).toBeGreaterThan(0);
    }
  });

  it('returns exact +0 across the flat road opening', () => {
    for (const distance of [-10, -5, 0, 5, 10]) {
      const pass = ridgePassWeight(distance);
      expect(pass).toBe(0);
      expect(Object.is(pass, 0)).toBe(true);
      for (const existing of [0, 1, 100]) {
        expect(Math.max(existing, 123.456 * pass)).toBe(existing);
      }
    }
    expect(ridgePassWeight(11)).toBeGreaterThan(0);
    expect(ridgePassWeight(34)).toBe(1);
  });

  it('keeps representative terrain samples deterministic', () => {
    const points: ReadonlyArray<readonly [number, number, number]> = [
      [0, -120, 42],
      [220, 300, 42],
      [-320, 780, 777],
      [0, WORLD_MAX_Z - 54, 777],
      [0, WORLD_MAX_Z - 20, 777],
    ];
    for (const [x, z, seed] of points) {
      const first = terrainHeight(x, z, seed);
      expect(Number.isFinite(first)).toBe(true);
      expect(Object.is(terrainHeight(x, z, seed), first)).toBe(true);
    }
  });
});
