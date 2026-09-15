// The action-bar icon-key resolver extracted from hud.ts (the sell-confirm
// ratchet payment): every core icon key shape maps to its background-image.
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { actionBarIconBg } from '../src/ui/hud/action_bar/action_bar_icon_bg';
import {
  ABILITY_ICON_PREFIX,
  ATTACK_ICON_KEY,
  EMPTY_ICON_KEY,
  ITEM_ICON_PREFIX,
} from '../src/ui/hud/action_bar/action_bar_view';
import { iconDataUrl } from '../src/ui/icons';

describe('actionBarIconBg', () => {
  it('an empty slot has no background', () => {
    expect(actionBarIconBg(EMPTY_ICON_KEY)).toBe('');
  });

  it('the attack key resolves to the attack ability icon', () => {
    expect(actionBarIconBg(ATTACK_ICON_KEY)).toBe(`url(${iconDataUrl('ability', 'attack')})`);
  });

  it('item and ability keys strip their prefix and resolve by kind', () => {
    expect(actionBarIconBg(`${ITEM_ICON_PREFIX}coin_gold`)).toBe(
      `url(${iconDataUrl('item', 'coin_gold')})`,
    );
    expect(actionBarIconBg(`${ABILITY_ICON_PREFIX}heroic_strike`)).toBe(
      `url(${iconDataUrl('ability', 'heroic_strike')})`,
    );
  });
});
