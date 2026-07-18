import { describe, expect, it } from 'vitest';
import {
  clampMobilePage,
  MOBILE_ACTION_PAGE_COUNT,
  MOBILE_ACTION_SOURCE_SLOT_COUNT,
  MOBILE_ACTIONS_PER_PAGE,
  mobilePageCount,
  nextMobilePage,
  sourceSlotForMobileButton,
  sourceSlotsForMobilePage,
} from '../src/ui/hud/action_bar/mobile_action_page_view';

describe('mobilePageCount', () => {
  it('supports four pages for the default 20-slot mobile span', () => {
    expect(mobilePageCount()).toBe(4);
    expect(mobilePageCount(MOBILE_ACTION_SOURCE_SLOT_COUNT)).toBe(4);
    expect(MOBILE_ACTION_PAGE_COUNT).toBe(mobilePageCount());
  });

  it('is parameterized: a different total slot count rounds up', () => {
    expect(mobilePageCount(1)).toBe(1);
    expect(mobilePageCount(5)).toBe(1);
    expect(mobilePageCount(6)).toBe(2);
    expect(mobilePageCount(11)).toBe(3);
    expect(mobilePageCount(0)).toBe(1);
  });
});

describe('clampMobilePage', () => {
  it('leaves an in-range page unchanged', () => {
    expect(clampMobilePage(0)).toBe(0);
    expect(clampMobilePage(1)).toBe(1);
    expect(clampMobilePage(2)).toBe(2);
  });

  it('clamps a negative page to 0', () => {
    expect(clampMobilePage(-1)).toBe(0);
    expect(clampMobilePage(-100)).toBe(0);
  });

  it('clamps an overflowing page to the last page', () => {
    expect(clampMobilePage(4)).toBe(3);
    expect(clampMobilePage(999)).toBe(3);
  });

  it('falls back to 0 for NaN', () => {
    expect(clampMobilePage(Number.NaN)).toBe(0);
  });

  it('respects a parameterized page count', () => {
    expect(clampMobilePage(2, 3)).toBe(2);
    expect(clampMobilePage(5, 3)).toBe(2);
  });
});

describe('sourceSlotForMobileButton', () => {
  it('page 0 index 0 maps to source slot 1', () => {
    expect(sourceSlotForMobileButton(0, 0)).toBe(1);
  });

  it('page 1 index 4 maps to source slot 10', () => {
    expect(sourceSlotForMobileButton(1, 4)).toBe(10);
  });

  it('page 2 index 4 maps to source slot 15', () => {
    expect(sourceSlotForMobileButton(2, 4)).toBe(15);
  });

  it('page 3 index 4 maps to source slot 20', () => {
    expect(sourceSlotForMobileButton(3, 4)).toBe(20);
  });

  it('never returns slot 0 across every page/button combination', () => {
    for (let page = 0; page < MOBILE_ACTION_PAGE_COUNT; page++) {
      for (let i = 0; i < MOBILE_ACTIONS_PER_PAGE; i++) {
        expect(sourceSlotForMobileButton(page, i)).toBeGreaterThan(0);
      }
    }
  });
});

describe('sourceSlotsForMobilePage', () => {
  it('returns 5 slots for a page', () => {
    expect(sourceSlotsForMobilePage(0)).toHaveLength(MOBILE_ACTIONS_PER_PAGE);
    expect(sourceSlotsForMobilePage(1)).toHaveLength(MOBILE_ACTIONS_PER_PAGE);
    expect(sourceSlotsForMobilePage(2)).toHaveLength(MOBILE_ACTIONS_PER_PAGE);
    expect(sourceSlotsForMobilePage(3)).toHaveLength(MOBILE_ACTIONS_PER_PAGE);
  });

  it('covers source slots 1-20 across four pages', () => {
    expect(sourceSlotsForMobilePage(0)).toEqual([1, 2, 3, 4, 5]);
    expect(sourceSlotsForMobilePage(1)).toEqual([6, 7, 8, 9, 10]);
    expect(sourceSlotsForMobilePage(2)).toEqual([11, 12, 13, 14, 15]);
    expect(sourceSlotsForMobilePage(3)).toEqual([16, 17, 18, 19, 20]);
  });

  it('the four default pages are disjoint and jointly cover slots 1-20', () => {
    const all = [
      ...sourceSlotsForMobilePage(0),
      ...sourceSlotsForMobilePage(1),
      ...sourceSlotsForMobilePage(2),
      ...sourceSlotsForMobilePage(3),
    ];
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ]);
  });
});

describe('nextMobilePage', () => {
  it('wraps 0 -> 1 -> 2 -> 3 -> 0 for the default 4-page span', () => {
    expect(nextMobilePage(0)).toBe(1);
    expect(nextMobilePage(1)).toBe(2);
    expect(nextMobilePage(2)).toBe(3);
    expect(nextMobilePage(3)).toBe(0);
  });

  it('clamps an out-of-range page before advancing', () => {
    expect(nextMobilePage(-1)).toBe(1);
    expect(nextMobilePage(99)).toBe(0);
  });

  it('respects a parameterized page count', () => {
    expect(nextMobilePage(0, 3)).toBe(1);
    expect(nextMobilePage(1, 3)).toBe(2);
    expect(nextMobilePage(2, 3)).toBe(0);
  });
});
