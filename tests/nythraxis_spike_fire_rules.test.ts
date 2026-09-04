// The first-playtest rules that keep Bone Spikes, fire, and the wardstone
// channel apart (owner, 2026-09-04): spikes never land on a raider standing in
// fire, never while an eruption is telegraphing or has just landed, never in
// the run-up to Deathless Rage; eruptions wait out a spike wave and never
// reach an impaled raider; Rage frees the impaled; and an impaled raider next
// to a wardstone may still channel it.

import { describe, expect, it } from 'vitest';
import * as nythraxis from '../src/sim/encounters/nythraxis';
import {
  isNythraxisImpaled,
  isNythraxisWardChannelLocked,
  NYTHRAXIS_BONE_SPIKE_FIRE_SETTLE_SECONDS,
  NYTHRAXIS_BONE_SPIKE_ID,
  NYTHRAXIS_BONE_SPIKE_RAGE_LEAD_SECONDS,
  NYTHRAXIS_BONE_SPIKE_RETRY_SECONDS,
  NYTHRAXIS_IMPALED_AURA_ID,
  nythraxisImpaledAuraFor,
} from '../src/sim/nythraxis_bone_spike';
import {
  NYTHRAXIS_GRAVE_ERUPTION_IMPALED_CLEARANCE,
  NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
  NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS,
  pointInNythraxisCircle,
} from '../src/sim/nythraxis_grave_eruption';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { DT, type Entity, NYTHRAXIS_BOSS_ID } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { EMPTY_TEST_WORLD } from './sim_shared';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

const ctxOf = (sim: Sim): SimContext => (sim as unknown as { ctx: SimContext }).ctx;

function teleport(sim: AnySim, e: AnyEntity, x: number, z: number, y?: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = y ?? groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

// A ten-player attuned raid in the throne room: the tank in melee, the others
// spread 20 yd in front of the dais, every cadence parked.
function setup() {
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
  const spikes = () =>
    [...sim.entities.values()].filter(
      (e: AnyEntity) => e.kind === 'mob' && e.templateId === NYTHRAXIS_BONE_SPIKE_ID && !e.dead,
    ) as AnyEntity[];
  return { sim, ctx, tank, raiders, boss, st, room, spikes };
}

function tickDriver(ctx: SimContext, boss: Entity, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) nythraxis.updateNythraxisEncounter(ctx, boss);
}

/** A burning Grave Flame patch centred on a raider, long-lived. */
function burnUnder(st: NonNullable<Entity['nythraxis']>, e: Entity): void {
  const ms = nythraxis.nythraxisMechanicState(st);
  ms.graveFlames.push({
    seq: ++ms.graveFlameSeq,
    kind: 'grave',
    radius: NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
    x: e.pos.x,
    z: e.pos.z,
    remaining: 600,
    tickTimer: 1,
  });
}

describe('Bone Spike never lands on fire', () => {
  it('skips a raider standing in a burning patch, every cast', () => {
    const { ctx, boss, st, raiders, room } = setup();
    const burning = raiders[3];
    burnUnder(st, burning);
    expect(nythraxis.nythraxisStandingInFire(st, burning, 'normal')).toBe(true);
    expect(nythraxis.nythraxisStandingInFire(st, raiders[0], 'normal')).toBe(false);
    for (let cast = 0; cast < 12; cast++) {
      const victims = nythraxis.castNythraxisBoneSpike(ctx, boss, st, room(), 'normal');
      expect(victims.length).toBe(2);
      expect(victims).not.toContain(burning);
      nythraxis.shatterNythraxisBoneSpikes(ctx, boss);
    }
  });

  it('holds while an eruption is telegraphing or settling, and in the run-up to Deathless Rage', () => {
    const { st } = setup();
    const ms = nythraxis.nythraxisMechanicState(st);
    expect(nythraxis.nythraxisBoneSpikeHeld(st)).toBe(false);
    ms.eruptionPoints = [{ x: 0, z: 0 }];
    expect(nythraxis.nythraxisBoneSpikeHeld(st)).toBe(true);
    ms.eruptionPoints = [];
    ms.eruptionSettleTimer = 1;
    expect(nythraxis.nythraxisBoneSpikeHeld(st)).toBe(true);
    ms.eruptionSettleTimer = 0;
    // Phase 1 has no Rage, so a low Rage timer means nothing there.
    st.deathlessTimer = 2;
    expect(nythraxis.nythraxisBoneSpikeHeld(st)).toBe(false);
    st.phase = 2;
    expect(nythraxis.nythraxisBoneSpikeHeld(st)).toBe(true);
    st.deathlessTimer = NYTHRAXIS_BONE_SPIKE_RAGE_LEAD_SECONDS + 0.5;
    expect(nythraxis.nythraxisBoneSpikeHeld(st)).toBe(false);
    // With the cast already in flight the calm-window rule owns the hold, not this one.
    st.deathlessTimer = 2;
    st.deathlessCastRemaining = 4;
    expect(nythraxis.nythraxisBoneSpikeHeld(st)).toBe(false);
  });

  it('waits out a live eruption plus its settle window, then fires', () => {
    const { ctx, boss, st, room, spikes } = setup();
    const ms = nythraxis.nythraxisMechanicState(st);
    // Arm an eruption, then make the spike due.
    ms.eruptionTimer = 0;
    nythraxis.updateNythraxisGraveEruptionCast(ctx, boss, st, room());
    expect(ms.eruptionPoints.length).toBeGreaterThan(0);
    ms.boneSpikeTimer = DT;
    tickDriver(ctx, boss, DT);
    expect(spikes()).toHaveLength(0);
    expect(ms.boneSpikeTimer).toBeCloseTo(NYTHRAXIS_BONE_SPIKE_RETRY_SECONDS, 5);
    // The eruption lands; the settle window opens and the spike keeps waiting.
    tickDriver(ctx, boss, NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS);
    expect(ms.eruptionPoints).toHaveLength(0);
    expect(ms.eruptionSettleTimer).toBeGreaterThan(0);
    expect(ms.eruptionSettleTimer).toBeLessThanOrEqual(NYTHRAXIS_BONE_SPIKE_FIRE_SETTLE_SECONDS);
    tickDriver(ctx, boss, 1);
    expect(spikes()).toHaveLength(0);
    // Settle over: the next poll impales.
    tickDriver(ctx, boss, NYTHRAXIS_BONE_SPIKE_FIRE_SETTLE_SECONDS + 1);
    expect(spikes()).toHaveLength(2);
  });
});

describe('Grave Eruption keeps clear of spikes', () => {
  it('waits out the settle window after a spike wave', () => {
    const { ctx, boss, st, room, spikes } = setup();
    const ms = nythraxis.nythraxisMechanicState(st);
    ms.boneSpikeTimer = DT;
    tickDriver(ctx, boss, DT);
    expect(spikes()).toHaveLength(2);
    expect(ms.spikeSettleTimer).toBeCloseTo(NYTHRAXIS_BONE_SPIKE_FIRE_SETTLE_SECONDS, 5);
    ms.eruptionTimer = DT;
    tickDriver(ctx, boss, 1);
    expect(ms.eruptionPoints).toHaveLength(0);
    tickDriver(ctx, boss, NYTHRAXIS_BONE_SPIKE_FIRE_SETTLE_SECONDS);
    expect(ms.eruptionPoints.length).toBeGreaterThan(0);
  });

  it('never opens a circle that reaches an impaled raider', () => {
    const { ctx, boss, st, raiders, room } = setup();
    const pinned = raiders[4];
    ctx.applyAura(pinned, nythraxisImpaledAuraFor(boss.id, 0));
    // Two neighbours inside the clearance band, one well outside it.
    const near = raiders[3];
    const nearer = raiders[5];
    near.pos.x = pinned.pos.x + NYTHRAXIS_GRAVE_ERUPTION_IMPALED_CLEARANCE - 1;
    near.pos.z = pinned.pos.z;
    nearer.pos.x = pinned.pos.x;
    nearer.pos.z = pinned.pos.z + 2;
    for (let attempt = 0; attempt < 8; attempt++) {
      // Walk the neighbours around the pinned raider so every attempt seeds a
      // different pattern from the same cast key.
      const angle = (attempt / 8) * Math.PI * 2;
      near.pos.x =
        pinned.pos.x + Math.cos(angle) * (NYTHRAXIS_GRAVE_ERUPTION_IMPALED_CLEARANCE - 1);
      near.pos.z =
        pinned.pos.z + Math.sin(angle) * (NYTHRAXIS_GRAVE_ERUPTION_IMPALED_CLEARANCE - 1);
      nearer.pos.x = pinned.pos.x - Math.sin(angle) * 2;
      nearer.pos.z = pinned.pos.z + Math.cos(angle) * 2;
      nythraxis.startNythraxisGraveEruption(ctx, boss, st, room());
      const ms = nythraxis.nythraxisMechanicState(st);
      expect(ms.eruptionPoints.length).toBeGreaterThan(0);
      for (const circle of ms.eruptionPoints) {
        expect(pointInNythraxisCircle(circle, NYTHRAXIS_GRAVE_ERUPTION_RADIUS, pinned.pos)).toBe(
          false,
        );
      }
      ms.eruptionPoints = [];
      ms.eruptionImpactRemaining = 0;
    }
  });
});

describe('Deathless Rage and the impaled', () => {
  it('shatters every live spike as the cast begins', () => {
    const { ctx, boss, st, room, spikes, raiders } = setup();
    const victims = nythraxis.castNythraxisBoneSpike(ctx, boss, st, room(), 'normal');
    expect(victims).toHaveLength(2);
    expect(spikes()).toHaveLength(2);
    st.phase = 2;
    nythraxis.startNythraxisDeathlessRage(ctx, boss, st);
    expect(spikes()).toHaveLength(0);
    for (const raider of raiders) expect(isNythraxisImpaled(raider, boss.id)).toBe(false);
    expect(st.deathlessCastRemaining).toBeGreaterThan(0);
  });

  it('lets an impaled raider beside a wardstone channel it, while any other stun still breaks it', () => {
    const { sim, ctx, boss, st, raiders } = setup();
    st.phase = 2;
    nythraxis.lightNythraxisWardstones(ctx, boss);
    const wards = nythraxis.nythraxisWardstones(ctx, boss);
    expect(wards.length).toBeGreaterThanOrEqual(3);
    const channeler = raiders[2];
    teleport(sim, channeler, wards[0].pos.x + 1, wards[0].pos.z, wards[0].pos.y);
    ctx.applyAura(channeler, nythraxisImpaledAuraFor(boss.id, 0));
    expect(isNythraxisImpaled(channeler, boss.id)).toBe(true);
    expect(isNythraxisWardChannelLocked(channeler, boss.id)).toBe(false);
    // A second impale from another boss id is not this boss's mark: it locks.
    const other = { ...channeler, auras: [nythraxisImpaledAuraFor(boss.id + 1, 0)] } as Entity;
    expect(isNythraxisWardChannelLocked(other, boss.id)).toBe(true);

    nythraxis.startNythraxisDeathlessRage(ctx, boss, st);
    // The Rage itself freed the earlier spikes; re-pin the channeler for the test.
    ctx.applyAura(channeler, nythraxisImpaledAuraFor(boss.id, 0));
    expect(nythraxis.tryStartNythraxisWardChannel(ctx, wards[0], channeler)).toBe(true);
    const channel = st.wardChannels.find((c) => c.objectId === wards[0].id);
    expect(channel?.playerId).toBe(channeler.id);
    const before = channel?.remaining ?? 0;
    for (let i = 0; i < 20; i++) nythraxis.updateNythraxisWardChannels(ctx, boss, st);
    expect(channel?.playerId).toBe(channeler.id);
    expect(channel?.remaining).toBeLessThan(before);
    expect(channeler.castingAbility).toBe('nythraxis_ward_channel');
    expect(channeler.auras.some((a) => a.id === NYTHRAXIS_IMPALED_AURA_ID)).toBe(true);

    // An ordinary stun from elsewhere breaks the channel as it always did.
    channeler.auras.push({
      id: 'test_stun',
      name: 'Test Stun',
      kind: 'stun',
      remaining: 3,
      duration: 3,
      value: 0,
      sourceId: 999,
    } as Entity['auras'][number]);
    nythraxis.updateNythraxisWardChannels(ctx, boss, st);
    expect(channel?.playerId).toBeNull();
    expect(channeler.castingAbility).not.toBe('nythraxis_ward_channel');
  });
});
