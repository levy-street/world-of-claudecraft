import { QUESTS } from '../data';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { type QuestDef, type QuestProgress, questObjectiveRequired } from '../types';
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
    const required = questObjectiveRequired(quest, qp, index);
    if (obj.type === 'collect' && obj.itemId) {
      const have = ctx.countItem(obj.itemId, meta.entityId);
      if (have < required) {
        ctx.addItem(obj.itemId, required - have, meta.entityId);
        collectChanged = true;
      }
      return;
    }
    const next = Math.max(qp.counts[index] ?? 0, required);
    if (next !== qp.counts[index]) {
      meta.counters.questProgress += next - (qp.counts[index] ?? 0);
      qp.counts[index] = next;
      ctx.emit({
        type: 'questProgress',
        questId: qp.questId,
        objectiveIndex: index,
        current: qp.counts[index],
        required,
        text: `${obj.label}: ${qp.counts[index]}/${required}`,
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

// [dev] /dev attune: mark EVERY quest complete so all requiresQuest / attunement
// gates open (notably the Nythraxis raid door, which checks
// questsDone.has('q_nythraxis_bound_guardian')). Unlike the per-quest cheats this
// does not run the accept/turn-in reward flow (which would flood a 16-slot bag with
// dozens of reward items); it just stamps questsDone and drops in-progress trackers.
// The raid entry check reads questsDone server-side, so attunement takes effect at
// once; wireRev is bumped so the client's quest log reflects it promptly.
export function completeAllQuestsForDev(ctx: SimContext, pid?: number): number {
  const r = ctx.resolve(pid);
  if (!r) return 0;
  const meta = r.meta;
  let added = 0;
  for (const questId of Object.keys(QUESTS)) {
    if (!meta.questsDone.has(questId)) {
      meta.questsDone.add(questId);
      added++;
    }
  }
  // Do NOT clear the quest log: it is persisted CharacterState, and wiping every
  // in-progress quest is a destructive, irreversible edit to the character. Stamping
  // questsDone is enough to open every requiresQuest / attunement gate.
  if (added > 0) meta.wireRev++;
  ctx.emit({
    type: 'log',
    text: `[dev] Attuned: marked ${added} quests complete (in-progress quests untouched).`,
    pid: meta.entityId,
  });
  return added;
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
