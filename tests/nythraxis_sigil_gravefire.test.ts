// The slice 2 mechanics against a real Sim: Binding Sigil (the pull), Gravefire
// (the traveling line), Soulfire (Soul Rend's pools), and the major-cast
// scheduler that keeps the body-owning casts apart. The driver functions in
// src/sim/encounters/nythraxis.ts run on a live SimContext with a ten-player
// attuned raid, the way the Bone Spike suite does.

import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { dungeonInstanceAt } from '../src/sim/dungeon_floor';
import * as nythraxis from '../src/sim/encounters/nythraxis';
import {
  NYTHRAXIS_ASCENSION_AURA_ID,
  NYTHRAXIS_ASCENSION_HASTE_AURA_ID,
  NYTHRAXIS_BOUND_AURA_ID,
  NYTHRAXIS_BOUND_STUN_AURA_ID,
  NYTHRAXIS_SIGIL_FLOOR_CLEARANCE,
  NYTHRAXIS_SIGIL_MAX_DIST,
  NYTHRAXIS_SIGIL_MIN_DIST,
  NYTHRAXIS_SIGIL_WARDSTONE_CLEARANCE,
  NYTHRAXIS_UNBOUND_AURA_ID,
  nythraxisSigilCandidate,
  nythraxisSigilRadius,
} from '../src/sim/nythraxis_binding_sigil';
import {
  isNythraxisImpaled,
  NYTHRAXIS_BONE_SPIKE_FIRE_SETTLE_SECONDS,
  NYTHRAXIS_BONE_SPIKE_RAGE_LEAD_SECONDS,
} from '../src/sim/nythraxis_bone_spike';
import {
  NYTHRAXIS_GRAVEFIRE_CAST_ID,
  NYTHRAXIS_GRAVEFIRE_HALF_WIDTH,
} from '../src/sim/nythraxis_gravefire';
import {
  NYTHRAXIS_FLAME_PERMANENT_SECONDS,
  NYTHRAXIS_SOULFIRE_CAST_ID,
  NYTHRAXIS_SOULFIRE_RADIUS,
} from '../src/sim/nythraxis_soulfire';
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

function setup(opts: { difficulty?: 'normal' | 'heroic'; phase?: 1 | 2 } = {}) {
  const { difficulty = 'normal', phase = 1 } = opts;
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
  const room = () => nythraxis.playersInNythraxisRoom(ctx, boss);
  const wards = () => nythraxis.nythraxisWardstones(ctx, boss);
  const callouts = (call: Callout['call']) =>
    (sim.events as SimEvent[]).filter(
      (e): e is Callout => e.type === 'nythraxisCallout' && e.call === call,
    );
  const damageBy = (ability: string) =>
    (sim.events as SimEvent[]).filter((e) => e.type === 'damage' && e.ability === ability);
  return { sim, ctx, tank, raiders, boss, st, room, wards, callouts, damageBy };
}

function tickDriver(ctx: SimContext, boss: Entity, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) nythraxis.updateNythraxisEncounter(ctx, boss);
}

function tickSim(sim: Sim, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) sim.tick();
}

type Flat = { x: number; z: number };
const flat = (a: Flat, b: Flat): number => Math.hypot(a.x - b.x, a.z - b.z);

const SIGIL_AURA_IDS = [
  NYTHRAXIS_ASCENSION_AURA_ID,
  NYTHRAXIS_ASCENSION_HASTE_AURA_ID,
  NYTHRAXIS_BOUND_AURA_ID,
  NYTHRAXIS_BOUND_STUN_AURA_ID,
  NYTHRAXIS_UNBOUND_AURA_ID,
] as const;
const SIGIL_AURA_ID_SET: ReadonlySet<string> = new Set(SIGIL_AURA_IDS);

function primeNythraxisCleanupState(
  sim: AnySim,
  ctx: SimContext,
  boss: AnyEntity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  for (const id of SIGIL_AURA_IDS) {
    ctx.applyAura(boss, {
      id,
      name: id,
      kind: 'buff_dmg_done',
      remaining: 10,
      duration: 10,
      value: 1,
      sourceId: boss.id,
      school: 'shadow',
      encounterOwned: true,
    });
  }
  st.sigil = {
    castKey: 7,
    x: boss.pos.x + 20,
    z: boss.pos.z,
    remaining: 10,
    ascensionTimer: 1,
    ascensionStacks: 2,
  };
  st.majorGapTimer = 5;
  st.gravefires = [
    {
      seq: 3,
      x: boss.pos.x,
      z: boss.pos.z,
      dirX: 1,
      dirZ: 0,
      elapsed: 1,
      tickTimer: 1,
    },
  ];
  st.graveFlames = [
    {
      seq: 4,
      kind: 'grave',
      x: boss.pos.x + 8,
      z: boss.pos.z,
      radius: 3,
      remaining: 10,
      tickTimer: 1,
    },
  ];
  st.eruptionCastKey = 5;
  st.eruptionImpactRemaining = 1;
  st.eruptionPoints = [{ x: boss.pos.x - 8, z: boss.pos.z }];
  expect(sim.activeNythraxisBindingSigils).toHaveLength(1);
  expect(sim.activeNythraxisGravefires).toHaveLength(1);
  expect(sim.activeNythraxisGraveFlames).toHaveLength(1);
  expect(sim.activeNythraxisGraveEruptions).toHaveLength(1);
}

function expectNythraxisCleanup(
  sim: AnySim,
  boss: AnyEntity,
  st: NonNullable<Entity['nythraxis']>,
): void {
  expect(boss.auras.filter((a: { id: string }) => SIGIL_AURA_ID_SET.has(a.id))).toEqual([]);
  expect(st.gravefires).toEqual([]);
  expect(st.graveFlames).toEqual([]);
  expect(st.majorGapTimer).toBe(0);
  expect(sim.activeNythraxisBindingSigils).toEqual([]);
  expect(sim.activeNythraxisGravefires).toEqual([]);
  expect(sim.activeNythraxisGraveFlames).toEqual([]);
  expect(sim.activeNythraxisGraveEruptions).toEqual([]);
}

describe('Nythraxis Binding Sigil (the pull)', () => {
  it('flares a sigil on open floor inside the ring band, clear of every wardstone', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const { sim, ctx, boss, st, wards, callouts } = setup({ difficulty });
      st.sigilTimer = DT / 2;
      nythraxis.updateNythraxisEncounter(ctx, boss);
      const sigil = st.sigil!;
      expect(sigil, difficulty).toBeTruthy();
      const d = flat(sigil, boss.pos);
      expect(d, difficulty).toBeGreaterThanOrEqual(NYTHRAXIS_SIGIL_MIN_DIST - 1e-6);
      expect(d, difficulty).toBeLessThanOrEqual(NYTHRAXIS_SIGIL_MAX_DIST + 1e-6);
      for (const ward of wards()) {
        expect(flat(ward.pos, sigil), difficulty).toBeGreaterThanOrEqual(
          NYTHRAXIS_SIGIL_WARDSTONE_CLEARANCE,
        );
      }
      expect(sigil.remaining, difficulty).toBe(difficulty === 'heroic' ? 12 : 15);
      expect(sigil.ascensionStacks, difficulty).toBe(0);
      expect(callouts('sigilAppears').length, difficulty).toBe(10);
      expect(sim.activeNythraxisBindingSigils, difficulty).toHaveLength(1);
      expect(sim.activeNythraxisBindingSigils[0], difficulty).toMatchObject({
        x: sigil.x,
        z: sigil.z,
        radius: nythraxisSigilRadius(difficulty),
      });
      const cadence = difficulty === 'heroic' ? 40 : 45;
      expect(st.sigilTimer, difficulty).toBe(cadence);
      tickDriver(ctx, boss, 1);
      expect(st.sigilTimer, difficulty).toBeCloseTo(cadence - 1, 5);
    }
  });

  it('places the sigil deterministically for the same seed and cast tick', () => {
    const a = setup();
    const b = setup();
    a.st.sigilTimer = DT / 2;
    b.st.sigilTimer = DT / 2;
    nythraxis.updateNythraxisEncounter(a.ctx, a.boss);
    nythraxis.updateNythraxisEncounter(b.ctx, b.boss);
    expect(b.st.sigil).toEqual(a.st.sigil);
  });

  it('routes around the nearby Threshold Wardstone through the real driver', () => {
    const { sim, ctx, boss, st, wards } = setup();
    teleport(sim, boss, boss.spawnPos.x, boss.spawnPos.z - 16, boss.pos.y);
    st.sigilTimer = DT / 2;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    const sigil = st.sigil!;
    expect(sigil).toBeTruthy();
    for (const ward of wards()) expect(flat(ward.pos, sigil)).toBeGreaterThanOrEqual(6);
    expect(
      Array.from({ length: 48 }, (_, i) =>
        nythraxisSigilCandidate(sigil.castKey, i, boss.pos),
      ).some((candidate) => wards().some((ward) => flat(ward.pos, candidate) < 6)),
    ).toBe(true);
  });

  it('places several driver casts on real open arena floor with two yard bounds clearance', () => {
    const { sim, boss, st } = setup();
    const castKeys = new Set<number>();
    for (let cast = 0; cast < 6; cast++) {
      st.sigil = null;
      st.majorGapTimer = 0;
      st.sigilTimer = DT / 2;
      sim.tick();
      const sigil = st.sigil!;
      expect(sigil).toBeTruthy();
      castKeys.add(sigil.castKey);
      expect(isBlocked(sim.cfg.seed, sigil.x, sigil.z, NYTHRAXIS_SIGIL_FLOOR_CLEARANCE)).toBe(
        false,
      );
      const frame = dungeonInstanceAt(sigil.x, sigil.z);
      expect(frame?.dungeonId).toBe('nythraxis_boss_arena');
      const localX = sigil.x - frame!.ox;
      const localZ = sigil.z - frame!.oz;
      const halfX = frame!.layout.floorHalfX!;
      expect(Math.abs(localX)).toBeLessThanOrEqual(halfX - 2);
      expect(localZ).toBeGreaterThanOrEqual(frame!.layout.zMin + 2);
      expect(localZ).toBeLessThanOrEqual(frame!.layout.zMax - 2);
      sim.tick();
      sim.tick();
    }
    expect(castKeys.size).toBe(6);
  });

  it('threads normal fire exclusion and heroic fire allowance through the driver', () => {
    const normal = setup();
    const normalWithoutFire = setup();
    const heroic = setup({ difficulty: 'heroic' });
    normalWithoutFire.st.sigilTimer = DT / 2;
    nythraxis.updateNythraxisEncounter(normalWithoutFire.ctx, normalWithoutFire.boss);
    const openPlacement = normalWithoutFire.st.sigil!;
    const openAngle = Math.atan2(
      openPlacement.x - normalWithoutFire.boss.pos.x,
      openPlacement.z - normalWithoutFire.boss.pos.z,
    );
    const gapAngle = openAngle + Math.PI;
    let seq = 0;
    const flames = [] as NonNullable<typeof normal.st.graveFlames>;
    for (const radius of [12, 16, 20, 24, 28, 30]) {
      for (let degrees = 0; degrees < 360; degrees += 15) {
        const angle = (degrees * Math.PI) / 180;
        const fromGap = Math.abs(
          Math.atan2(Math.sin(angle - gapAngle), Math.cos(angle - gapAngle)),
        );
        if (fromGap < Math.PI / 5) continue;
        flames.push({
          seq: seq++,
          kind: 'grave',
          x: normal.boss.pos.x + Math.sin(angle) * radius,
          z: normal.boss.pos.z + Math.cos(angle) * radius,
          radius: 3,
          remaining: 10,
          tickTimer: 1,
        });
      }
    }
    normal.st.graveFlames = flames.map((flame) => ({ ...flame }));
    heroic.st.graveFlames = flames.map((flame) => ({ ...flame }));
    expect(normal.ctx.tickCount).toBe(heroic.ctx.tickCount);
    normal.st.sigilTimer = DT / 2;
    heroic.st.sigilTimer = DT / 2;
    nythraxis.updateNythraxisEncounter(normal.ctx, normal.boss);
    nythraxis.updateNythraxisEncounter(heroic.ctx, heroic.boss);
    const normalSigil = normal.st.sigil!;
    expect(normalSigil).toBeTruthy();
    for (const flame of normal.st.graveFlames!) {
      expect(flat(flame, normalSigil)).toBeGreaterThanOrEqual(
        flame.radius + nythraxisSigilRadius('normal'),
      );
    }
    expect(normalSigil).not.toMatchObject({ x: openPlacement.x, z: openPlacement.z });
    expect(heroic.st.sigil).toMatchObject({ x: openPlacement.x, z: openPlacement.z });
  });

  it('climbs Deathless Ascension every two seconds while the sigil stands', () => {
    const { ctx, boss, st } = setup();
    nythraxis.startNythraxisSigil(ctx, boss, st);
    tickDriver(ctx, boss, 2);
    let dmg = boss.auras.find((a) => a.id === NYTHRAXIS_ASCENSION_AURA_ID);
    let haste = boss.auras.find((a) => a.id === NYTHRAXIS_ASCENSION_HASTE_AURA_ID);
    expect(dmg?.stacks).toBe(1);
    expect(dmg?.value).toBeCloseTo(0.04);
    expect(dmg?.kind).toBe('buff_dmg_done');
    expect(haste?.value).toBeCloseTo(1.04);
    tickDriver(ctx, boss, 4);
    dmg = boss.auras.find((a) => a.id === NYTHRAXIS_ASCENSION_AURA_ID);
    haste = boss.auras.find((a) => a.id === NYTHRAXIS_ASCENSION_HASTE_AURA_ID);
    expect(dmg?.stacks).toBe(3);
    expect(dmg?.value).toBeCloseTo(0.12);
    expect(haste?.stacks).toBe(3);
    expect(st.sigil?.remaining).toBeCloseTo(15 - 6, 5);
  });

  it('binds him when he is dragged onto the sigil: purge, stun, and the burn window', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const { sim, ctx, boss, st, callouts } = setup({ difficulty });
      nythraxis.startNythraxisSigil(ctx, boss, st);
      tickDriver(ctx, boss, 4);
      expect(
        boss.auras.some((a) => a.id === NYTHRAXIS_ASCENSION_AURA_ID),
        difficulty,
      ).toBe(true);
      const sigil = st.sigil!;
      teleport(sim, boss, sigil.x, sigil.z, boss.pos.y);
      nythraxis.updateNythraxisEncounter(ctx, boss);
      expect(st.sigil, difficulty).toBeNull();
      expect(
        boss.auras.some((a) => a.id === NYTHRAXIS_ASCENSION_AURA_ID),
        difficulty,
      ).toBe(false);
      expect(
        boss.auras.some((a) => a.id === NYTHRAXIS_ASCENSION_HASTE_AURA_ID),
        difficulty,
      ).toBe(false);
      const stun = boss.auras.find((a) => a.id === NYTHRAXIS_BOUND_STUN_AURA_ID);
      expect(stun?.kind, difficulty).toBe('stun');
      expect(stun?.remaining, difficulty).toBe(difficulty === 'heroic' ? 3 : 4);
      const bound = boss.auras.find((a) => a.id === NYTHRAXIS_BOUND_AURA_ID);
      expect(bound?.kind, difficulty).toBe('vulnerability');
      expect(bound?.value, difficulty).toBe(0.25);
      expect(bound?.remaining, difficulty).toBe(difficulty === 'heroic' ? 8 : 10);
      expect(callouts('sigilBound').length, difficulty).toBe(10);
      expect(sim.activeNythraxisBindingSigils, difficulty).toHaveLength(0);
      expect(st.majorGapTimer, difficulty).toBe(6);
    }
  });

  it('fails Unbound when the window ends: a raid-wide hit and a lasting damage bonus', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const { ctx, boss, st, room, callouts, damageBy } = setup({ difficulty });
      const before = new Map(room().map((p) => [p.id, p.hp]));
      nythraxis.startNythraxisSigil(ctx, boss, st);
      st.sigil!.remaining = DT / 2;
      nythraxis.updateNythraxisEncounter(ctx, boss);
      expect(st.sigil, difficulty).toBeNull();
      const hit = difficulty === 'heroic' ? 0.6 : 0.4;
      for (const p of room()) {
        expect((before.get(p.id) ?? 0) - p.hp, difficulty).toBe(Math.ceil(p.maxHp * hit));
      }
      expect(damageBy('Unbound').length, difficulty).toBe(10);
      const unbound = boss.auras.find((a) => a.id === NYTHRAXIS_UNBOUND_AURA_ID);
      expect(unbound?.kind, difficulty).toBe('buff_dmg_done');
      expect(unbound?.value, difficulty).toBe(difficulty === 'heroic' ? 0.25 : 0.2);
      expect(
        boss.auras.some((a) => a.id === NYTHRAXIS_ASCENSION_AURA_ID),
        difficulty,
      ).toBe(false);
      expect(callouts('sigilUnbound').length, difficulty).toBe(10);
      expect(st.majorGapTimer, difficulty).toBe(6);
    }
  });

  it('a later binding removes the Unbound bonus', () => {
    const { sim, ctx, boss, st } = setup();
    nythraxis.startNythraxisSigil(ctx, boss, st);
    tickDriver(ctx, boss, 15 + DT);
    expect(boss.auras.some((a) => a.id === NYTHRAXIS_UNBOUND_AURA_ID)).toBe(true);
    st.majorGapTimer = 0;
    nythraxis.startNythraxisSigil(ctx, boss, st);
    const sigil = st.sigil!;
    teleport(sim, boss, sigil.x, sigil.z, boss.pos.y);
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(boss.auras.some((a) => a.id === NYTHRAXIS_UNBOUND_AURA_ID)).toBe(false);
    expect(boss.auras.some((a) => a.id === NYTHRAXIS_BOUND_AURA_ID)).toBe(true);
  });

  it('keeps Deathless Rage and the sigil apart with the six second gap', () => {
    const { ctx, boss, st, room } = setup({ phase: 2 });
    nythraxis.startNythraxisSigil(ctx, boss, st);
    // A due Rage waits for the live sigil.
    st.deathlessTimer = DT / 2;
    tickDriver(ctx, boss, 2);
    expect(st.deathlessCastRemaining).toBe(0);
    expect(st.deathlessTimer).toBeLessThanOrEqual(1);
    // Let the sigil fail; the gap then holds the Rage for six more seconds.
    tickDriver(ctx, boss, 14);
    expect(st.sigil).toBeNull();
    expect(st.majorGapTimer).toBeGreaterThan(0);
    // Top the raid up: the Unbound hit plus the uninterrupted Rage below would
    // otherwise wipe a level-1 test raid and reset the encounter under us.
    for (const p of room()) p.hp = p.maxHp;
    tickDriver(ctx, boss, 3);
    expect(st.deathlessCastRemaining).toBe(0);
    tickDriver(ctx, boss, 4);
    expect(st.deathlessCastRemaining).toBeGreaterThan(0);
    // And a due sigil waits for the gap after the Rage.
    st.deathlessCastRemaining = DT;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(st.majorGapTimer).toBe(6);
    st.sigilTimer = DT / 2;
    tickDriver(ctx, boss, 3);
    expect(st.sigil).toBeNull();
    // The gap ends at six seconds and the held sigil re-checks within a second.
    tickDriver(ctx, boss, 5);
    expect(st.sigil).not.toBeNull();
  });

  it('holds due Gravefire and Sigil casts through Deathless Rage and its major gap', () => {
    const { ctx, boss, st } = setup({ phase: 2 });
    nythraxis.startNythraxisDeathlessRage(ctx, boss, st);
    st.gravefireTimer = DT / 2;
    st.sigilTimer = DT / 2;
    tickDriver(ctx, boss, 3);
    expect(st.gravefires).toEqual([]);
    expect(st.sigil).toBeNull();
    st.deathlessCastRemaining = DT;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(st.majorGapTimer).toBe(6);
    tickDriver(ctx, boss, 6 + DT);
    expect(st.gravefires!.length).toBeGreaterThan(0);
    expect(st.sigil).not.toBeNull();
  });

  it('starts a six second major gap when the heroic court summon completes', () => {
    const { ctx, boss, st } = setup({ difficulty: 'heroic', phase: 2 });
    st.heroicSummonChannelRemaining = DT;
    st.majorGapTimer = 0;
    nythraxis.updateNythraxisHeroicSummon(ctx, boss, st);
    expect(st.majorGapTimer).toBe(6);
  });

  it('holds all encounter casts while Bound stuns the boss, then resumes each arm', () => {
    const { sim, ctx, boss, st } = setup({ phase: 2 });
    nythraxis.startNythraxisSigil(ctx, boss, st);
    const sigil = st.sigil!;
    teleport(sim, boss, sigil.x, sigil.z, boss.pos.y);
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(boss.auras.some((a) => a.id === NYTHRAXIS_BOUND_STUN_AURA_ID)).toBe(true);
    st.gravebreakerTimer = DT / 2;
    st.gravebreakerCharged = false;
    st.boneSpikeTimer = DT / 2;
    st.eruptionTimer = DT / 2;
    st.sigilTimer = DT / 2;
    st.gravefireTimer = DT / 2;
    st.soulRendTimer = DT / 2;
    // The Rage stays out of its spike lead here: an imminent Rage would (by
    // design) hold the spike cast this test wants to see resume.
    st.deathlessTimer = NYTHRAXIS_BONE_SPIKE_RAGE_LEAD_SECONDS + 20;
    st.gravefires = [
      {
        seq: 0,
        x: boss.pos.x,
        z: boss.pos.z,
        dirX: 1,
        dirZ: 0,
        elapsed: 0,
        tickTimer: 1,
      },
    ];
    st.gravefireSeq = 1;
    st.graveFlames = [
      {
        seq: 0,
        kind: 'grave',
        x: boss.pos.x + 80,
        z: boss.pos.z,
        radius: 3,
        remaining: 10,
        tickTimer: 1,
      },
    ];
    tickSim(sim, 1);
    expect(st.gravebreakerCharged).toBe(false);
    expect(st.boneSpikes).toEqual([]);
    expect(st.eruptionPoints).toEqual([]);
    expect(st.gravefireSeq).toBe(1);
    expect(st.gravefires).toHaveLength(1);
    expect(st.gravefires![0].elapsed).toBeCloseTo(1, 5);
    expect(st.graveFlames![0].remaining).toBeCloseTo(9, 5);
    expect(st.sigil).toBeNull();
    expect(st.soulRendMarks).toEqual([]);
    expect(st.deathlessCastRemaining).toBe(0);
    tickSim(sim, 3.2);
    expect(st.gravebreakerCharged).toBe(true);
    expect(st.boneSpikes!.length).toBeGreaterThan(0);
    // Spikes and eruptions never overlap: the spike wave that just landed holds
    // the eruption for its settle window, then it arms.
    expect(st.eruptionPoints).toEqual([]);
    expect(st.spikeSettleTimer).toBeGreaterThan(0);
    expect(st.gravefires!.length).toBeGreaterThan(1);
    expect(st.soulRendMarks.length).toBeGreaterThan(0);
    tickSim(sim, NYTHRAXIS_BONE_SPIKE_FIRE_SETTLE_SECONDS);
    expect(st.eruptionPoints!.length).toBeGreaterThan(0);
    tickSim(sim, 2);
    expect(st.sigil).not.toBeNull();
    nythraxis.clearNythraxisSigil(boss);
    st.soulRendMarks = [];
    st.soulRendLockout = 0;
    st.deathlessTimer = DT / 2;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(st.deathlessCastRemaining).toBeGreaterThan(0);
  });

  it('clears every sigil aura and floor hazard on transition, reset, and death', () => {
    for (const path of ['transition', 'reset', 'death'] as const) {
      const { sim, ctx, tank, boss, st } = setup();
      primeNythraxisCleanupState(sim, ctx, boss, st);
      if (path === 'transition') {
        nythraxis.startNythraxisTransition(ctx, boss, st);
        expect(st.phase).toBe('transition');
      } else if (path === 'reset') {
        nythraxis.resetNythraxisEncounter(ctx, boss);
        expect(boss.nythraxis).toBeUndefined();
      } else {
        ctx.dealDamage(tank, boss, boss.hp + 1, false, 'physical', null, 'hit');
        nythraxis.onBossDeath(ctx, boss);
        expect(st.phase).toBe('dead');
      }
      expectNythraxisCleanup(sim, boss, st);
    }
  });
});

describe('Nythraxis Gravefire (the traveling line)', () => {
  it('runs a line from the boss at a raider who is not the aggro holder, only in phase two', () => {
    const { ctx, boss, st, tank, callouts, sim, room } = setup({ phase: 1 });
    st.gravefireTimer = DT / 2;
    tickDriver(ctx, boss, 1);
    expect(st.gravefires).toHaveLength(0);
    st.phase = 2;
    st.gravefireTimer = DT / 2;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    // The phase-2 block ran (Soul Rend's cadence moved), the room is full, and
    // the cast re-armed its cadence.
    expect(st.soulRendTimer).toBeLessThan(999);
    expect(room().length).toBe(10);
    expect(st.gravefireTimer).toBe(12);
    expect(boss.nythraxis).toBe(st);
    expect(st.gravefireSeq).toBe(1);
    expect(st.gravefires).toHaveLength(1);
    const line = st.gravefires![0];
    expect(line.x).toBeCloseTo(boss.pos.x);
    expect(line.z).toBeCloseTo(boss.pos.z);
    const target = callouts('gravefireTarget');
    expect(target).toHaveLength(1);
    expect(target[0].pid).not.toBe(tank.id);
    const victim = ctx.entities.get(target[0].pid!)!;
    // The line points at where the target stood.
    const along = (victim.pos.x - line.x) * line.dirX + (victim.pos.z - line.z) * line.dirZ;
    const across = Math.abs(
      (victim.pos.x - line.x) * line.dirZ - (victim.pos.z - line.z) * line.dirX,
    );
    expect(along).toBeGreaterThan(0);
    expect(across).toBeLessThan(1e-6);
    expect(st.gravefireTimer).toBe(12);
    expect(sim.activeNythraxisGravefires).toHaveLength(1);
  });

  it('burns whoever stands in the lit window once a second and stops once it burns out', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const { sim, ctx, boss, st, raiders, tank, damageBy } = setup({ difficulty, phase: 2 });
      const victim = raiders[4];
      // Park everyone else far to the side, and the tank beside the boss instead of
      // in front of him, so only the victim can stand on the line.
      for (const r of raiders)
        if (r !== victim) teleport(sim, r, boss.pos.x + 80, boss.pos.z - 20, boss.pos.y);
      teleport(sim, tank, boss.pos.x + 6, boss.pos.z, boss.pos.y);
      teleport(sim, victim, boss.pos.x, boss.pos.z - 25, boss.pos.y);
      nythraxis.castNythraxisGravefire(ctx, boss, st, victim);
      const hp0 = victim.hp;
      // The head needs just over 2 s to reach 25 yd, so the 2 s tick misses and
      // the first burn lands on the 3 s tick.
      tickDriver(ctx, boss, 2.9);
      expect(victim.hp, difficulty).toBe(hp0);
      tickDriver(ctx, boss, 0.2);
      const tick = difficulty === 'heroic' ? 0.15 : 0.1;
      expect(hp0 - victim.hp, difficulty).toBe(Math.ceil(victim.maxHp * tick));
      expect(damageBy(NYTHRAXIS_GRAVEFIRE_CAST_ID), difficulty).toHaveLength(1);
      // Side-stepping past the half-width is safe.
      teleport(
        sim,
        victim,
        boss.pos.x + NYTHRAXIS_GRAVEFIRE_HALF_WIDTH + 0.2,
        boss.pos.z - 25,
        boss.pos.y,
      );
      const hp1 = victim.hp;
      tickDriver(ctx, boss, 2);
      expect(victim.hp, difficulty).toBe(hp1);
      tickDriver(ctx, boss, difficulty === 'heroic' ? 8 : 6);
      expect(st.gravefires, difficulty).toHaveLength(0);
      expect(sim.activeNythraxisGravefires, difficulty).toHaveLength(0);
    }
  });

  it('never runs at an impaled raider or a wardstone channeler', () => {
    const { ctx, boss, st, room, raiders, tank } = setup({ phase: 2 });
    const victims = nythraxis.castNythraxisBoneSpike(ctx, boss, st, room(), 'normal');
    const channeler = raiders.find((r) => !victims.includes(r))!;
    st.wardChannels = [{ objectId: 1, playerId: channeler.id, remaining: 5, complete: false }];
    // Kill everyone else so the pick is forced onto the protected set if it were allowed.
    for (const r of raiders) {
      if (victims.includes(r) || r === channeler) continue;
      r.hp = 0;
      r.dead = true;
    }
    st.gravefireTimer = DT / 2;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(st.gravefires).toHaveLength(0);
    expect(st.gravefireTimer).toBe(3);
    expect(victims.every((v) => isNythraxisImpaled(v, boss.id))).toBe(true);
    expect(tank.dead).toBe(false);
  });

  it('replays the same target and line for the same seed', () => {
    const a = setup({ phase: 2 });
    const b = setup({ phase: 2 });
    a.st.gravefireTimer = DT / 2;
    b.st.gravefireTimer = DT / 2;
    nythraxis.updateNythraxisEncounter(a.ctx, a.boss);
    nythraxis.updateNythraxisEncounter(b.ctx, b.boss);
    expect(b.st.gravefires).toEqual(a.st.gravefires);
  });
});

describe('Nythraxis Soulfire (the pools Soul Rend leaves)', () => {
  it('leaves a Soulfire pool where each mark detonated, never beside a wardstone', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const { sim, ctx, boss, st, raiders, wards, damageBy } = setup({ difficulty, phase: 2 });
      // Stack three marked raiders on one spot away from the wardstones, and park a
      // fourth exactly on a wardstone so its pool is refused.
      const stack = { x: boss.spawnPos.x + 20, z: boss.spawnPos.z - 30 };
      const marked = raiders.slice(0, 3);
      for (const p of marked) teleport(sim, p, stack.x, stack.z, boss.pos.y);
      const onWard = raiders[3];
      const ward = wards()[0];
      teleport(sim, onWard, ward.pos.x, ward.pos.z, ward.pos.y);
      st.soulRendMarks = [...marked, onWard].map((p) => ({ playerId: p.id, remaining: DT }));
      nythraxis.updateNythraxisSoulRend(ctx, boss, st);
      const pools = st.graveFlames!.filter((f) => f.kind === 'soul');
      expect(pools, difficulty).toHaveLength(3);
      for (const pool of pools) {
        expect(pool.radius, difficulty).toBe(NYTHRAXIS_SOULFIRE_RADIUS);
        expect(pool.remaining, difficulty).toBe(
          difficulty === 'heroic' ? NYTHRAXIS_FLAME_PERMANENT_SECONDS : 15,
        );
        expect(flat(pool, stack), difficulty).toBeLessThan(1e-6);
      }
      expect(
        sim.activeNythraxisGraveFlames.filter((f) => f.kind === 'soul'),
        difficulty,
      ).toHaveLength(3);
      // The stack that stays put burns at the Soulfire rate.
      const hp0 = marked[0].hp;
      tickDriver(ctx, boss, 1);
      const tick = difficulty === 'heroic' ? 0.12 : 0.08;
      expect(hp0 - marked[0].hp, difficulty).toBe(3 * Math.ceil(marked[0].maxHp * tick));
      expect(damageBy(NYTHRAXIS_SOULFIRE_CAST_ID).length, difficulty).toBeGreaterThan(0);
      // Whoever stood on the wardstone is never in a pool.
      const hpWard = onWard.hp;
      tickDriver(ctx, boss, 1);
      expect(onWard.hp, difficulty).toBe(hpWard);
    }
  });

  it('casts Soul Rend while a sigil is live and owns every applied aura', () => {
    const { ctx, boss, st } = setup({ phase: 2 });
    nythraxis.startNythraxisSigil(ctx, boss, st);
    expect(st.sigil).not.toBeNull();
    st.soulRendTimer = DT / 2;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(st.sigil).not.toBeNull();
    expect(st.soulRendMarks.length).toBeGreaterThan(0);
    for (const mark of st.soulRendMarks) {
      const aura = ctx.entities
        .get(mark.playerId)
        ?.auras.find((candidate) => candidate.id === 'nythraxis_soul_rend');
      expect(aura?.encounterOwned).toBe(true);
    }
  });

  it('burns out after fifteen seconds on normal and never goes out on heroic', () => {
    const { ctx, boss, st, raiders, sim } = setup({ phase: 2 });
    // Two marks stacked well clear of every wardstone (the spread raid's
    // default spots sit inside a ward's 6 yd clearance in the compact hall).
    const marked = raiders.slice(0, 2);
    for (const [i, p] of marked.entries()) {
      teleport(sim, p, boss.spawnPos.x + (i ? 5 : -5), boss.spawnPos.z - 12, boss.pos.y);
    }
    st.soulRendMarks = marked.map((p) => ({ playerId: p.id, remaining: DT }));
    nythraxis.updateNythraxisSoulRend(ctx, boss, st);
    expect(st.graveFlames!.filter((f) => f.kind === 'soul')).toHaveLength(2);
    tickDriver(ctx, boss, 15 + DT);
    expect(st.graveFlames!.filter((f) => f.kind === 'soul')).toHaveLength(0);
    expect(sim.activeNythraxisGraveFlames).toHaveLength(0);
    // Heroic: the pools outlive any pull; only the transition or a reset clears them.
    const heroic = setup({ phase: 2, difficulty: 'heroic' });
    const hMarked = heroic.raiders.slice(0, 2);
    for (const [i, p] of hMarked.entries()) {
      teleport(
        heroic.sim,
        p,
        heroic.boss.spawnPos.x + (i ? 5 : -5),
        heroic.boss.spawnPos.z - 12,
        heroic.boss.pos.y,
      );
    }
    heroic.st.soulRendMarks = hMarked.map((p) => ({ playerId: p.id, remaining: DT }));
    nythraxis.updateNythraxisSoulRend(heroic.ctx, heroic.boss, heroic.st);
    tickDriver(heroic.ctx, heroic.boss, 60);
    expect(heroic.st.graveFlames!.filter((f) => f.kind === 'soul')).toHaveLength(2);
    expect(heroic.sim.activeNythraxisGraveFlames).toHaveLength(2);
    nythraxis.startNythraxisTransition(heroic.ctx, heroic.boss, heroic.st);
    expect(heroic.st.graveFlames).toHaveLength(0);
  });
});
