// Boss-table eligibility is content-bounded. No character cache or random draws here.
import { HEROIC_DUNGEON_TUNING } from './content/dungeon_difficulty';
import { FINDER_ACTIVITIES } from './content/dungeon_finder';
import { HEROIC_BOSS_LOOT } from './content/heroic_loot';
import { DUNGEONS, ITEMS, MOBS } from './data';
import { RAID_MIN_PLAYERS } from './item_level';
import { heroicLootItemId } from './loot/heroic_item';
import type { PlayerMeta } from './sim';
import type { PlayerClass } from './types';
import { weeklyRewardFitsClass } from './weekly_reward_eligibility';
import type { WeeklyChoice, WeeklyPoolId, WeeklyVaultBatch } from './weekly_rewards';

/** Highest recorded clear: 1 normal, 2 heroic (also unlocks normal loot). */
export type WeeklyBossUnlocks = Record<string, number>;

// The finder owns the authored encounter list, including named mid-bosses that
// intentionally lack boss:true. Match their actual room, including Varkhul's room.
export const WEEKLY_BOSS_TABLES = Object.freeze(
  Object.values(DUNGEONS).flatMap((dungeon) => {
    if (!HEROIC_DUNGEON_TUNING[dungeon.id]) return [];
    const encounters = new Set(
      FINDER_ACTIVITIES.filter((activity) => activity.kind !== 'solo').flatMap((activity) =>
        activity.encounters.map((encounter) => encounter.mobId),
      ),
    );
    return (
      [...new Set(dungeon.spawns.map((spawn) => spawn.mobId))]
        // Finder also previews Wildheart trash. A boss flag or authored heroic
        // boss table distinguishes real encounters without relying on names.
        .filter(
          (bossId) =>
            encounters.has(bossId) &&
            (MOBS[bossId]?.boss === true || Object.hasOwn(HEROIC_BOSS_LOOT, bossId)),
        )
        .map((bossId) =>
          Object.freeze({
            bossId,
            dungeonId: dungeon.id,
            category: (dungeon.suggestedPlayers ?? 0) >= RAID_MIN_PLAYERS ? 'raid' : 'dungeon',
          }),
        )
    );
  }),
);

export function sanitizeWeeklyBossUnlocks(raw: unknown): WeeklyBossUnlocks | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const out: WeeklyBossUnlocks = {};
  for (const { bossId } of WEEKLY_BOSS_TABLES) {
    if (!Object.hasOwn(value, bossId)) continue;
    if (value[bossId] === 1 || value[bossId] === 2) out[bossId] = value[bossId];
  }
  return out;
}

export function weeklyBossTable(id: unknown) {
  return typeof id === 'string' && id.length <= 128
    ? WEEKLY_BOSS_TABLES.find((table) => table.bossId === id)
    : undefined;
}

/** Import only proven final-boss clears, never infer that intermediate bosses died. */
export function historicalWeeklyBossUnlocks(meta: PlayerMeta): WeeklyBossUnlocks {
  const unlocks: WeeklyBossUnlocks = {};
  for (const { bossId, dungeonId } of WEEKLY_BOSS_TABLES) {
    if (HEROIC_DUNGEON_TUNING[dungeonId].finalBossId !== bossId) continue;
    const clears = meta.deedStats.dungeonClears;
    const tier = clears[`${dungeonId}:heroic`] > 0 ? 2 : clears[dungeonId] > 0 ? 1 : 0;
    if (tier) unlocks[bossId] = tier;
  }
  return unlocks;
}

export function needsWeeklyBossTable(pool: WeeklyPoolId): boolean {
  return (
    pool === 'raid' || pool === 'raid_heroic' || pool === 'dungeon' || pool === 'dungeon_heroic'
  );
}

export function weeklyBossLootPool(bossId: string, pool: WeeklyPoolId, cls: PlayerClass): string[] {
  const table = weeklyBossTable(bossId);
  if (!table || !needsWeeklyBossTable(pool) || !pool.startsWith(table.category)) return [];
  const heroic = pool.endsWith('_heroic');
  const ids = new Set<string>();
  for (const entry of MOBS[bossId]?.loot ?? []) {
    if (entry.itemId && !entry.questId && entry.chance > 0 && !(heroic && entry.normalOnly))
      ids.add(heroicLootItemId(entry.itemId, heroic));
  }
  if (heroic) {
    for (const entry of HEROIC_BOSS_LOOT[bossId] ?? [])
      if (entry.itemId && !entry.questId && entry.chance > 0) ids.add(entry.itemId);
  }
  return [...ids]
    .filter((id) => {
      const item = ITEMS[id];
      return (
        item &&
        ['weapon', 'armor', 'held_offhand'].includes(item.kind) &&
        (item.quality === 'uncommon' || item.quality === 'rare' || item.quality === 'epic') &&
        weeklyRewardFitsClass(cls, item)
      );
    })
    .sort();
}

/** Only unreserved items; pending saves and hidden legacy items reserve their IDs too. */
export function weeklyAvailableBossTables(
  batch: WeeklyVaultBatch,
  choice: WeeklyChoice,
  cls: PlayerClass,
) {
  const tier = choice.pool.endsWith('_heroic') ? 2 : 1;
  const reserved = new Set(batch.choices.map((candidate) => candidate.itemId));
  return WEEKLY_BOSS_TABLES.filter(
    (table) => (batch.bossUnlocks?.[table.bossId] ?? 0) >= tier,
  ).flatMap((table) => {
    const items = weeklyBossLootPool(table.bossId, choice.pool, cls).filter(
      (id) => !reserved.has(id),
    );
    return items.length ? [{ ...table, items }] : [];
  });
}

/** An exhausted slot must not trap the week's other saved rewards. */
export function weeklyBossChoiceExhausted(
  batch: WeeklyVaultBatch,
  choice: WeeklyChoice,
  cls: PlayerClass,
): boolean {
  return (
    !!batch.bossUnlocks &&
    needsWeeklyBossTable(choice.pool) &&
    !choice.itemId &&
    !choice.fixed &&
    !choice.opening &&
    !weeklyAvailableBossTables(batch, choice, cls).length
  );
}
