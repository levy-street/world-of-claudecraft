import { describe, expect, it } from 'vitest';
import {
  FURY_ENTITY_ID,
  FURY_NPC,
  FURY_STOCK,
  WARFARE_ITEMS,
  WARFARE_JEWELRY_STAT_FRACTION,
  WARFARE_SOURCE_LEVEL,
  WARFARE_STAT_FRACTION,
} from '../src/sim/content/pvp_honor';
import { ITEMS, NPCS } from '../src/sim/data';
import { createPlayer, recalcPlayerStats } from '../src/sim/entity';
import { canEquipItem } from '../src/sim/equipment_rules';
import { weaponDpsBudget } from '../src/sim/item_budget';
import {
  expectedStatBudget,
  itemLevel,
  itemScore,
  itemSourceLevel,
  primaryStatSum,
} from '../src/sim/item_level';
import { LAUNCH_PAPERDOLL_SLOTS } from '../src/sim/launch_paperdoll_slots';
import { pvpFractionsFromRatings } from '../src/sim/pvp';
import type { EquipSlot, PlayerClass } from '../src/sim/types';

/** The item level the whole WARFARE catalog sits at after the retune. */
const WARFARE_ILVL = 31;

const SLOT_PRICES: Record<string, number> = {
  mainhand: 1_200,
  helmet: 900,
  neck: 400,
  shoulder: 700,
  chest: 1_200,
  waist: 450,
  legs: 1_050,
  gloves: 550,
  feet: 550,
  ring: 275,
};

const SUPPORTED_ITEM_SLOTS = [
  'mainhand',
  'helmet',
  'neck',
  'shoulder',
  'chest',
  'waist',
  'legs',
  'gloves',
  'feet',
  'ring',
] as const;

const FURYFORGED = [
  'furyforged_warhelm',
  'furyforged_warspaulders',
  'furyforged_warplate',
  'furyforged_girdle',
  'furyforged_legguards',
  'furyforged_gauntlets',
  'furyforged_sabatons',
] as const;

const STORMBOUND = [
  'stormbound_crown',
  'stormbound_spaulders',
  'stormbound_hauberk',
  'stormbound_waistguard',
  'stormbound_legmail',
  'stormbound_handguards',
  'stormbound_greaves',
] as const;

const ASHSTALKER = [
  'ashstalker_cowl',
  'ashstalker_shoulderguards',
  'ashstalker_harness',
  'ashstalker_waistband',
  'ashstalker_legguards',
  'ashstalker_grips',
  'ashstalker_treads',
] as const;

const CINDERWEAVE = [
  'cinderweave_cowl',
  'cinderweave_mantle',
  'cinderweave_raiment',
  'cinderweave_cord',
  'cinderweave_legwraps',
  'cinderweave_handwraps',
  'cinderweave_slippers',
] as const;

const THORNHIDE = [
  'thornhide_headdress',
  'thornhide_mantle',
  'thornhide_vestment',
  'thornhide_cinch',
  'thornhide_leggings',
  'thornhide_gloves',
  'thornhide_boots',
] as const;

interface Profile {
  name: string;
  classes: readonly PlayerClass[];
  armor: readonly string[];
  neck: string;
  rings: readonly [string, string];
  weapon: string;
}

const PROFILES: readonly Profile[] = [
  {
    name: 'Strength mail',
    classes: ['warrior', 'paladin', 'shaman'],
    armor: FURYFORGED,
    neck: 'final_oath_medallion',
    rings: ['iron_vow_band', 'unbroken_circle'],
    weapon: 'final_argument_greatblade',
  },
  {
    name: 'Agility leather',
    classes: ['rogue', 'hunter', 'druid'],
    armor: ASHSTALKER,
    neck: 'razorwind_torque',
    rings: ['fleetblood_band', 'last_step_signet'],
    weapon: 'first_blood_razor',
  },
  {
    name: 'caster mail',
    classes: ['paladin', 'shaman'],
    armor: STORMBOUND,
    neck: 'cinder_sigil_pendant',
    rings: ['ashen_focus_ring', 'spellbreakers_seal'],
    weapon: 'emberglass_warstaff',
  },
  {
    name: 'caster cloth',
    classes: ['mage', 'priest', 'warlock', 'druid'],
    armor: CINDERWEAVE,
    neck: 'cinder_sigil_pendant',
    rings: ['ashen_focus_ring', 'spellbreakers_seal'],
    weapon: 'emberglass_warstaff',
  },
  // The leather caster family, and the reason this list is worth keeping
  // complete: it was added after the other four and inherited none of their
  // coverage, so the sweeps below said "every family" while measuring four of
  // five. Druid only, because it is the one class whose armor rank is leather
  // and whose stat identity is int/spi.
  {
    name: 'caster leather',
    classes: ['druid'],
    armor: THORNHIDE,
    neck: 'cinder_sigil_pendant',
    rings: ['ashen_focus_ring', 'spellbreakers_seal'],
    weapon: 'emberglass_warstaff',
  },
];

function profileItemIds(profile: Profile): string[] {
  return [profile.weapon, ...profile.armor, profile.neck, ...profile.rings];
}

function equipmentForProfile(profile: Profile): Partial<Record<EquipSlot, string>> {
  return {
    mainhand: profile.weapon,
    helmet: profile.armor[0],
    shoulder: profile.armor[1],
    chest: profile.armor[2],
    waist: profile.armor[3],
    legs: profile.armor[4],
    gloves: profile.armor[5],
    feet: profile.armor[6],
    neck: profile.neck,
    ring1: profile.rings[0],
    ring2: profile.rings[1],
  };
}

describe('FURY WARFARE stock', () => {
  it('merges forty seven unique offers and places FURY in Eastbrook with that exact stock', () => {
    expect(FURY_STOCK).toHaveLength(47);
    expect(new Set(FURY_STOCK).size).toBe(47);
    expect(Object.keys(WARFARE_ITEMS)).toEqual(FURY_STOCK);
    for (const id of FURY_STOCK) expect(ITEMS[id], id).toBe(WARFARE_ITEMS[id]);

    expect(NPCS.fury).toBe(FURY_NPC);
    expect(FURY_ENTITY_ID).toBe(1_000_000_001);
    expect(NPCS.fury.name).toBe('FURY');
    expect(NPCS.fury.title).toBe('Honor Quartermaster');
    expect(NPCS.fury.pos).toEqual({ x: -22.5, z: -7.5 });
    expect(NPCS.fury.facing).toBe(1.171280832795522);
    expect(NPCS.fury.dynamic).toBe(true);
    expect(NPCS.fury.vendorItems).toEqual(FURY_STOCK);
  });

  it('covers every supported item slot with two distinct rings per role profile', () => {
    const slots = new Set(FURY_STOCK.map((id) => ITEMS[id].slot));
    expect([...slots].sort()).toEqual([...SUPPORTED_ITEM_SLOTS].sort());

    const rings = FURY_STOCK.filter((id) => ITEMS[id].slot === 'ring');
    const necks = FURY_STOCK.filter((id) => ITEMS[id].slot === 'neck');
    const weapons = FURY_STOCK.filter((id) => ITEMS[id].slot === 'mainhand');
    expect(rings).toHaveLength(6);
    expect(necks).toHaveLength(3);
    expect(weapons).toHaveLength(3);
    for (const profile of PROFILES) expect(new Set(profile.rings).size, profile.name).toBe(2);
  });
});

describe('FURY WARFARE item budgets', () => {
  it('makes every offer a soulbound, honor-priced item-level-31 epic with full WARFARE', () => {
    for (const id of FURY_STOCK) {
      const item = ITEMS[id];
      const budget = expectedStatBudget(item) ?? 0;
      expect(budget, id).toBeGreaterThan(0);
      expect(item.quality, id).toBe('epic');
      expect(item.requiredLevel, id).toBe(20);
      expect(item.soulbound, id).toBe(true);
      expect(item.sellValue, id).toBe(0);
      expect(item.buyValue, id).toBeUndefined();
      expect(itemSourceLevel(id), id).toBe(WARFARE_SOURCE_LEVEL);
      expect(itemLevel(item), id).toBe(31);
      // WARFARE gear carries a deliberate primary-stat DISCOUNT against a same-slot
      // PvE epic: 90% of the slot budget on armor and weapons, 75% on jewelry. The
      // jewelry fraction is lower on purpose, to keep the badge-jewelry guard below
      // green (a ring at 0.90 would reach 12 points against the badge ring's 11).
      // Armor mitigation and weapon DPS (the slot's inherent baseline) are kept.
      const statFraction =
        item.slot === 'neck' || item.slot === 'ring'
          ? WARFARE_JEWELRY_STAT_FRACTION
          : WARFARE_STAT_FRACTION;
      expect(primaryStatSum(item), id).toBe(Math.round(budget * statFraction));
      // Every piece's WARFARE ratings still mirror its FULL slot budget (drives 18.2%).
      // This pair is deliberately NOT rewritten as a fraction multiplication: the
      // rating fraction is 1.0 and unchanged, so a diff here means it drifted.
      expect(item.pvpOffenseRating, id).toBe(budget);
      expect(item.pvpDefenseRating, id).toBe(budget);
      expect(item.priceHonor, id).toBe(SLOT_PRICES[item.slot ?? '']);
    }
  });

  it('never lets PvP jewelry out-stat ANY other jewelry source in PvE', async () => {
    // Jewelry itemScore excludes WARFARE (and combat ratings), so it measures the
    // PvE-relevant power. Every PvP ring/amulet must score strictly BELOW the
    // weakest competing piece of the same slot: a PvP jewelry piece is never a PvE
    // upgrade.
    //
    // Scope corrected after review. This compared only against HEROIC_VENDOR_ITEMS,
    // the badge vendor, which sits at item level 26. That made the guard read as
    // "never beats the only other jewelry source" when it is not the only one:
    // rift epics such as abysswrought_band are item-level-31 rings carrying more
    // primary stats AND a combat rating. The 0.75 jewelry fraction is calibrated
    // against the badge pieces, so the badge comparison stays the binding one, but
    // a guard that never looked above item level 26 could not see a regression
    // arriving from the tier the WARFARE gear now actually sits in.
    const { HEROIC_VENDOR_ITEMS } = await import('../src/sim/content/heroic_vendor');
    const warfareIds = new Set<string>(FURY_STOCK);
    for (const slot of ['ring', 'neck'] as const) {
      const pvp = FURY_STOCK.map((id) => ITEMS[id]).filter((i) => i.slot === slot);
      const badge = Object.values(HEROIC_VENDOR_ITEMS).filter((i) => i.slot === slot);
      // Every other jewelry piece of this slot AT OR ABOVE the WARFARE tier, not
      // just the badge vendor's. Scoped by item level on purpose: a level-31 epic
      // outscoring some low-level ring is correct and expected, so comparing
      // against the whole catalog would assert something false (abyssal_loop
      // scores 9 against the WARFARE ring's 10). The claim worth guarding is that
      // honor jewelry is never a PvE upgrade over PvE jewelry of its own tier or
      // better, which is where a real regression would come from.
      const rivals = Object.values(ITEMS).filter(
        (i) =>
          i.slot === slot &&
          !warfareIds.has(i.id) &&
          !i.heroicOf &&
          (itemLevel(i) ?? 0) >= WARFARE_ILVL,
      );
      expect(pvp.length, slot).toBeGreaterThan(0);
      expect(badge.length, slot).toBeGreaterThan(0);
      expect(rivals.length, `${slot}: same-or-higher-tier rivals must exist`).toBeGreaterThan(0);
      const bestPvp = Math.max(...pvp.map(itemScore));
      const worstBadge = Math.min(...badge.map(itemScore));
      expect(bestPvp, `${slot}: best PvP ${bestPvp} vs worst badge ${worstBadge}`).toBeLessThan(
        worstBadge,
      );
      // And below every same-or-higher-tier rival, which is the claim that matters.
      for (const rival of rivals) {
        const score = itemScore(rival);
        expect(bestPvp, `${slot}: best PvP ${bestPvp} vs ${rival.id} ${score}`).toBeLessThan(score);
      }
    }
  });

  it('puts all three weapons on the item-level-31 DPS curve', () => {
    const target = weaponDpsBudget(31);
    for (const id of ['final_argument_greatblade', 'first_blood_razor', 'emberglass_warstaff']) {
      const weapon = ITEMS[id].weapon;
      expect(weapon, id).toBeDefined();
      if (!weapon) continue;
      const dps = (weapon.min + weapon.max) / 2 / weapon.speed;
      expect(Math.abs(dps - target), `${id}: ${dps}`).toBeLessThan(0.2);
    }
  });

  it('reaches the 30 percent capstone for EVERY complete family profile', () => {
    // This file owns the five role profiles, so it is the only place the claim is
    // made across all of them: mail Strength, mail caster, leather Agility, cloth
    // caster and leather caster. tests/warfare_gear_tier.test.ts pins the rating arithmetic itself
    // (182 base, 222 at four pieces, 302 clamped to 0.30) against one kit; this
    // asserts no family was left short a piece, a wrong set tag, or a slot gap.
    for (const profile of PROFILES) {
      const player = createPlayer(1, profile.classes[0], { x: 0, y: 0, z: 0 }, profile.name);
      player.level = 20;
      recalcPlayerStats(player, profile.classes[0], equipmentForProfile(profile), undefined, {});
      expect(player.stats.pvpOffense, `${profile.name} offense`).toBeCloseTo(0.3, 10);
      expect(player.stats.pvpDefense, `${profile.name} defense`).toBeCloseTo(0.3, 10);
    }
  });

  it('clamps independently tunable offense and defense rating curves', () => {
    expect(pvpFractionsFromRatings(10_000, 10_000)).toEqual({ offense: 0.3, defense: 0.3 });
    expect(pvpFractionsFromRatings(10_000, 10_000, { offense: 0.07, defense: 0.13 })).toEqual({
      offense: 0.07,
      defense: 0.13,
    });
  });
});

describe('FURY WARFARE class and role coverage', () => {
  it('provides every supported equipment slot to every intended class profile', () => {
    for (const profile of PROFILES) {
      const ids = profileItemIds(profile);
      expect(ids).toHaveLength(LAUNCH_PAPERDOLL_SLOTS.length);

      const concreteSlots = new Set<EquipSlot>();
      for (const id of ids) {
        const slot = ITEMS[id].slot;
        if (slot === 'ring') {
          concreteSlots.add(concreteSlots.has('ring1') ? 'ring2' : 'ring1');
        } else if (slot) {
          concreteSlots.add(slot);
        }
      }
      expect([...concreteSlots].sort(), profile.name).toEqual([...LAUNCH_PAPERDOLL_SLOTS].sort());

      for (const cls of profile.classes) {
        for (const id of ids) {
          expect(canEquipItem(cls, ITEMS[id]), `${profile.name}: ${cls} can equip ${id}`).toBe(
            true,
          );
        }
      }
    }
  });
});
