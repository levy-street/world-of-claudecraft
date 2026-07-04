// World-boss kill/quest credit (combat/damage.ts handleDeath restructure): a
// worldBoss mob credits kills and quest objectives to EXACTLY the personal-loot
// contributor set (everyone on the hate table, pets folded to owners), while
// every normal mob keeps the byte-identical tapper/party rule. Also covers the
// generalized rise announce.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MOBS, QUESTS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { terrainHeight } from '../src/sim/world';
import { WORLD_BOSSES } from '../src/sim/world_boss';

type AnySim = Sim & Record<string, any>;

const TEST_QUEST = 'q_test_world_boss_credit';
const BOSS = WORLD_BOSSES[0];

beforeAll(() => {
  (QUESTS as any)[TEST_QUEST] = {
    id: TEST_QUEST,
    name: 'Test: the Waking Peak',
    giverNpcId: 'captain_thessaly',
    turnInNpcId: 'captain_thessaly',
    text: 'test',
    completionText: 'test',
    objectives: [
      { type: 'kill', targetMobId: BOSS.templateId, count: 1, label: 'Thunzharr slain' },
    ],
    xpReward: 1000,
    copperReward: 0,
    itemRewards: {},
  };
});
afterAll(() => {
  delete (QUESTS as any)[TEST_QUEST];
});

function makeSim(): AnySim {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true }) as AnySim;
}

function join(sim: AnySim, name: string): number {
  return sim.addPlayer('warrior', name, { autoEquip: true });
}

function holdQuest(sim: AnySim, pid: number): void {
  sim.meta(pid)!.questLog.set(TEST_QUEST, { questId: TEST_QUEST, counts: [0], state: 'active' });
}

function teleport(sim: AnySim, e: any, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

describe('world-boss credit', () => {
  it('credits kills and quest objectives to every ungrouped contributor', () => {
    const sim = makeSim();
    const a = join(sim, 'Alpha');
    const b = join(sim, 'Bravo');
    holdQuest(sim, a);
    holdQuest(sim, b);
    const bossId = sim.spawnWorldBoss(BOSS)!;
    const boss = sim.entities.get(bossId)!;
    const ea = sim.entities.get(a)!;
    const eb = sim.entities.get(b)!;
    teleport(sim, ea, boss.pos.x - 3, boss.pos.z);
    teleport(sim, eb, boss.pos.x + 3, boss.pos.z);
    // both hit it (ungrouped); Alpha taps first
    sim.dealDamage(ea, boss, 10, false, 'physical', null, 'hit');
    sim.dealDamage(eb, boss, 10, false, 'physical', null, 'hit');
    sim.dealDamage(ea, boss, 99999999, false, 'physical', null, 'hit');
    expect(boss.dead).toBe(true);
    expect(sim.meta(a)!.counters.kills).toBe(1); // tapper credited ONCE, not twice
    expect(sim.meta(b)!.counters.kills).toBe(1); // non-tapper contributor credited
    expect(sim.meta(a)!.questLog.get(TEST_QUEST)!.counts[0]).toBe(1);
    expect(sim.meta(b)!.questLog.get(TEST_QUEST)!.counts[0]).toBe(1);
  });

  it('keeps the tapper-only rule byte-identical for normal mobs', () => {
    const sim = makeSim();
    const a = join(sim, 'Tapper');
    const b = join(sim, 'Helper');
    const mob = [...sim.entities.values()].find(
      (e: any) => e.kind === 'mob' && e.hostile && !e.dead && !MOBS[e.templateId]?.worldBoss,
    )!;
    const ea = sim.entities.get(a)!;
    const eb = sim.entities.get(b)!;
    teleport(sim, ea, mob.pos.x - 2, mob.pos.z);
    teleport(sim, eb, mob.pos.x + 2, mob.pos.z);
    sim.dealDamage(ea, mob, 5, false, 'physical', null, 'hit'); // tap
    sim.dealDamage(eb, mob, 5, false, 'physical', null, 'hit'); // helper
    sim.dealDamage(ea, mob, 99999999, false, 'physical', null, 'hit');
    expect(mob.dead).toBe(true);
    expect(sim.meta(a)!.counters.kills).toBe(1);
    expect(sim.meta(b)!.counters.kills).toBe(0); // helpers earn nothing on normals
  });

  it('announces the rise with the location from the def', () => {
    const sim = makeSim();
    sim.events.length = 0;
    sim.spawnWorldBoss(BOSS);
    const rise = sim.events.find((ev: any) => ev.type === 'log' && /rises over/.test(ev.text));
    expect(rise).toBeTruthy();
    expect(rise.text).toBe(`${MOBS[BOSS.templateId].name} rises over ${BOSS.announceLocation}!`);
  });
});
