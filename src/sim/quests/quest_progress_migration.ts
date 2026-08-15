// Restore-time migration for reworked quest objectives.
//
// A quest rework that keeps the quest id but changes what an objective INDEX
// means (the zones 1 to 3 de-duplication pass: new targets, kill counts cut to
// 1, kill objectives turned into collects or interacts) leaves an in-flight
// save's index-keyed counts pointing at the wrong work. That is worse than
// cosmetic: the credit paths skip an objective already at its required count
// BEFORE their ready check (quest_credit.ts creditDiscreteQuestObjectives,
// firebottle_hut.ts creditHutObjective), so a carried 9-of-14 against a new
// count-of-1 can never flip the quest ready and the run strands until an
// abandon.
//
// The mechanism: QuestDef.rev names the objective-list revision, QuestProgress
// stamps the rev it was accepted under (finalizeQuestAccept), and this pure
// helper resets a restored run whose stamp does not match: counts back to
// zero, a stale 'ready' demoted to 'active', per-run scratch (burnedObjects)
// and the stale resolvedCounts dropped, and the current rev stamped so the
// reset happens exactly once. A quest def with no rev (the default) never
// resets anything.
//
// Pure leaf (no SimContext, no rng, no clock): a Vitest imports it directly.
import type { QuestDef, QuestProgress } from '../types';

export function migrateRestoredQuestProgress(
  quest: QuestDef | undefined,
  saved: QuestProgress,
): QuestProgress {
  if (!quest) return saved; // unknown/removed quest ids are the sanitizer's job
  if ((quest.rev ?? 0) === (saved.rev ?? 0)) return saved;
  return {
    questId: saved.questId,
    counts: quest.objectives.map(() => 0),
    state: saved.state === 'done' ? 'done' : 'active',
    ...(saved.selection === undefined ? {} : { selection: saved.selection }),
    ...(quest.rev === undefined ? {} : { rev: quest.rev }),
  };
}
