import { describe, expect, it } from 'vitest';
import {
  FURY_NPC,
  FURY_STOCK,
  WARFARE_ITEMS,
  WARFARE_SOURCE_LEVEL,
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
import { pvpFractionsFromRatings } from '../src/sim/pvp';
import { EQUIP_SLOTS, type EquipSlot, type PlayerClass } from '../src/sim/types';

const SLOT_PRICES: Record<string, number> = {
  mainhand: 800,
  helmet: 500,
  neck: 225,
  shoulder: 400,
  chest: 700,
  waist: 250,
  legs: 600,
  gloves: 300,
  feet: 300,
  ring: 150,
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
  it('merges forty unique offers and places FURY in Eastbrook with that exact stock', () => {
    expect(FURY_STOCK).toHaveLength(40);
    expect(new Set(FURY_STOCK).size).toBe(40);
    expect(Object.keys(WARFARE_ITEMS)).toEqual(FURY_STOCK);
    for (const id of FURY_STOCK) expect(ITEMS[id], id).toBe(WARFARE_ITEMS[id]);

    expect(NPCS.fury).toBe(FURY_NPC);
    expect(NPCS.fury.name).toBe('FURY');
    expect(NPCS.fury.title).toBe('Honor Quartermaster');
    expect(NPCS.fury.pos).toEqual({ x: -11, z: 1 });
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
  it('makes every offer a soulbound, honor-priced item-level-28 epic with full WARFARE', () => {
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
      expect(itemLevel(item), id).toBe(28);
      // WARFARE gear weights its stat budget toward warfare: primary stats are 60%
      // of the slot budget (the rest is expressed as the full WARFARE rating), so a
      // PvP piece is a PvP-first, stat-light kit that never out-stats same-tier PvE
      // gear. Armor mitigation and weapon DPS (the slot's inherent baseline) are kept.
      expect(primaryStatSum(item), id).toBe(Math.round(budget * 0.6));
      // Every piece's WARFARE ratings still mirror its FULL slot budget (drives 16.8%).
      expect(item.pvpOffenseRating, id).toBe(budget);
      expect(item.pvpDefenseRating, id).toBe(budget);
      expect(item.priceHonor, id).toBe(SLOT_PRICES[item.slot ?? '']);
    }
  });

  it('never lets PvP jewelry out-stat the PvE badge (heroic marks) jewelry in PvE', async () => {
    // Jewelry itemScore excludes WARFARE (and combat ratings), so it measures the
    // PvE-relevant power. Every PvP ring/amulet must score strictly BELOW the
    // weakest PvE badge piece of the same slot: a PvP jewelry piece is never a PvE
    // upgrade over the badge vendor's gear.
    const { HEROIC_VENDOR_ITEMS } = await import('../src/sim/content/heroic_vendor');
    for (const slot of ['ring', 'neck'] as const) {
      const pvp = FURY_STOCK.map((id) => ITEMS[id]).filter((i) => i.slot === slot);
      const badge = Object.values(HEROIC_VENDOR_ITEMS).filter((i) => i.slot === slot);
      expect(pvp.length, slot).toBeGreaterThan(0);
      expect(badge.length, slot).toBeGreaterThan(0);
      const bestPvp = Math.max(...pvp.map(itemScore));
      const worstBadge = Math.min(...badge.map(itemScore));
      expect(bestPvp, `${slot}: best PvP ${bestPvp} vs worst badge ${worstBadge}`).toBeLessThan(
        worstBadge,
      );
    }
  });

  it('puts all three weapons on the item-level-28 DPS curve', () => {
    const target = weaponDpsBudget(28);
    for (const id of ['final_argument_greatblade', 'first_blood_razor', 'emberglass_warstaff']) {
      const weapon = ITEMS[id].weapon;
      expect(weapon, id).toBeDefined();
      if (!weapon) continue;
      const dps = (weapon.min + weapon.max) / 2 / weapon.speed;
      expect(Math.abs(dps - target), `${id}: ${dps}`).toBeLessThan(0.2);
    }
  });

  it('derives 16.8 percent offense and defense by equipping a complete profile', () => {
    for (const profile of PROFILES) {
      const player = createPlayer(1, profile.classes[0], { x: 0, y: 0, z: 0 }, profile.name);
      player.level = 20;
      recalcPlayerStats(player, profile.classes[0], equipmentForProfile(profile), undefined, {});
      expect(player.stats.pvpOffense, `${profile.name} offense`).toBeCloseTo(0.168, 10);
      expect(player.stats.pvpDefense, `${profile.name} defense`).toBeCloseTo(0.168, 10);
    }
  });

  it('clamps independently tunable offense and defense rating curves', () => {
    expect(pvpFractionsFromRatings(10_000, 10_000)).toEqual({ offense: 0.2, defense: 0.2 });
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
      expect(ids).toHaveLength(EQUIP_SLOTS.length);

      const concreteSlots = new Set<EquipSlot>();
      for (const id of ids) {
        const slot = ITEMS[id].slot;
        if (slot === 'ring') {
          concreteSlots.add(concreteSlots.has('ring1') ? 'ring2' : 'ring1');
        } else if (slot) {
          concreteSlots.add(slot);
        }
      }
      expect([...concreteSlots].sort(), profile.name).toEqual([...EQUIP_SLOTS].sort());

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
