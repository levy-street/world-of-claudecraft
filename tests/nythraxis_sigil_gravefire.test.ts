// The slice 2 mechanics against a real Sim: Binding Sigil (the pull), Gravefire
// (the traveling line), the Soul Rend detonation (which leaves no fire since
// v0.42.2), and the major-cast scheduler that keeps the body-owning casts apart. The driver functions in
// src/sim/encounters/nythraxis.ts run on a live SimContext with a ten-player
// attuned raid, the way the Bone Spike suite does.

import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { dungeonFloorLift, dungeonInstanceAt } from '../src/sim/dungeon_floor';
import { DAIS_HEIGHT } from '../src/sim/dungeon_layout';
import * as nythraxis from '../src/sim/encounters/nythraxis';
import {
  NYTHRAXIS_ASCENSION_AURA_ID,
  NYTHRAXIS_ASCENSION_HASTE_AURA_ID,
  NYTHRAXIS_BOUND_AURA_ID,
  NYTHRAXIS_BOUND_STUN_AURA_ID,
  NYTHRAXIS_SIGIL_FLOOR_CLEARANCE,
  NYTHRAXIS_SIGIL_SIDE_OFFSET,
  NYTHRAXIS_SIGIL_WARDSTONE_CLEARANCE,
  NYTHRAXIS_UNBOUND_AURA_ID,
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
import { NYTHRAXIS_SOULFIRE_CAST_ID } from '../src/sim/nythraxis_soulfire';
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
  it("flares a sigil on the raid's-right platform, clear of every wardstone", () => {
    expect(NYTHRAXIS_SIGIL_SIDE_OFFSET).toBe(30);
    for (const difficulty of ['normal', 'heroic'] as const) {
      const { sim, ctx, boss, st, wards, callouts } = setup({ difficulty });
      st.sigilTimer = DT / 2;
      nythraxis.updateNythraxisEncounter(ctx, boss);
      const sigil = st.sigil!;
      expect(sigil, difficulty).toBeTruthy();
      // The first cast lands on the raid's-right platform (world -x, see
      // nythraxisSigilNextSide): the side offset out from the SPAWN along the
      // hall's x axis, at the spawn's z, wherever the boss has walked (v0.42.2).
      expect(sigil.x, difficulty).toBeCloseTo(boss.spawnPos.x - NYTHRAXIS_SIGIL_SIDE_OFFSET, 6);
      expect(sigil.z, difficulty).toBeCloseTo(boss.spawnPos.z, 6);
      expect(st.sigilSide, difficulty).toBe(-1);
      expect(dungeonFloorLift(sigil.x, sigil.z), difficulty).toBe(DAIS_HEIGHT);
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

  it('alternates platforms across casts, anchored on the spawn, wherever the boss stands', () => {
    const { sim, ctx, boss, st } = setup();
    // Walk the boss well off the dais: the platforms do not follow him.
    teleport(sim, boss, boss.spawnPos.x + 14, boss.spawnPos.z - 30, boss.pos.y);
    st.sigilTimer = DT / 2;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    const first = st.sigil!;
    expect(st.sigilSide).toBe(-1);
    expect(first.x).toBeCloseTo(boss.spawnPos.x - NYTHRAXIS_SIGIL_SIDE_OFFSET, 6);
    expect(first.z).toBeCloseTo(boss.spawnPos.z, 6);
    // The next cast takes the other platform.
    nythraxis.clearNythraxisSigil(boss);
    st.sigilTimer = DT / 2;
    st.majorGapTimer = 0;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    const second = st.sigil!;
    expect(st.sigilSide).toBe(1);
    expect(second.x).toBeCloseTo(boss.spawnPos.x + NYTHRAXIS_SIGIL_SIDE_OFFSET, 6);
    expect(second.z).toBeCloseTo(boss.spawnPos.z, 6);
    expect(dungeonFloorLift(second.x, second.z)).toBe(DAIS_HEIGHT);
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
    // One Grave Flame patch ON the asked (right) platform: Normal crosses to
    // the left platform; Heroic may land in fire and takes the right one.
    const normal = setup();
    const heroic = setup({ difficulty: 'heroic' });
    const flameAt = (boss: Entity) => ({
      seq: 0,
      kind: 'grave' as const,
      x: boss.spawnPos.x - NYTHRAXIS_SIGIL_SIDE_OFFSET,
      z: boss.spawnPos.z,
      radius: 3,
      remaining: 10,
      tickTimer: 1,
    });
    normal.st.graveFlames = [flameAt(normal.boss)];
    heroic.st.graveFlames = [flameAt(heroic.boss)];
    normal.st.sigilTimer = DT / 2;
    heroic.st.sigilTimer = DT / 2;
    nythraxis.updateNythraxisEncounter(normal.ctx, normal.boss);
    nythraxis.updateNythraxisEncounter(heroic.ctx, heroic.boss);
    const normalSigil = normal.st.sigil!;
    const heroicSigil = heroic.st.sigil!;
    expect(normalSigil.x).toBeCloseTo(normal.boss.spawnPos.x + NYTHRAXIS_SIGIL_SIDE_OFFSET, 6);
    expect(normalSigil.z).toBeCloseTo(normal.boss.spawnPos.z, 6);
    expect(heroicSigil.x).toBeCloseTo(heroic.boss.spawnPos.x - NYTHRAXIS_SIGIL_SIDE_OFFSET, 6);
    expect(heroicSigil.z).toBeCloseTo(heroic.boss.spawnPos.z, 6);
  });

  it('remembers the platform it actually landed on, so the next cast alternates from there', () => {
    // Normal: fire on the asked (right) platform sends the first sigil left.
    const { ctx, boss, st } = setup();
    st.graveFlames = [
      {
        seq: 0,
        kind: 'grave' as const,
        x: boss.spawnPos.x - NYTHRAXIS_SIGIL_SIDE_OFFSET,
        z: boss.spawnPos.z,
        radius: 3,
        remaining: 10,
        tickTimer: 1,
      },
    ];
    st.sigilTimer = DT / 2;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(st.sigil!.x).toBeCloseTo(boss.spawnPos.x + NYTHRAXIS_SIGIL_SIDE_OFFSET, 6);
    expect(st.sigilSide).toBe(1);
    // The fire burns out and the sigil resolves: the next cast goes RIGHT,
    // never back onto the platform he was just bound on.
    st.graveFlames = [];
    nythraxis.clearNythraxisSigil(boss);
    st.sigilTimer = DT / 2;
    st.majorGapTimer = 0;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(st.sigil!.x).toBeCloseTo(boss.spawnPos.x - NYTHRAXIS_SIGIL_SIDE_OFFSET, 6);
    expect(st.sigilSide).toBe(-1);
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

  it('holds a due Sigil cast through Deathless Rage and its major gap', () => {
    const { ctx, boss, st } = setup({ phase: 2 });
    nythraxis.startNythraxisDeathlessRage(ctx, boss, st);
    st.sigilTimer = DT / 2;
    tickDriver(ctx, boss, 3);
    expect(st.sigil).toBeNull();
    st.deathlessCastRemaining = DT;
    nythraxis.updateNythraxisEncounter(ctx, boss);
    expect(st.majorGapTimer).toBe(6);
    tickDriver(ctx, boss, 6 + DT);
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
    st.soulRendTimer = DT / 2;
    // The Rage stays out of its spike lead here: an imminent Rage would (by
    // design) hold the spike cast this test wants to see resume.
    st.deathlessTimer = NYTHRAXIS_BONE_SPIKE_RAGE_LEAD_SECONDS + 20;
    // A staged (dormant-kind) line keeps ticking through the stun like any
    // live hazard, even though nothing in play ignites one since v0.42.2.
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
    // No new line joins the staged one: Gravefire casts are retired (v0.42.2).
    expect(st.gravefires).toHaveLength(1);
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

describe('Nythraxis Gravefire never lands in play (retired in v0.42.2)', () => {
  for (const difficulty of ['normal', 'heroic'] as const) {
    it(`${difficulty}: a due cadence timer lights no line, calls nobody out, and burns nobody`, () => {
      const { sim, ctx, boss, st, raiders, callouts, damageBy } = setup({ difficulty, phase: 2 });
      teleport(sim, raiders[0], boss.pos.x + 20, boss.pos.z, boss.pos.y);
      const timer = 0.01;
      st.gravefireTimer = timer;
      // Right after the due tick (a line would still be alive here), then
      // ten seconds on: nothing ever lights, and nothing consumes the timer.
      nythraxis.updateNythraxisEncounter(ctx, boss);
      expect(st.gravefires).toEqual([]);
      tickDriver(ctx, boss, 10);
      expect(st.gravefireTimer).toBe(timer);
      expect(st.gravefires).toEqual([]);
      expect(sim.activeNythraxisGravefires).toEqual([]);
      expect(callouts('gravefireTarget')).toEqual([]);
      expect(damageBy(NYTHRAXIS_GRAVEFIRE_CAST_ID)).toEqual([]);
    });
  }

  it('the Bone Slam no longer runs a line down the charge', () => {
    const { sim, ctx, boss, st, tank, damageBy } = setup({ difficulty: 'normal', phase: 2 });
    st.phase = 3;
    teleport(sim, tank, boss.pos.x + 3, boss.pos.z, boss.pos.y);
    nythraxis.startNythraxisBoneStorm(ctx, boss, st);
    tickDriver(ctx, boss, 3);
    expect(st.boneStorm?.slammed).toBe(true);
    expect(st.gravefires).toEqual([]);
    expect(damageBy(NYTHRAXIS_GRAVEFIRE_CAST_ID)).toEqual([]);
  });
});

describe('Nythraxis Soul Rend leaves no fire (Soulfire retired in v0.42.2)', () => {
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

  for (const difficulty of ['normal', 'heroic'] as const) {
    it(`${difficulty}: a detonation splits its hit and leaves the floor clean`, () => {
      const { sim, ctx, boss, st, raiders, damageBy } = setup({ difficulty, phase: 2 });
      // Three marks stacked on one spot, a fourth alone across the room: the
      // two shapes that used to leave a pool each (one per mark on Normal,
      // one per stacked group on Heroic).
      const stack = { x: boss.spawnPos.x + 20, z: boss.spawnPos.z - 30 };
      const marked = raiders.slice(0, 3);
      for (const p of marked) teleport(sim, p, stack.x, stack.z, boss.pos.y);
      const solo = raiders[3];
      teleport(sim, solo, boss.spawnPos.x - 25, boss.spawnPos.z - 30, boss.pos.y);
      st.soulRendMarks = [...marked, solo].map((p) => ({ playerId: p.id, remaining: DT }));
      const hpBefore = marked.map((p) => p.hp);
      nythraxis.updateNythraxisSoulRend(ctx, boss, st);
      // The split hit itself still lands on every mark.
      expect(damageBy('Soul Rend')).toHaveLength(4);
      marked.forEach((p, i) => {
        expect(p.hp).toBeLessThan(hpBefore[i]);
      });
      expect(st.soulRendMarks).toEqual([]);
      // No pool anywhere: not under the stack, not under the solo mark.
      expect(st.graveFlames).toEqual([]);
      expect(sim.activeNythraxisGraveFlames).toEqual([]);
      // And nothing burns afterwards: standing still for ten seconds costs nothing.
      const hpAfter = marked.map((p) => p.hp);
      tickDriver(ctx, boss, 10);
      marked.forEach((p, i) => {
        expect(p.hp).toBe(hpAfter[i]);
      });
      expect(damageBy(NYTHRAXIS_SOULFIRE_CAST_ID)).toEqual([]);
      expect(st.graveFlames).toEqual([]);
    });
  }
});
