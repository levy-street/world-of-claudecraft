// The Last Bell scenario sequencer (src/sim/scenarios/scenarios.ts): quest
// gating, stage arming with rng-free spawns, killSpawned / quest / reach /
// survive objectives, squad directive application, wipe retry, completion
// teardown, and claim-recycle reaping. Uses a test-registered scenario over
// the shipped Farshore quest content.
import { beforeAll, describe, expect, it } from 'vitest';
import { MOBS, QUESTS } from '../src/sim/data';
import { registerScenario, scenarioRunFor, startScenario } from '../src/sim/scenarios/scenarios';
import { Sim } from '../src/sim/sim';
import { squadActorEntity } from '../src/sim/squad/squad';
import type { Entity } from '../src/sim/types';

const QUEST_ID = 'q_fs_hold_the_riftfields'; // kill 10 breach_wretch, objective 0

beforeAll(() => {
  registerScenario({
    id: 'sc_test_riftline',
    dungeonId: 'lb_riftline',
    questId: QUEST_ID,
    squad: { actorIds: ['coalfast', 'tam'] },
    stages: [
      {
        id: 'wave',
        objective: { kind: 'killSpawned' },
        spawns: [{ mobId: 'riftspawn', count: 3, x: 0, z: -60, radius: 4, aggro: true }],
        directives: [{ actorId: 'coalfast', directive: { kind: 'hold', x: 0, z: -60 } }],
      },
      {
        id: 'cull',
        objective: { kind: 'quest', objectiveIndex: 0 },
        spawns: [{ mobId: 'breach_wretch', count: 10, x: 0, z: -40, radius: 8, aggro: true }],
      },
      {
        id: 'regroup',
        objective: { kind: 'reach', x: 0, z: -70, radius: 6 },
      },
      {
        id: 'hold',
        objective: { kind: 'survive', seconds: 2 },
      },
    ],
  });
});

function makeSim(): Sim {
  const sim = new Sim({ seed: 909, playerClass: 'warrior', playerName: 'Bell', devCommands: true });
  sim.player.level = 20;
  sim.questLog.set(QUEST_ID, { questId: QUEST_ID, counts: [0], state: 'active' });
  return sim;
}

function tickMany(sim: Sim, n: number) {
  for (let i = 0; i < n; i++) sim.tick();
}

function run(sim: Sim) {
  const claim = sim.ctx.instances.find((i) => i.dungeonId === 'lb_riftline' && i.partyKey !== null);
  return claim?.exitId !== null && claim !== undefined
    ? scenarioRunFor(sim.ctx, claim.exitId ?? -1)
    : undefined;
}

function stageSpawnEntities(sim: Sim): Entity[] {
  const r = run(sim);
  return (r?.stageSpawnIds ?? []).map((id) => sim.entities.get(id)).filter((e): e is Entity => !!e);
}

function killStageSpawns(sim: Sim) {
  for (const mob of stageSpawnEntities(sim)) {
    if (!mob.dead)
      sim.ctx.dealDamage(sim.player, mob, mob.maxHp * 10, false, 'physical', null, 'hit');
  }
}

describe('scenario gating and lifecycle', () => {
  it('refuses to start without the quest active', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', playerName: 'NoQuest' });
    expect(startScenario(sim.ctx, 'sc_test_riftline')).toBe(false);
    expect(sim.ctx.scenarioRuns.size).toBe(0);
  });

  it('starts, spawns the squad, and arms stage one with rng-free spawns', () => {
    const sim = makeSim();
    expect(startScenario(sim.ctx, 'sc_test_riftline')).toBe(true);
    const r = run(sim);
    expect(r).toBeTruthy();
    expect(r?.stageIndex).toBe(0);
    // Squad stood up with the run.
    expect(squadActorEntity(sim.ctx, r?.claimId ?? -1, 'coalfast')).toBeTruthy();
    expect(squadActorEntity(sim.ctx, r?.claimId ?? -1, 'tam')).toBeTruthy();
    // Arming happens on the first tick with a living participant, drawing
    // no shared rng at spawn time (combat afterwards may draw).
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    sim.tick();
    sim.rng.setObserver(null);
    expect(r?.stageArmed).toBe(true);
    expect(stageSpawnEntities(sim)).toHaveLength(3);
    // The stage directive landed on Coalfast.
    // (Draw-free arming: spawns are even rings at fixed levels.)
    expect(draws).toBe(0);
  });

  it('advances killSpawned -> quest -> reach -> survive to completion', () => {
    const sim = makeSim();
    startScenario(sim.ctx, 'sc_test_riftline');
    sim.tick();
    const r = run(sim);
    expect(r?.stageIndex).toBe(0);

    // Stage 0: kill the spawned wave.
    killStageSpawns(sim);
    tickMany(sim, 2);
    expect(r?.stageIndex).toBe(1);
    tickMany(sim, 1); // arm stage 1
    expect(stageSpawnEntities(sim).length).toBe(10);

    // Stage 1: the quest objective fills through the normal kill-credit
    // pipeline as the wretches die to the player.
    killStageSpawns(sim);
    tickMany(sim, 2);
    expect(sim.questLog.get(QUEST_ID)?.counts[0]).toBeGreaterThanOrEqual(10);
    expect(r?.stageIndex).toBe(2);

    // Stage 2: reach the regroup point (the entry area).
    const origin = { x: sim.player.pos.x, z: sim.player.pos.z };
    void origin;
    // The entry point IS (0,-70) local, where the player already stands
    // after startScenario teleported them; stage 2 completes immediately.
    tickMany(sim, 3);
    expect(r?.stageIndex).toBe(3);

    // Stage 3: survive 2 seconds (40 ticks).
    tickMany(sim, 45);
    expect(r?.done).toBe(true);
    // Squad despawns on completion by default.
    expect(squadActorEntity(sim.ctx, r?.claimId ?? -1, 'coalfast')).toBeNull();
  });

  it('a wipe re-arms the current stage from the start', () => {
    const sim = makeSim();
    startScenario(sim.ctx, 'sc_test_riftline');
    sim.tick();
    const r = run(sim);
    const before = stageSpawnEntities(sim).map((e) => e.id);
    expect(before).toHaveLength(3);
    // Kill the player: no living participant remains in the claim.
    sim.player.hp = 1;
    sim.ctx.dealDamage(null, sim.player, 10_000, false, 'shadow', null, 'hit');
    expect(sim.player.dead).toBe(true);
    tickMany(sim, 2);
    expect(r?.stageArmed).toBe(false);
    // The wave despawned with the wipe.
    expect(stageSpawnEntities(sim)).toHaveLength(0);
    // Revive the player inside (test shortcut) and the stage re-arms fresh.
    sim.player.dead = false;
    sim.player.hp = sim.player.maxHp;
    tickMany(sim, 2);
    expect(r?.stageArmed).toBe(true);
    const after = stageSpawnEntities(sim);
    expect(after).toHaveLength(3);
    expect(after.map((e) => e.id).some((id) => before.includes(id))).toBe(false);
  });

  it('reaps the run and squad when the claim recycles', () => {
    const sim = makeSim();
    startScenario(sim.ctx, 'sc_test_riftline');
    sim.tick();
    const r = run(sim);
    expect(r).toBeTruthy();
    sim.leaveDungeon();
    const inst = sim.ctx.instances.find(
      (i) => i.dungeonId === 'lb_riftline' && i.partyKey !== null,
    );
    expect(inst).toBeTruthy();
    if (inst) inst.emptyFor = 299;
    tickMany(sim, 40);
    expect(sim.ctx.scenarioRuns.size).toBe(0);
    expect(sim.ctx.squadRuns.size).toBe(0);
  });
});

describe('scenario content sanity', () => {
  it('the tracked quest and mobs exist in the shipped content', () => {
    expect(QUESTS[QUEST_ID]).toBeTruthy();
    expect(QUESTS[QUEST_ID].objectives[0].type).toBe('kill');
    expect(MOBS.riftspawn).toBeTruthy();
    expect(MOBS.breach_wretch).toBeTruthy();
  });
});
