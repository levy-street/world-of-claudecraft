import { DUNGEONS } from '../../src/sim/data';
import type { QuestDef } from '../../src/sim/types';

/**
 * A quest no new player can take: retired, or pointing into a room that has not shipped.
 * The same two checks computeQuestState (src/sim/quests/quest_commands.ts) makes.
 */
export function questClosed(q: QuestDef): boolean {
  return !!(
    q.retired ||
    (q.gatedWithDungeon && DUNGEONS[q.gatedWithDungeon]?.guideVisible === false)
  );
}
