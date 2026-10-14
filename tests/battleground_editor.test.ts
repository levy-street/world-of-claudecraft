// The segment editor and const writer were retired with Ravenrift. Current
// battleground editing uses the same placement and document path as every map.
import { describe, expect, it } from 'vitest';
import { customMapToWorldContent } from '../src/editor/custom_map';
import { parseMap, serializeMap } from '../src/editor/persist';
import { createShippedMap } from '../src/editor/shipped_maps';

describe('authored battleground editing', () => {
  it('round-trips moved cover and flags without changing untouched placements', async () => {
    const map = await createShippedMap('thornhollow', 'editing', 1);
    const before = structuredClone(map.placements);
    const cover = map.placements.find((p) => p.regionRole === undefined && p.collide);
    const flag = map.placements.find((p) => p.regionRole === 'flag0');
    if (!cover || !flag) throw new Error('missing authored cover or flag');
    cover.x += 2;
    cover.z -= 3;
    flag.x = 12.5;
    flag.z = -150;
    const reloaded = parseMap(serializeMap(map));
    expect(reloaded).not.toBeNull();
    if (!reloaded) throw new Error('map did not reload');
    const coverIndex = map.placements.indexOf(cover);
    const flagIndex = map.placements.indexOf(flag);
    expect(reloaded.placements[coverIndex]).toMatchObject({
      assetId: cover.assetId,
      x: cover.x,
      z: cover.z,
      collide: true,
    });
    expect(customMapToWorldContent(reloaded).objectives?.bases[0].flag).toEqual({
      x: 12.5,
      z: -150,
    });
    for (let i = 0; i < before.length; i++) {
      if (i === coverIndex || i === flagIndex) continue;
      expect(reloaded.placements[i].assetId).toBe(before[i].assetId);
      expect(reloaded.placements[i].x).toBeCloseTo(before[i].x, 8);
      expect(reloaded.placements[i].z).toBeCloseTo(before[i].z, 8);
    }
  });

  it('saves added and removed collision volumes through the normal editor path', async () => {
    const map = await createShippedMap('thornhollow', 'collision-edit', 1);
    const wall = {
      assetId: 'collider/box',
      x: 20,
      z: -30,
      rotY: 0,
      scale: 1,
      collide: true,
      sizeX: 8,
      sizeY: 6,
      sizeZ: 2,
    };
    map.placements.push(wall);
    const reloaded = parseMap(serializeMap(map));
    if (!reloaded) throw new Error('map did not reload');
    expect(customMapToWorldContent(reloaded).colliderVolumes).toContainEqual(
      expect.objectContaining({ kind: 'box', x: 20, z: -30, sizeX: 8, sizeY: 6, sizeZ: 2 }),
    );
    reloaded.placements.pop();
    expect(
      customMapToWorldContent(reloaded).colliderVolumes?.some(
        (v) => v.kind === 'box' && v.x === 20 && v.z === -30,
      ),
    ).toBe(false);
  });
});
