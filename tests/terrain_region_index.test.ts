import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildTerrainRegionIndex,
  TERRAIN_APPLIER,
  TERRAIN_APPLIER_BOUNDS,
  TERRAIN_REGION_CELL_SIZE,
  type TerrainRegionBounds,
  terrainRegionCellAt,
  terrainRegionHas,
} from '../src/sim/terrain_region_index';

describe('terrain region index', () => {
  it('keeps ordered candidates and both mask words across negative cells and guard margins', () => {
    const appliers: (readonly TerrainRegionBounds[] | null)[] = new Array(34).fill(null);
    appliers[0] = [{ minX: 0, maxX: 4, minZ: 0, maxZ: 4 }];
    appliers[31] = [{ minX: 500, maxX: 504, minZ: 500, maxZ: 504 }];
    appliers[32] = [{ minX: 700, maxX: 704, minZ: 700, maxZ: 704 }];
    appliers[33] = [{ minX: -260, maxX: -250, minZ: -260, maxZ: -250 }];
    const index = buildTerrainRegionIndex({
      applierBounds: appliers,
      campBounds: [
        { minX: 0, maxX: 2, minZ: 0, maxZ: 2 },
        { minX: -260, maxX: -250, minZ: -260, maxZ: -250 },
        { minX: 1, maxX: 3, minZ: 1, maxZ: 3 },
      ],
      hubBounds: [
        { minX: 1, maxX: 2, minZ: 1, maxZ: 2 },
        { minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
      ],
    });

    const origin = terrainRegionCellAt(index, 0, 0);
    expect(terrainRegionHas(origin, 0)).toBe(true);
    expect(terrainRegionHas(origin, 33)).toBe(false);
    expect(origin.campIndices).toEqual([0, 2]);
    expect(origin.hubIndices).toEqual([0, 1]);

    const negative = terrainRegionCellAt(index, -255, -255);
    expect(terrainRegionHas(negative, 0)).toBe(false);
    expect(terrainRegionHas(negative, 33)).toBe(true);
    expect(negative.campIndices).toEqual([1]);

    const guarded = terrainRegionCellAt(index, 129, 0);
    expect(terrainRegionHas(guarded, 0)).toBe(true);
    expect(guarded.campIndices).toEqual([0, 2]);
    expect(guarded.hubIndices).toEqual([0, 1]);

    expect(terrainRegionHas(terrainRegionCellAt(index, -1, 0), 0)).toBe(true);
    expect(terrainRegionHas(terrainRegionCellAt(index, 0, -1), 0)).toBe(true);
    expect(terrainRegionHas(terrainRegionCellAt(index, 0, 129), 0)).toBe(true);
    expect(terrainRegionHas(terrainRegionCellAt(index, 256, 0), 0)).toBe(false);
    expect(terrainRegionHas(terrainRegionCellAt(index, 0, 256), 0)).toBe(false);

    expect(terrainRegionHas(terrainRegionCellAt(index, 500, 500), 31)).toBe(true);
    expect(terrainRegionHas(terrainRegionCellAt(index, 700, 700), 32)).toBe(true);

    const far = terrainRegionCellAt(index, 10_000, 10_000);
    expect(terrainRegionHas(far, 0)).toBe(false);
    expect(terrainRegionHas(far, 1)).toBe(true);
    expect(terrainRegionHas(far, 33)).toBe(false);
    expect(far.campIndices).toEqual([]);
    expect(far.hubIndices).toEqual([]);
  });

  it('keeps the production table sparse in a far cell', () => {
    expect(TERRAIN_REGION_CELL_SIZE).toBe(128);
    const index = buildTerrainRegionIndex({
      applierBounds: TERRAIN_APPLIER_BOUNDS,
      campBounds: [],
      hubBounds: [],
    });
    const far = terrainRegionCellAt(index, 10_000, 0);
    const always = new Set<number>([
      TERRAIN_APPLIER.emberShaping,
      TERRAIN_APPLIER.valeCoast,
      TERRAIN_APPLIER.starterMoat,
      TERRAIN_APPLIER.columnStraits,
      TERRAIN_APPLIER.rowMeres,
      TERRAIN_APPLIER.northBay,
    ]);
    for (let id = 0; id < TERRAIN_APPLIER_BOUNDS.length; id++) {
      expect(terrainRegionHas(far, id), `production applier ${id}`).toBe(always.has(id));
    }
  });

  it('keeps sparse candidates wired into the production height path', () => {
    const source = readFileSync(new URL('../src/sim/world.ts', import.meta.url), 'utf8');
    const baseStart = source.indexOf('function baseHeight(');
    const baseEnd = source.indexOf('// The custom-map edit layer', baseStart);
    const heightStart = source.indexOf('function terrainHeightUnpadded(');
    const heightEnd = source.indexOf('export const STEEPNESS_SAMPLE', heightStart);
    expect(baseStart).toBeGreaterThanOrEqual(0);
    expect(baseEnd).toBeGreaterThan(baseStart);
    expect(heightStart).toBeGreaterThanOrEqual(0);
    expect(heightEnd).toBeGreaterThan(heightStart);

    const baseBody = source.slice(baseStart, baseEnd);
    expect(baseBody).toContain('for (const zoneIndex of region.hubIndices)');
    expect(baseBody).not.toContain('for (const zone of ZONES)');

    const heightBody = source.slice(heightStart, heightEnd);
    expect(heightBody).toContain('const region = terrainRegionAt(x, z);');
    expect(heightBody).toContain('let h = baseHeight(x, z, seed, region);');
    expect(heightBody).toContain('for (const campIndex of region.campIndices)');
    expect(heightBody).not.toContain('for (const camp of CAMPS)');
    expect(heightBody.match(/terrainRegionHas\(region, TERRAIN_APPLIER\./g)).toHaveLength(34);
  });

  it('falls back to the full ordered scan for non-finite query coordinates', () => {
    const index = buildTerrainRegionIndex({
      applierBounds: [
        [{ minX: 0, maxX: 1, minZ: 0, maxZ: 1 }],
        [{ minX: 200, maxX: 201, minZ: 200, maxZ: 201 }],
      ],
      campBounds: [
        { minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
        { minX: 200, maxX: 201, minZ: 200, maxZ: 201 },
      ],
      hubBounds: [
        { minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
        { minX: 200, maxX: 201, minZ: 200, maxZ: 201 },
      ],
    });

    const cell = terrainRegionCellAt(index, Number.NaN, 0);
    expect(terrainRegionHas(cell, 0)).toBe(true);
    expect(terrainRegionHas(cell, 1)).toBe(true);
    expect(cell.campIndices).toEqual([0, 1]);
    expect(cell.hubIndices).toEqual([0, 1]);

    for (const [x, z] of [
      [0, Number.NaN],
      [Number.POSITIVE_INFINITY, 0],
      [0, Number.NEGATIVE_INFINITY],
    ]) {
      const full = terrainRegionCellAt(index, x, z);
      expect(terrainRegionHas(full, 0)).toBe(true);
      expect(terrainRegionHas(full, 1)).toBe(true);
      expect(full.campIndices).toEqual([0, 1]);
      expect(full.hubIndices).toEqual([0, 1]);
    }
  });

  it('makes unsafe bounds always-run and rejects oversized applier tables', () => {
    const index = buildTerrainRegionIndex({
      applierBounds: [
        [{ minX: Number.NaN, maxX: 1, minZ: 0, maxZ: 1 }],
        [{ minX: 2, maxX: 1, minZ: 0, maxZ: 1 }],
        [{ minX: 0, maxX: 128_000_000, minZ: 0, maxZ: 128_000_000 }],
      ],
      campBounds: [],
      hubBounds: [],
    });
    const far = terrainRegionCellAt(index, -10_000, -10_000);
    expect(terrainRegionHas(far, 0)).toBe(true);
    expect(terrainRegionHas(far, 1)).toBe(true);
    expect(terrainRegionHas(far, 2)).toBe(true);

    expect(() =>
      buildTerrainRegionIndex({
        applierBounds: new Array(65).fill(null),
        campBounds: [],
        hubBounds: [],
      }),
    ).toThrow('terrain region index supports at most 64 appliers');
  });
});
