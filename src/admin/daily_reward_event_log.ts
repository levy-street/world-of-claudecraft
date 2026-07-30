import { fmtDecimal, fmtNumber } from './format';
import { t } from './i18n';
import type { DailyRewardPointEventRow } from './types';

function metaString(meta: Record<string, unknown>, key: string, fallback: string): string {
  const value = meta[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function metaNumber(meta: Record<string, unknown>, key: string): number | null {
  const value = Number(meta[key]);
  return Number.isFinite(value) ? value : null;
}

export function rewardEventDate(baseDay: string, offsetDays = 0): string {
  const start = Date.parse(`${baseDay}T00:00:00.000Z`);
  if (!Number.isFinite(start)) return baseDay;
  return new Date(start + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export interface DailyRewardEventPresentation {
  action: string;
  details: string[];
}

export function dailyRewardEventPresentation(
  event: DailyRewardPointEventRow,
): DailyRewardEventPresentation {
  const meta = event.meta;
  const taskType = metaString(meta, 'taskType', 'task');
  let action: string;
  if (event.kind === 'spin') {
    action = t('accountRewards.actionSpin');
  } else if (taskType === 'quest_completion') {
    action = t('accountRewards.actionQuest', {
      quest: metaString(meta, 'questId', t('common.unknown')),
    });
  } else if (taskType === 'arena_result') {
    action = t(
      meta.won === true ? 'accountRewards.actionArenaWin' : 'accountRewards.actionArenaLoss',
      {
        format: metaString(meta, 'format', t('common.unknown')),
      },
    );
  } else if (taskType === 'delve_clear' && meta.bonusType === 'delve_chest') {
    action = t('accountRewards.actionDelveChest', {
      delve: metaString(meta, 'delveId', t('common.unknown')),
      tier: metaString(meta, 'tierId', t('common.unknown')),
      chest: metaString(meta, 'chestTier', t('common.unknown')),
    });
  } else if (taskType === 'delve_clear') {
    action = t('accountRewards.actionDelveClear', {
      delve: metaString(meta, 'delveId', t('common.unknown')),
      tier: metaString(meta, 'tierId', t('common.unknown')),
    });
  } else if (taskType === 'vale_cup_result') {
    action = t('accountRewards.actionValeCup', {
      matchType: metaString(meta, 'matchType', t('common.unknown')),
      bracket: fmtNumber(metaNumber(meta, 'bracket') ?? 0),
    });
  } else if (event.kind === 'task') {
    action = t('accountRewards.actionTask', {
      task: metaString(meta, 'taskId', taskType),
    });
  } else {
    action = t('accountRewards.actionOther', { kind: event.kind });
  }

  const details: string[] = [];
  const multiplier = metaNumber(meta, 'multiplier');
  if (multiplier !== null) {
    details.push(t('accountRewards.detailMultiplier', { value: fmtDecimal(multiplier) }));
  }
  const tierMultiplier = metaNumber(meta, 'tierMultiplier');
  if (tierMultiplier !== null) {
    details.push(t('accountRewards.detailTierMultiplier', { value: fmtDecimal(tierMultiplier) }));
  }
  const bountifulMultiplier = metaNumber(meta, 'bountifulMultiplier');
  if (bountifulMultiplier !== null && bountifulMultiplier !== 1) {
    details.push(
      t('accountRewards.detailBountifulMultiplier', {
        value: fmtDecimal(bountifulMultiplier),
      }),
    );
  }
  const basePoints =
    metaNumber(meta, 'basePoints') ??
    metaNumber(meta, 'baseClearPoints') ??
    metaNumber(meta, 'chestBasePoints');
  if (basePoints !== null) {
    details.push(t('accountRewards.detailBasePoints', { value: fmtNumber(basePoints) }));
  }
  const onlineMinutes = metaNumber(meta, 'onlineMinutes');
  if (onlineMinutes !== null) {
    details.push(t('accountRewards.detailOnlineMinutes', { value: fmtNumber(onlineMinutes) }));
  }
  const repeatIndex = metaNumber(meta, 'repeatIndex');
  if (repeatIndex !== null && repeatIndex > 0) {
    details.push(t('accountRewards.detailRepeat', { value: fmtNumber(repeatIndex + 1) }));
  }
  return { action, details };
}
