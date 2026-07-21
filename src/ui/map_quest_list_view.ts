// Pure model for the world-map quest numbering: the 1-based number each quest
// shows on the map (its gold objective badge), in acceptance order (the quest
// log's insertion order, which both the offline Sim and the online ClientWorld
// mirror preserve). DOM-free / i18n-free.

import type { QuestProgress } from '../sim/types';

/** 1-based quest number by acceptance order, for every quest in the log. */
export function questNumbersByLog(
  questLog: ReadonlyMap<string, QuestProgress>,
): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const questId of questLog.keys()) numbers.set(questId, numbers.size + 1);
  return numbers;
}
