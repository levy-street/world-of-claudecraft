import { describe, expect, it } from 'vitest';
import {
  CAMP_SELECT_RADIUS_FLOOR,
  nearestCampIndex,
  newCampAt,
  resolveCampClick,
} from '../src/editor/camp_core';
import type { CampDef } from '../src/sim/types';

const camp = (x: number, z: number, radius = 10): CampDef => ({
  mobId: 'boar',
  center: { x, z },
  radius,
  count: 3,
});

describe('nearestCampIndex', () => {
  it('selects the camp whose own radius contains the click point', () => {
    const camps = [camp(0, 0, 10), camp(50, 0, 10)];
    expect(nearestCampIndex(camps, 5, 0)).toBe(0);
    expect(nearestCampIndex(camps, 55, 0)).toBe(1);
    expect(nearestCampIndex(camps, 25, 0)).toBe(-1);
  });

  it('falls back to CAMP_SELECT_RADIUS_FLOOR for a camp smaller than the floor', () => {
    const camps = [camp(0, 0, 1)];
    // 3yd is outside the camp's own 1yd radius but inside the select floor.
    expect(CAMP_SELECT_RADIUS_FLOOR).toBeGreaterThan(1);
    expect(nearestCampIndex(camps, 3, 0)).toBe(0);
    expect(nearestCampIndex(camps, CAMP_SELECT_RADIUS_FLOOR + 1, 0)).toBe(-1);
  });

  it('nearest wins when two camp radii overlap the point', () => {
    const camps = [camp(0, 0, 10), camp(3, 0, 10)];
    expect(nearestCampIndex(camps, 3, 0)).toBe(1);
  });

  it('returns -1 for an empty camp list', () => {
    expect(nearestCampIndex([], 0, 0)).toBe(-1);
  });
});

describe('resolveCampClick', () => {
  it('selects an existing camp under the cursor instead of adding a new one', () => {
    const camps = [camp(0, 0, 10)];
    expect(resolveCampClick(camps, 1, 0, 'wolf', 5)).toEqual({ kind: 'select', index: 0 });
  });

  it('adds a new camp on empty ground under the cap', () => {
    const r = resolveCampClick([], 5, 5, 'wolf', 5);
    expect(r).toEqual({ kind: 'add', camp: newCampAt(5, 5, 'wolf') });
  });

  it('REGRESSION: refuses a new camp once the document is already at the cap', () => {
    // Bug: campClick had no cap check at all (unlike terrainEdits/placements/
    // blockers), so an author could push past MAX_CAMPS and the shared
    // sanitizer (src/sim/map_doc.ts) would silently drop the overflow on the
    // next save/load, losing camps with no warning.
    const camps = [camp(0, 0), camp(100, 0), camp(200, 0)];
    const r = resolveCampClick(camps, 300, 0, 'wolf', 3);
    expect(r).toEqual({ kind: 'capped' });
    expect(camps).toHaveLength(3); // never mutated
  });

  it('still allows the click that fills the LAST open slot under the cap', () => {
    const camps = [camp(0, 0)];
    const r = resolveCampClick(camps, 300, 0, 'wolf', 2);
    expect(r.kind).toBe('add');
  });
});
