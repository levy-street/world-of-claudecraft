// The first-playtest rules that keep Bone Spikes, fire, and the wardstone
// channel apart (owner, 2026-09-04): spikes never land on a raider standing in
// fire, never while an eruption is telegraphing or has just landed, never in
// the run-up to Deathless Rage; eruptions wait out a spike wave and never
// reach an impaled raider; Rage frees the impaled; and an impaled raider next
// to a wardstone may still channel it. Eruptions also wait out live Soul Rend
// marks plus a short gap after they clear, never open right beside a hall
// pillar, and Bone Storm is retired from play (owner, 2026-10-02).

import { describe, expect, it } from 'vitest';
import { dungeonInstanceAt } from '../src/sim/dungeon_floor';
import { NYTHRAXIS_LAYOUT } from '../src/sim/dungeon_layout';
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
import { NYTHRAXIS_BONE_STORM_ENABLED } from '../src/sim/nythraxis_bone_storm';
import {
  NYTHRAXIS_GRAVE_ERUPTION_IMPALED_CLEARANCE,
  NYTHRAXIS_GRAVE_ERUPTION_PILLAR_CLEARANCE,
  NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
  NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS,
  nythraxisGraveEruptionCount,
  nythraxisGraveEruptionPattern,
  pointInNythraxisCircle,
} from '../src/sim/nythraxis_grave_eruption';
import { NYTHRAXIS_SOUL_REND_FIRE_GAP_SECONDS } from '../src/sim/nythraxis_soul_rend';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { DT, type Entity, NYTHRAXIS_BOSS_ID, type SimEvent } from '../src/sim/types';
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
function setup(opts: { difficulty?: 'normal' | 'heroic' } = {}) {
  const { difficulty = 'normal' } = opts;
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    world: EMPTY_TEST_WORLD,
  }) as AnySim;
  const tankPid = sim.addPlayer('warrior', 'Tank') as number;
  sim.players.get(tankPid)?.questsDone.add('q_nythraxis_bound_guardian');
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
      // Back-to-back casts here are about the fire rule, not the per-raider
      // cooldown (v0.42.2, its own suite): clear the ledger so every cast
      // sees the full pool again.
      st.boneSpikeCooldowns = [];
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

  it('never lands under the impaled even when every free raider stacks on their exact position', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const { sim, ctx, boss, st, tank, raiders, room } = setup({ difficulty });
      const pinned = raiders[4];
      ctx.applyAura(pinned, nythraxisImpaledAuraFor(boss.id, 0));
      // Every OTHER living player -- the tank and the rest of the raid --
      // stacks exactly on the pinned raider's coordinates: `clear` (free
      // raiders outside the impaled-clearance band) is empty, so
      // startNythraxisGraveEruption must fall back to the full free pool for
      // its anchors, and the first anchor's own position IS the pinned
      // raider's.
      for (const p of [tank, ...raiders.filter((r) => r !== pinned)]) {
        p.pos.x = pinned.pos.x;
        p.pos.z = pinned.pos.z;
        p.prevPos = { ...p.pos };
      }
      const before = sim.events.length;
      nythraxis.startNythraxisGraveEruption(ctx, boss, st, room());
      const ms = nythraxis.nythraxisMechanicState(st);
      // Never starved without need: every slot still finds a safe circle a
      // few yards off the pinned raider, since the whole stacked raid sits at
      // one point and the minimum scatter distance already clears it.
      expect(ms.eruptionPoints.length, difficulty).toBe(nythraxisGraveEruptionCount(difficulty));
      for (const circle of ms.eruptionPoints) {
        expect(
          pointInNythraxisCircle(circle, NYTHRAXIS_GRAVE_ERUPTION_RADIUS, pinned.pos),
          difficulty,
        ).toBe(false);
      }
      const warnings = (sim.events as SimEvent[])
        .slice(before)
        .filter((e): e is Extract<SimEvent, { type: 'spellfxAt' }> => e.type === 'spellfxAt');
      expect(warnings.length, difficulty).toBe(ms.eruptionPoints.length);
      for (const warning of warnings) {
        expect(
          pointInNythraxisCircle(
            { x: warning.x, z: warning.z },
            NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
            pinned.pos,
          ),
          difficulty,
        ).toBe(false);
      }
    }
  });
});

describe('Grave Eruption keeps clear of Soul Rend', () => {
  it('pins the gap at 1.5 s', () => {
    expect(NYTHRAXIS_SOUL_REND_FIRE_GAP_SECONDS).toBe(1.5);
  });

  for (const difficulty of ['normal', 'heroic'] as const) {
    it(`${difficulty}: holds through live marks, then opens no sooner than 1.5 s after they detonate`, () => {
      const { ctx, boss, st } = setup({ difficulty });
      const ms = nythraxis.nythraxisMechanicState(st);
      nythraxis.castNythraxisSoulRend(ctx, boss, st);
      expect(st.soulRendMarks.length).toBeGreaterThan(0);
      st.soulRendTimer = 999;
      // The eruption comes due while the marks are still live.
      ms.eruptionTimer = DT;
      let guard = 0;
      while (st.soulRendMarks.length > 0) {
        tickDriver(ctx, boss, DT);
        expect(ms.eruptionPoints, 'no eruption while marks are live').toHaveLength(0);
        if (++guard > 400) throw new Error('Soul Rend never detonated');
      }
      // Detonated this tick: the gap is armed at full length.
      expect(ms.soulRendFireGapTimer).toBeCloseTo(NYTHRAXIS_SOUL_REND_FIRE_GAP_SECONDS, 5);
      let ticksAfter = 0;
      while (ms.eruptionPoints.length === 0) {
        tickDriver(ctx, boss, DT);
        ticksAfter++;
        if (ticksAfter > 200) throw new Error('eruption never started after the gap');
      }
      const elapsed = ticksAfter * DT;
      expect(elapsed).toBeGreaterThanOrEqual(NYTHRAXIS_SOUL_REND_FIRE_GAP_SECONDS - 1e-9);
      expect(elapsed).toBeLessThanOrEqual(NYTHRAXIS_SOUL_REND_FIRE_GAP_SECONDS + 2 * DT);
    });
  }

  it('holds a due Soul Rend while an eruption telegraphs, including one that began the same tick', () => {
    const { ctx, boss, st } = setup();
    const ms = nythraxis.nythraxisMechanicState(st);
    st.phase = 2;
    // Both come due on the same tick: the eruption wins, the marks wait.
    ms.eruptionTimer = DT;
    st.soulRendTimer = DT;
    tickDriver(ctx, boss, DT);
    expect(ms.eruptionPoints.length).toBeGreaterThan(0);
    expect(st.soulRendMarks).toHaveLength(0);
    // Through the telegraph the marks keep waiting; once it lands they go out.
    tickDriver(ctx, boss, NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS - 2 * DT);
    expect(ms.eruptionPoints.length).toBeGreaterThan(0);
    expect(st.soulRendMarks).toHaveLength(0);
    tickDriver(ctx, boss, 1.5);
    expect(ms.eruptionPoints).toHaveLength(0);
    expect(st.soulRendMarks.length).toBeGreaterThan(0);
  });

  it('does not hold an eruption when no marks were cast', () => {
    const { ctx, boss, st } = setup();
    const ms = nythraxis.nythraxisMechanicState(st);
    ms.eruptionTimer = DT;
    tickDriver(ctx, boss, DT);
    expect(ms.soulRendFireGapTimer).toBe(0);
    expect(ms.eruptionPoints.length).toBeGreaterThan(0);
  });

  it('arms the same gap when Bone Storm releases live marks, and only then', () => {
    const { ctx, boss, st } = setup();
    const ms = nythraxis.nythraxisMechanicState(st);
    nythraxis.startNythraxisBoneStorm(ctx, boss, st);
    expect(ms.soulRendFireGapTimer, 'no marks, no gap').toBe(0);
    ms.boneStorm = null;
    nythraxis.castNythraxisSoulRend(ctx, boss, st);
    expect(st.soulRendMarks.length).toBeGreaterThan(0);
    nythraxis.startNythraxisBoneStorm(ctx, boss, st);
    expect(st.soulRendMarks).toHaveLength(0);
    expect(ms.soulRendFireGapTimer).toBe(NYTHRAXIS_SOUL_REND_FIRE_GAP_SECONDS);
  });
});

describe('Grave Eruption keeps clear of the hall pillars', () => {
  const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
    Math.hypot(a.x - b.x, a.z - b.z);

  it('pins the keep-out: the 3 yd ring edge stays 4 yd from a pillar centre', () => {
    expect(NYTHRAXIS_GRAVE_ERUPTION_PILLAR_CLEARANCE).toBe(7);
    expect(NYTHRAXIS_GRAVE_ERUPTION_PILLAR_CLEARANCE - NYTHRAXIS_GRAVE_ERUPTION_RADIUS).toBe(4);
  });

  it('moves a circle aimed at a raider hugging a pillar off the pillar, every cast key', () => {
    const origin = { x: 0, z: 0 };
    const pillars = [
      { x: -32, z: -12 },
      { x: 32, z: -12 },
      { x: -32, z: 10 },
    ];
    const targets = pillars.map((p, i) => ({ id: i + 1, x: p.x + 1.5, z: p.z }));
    for (let castKey = 1; castKey <= 64; castKey++) {
      // Decisive: with no pillar list the first circle lands right on its target.
      const unguarded = nythraxisGraveEruptionPattern(castKey, origin, 4, targets);
      expect(dist(unguarded[0], pillars[0])).toBeLessThan(
        NYTHRAXIS_GRAVE_ERUPTION_PILLAR_CLEARANCE,
      );
      const points = nythraxisGraveEruptionPattern(castKey, origin, 4, targets, [], pillars);
      expect(points.length, `cast ${castKey} still fields its circles`).toBe(4);
      for (const point of points) {
        for (const pillar of pillars) {
          expect(dist(point, pillar)).toBeGreaterThanOrEqual(
            NYTHRAXIS_GRAVE_ERUPTION_PILLAR_CLEARANCE,
          );
        }
      }
    }
  });

  for (const difficulty of ['normal', 'heroic'] as const) {
    it(`${difficulty}: the live driver keeps every circle off the real hall pillars`, () => {
      const { sim, ctx, boss, st, raiders, room } = setup({ difficulty });
      const frame = dungeonInstanceAt(boss.spawnPos.x, boss.spawnPos.z);
      if (!frame) throw new Error('the boss must stand in a dungeon instance');
      expect(frame.layout).toBe(NYTHRAXIS_LAYOUT);
      const pillars = NYTHRAXIS_LAYOUT.pillars.map((p) => ({
        x: frame.ox + p.x,
        z: frame.oz + p.z,
      }));
      expect(pillars).toHaveLength(6);
      // Every free raider hugs a pillar, 1.5 yd off its centre on the aisle side.
      raiders.forEach((e, i) => {
        const pillar = pillars[i % pillars.length];
        const local = NYTHRAXIS_LAYOUT.pillars[i % pillars.length];
        teleport(sim, e, pillar.x + (local.x < 0 ? 1.5 : -1.5), pillar.z, boss.pos.y);
      });
      const ms = nythraxis.nythraxisMechanicState(st);
      for (let cast = 0; cast < 8; cast++) {
        sim.tickCount += 1;
        nythraxis.startNythraxisGraveEruption(ctx, boss, st, room());
        expect(ms.eruptionPoints.length).toBe(nythraxisGraveEruptionCount(difficulty));
        for (const point of ms.eruptionPoints) {
          for (const pillar of pillars) {
            expect(dist(point, pillar)).toBeGreaterThanOrEqual(
              NYTHRAXIS_GRAVE_ERUPTION_PILLAR_CLEARANCE,
            );
          }
        }
        ms.eruptionPoints = [];
        ms.eruptionImpactRemaining = 0;
      }
    });
  }
});

describe('Bone Storm is retired from play', () => {
  it('the switch is off', () => {
    expect(NYTHRAXIS_BONE_STORM_ENABLED).toBe(false);
  });

  it('a due storm in phase 3 never begins', () => {
    const { ctx, boss, st } = setup();
    const ms = nythraxis.nythraxisMechanicState(st);
    st.phase = 3;
    ms.boneStormTimer = DT;
    tickDriver(ctx, boss, 10);
    expect(ms.boneStorm).toBeNull();
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
