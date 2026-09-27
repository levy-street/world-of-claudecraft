import { describe, expect, it } from 'vitest';
import { WORLD_QUESTS_BY_ID } from '../src/sim/content/world_quests';
import { Sim } from '../src/sim/sim';
import { addThreat } from '../src/sim/threat';
import type { Entity } from '../src/sim/types';
import {
  WORLD_QUEST_CHAMPION_TUNING as TUNING,
  worldQuestChampionState,
  worldQuestOffersChampion,
} from '../src/sim/world_quest_champion';

const QUEST_ID = 'wq_evergarden_watch';

function armed(): Sim {
  const sim = new Sim({ seed: 31, playerClass: 'warrior', devCommands: true });
  sim.chat('/dev wq evergarden');
  sim.tick();
  const quest = WORLD_QUESTS_BY_ID[QUEST_ID];
  sim.player.pos = sim.groundPos(quest.area.x, quest.area.z);
  sim.player.prevPos = { ...sim.player.pos };
  sim.tick();
  return sim;
}

function killTargets(sim: Sim, count: number): void {
  const quest = WORLD_QUESTS_BY_ID[QUEST_ID];
  const objective = quest.objective;
  if (objective.type !== 'kill') throw new Error('expected a kill quest');
  const targets = [...sim.entities.values()].filter(
    (e) => e.kind === 'mob' && !e.dead && e.templateId === objective.targetMobId,
  );
  for (const mob of targets.slice(0, count)) {
    mob.pos = sim.groundPos(quest.area.x + 2, quest.area.z);
    sim.player.targetId = mob.id;
    sim.chat('/dev killtarget');
    sim.tick();
  }
}

function champion(sim: Sim): Entity | undefined {
  const state = worldQuestChampionState(sim.ctx, QUEST_ID);
  return state ? sim.entities.get(state.mobId) : undefined;
}

describe('the world quest champion encore', () => {
  it('offers an encore only to the plain objective families', () => {
    expect(worldQuestOffersChampion(WORLD_QUESTS_BY_ID[QUEST_ID])).toBe(true);
    expect(worldQuestOffersChampion(WORLD_QUESTS_BY_ID.wq_eastbrook_bandits)).toBe(true);
    expect(worldQuestOffersChampion(WORLD_QUESTS_BY_ID.wq_galecrest_wisps)).toBe(false);
    expect(worldQuestOffersChampion(WORLD_QUESTS_BY_ID.wq_eastbrook_shadow)).toBe(false);
  });

  it('raises a promoted champion at completion and pays every participant when it falls', () => {
    const sim = armed();
    const meta = sim.meta(sim.playerId)!;
    const quest = WORLD_QUESTS_BY_ID[QUEST_ID];
    killTargets(sim, quest.count);
    expect(meta.worldQuestLog.get(QUEST_ID)?.state).toBe('completed');
    const mob = champion(sim);
    expect(mob).toBeDefined();
    if (!mob || quest.objective.type !== 'kill') throw new Error('champion fixture');
    expect(mob.templateId).toBe(quest.objective.targetMobId);
    expect(mob.level).toBeGreaterThanOrEqual(quest.minLevel + TUNING.levelAboveQuest);
    expect(mob.scale).toBe(TUNING.scale);
    expect(mob.summonedAdd).toBe(true);
    expect(mob.runScoped).toBe(true);
    expect(Math.hypot(mob.pos.x - quest.area.x, mob.pos.z - quest.area.z)).toBeLessThan(
      TUNING.offsetYards * 1.5 + 1,
    );
    expect(mob.hostile).toBe(true);
    // A second completion while it lives never stacks a second champion.
    const before = sim.entities.size;
    meta.worldQuestLog.get(QUEST_ID)!.state = 'active';
    meta.worldQuestLog.get(QUEST_ID)!.count = quest.count - 1;
    killTargets(sim, 1);
    expect(sim.entities.size).toBe(before);
    // Two participants (the player and a pretend second player's pet owner) both get paid.
    const copperBefore = meta.copper;
    addThreat(mob, sim.playerId, 10);
    sim.player.targetId = mob.id;
    sim.chat('/dev killtarget');
    sim.tick();
    sim.tick();
    expect(meta.copper - copperBefore).toBe(
      Math.round(TUNING.purse.base + TUNING.purse.perLevel * sim.player.level),
    );
    expect(worldQuestChampionState(sim.ctx, QUEST_ID)?.paid).toBe(true);
    // Paid once: more ticks never pay again.
    sim.tick();
    expect(meta.copper - copperBefore).toBe(
      Math.round(TUNING.purse.base + TUNING.purse.perLevel * sim.player.level),
    );
  });

  it('fades an unclaimed champion after its lifetime', () => {
    const sim = armed();
    const quest = WORLD_QUESTS_BY_ID[QUEST_ID];
    killTargets(sim, quest.count);
    const mob = champion(sim)!;
    expect(mob).toBeDefined();
    const state = worldQuestChampionState(sim.ctx, QUEST_ID)!;
    // Everyone has left the site when the lifetime runs out.
    sim.player.pos = sim.groundPos(quest.area.x + 400, quest.area.z + 400);
    sim.player.prevPos = { ...sim.player.pos };
    state.expiresAt = sim.time - 1;
    sim.tick();
    expect(sim.entities.has(mob.id)).toBe(false);
    expect(worldQuestChampionState(sim.ctx, QUEST_ID)).toBeUndefined();
  });
});
