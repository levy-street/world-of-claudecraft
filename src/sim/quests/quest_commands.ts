// Quest command surface (session W4), MOVED verbatim out of the Sim monolith behind
// the SimContext seam. These are the inline IWorld quest VERBS the coordinator used
// to host: questState + acceptQuest/acceptLinkedQuest/abandonQuest/turnInQuest, plus
// the private helper questNpcFor (NPC-proximity scan), the two exported reward cores
// finalizeQuestAccept (accept) and turnInQuestCore (turn-in) that quests/
// dev_quest_commands.ts reuses so the /dev completer cannot drift from a normal
// turn-in, and the pure free fn computeQuestState. Sim keeps thin
// same-named facade delegates (the widened `pid?` overload preserved) so the IWorld
// surface, server/game.ts, and the in-file interaction path (talkToNpc) resolve them
// on the Sim facade unchanged; each delegate forwards via this.ctx.
//
// Immutability waiver (sim move): turnInQuestCore / finalizeQuestAccept / abandonQuest
// mutate the live PlayerMeta in place (questLog set/delete, questsDone.add, counters,
// copper). These are shared references the engine mutates; the bodies move as-is, NOT
// rewritten to immutable patterns. They draw NO rng.
//
// The quest-credit awarding math (onMobKilledForQuests / onInventoryChangedForQuests /
// checkQuestReady) lives in quest_credit.ts (Q1); this module CONSUMES the
// onInventoryChangedForQuests hook via ctx. The interaction predicate
// isQuestInteractionEntity stays on Sim (W3 region) and is reached through ctx.
//
// src/sim-pure: imports only sibling sim types/data + the format_money leaf (no
// render/ui/game/net/DOM/Three, no Math.random/Date.now), so it runs unchanged in
// Node, the browser, and the headless RL env.

import { bagCapacity, bagsFullError, countFit, removeStacked } from '../bags';
import { QUESTS, questRewardItemId } from '../data';
import { formatMoney } from '../format_money';
import { questFallbackGrants } from '../quest_fallback';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import {
  dist2d,
  type Entity,
  INTERACT_RANGE,
  type QuestDef,
  type QuestProgress,
  type QuestState,
  questTurnInNpcIds,
} from '../types';

// Pure quest-state computation, shared by the sim and the network client. Relocated
// from sim.ts (W4) and re-exported from sim.ts so the ClientWorld import
// (`import { computeQuestState } from '../sim/sim'`) stays byte-identical.
export function computeQuestState(
  questId: string,
  questLog: Map<string, QuestProgress>,
  questsDone: Set<string>,
  playerLevel: number,
): QuestState {
  if (questsDone.has(questId)) return 'done';
  const qp = questLog.get(questId);
  if (qp) return qp.state === 'ready' ? 'ready' : 'active';
  const quest = QUESTS[questId];
  if (!quest) return 'unavailable';
  if (quest.requiresQuest && !questsDone.has(quest.requiresQuest)) return 'unavailable';
  if (quest.minLevel && playerLevel < quest.minLevel) return 'unavailable';
  if (quest.retired) return 'unavailable';
  return 'available';
}

export function questState(ctx: SimContext, questId: string, pid?: number): QuestState {
  const r = ctx.resolve(pid);
  if (!r) return 'unavailable';
  return computeQuestState(questId, r.meta.questLog, r.meta.questsDone, r.e.level);
}

function questNpcFor(
  ctx: SimContext,
  questId: string,
  role: 'giver' | 'turnIn',
  p: Entity,
): { npc: Entity | null; tooFar: boolean } {
  const quest = QUESTS[questId];
  const templateIds = role === 'giver' ? [quest.giverNpcId] : questTurnInNpcIds(quest);
  let sawNpc = false;
  for (const e of ctx.entities.values()) {
    if (!ctx.isQuestInteractionEntity(e) || !templateIds.includes(e.templateId)) continue;
    if (role === 'giver' && e.kind !== 'npc') continue;
    sawNpc = true;
    if (dist2d(p.pos, e.pos) <= INTERACT_RANGE + 2) return { npc: e, tooFar: false };
  }
  return { npc: null, tooFar: sawNpc };
}

// Shared accept core for the NPC, linked-share, AND /dev completer paths. Records
// progress, then re-grants any requiredItem the player no longer holds so a lost
// prerequisite item can never permanently block the quest, and announces the accept.
// Every accept path goes through here so they cannot drift (notably this re-grant);
// exported so quests/dev_quest_commands.ts reuses it instead of cloning it.
export function finalizeQuestAccept(
  ctx: SimContext,
  questId: string,
  quest: QuestDef,
  meta: PlayerMeta,
): void {
  meta.questLog.set(questId, { questId, counts: quest.objectives.map(() => 0), state: 'active' });
  for (const itemId of questFallbackGrants(quest, (id) => ctx.countItem(id, meta.entityId) > 0)) {
    ctx.addItem(itemId, 1, meta.entityId);
  }
  ctx.emit({ type: 'questAccepted', questId, pid: meta.entityId });
  ctx.emit({
    type: 'log',
    text: `Quest accepted: ${quest.name}`,
    color: '#ff0',
    pid: meta.entityId,
  });
  ctx.onInventoryChangedForQuests(meta);
}

export function acceptQuest(ctx: SimContext, questId: string, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const quest = QUESTS[questId];
  const { meta, e: p } = r;
  // Dead players (released ghosts included) cannot deal with quest givers.
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  if (!quest) {
    ctx.error(meta.entityId, 'That quest is not available.');
    return;
  }
  if (questState(ctx, questId, meta.entityId) !== 'available') {
    ctx.error(meta.entityId, 'That quest is not available.');
    return;
  }
  const nearby = questNpcFor(ctx, questId, 'giver', p);
  if (!nearby.npc) {
    ctx.error(meta.entityId, nearby.tooFar ? 'Too far away.' : 'That quest giver is not nearby.');
    return;
  }
  finalizeQuestAccept(ctx, questId, quest, meta);
}

export function acceptLinkedQuest(
  ctx: SimContext,
  questId: string,
  sharerPid: number,
  pid?: number,
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta } = r;
  const quest = QUESTS[questId];
  if (!quest || quest.retired || quest.shareable === false) {
    ctx.error(meta.entityId, "This quest can't be shared.");
    return;
  }
  const myParty = ctx.partyOf(meta.entityId);
  const sharerParty = ctx.partyOf(sharerPid);
  const sharer = ctx.players.get(sharerPid);
  if (!myParty || !sharerParty || myParty.id !== sharerParty.id) {
    const sharerName = sharer ? sharer.name : 'that player';
    ctx.error(meta.entityId, `You must be in ${sharerName}'s party to accept that quest.`);
    return;
  }
  if (questState(ctx, questId, meta.entityId) !== 'available') {
    ctx.error(meta.entityId, 'That quest is not available.');
    return;
  }
  finalizeQuestAccept(ctx, questId, quest, meta);
  if (sharer) ctx.notice(sharerPid, `${meta.name} accepted your shared quest.`);
}

export function abandonQuest(ctx: SimContext, questId: string, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta } = r;
  if (!meta.questLog.has(questId)) return;
  meta.questLog.delete(questId);
  ctx.emit({
    type: 'log',
    text: `Quest abandoned: ${QUESTS[questId].name}`,
    color: '#f66',
    pid: meta.entityId,
  });
}

export function turnInQuest(ctx: SimContext, questId: string, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  // Dead players (released ghosts included) cannot turn in quests.
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  const quest = QUESTS[questId];
  if (!quest) {
    ctx.error(meta.entityId, 'That quest is not available.');
    return;
  }
  const qp = meta.questLog.get(questId);
  if (!qp) {
    ctx.error(meta.entityId, 'That quest is not in your log.');
    return;
  }
  if (qp.state !== 'ready') {
    ctx.error(meta.entityId, 'That quest is not complete.');
    return;
  }
  const nearby = questNpcFor(ctx, questId, 'turnIn', p);
  if (!nearby.npc) {
    ctx.error(meta.entityId, nearby.tooFar ? 'Too far away.' : 'That quest turn-in is not nearby.');
    return;
  }
  // Capacity gate (classic): the reward must fit AFTER the collect items are
  // handed in, so simulate the hand-in on a scratch copy before committing.
  const rewardItem = questRewardItemId(quest, meta.cls);
  if (rewardItem) {
    const scratch = meta.inventory.map((s) => ({ ...s }));
    for (const obj of quest.objectives) {
      if (obj.type === 'collect' && obj.itemId) removeStacked(scratch, obj.itemId, obj.count);
    }
    if (countFit(scratch, bagCapacity(meta.bags), rewardItem, 1) < 1) {
      bagsFullError(ctx, meta.entityId);
      return;
    }
  }

  turnInQuestCore(ctx, questId, quest, meta);
}

// Shared turn-in reward core: consumes the collect items, marks the quest done, and
// grants the copper/item/xp rewards plus the questDone + completion log. The caller
// MUST have already verified the quest is in the log and 'ready' (turnInQuest does
// the state + NPC-proximity checks; the /dev completer forces the objectives ready).
// Both the NPC turn-in and quests/dev_quest_commands.ts go through here so the reward
// math cannot drift.
export function turnInQuestCore(
  ctx: SimContext,
  questId: string,
  quest: QuestDef,
  meta: PlayerMeta,
): void {
  const qp = meta.questLog.get(questId);
  if (!qp) return;
  for (const obj of quest.objectives) {
    if (obj.type === 'collect' && obj.itemId) ctx.removeItem(obj.itemId, obj.count, meta.entityId);
  }
  qp.state = 'done';
  meta.questLog.delete(questId);
  meta.questsDone.add(questId);
  meta.counters.questsCompleted++;
  if (quest.copperReward > 0) {
    meta.copper += quest.copperReward;
    ctx.emit({
      type: 'loot',
      text: `You receive ${formatMoney(quest.copperReward)}.`,
      pid: meta.entityId,
    });
  }
  const rewardItem = questRewardItemId(quest, meta.cls);
  if (rewardItem) ctx.addItem(rewardItem, 1, meta.entityId);
  ctx.grantXp(quest.xpReward, meta);
  ctx.emit({ type: 'questDone', questId, pid: meta.entityId });
  ctx.emit({
    type: 'log',
    text: `Quest completed: ${quest.name}`,
    color: '#ff0',
    pid: meta.entityId,
  });
  // Quests with an authored Ravenpost letter have their giver write to the
  // player a little while after the turn-in (mail/post_office.ts).
  ctx.queueQuestLetter(questId, meta.entityId);
}
