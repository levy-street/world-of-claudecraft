// Square terrain brushes (src/sim/brush_shape.ts, src/sim/terrain_edit_layer.ts):
// a square stamp reaches max(|dx|, |dz|) < radius with the same falloff along
// sides and diagonals, a round or unshaped stamp keeps its exact legacy height,
// the shape survives the shared map sanitizer, and the spatial index finds
// square corners. Ported from the Studio repository's height-stamp tests.
import { afterEach, describe, expect, it } from 'vitest';
import {
  eraseStampIndex,
  flattenStamp,
  noiseStamp,
  sharpenStamp,
  smoothStamp,
  terraceStamp,
} from '../src/editor/stamp_core';
import { brushContains, brushDistanceSquared } from '../src/sim/brush_shape';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { sanitizeMapDoc } from '../src/sim/map_doc';
import { terrainBrushAlpha } from '../src/sim/terrain_brush';
import { applyHeightStamp } from '../src/sim/terrain_edit_layer';
import { noiseStampWeight } from '../src/sim/terrain_noise_brush';
import type { HeightStamp } from '../src/sim/types';
import { inAuthoredHeightStamp, invalidateTerrainEditIndex, terrainHeight } from '../src/sim/world';

const stamp: HeightStamp = { x: 0, z: 0, radius: 10, delta: 8, falloff: 'smooth' };
afterEach(() => {
  setActiveWorldContent(null);
  invalidateTerrainEditIndex();
});

describe('height brush shape and compatibility', () => {
  it('keeps radius as half the square width and includes corners without expanding the side', () => {
    expect(brushContains(9, 9, 10, 'square')).toBe(true);
    expect(brushContains(9, 9, 10)).toBe(false);
    expect(brushContains(10, 0, 10, 'square')).toBe(false);
    expect(brushDistanceSquared(-9, 3, 'square')).toBe(81);
  });

  it('evaluates a circle stamp exactly like a stamp with no shape', () => {
    const shaped = { ...stamp, shape: 'circle' as const, hardness: 0.4, alpha: 'noise' as const };
    const { shape: _drop, ...legacy } = shaped;
    for (const [x, z] of [
      [3, 4],
      [7, 7],
      [0, 9.5],
    ]) {
      expect(applyHeightStamp(shaped, x, z, 12)).toBe(applyHeightStamp(legacy, x, z, 12));
    }
    const noise = { ...stamp, noiseSize: 4, noiseSeed: 12 };
    expect(applyHeightStamp(noise, 3, 4, 12)).toBe(12 + 8 * noiseStampWeight(noise, 3, 4, 0.5));
  });

  it('keeps the pinned legacy round-brush heights', () => {
    // d = 5 of radius 10: the soft taper weighs 1 - smoothstep(0.5) = 0.5.
    expect(applyHeightStamp(stamp, 3, 4, 12)).toBe(16);
    expect(applyHeightStamp({ ...stamp, shape: 'circle' }, 3, 4, 12)).toBe(16);
    // (7, 7) is d = 9.899: inside the round brush, a sliver of the delta.
    expect(applyHeightStamp(stamp, 7, 7, 0)).toBeCloseTo(0.002408, 6);
    expect(applyHeightStamp(stamp, 7.1, 7.1, 0)).toBe(0);
  });

  it('uses the same falloff along square sides and diagonals, and honors hardness/masks', () => {
    const square = { ...stamp, shape: 'square' as const };
    expect(applyHeightStamp(square, 5, 5, 0)).toBe(4);
    expect(applyHeightStamp(square, 5, 0, 0)).toBe(4);
    expect(applyHeightStamp({ ...square, hardness: 1 }, 9, 9, 0)).toBe(8);
    expect(applyHeightStamp({ ...square, hardness: 1, alpha: 'noise' }, 5, 5, 0)).toBe(
      8 * terrainBrushAlpha('noise', 0.5, 0.5),
    );
  });

  it('supports square footprints for raise, lower, grab, smooth, flatten, sharpen, terrace and noise stamps', () => {
    const sample = (x: number, z: number) => 3 + x * x * 0.1 + z * z * 0.1;
    const stamps = [
      stamp,
      { ...stamp, delta: -8 },
      { ...stamp, x: 1, delta: 2 },
      smoothStamp(0, 0, 10, 1, sample),
      flattenStamp(0, 0, 10, 12, true),
      sharpenStamp(0, 0, 10, 1, sample),
      terraceStamp(0, 0, 10, 2, sample),
      noiseStamp(0, 0, 10, 2, 4, 0.4, 7),
    ];
    for (const value of stamps) {
      const square = { ...value, shape: 'square' as const, hardness: 1 };
      expect(applyHeightStamp(square, 8, 8, 20)).not.toBe(20);
      expect(applyHeightStamp({ ...square, shape: 'circle' }, 8, 8, 20)).toBe(20);
      expect(eraseStampIndex([square], 8, 8)).toBe(0);
    }
  });

  it('round-trips shape and rejects unknown shapes without changing legacy stamps', () => {
    const doc = sanitizeMapDoc({
      version: 2,
      meta: { id: 'm1', name: 'Map', seed: 7 },
      content: {
        zones: [
          {
            id: 'z1',
            name: 'Zone',
            biome: 'vale',
            zMin: -20,
            zMax: 20,
            hub: { x: 0, z: 0, radius: 5, name: 'Hub' },
          },
        ],
        camps: [],
        npcs: {},
        objects: [],
        roads: [],
      },
      terrainEdits: [
        { ...stamp, shape: 'square', hardness: 1 },
        { ...stamp, shape: 'circle' },
        { ...stamp, shape: 'triangle' },
        stamp,
      ],
      placements: [],
    });
    expect(doc?.terrainEdits.map((value) => value.shape)).toEqual([
      'square',
      'circle',
      undefined,
      undefined,
    ]);
    expect(applyHeightStamp(doc!.terrainEdits[0], 9, 9, 0)).toBe(8);
  });

  it('updates real terrain and authored-water exclusion at square corners, including the spatial-index path', () => {
    const point = { x: 48, z: 248 };
    setActiveWorldContent({ ...BUILTIN_WORLD, terrainEdits: [] });
    const before = terrainHeight(point.x, point.z, 123);
    const square = { ...stamp, x: 40, z: 240, shape: 'square' as const, hardness: 1 };
    // Enough stamps to cross the runtime index threshold, without overlapping this point.
    const edits = [
      square,
      ...Array.from({ length: 100 }, (_, i) => ({ ...stamp, x: 10000 + i * 50, z: 10000 })),
    ];
    setActiveWorldContent({ ...BUILTIN_WORLD, terrainEdits: edits });
    expect(inAuthoredHeightStamp(point.x, point.z)).toBe(true);
    expect(terrainHeight(point.x, point.z, 123) - before).toBeCloseTo(8, 8);
    edits.splice(0, 1);
    invalidateTerrainEditIndex();
    expect(inAuthoredHeightStamp(point.x, point.z)).toBe(false);
    expect(terrainHeight(point.x, point.z, 123)).toBe(before);
  });
});
