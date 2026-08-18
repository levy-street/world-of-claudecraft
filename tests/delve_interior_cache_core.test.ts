import { describe, expect, it } from 'vitest';
import { delveInteriorBuildAction } from '../src/render/delve_interior_cache_core';

describe('delveInteriorBuildAction', () => {
  it('builds a position that has never been built', () => {
    expect(
      delveInteriorBuildAction(undefined, { moduleId: 'litany_ring', ox: 0, oz: 0 }, false),
    ).toBe('build');
  });

  it('skips a position mid-build', () => {
    expect(
      delveInteriorBuildAction(undefined, { moduleId: 'litany_ring', ox: 0, oz: 0 }, true),
    ).toBe('skip');
    expect(
      delveInteriorBuildAction(
        { moduleId: 'litany_ring', ox: 0, oz: 0 },
        { moduleId: 'litany_ring', ox: 0, oz: 0 },
        true,
      ),
    ).toBe('skip');
  });

  it('skips a position already built with the same module (same run, or a re-roll that picked the same room)', () => {
    expect(
      delveInteriorBuildAction(
        { moduleId: 'litany_ring', ox: 0, oz: 100 },
        { moduleId: 'litany_ring', ox: 0, oz: 100 },
        false,
      ),
    ).toBe('skip');
  });

  it('rebuilds a position whose cached module differs from the current run: a new run randomized a DIFFERENT room into a z-slot a previous run already occupied', () => {
    expect(
      delveInteriorBuildAction(
        { moduleId: 'litany_ring', ox: 0, oz: 100 },
        { moduleId: 'litany_sluice', ox: 0, oz: 100 },
        false,
      ),
    ).toBe('rebuild');
  });

  it('rebuilds when the same module/index moves because earlier room spans changed', () => {
    expect(
      delveInteriorBuildAction(
        { moduleId: 'litany_ring', ox: 0, oz: 174 },
        { moduleId: 'litany_ring', ox: 0, oz: 200 },
        false,
      ),
    ).toBe('rebuild');
  });
});
