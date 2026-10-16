import { describe, expect, it } from 'vitest';
import {
  MAX_BUILDING_LEVELS,
  MAX_BUILDING_Y,
  MAX_BUILDINGS,
  sanitizeBuilding,
  sanitizeBuildingMembership,
  sanitizeBuildings,
} from '../src/sim/building';

const building = { id: 'castle', baseY: 36, floorHeight: 6, levels: 3 };

describe('building save metadata', () => {
  it('pins the supported building, level and coordinate limits', () => {
    expect(MAX_BUILDINGS).toBe(128);
    expect(MAX_BUILDING_LEVELS).toBe(16);
    expect(MAX_BUILDING_Y).toBe(10000);
    expect(sanitizeBuilding({ ...building, baseY: -1e20 })?.baseY).toBe(-10000);
  });

  it('preserves valid definitions and memberships over a JSON round trip', () => {
    expect(sanitizeBuildings(JSON.parse(JSON.stringify([building])))).toEqual([building]);
    for (const kind of ['wall', 'floor', 'object'] as const) {
      const member = { id: 'castle', level: 2, kind };
      expect(sanitizeBuildingMembership(JSON.parse(JSON.stringify(member)))).toEqual(member);
    }
  });

  it('round-trips the wall face axis only on wall memberships', () => {
    for (const wallAxis of ['x', 'z']) {
      const member = { id: 'castle', level: 2, kind: 'wall', wallAxis };
      expect(sanitizeBuildingMembership(JSON.parse(JSON.stringify(member)))).toEqual(member);
      for (const kind of ['floor', 'object']) {
        expect(sanitizeBuildingMembership({ ...member, kind })).toEqual({
          id: 'castle',
          level: 2,
          kind,
        });
      }
    }
    expect(
      sanitizeBuildingMembership({ id: 'castle', level: 0, kind: 'wall', wallAxis: 'y' }),
    ).toEqual({ id: 'castle', level: 0, kind: 'wall' });
  });

  it('bounds level counts, floor heights and the full building vertical envelope', () => {
    expect(sanitizeBuilding({ ...building, levels: 500, floorHeight: 80, baseY: 1e20 })).toEqual({
      id: 'castle',
      levels: 16,
      floorHeight: 30,
      baseY: MAX_BUILDING_Y - 16 * 30,
    });
    expect(sanitizeBuilding({ ...building, levels: -3, floorHeight: 0, baseY: -1e20 })).toEqual({
      id: 'castle',
      levels: 1,
      floorHeight: 2,
      baseY: -MAX_BUILDING_Y,
    });
    expect(sanitizeBuilding({ ...building, levels: 2.8 })?.levels).toBe(2);
  });

  it.each([NaN, Infinity, -Infinity, undefined, '4'])(
    'refuses invalid numeric fields %s',
    (bad) => {
      for (const key of ['baseY', 'floorHeight', 'levels']) {
        expect(sanitizeBuilding({ ...building, [key]: bad })).toBeUndefined();
      }
    },
  );

  it('rejects malformed identities and memberships without moving them to another level', () => {
    for (const id of ['', 'a'.repeat(65), 3, null]) {
      expect(sanitizeBuilding({ ...building, id })).toBeUndefined();
      expect(sanitizeBuildingMembership({ id, level: 0, kind: 'wall' })).toBeUndefined();
    }
    for (const level of [-1, 0.5, MAX_BUILDING_LEVELS, NaN, Infinity, '1']) {
      expect(sanitizeBuildingMembership({ id: 'castle', level, kind: 'wall' })).toBeUndefined();
    }
    expect(sanitizeBuildingMembership({ id: 'castle', level: 0, kind: 'roof' })).toBeUndefined();
    expect(sanitizeBuildings(null)).toEqual([]);
    expect(sanitizeBuilding(null)).toBeUndefined();
    expect(sanitizeBuildingMembership(null)).toBeUndefined();
  });

  it('caps work before reading the rest of an imported list and keeps the first identity', () => {
    const rows = Array.from({ length: MAX_BUILDINGS }, (_, i) => ({ ...building, id: `b${i}` }));
    Object.defineProperty(rows, MAX_BUILDINGS, {
      get: () => {
        throw new Error('Entries outside the bound must not be visited');
      },
    });
    expect(sanitizeBuildings(rows)).toHaveLength(MAX_BUILDINGS);
    expect(sanitizeBuildings([building, { ...building, baseY: 200 }])).toEqual([building]);
  });
});
