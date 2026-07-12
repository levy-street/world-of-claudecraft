// Two-handed weapon proficiency: rogues never equip two-handers (operator
// decision 2026-07-11). The greatswords carry the warrior weapon GROUP list,
// which includes rogue so the group keeps granting the one-handers (a rogue's
// BiS mainhand is the group's Thronebane), so the 2H exclusion is a RULE in
// equipment_rules, not per-item data: any future two-hander is covered.
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { canEquipItem, canEquipItemInSlot, weaponHand } from '../src/sim/equipment_rules';
import { ALL_CLASSES } from '../src/sim/types';

describe('two-handed weapon proficiency', () => {
  it('rogues cannot equip ANY two-handed weapon in the game', () => {
    const twoHanders = Object.values(ITEMS).filter(
      (i) => i.kind === 'weapon' && weaponHand(i) === 'twohand',
    );
    expect(twoHanders.length).toBeGreaterThanOrEqual(3); // greatswords + greatblades exist
    for (const item of twoHanders) {
      expect(canEquipItem('rogue', item), item.id).toBe(false);
      expect(canEquipItemInSlot('rogue', item, 'mainhand', null), item.id).toBe(false);
    }
  });

  it('rogues keep the one-handers their weapon group grants (Thronebane stays BiS)', () => {
    expect(canEquipItem('rogue', ITEMS.kingsbane_last_oath)).toBe(true);
    expect(canEquipItem('rogue', ITEMS.fang_of_korzul)).toBe(true);
  });

  it('the two-hand classes keep their greatswords', () => {
    for (const cls of ['warrior', 'warrior_classic', 'paladin', 'shaman'] as const) {
      expect(canEquipItem(cls, ITEMS.bonewrought_greatsword), cls).toBe(true);
    }
    expect(canEquipItem('hunter', ITEMS.direfang_greatblade)).toBe(true);
  });

  it('no other class loses a weapon it could equip before the rule', () => {
    // The rule is a rogue-only denial: every other class's legality for every
    // weapon is untouched (spot-checked across the whole table).
    for (const cls of ALL_CLASSES) {
      if (cls === 'rogue') continue;
      for (const item of Object.values(ITEMS)) {
        if (item.kind !== 'weapon' || weaponHand(item) !== 'twohand') continue;
        // Only classes in the item's group/list may equip; the rule itself
        // must never be the reason a non-rogue is denied. Deny reasons for
        // non-rogues must come from requiredClass alone.
        const allowedByList =
          !item.requiredClass ||
          item.requiredClass.includes(cls === 'warrior_classic' ? 'warrior' : cls);
        expect(canEquipItem(cls, item), `${cls} ${item.id}`).toBe(allowedByList);
      }
    }
  });
});
