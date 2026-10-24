import { describe, expect, it } from 'vitest';
import {
  nearestZoneIds,
  STREAM_ZONE_COUNT,
  zoneSetForCamera,
} from '../src/editor/camera_zone_core';
import { zonesUnionRect } from '../src/editor/zone_isolate_core';

// A north-running strip of 120yd bands, the shape the overworld actually has.
const ZONES = Array.from({ length: 8 }, (_, i) => ({
  id: `z${i}`,
  zMin: i * 120,
  zMax: (i + 1) * 120,
}));

describe('camera zone stream: the resident SET', () => {
  it('keeps four zones, nearest first', () => {
    expect(STREAM_ZONE_COUNT).toBe(4);
    expect(nearestZoneIds(ZONES, 0, 60)).toEqual(['z0', 'z1', 'z2', 'z3']);
    expect(nearestZoneIds(ZONES, 0, 500)).toEqual(['z4', 'z3', 'z5', 'z2']);
  });

  it('never returns more than the map has', () => {
    expect(nearestZoneIds(ZONES.slice(0, 2), 0, 60)).toEqual(['z0', 'z1']);
  });

  it('holds the set while the camera is still inside one of its zones', () => {
    const current = ['z4', 'z3', 'z5', 'z2'];
    // deep inside z3, which is in the set: no swap, however the ranking moves
    expect(zoneSetForCamera(ZONES, 0, 400, current, false)).toEqual(current);
  });

  it('swaps the whole set once the camera leaves every zone in it', () => {
    const current = ['z0', 'z1', 'z2', 'z3'];
    // z=700 sits inside z5 (600-720), so the fresh set is z5 and its neighbours.
    const next = zoneSetForCamera(ZONES, 0, 700, current, false);
    expect(next).toEqual(['z5', 'z6', 'z4', 'z7']);
    expect(next.filter((id) => current.includes(id))).toHaveLength(0); // wholesale, not a slide
  });

  it('the padlock pins the set whatever the camera does', () => {
    const current = ['z0', 'z1', 'z2', 'z3'];
    expect(zoneSetForCamera(ZONES, 0, 900, current, true)).toEqual(current);
  });

  it('drops ids the map no longer has, then re-picks', () => {
    const next = zoneSetForCamera(ZONES, 0, 60, ['gone', 'also-gone'], false);
    expect(next).toEqual(['z0', 'z1', 'z2', 'z3']);
  });

  it('unions the set into one residency rect', () => {
    const rect = zonesUnionRect(ZONES, ['z1', 'z2', 'z3', 'z4']);
    expect(rect?.minZ).toBe(120);
    expect(rect?.maxZ).toBe(600);
    expect(zonesUnionRect(ZONES, [])).toBeNull();
    expect(zonesUnionRect(ZONES, ['nope'])).toBeNull();
  });
});
