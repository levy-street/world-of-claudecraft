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
import type { Entity, QuestProgress } from '../types';

export function onMobKilledForQuests(ctx: SimContext, mob: Entity, meta: PlayerMeta): void {
  for (const qp of meta.questLog.values()) {
    if (qp.state !== 'active') continue;
    const quest = QUESTS[qp.questId];
    let changed = false;
    quest.objectives.forEach((obj, i) => {
      if (obj.type === 'kill' && obj.targetMobId === mob.templateId && qp.counts[i] < obj.count) {
        qp.counts[i]++;
        changed = true;
        meta.counters.questProgress++;
        ctx.emit({
          type: 'questProgress',
          questId: qp.questId,
          text: `${obj.label}: ${qp.counts[i]}/${obj.count}`,
          pid: meta.entityId,
        });
      }
    });
    if (changed) checkQuestReady(ctx, qp, meta);
  }
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
        const have = Math.min(obj.count, ctx.countItem(obj.itemId, meta.entityId));
        if (have !== qp.counts[i]) {
          if (have > qp.counts[i]) meta.counters.questProgress += have - qp.counts[i];
          qp.counts[i] = have;
          changed = true;
          ctx.emit({
            type: 'questProgress',
            questId: qp.questId,
            text: `${obj.label}: ${have}/${obj.count}`,
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
  const ready = quest.objectives.every((obj, i) => qp.counts[i] >= obj.count);
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
