import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// Compile/composition fixtures start from the canonical world, just like the
// exporter. The real activated migration is covered by world_layout_candidate.
vi.mock('../src/sim/world_layout/active', () => ({
  WORLD_LAYOUT: {
    version: 1,
    buildings: {},
    npcs: {},
    camps: [],
    groundObjects: {},
    objectMoves: {},
  },
}));

import { compileLayoutEnvironment } from '../src/editor/world_layout_environment';
import { BUILTIN_WORLD } from '../src/sim/data';
import { grassClearedAt } from '../src/sim/grass_clear';
import type { MapDoc } from '../src/sim/map_doc';
import { applyHeightStamp } from '../src/sim/terrain_edit_layer';
import { placeLayoutEnvironment } from '../src/sim/world_layout/environment';

const source = JSON.parse(
  readFileSync('data/maps/eastbrook_and_mirefen_changes.map.json', 'utf8'),
) as MapDoc;
const review = {
  reason: 'Layer authored edits over current pads; retain newer terrain features.',
  terrainEdits: true,
  grassClear: true,
  biomePaint: true,
} as const;
function compile(map = source) {
  const issues: string[] = [];
  const environment = compileLayoutEnvironment(map, review, (id) => issues.push(id));
  return { issues, environment };
}

describe('layout terrain, grass and paint composition', () => {
  it('preserves every source dab in final order and retains canonical terrain underneath', () => {
    const { environment, issues } = compile();
    expect(issues).toEqual([]);
    expect(environment!.terrainEdits).toEqual(
      source.terrainEdits.map(({ id: _id, ...stamp }) => stamp),
    );
    const world = placeLayoutEnvironment(BUILTIN_WORLD, environment);
    const count = BUILTIN_WORLD.terrainEdits!.length;
    expect(world.terrainEdits!.slice(0, count)).toEqual(BUILTIN_WORLD.terrainEdits);
    // The authored sequence plus the two reviewed Highwatch access stamps.
    expect(world.terrainEdits!.slice(count)).toHaveLength(7763);
    expect(world.grassClear).toHaveLength(250);
    const first = source.grassClear![0];
    expect(grassClearedAt(world.grassClear, first.x, first.z)).toBe(true);
    expect(world.biomePaint!.ids).toHaveLength(1081 * 2601);
    expect(world.biomePaint!.custom!.map((s) => s.textureSha)).toContain('builtin:Cobblestone002');
    expect(world.biomePaint!.ids.filter((id) => id === 201)).toHaveLength(3);
    expect(world.biomePaint!.ids.filter((id) => id === 1)).toHaveLength(1517);
    expect(world.npcs).toBe(BUILTIN_WORLD.npcs);
    expect(world.props).toBe(BUILTIN_WORLD.props);
  });

  it('preserves duplicate sculpt operations and order when evaluating height', () => {
    const add = { x: 0, z: 0, radius: 3, delta: 2, falloff: 'flat' as const };
    const level = { ...add, mode: 'level' as const, delta: 5 };
    const world = placeLayoutEnvironment(
      { ...BUILTIN_WORLD, terrainEdits: [level] },
      { terrainEdits: [add, add] },
    );
    expect(world.terrainEdits!.reduce((h, stamp) => applyHeightStamp(stamp, 0, 0, h), 100)).toBe(9);
    expect(placeLayoutEnvironment(BUILTIN_WORLD)).toBe(BUILTIN_WORLD);
  });

  it('overlays painted cells while preserving current paint and clearings in unpainted areas', () => {
    const grid = { cell: 1, cols: 3, rows: 1, originX: 0, originZ: 0 };
    const current = {
      ...BUILTIN_WORLD,
      biomePaint: { ...grid, ids: [2, 2, 2] },
      grassClear: [{ x: 100, z: 100, r: 3 }],
    };
    const world = placeLayoutEnvironment(current, {
      biomePaint: { ...grid, idsRle: '1:255,1:1,1:255' },
      grassClear: [{ x: 0, z: 0, r: 2 }],
    });
    expect(world.biomePaint!.ids).toEqual([2, 1, 2]);
    expect(world.grassClear).toEqual([
      { x: 100, z: 100, r: 3 },
      { x: 0, z: 0, r: 2 },
    ]);
    expect(() =>
      placeLayoutEnvironment(current, { biomePaint: { ...grid, cell: 2, idsRle: '3:255' } }),
    ).toThrow('conflicts');
    expect(() =>
      placeLayoutEnvironment(current, { biomePaint: { ...grid, idsRle: '2:255' } }),
    ).toThrow('encoding');
    expect(() =>
      placeLayoutEnvironment(current, { biomePaint: { ...grid, idsRle: '3:255', edgeDetail: 1 } }),
    ).toThrow('edge settings');
    expect(() =>
      placeLayoutEnvironment(
        { ...current, biomePaint: { ...current.biomePaint, edgeSoftness: 0 } },
        { biomePaint: { ...grid, idsRle: '3:255' } },
      ),
    ).toThrow('edge settings');
  });

  it('blocks invalid or silently clamped source layers and missing imported textures', () => {
    const small = {
      ...source,
      terrainEdits: [source.terrainEdits[0]],
      grassClear: [{ x: 0, z: 0, r: 2 }],
      biomePaint: { cell: 1, cols: 1, rows: 1, originX: 0, originZ: 0, ids: [255] },
    };
    expect(compile(small).issues).toEqual([]);
    expect(
      compile({ ...small, terrainEdits: [{ ...small.terrainEdits[0], radius: 900 }] }).issues,
    ).toContain('terrain:0');
    expect(
      compile({ ...small, terrainEdits: [{ ...small.terrainEdits[0], delta: Number.NaN }] }).issues,
    ).toContain('terrain:0');
    expect(compile({ ...small, grassClear: [{ x: 0, z: 0, r: -1 }] }).issues).toContain('grass:0');
    expect(compile({ ...small, biomePaint: { ...small.biomePaint, ids: [999] } }).issues).toContain(
      'biome-paint',
    );
    expect(
      compile({
        ...small,
        biomePaint: {
          ...small.biomePaint,
          ids: [200],
          custom: [{ id: 200, color: 1, textureSha: 'a'.repeat(64) }],
        },
      }).issues,
    ).toContain('paint-texture:200');
    expect(
      compile({
        ...small,
        biomePaint: {
          ...small.biomePaint,
          ids: [200],
          custom: [{ id: 200, color: 1, textureSha: 'builtin:MissingTexture' }],
        },
      }).issues,
    ).toContain('paint-texture:200');
  });
});
