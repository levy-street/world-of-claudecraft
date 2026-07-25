// Quest-credit math (session Q1), MOVED verbatim out of the Sim monolith behind the
// SimContext seam. These three pure updaters grant kill / collect / turn-in credit by
// mutating the live PlayerMeta.questLog in place (the immutability waiver applies: qp
// and meta are shared references the engine mutates). They draw NO rng. The interaction
// dispatcher (interact/talkToNpc/pickUpObject/lootCorpse) stays on Sim and reaches these
// through the seam; the foreign callers (handleDeath, the addItem/removeItem/buyBackItem
// inventory hub, finalizeQuestAccept, interactNpcForQuests, and the N1 crypt
// interactObjectForQuests) invoke them via ctx.onMobKilledForQuests /
// ctx.onInventoryChangedForQuests / ctx.checkQuestReady.
//
// src/sim-pure: imports only sibling sim types + the QUESTS data table (no render/ui/
// game/net/DOM/Three, no Math.random/Date.now), so it runs unchanged in Node, the
// browser, and the headless RL env.

import { QUESTS } from '../data';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import {
  type Entity,
  type GatherNodeDef,
  type QuestObjective,
  type QuestProgress,
  questObjectiveRequired,
} from '../types';

function emitQuestProgress(
  ctx: SimContext,
  meta: PlayerMeta,
  qp: QuestProgress,
  objective: QuestObjective,
  objectiveIndex: number,
): void {
  const quest = QUESTS[qp.questId];
  const required = questObjectiveRequired(quest, qp, objectiveIndex);
  ctx.emit({
    type: 'questProgress',
    questId: qp.questId,
    objectiveIndex,
    current: qp.counts[objectiveIndex],
    required,
    text: `${objective.label}: ${qp.counts[objectiveIndex]}/${required}`,
    pid: meta.entityId,
  });
}

function creditDiscreteQuestObjectives(
  ctx: SimContext,
  meta: PlayerMeta,
  matches: (objective: QuestObjective) => boolean,
): void {
  for (const qp of meta.questLog.values()) {
    if (qp.state !== 'active') continue;
    const quest = QUESTS[qp.questId];
    let changed = false;
    quest.objectives.forEach((objective, objectiveIndex) => {
      const required = questObjectiveRequired(quest, qp, objectiveIndex);
      if (!matches(objective) || qp.counts[objectiveIndex] >= required) return;
      qp.counts[objectiveIndex]++;
      changed = true;
      meta.counters.questProgress++;
      emitQuestProgress(ctx, meta, qp, objective, objectiveIndex);
    });
    if (changed) checkQuestReady(ctx, qp, meta);
  }
}

export function onMobKilledForQuests(ctx: SimContext, mob: Entity, meta: PlayerMeta): void {
  creditDiscreteQuestObjectives(
    ctx,
    meta,
    (objective) => objective.type === 'kill' && objective.targetMobId === mob.templateId,
  );
}

/** Credit a recipe objective only after the authoritative craft resolver succeeds. */
export function onRecipeCraftedForQuests(
  ctx: SimContext,
  recipeId: string,
  meta: PlayerMeta,
): void {
  creditDiscreteQuestObjectives(
    ctx,
    meta,
    (objective) => objective.type === 'craft' && objective.recipeId === recipeId,
  );
}

/** Credit a gather objective only after the node's authoritative grant succeeds. */
export function onNodeGatheredForQuests(
  ctx: SimContext,
  node: GatherNodeDef,
  itemId: string,
  meta: PlayerMeta,
): void {
  creditDiscreteQuestObjectives(ctx, meta, (objective) => {
    if (objective.type !== 'gather') return false;
    if (objective.nodeType !== undefined && objective.nodeType !== node.type) return false;
    if (objective.itemId !== undefined && objective.itemId !== itemId) return false;
    return true;
  });
}

export function onInventoryChangedForQuests(ctx: SimContext, meta: PlayerMeta): void {
  // Inventory mutated (add/remove/sell/buyback all route through here): flag
  // the player's wire state dirty so hosts re-send bags + derived quest state.
  meta.wireRev++;
  for (const qp of meta.questLog.values()) {
    const quest = QUESTS[qp.questId];
    let changed = false;
    quest.objectives.forEach((obj, i) => {
      if (obj.type === 'collect' && obj.itemId) {
        const required = questObjectiveRequired(quest, qp, i);
        const have = Math.min(required, ctx.countItem(obj.itemId, meta.entityId));
        if (have !== qp.counts[i]) {
          if (have > qp.counts[i]) meta.counters.questProgress += have - qp.counts[i];
          qp.counts[i] = have;
          changed = true;
          ctx.emit({
            type: 'questProgress',
            questId: qp.questId,
            objectiveIndex: i,
            current: have,
            required,
            text: `${obj.label}: ${have}/${required}`,
            pid: meta.entityId,
          });
        }
      }
    });
    if (changed) checkQuestReady(ctx, qp, meta);
  }
}

export function checkQuestReady(ctx: SimContext, qp: QuestProgress, meta: PlayerMeta): void {
  const quest = QUESTS[qp.questId];
  const ready = quest.objectives.every(
    (_obj, i) => qp.counts[i] >= questObjectiveRequired(quest, qp, i),
  );
  if (ready && qp.state === 'active') {
    qp.state = 'ready';
    ctx.emit({ type: 'questReady', questId: qp.questId, pid: meta.entityId });
    ctx.emit({
      type: 'log',
      text: `${quest.name} (Complete)`,
      color: '#ff0',
      pid: meta.entityId,
    });
  } else if (!ready && qp.state === 'ready') {
    qp.state = 'active';
  }
}
