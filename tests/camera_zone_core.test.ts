import { describe, expect, it } from 'vitest';
import { nearZone, ZONE_SWITCH_HYSTERESIS_YD, zoneForCamera } from '../src/editor/camera_zone_core';

// Two side-by-side bands plus one north of them, the shape a real map has.
const ZONES = [
  { id: 'west', xMin: -540, xMax: -180, zMin: -180, zMax: 180 },
  { id: 'vale', zMin: -180, zMax: 180 },
  { id: 'marsh', zMin: 180, zMax: 540 },
];

describe('camera zone streaming', () => {
  it('picks the zone under the camera when nothing is streamed yet', () => {
    expect(zoneForCamera(ZONES, 0, 0, null, false)).toBe('vale');
    expect(zoneForCamera(ZONES, -300, 0, null, false)).toBe('west');
    expect(zoneForCamera(ZONES, 0, 300, null, false)).toBe('marsh');
  });

  it('holds the current zone across its border, so a seam stays workable', () => {
    // Just over the vale/marsh line: still vale, no rebuild.
    expect(zoneForCamera(ZONES, 0, 182, 'vale', false)).toBe('vale');
    expect(zoneForCamera(ZONES, 0, 180 + ZONE_SWITCH_HYSTERESIS_YD - 0.01, 'vale', false)).toBe(
      'vale',
    );
  });

  it('switches once the camera is clear of the band', () => {
    expect(zoneForCamera(ZONES, 0, 180 + ZONE_SWITCH_HYSTERESIS_YD + 0.01, 'vale', false)).toBe(
      'marsh',
    );
    expect(zoneForCamera(ZONES, -300, 0, 'vale', false)).toBe('west');
  });

  it('the padlock wins outright, however far the camera goes', () => {
    expect(zoneForCamera(ZONES, 0, 300, 'vale', true)).toBe('vale');
    expect(zoneForCamera(ZONES, -400, 500, 'vale', true)).toBe('vale');
    // Locked with nothing streamed yet still has to resolve something.
    expect(zoneForCamera(ZONES, 0, 300, null, true)).toBe('marsh');
  });

  it('does not thrash while the camera orbits a building on the border', () => {
    let cur = zoneForCamera(ZONES, 0, 170, null, false);
    const seen = new Set([cur]);
    for (const z of [176, 184, 179, 190, 172, 186]) {
      cur = zoneForCamera(ZONES, 0, z, cur, false);
      seen.add(cur);
    }
    expect([...seen]).toEqual(['vale']);
  });

  it('nearZone is false for an unknown or absent zone', () => {
    expect(nearZone(ZONES, null, 0, 0)).toBe(false);
    expect(nearZone(ZONES, 'nope', 0, 0)).toBe(false);
    expect(nearZone(ZONES, 'vale', 0, 0)).toBe(true);
  });
});
