// Seasonal quests close with their event. The ids returned here join the
// repeat-blocked set both hosts already share (quest_commands.ts
// repeatBlockedQuestIds, mirrored online through cprof.cadenceBlockedQuests), so
// an event quest is offered exactly while its event runs, in every world, with no
// new wire field. A quest already in the log stays finishable (computeQuestState
// answers 'active'/'ready' before it reads the blocked set).
import { QUESTS } from '../data';

let seasonalQuestIds: readonly { id: string; event: string }[] | null = null;

function seasonalQuests(): readonly { id: string; event: string }[] {
  if (!seasonalQuestIds) {
    seasonalQuestIds = Object.values(QUESTS)
      .filter((quest) => typeof quest.seasonalEvent === 'string')
      .map((quest) => ({ id: quest.id, event: quest.seasonalEvent as string }));
  }
  return seasonalQuestIds;
}

const blockedMemo = new Map<string | null, readonly string[]>();

/** Every seasonal quest whose event is not the one running now (memoized per
 *  active event: the set only changes when an event opens or closes). */
export function seasonalBlockedQuestIds(activeEvent: string | null): readonly string[] {
  let out = blockedMemo.get(activeEvent);
  if (!out) {
    out = Object.freeze(
      seasonalQuests()
        .filter((quest) => quest.event !== activeEvent)
        .map((quest) => quest.id),
    );
    blockedMemo.set(activeEvent, out);
  }
  return out;
}
