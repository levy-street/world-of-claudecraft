// The per-frame zone-feature sweep (src/render/zone_feature_sweep.ts) over
// plain entry objects: the fog rule, the apparent-size reach with its
// hysteresis, and the shadow flip on state changes only.
import { readFileSync } from 'node:fs';
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
    expect(ZONE_FEATURE_REACH_HYSTERESIS).toBe(0.1);
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
    expect(plain.inReach).toBe(false); // hidden until the first sweep says otherwise
    expect(plain.shadowCasting).toBe(true);
    expect(plain.shadowCasters).toBeNull();
    const sized = entryFor(group('sized', 5), 0);
    expect(sized.reach).toBeCloseTo(zoneFeatureReach(5), 6);
    // a non-number extent is no extent
    const odd = group('odd');
    odd.userData[ZONE_FEATURE_EXTENT_KEY] = '5';
    expect(entryFor(odd, 0).reach).toBe(Number.POSITIVE_INFINITY);
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
    // Two entries with opposite histories in one sweep list, the camera the
    // only thing that moves between frames: the shown one rides the band,
    // the hidden one does not come back inside it.
    const reach = zoneFeatureReach(5);
    const band = reach * ZONE_FEATURE_REACH_HYSTERESIS;
    const shown = group('shown', 5);
    const hidden = group('hidden', 5);
    // both footprints sit so that from camera x = 0 the edge is reach - 1
    // (inside) and from x = -(band / 2 + 2) it is inside the band
    const entries = [entryFor(shown, reach - 1 + 10), entryFor(hidden, reach - 1 + 10)];
    // frame 1 at x = -(band + 2): both edges past the band, both hidden
    sweepZoneFeatures(entries, -(band + 2), 0, 850, 105);
    expect(shown.visible).toBe(false);
    expect(hidden.visible).toBe(false);
    // frame 2 at x = 0: both inside the reach, both shown
    sweepZoneFeatures(entries, 0, 0, 850, 105);
    expect(shown.visible).toBe(true);
    expect(hidden.visible).toBe(true);
    // frame 3, into the band: both stay shown (state carried, not hand-set)
    sweepZoneFeatures(entries, -(band / 2 + 2), 0, 850, 105);
    expect(shown.visible).toBe(true);
    expect(entries[0].inReach).toBe(true);
    // frame 4, hide the second one past the band, then back into the band:
    // it stays hidden while the first, left inside, stays shown
    sweepZoneFeatures([entries[1]], -(band + 2), 0, 850, 105);
    expect(hidden.visible).toBe(false);
    sweepZoneFeatures(entries, -(band / 2 + 2), 0, 850, 105);
    expect(shown.visible).toBe(true);
    expect(hidden.visible).toBe(false);
  });

  it('flips castShadow on the state change only and restores the original casters', () => {
    const g = group('walls');
    const entry = entryFor(g, ZONE_FEATURE_SHADOW_RANGE + 10 + 100);
    sweepZoneFeatures([entry], 0, 0, 850, 105);
    expect(entry.shadowCasting).toBe(false);
    expect(g.meshes.map((m) => m.castShadow)).toEqual([false, false]);
    expect(entry.shadowCasters).toHaveLength(1); // only the mesh that cast
    // steady state: no per-frame write over the captured casters (a hand
    // flip on the caster survives the next far frame)
    g.meshes[0].castShadow = true;
    sweepZoneFeatures([entry], 0, 0, 850, 105);
    expect(g.meshes[0].castShadow).toBe(true);
    g.meshes[0].castShadow = false;
    // back inside the range: the original caster is restored, the mesh that
    // never cast is left alone (a restore over every mesh would turn it on)
    sweepZoneFeatures([entry], entry.footprint?.centerX ?? 0, 0, 850, 105);
    expect(entry.shadowCasting).toBe(true);
    expect(g.meshes.map((m) => m.castShadow)).toEqual([true, false]);
  });
});

describe('zone feature sweep module contract', () => {
  const source = readFileSync(
    new URL('../src/render/zone_feature_sweep.ts', import.meta.url),
    'utf8',
  );

  it('imports three as types only: a thin consumer, never a scene owner', () => {
    const threeImports = source.match(/^import[^;]*from 'three';/gm) ?? [];
    expect(threeImports.length).toBeGreaterThan(0);
    for (const line of threeImports) expect(line.startsWith('import type')).toBe(true);
  });

  it('flips castShadow on a state change only, never as a steady per-frame traversal', () => {
    expect(source).toContain('isZoneFeatureShadowCasting(');
    expect(source).toContain('if (casting !== entry.shadowCasting)');
  });
});
