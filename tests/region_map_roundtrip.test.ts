import { describe, expect, it } from 'vitest';
import { type CustomMap, newFlatCustomMap } from '../src/editor/custom_map';
import {
  emitRegionModule,
  regionExportFromMap,
  regionModulePath,
} from '../src/editor/regions/region_export_core';
import type { MapPlacement, RegionRole } from '../src/sim/map_doc';
import { authoredRegionColliders, authoredRegionModules } from '../src/sim/regions/authored_region';

// Ravenrift is no longer a shipped map. Existing saved region documents can
// still be exported, so pin that independent format with an explicit fixture.
const base = newFlatCustomMap('Archived region', 'roundtrip', 1, { width: 100, height: 280 });
base.regionSource = 'ravenrift';
const placement = (x: number, z: number, regionRole?: RegionRole): MapPlacement => ({
  assetId: 'collider/box',
  x,
  z,
  rotY: 0,
  scale: 1,
  collide: false,
  regionRole,
});
base.placements = [
  { ...placement(0, 0), assetId: 'dungeon/floor_tile_large' },
  { ...placement(10, 0), assetId: 'dungeon/wall' },
  { ...placement(10, 0), collide: true, sizeX: 4, sizeY: 6, sizeZ: 2 },
  { ...placement(-10, 0), assetId: 'collider/sphere', collide: true, sizeX: 3 },
  ...([0, 1] as const).flatMap((team) => {
    const sign = team === 0 ? -1 : 1;
    return [
      placement(0, sign * 100, `flag${team}`),
      placement(3 * sign, sign * 105, `banner${team}`),
      placement(0, sign * 110, `spawn${team}`),
      placement(sign, sign * 110, `spawn${team}`),
      { ...placement(25 * sign, sign * 80, `graveyard${team}`), sizeX: 18, sizeZ: 12 },
    ];
  }),
  placement(12, -30, 'speedRune'),
  placement(-12, 30, 'speedRune'),
  placement(0, 40, 'powerRune'),
];
const expectedLayout = {
  bases: [
    {
      team: 0,
      flag: { x: 0, z: -100 },
      banner: { x: -3, z: -105 },
      spawns: [
        { x: 0, z: -110 },
        { x: -1, z: -110 },
      ],
    },
    {
      team: 1,
      flag: { x: 0, z: 100 },
      banner: { x: 3, z: 105 },
      spawns: [
        { x: 0, z: 110 },
        { x: 1, z: 110 },
      ],
    },
  ],
  graveyards: [
    { x: -25, z: -80, hw: 9, hd: 6 },
    { x: 25, z: 80, hw: 9, hd: 6 },
  ],
  speedRunes: [
    { x: 12, z: -30 },
    { x: -12, z: 30 },
  ],
  powerRunes: [{ x: 0, z: 40 }],
};
const clone = (): CustomMap => structuredClone(base);

describe('region export', () => {
  it('round-trips the game-mode anchors untouched', () => {
    const result = regionExportFromMap(base);
    const shipped = expectedLayout;
    expect(result.regionId).toBe('ravenrift');
    expect(result.layout.bases).toEqual(shipped.bases);
    expect(result.layout.speedRunes).toEqual(shipped.speedRunes);
    expect(result.layout.powerRunes).toEqual(shipped.powerRunes);
    expect(result.layout.graveyards).toEqual(shipped.graveyards);
  });

  it('moves cover out of the record and into placements', () => {
    const result = regionExportFromMap(base);
    // Cover is drawn and blocks as ordinary placements now, so the record
    // carries none of it - one object to move, not two.
    expect(Object.keys(result.layout).sort()).toEqual([
      'bases',
      'graveyards',
      'powerRunes',
      'speedRunes',
    ]);
    expect(result.placements).toEqual(base.placements.slice(0, 4));
    expect(result.placements.every((p) => p.regionRole === undefined)).toBe(true);
  });

  it('the exported region still renders and still blocks', () => {
    const result = regionExportFromMap(base);
    const region = { layout: result.layout, placements: result.placements };
    // Every kit module comes back as something the field builder can instance.
    const modules = authoredRegionModules(region);
    expect(modules.map((m) => m.kind)).toEqual(['floor_tile_large', 'wall']);
    expect(modules.every((m) => m.kind.length > 0)).toBe(true);
    // ...and the collision volumes come back as real colliders.
    const colliders = authoredRegionColliders(region);
    expect(colliders).toEqual([
      { type: 'obb', x: 10, z: 0, hw: 2, hd: 1, rot: 0, cameraTopY: 6, baseY: 0 },
      { type: 'circle', x: -10, z: 0, r: 1.5, cameraTopY: 3, baseY: 0 },
    ]);
  });

  it('follows an edit: moving the flag moves the record', () => {
    const edited = clone();
    const flag = edited.placements.find((p) => p.regionRole === 'flag0');
    expect(flag).toBeDefined();
    if (flag) {
      flag.x = 12.5;
      flag.z = -100.25;
    }
    const result = regionExportFromMap(edited);
    const crimson = result.layout.bases.find((b) => b.team === 0);
    expect(crimson?.flag).toEqual({ x: 12.5, z: -100.25 });
    // ...and nothing else moved with it.
    const azure = result.layout.bases.find((b) => b.team === 1);
    expect(azure).toEqual(expectedLayout.bases[1]);
  });

  it('refuses an export the region could not actually build', () => {
    const edited = clone();
    edited.placements.push({
      assetId: 'foliage/oak_1',
      x: 0,
      z: 0,
      rotY: 0,
      scale: 1,
      collide: true,
    });
    expect(() => regionExportFromMap(edited)).toThrow(/cannot build/);
  });

  it('refuses a map that lost an anchor', () => {
    const edited = clone();
    edited.placements = edited.placements.filter((p) => p.regionRole !== 'flag1');
    expect(() => regionExportFromMap(edited)).toThrow(/exactly one flag/);
  });

  it('refuses a placement dragged out of the region', () => {
    const edited = clone();
    edited.placements[0] = { ...edited.placements[0], x: 5000 };
    expect(() => regionExportFromMap(edited)).toThrow(/outside the region/);
  });

  it('emits a stable, self-describing module', () => {
    const source = emitRegionModule(regionExportFromMap(base));
    expect(source.startsWith('// GENERATED from the map editor')).toBe(true);
    expect(source).toContain("import type { AuthoredRegion } from './authored_region';");
    expect(source).toContain('export const RAVENRIFT_AUTHORED: AuthoredRegion | null = REGION;');
    // Chunked: one array expression per block, because the checker cannot hold
    // a whole field of object literals in a single one.
    expect(source).toContain('const PLACEMENTS_0: MapPlacement[] = [');
    expect(source.trimEnd().endsWith('= REGION;')).toBe(true);
    // Deterministic: the same map must never produce a churny diff.
    expect(emitRegionModule(regionExportFromMap(base))).toBe(source);
    expect(regionModulePath('ravenrift')).toBe('src/sim/regions/ravenrift.authored.generated.ts');
  });
});
