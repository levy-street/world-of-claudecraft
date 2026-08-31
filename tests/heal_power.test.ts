// Healing Power: the healing-only affix (docs/prd/ignivar-raid-loot.md, "Two
// affix debuts"). The directionality contract, settled by the maintainer:
// Spell Power adds to healing (entity.healPower derives as spellPower plus
// flat Healing Power from gear and set bonuses), but Healing Power never adds
// to damage (damage paths read spellPower; heal, HoT, and absorb paths read
// healPower).
import { describe, expect, it } from 'vitest';
import { aggregateSetBonuses, ITEM_SETS } from '../src/sim/content/item_sets';
import { ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { HEALING_SP_SCALE } from '../src/sim/spell_scaling';
import type { ItemDef, ItemSet, SimEvent } from '../src/sim/types';

type HealEv = Extract<SimEvent, { type: 'heal2' }>;

const HEAL_ROBE_ID = '__test_heal_power_robe';
const SPELL_ROBE_ID = '__test_spell_power_robe';

function injectRobes(): void {
  const base = {
    kind: 'armor',
    slot: 'chest',
    armorType: 'cloth',
    sellValue: 0,
    requiredLevel: 1,
  } as const;
  ITEMS[HEAL_ROBE_ID] = {
    ...base,
    id: HEAL_ROBE_ID,
    name: 'Heal Power Test Robe',
    healPower: 100,
  } as ItemDef;
  ITEMS[SPELL_ROBE_ID] = {
    ...base,
    id: SPELL_ROBE_ID,
    name: 'Spell Power Test Robe',
    spellPower: 14,
  } as ItemDef;
}

function cleanupRobes(): void {
  delete ITEMS[HEAL_ROBE_ID];
  delete ITEMS[SPELL_ROBE_ID];
}

describe('Healing Power derivation (recalcPlayerStats)', () => {
  it('gear Healing Power raises healPower only; Spell Power raises both', () => {
    injectRobes();
    try {
      const sim = new Sim({ seed: 11, playerClass: 'priest' });
      const p = sim.player;
      const baseSp = p.spellPower;
      // With no Healing Power anywhere, healPower IS spell power (the one-way
      // inheritance: Spell Power adds to healing).
      expect(p.healPower).toBe(baseSp);

      sim.addItem(HEAL_ROBE_ID, 1);
      sim.equipItem(HEAL_ROBE_ID);
      expect(p.spellPower).toBe(baseSp); // Healing Power never adds to damage
      expect(p.healPower).toBe(baseSp + 100);

      sim.addItem(SPELL_ROBE_ID, 1);
      sim.equipItem(SPELL_ROBE_ID); // replaces the chest
      expect(p.spellPower).toBe(baseSp + 14);
      expect(p.healPower).toBe(baseSp + 14); // sp flows into healing
    } finally {
      cleanupRobes();
    }
  });

  it('set bonus Healing Power aggregates and folds into the wearer', () => {
    const setId = '__test_heal_power_set';
    ITEM_SETS[setId] = {
      id: setId,
      name: 'Heal Power Test Set',
      bonuses: [
        {
          pieces: 2,
          effect: { healPower: 25 },
          text: 'Increases Healing Power by 25.',
        },
      ],
    } as ItemSet;
    try {
      const two = aggregateSetBonuses(new Map([[setId, 2]]));
      expect(two.healPower).toBe(25);
      const one = aggregateSetBonuses(new Map([[setId, 1]]));
      expect(one.healPower).toBe(0);
    } finally {
      delete ITEM_SETS[setId];
    }
  });
});

describe('Healing Power in the live heal path', () => {
  function healAmounts(withRobe: boolean): number[] {
    const sim = new Sim({ seed: 21, playerClass: 'priest' });
    const p = sim.player;
    sim.setPlayerLevel(20);
    if (withRobe) {
      sim.addItem(HEAL_ROBE_ID, 1);
      sim.equipItem(HEAL_ROBE_ID);
    }
    // Leave a deep health deficit so the missing-hp clamp never truncates the
    // boosted heal (a level-20 priest pool leaves far more than the rider).
    p.hp = 1;
    p.resource = p.maxResource;
    sim.castAbility('lesser_heal');
    const heals: HealEv[] = [];
    for (let i = 0; i < 20 * 4; i++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'heal2' && ev.targetId === p.id) heals.push(ev);
      }
    }
    return heals.map((h) => h.amount);
  }

  it('a heal cast reads healPower: 100 Healing Power adds the full rider', () => {
    injectRobes();
    try {
      const base = healAmounts(false);
      const boosted = healAmounts(true);
      expect(base.length).toBeGreaterThan(0);
      expect(boosted.length).toBeGreaterThan(0);
      // Same seed and identical rng draws either side; only the equipped robe
      // differs. The 1.5s coefficient floor puts the extra rider at no less
      // than round(100 * HEALING_SP_SCALE * 1.5 / 3.5) = 86 even before any
      // crit multiplier, so the boosted heal must exceed the base heal by at
      // least that much. Decisive: if the heal path ignored healPower, the
      // two amounts would be equal and this fails by ~86. The modest 100
      // keeps base + rider far under the naked pool's missing-hp clamp.
      const floorRider = Math.round((100 * HEALING_SP_SCALE * 1.5) / 3.5);
      expect(boosted[0] - base[0]).toBeGreaterThanOrEqual(floorRider);
    } finally {
      cleanupRobes();
    }
  });
});
