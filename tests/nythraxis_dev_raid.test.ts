// The solo Nythraxis practice raid (/dev nythraxisraid) and the mechanic pokes
// (/dev nyx ...): the roster forms inside the compact hall without pulling,
// every bot stands clear of the wardstones and the boss, and each poke fires
// the mechanic it names through the real driver on the next tick.

import { describe, expect, it } from 'vitest';
import { NYTHRAXIS_LAYOUT } from '../src/sim/dungeon_layout';
import { NYTHRAXIS_ARENA_ID, NYTHRAXIS_DEV_FORMATION } from '../src/sim/nythraxis_dev_raid';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, NYTHRAXIS_BOSS_ID } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

type AnyEntity = Entity & Record<string, any>;

function devSim(): Sim {
  const sim = new Sim({
    seed: 6113,
    playerClass: 'warrior',
    autoEquip: true,
    devCommands: true,
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(20);
  return sim;
}

function bots(sim: Sim) {
  return [...sim.players.values()]
    .filter((meta) => meta.isDevBot && /^NythraxisBot[1-9]$/.test(meta.name))
    .sort((a, b) => a.entityId - b.entityId);
}

function arena(sim: Sim) {
  const instance = sim.instances.find(
    (candidate) =>
      candidate.dungeonId === NYTHRAXIS_ARENA_ID &&
      candidate.partyKey === sim.ctx.instanceKeyFor(sim.player.id),
  );
  if (!instance) throw new Error('practice arena missing');
  return { instance, origin: sim.ctx.instanceOriginOf(instance) };
}

function bossOf(sim: Sim): AnyEntity {
  const { instance } = arena(sim);
  const boss = instance.mobIds
    .map((id) => sim.entities.get(id))
    .find((e) => e?.templateId === NYTHRAXIS_BOSS_ID && !e.dead);
  if (!boss) throw new Error('practice boss missing');
  return boss as AnyEntity;
}

function pull(sim: Sim): AnyEntity {
  const boss = bossOf(sim);
  const tank = sim.player as AnyEntity;
  tank.pos = { ...boss.pos, z: boss.pos.z - 4 };
  tank.prevPos = { ...tank.pos };
  sim.rebucket(tank);
  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = tank.id;
  boss.threat.set(tank.id, 1000);
  sim.tick();
  return boss;
}

const flat = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

describe('/dev nythraxisraid', () => {
  it('forms a ten-player raid inside the hall, clear of the wards and the boss, without pulling', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const sim = devSim();
      sim.chat(`/dev nythraxisraid ${difficulty}`);
      const { instance, origin } = arena(sim);
      expect(instance.difficulty).toBe(difficulty);
      expect(sim.instanceInfoAt(sim.player.pos)?.dungeonId).toBe(NYTHRAXIS_ARENA_ID);
      const party = sim.partyOf(sim.player.id);
      expect(party).toMatchObject({ raid: true, leader: sim.player.id });
      expect(party?.members).toHaveLength(10);
      const roster = bots(sim);
      expect(roster).toHaveLength(9);
      const boss = bossOf(sim);
      const wards = [...sim.entities.values()].filter(
        (e) => e.kind === 'object' && e.objectItemId === 'bastion_ward_stone',
      );
      expect(wards).toHaveLength(3);
      for (const [index, meta] of roster.entries()) {
        const bot = sim.entities.get(meta.entityId);
        if (!bot) throw new Error(`missing ${meta.name}`);
        expect(meta.devAnchored).toBe(true);
        expect(bot.profilerInvulnerable).toBe(true);
        expect(sim.instanceInfoAt(bot.pos)?.dungeonId).toBe(NYTHRAXIS_ARENA_ID);
        const local = { x: bot.pos.x - origin.x, z: bot.pos.z - origin.z };
        expect(local).toEqual(NYTHRAXIS_DEV_FORMATION[index]);
        expect(Math.abs(local.x)).toBeLessThanOrEqual(NYTHRAXIS_LAYOUT.floorHalfX! - 2);
        expect(local.z).toBeGreaterThanOrEqual(NYTHRAXIS_LAYOUT.zMin + 2);
        expect(local.z).toBeLessThanOrEqual(NYTHRAXIS_LAYOUT.zMax - 2);
        for (const ward of wards) expect(flat(bot.pos, ward.pos)).toBeGreaterThanOrEqual(6);
        expect(flat(bot.pos, boss.spawnPos)).toBeGreaterThanOrEqual(24);
      }
      // Forming the raid never pulls him.
      for (let i = 0; i < 40; i++) sim.tick();
      expect(boss.inCombat).toBe(false);
      expect(boss.nythraxis?.introSpoken ?? false).toBe(false);
    }
  });

  it('reuses the roster on a second call and switches difficulty', () => {
    const sim = devSim();
    sim.chat('/dev nythraxisraid normal');
    const before = bots(sim).map((meta) => meta.entityId);
    sim.chat('/dev nythraxisraid heroic');
    expect(bots(sim).map((meta) => meta.entityId)).toEqual(before);
    expect(arena(sim).instance.difficulty).toBe('heroic');
    expect(sim.partyOf(sim.player.id)?.members).toHaveLength(10);
  });

  it('refuses the pokes until the boss is pulled, then fires each mechanic through the driver', () => {
    const sim = devSim();
    sim.chat('/dev nythraxisraid normal');
    sim.chat('/dev god');
    const errors = () =>
      (sim.events as Array<{ type: string; text?: string }>).filter(
        (e) => (e.type === 'error' || e.type === 'log') && /^\[dev\]/.test(e.text ?? ''),
      );
    // A second between commands: the chat limiter allows eight back to back,
    // then two a second, and this test types faster than any human.
    const say = (command: string) => {
      for (let i = 0; i < 20; i++) sim.tick();
      sim.chat(command);
    };
    say('/dev nyx spike');
    expect(errors().some((e) => /Pull Nythraxis first/.test(e.text ?? ''))).toBe(true);

    const boss = pull(sim);
    const st = boss.nythraxis!;
    // Phase 1 mechanics on demand.
    say('/dev nyx spike');
    sim.tick();
    expect(st.boneSpikes!.length).toBe(2);
    say('/dev nyx eruption');
    sim.tick();
    expect(st.eruptionPoints!.length).toBeGreaterThan(0);
    say('/dev nyx sigil');
    sim.tick();
    expect(st.sigil).not.toBeNull();
    // A phase 2 mechanic is refused in phase 1 with a pointer to the phase jump.
    say('/dev nyx gravefire');
    expect(errors().some((e) => /phase 2 mechanic/.test(e.text ?? ''))).toBe(true);
    // Phase jump: 69% health starts the transition, which then holds every poke.
    say('/dev nyx phase2');
    sim.tick();
    expect(st.phase).toBe('transition');
    say('/dev nyx rend');
    expect(errors().map((e) => e.text)).toContainEqual(expect.stringMatching(/transition/));
    for (let i = 0; i < 20 * 26 && st.phase === 'transition'; i++) sim.tick();
    expect(st.phase).toBe(2);
    // Phase 2 mechanics on demand, and the wards completed by three bots.
    say('/dev nyx gravefire');
    sim.tick();
    expect(st.gravefires!.length).toBe(1);
    say('/dev nyx rend');
    sim.tick();
    expect(st.soulRendMarks.length).toBe(3);
    for (let i = 0; i < 20 * 9; i++) sim.tick(); // marks resolve so the Rage may start
    say('/dev nyx rage');
    sim.tick();
    expect(st.deathlessCastRemaining).toBeGreaterThan(0);
    say('/dev nyx wards');
    sim.tick();
    expect(st.deathlessCastRemaining).toBe(0);
    expect(st.deathlessStunRemaining).toBeGreaterThan(0);
    for (let i = 0; i < 20 * 10; i++) sim.tick();
    // Phase 3 and its storm, then the clock.
    say('/dev nyx phase3');
    for (let i = 0; i < 20 * 8 && st.phase !== 3; i++) sim.tick();
    expect(st.phase).toBe(3);
    say('/dev nyx storm');
    for (let i = 0; i < 20 * 8 && !st.boneStorm; i++) sim.tick();
    expect(st.boneStorm).not.toBeNull();
    say('/dev nyx enrage 1');
    for (let i = 0; i < 20 * 2; i++) sim.tick();
    expect(boss.auras.some((a: { name: string }) => a.name === 'The Crown Endures')).toBe(true);
    // A bad verb is a usage error, not a crash.
    say('/dev nyx dance');
    expect(errors().some((e) => /Usage: \/dev nyx/.test(e.text ?? ''))).toBe(true);
    void DT;
  });
});
