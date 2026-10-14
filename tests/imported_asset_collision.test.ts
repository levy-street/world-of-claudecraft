// Imported-model collision bakes must survive the playtest projection for
// SERVER-UPLOADED assets too: the doc keys bakes by 'user/<sha>' id, but the
// play projection resolves those placements to '/api/assets/<sha>.glb', so
// the world's bake map needs the path alias or the sim falls back to a plain
// circle (which visibly ignores the placement's rotation).

import { describe, expect, it } from 'vitest';
import { customMapToWorldContent, newCustomMap } from '../src/editor/custom_map';
import { userAssetPath } from '../src/editor/user_assets';
import { bakedBoxesForPath } from '../src/sim/asset_collision';

const SHA = 'a'.repeat(64);
const USER_ID = `user/${SHA}`;
const BOX = { x: 0, y: 0.5, z: 0, hx: 1.2, hy: 0.5, hz: 0.4 };

function mapWithUpload() {
  const map = newCustomMap('Upload Test', 'map_test_upload', 1);
  map.placements.push({
    assetId: USER_ID,
    x: 10,
    z: 10,
    rotY: Math.PI / 2,
    scale: 1,
    collide: true,
    collisionMode: 'baked',
  });
  map.assetCollision = { [USER_ID]: [{ ...BOX }] };
  return map;
}

describe('imported-asset collision in the play projection', () => {
  it('aliases user/<sha> bakes to their /api/assets path', () => {
    const world = customMapToWorldContent(mapWithUpload());
    const path = userAssetPath(USER_ID);
    expect(path).toBe(`/api/assets/${SHA}.glb`);
    const placed = world.placements?.find((p) => p.path === path);
    expect(placed).toBeTruthy();
    const boxes = bakedBoxesForPath(placed?.path, world.assetCollision);
    expect(boxes).toBeTruthy();
    expect(boxes?.[0]?.hx).toBeCloseTo(BOX.hx, 6);
  });

  it('keeps the id keys too (local imports resolve by id)', () => {
    const world = customMapToWorldContent(mapWithUpload());
    expect(world.assetCollision?.[USER_ID]?.[0]?.hx).toBeCloseTo(BOX.hx, 6);
  });
});
