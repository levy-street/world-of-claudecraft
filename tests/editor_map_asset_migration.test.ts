import { describe, expect, it } from 'vitest';
import { repairPlacedAssetShapes, WOC_MUSHROOM_ASSET_ID } from '../src/editor/map_asset_migration';
import type { MapPlacement } from '../src/sim/map_doc';

function placement(assetId: string): MapPlacement {
  return {
    assetId,
    x: 1,
    z: 2,
    rotY: 0,
    scale: 3,
    scaleX: 2,
    scaleY: 0.5,
    scaleZ: 4,
    collide: false,
  };
}

describe('placed asset shape migration', () => {
  it('replaces placed legacy mushrooms and preserves all of their scale', () => {
    const mushroom = placement('foliage/mushroom');
    mushroom.x = -370;
    mushroom.z = 1420;
    const map = { placements: [mushroom] };
    expect(repairPlacedAssetShapes(map)).toBe(true);
    expect(mushroom.assetId).toBe(WOC_MUSHROOM_ASSET_ID);
    expect(mushroom.scale).toBe(3);
    expect(mushroom.collide).toBe(true);
    expect(mushroom.collisionMode).toBe('basic');
    // Per-axis scale is authored shape, not a defect: it must survive migration.
    expect([mushroom.scaleX, mushroom.scaleY, mushroom.scaleZ]).toEqual([2, 0.5, 4]);
  });

  it('removes placed mushrooms outside their three signature zones', () => {
    const valeMushroom = placement(WOC_MUSHROOM_ASSET_ID);
    const nightbloomMushroom = placement(WOC_MUSHROOM_ASSET_ID);
    nightbloomMushroom.x = -370;
    nightbloomMushroom.z = 1420;
    const hollowMushroom = placement(WOC_MUSHROOM_ASSET_ID);
    hollowMushroom.x = -40;
    hollowMushroom.z = 1030;
    const wraithwoodMushroom = placement(WOC_MUSHROOM_ASSET_ID);
    wraithwoodMushroom.x = 360;
    wraithwoodMushroom.z = 1430;
    const map = {
      placements: [valeMushroom, nightbloomMushroom, hollowMushroom, wraithwoodMushroom],
    };

    expect(repairPlacedAssetShapes(map)).toBe(true);
    expect(map.placements).toEqual([nightbloomMushroom, hollowMushroom, wraithwoodMushroom]);
    expect(map.placements.every((mushroom) => mushroom.collide)).toBe(true);
    expect(map.placements.every((mushroom) => mushroom.collisionMode === 'basic')).toBe(true);
  });

  it('preserves per-axis scale on catalogue models and editor primitives', () => {
    // A bridge the maker stretched on one axis with the Scale gizmo (the exact
    // shape this migration used to flatten back to natural aspect on every load).
    const bridge = placement('medieval_village_v2/environment/Bridge_01');
    bridge.scaleX = 2.6;
    bridge.scaleY = 1;
    bridge.scaleZ = 1;
    const prop = placement('props/well');
    const rock = placement('rock/generated');
    const map = { placements: [bridge, prop, rock] };
    // No legacy mushrooms and no shape flattening: nothing to repair.
    expect(repairPlacedAssetShapes(map)).toBe(false);
    expect([bridge.scaleX, bridge.scaleY, bridge.scaleZ]).toEqual([2.6, 1, 1]);
    expect([prop.scaleX, prop.scaleY, prop.scaleZ]).toEqual([2, 0.5, 4]);
    expect([rock.scaleX, rock.scaleY, rock.scaleZ]).toEqual([2, 0.5, 4]);
  });

  it('is idempotent', () => {
    const mushroom = placement('foliage/mushroom');
    mushroom.x = -370;
    mushroom.z = 1420;
    const map = { placements: [mushroom] };
    expect(repairPlacedAssetShapes(map)).toBe(true);
    expect(repairPlacedAssetShapes(map)).toBe(false);
  });
});
