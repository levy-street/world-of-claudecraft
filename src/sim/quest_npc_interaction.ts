import { QUESTS } from './data';
import { regrantMissingQuestItems } from './quests/quest_commands';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { type Entity, questObjectiveRequired } from './types';

/** Ordinary quest-talk credit, shared by the Sim's scripted NPC dispatch. */
export function interactNpcForQuests(ctx: SimContext, npc: Entity, meta: PlayerMeta): boolean {
  let progressed = false;
  regrantMissingQuestItems(ctx, meta, npc.templateId);
  for (const qp of meta.questLog.values()) {
    if (qp.state !== 'active') continue;
    const quest = QUESTS[qp.questId];
    quest.objectives.forEach((objective, objectiveIndex) => {
      if (objective.type !== 'interact' || objective.targetNpcId !== npc.templateId) return;
      const required = questObjectiveRequired(quest, qp, objectiveIndex);
      if (qp.counts[objectiveIndex] >= required) return;
      qp.counts[objectiveIndex]++;
      progressed = true;
      meta.counters.questProgress++;
      ctx.emit({
        type: 'questProgress',
        questId: qp.questId,
        objectiveIndex,
        current: qp.counts[objectiveIndex],
        required,
        text: `${objective.label}: ${qp.counts[objectiveIndex]}/${required}`,
        pid: meta.entityId,
      });
      ctx.checkQuestReady(qp, meta);
    });
  }
  return progressed;
}
