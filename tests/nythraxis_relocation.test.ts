// The Nythraxis loot relocation (2026-10-08): the raid's table was too long, so
// its nineteen low-weight pieces dropped near 1% each. They moved to the
// dungeons (content/nythraxis_loot.ts NYTHRAXIS_RELOCATED_ITEM_IDS): each Normal
// copy to one Gravewyrm Sanctum or Wildheart Basin boss's bonus roll, each
// Heroic copy to that same boss's heroic roll and, for thirteen of them, also
// to one Hollow Crypt, Sunken Bastion or Drowned Temple heroic boss. The four
// heroic raid trinkets moved to heroic five-man bosses. Every moved piece keeps
// the raid tier it shipped at, so no owned copy changes.
import { describe, expect, it } from 'vitest';
import { HEROIC_BOSS_LOOT, NYTHRAXIS_RAID_BOSS_ID } from '../src/sim/content/heroic_loot';
import {
  NYTHRAXIS_RELOCATED_ITEM_IDS,
  NYTHRAXIS_RELOCATED_TRINKET_IDS,
} from '../src/sim/content/nythraxis_loot';
import { ITEMS, MOBS } from '../src/sim/data';
import { itemFromHeroicRaid, itemLevel } from '../src/sim/item_level';
import type { LootEntry } from '../src/sim/types';
import { weeklyBossLootPool } from '../src/sim/weekly_reward_tables';
import { weeklyLootPool } from '../src/sim/weekly_rewards';

const SANCTUM = ['korgath_the_bound', 'grand_necromancer_velkhar', 'korzul_the_gravewyrm'];
const BASIN = ['wildheart_beastmaster', 'the_gorgebloom', 'wildheart_high_priest'];
const HOME_BOSSES = [...SANCTUM, ...BASIN];

const isGear = (id: string | undefined): id is string => {
  const item = id ? ITEMS[id] : undefined;
  return !!item?.slot && item.kind !== 'bag';
};
const rowsFor = (table: Record<string, LootEntry[]>, itemId: string) =>
  Object.entries(table).flatMap(([bossId, rows]) =>
    rows.filter((row) => row.itemId === itemId).map((row) => ({ bossId, row })),
  );
const normalRows = (itemId: string) =>
  Object.values(MOBS).flatMap((mob) =>
    (mob.loot ?? []).filter((row) => row.itemId === itemId).map((row) => ({ bossId: mob.id, row })),
  );

describe('Nythraxis keeps a short table', () => {
  it('pays two legendaries and nine pieces, none of the relocated nineteen', () => {
    const loot = MOBS[NYTHRAXIS_RAID_BOSS_ID].loot;
    const gear = [...new Set(loot.map((row) => row.itemId).filter(isGear))].sort();
    expect(gear).toHaveLength(11);
    expect(gear.filter((id) => ITEMS[id].quality === 'legendary')).toEqual([
      'deathless_heartwood',
      'kingsbane_last_oath',
    ]);
    for (const id of ['deathless_heartwood', 'kingsbane_last_oath']) {
      expect(loot.find((row) => row.itemId === id)?.chance, id).toBe(0.03);
    }
    for (const id of NYTHRAXIS_RELOCATED_ITEM_IDS) expect(gear, id).not.toContain(id);
  });

  it('heroic Nythraxis pays only its three bespoke weapons from its own table', () => {
    const gear = HEROIC_BOSS_LOOT[NYTHRAXIS_RAID_BOSS_ID].filter((row) => isGear(row.itemId));
    expect(gear.map((row) => [row.itemId, row.chance])).toEqual([
      ['deathless_greatblade', 0.34],
      ['scepter_of_the_deathless_court', 0.34],
      ['stormcallers_focus', 0.32],
    ]);
    expect(gear.every((row) => row.rollGroup === 'nythraxis_heroic_weapon')).toBe(true);
  });
});

describe('each relocated raid piece has one home boss', () => {
  it.each(NYTHRAXIS_RELOCATED_ITEM_IDS)('%s drops on Normal from one home bonus roll', (id) => {
    const rows = normalRows(id);
    expect(rows.map((r) => r.bossId)).toHaveLength(1);
    const [{ bossId, row }] = rows;
    expect(HOME_BOSSES).toContain(bossId);
    expect(row).toMatchObject({ chance: 0.04, normalOnly: true });
    expect(row.rollGroup, `${id} rides the boss's one bonus roll`).toBeTruthy();
    // The bonus roll never pays more than one item per kill.
    const group = MOBS[bossId].loot.filter((r) => r.rollGroup === row.rollGroup);
    expect(group.reduce((sum, r) => sum + r.chance, 0)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it.each(NYTHRAXIS_RELOCATED_ITEM_IDS)(
    '%s drops its Heroic copy at home and at most once more',
    (id) => {
      const [{ bossId: home }] = normalRows(id);
      const heroic = rowsFor(HEROIC_BOSS_LOOT, `heroic_${id}`);
      const atHome = heroic.filter((h) => h.bossId === home);
      const away = heroic.filter((h) => h.bossId !== home);
      expect(atHome, `${id} heroic copy on its home boss`).toHaveLength(1);
      expect(away.length).toBeLessThanOrEqual(1);
      // A piece with a second heroic boss takes the small home share; one without
      // takes the full share at home.
      expect(atHome[0].row.chance).toBeCloseTo(away.length ? 0.04 : 0.1, 9);
      for (const h of away) {
        expect([...SANCTUM, ...BASIN, NYTHRAXIS_RAID_BOSS_ID]).not.toContain(h.bossId);
        expect(h.row.chance).toBeCloseTo(0.1, 9);
      }
    },
  );

  it('spreads thirteen Heroic copies over the twelve Crypt, Bastion and Temple bosses', () => {
    const away = NYTHRAXIS_RELOCATED_ITEM_IDS.flatMap((id) => {
      const [{ bossId: home }] = normalRows(id);
      return rowsFor(HEROIC_BOSS_LOOT, `heroic_${id}`).filter((h) => h.bossId !== home);
    });
    expect(away).toHaveLength(13);
    expect(new Set(away.map((h) => h.bossId)).size).toBe(12);
  });
});

describe('the relocated raid trinkets', () => {
  const HOMES: Record<(typeof NYTHRAXIS_RELOCATED_TRINKET_IDS)[number], string> = {
    mooring_stone: 'gaoler_ossick',
    echoing_lens: 'tideglass_colossus',
    hunters_tally: 'wildheart_beastmaster',
    wellspring_seed: 'the_gorgebloom',
  };
  it.each(NYTHRAXIS_RELOCATED_TRINKET_IDS)('%s drops from its one heroic five-man boss', (id) => {
    const rows = rowsFor(HEROIC_BOSS_LOOT, id);
    expect(rows.map((r) => r.bossId)).toEqual([HOMES[id]]);
    expect(rows[0].row.chance).toBeCloseTo(0.1, 9);
    expect(normalRows(id)).toEqual([]);
  });
});

describe('every moved piece keeps the raid tier it shipped at', () => {
  it.each(NYTHRAXIS_RELOCATED_ITEM_IDS)('%s reads item level 29, its Heroic copy 33', (id) => {
    expect(itemLevel(ITEMS[id])).toBe(29);
    expect(itemLevel(ITEMS[`heroic_${id}`])).toBe(33);
    expect(itemFromHeroicRaid(`heroic_${id}`)).toBe(true);
  });

  it.each(NYTHRAXIS_RELOCATED_TRINKET_IDS)(
    '%s reads item level 33 and stays a heroic-raid piece',
    (id) => {
      expect(itemLevel(ITEMS[id])).toBe(33);
      expect(itemFromHeroicRaid(id)).toBe(true);
    },
  );
});

describe('the weekly shelves keep the relocated pieces raid-only', () => {
  // The relocation changed where the pieces drop, not which weekly shelf offers
  // them: the raid shelves keep them, the five-man shelves never show them.
  it('the raid shelves offer them and the five-man shelves do not', () => {
    expect(weeklyLootPool('raid', 'warrior')).toContain('bonewrought_greatsword');
    expect(weeklyLootPool('raid_heroic', 'warrior')).toContain('heroic_bonewrought_greatsword');
    expect(weeklyLootPool('world', 'warrior')).toContain('bonewrought_greatsword');
    expect(weeklyLootPool('dungeon', 'warrior')).not.toContain('bonewrought_greatsword');
    expect(weeklyLootPool('dungeon_heroic', 'warrior')).not.toContain(
      'heroic_bonewrought_greatsword',
    );
    // The home boss's own shelf and the raid boss's shelf, through the boss tables.
    expect(weeklyBossLootPool('korgath_the_bound', 'dungeon', 'warrior')).not.toContain(
      'bonewrought_greatsword',
    );
    expect(weeklyBossLootPool(NYTHRAXIS_RAID_BOSS_ID, 'raid', 'warrior')).toContain(
      'bonewrought_greatsword',
    );
  });
});
