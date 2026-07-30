import { describe, expect, it } from 'vitest';
import { ITEMS, NPCS } from '../src/sim/data';
import {
  canEquipItem,
  canEquipItemInSlot,
  isShieldItem,
  weaponHand,
} from '../src/sim/equipment_rules';
import {
  expectedStatBudget,
  itemLevel,
  primaryStatBudget,
  primaryStatSum,
  TWOHAND_STAT_MULT,
} from '../src/sim/item_level';
import type { ItemDef, WeaponItemDef } from '../src/sim/types';

function weapon(itemId: string): WeaponItemDef {
  const item = ITEMS[itemId];
  if (item.kind !== 'weapon') throw new Error(`${itemId} must be a weapon`);
  return item;
}

describe('v0.26 two-handed greatblade itemization', () => {
  it('retains the winning Warrior Highwatch two-hander and wallshield vendor path', () => {
    const greatsword = weapon('highwatch_greatsword');
    expect(greatsword.hand).toBe('twohand');
    expect(greatsword.requiredClass).toBeUndefined();

    const wallshield = ITEMS.highwatch_wallshield;
    expect(isShieldItem(wallshield)).toBe(true);
    expect(wallshield).toMatchObject({
      kind: 'armor',
      armorType: 'mail',
      slot: 'offhand',
      shield: true,
      blockValue: 14,
      stats: { armor: 112, sta: 2 },
      requiredClass: ['warrior', 'paladin', 'shaman'],
    });
    expect(canEquipItem('warrior', wallshield)).toBe(true);
    expect(canEquipItem('paladin', wallshield)).toBe(true);
    expect(canEquipItem('shaman', wallshield)).toBe(true);
    expect(canEquipItem('mage', wallshield)).toBe(false);
    expect(NPCS.armorer_hode.vendorItems).toEqual(
      expect.arrayContaining(['highwatch_greatsword', 'highwatch_wallshield']),
    );
  });

  it('declares the current greatblades two-handed at their v0.27.1 re-budgeted totals', () => {
    const wyrmfang = weapon('wyrmfang_greatblade');
    expect(wyrmfang.hand).toBe('twohand');
    expect(itemLevel(wyrmfang)).toBe(26);
    expect(wyrmfang.stats).toMatchObject({ str: 14, sta: 9 });
    expect(primaryStatSum(wyrmfang)).toBe(23);
    expect(expectedStatBudget(wyrmfang)).toBe(23);

    const deathless = weapon('deathless_greatblade');
    expect(deathless.hand).toBe('twohand');
    expect(itemLevel(deathless)).toBe(33);
    expect(deathless.stats).toMatchObject({ str: 18, sta: 12 });
    expect(primaryStatSum(deathless)).toBe(30);
    expect(expectedStatBudget(deathless)).toBe(30);
  });

  it('applies the two-hand stat premium only to two-handed weapons', () => {
    const wyrmfang = weapon('wyrmfang_greatblade');
    const oneHandBudget = primaryStatBudget(26, wyrmfang.quality, wyrmfang.slot);
    expect(oneHandBudget).toBe(18);
    expect(expectedStatBudget(wyrmfang)).toBe(Math.round(oneHandBudget * TWOHAND_STAT_MULT));

    const oneHand = weapon('kingsbane_last_oath');
    const expectedOneHand = primaryStatBudget(
      itemLevel(oneHand) ?? 0,
      oneHand.quality,
      oneHand.slot,
    );
    expect(weaponHand(oneHand)).toBe('onehand');
    expect(expectedStatBudget(oneHand)).toBe(expectedOneHand);
  });

  it('carries the re-budgeted premium through generated heroic variants', () => {
    const variant = weapon('heroic_wyrmfang_greatblade');
    expect(variant.heroicOf).toBe('wyrmfang_greatblade');
    expect(variant.hand).toBe('twohand');
    expect(itemLevel(variant)).toBe(28);
    expect(expectedStatBudget(variant)).toBe(
      Math.round(primaryStatBudget(28, variant.quality, variant.slot) * TWOHAND_STAT_MULT),
    );
    expect(primaryStatSum(variant)).toBe(expectedStatBudget(variant));
  });
});

describe('v0.26 two-handed Rogue proficiency', () => {
  it('denies every current and future two-hander at the equipment boundary', () => {
    const twoHanders = Object.values(ITEMS).filter(
      (item) => item.kind === 'weapon' && weaponHand(item) === 'twohand',
    );
    expect(twoHanders.length).toBeGreaterThanOrEqual(3);
    for (const item of twoHanders) {
      expect(canEquipItem('rogue', item), item.id).toBe(false);
      expect(canEquipItemInSlot('rogue', item, 'mainhand', null), item.id).toBe(false);
      expect(item.requiredClass ?? [], item.id).not.toContain('rogue');
    }

    const futureTwoHander: ItemDef = {
      id: 'future_twohander',
      name: 'Future Twohander',
      kind: 'weapon',
      slot: 'mainhand',
      hand: 'twohand',
      weapon: { min: 1, max: 2, speed: 3 },
      sellValue: 0,
    };
    expect(canEquipItem('rogue', futureTwoHander)).toBe(false);
  });

  it('keeps Rogue one-handed weapons legal', () => {
    const kingsbane = weapon('kingsbane_last_oath');
    expect(weaponHand(kingsbane)).toBe('onehand');
    expect(canEquipItem('rogue', kingsbane)).toBe(true);
    const fang = weapon('fang_of_korzul');
    expect(weaponHand(fang)).toBe('onehand');
    expect(canEquipItem('rogue', fang)).toBe(true);
  });
});
