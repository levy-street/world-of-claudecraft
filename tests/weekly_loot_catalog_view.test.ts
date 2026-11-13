import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { requiredLevelFor } from '../src/sim/item_level_req';
import { WEEKLY_LOOT_PROFILES, weeklyLootSpecFitsItem } from '../src/sim/weekly_loot_spec';
import { WEEKLY_BOSS_TABLES, weeklyBossLootPool } from '../src/sim/weekly_reward_tables';
import { weeklyLootPool } from '../src/sim/weekly_rewards';
import {
  weeklyLootCatalogView,
  weeklyLootHasDifficulty,
  weeklyLootPoolFor,
} from '../src/ui/weekly_loot_catalog_view';

const ids = (view: ReturnType<typeof weeklyLootCatalogView>) =>
  view.tables.map((table) => table.id).sort();
const items = (view: ReturnType<typeof weeklyLootCatalogView>) =>
  [...new Set(view.tables.flatMap((table) => table.items))].sort();

describe('weekly possible-loot catalog view', () => {
  it('maps each content and difficulty to its vault pool', () => {
    expect(weeklyLootPoolFor({ content: 'raid', difficulty: 'normal' })).toBe('raid');
    expect(weeklyLootPoolFor({ content: 'raid', difficulty: 'heroic' })).toBe('raid_heroic');
    expect(weeklyLootPoolFor({ content: 'dungeon', difficulty: 'normal' })).toBe('dungeon');
    expect(weeklyLootPoolFor({ content: 'dungeon', difficulty: 'heroic' })).toBe('dungeon_heroic');
    // World Quests and PvP have one pool whatever difficulty is remembered.
    expect(weeklyLootPoolFor({ content: 'world', difficulty: 'heroic' })).toBe('world');
    expect(weeklyLootPoolFor({ content: 'pvp', difficulty: 'heroic' })).toBe('pvp');
    expect(
      ['raid', 'dungeon', 'world', 'pvp'].map((c) => weeklyLootHasDifficulty(c as never)),
    ).toEqual([true, true, false, false]);
  });

  it('lists every boss table with no clears at all: possible loot, not eligible loot', () => {
    for (const [content, kind] of [
      ['raid', 'raid'],
      ['dungeon', 'dungeon'],
    ] as const) {
      for (const difficulty of ['normal', 'heroic'] as const) {
        const pool = weeklyLootPoolFor({ content, difficulty });
        const view = weeklyLootCatalogView({ content, difficulty }, 'warrior');
        const expected = [
          ...new Set(
            WEEKLY_BOSS_TABLES.filter(
              (table) =>
                table.category === kind &&
                weeklyBossLootPool(table.bossId, pool, 'warrior').length > 0,
            ).map((table) => (kind === 'dungeon' ? table.dungeonId : table.bossId)),
          ),
        ].sort();
        expect(expected.length).toBeGreaterThan(0);
        expect(ids(view)).toEqual(expected);
        expect(view.empty).toBeNull();
      }
    }
    const dungeon = weeklyLootCatalogView({ content: 'dungeon', difficulty: 'normal' }, 'warrior');
    expect(ids(dungeon)).toEqual(
      expect.arrayContaining([
        'hollow_crypt',
        'sunken_bastion',
        'drowned_temple',
        'gravewyrm_sanctum',
        'wildheart_basin',
      ]),
    );
  });

  it('keeps high-level gear in the list, since it takes no level at all', () => {
    // The raid's Heroic gear needs far more than level 1 + 3; it still lists.
    const heroic = weeklyLootCatalogView({ content: 'raid', difficulty: 'heroic' }, 'warrior');
    expect(items(heroic).some((id) => requiredLevelFor(ITEMS[id]) > 4)).toBe(true);
  });

  it('shows the World Quests and PvP pools as one table each', () => {
    for (const content of ['world', 'pvp'] as const) {
      const view = weeklyLootCatalogView({ content, difficulty: 'normal' }, 'mage');
      expect(ids(view)).toEqual([content]);
      expect(view.tables[0].items).toEqual(weeklyLootPool(content, 'mage'));
    }
  });

  it('filters every pool by the loot focus', () => {
    let removed = 0;
    for (const content of ['raid', 'dungeon', 'world', 'pvp'] as const) {
      for (const difficulty of ['normal', 'heroic'] as const) {
        const selection = { content, difficulty };
        const all = items(weeklyLootCatalogView(selection, 'paladin'));
        const focused = weeklyLootCatalogView(selection, 'paladin', 'holy');
        expect(items(focused)).toEqual(
          all.filter((id) => weeklyLootSpecFitsItem('paladin', 'holy', ITEMS[id])),
        );
        removed += all.length - items(focused).length;
      }
    }
    expect(removed).toBeGreaterThan(0);
  });

  it('never shows an empty pool for any class, with or without a loot focus', () => {
    // The catalog is independent of clears and level, so no character state can
    // empty it: every class and focus sees loot in every content and difficulty.
    let checked = 0;
    for (const [cls, profiles] of Object.entries(WEEKLY_LOOT_PROFILES)) {
      for (const spec of [undefined, ...Object.keys(profiles)]) {
        for (const content of ['raid', 'dungeon', 'world', 'pvp'] as const) {
          for (const difficulty of ['normal', 'heroic'] as const) {
            const view = weeklyLootCatalogView({ content, difficulty }, cls as never, spec);
            expect(view.tables.length, `${cls} ${spec} ${content} ${difficulty}`).toBeGreaterThan(
              0,
            );
            expect(view.empty).toBeNull();
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});
