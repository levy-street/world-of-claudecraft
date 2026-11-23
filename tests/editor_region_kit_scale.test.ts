// The dungeon kit's two scale conventions (sim/dungeon_kit_dims.ts).
//
// A region map converts kit MODULES into catalogue PLACEMENTS on the way into
// the editor and back on the way out. Modules render at the GLB's own size;
// placements render normalized to 2.2yd. Copying the number across instead of
// converting it drew a natively-4yd floor tile at 2.2yd on a 4yd grid, a field
// of gapped tiles and undersized walls. These pin the conversion.

import { describe, expect, it } from 'vitest';
import { targetHeightFor } from '../src/render/asset_scale';
import {
  dungeonKitMaxDim,
  dungeonKitModuleScale,
  dungeonKitPlacementScale,
  PLACED_TARGET_SIZE,
} from '../src/sim/dungeon_kit_dims';
import { DUNGEON_KIT_MAX_DIM } from '../src/sim/dungeon_kit_dims.generated';
import type { AuthoredRegion } from '../src/sim/regions/authored_region';
import { authoredRegionModules } from '../src/sim/regions/authored_region';

describe('dungeon kit: native dimensions', () => {
  it('agrees with the renderer about what a placed asset normalizes to', () => {
    // The sim layer restates TARGET_HEIGHT rather than importing the renderer.
    // If that ever drifts, or a dungeon/ path picks up a special case in
    // targetHeightFor, every region map silently resizes.
    for (const kind of ['wall', 'floor_tile_large', 'pillar', 'torch_mounted']) {
      expect(targetHeightFor(`/models/dungeon/${kind}.glb`)).toBe(PLACED_TARGET_SIZE);
    }
  });

  it('measured the kit, including the modules the battleground is built from', () => {
    expect(Object.keys(DUNGEON_KIT_MAX_DIM).length).toBeGreaterThan(300);
    // The native floor module spans 4yd, which differs from the editor's
    // normalized placement size and requires the conversion.
    expect(dungeonKitMaxDim('floor_tile_large')).toBeCloseTo(4, 3);
    expect(dungeonKitMaxDim('wall')).toBeCloseTo(4, 3);
  });

  it('round-trips module -> placement -> module', () => {
    for (const kind of ['wall', 'floor_tile_large', 'rubble_large', 'torch_mounted']) {
      for (const s of [0.5, 1, 2.75]) {
        expect(dungeonKitModuleScale(kind, dungeonKitPlacementScale(kind, s))).toBeCloseTo(s, 9);
      }
    }
  });

  it('leaves an unknown module alone rather than silently resizing it', () => {
    expect(dungeonKitPlacementScale('not_a_real_module', 3)).toBe(3);
    expect(dungeonKitModuleScale('not_a_real_module', 3)).toBe(3);
  });
});

describe('region kit placement conversion', () => {
  it('hands the same world size back to the region builders', () => {
    const region: AuthoredRegion = {
      layout: { bases: [], graveyards: [], speedRunes: [], powerRunes: [] },
      placements: [
        {
          assetId: 'dungeon/floor_tile_large',
          x: 4,
          z: 8,
          rotY: 0,
          scale: 1,
          scaleX: 4 / PLACED_TARGET_SIZE,
          scaleY: 4 / PLACED_TARGET_SIZE,
          scaleZ: 4 / PLACED_TARGET_SIZE,
          collide: false,
        },
      ],
    };
    const [built] = authoredRegionModules(region);
    expect(built.kind).toBe('floor_tile_large');
    expect(built.scale[0]).toBeCloseTo(1, 6);
    expect(built.scale[1]).toBeCloseTo(1, 6);
    expect(built.scale[2]).toBeCloseTo(1, 6);
  });
});
