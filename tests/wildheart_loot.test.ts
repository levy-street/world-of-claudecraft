// The Wildheart Basin rework's loot (docs/design/dungeon-rework/wildheart_basin.md
// section 8; items in src/sim/content/wildheart_items.ts): the promoted Fanglord
// Beastmaster and the Gorgebloom each pay one guaranteed archetype piece on a
// normal kill (the Gorgebloom adds the Falls-Blessed Staff chase row), and one
// equipment item from their own heroic partition on a heroic kill. Every stat
// line is checked against the budget formulas, never a copied literal.
import { describe, expect, it } from 'vitest';
import { FARM_HEROIC_PATTERN_GROUP, HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { heroicVariantId } from '../src/sim/content/heroic_variants';
import { WILDHEART_BASIN_ITEMS } from '../src/sim/content/wildheart_items';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  expectedStatTotal,
  primaryStatBudget,
  statIdentity,
  TWOHAND_DPS_MULT,
  TWOHAND_STAT_MULT,
  weaponDpsBudget,
} from '../src/sim/item_budget';
import { expectedStatBudget, itemLevel, primaryStatSum } from '../src/sim/item_level';
import { rollLoot } from '../src/sim/loot/loot_roll';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import type { ItemDef, LootEntry } from '../src/sim/types';

const HEAVY = ['warrior', 'paladin', 'shaman'];
const AGILE = ['rogue', 'hunter'];
const CASTER = ['mage', 'priest', 'warlock', 'druid'];

const GROUPS = {
  wildheart_beastmaster: {
    group: 'beastmaster_guaranteed',
    ids: ['beastpit_warbelt', 'jaguar_hide_jerkin', 'hexbone_handwraps'],
  },
  the_gorgebloom: {
    group: 'gorgebloom_guaranteed',
    ids: ['rootbound_sabatons', 'pollen_dusted_leggings', 'bloomsilk_cowl'],
  },
} as const;

const gearOf = (entries: readonly LootEntry[]) =>
  entries.filter(
    (entry) => entry.itemId && ITEMS[entry.itemId]?.slot && ITEMS[entry.itemId]?.kind !== 'bag',
  );

describe('Wildheart Basin rework: normal boss tables', () => {
  it.each(Object.entries(GROUPS))(
    '%s drops one guaranteed archetype piece, Heavy 0.34 / Agile 0.33 / Caster 0.33',
    (bossId, { group, ids }) => {
      const loot = MOBS[bossId].loot;
      const rows = loot.filter((entry) => entry.rollGroup === group);
      expect(rows.map((entry) => [entry.itemId, entry.chance])).toEqual([
        [ids[0], 0.34],
        [ids[1], 0.33],
        [ids[2], 0.33],
      ]);
      expect(rows.every((entry) => entry.normalOnly === true)).toBe(true);
      expect(ids.map((id) => ITEMS[id].requiredClass)).toEqual([HEAVY, AGILE, CASTER]);
      expect(loot.some((entry) => entry.copper === 2500 && entry.chance === 1)).toBe(true);
    },
  );

  it('keeps the Beastmaster shipped rows and adds the Falls-Blessed Staff to the Gorgebloom', () => {
    const beast = MOBS.wildheart_beastmaster.loot;
    const row = (loot: readonly LootEntry[], id: string) => loot.find((e) => e.itemId === id);
    expect(row(beast, 'chipped_tusk')?.chance).toBe(1);
    // The two shipped chase rows keep their 0.12; on heroic the boss pays its
    // one equipment item from HEROIC_BOSS_LOOT instead.
    expect(row(beast, 'fanglords_beastspear')).toMatchObject({ chance: 0.12, normalOnly: true });
    expect(row(beast, 'duskwhisper')).toMatchObject({ chance: 0.12, normalOnly: true });
    expect(row(MOBS.the_gorgebloom.loot, 'falls_blessed_staff')).toEqual({
      itemId: 'falls_blessed_staff',
      chance: 0.1,
      normalOnly: true,
    });
  });

  it('pays exactly one archetype piece per normal kill through the real loot roller', () => {
    const sim = new Sim({ seed: 77, playerClass: 'warrior' });
    const meta = sim.ctx.players.get(sim.player.id);
    if (!meta) throw new Error('no player meta');
    sim.rng = new Rng(99);
    for (const [bossId, { ids }] of Object.entries(GROUPS)) {
      const seen = new Set<string>();
      for (let kill = 0; kill < 200; kill++) {
        const template = MOBS[bossId];
        const mob = createMob(-1, template, template.minLevel, { x: 0, y: 0, z: 0 });
        rollLoot(sim.ctx, mob, meta);
        const pieces = (mob.loot?.items ?? []).filter((d) =>
          (ids as readonly string[]).includes(d.itemId),
        );
        expect(pieces, `${bossId} kill ${kill}`).toHaveLength(1);
        seen.add(pieces[0].itemId);
      }
      expect([...seen].sort()).toEqual([...ids].sort());
    }
  });

  it('every normal piece is budget-exact at the boss level plus its quality bump', () => {
    for (const { ids } of Object.values(GROUPS)) {
      for (const id of ids) {
        const item = ITEMS[id];
        expect(item.quality, id).toBe('uncommon');
        expect(itemLevel(item), id).toBe(21);
        const line = primaryStatBudget(21, 'uncommon', item.slot);
        expect(primaryStatSum(item), id).toBe(expectedStatTotal(line, statIdentity(item.stats)));
        expect(primaryStatSum(item), id).toBe(expectedStatBudget(item));
      }
    }
    const staff = ITEMS.falls_blessed_staff;
    expect(staff.quality).toBe('rare');
    expect(itemLevel(staff)).toBe(23);
    expect(expectedStatBudget(staff)).toBe(
      expectedStatTotal(
        Math.round(primaryStatBudget(23, 'rare', 'mainhand') * TWOHAND_STAT_MULT),
        'caster',
      ),
    );
    expect(primaryStatSum(staff)).toBe(expectedStatBudget(staff));
    const w = staff.weapon;
    if (!w) throw new Error('the staff has no weapon line');
    const dps = (w.min + w.max) / 2 / w.speed;
    expect(Math.abs(dps - weaponDpsBudget(23) * TWOHAND_DPS_MULT)).toBeLessThan(0.3);
  });
});

describe('Wildheart Basin rework: heroic partitions', () => {
  const weights = (bossId: string) =>
    gearOf(HEROIC_BOSS_LOOT[bossId]).map((entry) => [entry.itemId, +entry.chance.toFixed(6)]);

  it('pays the design 8.2 table on the Beastmaster and the Gorgebloom', () => {
    // The design's Heroic Duskwhisper 0.20 is shared with the Heroic
    // Fanglord's Beastspear (0.10 each): its base row is normalOnly now, and
    // the Basin page counts both difficulties (heroic_loot.ts).
    expect(weights('wildheart_beastmaster')).toEqual([
      ['fanglords_whistle', 0.25],
      ['fanglords_hide_mantle', 0.3],
      ['heroic_duskwhisper', 0.1],
      ['heroic_fanglords_beastspear', 0.1],
      ['bloodmane_war_legguards', 0.25],
    ]);
    expect(weights('the_gorgebloom')).toEqual([
      ['gorgebloom_seedpod', 0.25],
      ['thornroot_greathelm', 0.3],
      ['sunbone_oracles_crown', 0.25],
      ['heroic_falls_blessed_staff', 0.2],
    ]);
    for (const bossId of ['wildheart_beastmaster', 'the_gorgebloom']) {
      const gear = gearOf(HEROIC_BOSS_LOOT[bossId]);
      expect(new Set(gear.map((entry) => entry.rollGroup)).size).toBe(1);
      expect(gear.reduce((sum, entry) => sum + entry.chance, 0)).toBe(1);
    }
  });

  it('keeps Zulgar renormalized, his mounts and farm patterns unchanged', () => {
    const gear = gearOf(HEROIC_BOSS_LOOT.wildheart_high_priest);
    expect(gear.reduce((sum, entry) => sum + entry.chance, 0)).toBe(1);
    // The shipped weights summed to 3.43; without the two moved epics (0.33
    // each) the rest sum to 2.77 and keep their proportions.
    const chance = (id: string) => gear.find((entry) => entry.itemId === id)?.chance ?? 0;
    expect(chance('basin_stalkers_tunic')).toBeCloseTo(0.34 / 2.77, 9);
    expect(chance('heroic_wildheart_tuskblade')).toBeCloseTo(0.06 / 2.77, 9);
    expect(
      HEROIC_BOSS_LOOT.wildheart_high_priest
        .filter((e) => e.rollGroup === FARM_HEROIC_PATTERN_GROUP)
        .map((e) => [e.itemId, e.chance]),
    ).toEqual([
      ['pattern_highwatch_gourd_soup', 0.04],
      ['pattern_highwatch_barley_porridge', 0.04],
    ]);
    const ungrouped = HEROIC_BOSS_LOOT.wildheart_high_priest.filter((e) => !e.rollGroup);
    expect(ungrouped.map((e) => [e.itemId, e.chance])).toEqual([
      ['reins_grag_bear', 0.001],
      ['reins_stalkglider_snail', 0.001],
    ]);
  });

  it('the two new epics are budget-exact at item level 31 with one 40-point rating', () => {
    const epics: Array<[string, string[], 'critRating' | 'hitRating']> = [
      ['fanglords_hide_mantle', AGILE, 'critRating'],
      ['thornroot_greathelm', HEAVY, 'hitRating'],
    ];
    for (const [id, classes, rating] of epics) {
      const item = ITEMS[id] as ItemDef;
      expect(item.quality, id).toBe('epic');
      expect(itemLevel(item), id).toBe(31);
      expect(primaryStatSum(item), id).toBe(primaryStatBudget(31, 'epic', item.slot));
      expect(item[rating], id).toBe(40);
      const ratings = [item.hitRating, item.critRating, item.hasteRating].filter((r) => r);
      expect(ratings, id).toHaveLength(1);
      expect(item.requiredClass, id).toEqual(classes);
    }
    expect(ITEMS.fanglords_hide_mantle).toMatchObject({ armorType: 'leather', slot: 'shoulder' });
    expect(ITEMS.thornroot_greathelm).toMatchObject({ armorType: 'mail', slot: 'helmet' });
  });

  it('generates the Heroic Falls-Blessed Staff at its preserved rare tier', () => {
    const variant = ITEMS[heroicVariantId('falls_blessed_staff')];
    expect(variant?.heroicOf).toBe('falls_blessed_staff');
    expect(itemLevel(variant)).toBe(25);
    expect(
      HEROIC_BOSS_LOOT.the_gorgebloom.find((e) => e.itemId === 'heroic_falls_blessed_staff')
        ?.preserveSourceTier,
    ).toBe(true);
    // The Heroic Duskwhisper keeps its five-man boss tier, the Heroic
    // Beastspear its shipped generated tier.
    expect(itemLevel(ITEMS.heroic_duskwhisper)).toBe(31);
    expect(itemLevel(ITEMS.heroic_fanglords_beastspear)).toBe(25);
  });

  it('defines every new item in the merged ITEMS table', () => {
    for (const id of Object.keys(WILDHEART_BASIN_ITEMS))
      expect(ITEMS[id]).toBe(WILDHEART_BASIN_ITEMS[id]);
  });
});
