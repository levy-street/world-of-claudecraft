// The Weekly Vault's "View possible loot" catalog: every table a weekly vault of
// the chosen content and difficulty can roll from, for the player's class and
// loot focus. It is a catalog of POSSIBLE loot, so it ignores what the player
// has cleared and their level: a vault itself offers only the bosses cleared at
// that difficulty and equipment within the level offset (the claim flow's
// `weeklyRewardAvailability`), and the rule line says so.
//
// Pure: no DOM. The painter is weekly_reward_loot_catalog_controller.ts.

import type { PlayerClass } from '../sim/types';
import {
  type WeeklyRewardTableOption,
  weeklyRewardTableCandidates,
} from '../sim/weekly_reward_options';
import { WEEKLY_BOSS_TABLES, type WeeklyBossUnlocks } from '../sim/weekly_reward_tables';
import type { WeeklyPoolId, WeeklyVaultBatch } from '../sim/weekly_rewards';

export type WeeklyLootContent = 'raid' | 'dungeon' | 'world' | 'pvp';
export type WeeklyLootDifficulty = 'normal' | 'heroic';

export const WEEKLY_LOOT_CONTENT: readonly WeeklyLootContent[] = [
  'raid',
  'dungeon',
  'world',
  'pvp',
];
export const WEEKLY_LOOT_DIFFICULTIES: readonly WeeklyLootDifficulty[] = ['normal', 'heroic'];

export interface WeeklyLootSelection {
  readonly content: WeeklyLootContent;
  readonly difficulty: WeeklyLootDifficulty;
}

export const DEFAULT_WEEKLY_LOOT_SELECTION: WeeklyLootSelection = Object.freeze({
  content: 'raid',
  difficulty: 'normal',
});

/** Raids and dungeons roll Normal or Heroic tables; World Quests and PvP have one pool. */
export function weeklyLootHasDifficulty(content: WeeklyLootContent): boolean {
  return content === 'raid' || content === 'dungeon';
}

export function weeklyLootPoolFor(selection: WeeklyLootSelection): WeeklyPoolId {
  const { content, difficulty } = selection;
  if (!weeklyLootHasDifficulty(content)) return content as WeeklyPoolId;
  return (difficulty === 'heroic' ? `${content}_heroic` : content) as WeeklyPoolId;
}

/** Every boss counted as defeated on Heroic, which also unlocks Normal. */
const EVERY_BOSS: WeeklyBossUnlocks = Object.freeze(
  Object.fromEntries(WEEKLY_BOSS_TABLES.map(({ bossId }) => [bossId, 2])),
);
const CATALOG_BATCH: WeeklyVaultBatch = Object.freeze({
  resetAtMs: 0,
  choices: [],
  bossUnlocks: EVERY_BOSS,
}) as WeeklyVaultBatch;

export interface WeeklyLootCatalogView {
  readonly pool: WeeklyPoolId;
  readonly tables: readonly WeeklyRewardTableOption[];
  /** Why the list is empty: the focus filtered everything out, or nothing fits the class. */
  readonly empty: 'focus' | 'none' | null;
}

export function weeklyLootCatalogView(
  selection: WeeklyLootSelection,
  cls: PlayerClass,
  lootSpec?: string,
): WeeklyLootCatalogView {
  const pool = weeklyLootPoolFor(selection);
  const tables = weeklyRewardTableCandidates(CATALOG_BATCH, { pool }, cls, lootSpec);
  if (tables.length) return { pool, tables, empty: null };
  const focusHid =
    !!lootSpec && weeklyRewardTableCandidates(CATALOG_BATCH, { pool }, cls).length > 0;
  return { pool, tables, empty: focusHid ? 'focus' : 'none' };
}
