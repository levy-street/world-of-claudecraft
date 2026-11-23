// Zone isolate mode's pure decisions: rects, point→zone filing, the isolate
// view distance, and the Scene tab's zone→group→placement tree.

import { describe, expect, it } from 'vitest';
import {
  buildSceneTree,
  isolateViewDistance,
  pointInRect,
  propsWithinRect,
  rectsIntersect,
  zoneIdForPoint,
  zoneRectOf,
} from '../src/editor/zone_isolate_core';
import { STRIP_MAX_X, STRIP_MIN_X } from '../src/sim/data';

const ZONES = [
  { id: 'south', name: 'South Vale', zMin: 0, zMax: 100 },
  { id: 'mid', name: 'Middle March', zMin: 100, zMax: 200, xMin: -50, xMax: 50 },
  { id: 'north', name: 'North Reach', zMin: 200, zMax: 300 },
];

describe('zoneRectOf', () => {
  it('fills absent x columns with the strip extents', () => {
    expect(zoneRectOf(ZONES[0])).toEqual({
      minX: STRIP_MIN_X,
      maxX: STRIP_MAX_X,
      minZ: 0,
      maxZ: 100,
    });
    expect(zoneRectOf(ZONES[1])).toEqual({ minX: -50, maxX: 50, minZ: 100, maxZ: 200 });
  });
});

describe('zoneIdForPoint', () => {
  it('files contained points by rect', () => {
    expect(zoneIdForPoint(ZONES, 0, 50)).toBe('south');
    expect(zoneIdForPoint(ZONES, 0, 150)).toBe('mid');
    expect(zoneIdForPoint(ZONES, 0, 250)).toBe('north');
  });

  it('clamps x-outliers to the southmost band beyond them (the sim walk)', () => {
    // Outside mid's x column at its z: the walk clamps to the southmost band
    // whose zMax lies beyond the point, mid itself, exactly like sim zoneAt.
    expect(zoneIdForPoint(ZONES, 400, 150)).toBe('mid');
  });

  it('files far-north points under the northmost zone, not nowhere', () => {
    expect(zoneIdForPoint(ZONES, 0, 999)).toBe('north');
    expect(zoneIdForPoint([], 0, 0)).toBeNull();
  });
});

describe('rect predicates', () => {
  const rect = { minX: -50, maxX: 50, minZ: 100, maxZ: 200 };
  it('pointInRect is inclusive-min exclusive-max', () => {
    expect(pointInRect(rect, -50, 100)).toBe(true);
    expect(pointInRect(rect, 50, 150)).toBe(false);
    expect(pointInRect(rect, 0, 200)).toBe(false);
  });
  it('rectsIntersect detects overlap and rejects touching-only edges', () => {
    expect(rectsIntersect(rect, { minX: 0, maxX: 100, minZ: 150, maxZ: 250 })).toBe(true);
    expect(rectsIntersect(rect, { minX: 50, maxX: 100, minZ: 100, maxZ: 200 })).toBe(false);
  });
});

describe('isolateViewDistance', () => {
  it('covers the zone diagonal with margin', () => {
    const d = isolateViewDistance({ minX: -50, maxX: 50, minZ: 100, maxZ: 200 });
    expect(d).toBeGreaterThan(Math.hypot(100, 100) / 2);
    expect(d).toBeLessThan(400);
  });
});

describe('propsWithinRect', () => {
  const rect = { minX: -50, maxX: 50, minZ: 100, maxZ: 200 };

  it('drops point dressing outside the rect and keeps what is inside', () => {
    const out = propsWithinRect(
      {
        buildings: [
          { x: 0, z: 150, w: 4 },
          { x: 400, z: 150, w: 4 },
        ],
        wells: [{ x: -49, z: 101 }],
      },
      rect,
    );
    expect(out.buildings).toEqual([{ x: 0, z: 150, w: 4 }]);
    expect(out.wells).toHaveLength(1);
  });

  it('keeps a segment with either end inside', () => {
    const out = propsWithinRect(
      {
        fences: [
          { x1: 0, z1: 150, x2: 400, z2: 150 },
          { x1: 300, z1: 150, x2: 400, z2: 150 },
        ],
      },
      rect,
    );
    expect(out.fences).toHaveLength(1);
  });

  it('passes non-array and position-less values through untouched', () => {
    const out = propsWithinRect({ mode: 'full', tuning: [{ scale: 2 }] }, rect);
    expect(out).toEqual({ mode: 'full', tuning: [{ scale: 2 }] });
  });

  it('never mutates the input', () => {
    const props = { buildings: [{ x: 999, z: 999 }] };
    propsWithinRect(props, rect);
    expect(props.buildings).toHaveLength(1);
  });
});

describe('buildSceneTree', () => {
  const row = (index: number, x: number, z: number, group: string) => ({
    index,
    name: `p${index}`,
    hidden: false,
    selected: false,
    x,
    z,
    group,
  });

  it('groups zone → group → rows, larger groups first, empty zones kept', () => {
    const tree = buildSceneTree(
      [
        row(0, 0, 50, 'dungeon'),
        row(1, 1, 55, 'dungeon'),
        row(2, 2, 60, 'props'),
        row(3, 0, 150, 'foliage'),
      ],
      ZONES,
    );
    expect(tree.map((z) => z.zoneId)).toEqual(['south', 'mid', 'north']);
    expect(tree[0].count).toBe(3);
    expect(tree[0].groups.map((g) => g.group)).toEqual(['dungeon', 'props']);
    expect(tree[1].groups).toEqual([
      { group: 'foliage', rows: [expect.objectContaining({ index: 3 })] },
    ]);
    expect(tree[2].count).toBe(0);
    expect(tree[2].groups).toEqual([]);
  });

  it('keeps document order inside a group', () => {
    const tree = buildSceneTree([row(5, 0, 10, 'a'), row(2, 0, 20, 'a')], ZONES);
    expect(tree[0].groups[0].rows.map((r) => r.index)).toEqual([5, 2]);
  });
});
