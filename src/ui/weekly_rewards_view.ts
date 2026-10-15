import type { PlayerClass } from '../sim/types';
import {
  weeklyFilterTablesByLevel,
  weeklyRewardTableCandidates,
} from '../sim/weekly_reward_options';
import {
  needsWeeklyBossTable,
  WEEKLY_BOSS_TABLES,
  type WeeklyBossUnlocks,
} from '../sim/weekly_reward_tables';
import {
  earnedWeeklyRolls,
  WEEKLY_POOL_IDS,
  WEEKLY_THRESHOLDS,
  type WeeklyRewardInfo,
} from '../sim/weekly_rewards';
import { formatNumber, t } from './i18n';

export function weeklyCountdown(resetAtMs: number, nowMs: number): string {
  const total = Math.max(0, Math.ceil((resetAtMs - nowMs) / 1000));
  const n = (value: number) => formatNumber(value, { minimumIntegerDigits: 2, useGrouping: false });
  return t('hudChrome.weeklyRewards.countdown', {
    days: n(Math.floor(total / 86400)),
    hours: n(Math.floor(total / 3600) % 24),
    minutes: n(Math.floor(total / 60) % 60),
    seconds: n(total % 60),
  });
}
/** Every boss at Heroic, which also unlocks its Normal table. */
const EVERY_WEEKLY_BOSS_UNLOCK: WeeklyBossUnlocks = Object.freeze(
  Object.fromEntries(WEEKLY_BOSS_TABLES.map(({ bossId }) => [bossId, 2])),
);

/**
 * `eligible` (the keeper) lists only tables this week's boss kills unlock.
 * `all` (the read-only Dungeon Finder preview) lists every table a vault can
 * roll from, so players can plan runs before any boss dies.
 */
export type WeeklyLootCatalog = 'eligible' | 'all';

export function buildWeeklyRewardsView(
  info: WeeklyRewardInfo,
  playerClass: PlayerClass,
  options: { catalog?: WeeklyLootCatalog } = {},
) {
  const catalog = options.catalog ?? 'eligible';
  const bossUnlocks =
    catalog === 'all'
      ? EVERY_WEEKLY_BOSS_UNLOCK
      : (info.state.weeklyBossUnlocks ?? info.state.bossUnlocks);
  const earned = earnedWeeklyRolls(info.state);
  const progress = [
    info.state.raidClears.length,
    info.state.dungeons.length,
    info.state.world,
    info.state.pvp,
  ];
  const tiers = {
    raid: info.state.raidClears,
    dungeon: info.state.dungeons,
  };
  return (['raid', 'dungeon', 'world', 'pvp'] as const).map((category, index) => ({
    category,
    catalog,
    progress: progress[index],
    thresholds: WEEKLY_THRESHOLDS[category],
    available: category !== 'world' || info.worldQuestsAvailable,
    milestones: WEEKLY_THRESHOLDS[category].map((required) => {
      const available = category !== 'world' || info.worldQuestsAvailable;
      const completed = available && progress[index] >= required;
      const tiered = category === 'raid' || category === 'dungeon';
      const clears = tiered ? tiers[category].slice(0, required) : [];
      const heroic = clears.filter((tier) => tier === 2).length;
      const normal = clears.filter((tier) => tier === 1).length;
      const difficulty: 'normal' | 'heroic' | null =
        completed && tiered ? (heroic === required ? 'heroic' : 'normal') : null;
      const heroicRemaining = difficulty === 'normal' ? required - heroic : 0;
      return { required, completed, difficulty, heroic, normal, heroicRemaining };
    }),
    pools: WEEKLY_POOL_IDS.flatMap((pool, poolIndex) => {
      if (pool !== category && pool !== `${category}_heroic`) return [];
      const candidates = weeklyRewardTableCandidates(
        {
          resetAtMs: 0,
          choices: [],
          bossUnlocks,
          raidUnlocks: info.state.raidUnlocks,
        },
        { pool },
        playerClass,
      );
      const tables = weeklyFilterTablesByLevel(candidates, info.playerLevel);
      const items = [...new Set(tables.flatMap((table) => table.items))].sort();
      // Why a catalog is empty: nothing cleared yet, or everything is over level.
      const emptyReason: 'noClears' | 'level' | null = tables.length
        ? null
        : catalog === 'eligible' && needsWeeklyBossTable(pool) && !candidates.length
          ? 'noClears'
          : 'level';
      return [
        {
          pool,
          tables,
          items,
          earned: earned[poolIndex],
          emptyReason,
        },
      ];
    }),
  }));
}
