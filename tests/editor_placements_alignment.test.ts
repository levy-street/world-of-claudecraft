import { describe, expect, it } from 'vitest';
import { ASSET_CATALOG } from '../src/editor/asset_catalog.generated';
import {
  type AssetPlacement,
  placementsToPlayAssets,
  placementsToRenderAssets,
} from '../src/editor/custom_map';
import { needsReSeat, reindexAfterRemoval, unionRegion } from '../src/render/placed_assets';

// The doc-index/view-slot lockstep of the editor's placed-asset pipeline:
// placementsToRenderAssets stays index-aligned across unresolvable ids (the
// audited off-by-one where selecting placement 5 highlighted mesh 6), reSeat's
// region predicate scopes stroke-end re-seating, and reindexAfterRemoval keeps
// the view Map keyed by document index after a surgical single removal.

const GOOD_A = ASSET_CATALOG[0];
const GOOD_B = ASSET_CATALOG[1];

function place(assetId: string, x = 0, z = 0): AssetPlacement {
  return { assetId, x, z, rotY: 0, scale: 1, collide: false };
}

describe('placementsToRenderAssets index alignment', () => {
  it('keeps later indices aligned across an unresolvable id in the middle', () => {
    const out = placementsToRenderAssets([
      place(GOOD_A.id, 1, 1),
      place('no/such-asset', 2, 2),
      place(GOOD_B.id, 3, 3),
    ]);
    expect(out).toHaveLength(3);
    expect(out[0]?.path).toBe(GOOD_A.path);
    expect(out[1]).toBeNull();
    // Document index 2 still renders at slot 2, not compacted down to 1.
    expect(out[2]?.path).toBe(GOOD_B.path);
    expect(out[2]?.x).toBe(3);
  });

  it('resolves every slot when all ids are known', () => {
    const out = placementsToRenderAssets([place(GOOD_A.id), place(GOOD_B.id)]);
    expect(out.every((a) => a !== null)).toBe(true);
  });

  it('placementsToPlayAssets compacts the holes for the play-test world', () => {
    const out = placementsToPlayAssets([
      place('no/such-asset'),
      place(GOOD_A.id, 5, 6),
      place('also/bogus'),
      place(GOOD_B.id, 7, 8),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].path).toBe(GOOD_A.path);
    expect(out[1].path).toBe(GOOD_B.path);
  });

  it('colliding placements keep a positive footprint radius', () => {
    const out = placementsToRenderAssets([{ ...place(GOOD_A.id), collide: true, scale: 2 }]);
    expect(out[0]?.collideRadius).toBeGreaterThan(0);
  });
});

describe('reSeat region predicate (needsReSeat)', () => {
  const region = { minX: 10, minZ: 20, maxX: 30, maxZ: 40 };

  it('re-seats placements inside the region', () => {
    expect(needsReSeat(15, 25, region)).toBe(true);
    expect(needsReSeat(10, 40, region)).toBe(true); // on the edge
  });

  it('re-seats placements within the margin band just outside the region', () => {
    expect(needsReSeat(8.5, 25, region)).toBe(true); // default margin is 2yd
    expect(needsReSeat(31.5, 41.5, region)).toBe(true);
    expect(needsReSeat(8.5, 25, region, 1)).toBe(false); // tighter margin excludes it
  });

  it('skips placements clearly outside the region', () => {
    expect(needsReSeat(0, 0, region)).toBe(false);
    expect(needsReSeat(15, 43, region)).toBe(false);
    expect(needsReSeat(100, 25, region)).toBe(false);
  });
});

describe('unionRegion', () => {
  it('starts a union from a null accumulator with a copy', () => {
    const region = { minX: 1, minZ: 2, maxX: 3, maxZ: 4 };
    const acc = unionRegion(null, region);
    expect(acc).toEqual(region);
    expect(acc).not.toBe(region);
  });

  it('grows to the bounding box of both regions', () => {
    const acc = unionRegion(
      { minX: 0, minZ: 5, maxX: 10, maxZ: 15 },
      { minX: -4, minZ: 8, maxX: 6, maxZ: 22 },
    );
    expect(acc).toEqual({ minX: -4, minZ: 5, maxX: 10, maxZ: 22 });
  });
});

describe('reindexAfterRemoval (doc-index/view-slot lockstep)', () => {
  function mapOf(...keys: number[]): Map<number, string> {
    return new Map(keys.map((k) => [k, `entry-${k}`]));
  }

  it('shifts everything down on a head removal', () => {
    const entries = mapOf(0, 1, 2, 3);
    entries.delete(0);
    reindexAfterRemoval(entries, 0);
    expect([...entries.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [0, 'entry-1'],
      [1, 'entry-2'],
      [2, 'entry-3'],
    ]);
  });

  it('shifts only the entries above a middle removal', () => {
    const entries = mapOf(0, 1, 2, 3);
    entries.delete(2);
    reindexAfterRemoval(entries, 2);
    expect([...entries.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [0, 'entry-0'],
      [1, 'entry-1'],
      [2, 'entry-3'],
    ]);
  });

  it('leaves everything alone on a tail removal', () => {
    const entries = mapOf(0, 1, 2, 3);
    entries.delete(3);
    reindexAfterRemoval(entries, 3);
    expect([...entries.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [0, 'entry-0'],
      [1, 'entry-1'],
      [2, 'entry-2'],
    ]);
  });

  it('shifts across null-hole gaps (unresolvable ids have no view entry)', () => {
    // Doc indices 1 and 3 never resolved, so the Map only holds 0, 2, 4.
    // Removing doc index 2 must pull 4 down to 3; 0 stays.
    const entries = mapOf(0, 2, 4);
    entries.delete(2);
    reindexAfterRemoval(entries, 2);
    expect([...entries.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [0, 'entry-0'],
      [3, 'entry-4'],
    ]);
  });

  it('reindexes doc indices even when the removed slot itself had no entry', () => {
    // Removing an unresolvable placement (no Map entry at 1) still shifts the
    // survivors above it.
    const entries = mapOf(0, 2, 3);
    reindexAfterRemoval(entries, 1);
    expect([...entries.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [0, 'entry-0'],
      [1, 'entry-2'],
      [2, 'entry-3'],
    ]);
  });
});
