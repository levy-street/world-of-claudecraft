import { describe, expect, it } from 'vitest';
import { BundleDependencyError, buildMapBundle, zipRead, zipStore } from '../src/editor/bundle';
import { newCustomMap } from '../src/editor/custom_map';
import {
  bundleDependencyRefs,
  ExportCompatibilityError,
  missingBundleEntries,
  prepareMapForEngine,
} from '../src/editor/export_contract';
import { parseMap } from '../src/editor/persist';
import { Sim } from '../src/sim/sim';

describe('editor engine export contract', () => {
  it('canonicalizes, reimports, projects, and boots a current editor map', () => {
    const map = newCustomMap('Engine ready', 'engine-ready', 42);
    const prepared = prepareMapForEngine(map);
    const imported = parseMap(prepared.json);

    expect(imported).toEqual(prepared.map);
    expect(prepared.map).not.toBe(map);
    expect(
      () =>
        new Sim({
          seed: prepared.map.meta.seed,
          playerClass: 'warrior',
          noPlayer: true,
          world: prepared.world,
        }),
    ).not.toThrow();
  });

  it('exports the sanitizer-approved form instead of invalid editor numbers', () => {
    const map = newCustomMap('Canonical', 'canonical', 42);
    map.placements[0].x = Number.POSITIVE_INFINITY;
    map.placements[0].scale = 500;

    const prepared = prepareMapForEngine(map);

    expect(Number.isFinite(prepared.map.placements[0].x)).toBe(true);
    expect(prepared.map.placements[0].scale).toBeLessThanOrEqual(50);
    expect(parseMap(prepared.json)).toEqual(prepared.map);
  });

  it('blocks documents the shared engine sanitizer cannot salvage', () => {
    const map = newCustomMap('Broken', 'broken', 42);
    map.content.zones = [];

    expect(() => prepareMapForEngine(map)).toThrow(ExportCompatibilityError);
  });

  it('collects every portable dependency once', () => {
    const map = newCustomMap('Dependencies', 'dependencies', 42);
    map.placements.push(
      { assetId: 'local/model-a', x: 0, z: 0, rotY: 0, scale: 1, collide: false },
      { assetId: 'local/model-a', x: 1, z: 0, rotY: 0, scale: 1, collide: false },
      { assetId: 'local/model-b', x: 2, z: 0, rotY: 0, scale: 1, collide: false },
    );
    map.biomePaint = {
      cell: 1,
      originX: 0,
      originZ: 0,
      cols: 1,
      rows: 1,
      ids: [0],
      custom: [
        { id: 0, label: 'A', color: 0xffffff, textureSha: 'texture-a' },
        { id: 1, label: 'B', color: 0xeeeeee, textureSha: 'texture-a' },
      ],
    };
    map.skybox = 'custom:sky-a';

    expect(bundleDependencyRefs(map)).toEqual({
      models: ['model-a', 'model-b'],
      textures: ['texture-a'],
      skyboxes: ['sky-a'],
    });
  });

  it('builds a bundle whose map entry reimports exactly', async () => {
    const map = newCustomMap('Bundle', 'bundle', 42);
    const files = await buildMapBundle(map);
    const mapEntry = files.find((file) => file.path === 'map.json');

    expect(mapEntry).toBeDefined();
    expect(parseMap(new TextDecoder().decode(mapEntry?.bytes))).toEqual(
      prepareMapForEngine(map).map,
    );
  });

  it('round-trips a complete zip and rejects one corrupted payload byte', async () => {
    const map = newCustomMap('Zip', 'zip', 42);
    const files = await buildMapBundle(map);
    const zip = zipStore(files);

    expect(zipRead(zip)?.map((file) => file.path)).toEqual(files.map((file) => file.path));

    const corrupted = zip.slice();
    corrupted[corrupted.length > 50 ? 40 : 0] ^= 0xff;
    expect(zipRead(corrupted)).toBeNull();
  });

  it('detects a bundle that omits referenced dependency entries', () => {
    const map = newCustomMap('Incomplete', 'incomplete', 42);
    map.placements.push({
      assetId: 'local/model-a',
      x: 0,
      z: 0,
      rotY: 0,
      scale: 1,
      collide: false,
    });

    expect(missingBundleEntries(map, [{ path: 'map.json' }])).toBe(1);
    expect(missingBundleEntries(map, [{ path: 'map.json' }, { path: 'models/model-a.glb' }])).toBe(
      0,
    );
  });

  it('refuses to emit a bundle with a missing referenced model', async () => {
    const map = newCustomMap('Missing model', 'missing-model', 42);
    map.placements.push({
      assetId: 'local/not-in-storage',
      x: 0,
      z: 0,
      rotY: 0,
      scale: 1,
      collide: false,
    });

    await expect(buildMapBundle(map)).rejects.toEqual(expect.any(BundleDependencyError));
  });
});
