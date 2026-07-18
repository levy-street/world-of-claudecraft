import { describe, expect, it } from 'vitest';
import { effectiveSpellHit, spellResistChance } from '../src/sim/combat/spell_resist';
import { aggregateSetBonuses } from '../src/sim/content/item_sets';
import { ITEMS } from '../src/sim/data';
import { itemLevel } from '../src/sim/item_level';
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

  it('effective spell hit is clamped at 1 (over-capping Hit cannot exceed certainty)', () => {
    // spellHitChance(20, 23) is ~0.75; a huge hitBonus would push it past 1 without
    // the Math.min clamp. Equal-level (0.96) also clamps.
    expect(effectiveSpellHit(20, 23, 0.9)).toBe(1);
    expect(effectiveSpellHit(20, 20, 0.5)).toBe(1);
    expect(spellResistChance(20, 23, 0.9)).toBe(0); // and resist floors at 0
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
  const ratingValues = (item: ItemDef): number[] =>
    [item.hitRating, item.critRating, item.hasteRating].filter((r): r is number => (r ?? 0) > 0);
  const ratingCount = (item: ItemDef): number => ratingValues(item).length;

  it('every ilvl-31 heroic boss-set piece carries exactly one rating', async () => {
    const { HEROIC_ITEMS } = await import('../src/sim/content/heroic_loot');
    const pieces = Object.values(HEROIC_ITEMS).filter((item) => itemLevel(item) === 31);
    expect(pieces).toHaveLength(24);
    for (const item of pieces) {
      expect(ratingCount(item), item.id).toBe(1);
      expect(ratingValues(item), item.id).toEqual([item.weapon ? 50 : 40]);
    }
    // Hit is over-represented (the Heroic-defining stat): at least a third of the set.
    const hitPieces = pieces.filter((i) => (i.hitRating ?? 0) > 0).length;
    expect(hitPieces).toBeGreaterThanOrEqual(Math.ceil(pieces.length / 3));
  });

  it('enforces the complete 0 -> 1 -> 2 rating ladder by live item level', async () => {
    const { HEROIC_VENDOR_ITEMS } = await import('../src/sim/content/heroic_vendor');
    const vendorIds = new Set(Object.keys(HEROIC_VENDOR_ITEMS));
    const allGear = Object.values(ITEMS).filter(
      (item) => item.slot && itemLevel(item) !== undefined,
    );

    const ilvl26 = allGear.filter((item) => itemLevel(item) === 26);
    for (const item of ilvl26) {
      if (vendorIds.has(item.id)) {
        expect(ratingValues(item), item.id).toEqual([25]);
      } else {
        expect(ratingCount(item), item.id).toBe(0);
      }
    }
    expect([...vendorIds]).toHaveLength(10);

    for (const item of allGear.filter((gear) => itemLevel(gear) === 28)) {
      expect(ratingCount(item), item.id).toBe(0);
    }

    // The 8 Nythraxis set pieces plus the 4 offhand-slot / two-hander epics
    // (bonewrought_greatsword/bulwark, direfang_greatblade, wraithfire_orb).
    const ilvl29 = allGear.filter((item) => itemLevel(item) === 29);
    expect(ilvl29).toHaveLength(12);
    for (const item of ilvl29) expect(ratingValues(item), item.id).toEqual([20]);

    const directHeroicRaidWeapons = new Set([
      'scepter_of_the_deathless_court',
      'deathless_greatblade',
      'stormcallers_focus',
    ]);
    const heroicRaidGear = allGear.filter((item) => {
      const ilvl = itemLevel(item);
      return (
        (ilvl === 33 && (item.heroicOf !== undefined || directHeroicRaidWeapons.has(item.id))) ||
        (ilvl === 37 && item.heroicOf !== undefined)
      );
    });
    // 13 pre-existing pieces plus the 4 generated heroic raid variants of the
    // new normal-raid epics (greatsword, greatblade, bulwark, orb).
    expect(heroicRaidGear).toHaveLength(17);
    for (const item of heroicRaidGear) {
      const ilvl = itemLevel(item);
      const expectedPrimary = ilvl === 37 ? 70 : item.weapon ? 65 : 55;
      const expectedSecondary = ilvl === 37 ? 30 : 20;
      expect(
        ratingValues(item).sort((a, b) => b - a),
        item.id,
      ).toEqual([expectedPrimary, expectedSecondary]);
    }
  });

  it('a spell-facing raid legendary (Heartwood staff) takes throughput ratings, never Hit', () => {
    // A rating-less caster/healer base must not default to the game's largest Hit
    // allowance: heals are not resisted by level, matching the healer-facing rule.
    const staff = ITEMS['heroic_deathless_heartwood'];
    expect(staff, 'heroic Heartwood variant should be generated').toBeTruthy();
    if (staff) {
      expect(staff.hitRating ?? 0).toBe(0);
      expect(ratingCount(staff)).toBe(2); // haste primary + crit secondary
      expect((staff.hasteRating ?? 0) > 0 && (staff.critRating ?? 0) > 0).toBe(true);
    }
  });
});
