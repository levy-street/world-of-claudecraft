// Seasonal quests close with their event. The ids returned here join the
// repeat-blocked set both hosts already share (quest_commands.ts
// repeatBlockedQuestIds, mirrored online through cprof.cadenceBlockedQuests), so
// an event quest is offered exactly while its event runs, in every world, with no
// new wire field. A quest already in the log stays finishable (computeQuestState
// answers 'active'/'ready' before it reads the blocked set). The rotating dailies
// ride the same set: the pool's errands that are not the day's are blocked too.
import { QUESTS } from '../data';
import { offDayDailyQuestIds } from './gourdlight_dailies';

let seasonalQuestIds: readonly { id: string; event: string }[] | null = null;

function seasonalQuests(): readonly { id: string; event: string }[] {
  if (!seasonalQuestIds) {
    seasonalQuestIds = Object.values(QUESTS)
      .filter((quest) => typeof quest.seasonalEvent === 'string')
      .map((quest) => ({ id: quest.id, event: quest.seasonalEvent as string }));
  }
  return seasonalQuestIds;
}

const blockedMemo = new Map<string, readonly string[]>();

/** Every seasonal quest whose event is not the one running now, plus the rotating
 *  dailies that are not the day's (gourdlight_dailies.ts). Memoized per (active event,
 *  day's errand): the set only changes when an event opens or closes or the day rolls. */
export function seasonalBlockedQuestIds(
  activeEvent: string | null,
  resetDay = '',
  devDaily: string | null = null,
): readonly string[] {
  const offDay = offDayDailyQuestIds(activeEvent, resetDay, devDaily);
  const key = `${activeEvent ?? ''}|${offDay.join(',')}`;
  let out = blockedMemo.get(key);
  if (!out) {
    out = Object.freeze([
      ...seasonalQuests()
        .filter((quest) => quest.event !== activeEvent)
        .map((quest) => quest.id),
      ...offDay,
    ]);
    blockedMemo.set(key, out);
  }
  return out;
}
