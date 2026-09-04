// Phase 3 against a real Sim: The King's Wrath at 30% (gated on no major in
// flight), the tightened floor cadences, Bone Storm (the whirl, the charges,
// the slams, the mid-storm spike, the pickup), and The Crown Endures clock.
// The driver functions in src/sim/encounters/nythraxis.ts run on a live
// SimContext with a ten-player attuned raid, the way the slice 2 suite does.

import { describe, expect, it } from 'vitest';
import * as nythraxis from '../src/sim/encounters/nythraxis';
import {
  beginNythraxisBoneStorm,
  NYTHRAXIS_BONE_SLAM_CAST_ID,
  NYTHRAXIS_BONE_STORM_AURA_ID,
  NYTHRAXIS_BONE_STORM_CAST_ID,
  NYTHRAXIS_BONE_STORM_FIRST_SECONDS,
  NYTHRAXIS_BONE_STORM_RADIUS,
  nythraxisBoneStormCadence,
} from '../src/sim/nythraxis_bone_storm';
import { NYTHRAXIS_DREAD_CURSE_AURA_ID } from '../src/sim/nythraxis_dread_curse';
import {
  NYTHRAXIS_CROWN_ENDURES_AURA_ID,
  NYTHRAXIS_CROWN_ENDURES_HASTE_AURA_ID,
} from '../src/sim/nythraxis_enrage_clock';
import { NYTHRAXIS_GRAVEFIRE_CAST_ID } from '../src/sim/nythraxis_gravefire';
import { NYTHRAXIS_KINGS_WRATH_AURA_ID } from '../src/sim/nythraxis_kings_wrath';
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

function setup(opts: { difficulty?: 'normal' | 'heroic'; phase?: 1 | 2 | 3 } = {}) {
  const { difficulty = 'normal', phase = 3 } = opts;
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
  // The raid spreads well outside the whirl radius so only deliberate placement
  // puts anyone inside it.
  raiders.forEach((e, i) => {
    teleport(sim, e, boss.spawnPos.x + (i - 4) * 8, boss.spawnPos.z - 30, boss.pos.y);
  });
  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = tank.id;
  boss.threat.set(tank.id, 1000);
  boss.swingTimer = 999;
  const ctx = ctxOf(sim);
  const st = nythraxis.initNythraxisEncounter(boss);
  st.introSpoken = true;
  st.phase = phase;
  st.gravebreakerTimer = 999;
  st.raiseFallenTimer = 999;
  st.soulRendTimer = 999;
  st.deathlessTimer = 999;
  st.dreadCurseTimer = 999;
  st.boneSpikeTimer = 999;
  st.eruptionTimer = 999;
  st.gravefireTimer = 999;
  st.sigilTimer = 999;
  st.boneStormTimer = 999;
  const callouts = (call: Callout['call']) =>
    (sim.events as SimEvent[]).filter(
      (e): e is Callout => e.type === 'nythraxisCallout' && e.call === call,
    );
  const damageBy = (ability: string) =>
    (sim.events as SimEvent[]).filter((e) => e.type === 'damage' && e.ability === ability);
  const aura = (id: string) => boss.auras.find((a: { id: string }) => a.id === id);
  return { sim, ctx, tank, raiders, boss, st, callouts, damageBy, aura };
}

function tickDriver(ctx: SimContext, boss: Entity, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) nythraxis.updateNythraxisEncounter(ctx, boss);
}

describe("Nythraxis The King's Wrath (phase 3 entry)", () => {
  it('enters at 30% with the permanent damage bonus on both difficulties', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const { ctx, boss, st, callouts, aura } = setup({ difficulty, phase: 2 });
      boss.hp = Math.floor(boss.maxHp * 0.31);
      nythraxis.updateNythraxisEncounter(ctx, boss);
      expect(st.phase, difficulty).toBe(2);
      boss.hp = Math.floor(boss.maxHp * 0.3);
      nythraxis.updateNythraxisEncounter(ctx, boss);
      expect(st.phase, difficulty).toBe(3);
      expect(aura(NYTHRAXIS_KINGS_WRATH_AURA_ID)?.value, difficulty).toBe(
        difficulty === 'heroic' ? 0.25 : 0.2,
      );
      expect(callouts('kingsWrath').length, difficulty).toBe(10);
      // The first storm is armed on entry; the same tick's cast block already
      // counted it down once.
      expect(st.boneStormTimer, difficulty).toBeCloseTo(NYTHRAXIS_BONE_STORM_FIRST_SECONDS - DT, 9);
    }
  });

  it('waits for a live sigil and for a Deathless Rage cast before entering', () => {
    const { ctx, boss, st } = setup({ phase: 2 });
    boss.hp = Math.floor(boss.maxHp * 0.2);
    st.sigil = {
      castKey: 1,
      x: boss.pos.x + 15,
      z: boss.pos.z,
      remaining: 9,
      ascensionTimer: 2,
      ascensionStacks: 0,
    };
    tickDriver(ctx, boss, 1);
    expect(st.phase).toBe(2);
    st.sigil = null;
    st.deathlessCastRemaining = 2;
    tickDriver(ctx, boss, 1);
    expect(st.phase).toBe(2);
    st.deathlessCastRemaining = 0;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(st.phase).toBe(3);
  });

  it('tightens Grave Eruption to 10 s (heroic 8) and Gravefire to 8 s (heroic 6)', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const { sim, ctx, boss, st, raiders } = setup({ difficulty });
      st.eruptionTimer = DT / 2;
      nythraxis.updateNythraxisEncounter(ctx, boss);
      expect(st.eruptionTimer, difficulty).toBe(difficulty === 'heroic' ? 8 : 10);
      st.eruptionTimer = 999;
      teleport(sim, raiders[0], boss.pos.x + 20, boss.pos.z, boss.pos.y);
      st.gravefireTimer = DT / 2;
      nythraxis.updateNythraxisEncounter(ctx, boss);
      expect(st.gravefireTimer, difficulty).toBe(difficulty === 'heroic' ? 6 : 8);
    }
  });

  it('is gone from the fight: no Final Stand at 5%', () => {
    const { ctx, boss } = setup({ phase: 3 });
    boss.hp = Math.floor(boss.maxHp * 0.04);
    tickDriver(ctx, boss, 1);
    expect(boss.enraged).toBe(false);
    expect(boss.auras.some((a: { name: string }) => a.name === 'Final Stand')).toBe(false);
    expect('finalStand' in (boss.nythraxis as object)).toBe(false);
  });
});

describe('Nythraxis Bone Storm', () => {
  it('begins in phase 3 once no major owns his body, and marks him', () => {
    const { ctx, boss, st, callouts, aura } = setup();
    st.boneStormTimer = DT / 2;
    st.sigil = {
      castKey: 1,
      x: boss.pos.x + 15,
      z: boss.pos.z,
      remaining: 9,
      ascensionTimer: 2,
      ascensionStacks: 0,
    };
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(st.boneStorm).toBeNull();
    expect(st.boneStormTimer).toBe(1);
    st.sigil = null;
    st.boneStormTimer = DT / 2;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(st.boneStorm).not.toBeNull();
    expect(st.boneStormTimer).toBe(nythraxisBoneStormCadence('normal'));
    expect(aura(NYTHRAXIS_BONE_STORM_AURA_ID)).toBeTruthy();
    expect(callouts('boneStormBegins').length).toBe(10);
    // The first charge window opens on the next storm tick: exactly one raider
    // is told they are the charge.
    nythraxis.updateNythraxisEncounter(ctx, boss);
    const charged = callouts('boneStormCharge');
    expect(charged.length).toBe(1);
    expect(charged[0].pid).toBe(st.boneStorm!.chargeTargetId);
  });

  it('slams on arrival, lights a Gravefire down the charge, and whirls 10% (heroic 20%) inside 9 yd', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const { sim, ctx, boss, st, tank, raiders, damageBy } = setup({ difficulty });
      // A storm already running with the tank as its charge, 3 yd away (reached
      // at once); one mage stands just outside the whirl radius.
      teleport(sim, tank, boss.pos.x + 3, boss.pos.z, boss.pos.y);
      teleport(
        sim,
        raiders[0],
        boss.pos.x,
        boss.pos.z - (NYTHRAXIS_BONE_STORM_RADIUS + 1),
        boss.pos.y,
      );
      const storm = beginNythraxisBoneStorm(7);
      storm.chargeTargetId = tank.id;
      storm.chargedIds.push(tank.id);
      st.boneStorm = storm;
      const tankHp = tank.hp;
      const outsideHp = raiders[0].hp;
      nythraxis.updateNythraxisEncounter(ctx, boss);
      // Bone Slam on arrival, at the difficulty's fraction, on everyone in 9 yd.
      const slams = damageBy(NYTHRAXIS_BONE_SLAM_CAST_ID) as { targetId: number; amount: number }[];
      expect(
        slams.map((e) => e.targetId),
        difficulty,
      ).toEqual([tank.id]);
      expect(slams[0].amount, difficulty).toBe(
        Math.ceil(tank.maxHp * (difficulty === 'heroic' ? 0.55 : 0.35)),
      );
      expect(storm.slammed, difficulty).toBe(true);
      // The line runs on in the charge direction (+x here).
      expect(st.gravefires, difficulty).toHaveLength(1);
      expect(st.gravefires![0].dirX, difficulty).toBeCloseTo(1, 6);
      expect(st.gravefires![0].dirZ, difficulty).toBeCloseTo(0, 6);
      // He whirls in place until the next window: one tick a second, 10% max hp.
      tickDriver(ctx, boss, 1);
      const whirls = damageBy(NYTHRAXIS_BONE_STORM_CAST_ID) as {
        targetId: number;
        amount: number;
      }[];
      expect(
        whirls.map((e) => e.targetId),
        difficulty,
      ).toEqual([tank.id]);
      expect(whirls[0].amount, difficulty).toBe(
        Math.ceil(tank.maxHp * (difficulty === 'heroic' ? 0.2 : 0.1)),
      );
      // The slam's Gravefire line ran through the tank too (3 yd along it).
      const burned = (
        damageBy(NYTHRAXIS_GRAVEFIRE_CAST_ID) as { targetId: number; amount: number }[]
      )
        .filter((e) => e.targetId === tank.id)
        .reduce((sum, e) => sum + e.amount, 0);
      expect(burned, difficulty).toBeGreaterThan(0);
      expect(tankHp - tank.hp, difficulty).toBe(slams[0].amount + whirls[0].amount + burned);
      expect(raiders[0].hp, difficulty).toBe(outsideHp);
    }
  });

  it('charges four different raiders, spikes mid-storm, then hands him back to the top tank', () => {
    const { ctx, boss, st, tank, raiders, callouts, aura, damageBy } = setup();
    st.boneStormTimer = DT / 2;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    const storm = st.boneStorm!;
    expect(storm).not.toBeNull();
    // Armed once he is storming: both hold until it ends.
    st.dreadCurseTimer = DT / 2;
    st.eruptionTimer = DT / 2;
    tickDriver(ctx, boss, 6.1);
    // The mid-storm Bone Spike landed at 6 s.
    expect(storm.spikeCast).toBe(true);
    expect(st.boneSpikes!.length).toBe(2);
    // New casts hold while he runs, and the Curse never lands off a charge.
    expect(st.eruptionPoints!.length).toBe(0);
    expect(
      raiders.some((r) =>
        r.auras.some((a: { id: string }) => a.id === NYTHRAXIS_DREAD_CURSE_AURA_ID),
      ),
    ).toBe(false);
    expect(tank.auras.some((a: { id: string }) => a.id === NYTHRAXIS_DREAD_CURSE_AURA_ID)).toBe(
      false,
    );
    tickDriver(ctx, boss, 6.2);
    // Twelve seconds: over. Four distinct charges, the storm aura gone, the
    // top-threat tank has him, Gravebreaker re-arms in 3 s, the major gap runs
    // (both a few ticks along by now).
    expect(new Set(storm.chargedIds).size).toBe(4);
    expect(st.boneStorm).toBeNull();
    expect(aura(NYTHRAXIS_BONE_STORM_AURA_ID)).toBeUndefined();
    expect(boss.aggroTargetId).toBe(tank.id);
    expect(st.gravebreakerTimer).toBeGreaterThan(2.5);
    expect(st.gravebreakerTimer).toBeLessThanOrEqual(3);
    expect(st.majorGapTimer).toBeGreaterThan(5.5);
    expect(st.majorGapTimer).toBeLessThanOrEqual(6);
    expect(callouts('boneStormEnds').length).toBe(10);
    // The held eruption fired as soon as the storm was over.
    expect(st.eruptionPoints!.length).toBeGreaterThan(0);
    expect(damageBy(NYTHRAXIS_BONE_SLAM_CAST_ID).length).toBeGreaterThanOrEqual(4);
  });

  it('never charges an impaled raider or a wardstone channeler', () => {
    const { ctx, boss, st, tank, raiders, callouts } = setup();
    // Everyone but the tank is either impaled or channeling: the tank is the only run.
    for (const r of raiders) {
      r.auras.push({
        id: 'nythraxis_impaled',
        name: 'Impaled',
        kind: 'stun',
        remaining: 30,
        duration: 30,
        value: 0,
        sourceId: boss.id,
        school: 'physical',
        unbreakableControl: true,
        encounterOwned: true,
      } as never);
    }
    st.boneStormTimer = DT / 2;
    tickDriver(ctx, boss, 3);
    expect(st.boneStorm!.chargedIds).toEqual([tank.id]);
    expect(callouts('boneStormCharge').every((c) => c.pid === tank.id)).toBe(true);
    // Nobody eligible at all: the storm does not start, and retries in 3 s.
    const { ctx: ctx2, boss: boss2, st: st2, tank: tank2, raiders: raiders2 } = setup();
    for (const p of [tank2, ...raiders2]) p.dead = true;
    st2.boneStormTimer = DT / 2;
    // A dead room wipes the encounter instead; keep one live raider but make it a channeler.
    tank2.dead = false;
    st2.wardChannels = [{ objectId: 1, playerId: tank2.id, remaining: 5, complete: false }];
    for (const r of raiders2) r.dead = false;
    for (const r of raiders2) {
      r.auras.push({
        id: 'nythraxis_impaled',
        name: 'Impaled',
        kind: 'stun',
        remaining: 30,
        duration: 30,
        value: 0,
        sourceId: boss2.id,
        school: 'physical',
        unbreakableControl: true,
        encounterOwned: true,
      } as never);
    }
    nythraxis.updateNythraxisEncounter(ctx2, boss2);
    expect(st2.boneStorm).toBeNull();
    expect(st2.boneStormTimer).toBe(3);
  });

  it('is dropped by a reset and by the kill', () => {
    const { ctx, boss, st, aura } = setup();
    st.boneStormTimer = DT / 2;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(st.boneStorm).not.toBeNull();
    nythraxis.onBossDeath(ctx, boss);
    expect(boss.nythraxis!.boneStorm).toBeNull();
    expect(aura(NYTHRAXIS_BONE_STORM_AURA_ID)).toBeUndefined();
    const second = setup();
    second.st.boneStormTimer = DT / 2;
    nythraxis.updateNythraxisEncounter(second.ctx, second.boss);
    expect(second.st.boneStorm).not.toBeNull();
    nythraxis.resetNythraxisEncounter(second.ctx, second.boss);
    expect(second.boss.nythraxis).toBeUndefined();
    expect(second.aura(NYTHRAXIS_BONE_STORM_AURA_ID)).toBeUndefined();
    expect(second.aura(NYTHRAXIS_KINGS_WRATH_AURA_ID)).toBeUndefined();
  });
});

describe('Nythraxis The Crown Endures (the enrage clock)', () => {
  it('runs from the pull, pauses for the transition, and warns at 60, 30, and 10 s', () => {
    const { ctx, boss, st, callouts } = setup({ phase: 1 });
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(st.enrageElapsed).toBeCloseTo(DT, 9);
    // Brother Aldric's entrance is not the raid's time: the clock holds.
    st.phase = 'transition';
    st.transitionStarted = true;
    st.transitionTimer = 5;
    tickDriver(ctx, boss, 1);
    expect(st.enrageElapsed).toBeCloseTo(DT, 9);
    st.phase = 2;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(st.enrageElapsed).toBeCloseTo(2 * DT, 9);
    for (const [mark, call] of [
      [60, 'crownEndures60'],
      [30, 'crownEndures30'],
      [10, 'crownEndures10'],
    ] as const) {
      st.enrageElapsed = 360 - mark - DT / 2;
      nythraxis.updateNythraxisEncounter(ctx, boss);
      expect(callouts(call).length, String(mark)).toBe(10);
    }
    expect(callouts('crownEndures').length).toBe(0);
  });

  it('enrages at 6:00 (heroic 5:00) with +50% damage and attack speed, then ramps', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const { ctx, boss, st, callouts, aura } = setup({ difficulty });
      const limit = difficulty === 'heroic' ? 300 : 360;
      st.enrageElapsed = limit - DT / 2;
      nythraxis.updateNythraxisEncounter(ctx, boss);
      expect(callouts('crownEndures').length, difficulty).toBe(10);
      expect(aura(NYTHRAXIS_CROWN_ENDURES_AURA_ID), difficulty).toMatchObject({
        value: 0.5,
        stacks: 1,
      });
      expect(aura(NYTHRAXIS_CROWN_ENDURES_HASTE_AURA_ID)?.value, difficulty).toBe(1.5);
      expect(st.enrageStacks, difficulty).toBe(1);
      // One ramp later (30 s, heroic 20 s): a second stack, +25% more.
      st.enrageElapsed = limit + (difficulty === 'heroic' ? 20 : 30) - DT / 2;
      nythraxis.updateNythraxisEncounter(ctx, boss);
      expect(aura(NYTHRAXIS_CROWN_ENDURES_AURA_ID), difficulty).toMatchObject({
        value: 0.75,
        stacks: 2,
      });
      // It fires once: no second enrage callout.
      expect(callouts('crownEndures').length, difficulty).toBe(10);
    }
  });
});
