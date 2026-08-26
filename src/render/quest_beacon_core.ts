// Which tutorial-island NPCs deserve a guiding beacon right now.
//
// The island rail hands a brand-new player from NPC to NPC around the whole
// shore, and the classic "!" and "?" plates are small at a distance: a
// newcomer who has never played the genre reported not knowing where to go
// next. This core answers, per frame, the one question the beacon VFX pass
// needs: FOR WHICH NPC template ids is "go here next" true, meaning the NPC
// either OFFERS the rail's next quest (its state is available) or is the
// TURN-IN of a rail quest whose objectives are complete (ready).
//
// Pure and DOM-free (RENDER_PURE_CORES, tests/architecture.test.ts): reads
// the shipped rail content plus the IWorld quest facets the caller passes,
// returns a Set the renderer's entity loop sparkles from.

import { PROVING_SHORE_QUEST_ORDER, PROVING_SHORE_QUESTS } from '../sim/content/proving_shore';

export interface QuestStateReader {
  questState(id: string): string;
  questLog: ReadonlyMap<string, { state: string }>;
}

/** Template ids of the island NPCs a beacon should stand over right now. */
export function beaconNpcIds(world: QuestStateReader): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const questId of PROVING_SHORE_QUEST_ORDER) {
    const quest = PROVING_SHORE_QUESTS[questId];
    if (!quest) continue;
    const state = world.questState(questId);
    if (state === 'available') ids.add(quest.giverNpcId);
    // 'ready' rides the live log entry: questState collapses turn-in states
    // differently across hosts, but a log entry at 'ready' is the one wire
    // truth both worlds share.
    if (world.questLog.get(questId)?.state === 'ready') ids.add(quest.turnInNpcId);
  }
  return ids;
}
