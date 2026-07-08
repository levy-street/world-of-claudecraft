import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { ItemDef } from '../src/sim/types';
import { critFractionFromRating, hasteFractionFromRating } from '../src/sim/types';

describe('combat ratings', () => {
  it('converts haste and crit ratings to fractions', () => {
    expect(hasteFractionFromRating(150)).toBe(0.15);
    expect(critFractionFromRating(20)).toBe(0.02);
  });

  it('accumulates item combat ratings and applies them to derived player stats', () => {
    const itemId = '__test_combat_rating_chest';
    const item: ItemDef = {
      id: itemId,
      name: 'Combat Rating Test Chest',
      kind: 'armor',
      slot: 'chest',
      armorType: 'leather',
      sellValue: 0,
      requiredLevel: 1,
      hasteRating: 150,
      critRating: 20,
    };
    ITEMS[itemId] = item;
    try {
      const sim = new Sim({ seed: 11, playerClass: 'rogue' });
      const p = sim.player;
      sim.addItem(itemId, 1);
      sim.equipItem(itemId);

      expect(p.hasteRating).toBe(150);
      expect(p.critRating).toBe(20);
      expect(p.meleeHaste).toBe(0.15);
      expect(p.rangedHaste).toBe(0.15);
      expect(p.spellHaste).toBe(0.15);
      expect(p.critChance).toBeCloseTo(0.05 + p.stats.agi * 0.0005 + 0.02);
    } finally {
      delete ITEMS[itemId];
    }
  });
});
