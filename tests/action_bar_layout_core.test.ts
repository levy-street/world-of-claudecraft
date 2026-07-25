import { describe, expect, it } from 'vitest';
import {
  ACTION_BAR_ABILITY_SLOTS,
  ACTION_BAR_ABILITY_SLOTS_PER_ROW,
  ACTION_BAR_ROW_COUNT,
  actionBarRowForSlot,
} from '../src/ui/hud/action_bar/action_bar_layout_core';

describe('action bar layout', () => {
  it('provides three rows of eleven configurable ability slots', () => {
    expect(ACTION_BAR_ROW_COUNT).toBe(3);
    expect(ACTION_BAR_ABILITY_SLOTS_PER_ROW).toBe(11);
    expect(ACTION_BAR_ABILITY_SLOTS).toBe(33);
  });

  it('keeps Attack and slots 1 to 11 on row one, then fills rows two and three', () => {
    expect(actionBarRowForSlot(0)).toBe(1);
    expect(actionBarRowForSlot(11)).toBe(1);
    expect(actionBarRowForSlot(12)).toBe(2);
    expect(actionBarRowForSlot(22)).toBe(2);
    expect(actionBarRowForSlot(23)).toBe(3);
    expect(actionBarRowForSlot(33)).toBe(3);
  });
});
