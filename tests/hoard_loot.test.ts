// Buried Hoard boss loot (src/sim/content/hoard_loot.ts): the three tiers land on
// the agreed item levels, every number on a piece is derived from the budget
// formulas and shipped precedent (never hand-picked), each boss pays its own table
// at the tier the map rarity buys, and the payout odds favour the owner of the map.
import { describe, expect, it } from 'vitest';
import {
  HOARD_ARMOR_PER_ILVL,
  HOARD_BASE_ITEM_IDS,
  HOARD_BOSS_LOOT_TABLES,
  HOARD_ITEMS,
  HOARD_LOOT_CLASS_BIAS,
  HOARD_LOOT_TIERS,
  HOARD_PIECES_PER_BOSS,
  HOARD_SHIELD_REFERENCE,
  type HoardLootTier,
  hoardLootItemLevel,
  hoardLootTierForMap,
  hoardLootVariantId,
  rollHoardBossDrop,
} from '../src/sim/content/hoard_loot';
import { RELIQUARY_ITEM_TO_PAGES } from '../src/sim/content/reliquary';
import { RIFT_EPIC_ITEM_IDS } from '../src/sim/content/rift/items';
import { RIFT_MOBS } from '../src/sim/content/rift/mobs';
import {
  TREASURE_MAP_UPGRADE_INKS,
  VAULT_GUEST_GEAR_CHANCE,
  VAULT_PAYOUTS,
} from '../src/sim/content/treasure_maps';
import { CLASSES, ITEMS } from '../src/sim/data';
import { canEquipItem } from '../src/sim/equipment_rules';
import { itemLevel, itemStaminaModel } from '../src/sim/item_level';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { payTreasureVault } from '../src/sim/treasure_vault';
import type { ItemDef, PlayerClass, SimEvent } from '../src/sim/types';

const TIERS: readonly HoardLootTier[] = ['rare', 'epic', 'legendary'];
const RARITIES = ['common', 'rare', 'epic', 'legendary'] as const;
const ALL_CLASSES = Object.keys(CLASSES) as PlayerClass[];
const ratingOf = (item: ItemDef): number =>
  (item.hitRating ?? 0) + (item.critRating ?? 0) + (item.hasteRating ?? 0);
const tierOf = (item: ItemDef): HoardLootTier =>
  item.id.startsWith('rare_') ? 'rare' : item.id.startsWith('legendary_') ? 'legendary' : 'epic';
const primarySum = (item: ItemDef): number =>
  Object.entries(item.stats ?? {}).reduce((n, [k, v]) => (k === 'armor' ? n : n + (v ?? 0)), 0);

describe('the three tiers', () => {
  it('land on item level 28, 31 and 33, the top one still an epic below the raids', () => {
    expect(TIERS.map(hoardLootItemLevel)).toEqual([28, 31, 33]);
    expect(TIERS.map((tier) => HOARD_LOOT_TIERS[tier].quality)).toEqual(['rare', 'epic', 'epic']);
    for (const base of HOARD_BASE_ITEM_IDS) {
      for (const tier of TIERS) {
        const item = ITEMS[hoardLootVariantId(base, tier)];
        expect(item, `${tier} ${base} is merged into ITEMS`).toBeDefined();
        expect(itemLevel(item), item.id).toBe(hoardLootItemLevel(tier));
        expect(item.quality, item.id).toBe(HOARD_LOOT_TIERS[tier].quality);
      }
    }
    // Above every rift epic (the best gear outside a raid), below the first raid tier.
    for (const id of RIFT_EPIC_ITEM_IDS) expect(itemLevel(ITEMS[id]), id).toBeLessThan(33);
  });

  it('a map buys its own tier, and a common map rolls the rare one', () => {
    expect(RARITIES.map(hoardLootTierForMap)).toEqual(['rare', 'rare', 'epic', 'legendary']);
  });

  it('every tier of a piece reads as its own item, by id and by name', () => {
    expect(HOARD_BASE_ITEM_IDS).toHaveLength(32);
    expect(Object.keys(HOARD_ITEMS)).toHaveLength(HOARD_BASE_ITEM_IDS.length * TIERS.length);
    const names = Object.values(HOARD_ITEMS).map((item) => item.name);
    expect(new Set(names).size).toBe(names.length);
    const everyOtherName = new Set(
      Object.values(ITEMS)
        .filter((item) => !Object.hasOwn(HOARD_ITEMS, item.id))
        .map((item) => item.name),
    );
    for (const name of names) expect(everyOtherName.has(name), name).toBe(false);
    for (const base of HOARD_BASE_ITEM_IDS) {
      const name = ITEMS[base].name;
      expect(ITEMS[hoardLootVariantId(base, 'rare')].name).toBe(`Tarnished ${name}`);
      expect(ITEMS[hoardLootVariantId(base, 'legendary')].name).toBe(`Sovereign ${name}`);
    }
  });
});

describe('every number on a piece is derived, never hand-picked', () => {
  it('primary stats sit exactly on the stamina-model line for the item level', () => {
    for (const item of Object.values(HOARD_ITEMS)) {
      const model = itemStaminaModel(ITEMS[item.id]);
      expect(model, item.id).toBeDefined();
      expect(model?.onLine, `${item.id} on the line`).toBe(true);
      expect(model?.meetsFloor, `${item.id} meets the stamina floor`).toBe(true);
    }
  });

  it('a higher tier never carries less of any stat than the tier below it', () => {
    for (const base of HOARD_BASE_ITEM_IDS) {
      const [rare, epic, legendary] = TIERS.map((tier) => ITEMS[hoardLootVariantId(base, tier)]);
      for (const [lower, higher] of [
        [rare, epic],
        [epic, legendary],
      ]) {
        for (const [stat, value] of Object.entries(lower.stats ?? {})) {
          const above = (higher.stats as Record<string, number>)[stat] ?? 0;
          expect(above, `${higher.id} ${stat}`).toBeGreaterThanOrEqual(value as number);
        }
        expect(ratingOf(higher), higher.id).toBeGreaterThanOrEqual(ratingOf(lower));
        expect(primarySum(higher) + ratingOf(higher), higher.id).toBeGreaterThan(
          primarySum(lower) + ratingOf(lower),
        );
      }
    }
  });

  it('ratings follow the shipped allowance at each item level: one rating, never two', () => {
    expect(HOARD_LOOT_TIERS.rare).toMatchObject({
      armorRating: 0,
      jewelryRating: 0,
      offhandRating: 0,
    });
    expect(HOARD_LOOT_TIERS.epic).toMatchObject({
      armorRating: 20,
      jewelryRating: 20,
      offhandRating: 20,
    });
    expect(HOARD_LOOT_TIERS.legendary).toMatchObject({
      armorRating: 40,
      jewelryRating: 25,
      offhandRating: 20,
    });
    for (const item of Object.values(HOARD_ITEMS)) {
      const spec = HOARD_LOOT_TIERS[tierOf(item)];
      const jewelry = item.slot === 'neck' || item.slot === 'ring';
      const expected = jewelry
        ? spec.jewelryRating
        : item.slot === 'offhand'
          ? spec.offhandRating
          : spec.armorRating;
      expect(ratingOf(item), item.id).toBe(expected);
      const carried = [item.hitRating, item.critRating, item.hasteRating].filter(Boolean);
      expect(carried.length, `${item.id} carries at most one rating`).toBeLessThanOrEqual(1);
    }
  });

  it('armour sits on the shipped curve for its class and slot, and none is invented', () => {
    let shields = 0;
    for (const item of Object.values(HOARD_ITEMS)) {
      const level = itemLevel(ITEMS[item.id]) as number;
      const armor = item.stats?.armor;
      const shield = item as { shield?: true; blockValue?: number };
      if (shield.shield) {
        shields++;
        const scale = Math.min(1, level / HOARD_SHIELD_REFERENCE.itemLevel);
        expect(armor, item.id).toBe(Math.round(HOARD_SHIELD_REFERENCE.armor * scale));
        expect(shield.blockValue, item.id).toBe(Math.round(HOARD_SHIELD_REFERENCE.block * scale));
        // Never past the shipped reference, whatever the item level.
        expect(armor).toBeLessThanOrEqual(HOARD_SHIELD_REFERENCE.armor);
      } else if (item.kind === 'armor' && item.armorType) {
        const perLevel = HOARD_ARMOR_PER_ILVL[item.armorType][item.slot as 'chest'];
        expect(perLevel, `${item.id} has a curve`).toBeGreaterThan(0);
        expect(armor, item.id).toBe(Math.round((perLevel as number) * level));
      } else {
        expect(armor, `${item.id} is jewellery or a held off hand: no armour`).toBeUndefined();
      }
    }
    expect(shields).toBe(2 * TIERS.length);
    expect(HOARD_SHIELD_REFERENCE).toEqual({ itemLevel: 29, armor: 680, block: 30 });
  });

  it('the armour curve is the live median of shipped gear, not a number that can rot', () => {
    const samples = new Map<string, number[]>();
    for (const item of Object.values(ITEMS)) {
      if (Object.hasOwn(HOARD_ITEMS, item.id)) continue;
      if (item.kind !== 'armor' || !item.armorType || (item as { shield?: true }).shield) continue;
      const level = itemLevel(item);
      const armor = item.stats?.armor;
      if (level === undefined || level < 24 || level > 36 || !armor || !item.slot) continue;
      const key = `${item.armorType}:${item.slot}`;
      samples.set(key, [...(samples.get(key) ?? []), armor / level]);
    }
    const median = (values: number[]): number => {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = sorted.length >> 1;
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };
    let checked = 0;
    for (const [armorType, slots] of Object.entries(HOARD_ARMOR_PER_ILVL)) {
      for (const [slot, perLevel] of Object.entries(slots)) {
        const shipped = samples.get(`${armorType}:${slot}`) ?? [];
        expect(shipped.length, `${armorType} ${slot} has shipped precedent`).toBeGreaterThan(2);
        expect(Math.abs(median(shipped) - perLevel), `${armorType} ${slot}`).toBeLessThan(0.08);
        checked++;
      }
    }
    expect(checked).toBe(21);
  });

  it('is all tradable gear a level-20 character wears: no weapons, nothing bound', () => {
    for (const item of Object.values(HOARD_ITEMS)) {
      expect(['armor', 'held_offhand'], item.id).toContain(item.kind);
      expect(item.requiredLevel, item.id).toBe(20);
      const flags = item as { soulbound?: boolean; bindOnPickup?: boolean; questItem?: boolean };
      expect(flags.soulbound ?? flags.bindOnPickup ?? flags.questItem, item.id).toBeUndefined();
      expect(item.sellValue, item.id).toBeGreaterThan(0);
    }
  });
});

describe('the boss tables', () => {
  it('each of the eight hoard bosses has four pieces in four slots, each piece one boss', () => {
    const bosses = Object.keys(HOARD_BOSS_LOOT_TABLES);
    expect(bosses).toHaveLength(8);
    for (const boss of bosses) {
      expect(RIFT_MOBS[boss]?.boss, `${boss} is a real rift boss`).toBeTruthy();
      expect(HOARD_BOSS_LOOT_TABLES[boss]).toHaveLength(HOARD_PIECES_PER_BOSS);
      const slots = HOARD_BOSS_LOOT_TABLES[boss].map((id) => `${ITEMS[id].slot}:${ITEMS[id].kind}`);
      expect(new Set(slots).size, boss).toBe(HOARD_PIECES_PER_BOSS);
    }
    const listed = Object.values(HOARD_BOSS_LOOT_TABLES).flat();
    expect([...listed].sort()).toEqual([...HOARD_BASE_ITEM_IDS].sort());
  });

  it('across the eight bosses every class has pieces aimed at it', () => {
    for (const cls of ALL_CLASSES) {
      const aimed = HOARD_BASE_ITEM_IDS.filter((id) => ITEMS[id].requiredClass?.includes(cls));
      expect(aimed.length, cls).toBeGreaterThanOrEqual(4);
    }
  });

  it('a class list never names a class that cannot wear the piece', () => {
    for (const item of Object.values(HOARD_ITEMS)) {
      for (const cls of item.requiredClass ?? []) {
        expect(canEquipItem(cls, ITEMS[item.id]), `${cls} wears ${item.id}`).toBe(true);
      }
    }
  });
});

describe('rollHoardBossDrop', () => {
  it('pays the fallen boss its own table, at the tier the map buys', () => {
    const rng = new Rng(7);
    for (const [boss, table] of Object.entries(HOARD_BOSS_LOOT_TABLES)) {
      for (const rarity of RARITIES) {
        const tier = hoardLootTierForMap(rarity);
        const allowed = table.map((base) => hoardLootVariantId(base, tier));
        const seen = new Set<string>();
        for (let roll = 0; roll < 80; roll++) {
          const id = rollHoardBossDrop(rng, boss, rarity, 'mage');
          expect(allowed).toContain(id);
          seen.add(id);
        }
        // The class lean never shuts a piece out: the whole table stays reachable.
        expect(seen.size, `${boss} ${rarity}`).toBe(HOARD_PIECES_PER_BOSS);
      }
    }
  });

  it('leans toward the class of the looter by the published share', () => {
    const rng = new Rng(11);
    const table = HOARD_BOSS_LOOT_TABLES.rift_boss_frost;
    const aimed = (id: string) => ITEMS[id].requiredClass?.includes('warrior') ?? true;
    expect(table.some(aimed)).toBe(true);
    expect(table.every(aimed)).toBe(false);
    let usable = 0;
    const rolls = 4000;
    for (let roll = 0; roll < rolls; roll++) {
      if (aimed(rollHoardBossDrop(rng, 'rift_boss_frost', 'epic', 'warrior'))) usable++;
    }
    const share = table.filter(aimed).length / table.length;
    const expected = HOARD_LOOT_CLASS_BIAS + (1 - HOARD_LOOT_CLASS_BIAS) * share;
    expect(HOARD_LOOT_CLASS_BIAS).toBe(0.7);
    expect(usable / rolls).toBeGreaterThan(expected - 0.04);
    expect(usable / rolls).toBeLessThan(expected + 0.04);
  });

  it('spends the same rng draws whatever the class, and an unknown boss still pays', () => {
    const after = (['warrior', 'mage', undefined] as const).map((cls) => {
      const rng = new Rng(99);
      for (let roll = 0; roll < 25; roll++) rollHoardBossDrop(rng, 'rift_boss_storm', 'rare', cls);
      return rng.int(0, 1_000_000);
    });
    expect(new Set(after).size).toBe(1);
    for (const boss of ['rift_boss_not_a_thing', undefined]) {
      expect(HOARD_BASE_ITEM_IDS).toContain(rollHoardBossDrop(new Rng(3), boss, 'epic', 'rogue'));
    }
  });
});

describe('the payout', () => {
  it('publishes the agreed odds: owner 10, 30, 50 and 100 percent, guests well below', () => {
    expect(RARITIES.map((rarity) => VAULT_PAYOUTS[rarity].gearChance)).toEqual([0.1, 0.3, 0.5, 1]);
    expect(VAULT_GUEST_GEAR_CHANCE).toEqual({ common: 0.05, rare: 0.1, epic: 0.2, legendary: 0.4 });
    // The legendary redraw is the steep one: it buys a guaranteed ilvl-32 piece.
    expect(TREASURE_MAP_UPGRADE_INKS).toEqual({ common: 1, rare: 3, epic: 15, legendary: 0 });
  });

  function lootedGear(evs: readonly SimEvent[]): string[] {
    return evs
      .flatMap((ev) => (ev.type === 'treasureVaultLooted' ? (ev.itemIds ?? []) : []))
      .filter((id) => Object.hasOwn(HOARD_ITEMS, id));
  }

  it('a legendary hoard always hands its owner a sovereign piece off the fallen boss', () => {
    const table = HOARD_BOSS_LOOT_TABLES.rift_boss_arcane.map((id) =>
      hoardLootVariantId(id, 'legendary'),
    );
    // ONE sim, many payouts: a Sim is expensive to build and the odds are the point.
    const sim = new Sim({ seed: 7, playerClass: 'mage', autoEquip: false });
    const seen = new Set<string>();
    for (let run = 0; run < 60; run++) {
      sim.drainEvents();
      const vault = {
        rarity: 'legendary',
        ownerPid: sim.playerId,
        headCount: 1,
        level: 20,
      } as const;
      payTreasureVault(sim.ctx, vault, [sim.playerId], 'rift_boss_arcane');
      const gear = lootedGear(sim.drainEvents());
      expect(gear, `run ${run}`).toHaveLength(1);
      expect(table).toContain(gear[0]);
      expect(itemLevel(ITEMS[gear[0]])).toBe(33);
      expect(ITEMS[gear[0]].name.startsWith('Sovereign ')).toBe(true);
      seen.add(gear[0]);
    }
    expect(seen.size).toBe(table.length);
    expect(sim.countItem([...seen][0])).toBeGreaterThan(0);
  });

  it('a common hoard pays its owner a tarnished piece about one time in ten', () => {
    let paid = 0;
    const runs = 400;
    const sim = new Sim({ seed: 2024, playerClass: 'rogue', autoEquip: false });
    for (let run = 0; run < runs; run++) {
      sim.drainEvents();
      const vault = { rarity: 'common', ownerPid: sim.playerId, headCount: 1, level: 20 } as const;
      payTreasureVault(sim.ctx, vault, [sim.playerId], 'rift_boss_venom');
      const gear = lootedGear(sim.drainEvents());
      for (const id of gear) {
        expect(ITEMS[id].quality, id).toBe('rare');
        expect(itemLevel(ITEMS[id]), id).toBe(28);
      }
      paid += gear.length;
    }
    expect(paid / runs).toBeGreaterThan(0.05);
    expect(paid / runs).toBeLessThan(0.16);
  });
});

describe('the Reliquary slot', () => {
  it('any tier of a piece discovers the piece, so any tier fills its slot', () => {
    for (const base of HOARD_BASE_ITEM_IDS) {
      expect(ITEMS[base].relicOf, base).toBeUndefined();
      expect(ITEMS[hoardLootVariantId(base, 'rare')].relicOf).toBe(base);
      expect(ITEMS[hoardLootVariantId(base, 'legendary')].relicOf).toBe(base);
      expect(RELIQUARY_ITEM_TO_PAGES.get(base), base).toEqual(['conquerors_buried_hoards']);
      // One slot per piece: the tiers are never catalogued on their own.
      expect(RELIQUARY_ITEM_TO_PAGES.has(hoardLootVariantId(base, 'rare'))).toBe(false);
      expect(RELIQUARY_ITEM_TO_PAGES.has(hoardLootVariantId(base, 'legendary'))).toBe(false);
    }
    const sim = new Sim({ seed: 5, playerClass: 'warrior', autoEquip: false });
    const found = sim.players.get(sim.playerId)?.deedStats.itemsDiscovered;
    if (!found) throw new Error('missing discovery ledger');
    sim.addItem('legendary_permafrost_legguards', 1);
    expect(found.has('legendary_permafrost_legguards')).toBe(true);
    expect(found.has('permafrost_legguards')).toBe(true);
    expect(found.has('rare_permafrost_legguards')).toBe(false);
  });

  it('a Tarnished piece is a rare find: it never claims the epic its piece is', () => {
    const sim = new Sim({ seed: 6, playerClass: 'warrior', autoEquip: false });
    const stats = sim.players.get(sim.playerId)?.deedStats;
    if (!stats) throw new Error('missing deed stats');
    expect(stats.visited.has('quality:epic')).toBe(false);
    sim.addItem('rare_permafrost_legguards', 1);
    expect(stats.itemsDiscovered.has('permafrost_legguards')).toBe(true);
    expect(stats.visited.has('quality:rare')).toBe(true);
    expect(stats.visited.has('quality:epic')).toBe(false);
    // The plain tier is an epic and says so.
    sim.addItem('permafrost_legguards', 1);
    expect(stats.visited.has('quality:epic')).toBe(true);
  });
});
