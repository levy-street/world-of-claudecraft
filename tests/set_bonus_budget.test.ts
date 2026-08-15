// The PvE item-set budget harness.
//
// Every ITEM in the game is priced by item_budget.ts: (level, quality, slot)
// becomes an exact primary-stat budget, and the two-hander ceiling, the heroic
// variants and the worn-offhand line are all pinned against it. Set BONUSES were
// never priced by anything. They were authored as absolute numbers, and at a
// level-20 cap those numbers had drifted to level-60 magnitudes: the families
// paid 35 to 70 primary-stat points against an epic chest piece's 18, so the
// invisible bonus was worth more than the four epic items carrying it.
//
// This file is the missing price check, and it is the PvE counterpart to
// tests/warfare_balance_harness.test.ts (which guards the honor tier's
// contributes-zero-in-PvE property the same way). It re-prices what actually
// SHIPS, so a future tuning pass cannot quietly walk the numbers back up.
//
// The pricing conventions, all taken from the engine rather than invented:
//  - a primary attribute (str/agi/sta/int/spi) is worth 1 budget point, which is
//    what primaryStatBudget hands out.
//  - Spell Power converts at SPELL_POWER_PER_INT (0.5 per Intellect), so 1 Spell
//    Power costs 2 budget points.
//  - flat attack power is priced at 1 point per AP, the WORST case: a warrior
//    converts Strength at 2 AP per point but a rogue or hunter converts
//    Strength plus Agility at 1 AP per point, so the same flat grant is worth
//    twice as much to the leather classes. Pricing it at its most generous
//    reading is what makes the guard fail loudly if flat AP is reintroduced.
//  - combat ratings (haste, crit, hit) have NO primary-stat equivalent, so they
//    are not folded into the point total. They are priced separately, against
//    the single largest allocation any real ITEM in the game carries.
//
// The one trap worth recording: measure the set contribution from
// aggregateSetBonuses and subtract it, rather than recomputing a character with
// the bonuses disabled. The tables are module-global, so disabling them means
// mutating shared content mid-suite; subtraction is exact here because
// recalcPlayerStats derives attack power as (str*2 + bonusAp) and spell power as
// (int*0.5 + bonusSp) with no multiplier when mods is undefined.
import { describe, expect, it } from 'vitest';
import {
  aggregateSetBonuses,
  ITEM_SETS,
  SET_BONUS_POINTS_CEILING,
  SET_HASTE_3PC_RATING,
  SET_HASTE_KIT_RATING,
  SET_HIT_4PC_RATING,
} from '../src/sim/content/item_sets';
import { ITEMS } from '../src/sim/data';
import { bestEpicGearFor } from '../src/sim/dev/bis_gear';
import { createPlayer, type PlayerEquipment, recalcPlayerStats } from '../src/sim/entity';
import type { EquipSlot, ItemDef, PlayerClass, SetBonusEffect } from '../src/sim/types';
import { SPELL_POWER_PER_INT } from '../src/sim/types';

// The PvE families. The WARFARE honor sets are deliberately excluded: every tier
// they pay is a WARFARE rating or a pvpOnly effect and never a stat, which is
// exactly the property tests/warfare_balance_harness.test.ts guards.
const PVE_SETS = Object.values(ITEM_SETS).filter((set) => !set.id.startsWith('warfare_'));

/** One tier's cost in primary-stat budget points (see the conventions above). */
function tierPoints(effect: SetBonusEffect): number {
  const primary =
    (effect.str ?? 0) +
    (effect.agi ?? 0) +
    (effect.sta ?? 0) +
    (effect.int ?? 0) +
    (effect.spi ?? 0);
  return primary + (effect.ap ?? 0) + (effect.sp ?? 0) / SPELL_POWER_PER_INT;
}

/** A whole family's bonus line, every tier summed (tiers stack). */
function familyPoints(setId: string): number {
  const set = ITEM_SETS[setId];
  return set.bonuses.reduce((total, tier) => total + tierPoints(tier.effect), 0);
}

/** Base-tier members of a family, one per slot (heroic variants share the slot). */
function slotsOf(setId: string): Map<EquipSlot, string> {
  const bySlot = new Map<EquipSlot, string>();
  for (const item of Object.values(ITEMS)) {
    if (item.set !== setId || !item.slot) continue;
    if (item.id.startsWith('heroic_')) continue;
    if (!bySlot.has(item.slot as EquipSlot)) bySlot.set(item.slot as EquipSlot, item.id);
  }
  return bySlot;
}

/** The largest single-item allocation of a combat rating anywhere in ITEMS. */
function bestItemRating(field: 'hasteRating' | 'critRating' | 'hitRating'): number {
  let best = 0;
  for (const item of Object.values(ITEMS) as ItemDef[]) best = Math.max(best, item[field] ?? 0);
  return best;
}

function levelCapCharacter(cls: PlayerClass, equipment: PlayerEquipment) {
  const e = createPlayer(1, cls, { x: 0, y: 0, z: 0 }, 'budget-probe');
  e.level = 20;
  recalcPlayerStats(e, cls, equipment, undefined, {});
  return e;
}

function setCountsOf(equipment: PlayerEquipment): Map<string, number> {
  const counts = new Map<string, number>();
  for (const itemId of Object.values(equipment)) {
    const setId = itemId ? ITEMS[itemId]?.set : undefined;
    if (setId) counts.set(setId, (counts.get(setId) ?? 0) + 1);
  }
  return counts;
}

/** Fill the /dev bis kit, then force a full family into its slots and a second
 *  family into whatever slots the first one does not claim. This is the realistic
 *  worst case, not a contrivance: the families cover 4 slots each and overlap on
 *  only one, so a character chasing both naturally lands 4 pieces of one and 3 of
 *  the other and collects five bonus tiers. */
function stackedKit(cls: PlayerClass, spec: string, first: string, second: string) {
  const gear = { ...bestEpicGearFor(cls, spec) } as PlayerEquipment;
  const firstSlots = slotsOf(first);
  for (const [slot, id] of firstSlots) gear[slot] = id;
  for (const [slot, id] of slotsOf(second)) if (!firstSlots.has(slot)) gear[slot] = id;
  return gear;
}

describe('item set bonuses stay inside the item budget', () => {
  it('no PvE family pays more than one epic chest piece of budget', () => {
    for (const set of PVE_SETS) {
      const points = familyPoints(set.id);
      expect(
        points,
        `${set.id} pays ${points} primary-stat points; the ceiling is ${SET_BONUS_POINTS_CEILING} (one epic chest piece)`,
      ).toBeLessThanOrEqual(SET_BONUS_POINTS_CEILING);
    }
  });

  // The regression this whole file exists to prevent. A DERIVED grant bypasses
  // the conversion the attribute would have gone through, which is what made both
  // of the old ones unpriceable: flat attack power paid a rogue double what it
  // paid a warrior (1 AP per Agility against 2 AP per Strength), and flat Spell
  // Power cost 2 budget points a pop, so the caster 2-piece alone outweighed two
  // epic chest pieces. Granting the ATTRIBUTE keeps a bonus worth the same to
  // everyone who can wear the armor, and keeps it priceable at all.
  it('no PvE family grants a derived stat instead of the attribute', () => {
    for (const set of PVE_SETS) {
      for (const tier of set.bonuses) {
        expect(
          tier.effect.ap ?? 0,
          `${set.id} ${tier.pieces}pc grants flat attack power; grant Strength or Agility instead`,
        ).toBe(0);
        expect(
          tier.effect.sp ?? 0,
          `${set.id} ${tier.pieces}pc grants flat Spell Power; grant Intellect instead`,
        ).toBe(0);
      }
    }
  });

  // Set bonuses are nearly the whole haste supply: only a handful of heroic
  // epics carry any hasteRating at all, and no BASE-tier set item carries any.
  // So there is no per-slot haste budget line to price the tier against, and it
  // is held against the single largest allocation any one item carries instead.
  it('haste bonuses stay within a few items worth of rating', () => {
    const bestHasteItem = bestItemRating('hasteRating');
    expect(bestHasteItem).toBeGreaterThan(0);
    expect(
      SET_HASTE_3PC_RATING / bestHasteItem,
      `the 3-piece haste bonus is worth ${SET_HASTE_3PC_RATING / bestHasteItem} of the best item haste allocation`,
    ).toBeLessThanOrEqual(2);
  });

  // The leveling kits are assembled from level-1 world drops and starter quest
  // rewards, so they must sit strictly under the raid tier. When they paid the
  // same rating, a level-8 character in three starter greens carried the same
  // haste as a fully raid-geared level-20 one.
  it('the leveling haste kits stay under the raid haste tier', () => {
    expect(SET_HASTE_KIT_RATING).toBeLessThan(SET_HASTE_3PC_RATING);
    for (const set of PVE_SETS) {
      const members = [...slotsOf(set.id).values()].map((id) => ITEMS[id]);
      const isLevelingKit = members.every((item) => item.quality !== 'epic');
      if (!isLevelingKit || members.length === 0) continue;
      for (const tier of set.bonuses) {
        expect(
          tier.effect.hasteRating ?? 0,
          `${set.id} is a leveling kit but pays raid-tier haste`,
        ).toBeLessThanOrEqual(SET_HASTE_KIT_RATING);
      }
    }
  });

  it('the 4-piece Hit bonus stays under one items worth of Hit rating', () => {
    const bestHitItem = bestItemRating('hitRating');
    expect(bestHitItem).toBeGreaterThan(0);
    expect(SET_HIT_4PC_RATING).toBeLessThan(bestHitItem);
  });
});

describe('set bonuses are a garnish on a real level-20 character', () => {
  // Attack power is exactly round(str * 2 + bonusAp) for a warrior with no
  // talent mods, so the set share subtracts out exactly.
  it('a warrior stacking two plate families gains under a quarter of their attack power from bonuses', () => {
    const gear = stackedKit('warrior', 'arms', 'deathlord', 'crownforged');
    const counts = setCountsOf(gear);
    expect(counts.get('deathlord')).toBeGreaterThanOrEqual(3);
    expect(counts.get('crownforged')).toBeGreaterThanOrEqual(3);

    const character = levelCapCharacter('warrior', gear);
    const effect = aggregateSetBonuses(counts);
    const setAp = effect.ap + effect.str * 2;
    const gearAp = character.attackPower - setAp;

    expect(setAp / gearAp).toBeLessThan(0.25);
  });

  it('a rogue stacking two leather families gains under a quarter of their attack power from bonuses', () => {
    const gear = stackedKit('rogue', 'combat', 'wyrmshadow', 'nighttalon');
    const counts = setCountsOf(gear);
    const character = levelCapCharacter('rogue', gear);
    const effect = aggregateSetBonuses(counts);
    // Rogue attack power is str + agi + bonusAp, so Agility converts 1 to 1.
    const setAp = effect.ap + effect.str + effect.agi;
    const gearAp = character.attackPower - setAp;

    expect(setAp / gearAp).toBeLessThan(0.25);
  });

  it('a mage stacking two caster families gains under a third of their spell power from bonuses', () => {
    const gear = stackedKit('mage', 'fire', 'soulflame', 'necromancers');
    const counts = setCountsOf(gear);
    const character = levelCapCharacter('mage', gear);
    const effect = aggregateSetBonuses(counts);
    const setSp = effect.sp + effect.int * SPELL_POWER_PER_INT;
    const gearSp = character.spellPower - setSp;

    // Cloth carries the thinnest stat lines in the game, so the same absolute
    // bonus reads as a larger share here than it does on plate or leather. A
    // third is the band that keeps the tier meaningful without letting the
    // bonus outweigh the items, which at 20 Spell Power it comfortably did.
    expect(setSp / gearSp).toBeLessThan(0.33);
  });

  // The stacking cap, enforced where this repo enforces its other ceilings: at
  // authoring time. A runtime clamp would have to pick a family to clip and
  // would show the player a bonus that silently pays less than its tooltip; a
  // pinned ceiling keeps multi-set stacking working the way it does in the genre
  // while bounding what the combination can ever be worth.
  it('no reachable two-family stack exceeds two epic chest pieces of budget', () => {
    const stackCeiling = SET_BONUS_POINTS_CEILING * 2;
    for (const a of PVE_SETS) {
      for (const b of PVE_SETS) {
        if (a.id >= b.id) continue;
        const slotsA = slotsOf(a.id);
        const slotsB = slotsOf(b.id);
        // Reachable only if the second family has a slot the first does not claim.
        const distinct = [...slotsB.keys()].some((slot) => !slotsA.has(slot));
        if (!distinct) continue;
        const combined = familyPoints(a.id) + familyPoints(b.id);
        expect(
          combined,
          `stacking ${a.id} with ${b.id} pays ${combined} primary-stat points, over the ${stackCeiling} ceiling`,
        ).toBeLessThanOrEqual(stackCeiling);
      }
    }
  });
});
