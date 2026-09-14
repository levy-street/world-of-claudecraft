import { ITEMS } from '../sim/data';
import type { PlayerClass } from '../sim/types';
import {
  earnedWeeklyRolls,
  WEEKLY_POOL_IDS,
  WEEKLY_THRESHOLDS,
  type WeeklyRewardInfo,
  weeklyLootPool,
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
export function buildWeeklyRewardsView(info: WeeklyRewardInfo, playerClass: PlayerClass) {
  const earned = earnedWeeklyRolls(info.state);
  const progress = [
    info.state.raids.filter(Boolean).length,
    info.state.dungeons.length,
    info.state.world,
    info.state.pvp,
  ];
  return (['raid', 'dungeon', 'world', 'pvp'] as const).map((category, index) => ({
    category,
    progress: progress[index],
    thresholds: WEEKLY_THRESHOLDS[category],
    available: category !== 'world' || info.worldQuestsAvailable,
    pools: WEEKLY_POOL_IDS.flatMap((pool, poolIndex) => {
      if (pool !== category && pool !== `${category}_heroic`) return [];
      const items = weeklyLootPool(pool, playerClass, info.state.raidUnlocks);
      return [
        {
          pool,
          items,
          earned: earned[poolIndex],
          qualities: [...new Set(items.map((id) => ITEMS[id].quality))].sort(),
        },
      ];
    }),
  }));
}
