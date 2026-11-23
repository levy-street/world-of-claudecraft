// A common or uncommon weapon draws a fifth smaller than the same model at rare and above.
//
// Owner: "We actually need to scale back the weapons of the common and uncommon, lets say by
// 10%. Just so it feels like you are progressing in the game", then "can we go even smaller
// just by another 10%": 0.8 of the model's size. The rule reads the ITEM, not
// the model: the plain field models serve common, uncommon and rare weapons alike (a rare
// weapon is a common shape in another paint), and a rule on the model would shrink the rare
// ones with them. tests/field_weapon_attach.test.ts drives it through the real attach path.
import { describe, expect, it } from 'vitest';
import { heldWeaponSize, LOW_TIER_WEAPON_SIZE } from '../src/render/characters/held_item_size_core';
import { itemOffhandModelUrl, itemWeaponModelUrl } from '../src/render/characters/manifest';
import { ITEMS } from '../src/sim/data';
import { isShieldItem } from '../src/sim/equipment_rules';

describe('heldWeaponSize', () => {
  it('is a fifth', () => {
    expect(LOW_TIER_WEAPON_SIZE).toBe(0.8);
  });

  it('draws a common or uncommon weapon a fifth smaller', () => {
    expect(ITEMS.worn_sword.quality).toBe('common');
    expect(heldWeaponSize('worn_sword')).toBe(0.8);
    expect(ITEMS.redbrook_blade.quality).toBe('uncommon');
    expect(heldWeaponSize('redbrook_blade')).toBe(0.8);
  });

  it('draws a rare, epic or legendary weapon at the size of its model', () => {
    for (const [itemId, quality] of [
      ['valeborn_spellblade', 'rare'],
      ['bonewrought_greatsword', 'epic'],
      ['kingsbane_last_oath', 'legendary'],
    ] as const) {
      expect(ITEMS[itemId].quality, itemId).toBe(quality);
      expect(heldWeaponSize(itemId), itemId).toBe(1);
    }
  });

  // The reason the rule is on the item: one model, two rarities, two sizes.
  it('sizes by the item, not the model: a rare weapon on a common shape is full size', () => {
    expect(itemWeaponModelUrl('copper_bearded_axe')).toBe(
      itemWeaponModelUrl('drogmars_skullcleaver'),
    );
    expect(ITEMS.copper_bearded_axe.quality).toBe('common');
    expect(ITEMS.drogmars_skullcleaver.quality).toBe('rare');
    expect(heldWeaponSize('copper_bearded_axe')).toBe(0.8);
    expect(heldWeaponSize('drogmars_skullcleaver')).toBe(1);
  });

  it('sizes every weapon in the game by its rarity alone', () => {
    const seen = { low: 0, high: 0 };
    for (const item of Object.values(ITEMS)) {
      if (item.kind !== 'weapon') continue;
      const low = ['poor', 'common', 'uncommon'].includes(item.quality ?? 'common');
      expect(heldWeaponSize(item.id), `${item.id} (${item.quality})`).toBe(low ? 0.8 : 1);
      seen[low ? 'low' : 'high']++;
    }
    // both arms are live content: the starting and levelling weapons, and the rest
    expect(seen.low).toBeGreaterThan(50);
    expect(seen.high).toBeGreaterThan(90);
  });

  it('leaves a shield, a held off-hand, an unknown id and an empty hand alone', () => {
    // a common shield: an item with a held model, but not a weapon
    expect(ITEMS.highwatch_wallshield.quality).toBe('common');
    expect(isShieldItem(ITEMS.highwatch_wallshield)).toBe(true);
    expect(itemOffhandModelUrl('highwatch_wallshield')).not.toBeNull();
    expect(heldWeaponSize('highwatch_wallshield')).toBe(1);
    const shields = Object.values(ITEMS).filter((item) => isShieldItem(item));
    expect(shields.length).toBeGreaterThan(10);
    for (const shield of shields) expect(heldWeaponSize(shield.id), shield.id).toBe(1);
    expect(heldWeaponSize('a_weapon_this_client_never_heard_of')).toBe(1);
    expect(heldWeaponSize(null)).toBe(1);
    expect(heldWeaponSize(undefined)).toBe(1);
  });
});
