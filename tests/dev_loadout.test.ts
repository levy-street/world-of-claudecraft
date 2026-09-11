import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { bestGodLoadout } from '../src/sim/dev_loadout';
import { canEquipItem } from '../src/sim/equipment_rules';
import { itemScore } from '../src/sim/item_level';
import { ALL_CLASSES, ALL_EQUIP_SLOTS } from '../src/sim/types';

// The nine non-ring gear slots an item can declare (ring1/ring2 are resolved at
// equip time; items only ever declare 'ring').
const GEAR_SLOTS = ALL_EQUIP_SLOTS.filter((s) => s !== 'ring1' && s !== 'ring2');

describe('bestGodLoadout', () => {
  it('fills every gear slot + both rings for every class', () => {
    for (const cls of ALL_CLASSES) {
      const loadout = bestGodLoadout(cls);
      // One item per non-ring slot the class can wear. Every class in this
      // game can equip something in all nine (mainhand is proficiency-gated
      // but every class has a usable weapon type).
      const slots = new Set(loadout.slots.map((id) => ITEMS[id]?.slot));
      for (const slot of GEAR_SLOTS) {
        expect(slots.has(slot), `${cls} missing ${slot}`).toBe(true);
      }
      expect(loadout.slots.length).toBe(GEAR_SLOTS.length);
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

  it('is deterministic (stable across calls)', () => {
    expect(bestGodLoadout('mage')).toEqual(bestGodLoadout('mage'));
  });
});
