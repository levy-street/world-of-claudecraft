import type { PlayerClass } from './types';
import {
  type WeeklyRewardTableOption,
  weeklyFilterTablesByLevel,
  weeklyRewardTableCandidates,
} from './weekly_reward_options';
import { needsWeeklyBossTable } from './weekly_reward_tables';
import type { WeeklyChoice, WeeklyVaultBatch } from './weekly_rewards';

export interface WeeklyRewardAvailability {
  tables: WeeklyRewardTableOption[];
  exhausted: boolean;
  reason: 'level' | 'exhausted' | 'noTables';
}

/** One content scan per tile projection; callers reuse the options and explanation. */
export function weeklyRewardAvailability(
  batch: WeeklyVaultBatch,
  choice: WeeklyChoice,
  cls: PlayerClass,
  level: number,
): WeeklyRewardAvailability {
  if (choice.itemId || choice.fixed) return { tables: [], exhausted: false, reason: 'noTables' };
  const candidates = weeklyRewardTableCandidates(batch, choice, cls);
  const tables = weeklyFilterTablesByLevel(candidates, level);
  return {
    tables,
    exhausted:
      !choice.opening &&
      !choice.pendingSave &&
      !tables.length &&
      (!needsWeeklyBossTable(choice.pool) || !!batch.bossUnlocks || candidates.length > 0),
    reason: candidates.length
      ? 'level'
      : batch.choices.some((entry) => entry.itemId)
        ? 'exhausted'
        : 'noTables',
  };
}

/** Reserved or over-level equipment must not block claiming another revealed reward. */
export function weeklyChoiceExhausted(
  batch: WeeklyVaultBatch,
  choice: WeeklyChoice,
  cls: PlayerClass,
  level: number,
): boolean {
  return weeklyRewardAvailability(batch, choice, cls, level).exhausted;
}
