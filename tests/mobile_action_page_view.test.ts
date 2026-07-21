import { describe, expect, it } from 'vitest';
import {
  clampMobilePage,
  MOBILE_ACTION_PAGE_COUNT,
  MOBILE_ACTION_SOURCE_SLOT_COUNT,
  MOBILE_ACTIONS_PER_PAGE,
  mobileButtonHasSourceSlot,
  mobilePageCount,
  nextMobilePage,
  sourceSlotForMobileButton,
  sourceSlotsForMobilePage,
} from '../src/ui/hud/action_bar/mobile_action_page_view';

describe('mobilePageCount', () => {
  it('supports seven pages for all 33 configurable action slots', () => {
    expect(MOBILE_ACTION_SOURCE_SLOT_COUNT).toBe(33);
    expect(mobilePageCount()).toBe(7);
    expect(mobilePageCount(MOBILE_ACTION_SOURCE_SLOT_COUNT)).toBe(7);
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
    expect(clampMobilePage(6)).toBe(6);
  });

  it('clamps a negative page to 0', () => {
    expect(clampMobilePage(-1)).toBe(0);
    expect(clampMobilePage(-100)).toBe(0);
  });

  it('clamps an overflowing page to the last page', () => {
    expect(clampMobilePage(7)).toBe(6);
    expect(clampMobilePage(999)).toBe(6);
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

  it('page 6 maps its first three buttons to the third-row tail', () => {
    expect(sourceSlotsForMobilePage(6)).toEqual([31, 32, 33, 34, 35]);
    expect([0, 1, 2, 3, 4].map((index) => mobileButtonHasSourceSlot(6, index))).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
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
    for (let page = 0; page < MOBILE_ACTION_PAGE_COUNT; page++) {
      expect(sourceSlotsForMobilePage(page)).toHaveLength(MOBILE_ACTIONS_PER_PAGE);
    }
  });

  it('keeps the first four pages compatible with the prior mobile span', () => {
    expect(sourceSlotsForMobilePage(0)).toEqual([1, 2, 3, 4, 5]);
    expect(sourceSlotsForMobilePage(1)).toEqual([6, 7, 8, 9, 10]);
    expect(sourceSlotsForMobilePage(2)).toEqual([11, 12, 13, 14, 15]);
    expect(sourceSlotsForMobilePage(3)).toEqual([16, 17, 18, 19, 20]);
  });

  it('the default pages expose every configurable slot, with two empty tail positions', () => {
    const all = Array.from({ length: MOBILE_ACTION_PAGE_COUNT }, (_, page) =>
      sourceSlotsForMobilePage(page),
    ).flat();
    expect(new Set(all).size).toBe(all.length);
    expect(all.slice(0, MOBILE_ACTION_SOURCE_SLOT_COUNT)).toEqual(
      Array.from({ length: 33 }, (_, index) => index + 1),
    );
    expect(all.slice(MOBILE_ACTION_SOURCE_SLOT_COUNT)).toEqual([34, 35]);
  });
});

describe('nextMobilePage', () => {
  it('advances through the default span and wraps after page 6', () => {
    expect(nextMobilePage(0)).toBe(1);
    expect(nextMobilePage(5)).toBe(6);
    expect(nextMobilePage(6)).toBe(0);
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
