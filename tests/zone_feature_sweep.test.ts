// The per-frame zone-feature sweep (src/render/zone_feature_sweep.ts) over
// plain entry objects: the fog rule, the apparent-size reach with its
// hysteresis, and the shadow flip on state changes only.
import { describe, expect, it } from 'vitest';
import {
  sweepZoneFeatures,
  ZONE_FEATURE_EXTENT_KEY,
  type ZoneFeatureEntry,
  zoneFeatureEntryFor,
} from '../src/render/zone_feature_sweep';
import {
  isZoneFeatureInReach,
  ZONE_FEATURE_MIN_APPARENT_PX,
  ZONE_FEATURE_REACH_HYSTERESIS,
  ZONE_FEATURE_REF_PX_PER_RAD,
  ZONE_FEATURE_SHADOW_RANGE,
  zoneFeatureReach,
} from '../src/render/zone_feature_visibility_core';

interface FakeMesh {
  isMesh: true;
  castShadow: boolean;
}
interface FakeGroup {
  name: string;
  visible: boolean;
  userData: Record<string, unknown>;
  meshes: FakeMesh[];
  traverse(cb: (o: unknown) => void): void;
}
function group(name: string, extent?: number): FakeGroup {
  const meshes: FakeMesh[] = [
    { isMesh: true, castShadow: true },
    { isMesh: true, castShadow: false },
  ];
  return {
    name,
    visible: true,
    userData: extent === undefined ? {} : { [ZONE_FEATURE_EXTENT_KEY]: extent },
    meshes,
    traverse(cb) {
      for (const m of meshes) cb(m);
    },
  };
}
// a 20 x 20 yd footprint centred at (cx, 0)
const footprintAt = (cx: number) => ({ centerX: cx, centerZ: 0, halfX: 10, halfZ: 10 });
const entryFor = (g: FakeGroup, cx: number): ZoneFeatureEntry =>
  zoneFeatureEntryFor(g as unknown as ZoneFeatureEntry['group'], footprintAt(cx));

describe('apparent-size reach', () => {
  it('is the distance at which the largest instance spans the pixel threshold', () => {
    // 720 px tall, 60 degree base FOV: 360 / tan(30 deg) px per radian
    expect(ZONE_FEATURE_REF_PX_PER_RAD).toBeCloseTo(360 / Math.tan(Math.PI / 6), 6);
    expect(ZONE_FEATURE_MIN_APPARENT_PX).toBe(8);
    // a 5 yd lily raft: about 390 yd; a 3 yd clump: about 234; a 12 yd
    // willow: about 935, past every cull horizon; a 30 yd giant: 2,338
    expect(zoneFeatureReach(5)).toBeCloseTo((5 * ZONE_FEATURE_REF_PX_PER_RAD) / 8, 6);
    expect(zoneFeatureReach(5)).toBeGreaterThan(380);
    expect(zoneFeatureReach(5)).toBeLessThan(400);
    expect(zoneFeatureReach(3)).toBeLessThan(240);
    expect(zoneFeatureReach(12)).toBeGreaterThan(850);
    expect(zoneFeatureReach(30)).toBeGreaterThan(2000);
    // the threshold is the divisor
    expect(zoneFeatureReach(5, 4)).toBeCloseTo(zoneFeatureReach(5) * 2, 6);
  });

  it('fails open on a missing, zero or non-finite extent', () => {
    for (const extent of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(zoneFeatureReach(extent)).toBe(Number.POSITIVE_INFINITY);
    }
    expect(isZoneFeatureInReach(footprintAt(5000), 0, 0, Number.POSITIVE_INFINITY, false)).toBe(
      true,
    );
    expect(isZoneFeatureInReach(null, 0, 0, 10, false)).toBe(true);
  });

  it('holds a shown group through the hysteresis band and drops it past it', () => {
    const reach = 300;
    const band = reach * ZONE_FEATURE_REACH_HYSTERESIS;
    // edge distance is the footprint's near edge (centre minus 10)
    expect(isZoneFeatureInReach(footprintAt(reach + 10 - 1), 0, 0, reach, false)).toBe(true);
    expect(isZoneFeatureInReach(footprintAt(reach + 10 + 1), 0, 0, reach, false)).toBe(false);
    expect(isZoneFeatureInReach(footprintAt(reach + 10 + band - 1), 0, 0, reach, true)).toBe(true);
    expect(isZoneFeatureInReach(footprintAt(reach + 10 + band + 1), 0, 0, reach, true)).toBe(false);
    // a hidden group does not come back inside the band
    expect(isZoneFeatureInReach(footprintAt(reach + 10 + band - 1), 0, 0, reach, false)).toBe(
      false,
    );
  });
});

describe('zone feature sweep', () => {
  it('builds an entry from the group, infinite reach without an extent', () => {
    const plain = entryFor(group('plain'), 0);
    expect(plain.reach).toBe(Number.POSITIVE_INFINITY);
    expect(plain.inReach).toBe(true);
    expect(plain.shadowCasting).toBe(true);
    expect(plain.shadowCasters).toBeNull();
    const sized = entryFor(group('sized', 5), 0);
    expect(sized.reach).toBeCloseTo(zoneFeatureReach(5), 6);
  });

  it('shows a group inside the fog and its reach, hides it past either', () => {
    const near = group('near', 5); // reach about 390
    const farSmall = group('far-small', 5);
    const farBig = group('far-big', 30); // reach past the horizon
    const noExtent = group('no-extent');
    const entries = [
      entryFor(near, 100),
      entryFor(farSmall, 600),
      entryFor(farBig, 600),
      entryFor(noExtent, 600),
    ];
    // vista arm: cull at 850, fog parked beyond
    sweepZoneFeatures(entries, 0, 0, 850, 105);
    expect(near.visible).toBe(true);
    expect(farSmall.visible).toBe(false); // 590 yd edge, below 8 px
    expect(farBig.visible).toBe(true); // 30 yd tall: still tall on screen
    expect(noExtent.visible).toBe(true); // distance rule only, inside 850
    // classic arm: the fog at 340 owns everything past it, reach or not
    sweepZoneFeatures(entries, 0, 0, 340, 105);
    expect(near.visible).toBe(true);
    expect(farBig.visible).toBe(false);
    expect(noExtent.visible).toBe(false);
  });

  it('keeps the reach state per entry across frames (hysteresis)', () => {
    const g = group('raft', 5);
    const reach = zoneFeatureReach(5);
    const entry = entryFor(g, reach + 10 + reach * ZONE_FEATURE_REACH_HYSTERESIS * 0.5);
    // first frame: never shown before at this distance, so hidden
    entry.inReach = false;
    sweepZoneFeatures([entry], 0, 0, 850, 105);
    expect(g.visible).toBe(false);
    // shown, then the camera moves the same distance into the band: kept
    entry.inReach = true;
    sweepZoneFeatures([entry], 0, 0, 850, 105);
    expect(g.visible).toBe(true);
  });

  it('flips castShadow on the state change only and restores the original casters', () => {
    const g = group('walls');
    const entry = entryFor(g, ZONE_FEATURE_SHADOW_RANGE + 10 + 100);
    sweepZoneFeatures([entry], 0, 0, 850, 105);
    expect(entry.shadowCasting).toBe(false);
    expect(g.meshes.map((m) => m.castShadow)).toEqual([false, false]);
    expect(entry.shadowCasters).toHaveLength(1); // only the mesh that cast
    // steady state: no write (the non-caster stays off even if flipped by hand)
    g.meshes[1].castShadow = true;
    sweepZoneFeatures([entry], 0, 0, 850, 105);
    expect(g.meshes[1].castShadow).toBe(true);
    // back inside the range: the original caster is restored, the other left
    sweepZoneFeatures([entry], entry.footprint?.centerX ?? 0, 0, 850, 105);
    expect(entry.shadowCasting).toBe(true);
    expect(g.meshes[0].castShadow).toBe(true);
  });
});
