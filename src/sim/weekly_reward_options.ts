import { ITEMS } from './data';
import { requiredLevelFor } from './item_level_req';
import type { PlayerClass } from './types';
import {
  needsWeeklyBossTable,
  WEEKLY_BOSS_TABLES,
  weeklyAvailableBossTables,
} from './weekly_reward_tables';
import { type WeeklyChoice, type WeeklyVaultBatch, weeklyLootPool } from './weekly_rewards';

export interface WeeklyRewardTableOption {
  id: string;
  kind: 'mob' | 'dungeon' | 'pool';
  items: string[];
}

export const WEEKLY_TABLE_SELECTION_LIMIT = WEEKLY_BOSS_TABLES.length + 2;
export const WEEKLY_REWARD_MAX_LEVEL_OFFSET = 3;

/** Validate the bounded request before building collections or reading loot. */
export function parseWeeklyTableSelection(raw: unknown): string[] | null {
  const values = typeof raw === 'string' ? [raw] : raw;
  if (!Array.isArray(values) || !values.length || values.length > WEEKLY_TABLE_SELECTION_LIMIT)
    return null;
  for (const id of values) if (typeof id !== 'string' || !id.length || id.length > 128) return null;
  return [...new Set<string>(values)].sort();
}

/** Includes legacy boss sources even when new dungeon rolls use grouped sources. */
export function weeklyTableSource(
  id: unknown,
): Pick<WeeklyRewardTableOption, 'id' | 'kind'> | undefined {
  if (typeof id !== 'string' || id.length > 128) return undefined;
  if (id === 'world' || id === 'pvp') return { id, kind: 'pool' };
  if (WEEKLY_BOSS_TABLES.some((table) => table.bossId === id)) return { id, kind: 'mob' };
  if (WEEKLY_BOSS_TABLES.some((table) => table.category === 'dungeon' && table.dungeonId === id))
    return { id, kind: 'dungeon' };
  return undefined;
}

/** Equip requirements, rather than item power, determine whether a new roll fits. */
export function weeklyItemWithinLevel(itemId: string, level: number): boolean {
  return (
    Number.isSafeInteger(level) &&
    level >= 1 &&
    !!ITEMS[itemId] &&
    requiredLevelFor(ITEMS[itemId]) <= level + WEEKLY_REWARD_MAX_LEVEL_OFFSET
  );
}

/** Dungeon options include only cleared bosses at the earned difficulty. */
export function weeklyRewardTableOptions(
  batch: WeeklyVaultBatch,
  choice: WeeklyChoice,
  cls: PlayerClass,
  level: number,
): WeeklyRewardTableOption[] {
  return weeklyFilterTablesByLevel(weeklyRewardTableCandidates(batch, choice, cls), level);
}

export function weeklyFilterTablesByLevel(tables: WeeklyRewardTableOption[], level: number) {
  return tables.flatMap((table) => {
    const items = table.items.filter((id) => weeklyItemWithinLevel(id, level));
    return items.length ? [{ ...table, items }] : [];
  });
}

/** Unreserved, class-compatible candidates before the current equip-level boundary. */
export function weeklyRewardTableCandidates(
  batch: WeeklyVaultBatch,
  choice: WeeklyChoice,
  cls: PlayerClass,
): WeeklyRewardTableOption[] {
  if (!needsWeeklyBossTable(choice.pool)) {
    const reserved = new Set(batch.choices.map((entry) => entry.itemId));
    const items = weeklyLootPool(choice.pool, cls, batch.raidUnlocks).filter(
      (id) => !reserved.has(id),
    );
    return items.length ? [{ id: choice.pool, kind: 'pool', items }] : [];
  }
  const groups = new Map<string, WeeklyRewardTableOption>();
  for (const table of weeklyAvailableBossTables(batch, choice, cls)) {
    const items = table.items;
    if (!items.length) continue;
    const id = table.category === 'dungeon' ? table.dungeonId : table.bossId;
    const group = groups.get(id) ?? {
      id,
      kind: table.category === 'dungeon' ? 'dungeon' : 'mob',
      items: [],
    };
    group.items.push(...items);
    groups.set(id, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    items: [...new Set(group.items)].sort(),
  }));
}

/** All submitted tables must be valid; each item gets one chance across the union. */
export function selectedWeeklyRewardTables(
  options: WeeklyRewardTableOption[],
  raw: unknown,
): WeeklyRewardTableOption[] | null {
  const ids = parseWeeklyTableSelection(raw);
  if (!ids) return null;
  const selected: WeeklyRewardTableOption[] = [];
  for (const id of ids) {
    const option = options.find((table) => table.id === id);
    if (!option) return null;
    selected.push(option);
  }
  return selected;
}
