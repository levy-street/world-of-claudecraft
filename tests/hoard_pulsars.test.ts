// Nyxaris's Twin Pulsars (src/sim/rift/hoard_pulsars.ts + its shared core). One
// describe per concern, one test per acceptance criterion of the owner's brief.
import { describe, expect, it } from 'vitest';
import { hoardBossCueViews, tickHoardBossMechanics } from '../src/sim/rift/hoard_boss';
import { HOARD_CAST_PULSAR_OVERLOAD } from '../src/sim/rift/hoard_control_cast_ids';
import { holdHoardPulsars, PULSARS_EVERY_SEC } from '../src/sim/rift/hoard_pulsars';
import {
  assignPulsarTargets,
  type BeamAim,
  beamTrackSpeed,
  HOARD_BOUND_PULSARS_AURA_ID,
  HOARD_PULSAR_TEMPLATE,
  HOARD_PULSAR_WARD_AURA_ID,
  isPulsarVariant,
  PULSAR_WARD_TOTAL_SEC,
  PULSARS,
  pointInPulsarBeam,
  pulsarAnchor,
  pulsarCount,
  pulsarStation,
  stepBeamAim,
} from '../src/sim/rift/hoard_pulsars_core';
import { HOARD_RARITY_PRESSURE } from '../src/sim/rift/hoard_scaling';
import type { RiftInstance } from '../src/sim/rift/types';
import { makeVaultSeed } from '../src/sim/rift/vault_seed';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, RUN_SPEED, type SimEvent } from '../src/sim/types';

type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

function encounter(rarity: Rarity = 'rare') {
  const sim = new Sim({ seed: 5150, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.enterRift(makeVaultSeed(3, 183), 23, sim.player.id, undefined, {
    ...sim.player,
    id: -1,
    vaultOwnerPid: sim.player.id,
    vaultRarity: rarity,
  });
  const inst = sim.riftInstances.find((entry) => entry.partyKey !== null);
  if (!inst || inst.bossId === null) throw new Error('missing hoard');
  const boss = sim.entities.get(inst.bossId);
  if (!boss) throw new Error('missing boss');
  boss.templateId = 'rift_boss_arcane';
  boss.aiState = 'attack';
  boss.aggroTargetId = sim.player.id;
  sim.player.pos = { ...boss.pos, z: boss.pos.z - 20 };
  sim.player.hp = sim.player.maxHp;
  tickHoardBossMechanics(sim.ctx);
  sim.drainEvents();
  quietKit(inst);
  return { sim, inst, boss };
}

/** His Voidfall and Event Horizon are not under test: park their clocks. */
function quietKit(inst: RiftInstance): void {
  if (!inst.hoardBoss) throw new Error('missing state');
  inst.hoardBoss.sweepTimer = 999;
  inst.hoardBoss.markTimer = 999;
  inst.hoardBoss.cues.length = 0;
}

function run(sim: Sim, boss: Entity, seconds: number, each?: () => void): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 0; t < seconds - DT * 0.5; t += DT) {
    boss.aiState = 'attack';
    each?.();
    tickHoardBossMechanics(sim.ctx);
    events.push(...sim.drainEvents());
  }
  return events;
}

const variants = (inst: RiftInstance) =>
  hoardBossCueViews(inst)
    .map((cue) => cue.variant)
    .sort();

function orbsOf(entry: ReturnType<typeof encounter>): Entity[] {
  return [...entry.sim.entities.values()].filter(
    (entity) => entity.templateId === HOARD_PULSAR_TEMPLATE && !entity.dead,
  );
}

/** Wake the orbs and run to the end of the activation: the ward is up. */
function unbind(entry: ReturnType<typeof encounter>, each?: () => void): SimEvent[] {
  const pulsars = entry.inst.hoardBoss?.pulsars;
  if (!pulsars) throw new Error('missing pulsar state');
  pulsars.timer = 0;
  return run(entry.sim, entry.boss, PULSARS.activationCastSec + DT * 3, each);
}

describe('the pulsar numbers (pure, shared with the renderer)', () => {
  it('rides two orbs, three in a legendary hoard, and the third is the apex', () => {
    expect(pulsarCount('common')).toBe(2);
    expect(pulsarCount('rare')).toBe(2);
    expect(pulsarCount('epic')).toBe(2);
    expect(pulsarCount('legendary')).toBe(3);
    expect(pulsarCount(undefined)).toBe(2);
    const left = pulsarAnchor(0);
    const right = pulsarAnchor(1);
    const apex = pulsarAnchor(2);
    // Above the shoulders, a little behind, mirrored; the apex over his head.
    expect(left.x).toBe(-right.x);
    expect([left.y, left.z]).toEqual([right.y, right.z]);
    expect(left.y).toBeGreaterThan(1.5);
    // He is a giant and hoards resize him: the orbs ride at HIS scale.
    expect(pulsarAnchor(0, 2.4).y).toBeCloseTo(left.y * 2.4, 9);
    expect(pulsarAnchor(1, 2.4).x).toBeCloseTo(right.x * 2.4, 9);
    expect(left.z).toBeLessThan(0);
    expect(apex.x).toBe(0);
    expect(apex.y).toBeGreaterThan(left.y + 0.5);
  });

  it('takes station on the side it rode, forward of square, the third in front', () => {
    for (const facing of [0, 1.1, -2.4]) {
      const forward = { x: Math.sin(facing), z: Math.cos(facing) };
      const right = { x: Math.cos(facing), z: -Math.sin(facing) };
      const at = (index: number) => {
        const s = pulsarStation(index, 10, -5, facing);
        const dx = s.x - 10;
        const dz = s.z + 5;
        return { right: dx * right.x + dz * right.z, forward: dx * forward.x + dz * forward.z };
      };
      expect(at(0).right).toBeLessThan(-5);
      expect(at(1).right).toBeGreaterThan(5);
      expect(at(0).right).toBeCloseTo(-at(1).right, 9);
      expect(at(0).forward).toBeGreaterThan(0);
      expect(at(2).right).toBeCloseTo(0, 9);
      expect(at(2).forward).toBeCloseTo(PULSARS.stationFrontDistance, 9);
    }
  });

  it('hunts different players while there are enough, and doubles up only when short', () => {
    expect(assignPulsarTargets(2, [4, 9], 0)).toEqual([4, 9]);
    expect(assignPulsarTargets(3, [4, 9, 12], 1)).toEqual([9, 12, 4]);
    expect(new Set(assignPulsarTargets(3, [1, 2, 3, 4, 5], 7)).size).toBe(3);
    // A lone player faces them all; two players against three share as evenly as can be.
    expect(assignPulsarTargets(3, [7], 5)).toEqual([7, 7, 7]);
    expect(assignPulsarTargets(3, [4, 9], 0)).toEqual([4, 9, 4]);
    expect(assignPulsarTargets(2, [], 0)).toEqual([]);
    // Who is first rotates from cast to cast.
    expect(assignPulsarTargets(2, [4, 9, 12], 0)[0]).not.toBe(
      assignPulsarTargets(2, [4, 9, 12], 1)[0],
    );
  });

  it('chases under a run, turns only so fast, and never snaps onto its target', () => {
    const speed = beamTrackSpeed(1);
    expect(speed).toBeLessThan(RUN_SPEED);
    expect(beamTrackSpeed(HOARD_RARITY_PRESSURE.legendary.speed)).toBeGreaterThan(speed);
    expect(beamTrackSpeed(99)).toBe(PULSARS.beamTrackSpeedCap);
    expect(PULSARS.beamTrackSpeedCap).toBeLessThan(RUN_SPEED);
    // Never more than its pace in a tick, whatever the target does.
    const aim: BeamAim = { x: 0, z: 0, heading: 0 };
    let target = { x: 0, z: 30 };
    for (let tick = 0; tick < 200; tick++) {
      const before = { ...aim };
      if (tick === 60) target = { x: -25, z: -10 }; // a sudden reversal
      stepBeamAim(aim, target.x, target.z, speed, PULSARS.beamTurnSpeed, DT);
      expect(Math.hypot(aim.x - before.x, aim.z - before.z)).toBeLessThanOrEqual(speed * DT + 1e-9);
      let turned = Math.abs(aim.heading - before.heading);
      if (turned > Math.PI) turned = Math.PI * 2 - turned;
      expect(turned).toBeLessThanOrEqual(PULSARS.beamTurnSpeed * DT + 1e-9);
    }
  });

  it('catches a target who stands still and never one who keeps running', () => {
    const speed = beamTrackSpeed(HOARD_RARITY_PRESSURE.legendary.speed);
    const still: BeamAim = { x: 0, z: 0, heading: 0 };
    for (let tick = 0; tick < 40; tick++) stepBeamAim(still, 0, PULSARS.beamStartLag, speed, 3, DT);
    // It lands ON them and stays: it does not orbit or run past.
    expect([still.x, still.z]).toEqual([0, PULSARS.beamStartLag]);

    const chase: BeamAim = { x: 0, z: 0, heading: 0 };
    let runner = PULSARS.beamStartLag;
    let closest = Number.POSITIVE_INFINITY;
    for (let tick = 0; tick < 200; tick++) {
      runner += RUN_SPEED * DT;
      stepBeamAim(chase, 0, runner, speed, PULSARS.beamTurnSpeed, DT);
      closest = Math.min(closest, runner - chase.z);
    }
    expect(closest).toBeGreaterThan(PULSARS.beamWidth);
    // A sharp turn makes it overshoot: the limited turn is what a dodge exploits.
    const sweep: BeamAim = { x: 0, z: 0, heading: 0 };
    stepBeamAim(sweep, 6, 0, speed, PULSARS.beamTurnSpeed, DT);
    expect(sweep.z).toBeGreaterThan(0);
    expect(Math.abs(sweep.heading)).toBeLessThanOrEqual(PULSARS.beamTurnSpeed * DT + 1e-9);
  });

  it('burns exactly the drawn core: the segment from orb to aim, at the beam width', () => {
    const w = PULSARS.beamWidth;
    expect(pointInPulsarBeam(0, 0, 0, 20, 0, 10)).toBe(true);
    expect(pointInPulsarBeam(0, 0, 0, 20, w - 0.01, 10)).toBe(true);
    expect(pointInPulsarBeam(0, 0, 0, 20, w + 0.01, 10)).toBe(false);
    // It ENDS at the aim point: a target it has not reached is not burned.
    expect(pointInPulsarBeam(0, 0, 0, 20, 0, 20 + w + 0.01)).toBe(false);
    expect(pointInPulsarBeam(0, 0, 0, 20, 0, 20 + w - 0.01)).toBe(true);
    expect(pointInPulsarBeam(0, 0, 0, 20, 0, -w - 0.01)).toBe(false);
    // A beam with no length is a point.
    expect(pointInPulsarBeam(3, 3, 3, 3, 3.2, 3)).toBe(true);
  });
});

describe('dormant: part of the boss, never a target', () => {
  it('rides him in and out of combat as an aura, with no mob to hit', () => {
    const entry = encounter('legendary');
    const riding = () => entry.boss.auras.find((a) => a.id === HOARD_BOUND_PULSARS_AURA_ID);
    expect(riding()?.stacks).toBe(3);
    expect(riding()?.value).toBe(0);
    expect(orbsOf(entry)).toHaveLength(0);
    // He drops combat: the encounter state goes, the orbs stay on him.
    entry.boss.aiState = 'idle';
    tickHoardBossMechanics(entry.sim.ctx);
    expect(entry.inst.hoardBoss).toBeUndefined();
    expect(riding()?.stacks).toBe(3);
    expect(
      encounter('rare').boss.auras.find((a) => a.id === HOARD_BOUND_PULSARS_AURA_ID)?.stacks,
    ).toBe(2);
  });
});

describe('activation', () => {
  it('telegraphs first: the orbs leave him, and only then is he warded and are they mobs', () => {
    const entry = encounter();
    const pulsars = entry.inst.hoardBoss?.pulsars;
    if (!pulsars) throw new Error('missing state');
    pulsars.timer = 0;
    run(entry.sim, entry.boss, DT * 2);
    expect(variants(entry.inst)).toEqual(['arcane-pulsar', 'arcane-pulsar', 'arcane-pulsar-ward']);
    expect(entry.boss.castingAbility).toBe(HOARD_CAST_PULSAR_OVERLOAD);
    expect(entry.boss.castTotal).toBeCloseTo(PULSAR_WARD_TOTAL_SEC, 9);
    // Still the telegraph: not immune yet, nothing to attack yet, no longer riding.
    expect(entry.boss.damageImmune).toBeFalsy();
    expect(orbsOf(entry)).toHaveLength(0);
    expect(entry.boss.auras.some((a) => a.id === HOARD_BOUND_PULSARS_AURA_ID)).toBe(false);
    const stations = hoardBossCueViews(entry.inst).filter((cue) => cue.variant === 'arcane-pulsar');
    expect(stations.map((cue) => cue.radius)).toEqual([0, 1]);
    run(entry.sim, entry.boss, PULSARS.activationCastSec);
    expect(entry.boss.damageImmune).toBe(true);
    expect(entry.boss.auras.some((a) => a.id === HOARD_PULSAR_WARD_AURA_ID)).toBe(true);
    const orbs = orbsOf(entry);
    expect(orbs).toHaveLength(2);
    for (const orb of orbs) {
      expect(orb.hostile).toBe(true);
      expect(orb.maxHp).toBe(Math.round(entry.boss.maxHp * PULSARS.orbHealthFraction));
      expect(entry.inst.mobIds).toContain(orb.id);
      const station = stations.find(
        (cue) => Math.hypot(cue.x - orb.pos.x, cue.z - orb.pos.z) < 0.01,
      );
      expect(station).toBeDefined();
    }
  });

  it('really wards him: damage resolves as nothing, not as a big health pool', () => {
    const entry = encounter();
    unbind(entry);
    const hp = entry.boss.hp;
    const dealt = entry.sim.ctx.dealDamage(
      entry.sim.player,
      entry.boss,
      5000,
      false,
      'physical',
      null,
      'hit',
    );
    expect(dealt).toBe(0);
    expect(entry.boss.hp).toBe(hp);
    // The orbs themselves take damage normally.
    const orb = orbsOf(entry)[0];
    entry.sim.ctx.dealDamage(entry.sim.player, orb, 10, false, 'physical', null, 'hit');
    expect(orb.hp).toBeLessThan(orb.maxHp);
  });

  it('pins him where he cast and only into a room clear of his own mechanics', () => {
    const entry = encounter();
    const state = entry.inst.hoardBoss;
    if (!state?.pulsars) throw new Error('missing state');
    state.cues.push({
      id: 900,
      kind: 'mark',
      variant: 'arcane-voidfall',
      phase: 'hazard',
      x: entry.boss.pos.x,
      z: entry.boss.pos.z - 9,
      radius: 3,
      remaining: 0.2,
      total: 4,
    });
    state.pulsars.timer = 0;
    run(entry.sim, entry.boss, DT);
    expect(hoardBossCueViews(entry.inst).some((cue) => isPulsarVariant(cue.variant))).toBe(false);
    run(entry.sim, entry.boss, 0.4);
    const ward = hoardBossCueViews(entry.inst).find((cue) => cue.variant === 'arcane-pulsar-ward');
    if (!ward) throw new Error('no ward');
    entry.boss.pos.x += 7;
    expect(holdHoardPulsars(entry.sim.ctx, entry.boss)).toBe(true);
    expect(entry.boss.pos.x).toBeCloseTo(ward.x, 9);
    // The kit is held back for the whole phase.
    state.markTimer = 0.05;
    run(entry.sim, entry.boss, 3);
    expect(hoardBossCueViews(entry.inst).every((cue) => isPulsarVariant(cue.variant))).toBe(true);
  });

  it('a legendary hoard unbinds three', () => {
    const entry = encounter('legendary');
    unbind(entry);
    expect(orbsOf(entry)).toHaveLength(3);
    expect(
      hoardBossCueViews(entry.inst)
        .filter((cue) => cue.variant === 'arcane-pulsar')
        .map((cue) => cue.radius),
    ).toEqual([0, 1, 2]);
  });
});

describe('the beam', () => {
  it('warns with a line locked on its target, then fires SHORT of them', () => {
    const entry = encounter();
    unbind(entry);
    const lock = hoardBossCueViews(entry.inst).filter(
      (cue) => cue.variant === 'arcane-pulsar-lock',
    );
    const stations = hoardBossCueViews(entry.inst).filter((cue) => cue.variant === 'arcane-pulsar');
    expect(lock).toHaveLength(2);
    for (const cue of lock) {
      expect(cue.targetId).toBe(entry.sim.player.id);
      // Paired by id with its orb: the renderer needs nothing else.
      expect(stations.some((station) => station.cueId + 1 === cue.cueId)).toBe(true);
    }
    const hp = entry.sim.player.hp;
    run(entry.sim, entry.boss, PULSARS.targetWarningSec - DT * 3);
    expect(entry.sim.player.hp).toBe(hp); // the line is harmless
    run(entry.sim, entry.boss, DT * 4);
    const beams = hoardBossCueViews(entry.inst).filter(
      (cue) => cue.variant === 'arcane-pulsar-beam',
    );
    // A lone player: one orb fires, the other keeps its harmless line on them.
    expect(beams).toHaveLength(1);
    expect(
      hoardBossCueViews(entry.inst).filter((cue) => cue.variant === 'arcane-pulsar-lock'),
    ).toHaveLength(1);
    for (const beam of beams) {
      expect(beam.targetId).toBeUndefined();
      const gap = Math.hypot(beam.x - entry.sim.player.pos.x, beam.z - entry.sim.player.pos.z);
      expect(gap).toBeGreaterThan(PULSARS.beamWidth);
      expect(gap).toBeLessThanOrEqual(PULSARS.beamStartLag + 1e-6);
    }
    expect(entry.sim.player.hp).toBe(hp); // and the first instant of fire is not a hit
  });

  it('kills a player who stands in it, in ticks, never every frame', () => {
    const entry = encounter();
    unbind(entry);
    const events = run(entry.sim, entry.boss, PULSARS.targetWarningSec + 4);
    const burns = events.filter(
      (event) => event.type === 'damage' && event.ability === 'Tracking Beam',
    );
    expect(burns.length).toBeGreaterThan(4);
    // In ticks, never every frame: at most one hit per tick window.
    expect(burns.length).toBeLessThanOrEqual(Math.ceil(4.5 / PULSARS.beamDamageTickSec) + 2);
    expect(entry.sim.player.hp).toBeLessThan(entry.sim.player.maxHp * 0.4);
  });

  it('never touches a player who keeps moving', () => {
    const entry = encounter();
    // Round HIM at a run, outside the stations: the beams are arms swinging from
    // the orbs, and running round them keeps every arm behind you. (Cutting
    // across the room instead would mean crossing one, which is a hit.)
    let angle = Math.PI;
    const circle = () => {
      angle += (RUN_SPEED * DT) / 18;
      entry.sim.player.pos = {
        ...entry.sim.player.pos,
        x: entry.boss.pos.x + Math.sin(angle) * 18,
        z: entry.boss.pos.z + Math.cos(angle) * 18,
      };
    };
    unbind(entry, circle);
    const events = run(entry.sim, entry.boss, 12, circle);
    expect(
      events.some((event) => event.type === 'damage' && event.ability === 'Tracking Beam'),
    ).toBe(false);
    expect(entry.sim.player.hp).toBe(entry.sim.player.maxHp);
    // And it DID chase them the whole way: the beams' aim points covered ground.
    const aims = events.filter(
      (event) => event.type === 'hoardBossCue' && event.variant === 'arcane-pulsar-beam',
    );
    expect(aims.length).toBeGreaterThan(60);
    let travelled = 0;
    for (let i = 1; i < aims.length; i++) {
      const a = aims[i - 1];
      const b = aims[i];
      if (a.type !== 'hoardBossCue' || b.type !== 'hoardBossCue' || a.cueId !== b.cueId) continue;
      travelled += Math.hypot(b.x - a.x, b.z - a.z);
    }
    expect(travelled).toBeGreaterThan(30);
  });

  it('re-sends the aim point as a short-lived heartbeat, so a client can follow it', () => {
    const entry = encounter();
    unbind(entry);
    run(entry.sim, entry.boss, PULSARS.targetWarningSec + DT * 2);
    const events = run(entry.sim, entry.boss, 1);
    const beats = events.filter(
      (event) => event.type === 'hoardBossCue' && event.variant === 'arcane-pulsar-beam',
    );
    // One live beam on a lone player, every other tick, for a second.
    expect(beats.length).toBeGreaterThanOrEqual(8);
    expect(beats.length).toBeLessThanOrEqual(12);
    for (const beat of beats) {
      if (beat.type !== 'hoardBossCue') continue;
      expect(beat.durationSecs).toBeCloseTo(PULSARS.beamHeartbeatLifeSec, 9);
      expect(beat.durationSecs).toBeGreaterThan(PULSARS.beamHeartbeatTicks * DT * 2);
    }
  });

  it('never sets two live beams on one player: orbs that share a quarry take turns', () => {
    const entry = encounter('legendary');
    let angle = Math.PI;
    const circle = () => {
      angle += (RUN_SPEED * DT) / 18;
      entry.sim.player.pos = {
        ...entry.sim.player.pos,
        x: entry.boss.pos.x + Math.sin(angle) * 18,
        z: entry.boss.pos.z + Math.cos(angle) * 18,
      };
    };
    unbind(entry, circle);
    const fired = new Set<number>();
    for (let t = 0; t < PULSARS.beamShareSec * 3 + 2; t += DT) {
      run(entry.sim, entry.boss, DT, circle);
      const views = hoardBossCueViews(entry.inst);
      const beams = views.filter((cue) => cue.variant === 'arcane-pulsar-beam');
      expect(beams.length).toBeLessThanOrEqual(1);
      for (const beam of beams) fired.add(beam.cueId);
      // The ones waiting still SHOW their line: three orbs, three lines or beams.
      const lines = views.filter((cue) => cue.variant === 'arcane-pulsar-lock');
      expect(beams.length + lines.length).toBe(3);
    }
    // Every orb had its turn.
    expect(fired.size).toBe(3);
    // Enough players, and they all fire at once, each at their own.
    const party = encounter('legendary');
    for (const id of [7001, 7002]) {
      const ally = { ...party.sim.player, id, pos: { ...party.sim.player.pos }, auras: [] };
      party.sim.entities.set(id, ally);
      party.inst.memberIds.add(id);
    }
    party.inst.memberIds.add(party.sim.player.id);
    unbind(party);
    run(party.sim, party.boss, PULSARS.targetWarningSec + DT * 3);
    expect(
      hoardBossCueViews(party.inst).filter((cue) => cue.variant === 'arcane-pulsar-beam'),
    ).toHaveLength(3);
  });

  it('moves to another player when its quarry dies, and stops when nobody is left', () => {
    const entry = encounter();
    const ally = { ...entry.sim.player, id: 7001, pos: { ...entry.sim.player.pos }, auras: [] };
    ally.pos.x += 6;
    entry.sim.entities.set(ally.id, ally);
    entry.inst.memberIds.add(entry.sim.player.id);
    entry.inst.memberIds.add(ally.id);
    unbind(entry);
    const hunted = () =>
      (entry.inst.hoardBoss?.pulsars?.orbs ?? []).map((orb) => orb.targetId).sort();
    // Two players, two orbs: one each.
    expect(hunted()).toEqual([entry.sim.player.id, ally.id].sort());
    ally.dead = true;
    run(entry.sim, entry.boss, DT * 3);
    expect(hunted()).toEqual([entry.sim.player.id, entry.sim.player.id]);
    entry.sim.player.dead = true;
    run(entry.sim, entry.boss, DT * 3);
    expect(
      hoardBossCueViews(entry.inst).some(
        (cue) => cue.variant === 'arcane-pulsar-lock' || cue.variant === 'arcane-pulsar-beam',
      ),
    ).toBe(false);
  });
});

describe('determinism and the wire', () => {
  it('draws no rng: the same seed plays the same phase, event for event', () => {
    const play = () => {
      const entry = encounter('legendary');
      let angle = Math.PI;
      const events = unbind(entry);
      events.push(
        ...run(entry.sim, entry.boss, 9, () => {
          angle += (RUN_SPEED * DT) / 18;
          entry.sim.player.pos = {
            ...entry.sim.player.pos,
            x: entry.boss.pos.x + Math.sin(angle) * 18,
            z: entry.boss.pos.z + Math.cos(angle) * 18,
          };
        }),
      );
      return {
        stream: events.filter((e) => e.type === 'hoardBossCue' || e.type === 'damage'),
        // Where the shared stream stands afterwards: the next draw it would hand out.
        next: entry.sim.rng.next(),
      };
    };
    const a = play();
    const b = play();
    expect(a.stream.length).toBeGreaterThan(50);
    expect(b.stream).toEqual(a.stream);
    expect(b.next).toBe(a.next);
    // And the phase itself took nothing from it: a hoard that never casts stands
    // at the same place.
    const idle = encounter('legendary');
    run(idle.sim, idle.boss, PULSARS.activationCastSec + DT * 3 + 9);
    expect(idle.sim.rng.next()).toBe(a.next);
  });

  it('keeps the wire quiet: only a FIRING beam beats fast, even with a full party', () => {
    const entry = encounter('legendary');
    for (const id of [7001, 7002, 7003, 7004]) {
      const ally = { ...entry.sim.player, id, pos: { ...entry.sim.player.pos }, auras: [] };
      entry.sim.entities.set(id, ally);
      entry.inst.memberIds.add(id);
    }
    entry.inst.memberIds.add(entry.sim.player.id);
    unbind(entry);
    run(entry.sim, entry.boss, PULSARS.targetWarningSec + DT * 2);
    const second = run(entry.sim, entry.boss, 1).filter((e) => e.type === 'hoardBossCue');
    // Three beams, ten beats a second each, to each of five players, and nothing
    // else: no orb or ward cue is ever re-sent.
    expect(second.length).toBeLessThanOrEqual(3 * 11 * 5);
    expect(
      second.every((e) => e.type === 'hoardBossCue' && e.variant === 'arcane-pulsar-beam'),
    ).toBe(true);
    // A lone player faces one beam and two waiting lines: the lines barely speak.
    const solo = encounter('legendary');
    unbind(solo);
    run(solo.sim, solo.boss, PULSARS.targetWarningSec + DT * 2);
    const lines = run(solo.sim, solo.boss, 4).filter(
      (e) => e.type === 'hoardBossCue' && e.variant === 'arcane-pulsar-lock',
    );
    expect(lines.length).toBeGreaterThanOrEqual(6);
    expect(lines.length).toBeLessThanOrEqual(12);
  });
});

describe('an orb is a real target, under the real mob AI', () => {
  it('shot from range for a whole phase it never turns immune, and it dies to damage', () => {
    const entry = encounter();
    unbind(entry);
    const orb = orbsOf(entry)[0];
    // A caster's spot: far outside any melee reach of a mob that cannot move.
    const stand = { ...entry.sim.player.pos, x: orb.pos.x, z: orb.pos.z - 22 };
    entry.sim.player.targetId = orb.id;
    let last = orb.hp;
    let landed = 0;
    // The WHOLE sim ticks here (mob AI, leash and stall logic included), and the
    // orb is chipped from range every half second for fifteen seconds.
    for (let tick = 0; tick < 300 && !orb.dead; tick++) {
      entry.boss.aiState = 'attack';
      entry.sim.player.pos = { ...stand };
      entry.sim.player.hp = entry.sim.player.maxHp;
      entry.sim.tick();
      if (tick % 10 !== 0) continue;
      const dealt = entry.sim.ctx.dealDamage(
        entry.sim.player,
        orb,
        3,
        false,
        'arcane',
        null,
        'hit',
      );
      expect(dealt, `hit at tick ${tick}`).toBeGreaterThan(0);
      expect(orb.hp).toBeLessThan(last);
      last = orb.hp;
      landed++;
      // It holds its station: it never walks, leashes home or heals back up.
      expect(Math.hypot(orb.pos.x - orb.spawnPos.x, orb.pos.z - orb.spawnPos.z)).toBeLessThan(0.01);
    }
    expect(landed).toBe(30);
    // Finish it with damage: it dies like any mob, is cleaned up, and nobody is
    // left targeting a removed entity.
    entry.sim.ctx.dealDamage(entry.sim.player, orb, orb.maxHp * 2, false, 'arcane', null, 'hit');
    expect(orb.dead).toBe(true);
    const events = entry.sim.drainEvents();
    entry.sim.tick();
    expect(entry.sim.entities.has(orb.id)).toBe(false);
    expect(entry.sim.player.targetId).toBeNull();
    // No experience and no loot: it is a mechanic, never a kill to farm.
    expect(events.some((event) => event.type === 'xp' || event.type === 'loot')).toBe(false);
    expect(orbsOf(entry)).toHaveLength(1);
    expect(entry.boss.damageImmune).toBe(true);
  });
});

describe('ending the phase', () => {
  it('a dead orb takes its beam with it, at once; the ward holds while one burns', () => {
    const entry = encounter();
    unbind(entry);
    run(entry.sim, entry.boss, PULSARS.targetWarningSec + DT * 3);
    const [first, second] = orbsOf(entry);
    first.hp = 0;
    first.dead = true;
    const events = run(entry.sim, entry.boss, DT * 2);
    expect(orbsOf(entry).map((orb) => orb.id)).toEqual([second.id]);
    expect(entry.sim.entities.has(first.id)).toBe(false);
    expect(entry.inst.mobIds).not.toContain(first.id);
    const views = hoardBossCueViews(entry.inst);
    expect(views.filter((cue) => cue.variant === 'arcane-pulsar')).toHaveLength(1);
    // Its beam is gone; the survivor's line or beam is all that is left.
    expect(
      views.filter(
        (cue) => cue.variant === 'arcane-pulsar-beam' || cue.variant === 'arcane-pulsar-lock',
      ),
    ).toHaveLength(1);
    // Every client is told, with zero-length cues, the same tick.
    const withdrawn = events.filter((e) => e.type === 'hoardBossCue' && e.durationSecs === 0);
    expect(withdrawn).toHaveLength(2);
    expect(entry.boss.damageImmune).toBe(true);
  });

  it('the last orb dying drops the ward, the cast and the carrier, and he can be hurt', () => {
    const entry = encounter();
    unbind(entry);
    for (const orb of orbsOf(entry)) {
      orb.hp = 0;
      orb.dead = true;
    }
    run(entry.sim, entry.boss, DT * 2);
    expect(entry.boss.damageImmune).toBe(false);
    expect(entry.boss.auras.some((a) => a.id === HOARD_PULSAR_WARD_AURA_ID)).toBe(false);
    expect(entry.boss.castingAbility).toBeNull();
    expect(holdHoardPulsars(entry.sim.ctx, entry.boss)).toBe(false);
    expect(hoardBossCueViews(entry.inst).some((cue) => isPulsarVariant(cue.variant))).toBe(false);
    const hp = entry.boss.hp;
    entry.sim.ctx.dealDamage(entry.sim.player, entry.boss, 50, false, 'physical', null, 'hit');
    expect(entry.boss.hp).toBeLessThan(hp);
  });

  it('goes without his orbs for a while, then they reform and the cycle can repeat', () => {
    const entry = encounter();
    unbind(entry);
    for (const orb of orbsOf(entry)) orb.dead = true;
    run(entry.sim, entry.boss, DT * 2);
    const riding = () => entry.boss.auras.some((a) => a.id === HOARD_BOUND_PULSARS_AURA_ID);
    expect(riding()).toBe(false);
    run(entry.sim, entry.boss, PULSARS.orbRespawnDelaySec - 1);
    expect(riding()).toBe(false);
    run(entry.sim, entry.boss, 1.2);
    expect(riding()).toBe(true);
    const pulsars = entry.inst.hoardBoss?.pulsars;
    expect(pulsars?.timer).toBeLessThanOrEqual(PULSARS_EVERY_SEC);
    expect(pulsars?.timer).toBeGreaterThan(PULSARS_EVERY_SEC - PULSARS.orbRespawnDelaySec - 2);
    if (pulsars) pulsars.timer = 0;
    run(entry.sim, entry.boss, PULSARS.activationCastSec + DT * 3);
    expect(orbsOf(entry)).toHaveLength(2);
  });

  it('too slow: the orbs burst over everyone, survivably, and the ward falls anyway', () => {
    const entry = encounter();
    unbind(entry);
    // Running round him, out of every beam: only the overload may hurt.
    let angle = Math.PI;
    const events = run(entry.sim, entry.boss, PULSARS.maxPhaseSec + 1, () => {
      angle += (RUN_SPEED * DT) / 18;
      entry.sim.player.pos = {
        ...entry.sim.player.pos,
        x: entry.boss.pos.x + Math.sin(angle) * 18,
        z: entry.boss.pos.z + Math.cos(angle) * 18,
      };
    });
    const overload = events.filter(
      (event) => event.type === 'damage' && event.ability === 'Pulsar Overload',
    );
    expect(overload).toHaveLength(1);
    expect(entry.sim.player.dead).toBe(false);
    expect(entry.sim.player.hp).toBeLessThan(entry.sim.player.maxHp);
    expect(entry.boss.damageImmune).toBe(false);
    expect(orbsOf(entry)).toHaveLength(0);
    expect(hoardBossCueViews(entry.inst).some((cue) => isPulsarVariant(cue.variant))).toBe(false);
  });

  it('a reset mid-phase leaves no orb, no ward, no cast and no beam behind', () => {
    const entry = encounter('legendary');
    unbind(entry);
    run(entry.sim, entry.boss, PULSARS.targetWarningSec + 1);
    expect(orbsOf(entry)).toHaveLength(3);
    entry.boss.aiState = 'idle';
    tickHoardBossMechanics(entry.sim.ctx);
    const events = entry.sim.drainEvents();
    tickHoardBossMechanics(entry.sim.ctx);
    expect(events.some((event) => event.type === 'hoardBossCueClear')).toBe(true);
    expect(entry.inst.hoardBoss).toBeUndefined();
    expect(orbsOf(entry)).toHaveLength(0);
    expect(entry.boss.damageImmune).toBe(false);
    expect(entry.boss.auras.some((a) => a.id === HOARD_PULSAR_WARD_AURA_ID)).toBe(false);
    expect(entry.boss.castingAbility).toBeNull();
    expect(hoardBossCueViews(entry.inst)).toHaveLength(0);
    // And he wears his dormant orbs again, ready for the next pull.
    expect(entry.boss.auras.find((a) => a.id === HOARD_BOUND_PULSARS_AURA_ID)?.stacks).toBe(3);
    const hp = entry.sim.player.hp;
    for (let t = 0; t < 5; t += DT) tickHoardBossMechanics(entry.sim.ctx);
    expect(entry.sim.player.hp).toBe(hp);
  });
});
