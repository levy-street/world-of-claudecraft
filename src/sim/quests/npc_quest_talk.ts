// The quest half of a plain NPC talk (sim.ts talkToNpc): the first quest this NPC takes in
// that is ready turns in, else the first it offers that is available is accepted (a quest
// with a completion effect is the NPC's own dialog's to start). Moved out of the Sim
// coordinator unchanged; the commands are the quest_commands module's, as Sim's own
// delegating methods were.

import { QUESTS } from '../data';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { type Entity, isQuestTurnInNpc } from '../types';
import { acceptQuest, questState, turnInQuest } from './quest_commands';

export function turnInOrAcceptAtNpc(ctx: SimContext, npc: Entity, meta: PlayerMeta): void {
  for (const qid of npc.questIds) {
    const quest = QUESTS[qid];
    if (
      quest &&
      isQuestTurnInNpc(quest, npc.templateId) &&
      meta.questLog.get(qid)?.state === 'ready'
    ) {
      turnInQuest(ctx, qid, meta.entityId);
      return;
    }
  }
  for (const qid of npc.questIds) {
    if (
      QUESTS[qid].giverNpcId === npc.templateId &&
      !QUESTS[qid].completionEffect &&
      questState(ctx, qid, meta.entityId) === 'available'
    ) {
      acceptQuest(ctx, qid, meta.entityId);
      return;
    }
  }
}
