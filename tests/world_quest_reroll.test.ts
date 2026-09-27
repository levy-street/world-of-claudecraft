import { describe, expect, it } from 'vitest';
import { QuestWorldWireState } from '../src/net/quest_world_wire_state';
import { Sim } from '../src/sim/sim';
import {
  canRerollWorldQuest,
  playerActiveWorldQuests,
  rerollWorldQuest,
} from '../src/sim/world_quest_reroll';
import { activeWorldQuestsForCycle, WORLD_QUESTS_BY_ZONE } from '../src/sim/world_quest_rotation';
import { restoreWorldQuestState, savedWorldQuestState } from '../src/sim/world_quest_state';
import { awardWorldQuest } from '../src/sim/world_quests';

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

    // In-progress quest cannot be rerolled
    meta.worldQuestLog.set(eastbrookQuest.id, {
      questId: eastbrookQuest.id,
      count: 2,
      state: 'active',
    });
    const checkProgress = canRerollWorldQuest(meta, eastbrookQuest.id, cycle, 20);
    expect(checkProgress.canReroll).toBe(false);
    expect(checkProgress.reason).toBe('In-progress world quests cannot be rerolled.');

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
