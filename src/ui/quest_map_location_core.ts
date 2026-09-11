// Where one accepted quest points on the world map: the centre of its current
// objective area while there is work left, and its turn-in NPC once the quest is
// ready to hand in.
//
// One rule, two callers: the atlas rail's "Show Route" (map_sidebar_view) and the
// quest log's "Show on Map", which used to click the generic map launcher and so
// discarded the selected quest entirely. Both go through here, so the two controls
// can never disagree about where a quest lives. DOM-free and i18n-free.

import { NPCS, QUESTS } from '../sim/data';
import { questObjectiveAreas } from '../sim/quest_targets';
import type { QuestProgress } from '../sim/types';
import { ownEntry } from './known_item';

/** A quest plus the world position the map should pan to and ring. */
export interface QuestMapLocation {
  questId: string;
  x: number;
  z: number;
}

/**
 * Resolve a quest's map location, or null when the quest is not in the log, is
 * unknown to this client's content tables, or has neither an objective area nor a
 * placed turn-in NPC.
 */
export function questMapLocation(
  questId: string | null,
  questLog: ReadonlyMap<string, QuestProgress>,
): QuestMapLocation | null {
  if (questId === null) return null;
  const progress = questLog.get(questId);
  const quest = ownEntry(QUESTS, questId);
  if (!progress || !quest) return null;
  if (progress.state !== 'ready') {
    const area = questObjectiveAreas(new Map([[questId, progress]])).find((candidate) =>
      candidate.objectives.some((objective) => objective.questId === questId),
    );
    if (area) return { questId, x: area.center.x, z: area.center.z };
  }
  const npc = NPCS[progress.state === 'ready' ? quest.turnInNpcId : quest.giverNpcId];
  return npc ? { questId, x: npc.pos.x, z: npc.pos.z } : null;
}
