import { describe, expect, it } from 'vitest';
import { QuestWorldWireState } from '../src/net/quest_world_wire_state';
import {
  SHADOW_GUARDS,
  SHADOW_NPC_DEF,
  SHADOW_NPC_ID,
  SHADOW_QUEST_ID,
} from '../src/sim/content/world_quest_shadow';
import { BUILTIN_WORLD } from '../src/sim/data';
import { hasShadowCloak } from '../src/sim/shadow_action_lock';
import { Sim } from '../src/sim/sim';
import {
  hasWorldQuestDeliveryCargo,
  takeWorldQuestDeliveryCargo,
} from '../src/sim/world_quest_delivery';
import {
  canRerollWorldQuest,
  playerActiveWorldQuests,
  rerollWorldQuest,
} from '../src/sim/world_quest_reroll';
import { activeWorldQuestsForCycle, WORLD_QUESTS_BY_ZONE } from '../src/sim/world_quest_rotation';
import { restoreWorldQuestState, savedWorldQuestState } from '../src/sim/world_quest_state';
import { awardWorldQuest } from '../src/sim/world_quests';
import { WORLD_SEED } from '../src/sim/world_seed';

describe('World Quest Reroll Mechanism', () => {
  const cycle = 'wq1_100';

  it('validates reroll eligibility correctly', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    const meta = sim.meta(sim.playerId);
    expect(meta).toBeDefined();
    if (!meta) return;
    meta.devWorldQuestCycle = cycle;
    meta.worldQuestCycle = cycle;
    const active = playerActiveWorldQuests(meta, cycle);
    const eastbrookQuest = active.find((q) => q.zoneId === 'eastbrook_vale');
    if (!eastbrookQuest) throw new Error('Expected Eastbrook quest');

    // Initially eligible for incomplete quest
    const check1 = canRerollWorldQuest(meta, eastbrookQuest.id, cycle, 20);
    expect(check1.canReroll).toBe(true);
    expect(check1.replacementId).toBeDefined();
    expect(check1.replacementId).not.toBe(eastbrookQuest.id);

    // An in-progress quest can be replaced, on the sim and the online mirror alike
    meta.worldQuestLog.set(eastbrookQuest.id, {
      questId: eastbrookQuest.id,
      count: 2,
      state: 'active',
    });
    const checkProgress = canRerollWorldQuest(meta, eastbrookQuest.id, cycle, 20);
    expect(checkProgress.canReroll).toBe(true);
    expect(checkProgress.replacementId).toBe(check1.replacementId);
    const progressClient = new QuestWorldWireState();
    progressClient.applyQuestSelfSnapshot({
      wqday: cycle,
      wqlog: [...meta.worldQuestLog.values()],
    });
    expect(progressClient.worldQuestLog.get(eastbrookQuest.id)?.count).toBe(2);
    expect(progressClient.canRerollWorldQuest(eastbrookQuest.id)).toEqual({ canReroll: true });

    // Completed quest cannot be rerolled
    meta.worldQuestLog.set(eastbrookQuest.id, {
      questId: eastbrookQuest.id,
      count: eastbrookQuest.count,
      state: 'completed',
    });
    const checkCompleted = canRerollWorldQuest(meta, eastbrookQuest.id, cycle, 20);
    expect(checkCompleted.canReroll).toBe(false);
    expect(checkCompleted.reason).toBe('Completed world quests cannot be rerolled.');
    meta.worldQuestLog.set(eastbrookQuest.id, {
      questId: eastbrookQuest.id,
      count: 0,
      state: 'active',
      practiceOnly: true,
    });
    expect(canRerollWorldQuest(meta, eastbrookQuest.id, cycle, 20)).toEqual(checkCompleted);
    const client = new QuestWorldWireState();
    client.applyQuestSelfSnapshot({ wqday: cycle, wqlog: [...meta.worldQuestLog.values()] });
    expect(client.worldQuestLog.get(eastbrookQuest.id)?.practiceOnly).toBe(true);
    expect(client.canRerollWorldQuest(eastbrookQuest.id).canReroll).toBe(false);

    // A zone with no alternative left reports the honest unavailable state.
    // Thornpeak's pool is four deep since the round-2 zone hunts, so the other
    // three are turned in first (a completed quest is never a reroll target).
    const thornpeakQuest = active.find((q) => q.zoneId === 'thornpeak_heights');
    if (!thornpeakQuest) throw new Error('Expected Thornpeak quest');
    for (const id of WORLD_QUESTS_BY_ZONE.thornpeak_heights) {
      if (id === thornpeakQuest.id) continue;
      meta.worldQuestLog.set(id, { questId: id, count: 0, state: 'completed' });
    }
    const checkSingle = canRerollWorldQuest(meta, thornpeakQuest.id, cycle, 20);
    expect(checkSingle.canReroll).toBe(false);
    expect(checkSingle.reason).toBe('No alternative assignments available in this zone today.');
  });

  it('enforces one reroll per cycle limit', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    const meta = sim.meta(sim.playerId);
    expect(meta).toBeDefined();
    if (!meta) return;
    meta.devWorldQuestCycle = cycle;
    meta.worldQuestCycle = cycle;
    const active = playerActiveWorldQuests(meta, cycle);
    const eastbrookQuest = active.find((q) => q.zoneId === 'eastbrook_vale');
    if (!eastbrookQuest) throw new Error('Expected Eastbrook quest');

    const success = rerollWorldQuest(sim.ctx, meta, eastbrookQuest.id);
    expect(success).toBe(true);
    expect(meta.worldQuestRerollCycle).toBe(cycle);

    // Attempting another reroll in the same cycle fails
    const mirefenQuest = active.find((q) => q.zoneId === 'mirefen_marsh');
    if (!mirefenQuest) throw new Error('Expected Mirefen quest');
    const secondReroll = rerollWorldQuest(sim.ctx, meta, mirefenQuest.id);
    expect(secondReroll).toBe(false);

    const check = canRerollWorldQuest(meta, mirefenQuest.id, cycle, 20);
    expect(check.canReroll).toBe(false);
    expect(check.reason).toBe('Daily world quest reroll already used today.');
  });

  it('replaces active quests cleanly and updates player offering', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    const meta = sim.meta(sim.playerId);
    expect(meta).toBeDefined();
    if (!meta) return;
    meta.devWorldQuestCycle = cycle;
    meta.worldQuestCycle = cycle;
    const baseQuests = activeWorldQuestsForCycle(cycle);
    const eastbrookOriginal = baseQuests.find((q) => q.zoneId === 'eastbrook_vale');
    if (!eastbrookOriginal) throw new Error('Expected Eastbrook quest');

    const ok = sim.rerollWorldQuest(eastbrookOriginal.id);
    expect(ok).toBe(true);

    const updatedQuests = playerActiveWorldQuests(meta, cycle);
    expect(updatedQuests.length).toBe(baseQuests.length);
    expect(updatedQuests.some((q) => q.id === eastbrookOriginal.id)).toBe(false);

    const replacement = updatedQuests.find((q) => q.zoneId === 'eastbrook_vale');
    if (!replacement) throw new Error('Expected replacement Eastbrook quest');
    expect(replacement.id).not.toBe(eastbrookOriginal.id);
    expect(meta.worldQuestReplacements[eastbrookOriginal.id]).toBe(replacement.id);
  });

  it('persists and restores reroll cycle and replacements across save/load', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    const meta = sim.meta(sim.playerId);
    expect(meta).toBeDefined();
    if (!meta) return;
    meta.devWorldQuestCycle = cycle;
    meta.worldQuestCycle = cycle;
    const active = playerActiveWorldQuests(meta, cycle);
    const eastbrookQuest = active.find((q) => q.zoneId === 'eastbrook_vale');
    if (!eastbrookQuest) throw new Error('Expected Eastbrook quest');

    sim.rerollWorldQuest(eastbrookQuest.id);
    const replacementId = meta.worldQuestReplacements[eastbrookQuest.id];
    expect(replacementId).toBeDefined();

    const saved = savedWorldQuestState(meta);
    expect(saved.worldQuests?.rerollCycle).toBe(cycle);
    expect(saved.worldQuests?.replacements?.[eastbrookQuest.id]).toBe(replacementId);

    // Restore into a fresh PlayerMeta on the SAME cycle
    const freshSim = new Sim({ seed: 43, playerClass: 'mage', autoEquip: true });
    freshSim.setPlayerLevel(20);
    const freshMeta = freshSim.meta(freshSim.playerId);
    expect(freshMeta).toBeDefined();
    if (!freshMeta) return;
    restoreWorldQuestState(freshMeta, saved.worldQuests, saved.factions);
    expect(freshMeta.worldQuestRerollCycle).toBe(cycle);
    const freshActive = playerActiveWorldQuests(freshMeta, cycle);
    expect(freshActive.some((q) => q.id === replacementId)).toBe(true);
    expect(freshActive.some((q) => q.id === eastbrookQuest.id)).toBe(false);

    // Restore on a NEW cycle clears the reroll allowance and replacements
    const nextCycle = 'wq1_101';
    const nextSaved = {
      ...saved.worldQuests,
      cycle: nextCycle,
      // old rerollCycle preserved from previous day
      rerollCycle: cycle,
    };
    const nextSim = new Sim({ seed: 44, playerClass: 'priest', autoEquip: true });
    nextSim.setPlayerLevel(20);
    const nextMeta = nextSim.meta(nextSim.playerId);
    expect(nextMeta).toBeDefined();
    if (!nextMeta) return;
    restoreWorldQuestState(nextMeta, nextSaved as typeof saved.worldQuests, saved.factions);
    expect(nextMeta.worldQuestRerollCycle).toBe('');
    expect(Object.keys(nextMeta.worldQuestReplacements).length).toBe(0);
  });

  it('awards faction standing when completing the replacement quest', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    const meta = sim.meta(sim.playerId);
    expect(meta).toBeDefined();
    if (!meta) return;
    meta.devWorldQuestCycle = cycle;
    meta.worldQuestCycle = cycle;
    const active = playerActiveWorldQuests(meta, cycle);
    const drakelandsQuest = active.find((q) => q.zoneId === 'drakelands');
    if (!drakelandsQuest) throw new Error('Expected Drakelands quest');

    sim.rerollWorldQuest(drakelandsQuest.id);
    const replacementId = meta.worldQuestReplacements[drakelandsQuest.id];
    const replacementDef = playerActiveWorldQuests(meta, cycle).find((q) => q.id === replacementId);
    if (!replacementDef) throw new Error('Expected replacement def');

    expect(meta.factions.automatons).toBe(0);
    awardWorldQuest(sim.ctx, meta, replacementDef);
    // At level 20, Automatons WQ awards +100 standing
    expect(meta.factions.automatons).toBe(100);
  });
});

describe('Replacing an in-progress World Quest', () => {
  it('drops the progress and the freight a delivery run is carrying', () => {
    const deliveryCycle = 'wq1_105';
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    const meta = sim.meta(sim.playerId);
    if (!meta) throw new Error('Expected player meta');
    meta.devWorldQuestCycle = deliveryCycle;
    meta.worldQuestCycle = deliveryCycle;
    const quest = playerActiveWorldQuests(meta, deliveryCycle).find(
      (q) => q.id === 'wq_eastbrook_bandits',
    );
    if (quest?.objective.type !== 'delivery') throw new Error('Expected the delivery quest');
    meta.worldQuestLog.set(quest.id, { questId: quest.id, count: 3, state: 'active' });
    meta.worldQuestAreas.add(quest.id);
    expect(takeWorldQuestDeliveryCargo(sim.ctx, sim.player)).toBe(true);

    expect(sim.rerollWorldQuest(quest.id)).toBe(true);

    expect(hasWorldQuestDeliveryCargo(sim.player)).toBe(false);
    expect(meta.worldQuestLog.has(quest.id)).toBe(false);
    expect(meta.worldQuestAreas.has(quest.id)).toBe(false);
    const replacementId = meta.worldQuestReplacements[quest.id];
    expect(replacementId).toBeDefined();
    expect(meta.worldQuestLog.has(replacementId)).toBe(false);
    const slate = playerActiveWorldQuests(meta, deliveryCycle).map((q) => q.id);
    expect(slate).toContain(replacementId);
    expect(slate).not.toContain(quest.id);
  });

  it('strips the borrowed cloak from a stealth run mid-heist', () => {
    const sim = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      devCommands: true,
      world: {
        ...BUILTIN_WORLD,
        camps: [],
        groundObjects: [],
        npcs: Object.fromEntries(
          [SHADOW_NPC_DEF, ...SHADOW_GUARDS.map((row) => row.npc)].map((npc) => [npc.id, npc]),
        ),
      },
    });
    sim.resetDay = '2026-09-06';
    sim.chat('/dev shadow');
    sim.talkToNpc(SHADOW_NPC_ID);
    const meta = sim.meta(sim.playerId);
    if (!meta) throw new Error('Expected player meta');
    const progress = meta.worldQuestLog.get(SHADOW_QUEST_ID);
    if (!progress) throw new Error('Expected the stealth quest to be running');
    progress.count = 1;
    expect(hasShadowCloak(sim.player)).toBe(true);
    expect(sim.canRerollWorldQuest(SHADOW_QUEST_ID).canReroll).toBe(true);

    expect(sim.rerollWorldQuest(SHADOW_QUEST_ID)).toBe(true);

    // Checked before any tick: the encounter's own tick would also strip a
    // rowless cloak, so only this read proves the reroll tore it down itself.
    expect(hasShadowCloak(sim.player)).toBe(false);
    expect(sim.player.stealthed).toBe(false);
    expect(meta.worldQuestLog.has(SHADOW_QUEST_ID)).toBe(false);
    expect(meta.worldQuestReplacements[SHADOW_QUEST_ID]).toBeDefined();
  });
});
