// Bone Spike, Grave Eruption, and Grave Flame against a real Sim: the driver
// functions in src/sim/encounters/nythraxis.ts run on a live SimContext with a
// ten-player attuned raid inside the arena, the way the Varkhul suites call
// their driver by hand and assert on entities, auras, events, and readouts.

import { describe, expect, it } from 'vitest';
import * as nythraxis from '../src/sim/encounters/nythraxis';
import {
  isNythraxisImpaled,
  NYTHRAXIS_BONE_SPIKE_EVERY_HEROIC,
  NYTHRAXIS_BONE_SPIKE_EVERY_NORMAL,
  NYTHRAXIS_BONE_SPIKE_FIRST_SECONDS,
  NYTHRAXIS_BONE_SPIKE_ID,
  NYTHRAXIS_BONE_SPIKE_VICTIMS_HEROIC,
  NYTHRAXIS_BONE_SPIKE_VICTIMS_NORMAL,
  NYTHRAXIS_IMPALED_AURA_ID,
  NYTHRAXIS_IMPALED_TICK_MAX_HP_HEROIC,
  NYTHRAXIS_IMPALED_TICK_MAX_HP_NORMAL,
  nythraxisBoneSpikeCandidates,
  nythraxisImpaledAuraFor,
} from '../src/sim/nythraxis_bone_spike';
import {
  NYTHRAXIS_GRAVE_ERUPTION_CAST_ID,
  NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
  NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS,
  NYTHRAXIS_GRAVE_FLAME_CAST_ID,
} from '../src/sim/nythraxis_grave_eruption';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { DT, type Entity, NYTHRAXIS_BOSS_ID, type SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { EMPTY_TEST_WORLD } from './sim_shared';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;
type Callout = Extract<SimEvent, { type: 'nythraxisCallout' }> & { pid?: number };

const ctxOf = (sim: Sim): SimContext => (sim as unknown as { ctx: SimContext }).ctx;

function teleport(sim: AnySim, e: AnyEntity, x: number, z: number, y?: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = y ?? groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

// A ten-player attuned raid pulled into the throne room: the tank in melee,
// the others spread 20 yd in front of the dais.
function setup(opts: { difficulty?: 'normal' | 'heroic' } = {}) {
  const { difficulty = 'normal' } = opts;
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    world: EMPTY_TEST_WORLD,
  }) as AnySim;
  const tankPid = sim.addPlayer('warrior', 'Tank') as number;
  sim.players.get(tankPid)!.questsDone.add('q_nythraxis_bound_guardian');
  const raiderPids: number[] = [];
  for (let i = 0; i < 9; i++) {
    const pid = sim.addPlayer(i < 2 ? 'priest' : 'mage', `Raider${i}`) as number;
    sim.partyInvite(pid, tankPid);
    sim.partyAccept(pid);
    raiderPids.push(pid);
  }
  sim.convertPartyToRaid(tankPid);
  if (difficulty === 'heroic') sim.setDungeonDifficulty('heroic', tankPid);
  sim.enterDungeon('nythraxis_boss_arena', tankPid);
  const tank = sim.entities.get(tankPid) as AnyEntity;
  const boss = [...sim.entities.values()].find(
    (e: AnyEntity) => e.kind === 'mob' && e.templateId === NYTHRAXIS_BOSS_ID && !e.dead,
  ) as AnyEntity;
  teleport(sim, tank, boss.pos.x, boss.pos.z - 5, boss.pos.y);
  const raiders = raiderPids.map((pid) => sim.entities.get(pid) as AnyEntity);
  raiders.forEach((e, i) => {
    teleport(sim, e, boss.spawnPos.x + (i - 4) * 6, boss.spawnPos.z - 20, boss.pos.y);
  });
  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = tank.id;
  boss.threat.set(tank.id, 1000);
  boss.swingTimer = 999;
  const ctx = ctxOf(sim);
  const st = nythraxis.initNythraxisEncounter(boss);
  st.introSpoken = true;
  // Park every other cadence so only the mechanic under test fires.
  st.gravebreakerTimer = 999;
  st.raiseFallenTimer = 999;
  st.soulRendTimer = 999;
  st.deathlessTimer = 999;
  st.dreadCurseTimer = 999;
  st.boneSpikeTimer = 999;
  st.eruptionTimer = 999;
  const room = () => nythraxis.playersInNythraxisRoom(ctx, boss);
  const spikes = () =>
    [...sim.entities.values()].filter(
      (e: AnyEntity) => e.kind === 'mob' && e.templateId === NYTHRAXIS_BONE_SPIKE_ID && !e.dead,
    ) as AnyEntity[];
  const callouts = (call: Callout['call']) =>
    (sim.events as SimEvent[]).filter(
      (e): e is Callout => e.type === 'nythraxisCallout' && e.call === call,
    );
  return { sim, ctx, tank, raiders, boss, st, room, spikes, callouts };
}

function tickDriver(ctx: SimContext, boss: Entity, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) nythraxis.updateNythraxisEncounter(ctx, boss);
}

describe('Nythraxis Bone Spike', () => {
  it('pins the impale tuning literally on both difficulties', () => {
    expect(NYTHRAXIS_BONE_SPIKE_FIRST_SECONDS).toBe(12);
    expect([NYTHRAXIS_BONE_SPIKE_EVERY_NORMAL, NYTHRAXIS_BONE_SPIKE_EVERY_HEROIC]).toEqual([
      20, 16,
    ]);
    expect([NYTHRAXIS_BONE_SPIKE_VICTIMS_NORMAL, NYTHRAXIS_BONE_SPIKE_VICTIMS_HEROIC]).toEqual([
      2, 3,
    ]);
    expect([NYTHRAXIS_IMPALED_TICK_MAX_HP_NORMAL, NYTHRAXIS_IMPALED_TICK_MAX_HP_HEROIC]).toEqual([
      0.08, 0.1,
    ]);
    const aura = nythraxisImpaledAuraFor(7, 99);
    expect(aura).toMatchObject({
      id: NYTHRAXIS_IMPALED_AURA_ID,
      kind: 'stun',
      unbreakableControl: true,
      encounterOwned: true,
      sourceId: 7,
      value2: 99,
    });
  });

  it('never picks the aggro holder, an impaled raider, or a live Soul Rend carrier', () => {
    const room = [
      { id: 1, dead: false, auras: [] },
      { id: 2, dead: false, auras: [] },
      { id: 3, dead: true, auras: [] },
      { id: 4, dead: false, auras: [nythraxisImpaledAuraFor(9, 50)] },
      { id: 5, dead: false, auras: [] },
    ] as unknown as Entity[];
    const picked = nythraxisBoneSpikeCandidates(room, 9, 1, new Set([5]));
    expect(picked.map((p) => p.id)).toEqual([2]);
  });

  it('impales two raiders on normal and three on heroic, never the aggro holder', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const { ctx, boss, st, tank, room, spikes, callouts } = setup({ difficulty });
      const victims = nythraxis.castNythraxisBoneSpike(ctx, boss, st, room(), difficulty);
      const expected = difficulty === 'heroic' ? 3 : 2;
      expect(victims, difficulty).toHaveLength(expected);
      expect(
        victims.map((v) => v.id),
        difficulty,
      ).not.toContain(tank.id);
      expect(new Set(victims.map((v) => v.id)).size, difficulty).toBe(expected);
      expect(spikes(), difficulty).toHaveLength(expected);
      for (const victim of victims) {
        const aura = victim.auras.find((a) => a.id === NYTHRAXIS_IMPALED_AURA_ID);
        expect(aura?.unbreakableControl, difficulty).toBe(true);
        expect(aura?.encounterOwned, difficulty).toBe(true);
        const spike = ctx.entities.get(aura!.value2!)!;
        expect(spike.templateId, difficulty).toBe(NYTHRAXIS_BONE_SPIKE_ID);
        // The spike rises at the victim's feet and is owned by the boss.
        expect(Math.hypot(spike.pos.x - victim.pos.x, spike.pos.z - victim.pos.z)).toBeLessThan(
          0.5,
        );
        expect(boss.summonedIds, difficulty).toContain(spike.id);
        expect(spike.lootable, difficulty).toBe(false);
      }
      // Personal callout to each victim, the raid-wide one to everyone else.
      expect(
        callouts('youAreImpaled')
          .map((e) => e.pid)
          .sort(),
      ).toEqual(victims.map((v) => v.id).sort());
      const raidWide = callouts('impaled');
      expect(raidWide.length).toBe(10 - expected);
      expect(raidWide.some((e) => victims.some((v) => v.id === e.pid))).toBe(false);
    }
  });

  it('drains the victim every second at the difficulty fraction until the spike dies', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const { ctx, boss, st, room } = setup({ difficulty });
      const [victim] = nythraxis.castNythraxisBoneSpike(ctx, boss, st, room(), difficulty);
      const hpBefore = victim.hp;
      tickDriver(ctx, boss, 1);
      const frac = difficulty === 'heroic' ? 0.1 : 0.08;
      expect(hpBefore - victim.hp, difficulty).toBe(Math.ceil(victim.maxHp * frac));
      tickDriver(ctx, boss, 1);
      expect(hpBefore - victim.hp, difficulty).toBe(2 * Math.ceil(victim.maxHp * frac));
      expect(isNythraxisImpaled(victim, boss.id), difficulty).toBe(true);
    }
  });

  it('frees the victim the instant the spike dies and announces the break', () => {
    const { sim, ctx, boss, st, room, raiders, spikes, callouts } = setup();
    const [victim] = nythraxis.castNythraxisBoneSpike(ctx, boss, st, room(), 'normal');
    const spike = spikes().find((s) => s.id === victim.auras[0]?.value2) ?? spikes()[0];
    const killer = raiders.find((r) => r.id !== victim.id)!;
    ctx.dealDamage(killer, spike, spike.hp + 1, false, 'physical', null, 'hit');
    expect(spike.dead).toBe(true);
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(isNythraxisImpaled(victim, boss.id)).toBe(false);
    expect(st.boneSpikes?.some((p) => p.playerId === victim.id)).toBe(false);
    expect(callouts('spikeBroken').length).toBe(10);
    // The other victim is still held.
    const other = raiders.find((r) => r.id !== victim.id && isNythraxisImpaled(r, boss.id));
    expect(other).toBeDefined();
    // The shattered spike's corpse is dropped and forgotten everywhere the spawn
    // recorded it, so a long pull never accumulates spike corpses.
    expect(sim.entities.has(spike.id)).toBe(false);
    expect(boss.summonedIds).not.toContain(spike.id);
    const inst = ctx.instances.find((i) => i.partyKey !== null && i.mobIds.includes(boss.id));
    expect(inst?.mobIds).not.toContain(spike.id);
  });

  it('pins the spike health pool the tuning tables promise: 1000 normal, 1500 heroic', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const { ctx, boss, st, room, spikes } = setup({ difficulty });
      nythraxis.castNythraxisBoneSpike(ctx, boss, st, room(), difficulty);
      const spike = spikes()[0];
      expect(spike.maxHp, difficulty).toBe(difficulty === 'heroic' ? 1500 : 1000);
      expect(spike.hp, difficulty).toBe(spike.maxHp);
    }
  });

  it('frees a victim who dies impaled, so a resurrection never brings the pin back', () => {
    const { sim, ctx, boss, st, room, raiders, spikes } = setup();
    const [victim] = nythraxis.castNythraxisBoneSpike(ctx, boss, st, room(), 'normal');
    const spikeId = victim.auras.find((a) => a.id === NYTHRAXIS_IMPALED_AURA_ID)!.value2!;
    // A real death: dealDamage runs death cleanup, which deliberately KEEPS
    // unbreakable-control auras (the transition stun relies on that).
    ctx.dealDamage(boss, victim, victim.hp + 1, false, 'shadow', null, 'hit');
    expect(victim.dead).toBe(true);
    expect(isNythraxisImpaled(victim, boss.id)).toBe(true);
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(isNythraxisImpaled(victim, boss.id)).toBe(false);
    expect(sim.entities.has(spikeId)).toBe(false);
    expect(st.boneSpikes?.some((p) => p.playerId === victim.id)).toBe(false);
    // The other spike still stands and still holds its raider.
    expect(spikes()).toHaveLength(1);
    expect(raiders.filter((r) => isNythraxisImpaled(r, boss.id))).toHaveLength(1);
  });

  it('sweeps a stale impale aura off a dead body at the transition and on reset', () => {
    const { ctx, boss, st, room, raiders } = setup();
    const [victim] = nythraxis.castNythraxisBoneSpike(ctx, boss, st, room(), 'normal');
    ctx.dealDamage(boss, victim, victim.hp + 1, false, 'shadow', null, 'hit');
    expect(victim.dead).toBe(true);
    // Transition before the per-tick cleanup ran: the dead body is swept too.
    boss.hp = Math.floor(boss.maxHp * 0.69);
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(st.phase).toBe('transition');
    expect(raiders.some((r) => isNythraxisImpaled(r, boss.id))).toBe(false);
    expect(isNythraxisImpaled(victim, boss.id)).toBe(false);
  });

  it('never marks an impaled raider with Soul Rend', () => {
    const { ctx, boss, st, room, raiders } = setup();
    st.phase = 2;
    const victims = nythraxis.castNythraxisBoneSpike(ctx, boss, st, room(), 'normal');
    // Leave exactly three eligible raiders so the pick is forced.
    for (const raider of raiders) {
      if (victims.includes(raider)) continue;
      if (raiders.indexOf(raider) >= 5) {
        raider.hp = 0;
        raider.dead = true;
      }
    }
    const eligible = room().filter(
      (p) => p.id !== boss.aggroTargetId && !isNythraxisImpaled(p, boss.id),
    );
    nythraxis.castNythraxisSoulRend(ctx, boss, st);
    const markedIds = st.soulRendMarks.map((m) => m.playerId);
    expect(markedIds.length).toBeGreaterThan(0);
    for (const victim of victims) expect(markedIds).not.toContain(victim.id);
    for (const id of markedIds) expect(eligible.some((p) => p.id === id)).toBe(true);
  });

  it('retries in three seconds when nobody is eligible instead of skipping a cycle', () => {
    const { ctx, boss, st, room, tank, raiders } = setup();
    for (const raider of raiders) {
      raider.hp = 0;
      raider.dead = true;
    }
    expect(room()).toEqual([tank]);
    st.boneSpikeTimer = DT / 2;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(isNythraxisImpaled(tank, boss.id)).toBe(false);
    expect(st.boneSpikeTimer).toBe(3);
  });

  it('holds the spike in place through the production mob tick', () => {
    const { sim, ctx, boss, st, room, spikes } = setup();
    nythraxis.castNythraxisBoneSpike(ctx, boss, st, room(), 'normal');
    const spike = spikes()[0];
    const spawn = { ...spike.spawnPos };
    spike.pos.x += 3;
    spike.pos.z -= 3;
    sim.tick();
    expect(spike.pos.x).toBeCloseTo(spawn.x);
    expect(spike.pos.z).toBeCloseTo(spawn.z);
    expect(spike.aggroTargetId).toBeNull();
    expect(spike.dead).toBe(false);
  });

  it('crumbles a spike whose victim died and shatters every spike at the transition', () => {
    const { ctx, boss, st, room, spikes } = setup();
    const victims = nythraxis.castNythraxisBoneSpike(ctx, boss, st, room(), 'normal');
    victims[0].hp = 0;
    victims[0].dead = true;
    nythraxis.updateNythraxisBoneSpikes(ctx, boss, st);
    expect(spikes()).toHaveLength(1);
    expect(st.boneSpikes).toHaveLength(1);
    expect(isNythraxisImpaled(victims[0], boss.id)).toBe(false);

    boss.hp = Math.floor(boss.maxHp * 0.69);
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(st.phase).toBe('transition');
    expect(spikes()).toHaveLength(0);
    expect(st.boneSpikes).toHaveLength(0);
    expect(isNythraxisImpaled(victims[1], boss.id)).toBe(false);
  });

  it('frees and drops everything on an encounter reset', () => {
    const { ctx, boss, st, room, spikes } = setup();
    const victims = nythraxis.castNythraxisBoneSpike(ctx, boss, st, room(), 'normal');
    nythraxis.resetNythraxisEncounter(ctx, boss);
    expect(spikes()).toHaveLength(0);
    expect(victims.every((v) => !isNythraxisImpaled(v, boss.id))).toBe(true);
    expect(boss.nythraxis).toBeUndefined();
  });

  it('holds a due cast while Deathless Rage is being cast, then fires when it resolves', () => {
    const { ctx, boss, st, room, spikes } = setup();
    st.phase = 2;
    nythraxis.startNythraxisDeathlessRage(ctx, boss, st);
    st.boneSpikeTimer = DT / 2;
    tickDriver(ctx, boss, 3);
    expect(spikes()).toHaveLength(0);
    // Let the cast resolve (nobody channels): the spike lands on the next tick.
    st.deathlessCastRemaining = DT;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(spikes()).toHaveLength(2);
    expect(room().length).toBeGreaterThan(0);
  });

  it('re-arms on the difficulty cadence after the first cast at twelve seconds', () => {
    const { ctx, boss, st, room } = setup();
    st.boneSpikeTimer = NYTHRAXIS_BONE_SPIKE_FIRST_SECONDS;
    tickDriver(ctx, boss, NYTHRAXIS_BONE_SPIKE_FIRST_SECONDS - DT);
    expect(room().every((p) => !isNythraxisImpaled(p, boss.id))).toBe(true);
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(room().filter((p) => isNythraxisImpaled(p, boss.id))).toHaveLength(2);
    expect(st.boneSpikeTimer).toBeCloseTo(NYTHRAXIS_BONE_SPIKE_EVERY_NORMAL, 5);
  });
});

describe('Nythraxis Grave Eruption and Grave Flame', () => {
  it('telegraphs circles under raiders with stable ids the readout mirrors', () => {
    const { sim, ctx, boss, st, room } = setup();
    nythraxis.startNythraxisGraveEruption(ctx, boss, st, room());
    expect(st.eruptionPoints).toHaveLength(4);
    const warnings = sim.activeNythraxisGraveEruptions;
    expect(warnings).toHaveLength(4);
    const falls = (sim.events as SimEvent[]).filter(
      (e) =>
        e.type === 'spellfxAt' &&
        e.fx === 'meteorFall' &&
        e.ability === NYTHRAXIS_GRAVE_ERUPTION_CAST_ID,
    ) as Array<Extract<SimEvent, { type: 'spellfxAt' }>>;
    expect(falls.map((f) => f.persistentId).sort()).toEqual(warnings.map((w) => w.id).sort());
    expect(warnings.every((w) => w.radius === NYTHRAXIS_GRAVE_ERUPTION_RADIUS)).toBe(true);
    expect(warnings.every((w) => w.remaining === NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS)).toBe(
      true,
    );
    // Every circle sits under a raider who is not the aggro holder.
    const others = room().filter((p) => p.id !== boss.aggroTargetId);
    for (const point of st.eruptionPoints!) {
      expect(others.some((p) => Math.hypot(p.pos.x - point.x, p.pos.z - point.z) < 0.01)).toBe(
        true,
      );
    }
  });

  it('bursts on whoever stayed, spares whoever moved, and leaves flames that keep burning', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const { sim, ctx, boss, st, room, raiders } = setup({ difficulty });
      nythraxis.startNythraxisGraveEruption(ctx, boss, st, room());
      const points = [...st.eruptionPoints!];
      const stayer = raiders.find((r) =>
        points.some((p) => Math.hypot(r.pos.x - p.x, r.pos.z - p.z) < 0.01),
      )!;
      const mover = raiders.find(
        (r) =>
          r.id !== stayer.id && points.some((p) => Math.hypot(r.pos.x - p.x, r.pos.z - p.z) < 0.01),
      )!;
      teleport(sim, mover, mover.pos.x, mover.pos.z + 40, mover.pos.y);
      const stayerHp = stayer.hp;
      const moverHp = mover.hp;
      tickDriver(ctx, boss, NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS);
      const burst = difficulty === 'heroic' ? 0.75 : 0.45;
      expect(stayerHp - stayer.hp, difficulty).toBe(Math.ceil(stayer.maxHp * burst));
      expect(mover.hp, difficulty).toBe(moverHp);
      expect(st.eruptionPoints, difficulty).toHaveLength(0);
      expect(st.graveFlames, difficulty).toHaveLength(points.length);
      expect(sim.activeNythraxisGraveFlames.length, difficulty).toBe(points.length);
      expect(sim.activeNythraxisGraveEruptions, difficulty).toHaveLength(0);
      const impacts = (sim.events as SimEvent[]).filter(
        (e) => e.type === 'spellfxAt' && e.fx === 'meteorImpact',
      );
      expect(impacts.length, difficulty).toBe(points.length);

      // Standing in the flame: one tick a second at the flame fraction.
      const afterBurst = stayer.hp;
      tickDriver(ctx, boss, 1);
      const tick = difficulty === 'heroic' ? 0.09 : 0.06;
      expect(afterBurst - stayer.hp, difficulty).toBe(Math.ceil(stayer.maxHp * tick));
      const flameHits = (sim.events as SimEvent[]).filter(
        (e) => e.type === 'damage' && e.ability === NYTHRAXIS_GRAVE_FLAME_CAST_ID,
      );
      expect(flameHits.length, difficulty).toBeGreaterThan(0);
      // Flames burn out on the difficulty clock.
      tickDriver(ctx, boss, difficulty === 'heroic' ? 18 : 12);
      expect(st.graveFlames, difficulty).toHaveLength(0);
    }
  });

  it('never aims at an impaled raider or a wardstone channeler', () => {
    const { ctx, boss, st, room } = setup();
    const victims = nythraxis.castNythraxisBoneSpike(ctx, boss, st, room(), 'normal');
    const channeler = room().find((p) => p.id !== boss.aggroTargetId && !victims.includes(p))!;
    st.wardChannels = [{ objectId: 1, playerId: channeler.id, remaining: 5, complete: false }];
    nythraxis.startNythraxisGraveEruption(ctx, boss, st, room());
    for (const point of st.eruptionPoints!) {
      for (const protectedPlayer of [...victims, channeler]) {
        expect(
          Math.hypot(protectedPlayer.pos.x - point.x, protectedPlayer.pos.z - point.z),
        ).toBeGreaterThan(0.01);
      }
    }
  });

  it('re-arms on the difficulty cadence and clears every hazard at the transition', () => {
    const { ctx, boss, st, room } = setup();
    st.eruptionTimer = DT / 2;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(st.eruptionPoints).toHaveLength(4);
    expect(st.eruptionTimer).toBeCloseTo(15, 5);
    tickDriver(ctx, boss, NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS);
    expect(st.graveFlames!.length).toBe(4);
    boss.hp = Math.floor(boss.maxHp * 0.69);
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(st.phase).toBe('transition');
    expect(st.graveFlames).toHaveLength(0);
    expect(st.eruptionPoints).toHaveLength(0);
    expect(room().length).toBeGreaterThan(0);
  });

  it('replays the same placement for the same seed and cast key', () => {
    const first = setup();
    const second = setup();
    nythraxis.startNythraxisGraveEruption(first.ctx, first.boss, first.st, first.room());
    nythraxis.startNythraxisGraveEruption(second.ctx, second.boss, second.st, second.room());
    expect(second.st.eruptionPoints).toEqual(first.st.eruptionPoints);
    expect(second.st.eruptionCastKey).toBe(first.st.eruptionCastKey);
  });
});
