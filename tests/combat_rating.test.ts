import { describe, expect, it } from 'vitest';
import { effectiveSpellHit, spellResistChance } from '../src/sim/combat/spell_resist';
import { aggregateSetBonuses } from '../src/sim/content/item_sets';
import { ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity, ItemDef } from '../src/sim/types';
import {
  critFractionFromRating,
  hasteFractionFromRating,
  hitFractionFromRating,
  meleeMissChance,
  spellHitChance,
  swingMissChance,
} from '../src/sim/types';

// A minimal entity for the pure hit-table functions: swingMissChance reads only
// level/kind/hostile/ownerId/hitBonus.
function ent(partial: Partial<Entity>): Entity {
  return {
    kind: 'player',
    level: 20,
    hostile: false,
    ownerId: null,
    hitBonus: 0,
    ...partial,
  } as Entity;
}

describe('combat ratings', () => {
  it('converts haste, crit and hit ratings to fractions', () => {
    expect(hasteFractionFromRating(150)).toBe(0.15);
    expect(critFractionFromRating(20)).toBe(0.02);
    expect(hitFractionFromRating(50)).toBe(0.05);
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
      hitRating: 200,
    };
    ITEMS[itemId] = item;
    try {
      const sim = new Sim({ seed: 11, playerClass: 'rogue' });
      const p = sim.player;
      sim.addItem(itemId, 1);
      sim.equipItem(itemId);

      expect(p.hasteRating).toBe(150);
      expect(p.critRating).toBe(20);
      expect(p.hitRating).toBe(200);
      expect(p.meleeHaste).toBe(0.15);
      expect(p.rangedHaste).toBe(0.15);
      expect(p.spellHaste).toBe(0.15);
      expect(p.critChance).toBeCloseTo(0.05 + p.stats.agi * 0.0005 + 0.02);
      expect(p.hitBonus).toBeCloseTo(0.2);
    } finally {
      delete ITEMS[itemId];
    }
  });

  it('hit rating reduces a player melee miss vs a higher-level (Heroic +3) mob', () => {
    const mob = ent({ kind: 'mob', hostile: true, level: 23 });
    // The +3 above-level miss is capped at ~26%; 5% hit claws it to ~21%.
    expect(meleeMissChance(20, 23)).toBeCloseTo(0.26);
    expect(swingMissChance(ent({ hitBonus: 0.05 }), mob)).toBeCloseTo(0.21);
    // Enough hit floors the miss at 0 (hit-capped), never negative.
    expect(swingMissChance(ent({ hitBonus: 0.9 }), mob)).toBe(0);
  });

  it('hit rating reduces spell resist by the same amount', () => {
    // The +3 above-level resist is capped at ~25%; 5% hit claws it to ~20%.
    expect(spellResistChance(20, 23)).toBeCloseTo(0.25);
    expect(spellResistChance(20, 23, 0.05)).toBeCloseTo(0.2);
  });

  it('is a no-op with zero hit, preserving the ungeared draw (parity)', () => {
    // The player-attacker branch equals the raw level-only miss when hitBonus is 0.
    expect(
      swingMissChance(ent({ hitBonus: 0 }), ent({ kind: 'mob', hostile: true, level: 23 })),
    ).toBe(meleeMissChance(20, 23));
    // The spell path passes spellHitChance(...) unchanged to rng.chance when hit is 0.
    expect(effectiveSpellHit(20, 23, 0)).toBe(spellHitChance(20, 23));
  });

  it('hit does not help a mob attacking a player (attacker-side only, capped)', () => {
    // A mob has no hit gear; the player-side target hit never reduces the mob's swing.
    const mob = ent({ kind: 'mob', hostile: true, level: 23 });
    const player = ent({ hitBonus: 0.5 });
    expect(swingMissChance(mob, player)).toBeLessThanOrEqual(0.2); // MOB_VS_PLAYER cap, unchanged
  });

  it('the weak T2 bleed 4-set bonuses now also grant hit rating', () => {
    const crownforged = aggregateSetBonuses(new Map([['crownforged', 4]]));
    const nighttalon = aggregateSetBonuses(new Map([['nighttalon', 4]]));
    expect(crownforged.hitRating).toBe(60);
    expect(nighttalon.hitRating).toBe(60);
  });

  it('the heroic marks jewelry carries one combat rating each', async () => {
    const { HEROIC_VENDOR_ITEMS } = await import('../src/sim/content/heroic_vendor');
    const jewelry = Object.values(HEROIC_VENDOR_ITEMS);
    expect(jewelry.length).toBeGreaterThanOrEqual(10);
    for (const item of jewelry) {
      const ratings = [item.hitRating, item.critRating, item.hasteRating].filter(
        (r) => (r ?? 0) > 0,
      );
      expect(ratings.length, item.id).toBe(1);
    }
  });

  it('PvP honor jewelry keeps its warfare rating (its own differentiator, unchanged)', () => {
    // The honor track's jewelry is differentiated by its PvP warfare rating, not a
    // PvE combat rating; hit/crit/haste are deliberately NOT added there to avoid a
    // same-level PvP balance change.
    const honorJewelry = Object.values(ITEMS).filter(
      (i) => (i.slot === 'ring' || i.slot === 'neck') && (i.pvpOffenseRating ?? 0) > 0,
    );
    expect(honorJewelry.length).toBeGreaterThan(0);
    for (const item of honorJewelry) {
      expect(item.hitRating ?? 0, item.id).toBe(0);
    }
  });
});

// The tier ladder is the fix for "ilvl 31 feels the same as 26/28": ratings, not the
// tiny primary-stat growth, differentiate the tiers. 0 ratings on ilvl-26 dungeon
// epics -> 1 rating on every ilvl-31 heroic piece -> 2 on the ilvl-33/37 raid variants.
describe('combat-rating tier ladder', () => {
  const ratingCount = (item: ItemDef): number =>
    [item.hitRating, item.critRating, item.hasteRating].filter((r) => (r ?? 0) > 0).length;

  it('every ilvl-31 heroic boss-set piece carries exactly one rating', async () => {
    const { HEROIC_ITEMS } = await import('../src/sim/content/heroic_loot');
    const pieces = Object.values(HEROIC_ITEMS);
    expect(pieces.length).toBeGreaterThanOrEqual(27);
    for (const item of pieces) expect(ratingCount(item), item.id).toBe(1);
    // Hit is over-represented (the Heroic-defining stat): at least a third of the set.
    const hitPieces = pieces.filter((i) => (i.hitRating ?? 0) > 0).length;
    expect(hitPieces).toBeGreaterThanOrEqual(Math.ceil(pieces.length / 3));
  });

  it('the ilvl-33 Heroic raid variants carry two ratings (dual-rating tier)', () => {
    const raidVariant = ITEMS['heroic_crownforged_dreadhelm'];
    expect(raidVariant, 'heroic raid variant should be generated').toBeTruthy();
    if (raidVariant) {
      expect(ratingCount(raidVariant)).toBe(2);
      // The primary scales past the ilvl-29 seed (20) to the raid armor allowance.
      const primary = Math.max(
        raidVariant.hitRating ?? 0,
        raidVariant.critRating ?? 0,
        raidVariant.hasteRating ?? 0,
      );
      expect(primary).toBeGreaterThan(20);
    }
  });
});
