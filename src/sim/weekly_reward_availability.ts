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
  reason: 'level' | 'exhausted' | 'noTables' | 'focus';
}

/** One content scan per tile projection; callers reuse the options and explanation. */
export function weeklyRewardAvailability(
  batch: WeeklyVaultBatch,
  choice: WeeklyChoice,
  cls: PlayerClass,
  level: number,
  lootSpec?: string,
): WeeklyRewardAvailability {
  if (choice.itemId || choice.fixed) return { tables: [], exhausted: false, reason: 'noTables' };
  const candidates = weeklyRewardTableCandidates(batch, choice, cls, lootSpec);
  const tables = weeklyFilterTablesByLevel(candidates, level);
  let reason: WeeklyRewardAvailability['reason'] = candidates.length
    ? 'level'
    : batch.choices.some((entry) => entry.itemId)
      ? 'exhausted'
      : 'noTables';
  if (lootSpec && !candidates.length) {
    // Only blame the focus when changing it can reveal an eligible candidate.
    // Empty-source and equip-level explanations still apply to focused catalogs.
    const classCandidates = weeklyRewardTableCandidates(batch, choice, cls);
    if (classCandidates.length)
      reason = weeklyFilterTablesByLevel(classCandidates, level).length ? 'focus' : 'level';
  }
  return {
    tables,
    exhausted:
      !choice.opening &&
      !choice.pendingSave &&
      !tables.length &&
      (!needsWeeklyBossTable(choice.pool) || !!batch.bossUnlocks || candidates.length > 0),
    reason,
  };
}

/** Reserved or over-level equipment must not block claiming another revealed reward. */
export function weeklyChoiceExhausted(
  batch: WeeklyVaultBatch,
  choice: WeeklyChoice,
  cls: PlayerClass,
  level: number,
  lootSpec?: string,
): boolean {
  return weeklyRewardAvailability(batch, choice, cls, level, lootSpec).exhausted;
}

/** A focus-empty slot is unresolved: the player can change focus before claiming. */
export function weeklyChoiceResolvedForClaim(
  batch: WeeklyVaultBatch,
  choice: WeeklyChoice,
  cls: PlayerClass,
  level: number,
  lootSpec?: string,
): boolean {
  const availability = weeklyRewardAvailability(batch, choice, cls, level, lootSpec);
  return availability.exhausted && availability.reason !== 'focus';
}
