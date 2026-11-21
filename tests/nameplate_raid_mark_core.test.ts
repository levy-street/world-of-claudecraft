// The raid target icon above a nameplate (src/render/nameplate_raid_mark_core.ts):
// large, viewport-scaled within a floor and a ceiling, and lifting the stack by
// itself plus a gap so it never overlaps the plate below it.

import { describe, expect, it } from 'vitest';
import {
  RAID_MARK_PLATE_GAP,
  RAID_MARK_PLATE_MAX,
  RAID_MARK_PLATE_MIN,
  raidMarkPlateLift,
  raidMarkPlateSize,
} from '../src/render/nameplate_raid_mark_core';

describe('raid target icon size on a nameplate', () => {
  it('is about twice the old 30 px chip on a 900 px tall view', () => {
    expect(raidMarkPlateSize(900)).toBe(56);
    expect(raidMarkPlateSize(900)).toBeGreaterThanOrEqual(2 * 28);
  });

  it('clamps to a legible floor and a crisp ceiling', () => {
    expect(raidMarkPlateSize(360)).toBe(RAID_MARK_PLATE_MIN);
    expect(raidMarkPlateSize(2160)).toBe(RAID_MARK_PLATE_MAX);
    expect(RAID_MARK_PLATE_MAX * 2).toBeLessThanOrEqual(128); // the sprite edge at 2x DPR
  });

  it('lifts the stack by the icon plus a gap, and not at all when unmarked', () => {
    expect(raidMarkPlateLift('', 900)).toBe(0);
    expect(raidMarkPlateLift('data:x', 900)).toBe(56 + RAID_MARK_PLATE_GAP);
    expect(RAID_MARK_PLATE_GAP).toBeGreaterThan(0);
  });
});
