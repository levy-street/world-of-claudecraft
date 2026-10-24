import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { bestGodLoadout } from '../src/sim/dev_loadout';
import { canEquipItem, MASTERWROUGHT_EQUIP_CAP, weaponHand } from '../src/sim/equipment_rules';
import { itemScore } from '../src/sim/item_level';
import { ALL_CLASSES, ALL_EQUIP_SLOTS } from '../src/sim/types';

// Every live non-ring slot, including offhand for classes allowed to use it.
const GEAR_SLOTS = ALL_EQUIP_SLOTS.filter((s) => s !== 'ring1' && s !== 'ring2');

function twoHandedMainhand(slots: readonly string[]): boolean {
  const main = slots.map((id) => ITEMS[id]).find((def) => def?.slot === 'mainhand');
  return main?.kind === 'weapon' && weaponHand(main) === 'twohand';
}

describe('bestGodLoadout', () => {
  it('fills every gear slot + both rings for every class', () => {
    for (const cls of ALL_CLASSES) {
      const loadout = bestGodLoadout(cls);
      // A two-handed main hand fills both hands, so it leaves no off-hand pick.
      const handsFull = twoHandedMainhand(loadout.slots);
      const eligibleSlots = GEAR_SLOTS.filter(
        (slot) =>
          !(handsFull && slot === 'offhand') &&
          Object.values(ITEMS).some(
            (item) =>
              (item.kind === 'weapon' || item.kind === 'armor') &&
              item.slot === slot &&
              canEquipItem(cls, item),
          ),
      );
      const slots = new Set(loadout.slots.map((id) => ITEMS[id]?.slot));
      for (const slot of eligibleSlots) {
        expect(slots.has(slot), `${cls} missing ${slot}`).toBe(true);
      }
      expect(loadout.slots.length).toBe(eligibleSlots.length);
      expect(loadout.rings.length).toBe(2);
      expect(loadout.rings[0]).not.toBe(loadout.rings[1]); // two distinct rings
    }
  });

  it('only picks items the class can actually equip', () => {
    for (const cls of ALL_CLASSES) {
      const loadout = bestGodLoadout(cls);
      for (const id of [...loadout.slots, ...loadout.rings]) {
        const def = ITEMS[id];
        expect(def, `${id} exists`).toBeDefined();
        expect(canEquipItem(cls, def), `${cls} can equip ${id}`).toBe(true);
      }
    }
  });

  it('picks the highest itemScore available in each slot', () => {
    const cls = 'warrior';
    const loadout = bestGodLoadout(cls);
    for (const id of loadout.slots) {
      const chosen = ITEMS[id];
      const slot = chosen.slot;
      // No equippable item in the same slot outscores the chosen one.
      for (const def of Object.values(ITEMS)) {
        if (def.slot !== slot) continue;
        if (def.kind !== 'weapon' && def.kind !== 'armor') continue;
        if (!canEquipItem(cls, def)) continue;
        expect(itemScore(chosen)).toBeGreaterThanOrEqual(itemScore(def));
      }
    }
  });

  it('honours the wear rules the equip path enforces', () => {
    for (const cls of ALL_CLASSES) {
      const { slots, rings } = bestGodLoadout(cls);
      const flagged = [...slots, ...rings].filter((id) => ITEMS[id]?.masterwrought);
      expect(flagged.length, `${cls} Masterwrought picks`).toBeLessThanOrEqual(
        MASTERWROUGHT_EQUIP_CAP,
      );
      if (twoHandedMainhand(slots)) {
        expect(
          slots.some((id) => ITEMS[id]?.slot === 'offhand'),
          `${cls} off-hand beside a two-hander`,
        ).toBe(false);
      }
    }
  });

  it('is deterministic (stable across calls)', () => {
    expect(bestGodLoadout('mage')).toEqual(bestGodLoadout('mage'));
  });
});
