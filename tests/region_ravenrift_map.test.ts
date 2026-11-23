// The retired Ravenrift entry is replaced by ordinary authored-map editing.
// Keep its useful document/anchor roundtrip guarantees on the shipped path.
import { describe, expect, it } from 'vitest';
import { parseMap, serializeMap } from '../src/editor/persist';
import { createShippedMap, SHIPPED_MAPS } from '../src/editor/shipped_maps';
import { TH_FLAG_Z, TH_HALF_X, TH_HALF_Z } from '../src/editor/shipped_thornhollow';

const map = await createShippedMap('thornhollow', 'test-thornhollow', 1);

describe('authored battleground map document', () => {
  it('opens through the current shipped-map entry without a legacy export tag', () => {
    expect(SHIPPED_MAPS.some((entry) => String(entry.id) === 'ravenrift')).toBe(false);
    expect(map.regionSource).toBeUndefined();
    expect(map.placements.find((p) => p.regionRole === 'flag0')).toMatchObject({
      x: 0,
      z: -TH_FLAG_Z,
    });
    expect(map.placements.find((p) => p.regionRole === 'flag1')).toMatchObject({
      x: 0,
      z: TH_FLAG_Z,
    });
    for (const p of map.placements) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(TH_HALF_X);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(TH_HALF_Z);
    }
  });

  it('saves and reloads every anchor position and role', () => {
    const reloaded = parseMap(serializeMap(map));
    expect(reloaded).not.toBeNull();
    const anchors = (items: typeof map.placements) =>
      items
        .filter((p) => p.regionRole !== undefined)
        .map((p) => ({ role: p.regionRole, x: p.x, z: p.z }));
    expect(anchors(map.placements).length).toBeGreaterThan(20);
    expect(anchors(reloaded?.placements ?? [])).toEqual(anchors(map.placements));
  });
});
