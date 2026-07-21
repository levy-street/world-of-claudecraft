// The shared crit core (Entity.sharedCritBonus): crit rating, talent crit, set
// crit, and flat crit auras now feed BOTH hit tables. Community-found gap: the
// spell path (Sim.spellCrit) used to read only Intellect, so crit from gear
// ratings, talents, and set bonuses silently did nothing for casters. These
// tests pin the shared core through the real seam every damage/heal crit roll
// consumes (sim.ctx.spellCrit) and pin the channels that must NOT be shared:
// Agility and Berserker Stance stay melee-only, Intellect and buff_spellcrit
// stay spell-only. The concrete melee values are already pinned elsewhere
// (combat_rating, haste_set_bonus, warrior_stances, spec_masteries), so the
// melee side here asserts composition, not new numbers.
import { describe, expect, it } from 'vitest';
import { SET_CRIT_3PC_RATING, SET_NIGHTTALON } from '../src/sim/content/item_sets';
import { ITEMS } from '../src/sim/data';
import { type PlayerEquipment, recalcPlayerStats } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, ItemDef } from '../src/sim/types';
import { critFractionFromRating } from '../src/sim/types';

function aura(kind: string, value: number, sourceId: number): Aura {
  return {
    id: kind,
    name: kind,
    kind,
    value,
    remaining: 60,
    duration: 60,
    sourceId,
    school: 'arcane',
  } as Aura;
}

function setMembers(setId: string): ItemDef[] {
  // one member per equip slot, so slicing N members yields N equipped pieces
  const bySlot = new Map<string, ItemDef>();
  for (const i of Object.values(ITEMS)) {
    if (i.set === setId && i.slot && !bySlot.has(i.slot)) bySlot.set(i.slot, i);
  }
  return [...bySlot.values()];
}

function equipmentOf(items: ItemDef[]): PlayerEquipment {
  return Object.fromEntries(items.map((i) => [i.slot, i.id])) as PlayerEquipment;
}

describe('spell crit shared core', () => {
  it('gear crit rating raises spell crit by exactly rating/1000', () => {
    // Arrange: a mage wearing a chest with 20 crit rating (20/1000 = 2%).
    const itemId = '__test_spell_crit_chest';
    const item: ItemDef = {
      id: itemId,
      name: 'Spell Crit Test Chest',
      kind: 'armor',
      slot: 'chest',
      armorType: 'cloth',
      sellValue: 0,
      requiredLevel: 1,
      critRating: 20,
    };
    ITEMS[itemId] = item;
    try {
      const sim = new Sim({ seed: 11, playerClass: 'mage' });
      const p = sim.player;
      const before = sim.ctx.spellCrit(p);
      expect(before).toBeCloseTo(0.05 + p.stats.int * 0.0008, 10);

      // Act: equipItem recalcs player stats internally.
      sim.addItem(itemId, 1);
      sim.equipItem(itemId);

      // Assert: the rating lands in the shared core and in spell crit, exactly.
      expect(p.critRating).toBe(20);
      expect(p.sharedCritBonus).toBeCloseTo(critFractionFromRating(20), 10);
      expect(sim.ctx.spellCrit(p)).toBeCloseTo(0.05 + p.stats.int * 0.0008 + 0.02, 10);
      expect(sim.ctx.spellCrit(p)).toBeCloseTo(before + 0.02, 10);
    } finally {
      delete ITEMS[itemId];
    }
  });

  it('spell and melee crit share one core while int stays spell-only and agi melee-only', () => {
    // Arrange: same geared player as the rating case (no stance, no auras).
    const itemId = '__test_spell_crit_chest_shape';
    ITEMS[itemId] = {
      id: itemId,
      name: 'Spell Crit Shape Chest',
      kind: 'armor',
      slot: 'chest',
      armorType: 'cloth',
      sellValue: 0,
      requiredLevel: 1,
      critRating: 20,
    };
    try {
      const sim = new Sim({ seed: 11, playerClass: 'mage' });
      const p = sim.player;

      // Act
      sim.addItem(itemId, 1);
      sim.equipItem(itemId);

      // Assert: both compositions read the SAME core; the stat channels differ.
      // This pins melee as unchanged in shape (agi channel intact, no double
      // count of the shared core, no int leakage into melee).
      expect(sim.ctx.spellCrit(p)).toBeCloseTo(0.05 + p.stats.int * 0.0008 + p.sharedCritBonus, 10);
      expect(p.critChance).toBeCloseTo(0.05 + p.stats.agi * 0.0005 + p.sharedCritBonus, 10);
    } finally {
      delete ITEMS[itemId];
    }
  });

  it('talent crit (stats.crit) raises spell crit by its full value', () => {
    // Arrange
    const sim = new Sim({ seed: 11, playerClass: 'mage' });
    const p = sim.player;
    const meta = sim.players.get(sim.playerId);
    if (!meta) throw new Error('missing player meta');
    const before = sim.ctx.spellCrit(p);

    // Act: inject the talent crit through the mods slot recalcPlayerStats reads
    // (the mastery_mechanism pattern: mutate mods, not the raw entity field).
    meta.talentMods.stats.crit = 0.05;
    recalcPlayerStats(p, meta.cls, meta.equipment, meta.talentMods, meta.equipmentInstance);

    // Assert
    expect(p.sharedCritBonus).toBeCloseTo(0.05, 10);
    expect(sim.ctx.spellCrit(p)).toBeCloseTo(before + 0.05, 10);
  });

  it('the set 3-piece crit rating bonus reaches spell crit through the shared core', () => {
    // Arrange: a rogue with 2 then 3 Nighttalon pieces (the 3pc grants
    // SET_CRIT_3PC_RATING crit rating; the pieces themselves carry no ratings).
    const sim = new Sim({ seed: 11, playerClass: 'rogue' });
    sim.setPlayerLevel(20);
    const p = sim.player;
    const pieces = setMembers(SET_NIGHTTALON);

    recalcPlayerStats(p, 'rogue', equipmentOf(pieces.slice(0, 2)), undefined, {});
    expect(p.sharedCritBonus).toBe(0);
    const twoPiece = sim.ctx.spellCrit(p);

    // Act
    recalcPlayerStats(p, 'rogue', equipmentOf(pieces.slice(0, 3)), undefined, {});

    // Assert: the set rating is the whole core (no mods, no auras), and spell
    // crit moves by exactly the converted rating over the 2-piece baseline.
    expect(p.critRating).toBe(SET_CRIT_3PC_RATING);
    expect(p.sharedCritBonus).toBeCloseTo(critFractionFromRating(p.critRating), 10);
    expect(sim.ctx.spellCrit(p)).toBeCloseTo(
      twoPiece + critFractionFromRating(SET_CRIT_3PC_RATING),
      10,
    );
  });

  it('a flat buff_crit aura raises spell and melee crit by the same amount', () => {
    // Arrange
    const sim = new Sim({ seed: 11, playerClass: 'mage' });
    const p = sim.player;
    const spell0 = sim.ctx.spellCrit(p);
    const melee0 = p.critChance;

    // Act: applyAura recalcs player stats unconditionally.
    sim.ctx.applyAura(p, aura('buff_crit', 0.04, p.id));

    // Assert
    expect(sim.ctx.spellCrit(p)).toBeCloseTo(spell0 + 0.04, 10);
    expect(p.critChance).toBeCloseTo(melee0 + 0.04, 10);
  });

  it('buff_spellcrit stays spell-only and is read live without a recalc', () => {
    // Arrange
    const sim = new Sim({ seed: 11, playerClass: 'mage' });
    const p = sim.player;
    const spell0 = sim.ctx.spellCrit(p);
    const melee0 = p.critChance;
    const core0 = p.sharedCritBonus;

    // Act: push the aura raw (no recalc), the mastery_mechanism pattern;
    // spellCritBonusFromAuras reads it live at roll time.
    p.auras.push(aura('buff_spellcrit', 0.03, p.id));

    // Assert: spell crit moves, the melee chance and the shared core do not.
    expect(sim.ctx.spellCrit(p)).toBeCloseTo(spell0 + 0.03, 10);
    expect(p.critChance).toBe(melee0);
    expect(p.sharedCritBonus).toBe(core0);
  });

  it('berserker stance crit stays melee-only', () => {
    // Arrange
    const sim = new Sim({ seed: 11, playerClass: 'warrior' });
    const p = sim.player;
    const spell0 = sim.ctx.spellCrit(p);

    // Act: the stance fold lives on critChance, outside the shared core (the
    // +3% melee side is already pinned in warrior_stances.test.ts).
    sim.ctx.applyAura(p, aura('berserker_stance', 0, p.id));

    // Assert
    expect(p.sharedCritBonus).toBe(0);
    expect(sim.ctx.spellCrit(p)).toBe(spell0);
  });
});
