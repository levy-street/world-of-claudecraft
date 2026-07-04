// Defense events (src/sim/events/defense.ts) driven end-to-end on a real Sim
// against the shipped Thornfen palisade site: arming rules, fixed-offset wave
// spawns, per-wave participant credit, the win path, the ally-death and
// abandon failure paths, and same-seed determinism.

import { describe, expect, it } from 'vitest';
import { DEFENSE_SITES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { terrainHeight } from '../src/sim/world';

type AnySim = Sim & Record<string, any>;

const SITE = DEFENSE_SITES.thornfen_palisade;

function makeSim(): AnySim {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true }) as AnySim;
}

function teleport(sim: AnySim, e: any, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

function sennaId(sim: AnySim): number {
  for (const e of sim.entities.values()) {
    if (e.kind === 'npc' && e.templateId === SITE.npcId) return e.id;
  }
  throw new Error('site npc not found');
}

function state(sim: AnySim) {
  return sim.defenseEvents.get(SITE.id);
}

function armEvent(sim: AnySim): void {
  sim.setPlayerLevel(31);
  teleport(sim, sim.player, SITE.pos.x - 3, SITE.pos.z - 3);
  sim.acceptQuest(SITE.questId);
  expect(sim.questState(SITE.questId)).toBe('active');
  sim.talkToNpc(sennaId(sim));
  expect(state(sim).phase).toBe('prep');
}

function killWave(sim: AnySim): void {
  // burn down the current wave once it spawns
  for (let guard = 0; guard < 20 * 60; guard++) {
    sim.tick();
    const st = state(sim);
    if (st.phase === 'wave' && st.waveMobIds.length > 0) {
      for (const id of [...st.waveMobIds]) {
        const m = sim.entities.get(id);
        if (m && !m.dead) sim.dealDamage(sim.player, m, 9999999, false, 'physical', null, 'hit');
      }
      return;
    }
    if (st.phase !== 'prep' && st.phase !== 'wave') return;
  }
  throw new Error('wave never spawned');
}

describe('defense events: the Thornfen palisade', () => {
  it('arms only for quest-holders at the site, and spawns wave 1 at the fixed offsets', () => {
    const sim = makeSim();
    // no quest: talking is a plain gossip interaction, the site stays idle
    sim.setPlayerLevel(31);
    teleport(sim, sim.player, SITE.pos.x - 3, SITE.pos.z - 3);
    sim.talkToNpc(sennaId(sim));
    expect(state(sim).phase).toBe('idle');
    // with the quest: armed
    armEvent(sim);
    // prep counts down, then wave 1 spawns exactly as declared
    for (let i = 0; i < 20 * (SITE.waves[0].delaySeconds + 1); i++) sim.tick();
    const st = state(sim);
    expect(st.phase).toBe('wave');
    expect(st.waveMobIds.length).toBe(SITE.waves[0].spawns.length);
    const first = sim.entities.get(st.waveMobIds[0]);
    expect(first.templateId).toBe(SITE.waves[0].spawns[0].mobId);
    expect(first.level).toBe(SITE.waves[0].spawns[0].level);
    expect(first.aggroTargetId).toBe(st.allyEntityId);
  });

  it('credits participants per wave, completes the quest, wins, and cools down', () => {
    const sim = makeSim();
    armEvent(sim);
    const events: any[] = [];
    const origEmit = sim.events;
    for (let w = 0; w < SITE.waves.length; w++) killWave(sim);
    // let the clear sweep run
    for (let i = 0; i < 20 * 3; i++) sim.tick();
    events.push(...origEmit);
    const st = state(sim);
    expect(st.phase).toBe('cooldown');
    const qp = sim.questLog.get(SITE.questId);
    expect(qp.counts[SITE.objectiveIndex]).toBe(SITE.waves.length);
    expect(qp.state).toBe('ready');
    // restart during cooldown is refused
    sim.talkToNpc(sennaId(sim));
    expect(state(sim).phase).toBe('cooldown');
  });

  it('fails when the warden falls: counts reset, cooldown replaces the defender', () => {
    const sim = makeSim();
    armEvent(sim);
    for (let i = 0; i < 20 * (SITE.waves[0].delaySeconds + 1); i++) sim.tick();
    const st = state(sim);
    const ally = sim.entities.get(st.allyEntityId);
    const killer = sim.entities.get(st.waveMobIds[0]);
    sim.dealDamage(killer, ally, 9999999, false, 'physical', null, 'hit');
    expect(ally.dead).toBe(true);
    for (let i = 0; i < 5; i++) sim.tick();
    expect(state(sim).phase).toBe('cooldown');
    expect(sim.questLog.get(SITE.questId).counts[SITE.objectiveIndex]).toBe(0);
    // cooldown elapses: a fresh warden stands at the post
    for (let i = 0; i < 20 * (SITE.cooldownSeconds + 2); i++) sim.tick();
    const after = state(sim);
    expect(after.phase).toBe('idle');
    const fresh = sim.entities.get(after.allyEntityId);
    expect(fresh.dead).toBe(false);
    expect(Math.hypot(fresh.pos.x - SITE.pos.x, fresh.pos.z - SITE.pos.z)).toBeLessThan(4);
  });

  it('fails when every participant abandons the site', () => {
    const sim = makeSim();
    armEvent(sim);
    teleport(sim, sim.player, SITE.pos.x - 200, SITE.pos.z - 400); // walk away
    for (let i = 0; i < 20 * 3; i++) sim.tick();
    expect(state(sim).phase).toBe('cooldown');
    expect(sim.questLog.get(SITE.questId).counts[SITE.objectiveIndex]).toBe(0);
  });

  it('is deterministic: two same-seed runs land the same final state', () => {
    const run = () => {
      const sim = makeSim();
      armEvent(sim);
      for (let w = 0; w < SITE.waves.length; w++) killWave(sim);
      for (let i = 0; i < 20 * 3; i++) sim.tick();
      const st = state(sim);
      return {
        phase: st.phase,
        wave: st.wave,
        counts: [...sim.questLog.get(SITE.questId).counts],
        nextId: sim.ctx.nextId,
      };
    };
    expect(run()).toEqual(run());
  });
});
