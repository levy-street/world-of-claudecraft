import { WEEKLY_THRESHOLDS, type WeeklyRewardInfo } from '../sim/weekly_rewards';
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
export function buildWeeklyRewardsView(info: WeeklyRewardInfo) {
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
  }));
}
