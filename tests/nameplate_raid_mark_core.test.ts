// The raid target icon on a nameplate (src/render/nameplate_raid_mark_core.ts):
// DOCKED beside a shown plate (left of its widest part, centred on the
// name-plus-bar block, lifting nothing) or FLOATING above the head when a
// nameplate toggle hid the plate (large, lifting the stack above it).

import { describe, expect, it } from 'vitest';
import { nameplateHealthBarTop } from '../src/render/nameplate_pick_core';
import {
  newRaidMarkPlateBox,
  RAID_MARK_DOCK_GAP,
  RAID_MARK_DOCK_MAX,
  RAID_MARK_DOCK_MIN,
  RAID_MARK_PLATE_GAP,
  RAID_MARK_PLATE_MAX,
  RAID_MARK_PLATE_MIN,
  raidMarkDockSize,
  raidMarkPlateBoxInto,
  raidMarkPlateLift,
  raidMarkPlateSize,
} from '../src/render/nameplate_raid_mark_core';

const plate = (over: Partial<Parameters<typeof raidMarkPlateLift>[0]> = {}) => ({
  raidMarkerUrl: 'data:mark',
  name: 'Training Effigy',
  hpVisible: true,
  castVisible: false,
  frame: '',
  ...over,
});
// A name row 16 px tall whose bottom sits 6 px above the bar top, 120 px wide.
const SCREEN_Y = 400;
const BAR_TOP = nameplateHealthBarTop(SCREEN_Y, false);
const row = { nameRowBottomY: BAR_TOP - 6, nameRowHeight: 16, nameRowWidth: 120 };

describe('raid target icon sizes', () => {
  it('docked: about 28 px on a 900 px view, clamped', () => {
    expect(raidMarkDockSize(900)).toBe(28);
    expect(raidMarkDockSize(300)).toBe(RAID_MARK_DOCK_MIN);
    expect(raidMarkDockSize(2160)).toBe(RAID_MARK_DOCK_MAX);
  });

  it('floating: about 56 px on a 900 px view, clamped, crisp from the 128 px sprite', () => {
    expect(raidMarkPlateSize(900)).toBe(56);
    expect(raidMarkPlateSize(360)).toBe(RAID_MARK_PLATE_MIN);
    expect(raidMarkPlateSize(2160)).toBe(RAID_MARK_PLATE_MAX);
    expect(RAID_MARK_PLATE_MAX * 2).toBeLessThanOrEqual(128);
  });
});

describe('docked placement', () => {
  it('sits left of the widest part of the plate with a small gap and lifts nothing', () => {
    const box = raidMarkPlateBoxInto(newRaidMarkPlateBox(), plate(), row, 500, SCREEN_Y, 300, 900);
    expect(box.size).toBe(28);
    expect(box.lift).toBe(0);
    // the 120 px name row is wider than the 80 px bar, so it sets the left edge
    expect(box.x + box.size).toBe(500 - 60 - RAID_MARK_DOCK_GAP);
    expect(RAID_MARK_DOCK_GAP).toBeGreaterThanOrEqual(2);
    expect(RAID_MARK_DOCK_GAP).toBeLessThanOrEqual(4);
  });

  it('is vertically centred on the name-plus-bar block', () => {
    const box = raidMarkPlateBoxInto(newRaidMarkPlateBox(), plate(), row, 500, SCREEN_Y, 300, 900);
    const top = row.nameRowBottomY - row.nameRowHeight;
    const bottom = BAR_TOP + 4;
    expect(box.y + box.size / 2).toBe((top + bottom) / 2);
  });

  it('a narrow name docks off the bar, the bar setting the left edge', () => {
    const narrow = { ...row, nameRowWidth: 30 };
    const box = raidMarkPlateBoxInto(
      newRaidMarkPlateBox(),
      plate(),
      narrow,
      500,
      SCREEN_Y,
      300,
      900,
    );
    expect(box.x + box.size).toBe(500 - 40 - RAID_MARK_DOCK_GAP);
  });

  it('draws nothing for an unmarked plate', () => {
    const box = raidMarkPlateBoxInto(
      newRaidMarkPlateBox(),
      plate({ raidMarkerUrl: '' }),
      row,
      500,
      SCREEN_Y,
      300,
      900,
    );
    expect(box.size).toBe(0);
    expect(box.lift).toBe(0);
    expect(raidMarkPlateLift(plate({ raidMarkerUrl: '' }), 900)).toBe(0);
  });
});

describe('floating placement (a toggle hid the plate)', () => {
  it('centres the large icon above the stack and lifts it by the icon plus a gap', () => {
    const iconOnly = plate({ name: '', hpVisible: false });
    const box = raidMarkPlateBoxInto(newRaidMarkPlateBox(), iconOnly, row, 500, SCREEN_Y, 300, 900);
    expect(box.size).toBe(56);
    expect(box.lift).toBe(56 + RAID_MARK_PLATE_GAP);
    expect(box.x).toBe(500 - 28);
    expect(box.y).toBe(300 - box.lift);
    expect(raidMarkPlateLift(iconOnly, 900)).toBe(box.lift);
  });
});
