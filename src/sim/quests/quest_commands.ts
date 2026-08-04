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

import { bagCapacity, bagsFullError, consumeOneScratch, countFit, countStacked } from '../bags';
import { ITEMS, QUESTS, questRewardItemId } from '../data';
import { formatMoney } from '../format_money';
import { removePreferFungible } from '../items';
import type { ArchetypeState } from '../professions/archetype';
import { armCadence, cadenceBlockedKeys } from '../professions/cadence';
import { planGradeRemoval } from '../professions/material_grades';
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
  questObjectiveRequired,
  questTurnInNpcIds,
} from '../types';
import {
  applyProfessionQuestEffect,
  isIdentityTransitionQuest,
  professionQuestSelectionTargets,
  resolvedQuestObjectiveCounts,
  validateProfessionQuestSelection,
} from './profession_quest_effects';
import { playerHoldsQuestItem } from './quest_item_presence';

// Pure quest-state computation, shared by the sim and the network client. Relocated
// from sim.ts (W4) and re-exported from sim.ts so the ClientWorld import
// (`import { computeQuestState } from '../sim/sim'`) stays byte-identical.
export function computeQuestState(
  questId: string,
  questLog: Map<string, QuestProgress>,
  questsDone: Set<string>,
  playerLevel: number,
  professionState?: ArchetypeState,
  // The set of quest ids currently inside their repeat-cadence window.
  // Built per-tick-domain by the caller (the Sim from PlayerMeta.questCadence +
  // ctx.tickCount, the online client from the server-computed cprof mirror), so
  // this shared decision point never reasons about tick domains itself.
  withinCadence?: ReadonlySet<string>,
): QuestState {
  const qp = questLog.get(questId);
  if (qp) return qp.state === 'ready' ? 'ready' : 'active';
  const quest = QUESTS[questId];
  if (!quest) return 'unavailable';
  if (questsDone.has(questId) && !quest.repeatable) return 'done';
  if (quest.requiresQuest && !questsDone.has(quest.requiresQuest)) return 'unavailable';
  if (quest.minLevel && playerLevel < quest.minLevel) return 'unavailable';
  if (quest.retired) return 'unavailable';
  if (
    quest.completionEffect &&
    professionState &&
    professionQuestSelectionTargets(quest, professionState).length === 0
  ) {
    return 'unavailable';
  }
  // One pending identity transition at a time: while ANY identity-transition
  // quest is active (attunePair or switchHobby, see isIdentityTransitionQuest),
  // every OTHER identity-transition quest is unavailable. Two distinct stale-bank
  // failures share this one gate, which is why its scope is both effect types
  // rather than the attunePair-only scope it originally shipped with:
  //   - resolvedCounts is stamped at accept and turn-in never re-resolves it, so
  //     a banked second amends would complete at a stale cost after the first
  //     return raised switchCount, dodging the 5 + 3 * switchCount escalation.
  //   - the hobby quest banks its chosen craft on QuestProgress at accept, but a
  //     pair transition rewrites both the candidate set and the hobby, so a bank
  //     that straddles a transition either turns in against the wrong pair or
  //     sticks unturnable-in on the revalidation below.
  // The gate lives here so both hosts and the server accept path share it (the
  // quest already in the log returned 'active' above, so it never gates itself).
  if (isIdentityTransitionQuest(quest)) {
    for (const activeId of questLog.keys()) {
      if (isIdentityTransitionQuest(QUESTS[activeId])) return 'unavailable';
    }
  }
  // A repeatable work order inside its cooldown window is unavailable until it
  // lapses (the turn-in armed it; the window is server-authoritative and mirrors
  // to the online client via cprof).
  if (withinCadence?.has(questId)) return 'unavailable';
  return 'available';
}

export function questState(ctx: SimContext, questId: string, pid?: number): QuestState {
  const r = ctx.resolve(pid);
  if (!r) return 'unavailable';
  const withinCadence =
    r.meta.questCadence.size > 0
      ? new Set(cadenceBlockedKeys(r.meta.questCadence, ctx.tickCount))
      : undefined;
  return computeQuestState(
    questId,
    r.meta.questLog,
    r.meta.questsDone,
    r.e.level,
    r.meta.archetype,
    withinCadence,
  );
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
  selection?: string,
): boolean {
  if (!validateProfessionQuestSelection(quest, meta, selection)) return false;
  // The riding lesson is pickable only after the 80g skill purchase at Marla.
  // Gated here so the npc, linked-share, and dev accept paths cannot drift.
  if (quest.requiresRidingTrained && !meta.ridingTrained) {
    ctx.error(meta.entityId, 'You must learn Riding before taking this lesson.');
    return false;
  }
  meta.questLog.set(questId, {
    questId,
    counts: quest.objectives.map(() => 0),
    state: 'active',
    ...(selection === undefined ? {} : { selection }),
    resolvedCounts: resolvedQuestObjectiveCounts(quest, meta),
    // Stamp the objective-list revision so a later rework (a rev bump) resets
    // only runs accepted under the OLD list (quest_progress_migration.ts).
    ...(quest.rev === undefined ? {} : { rev: quest.rev }),
  });
  // The re-grant predicate spans every store the player can recover the item
  // from alone (bags, bank, market escrow, mailbox), not just the bags: a
  // bags-only read was the unbounded starter-tool mint (bank it, abandon,
  // re-accept, repeat). See quest_item_presence.ts for the full reasoning.
  for (const itemId of questFallbackGrants(quest, (id) => playerHoldsQuestItem(ctx, meta, id))) {
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
  return true;
}

export function acceptQuest(
  ctx: SimContext,
  questId: string,
  selectionOrPid?: string | number,
  pid?: number,
): void {
  const selection = typeof selectionOrPid === 'string' ? selectionOrPid : undefined;
  const resolvedPid = typeof selectionOrPid === 'number' ? selectionOrPid : pid;
  const r = ctx.resolve(resolvedPid);
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
  if (!validateProfessionQuestSelection(quest, meta, selection)) {
    ctx.error(meta.entityId, 'That profession choice is not available.');
    return;
  }
  const nearby = questNpcFor(ctx, questId, 'giver', p);
  if (!nearby.npc) {
    ctx.error(meta.entityId, nearby.tooFar ? 'Too far away.' : 'That quest giver is not nearby.');
    return;
  }
  finalizeQuestAccept(ctx, questId, quest, meta, selection);
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

// Strip a quest's OWN required items (the firebottle for q_deepfen_purge) from the
// bag on turn-in and abandon, so a finished quest never leaves its tool behind.
// Scoped HARD to items the quest itself owns (kind 'quest' with a matching questId):
// requiredItems is the fallback-grant list (quest_fallback.ts) and its other users
// are durable prerequisites the player keeps, the profession tools (the mining pick,
// the gathering sickle) and cross-quest keys (the Crypt Keystone). Stripping those
// would delete a tool the always-require-tool harvest gate still needs.
function stripRequiredItems(ctx: SimContext, quest: QuestDef, meta: PlayerMeta): void {
  for (const itemId of quest.requiredItems ?? []) {
    const def = ITEMS[itemId];
    if (!def || def.kind !== 'quest' || def.questId !== quest.id) continue;
    const have = ctx.countItem(itemId, meta.entityId);
    if (have > 0) ctx.removeItem(itemId, have, meta.entityId);
  }
}

// Talking to the giver of an ACTIVE quest re-grants any required item the player
// no longer holds anywhere they could recover it from themselves (a deleted
// firebottle for q_deepfen_purge, say), so a lost prerequisite can never
// permanently strand the quest. The accept path does the same grant
// (finalizeQuestAccept); this is its in-progress twin, and it MUST use the same
// playerHoldsQuestItem predicate: a bags-only read here would reopen the
// unbounded starter-tool mint (bank the tool, talk to the giver, repeat) that
// quest_item_presence.ts exists to close.
export function regrantMissingQuestItems(
  ctx: SimContext,
  meta: PlayerMeta,
  npcTemplateId: string,
): void {
  for (const qp of meta.questLog.values()) {
    if (qp.state !== 'active') continue;
    const quest = QUESTS[qp.questId];
    if (!quest || quest.giverNpcId !== npcTemplateId || !quest.requiredItems) continue;
    for (const itemId of questFallbackGrants(quest, (id) => playerHoldsQuestItem(ctx, meta, id))) {
      ctx.addItem(itemId, 1, meta.entityId);
      ctx.emit({
        type: 'log',
        text: 'You recover a quest item you were missing.',
        color: '#ff0',
        pid: meta.entityId,
      });
    }
  }
}

export function abandonQuest(ctx: SimContext, questId: string, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta } = r;
  if (!meta.questLog.has(questId)) return;
  stripRequiredItems(ctx, QUESTS[questId], meta);
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
  if (!validateProfessionQuestSelection(quest, meta, qp.selection)) {
    ctx.error(meta.entityId, 'That profession choice is no longer available.');
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
      if (obj.type === 'collect' && obj.itemId) {
        const index = quest.objectives.indexOf(obj);
        // The same grade plan turnInQuestCore applies, against the scratch
        // copy, so the room this gate frees is the room the hand-in frees.
        // Per unit through consumeOneScratch (no exclusion), the scratch
        // mirror of removePreferFungible's plain-first walk below: a gate
        // that models the removal differently from the remover it gates
        // re-opens the overflow class (#2139).
        for (const take of planGradeRemoval(
          obj.itemId,
          questObjectiveRequired(quest, qp, index),
          (id) => countStacked(scratch, id),
        )) {
          for (let unit = 0; unit < take.count; unit++) {
            consumeOneScratch(scratch, take.itemId);
          }
        }
      }
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
): boolean {
  const qp = meta.questLog.get(questId);
  if (!qp) return false;
  if (!applyProfessionQuestEffect(ctx, quest, qp, meta)) return false;
  for (const [index, obj] of quest.objectives.entries()) {
    if (obj.type === 'collect' && obj.itemId) {
      // Base grade first, then the fine grade, so a player holding both hands
      // over the plain ore and keeps the premium copies. Within each grade
      // line, plain stacks are spent before instanced copies
      // (removePreferFungible's own plain-first walk): a signed specimen
      // survives any turn-in that plain copies can pay, and is consumed only
      // when nothing plain remains. The trade and vendor arms additionally
      // deprioritize the owner's self-signed CHARM copies; that charm-scoped
      // rule is deliberately absent here because no shipped quest collects a
      // charm (the grade-pool guard in tests/material_grades.test.ts keeps
      // the collect vocabulary honest).
      for (const take of planGradeRemoval(
        obj.itemId,
        questObjectiveRequired(quest, qp, index),
        (id) => ctx.countItem(id, meta.entityId),
      )) {
        removePreferFungible(ctx, take.itemId, take.count, meta.entityId);
      }
    }
  }
  // Required items (tools, not rewards) leave with the finished quest, so a spent
  // firebottle does not linger in the bag after "Back to the Shallows".
  stripRequiredItems(ctx, quest, meta);
  qp.state = 'done';
  meta.questLog.delete(questId);
  const firstCompletion = !meta.questsDone.has(questId);
  meta.questsDone.add(questId);
  if (firstCompletion) meta.counters.questsCompleted++;
  // Quest and chapter deed predicates read questsDone, so re-check this player.
  ctx.markDeedsDirty(meta.entityId);
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
  // Arm the repeat-cadence window (work orders): the quest stays
  // unavailable (computeQuestState) until now + repeatCadenceTicks, server-
  // authoritative and persisted per character with zero-default omission.
  if (quest.repeatCadenceTicks && quest.repeatCadenceTicks > 0) {
    armCadence(meta.questCadence, questId, ctx.tickCount, quest.repeatCadenceTicks);
  }
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
  return true;
}
