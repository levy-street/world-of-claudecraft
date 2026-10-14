import { describe, expect, it, vi } from 'vitest';
import { planBuildingDrag } from '../src/editor/building_core';
import {
  type CustomMap,
  customMapToWorldContent,
  newFlatCustomMap,
  placementsToRenderAssets,
} from '../src/editor/custom_map';
import {
  bundleDependencyRefs,
  missingBundleEntries,
  prepareMapForEngine,
} from '../src/editor/export_contract';
import { parseMap, serializeMapCompact } from '../src/editor/persist';
import { cloneAssetPlacement } from '../src/editor/selection_clipboard';
import { deepglassMap } from '../src/editor/shipped_deepglass';
import * as deepglassWorld from '../src/sim/deepglass/world';
import { CUSTOM_PAINT_ID_MIN, MODEL_PATH } from '../src/sim/map_doc';

const SHARED_TEXTURE = 'a'.repeat(64);
const WALL_ONLY_TEXTURE = 'b'.repeat(64);
const TERRAIN_ONLY_TEXTURE = 'c'.repeat(64);

function builtCastle(): CustomMap {
  const map = newFlatCustomMap('Castle', 'castle-map', 42, { width: 64, height: 64 });
  const building = { id: 'castle', baseY: 36, floorHeight: 6, levels: 3 };
  const room = planBuildingDrag({
    mode: 'room',
    start: { x: 0, z: 0 },
    end: { x: 6, z: 4 },
    building,
    level: 1,
    gridSize: 2,
    existingPlacementCount: 0,
  });
  expect(room.error).toBeUndefined();
  map.buildings = [building];
  map.placements = room.placements;
  map.placements[0].wallFinishes = {
    front: { texture: `custom:${SHARED_TEXTURE}`, tileSize: 4, color: 0xeeddaa },
    back: { texture: 'Bricks001', tileSize: 2 },
  };
  map.placements[1].wallFinishes = {
    front: { texture: `custom:${SHARED_TEXTURE}`, tileSize: 8 },
    back: { texture: `custom:${SHARED_TEXTURE}`, tileSize: 1 },
  };
  map.placements[2].wallFinishes = {
    front: { texture: `custom:${WALL_ONLY_TEXTURE}`, tileSize: 2 },
    back: { texture: `custom:${SHARED_TEXTURE}`, tileSize: 4 },
  };
  map.placements.push({
    assetId: 'tidehold/castle_b',
    x: 3,
    z: 2,
    rotY: 0,
    scale: 1,
    collide: false,
    detached: true,
    groundY: 48,
    building: { id: 'castle', level: 2, kind: 'object' },
  });
  map.biomePaint = {
    cell: 1,
    originX: -32,
    originZ: -32,
    cols: 64,
    rows: 64,
    ids: Array(64 * 64).fill(CUSTOM_PAINT_ID_MIN),
    custom: [
      { id: CUSTOM_PAINT_ID_MIN, color: 0xffffff, textureSha: SHARED_TEXTURE },
      { id: CUSTOM_PAINT_ID_MIN + 1, color: 0xffffff, textureSha: TERRAIN_ONLY_TEXTURE },
    ],
  };
  return map;
}

function saveAndReload(map: CustomMap): CustomMap {
  const parsed = parseMap(serializeMapCompact(map));
  if (!parsed) throw new Error('Building map did not survive the editor save path');
  return parsed;
}

describe('building persistence across editor save, projection, and export', () => {
  it.each(['bare', 'kit'] as const)(
    'keeps diagonal %s wall transforms through compact save and reload',
    (source) => {
      const map = newFlatCustomMap('Diagonal castle', 'diagonal-castle', 42);
      const building = { id: 'castle', baseY: 36, floorHeight: 6, levels: 2 };
      const plan = planBuildingDrag({
        mode: 'wall',
        start: { x: 0, z: 0 },
        end: { x: -8, z: 6 },
        building,
        level: 1,
        gridSize: 1,
        diagonal: true,
        existingPlacementCount: 0,
        wall:
          source === 'kit'
            ? {
                assetId: 'tidehold_parts/castle_wall',
                footprint: { sizeX: 0.2, sizeY: 3.5, sizeZ: 2.2 },
                scale: 2,
              }
            : undefined,
      });
      expect(plan.error).toBeUndefined();
      expect(plan.placements.length).toBeGreaterThan(0);
      map.buildings = [building];
      map.placements = plan.placements;
      const loaded = saveAndReload(map);
      expect(loaded.placements).toHaveLength(plan.placements.length);
      plan.placements.forEach((p, i) => {
        expect(loaded.placements[i]).toMatchObject(p);
      });
      expect(saveAndReload(loaded)).toEqual(loaded);
    },
  );

  it('preserves room geometry, floor definitions, memberships, and both finishes through compact saves', () => {
    const original = builtCastle();
    const bytes = serializeMapCompact(original);
    const stored = JSON.parse(bytes);
    expect(typeof stored.biomePaint.idsRle).toBe('string');
    expect(stored.biomePaint.ids).toBeUndefined();
    const loaded = saveAndReload(original);

    expect(loaded.buildings).toEqual([{ id: 'castle', baseY: 36, floorHeight: 6, levels: 3 }]);
    expect(loaded.placements).toHaveLength(original.placements.length);
    expect(loaded.placements.map((placement) => placement.building)).toEqual(
      original.placements.map((placement) => placement.building),
    );
    expect(loaded.placements[0].wallFinishes).toEqual({
      front: { texture: `custom:${SHARED_TEXTURE}`, tileSize: 4, color: 0xeeddaa },
      back: { texture: 'Bricks001', tileSize: 2 },
    });
    const floor = loaded.placements.find((placement) => placement.building?.kind === 'floor');
    expect(floor).toMatchObject({
      building: { id: 'castle', level: 1, kind: 'floor' },
      detached: true,
      groundY: 42,
      ramps: [{ x: 0, z: 0, hx: 3, hz: 2, y0: 0, y1: 0 }],
    });
    expect(floor?.meshes).toEqual(
      original.placements.find((placement) => placement.building?.kind === 'floor')?.meshes,
    );
    expect(loaded.biomePaint).toEqual(original.biomePaint);
    expect(saveAndReload(loaded)).toEqual(loaded);
  });

  it('projects loaded memberships and both finishes without sharing mutable document records', () => {
    const loaded = saveAndReload(builtCastle());
    const projected = placementsToRenderAssets(loaded.placements);
    expect(projected).toHaveLength(loaded.placements.length);
    expect(projected.every((placement) => placement !== null)).toBe(true);
    expect(projected[0]).toMatchObject({
      path: MODEL_PATH,
      building: { id: 'castle', level: 1, kind: 'wall' },
      groundY: 42,
      wallFinishes: loaded.placements[0].wallFinishes,
    });
    expect(projected.at(-1)?.building).toEqual({ id: 'castle', level: 2, kind: 'object' });
    const first = projected[0];
    if (!first?.building || !first.wallFinishes?.front || !first.wallFinishes.back) {
      throw new Error('Projected wall metadata missing');
    }
    first.building.level = 0;
    first.wallFinishes.front.tileSize = 64;
    first.wallFinishes.back.texture = 'Wood001';
    expect(loaded.placements[0].building?.level).toBe(1);
    expect(loaded.placements[0].wallFinishes?.front?.tileSize).toBe(4);
    expect(loaded.placements[0].wallFinishes?.back?.texture).toBe('Bricks001');
  });

  it('keeps definitions and finish data in the engine-approved exported document and playtest world', () => {
    const loaded = saveAndReload(builtCastle());
    const prepared = prepareMapForEngine(loaded);
    const reopened = parseMap(prepared.json);
    expect(reopened?.buildings).toEqual(loaded.buildings);
    expect(reopened?.placements.map((placement) => placement.building)).toEqual(
      loaded.placements.map((placement) => placement.building),
    );
    expect(prepared.world.placements?.[0].wallFinishes).toEqual(loaded.placements[0].wallFinishes);
    expect(prepared.world.placements?.[0].building).toEqual({
      id: 'castle',
      level: 1,
      kind: 'wall',
    });
  });

  it('packs custom textures once across sides, wall pieces, and terrain, excluding built-in wall art', () => {
    const loaded = saveAndReload(builtCastle());
    expect(bundleDependencyRefs(loaded)).toEqual({
      models: [],
      textures: [SHARED_TEXTURE, WALL_ONLY_TEXTURE, TERRAIN_ONLY_TEXTURE],
      skyboxes: [],
    });
    const sharedFiles = [
      { path: 'map.json' },
      { path: `textures/${SHARED_TEXTURE}` },
      { path: `textures/${TERRAIN_ONLY_TEXTURE}` },
    ];
    expect(missingBundleEntries(loaded, sharedFiles)).toBe(1);
    expect(
      missingBundleEntries(loaded, [...sharedFiles, { path: `textures/${WALL_ONLY_TEXTURE}` }]),
    ).toBe(0);
  });

  it('keeps duplicated wall edits independent and saves the two copies with their own finishes', () => {
    const map = saveAndReload(builtCastle());
    const original = map.placements[0];
    const clone = cloneAssetPlacement(original);
    if (!clone.building || !clone.wallFinishes?.front || !clone.wallFinishes.back) {
      throw new Error('Cloned wall metadata missing');
    }
    clone.building.level = 2;
    clone.wallFinishes.front.texture = `custom:${WALL_ONLY_TEXTURE}`;
    clone.wallFinishes.back.tileSize = 8;
    map.placements = [original, clone];
    const loaded = saveAndReload(map);
    expect(loaded.placements[0].building?.level).toBe(1);
    expect(loaded.placements[1].building?.level).toBe(2);
    expect(loaded.placements[0].wallFinishes).toEqual({
      front: { texture: `custom:${SHARED_TEXTURE}`, tileSize: 4, color: 0xeeddaa },
      back: { texture: 'Bricks001', tileSize: 2 },
    });
    expect(loaded.placements[1].wallFinishes).toEqual({
      front: { texture: `custom:${WALL_ONLY_TEXTURE}`, tileSize: 4, color: 0xeeddaa },
      back: { texture: 'Bricks001', tileSize: 8 },
    });
  });

  it('retains membership and finish records when shipped world placements become an editable map', () => {
    const source = customMapToWorldContent(saveAndReload(builtCastle()));
    // Inject the authored world at the existing shipped-map boundary; the real
    // conversion and serializer remain under test, without modifying live content.
    const worldBuilder = vi.spyOn(deepglassWorld, 'buildDeepglassWorld').mockReturnValue(source);
    try {
      const converted = deepglassMap('Castle snapshot', 'castle-snapshot', 42);
      const loaded = saveAndReload(converted);
      expect(loaded.placements[0].building).toEqual({ id: 'castle', level: 1, kind: 'wall' });
      expect(loaded.placements[0].wallFinishes).toEqual(source.placements?.[0].wallFinishes);
      expect(converted.placements[0].wallFinishes).not.toBe(source.placements?.[0].wallFinishes);
      expect(converted.placements[0].wallFinishes?.front).not.toBe(
        source.placements?.[0].wallFinishes?.front,
      );
      expect(converted.placements[0].building).not.toBe(source.placements?.[0].building);
    } finally {
      worldBuilder.mockRestore();
    }
  });
});
