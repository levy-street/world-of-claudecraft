import { QUESTS } from '../data';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { QuestDef, QuestProgress } from '../types';
import { finalizeQuestAccept, questState, turnInQuestCore } from './quest_commands';

// /dev quest-completion cheats (gated by ctx.devCommands / ALLOW_DEV_COMMANDS). They
// force a quest to completion for testing: accept it if needed, satisfy its
// objectives, then turn it in. The accept and turn-in reward steps reuse the shared
// authoritative cores (finalizeQuestAccept / turnInQuestCore) from quest_commands.ts,
// so a /dev completion grants exactly what a normal NPC turn-in would and cannot
// drift from it.

function satisfyTrackedQuestForDev(
  ctx: SimContext,
  quest: QuestDef,
  qp: QuestProgress,
  meta: PlayerMeta,
): void {
  let collectChanged = false;
  quest.objectives.forEach((obj, index) => {
    if (obj.type === 'collect' && obj.itemId) {
      const have = ctx.countItem(obj.itemId, meta.entityId);
      if (have < obj.count) {
        ctx.addItem(obj.itemId, obj.count - have, meta.entityId);
        collectChanged = true;
      }
      return;
    }
    const next = Math.max(qp.counts[index] ?? 0, obj.count);
    if (next !== qp.counts[index]) {
      meta.counters.questProgress += next - (qp.counts[index] ?? 0);
      qp.counts[index] = next;
      ctx.emit({
        type: 'questProgress',
        questId: qp.questId,
        text: `${obj.label}: ${qp.counts[index]}/${obj.count}`,
        pid: meta.entityId,
      });
    }
  });
  if (collectChanged) ctx.onInventoryChangedForQuests(meta);
  ctx.checkQuestReady(qp, meta);
}

function trackedQuestForDev(
  ctx: SimContext,
  questId: string,
  meta: PlayerMeta,
): { quest: QuestDef; qp: QuestProgress } | null {
  const active = meta.questLog.get(questId);
  const quest = QUESTS[questId];
  if (active && quest) return { quest, qp: active };
  if (!quest) {
    ctx.error(meta.entityId, 'That quest is not available.');
    return null;
  }
  if (questState(ctx, questId, meta.entityId) !== 'available') {
    ctx.error(meta.entityId, 'That quest is not available.');
    return null;
  }
  finalizeQuestAccept(ctx, questId, quest, meta);
  const qp = meta.questLog.get(questId);
  if (!qp) {
    ctx.error(meta.entityId, 'That quest is not in your log.');
    return null;
  }
  return { quest, qp };
}

function completeTrackedQuestForDev(ctx: SimContext, questId: string, meta: PlayerMeta): boolean {
  const tracked = trackedQuestForDev(ctx, questId, meta);
  if (!tracked) return false;
  satisfyTrackedQuestForDev(ctx, tracked.quest, tracked.qp, meta);
  if (tracked.qp.state !== 'ready') {
    ctx.error(meta.entityId, 'That quest is not complete.');
    return false;
  }
  turnInQuestCore(ctx, questId, tracked.quest, meta);
  return meta.questsDone.has(questId);
}

export function completeQuestForDev(ctx: SimContext, questId: string, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  return completeTrackedQuestForDev(ctx, questId, r.meta);
}

export function completeCurrentQuestsForDev(ctx: SimContext, pid?: number): number {
  const r = ctx.resolve(pid);
  if (!r) return 0;
  const ids = [...r.meta.questLog.keys()];
  if (ids.length === 0) {
    ctx.error(r.meta.entityId, 'Your quest log is empty.');
    return 0;
  }
  let completed = 0;
  for (const questId of ids) {
    if (completeTrackedQuestForDev(ctx, questId, r.meta)) completed++;
  }
  return completed;
}
