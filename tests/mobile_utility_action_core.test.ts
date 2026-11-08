import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOBILE_UTILITY_ACTIONS,
  MOBILE_UTILITY_ACTION_IDS,
  MOBILE_UTILITY_ACTION_PAGES,
  MOBILE_UTILITY_ACTION_SLOT_COUNT,
} from '../src/ui/hud/action_bar/utility_action_core';
import { MENU_STRIP_ITEMS } from '../src/ui/hud/menu/menu_strip_core';

describe('mobile utility action defaults', () => {
  it('keeps Quick Actions separate from the two fixed utility pages', () => {
    expect(MOBILE_UTILITY_ACTION_IDS).toEqual([
      'mount',
      'chat',
      'map',
      'bags',
      'social',
      'quest',
      'char',
      'spellbook',
      'settings',
      'more',
    ]);
    expect(MENU_STRIP_ITEMS.map((item) => item.id)).toEqual(MOBILE_UTILITY_ACTION_IDS);
    expect(MOBILE_UTILITY_ACTION_PAGES).toEqual([
      ['mount', 'map', 'bags', 'char', 'quest'],
      ['chat', 'social', 'dfinder', 'spellbook', 'crafting'],
    ]);
    expect(DEFAULT_MOBILE_UTILITY_ACTIONS).toBe(MOBILE_UTILITY_ACTION_PAGES[0]);
    expect(DEFAULT_MOBILE_UTILITY_ACTIONS).toHaveLength(MOBILE_UTILITY_ACTION_SLOT_COUNT);
    for (const page of MOBILE_UTILITY_ACTION_PAGES) {
      expect(page).toHaveLength(MOBILE_UTILITY_ACTION_SLOT_COUNT);
      expect(new Set(page).size).toBe(MOBILE_UTILITY_ACTION_SLOT_COUNT);
    }
  });
});
