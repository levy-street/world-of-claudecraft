import { WEEKLY_QUESTS_BY_ID } from '../../../sim/content/weekly_quests';
import type { WeeklyQuestProgress } from '../../../sim/types';
import { formatNumber, t } from '../../i18n';
import { ownEntry } from '../../known_item';
import type { TrackedQuest } from './quest_tracker';

/** The accepted emissary charge joins both tracker presentations until its
 *  automatic completion. It has no ordinary quest-log entry or map badge. */
export function weeklyQuestTrackerRow(
  progress: WeeklyQuestProgress | null | undefined,
): TrackedQuest | null {
  if (!progress || progress.state !== 'active') return null;
  const quest = ownEntry(WEEKLY_QUESTS_BY_ID, progress.questId);
  if (!quest) return null;
  const current = Math.min(progress.count, quest.count);
  return {
    id: quest.id,
    number: 0,
    title: t('hudChrome.weekly.dialogHeading', {
      category: t(`hudChrome.weekly.kinds.${quest.kind}.category`),
    }),
    complete: false,
    objectives: [
      {
        label: t('hudChrome.weekly.progress', {
          label: t(`hudChrome.weekly.kinds.${quest.kind}.goalLabel`),
          count: formatNumber(current, { maximumFractionDigits: 0 }),
          required: formatNumber(quest.count, { maximumFractionDigits: 0 }),
        }),
        current,
        total: quest.count,
        // Keep the full tally readable, including single raid/boss objectives.
        instruction: true,
      },
    ],
  };
}
