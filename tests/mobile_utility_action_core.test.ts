import { describe, expect, it } from 'vitest';
import { MENU_STRIP_ITEMS } from '../src/ui/hud/menu/menu_strip_core';
import {
  DEFAULT_MOBILE_UTILITY_ACTIONS,
  MOBILE_UTILITY_ACTION_SLOT_COUNT,
  MOBILE_UTILITY_ACTION_IDS,
} from '../src/ui/hud/action_bar/utility_action_core';

describe('mobile utility action defaults', () => {
  it('uses the existing Quick Actions roster and includes Bags in its defaults', () => {
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
    expect(DEFAULT_MOBILE_UTILITY_ACTIONS).toEqual(['mount', 'map', 'chat', 'bags']);
    expect(DEFAULT_MOBILE_UTILITY_ACTIONS).toHaveLength(MOBILE_UTILITY_ACTION_SLOT_COUNT);
    expect(new Set(DEFAULT_MOBILE_UTILITY_ACTIONS).size).toBe(MOBILE_UTILITY_ACTION_SLOT_COUNT);
  });

});
