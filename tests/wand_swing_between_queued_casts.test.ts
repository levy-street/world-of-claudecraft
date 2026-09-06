// Wand uptime under spell-queue spam: a caster who queues the next cast inside
// the CAST_QUEUE_WINDOW_SEC tail of the running one never leaves a gap between
// casts, and the auto-attack driver (which bails while castingAbility is set)
// would starve the ready wand bolt forever. On cast completion the queue fires
// a ready swing itself (ctx.tryPlayerSwing) before starting the queued cast,
// so the wand keeps its cadence between casts and the cast starts on time.

import { describe, expect, it } from 'vitest';
import { swingReadyForQueuedCast } from '../src/sim/combat/queued_cast_swing_yield';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { AuraKind, Entity } from '../src/sim/types';
import { DT } from '../src/sim/types';
import { placePlayerInOpenField } from './helpers/open_field';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;
type Ev = Record<string, any>;

function makeSim(seed = 7, cls = 'mage'): { sim: AnySim; p: AnyEntity } {
  const sim = new Sim({ seed, playerClass: cls as any, autoEquip: true }) as AnySim;
  sim.setPlayerLevel(20);
  placePlayerInOpenField(sim);
  const p = sim.player as AnyEntity;
  p.resource = p.maxResource;
  return { sim, p };
}

function spawnDummy(sim: AnySim, p: AnyEntity, dz: number): AnyEntity {
  // The practice dummy never swings back, so no pushback stretches the casts.
  const mob = createMob(sim.nextId++, MOBS.training_dummy, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dz,
  }) as AnyEntity;
  sim.addEntity(mob);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  sim.targetEntity(mob.id, p.id);
  return mob;
}

function capture(sim: AnySim): Ev[] {
  const events: Ev[] = [];
  const orig = (sim as any).emit.bind(sim);
  (sim as any).emit = (e: Ev) => {
    events.push(e);
    orig(e);
  };
  return events;
}

const isWandBolt = (e: Ev) => e.type === 'spellfx' && e.fx === 'projectile' && e.wand === true;

// Spam Cinderbolt for `ticks` ticks the way a player mashes the key: press
// every tick, so each press lands inside the previous cast's queue window.
function spamCasts(sim: AnySim, p: AnyEntity, ticks: number, abilityId = 'fireball'): void {
  for (let i = 0; i < ticks; i++) {
    p.resource = p.maxResource;
    sim.castAbility(abilityId);
    sim.tick();
  }
}

// Stamp every captured event with the tick it was emitted on.
function captureTicked(sim: AnySim): Ev[] {
  const events = capture(sim);
  const push = events.push.bind(events);
  events.push = (...items: Ev[]) => push(...items.map((e) => ({ ...e, __tick: sim.tickCount })));
  return events;
}

describe('wand swings keep firing between spell-queued casts', () => {
  it('a mage spamming Cinderbolt still lands wand bolts', () => {
    const { sim, p } = makeSim();
    spawnDummy(sim, p, 20);
    const events = capture(sim);
    (sim as any).startAutoAttack(p.id);
    // 15 seconds of key mashing: five 3.0s Cinderbolts back to back, each one
    // queued in the tail of the last so castingAbility never reads null.
    spamCasts(sim, p, 300);
    const bolts = events.filter(isWandBolt).length;
    const castStarts = events.filter((e) => e.type === 'castStart').length;
    expect(castStarts).toBeGreaterThanOrEqual(5);
    // One wand bolt lands after every completed cast (the 1.8s class wand is
    // always ready again by the time a 3.0s cast finishes). Before the fix
    // this count was exactly zero: the first bolt could fire only before the
    // first cast started, and startAutoAttack ran after the first press here.
    expect(bolts).toBeGreaterThanOrEqual(4);
  });

  it('the wand bolt, the castStop and the queued castStart share one tick', () => {
    const { sim, p } = makeSim();
    spawnDummy(sim, p, 20);
    const events = captureTicked(sim);
    (sim as any).startAutoAttack(p.id);
    spamCasts(sim, p, 300);
    const stops = events.filter((e) => e.type === 'castStop' && e.success);
    expect(stops.length).toBeGreaterThanOrEqual(4);
    // Skip the first completion: its bolt may predate the cast entirely.
    for (const stop of stops.slice(1)) {
      const sameTick = events.filter((e) => e.__tick === stop.__tick);
      expect(sameTick.some(isWandBolt)).toBe(true);
      expect(sameTick.some((e) => e.type === 'castStart')).toBe(true);
      // the bolt leaves before the queued cast starts
      const bolt = sameTick.findIndex(isWandBolt);
      const start = sameTick.findIndex((e) => e.type === 'castStart');
      expect(bolt).toBeLessThan(start);
    }
    expect(p.queuedCastAbility).toBeNull();
  });

  it('queue-fired swings keep the exact weapon cadence of a non-casting auto-attack', () => {
    // A 2.95s weapon (sixty DT steps to zero, no float residual) against 3.0s
    // Lightning Bolts: every completion lands on the tick the driver itself
    // would swing, so an off-by-one between the queue's pre-decay check and
    // the driver's post-decay check shows up as a doubled gap (the swing
    // waits a whole extra cast). The gaps must equal the pure auto-attack ones.
    const gaps = (events: Ev[]) => {
      const ticks = events
        .filter((e) => e.type === 'damage' && e.ability === null)
        .map((e) => e.__tick as number);
      return ticks.slice(1).map((t, i) => t - ticks[i]);
    };
    const rig = () => {
      const { sim, p } = makeSim(7, 'shaman');
      spawnDummy(sim, p, 2);
      p.weapon = { ...p.weapon, speed: 2.95 };
      p.dualWielding = false;
      p.offhandWeapon = null;
      return { sim, p, events: captureTicked(sim) };
    };
    const base = rig();
    (base.sim as any).startAutoAttack(base.p.id);
    for (let i = 0; i < 400; i++) base.sim.tick();
    const baseGaps = gaps(base.events);
    expect(baseGaps.length).toBeGreaterThanOrEqual(5);
    expect(new Set(baseGaps)).toEqual(new Set([60]));

    // Start the spam right after a DRIVER-fired swing, so the first queued
    // completion lands on the tick the next driver swing is due, then keep
    // chaining: the first gap crosses driver -> queue, the rest queue -> queue.
    const spam = rig();
    (spam.sim as any).startAutoAttack(spam.p.id);
    const swung = () => spam.events.some((e) => e.type === 'damage' && e.ability === null);
    for (let i = 0; i < 100 && !swung(); i++) spam.sim.tick();
    expect(swung()).toBe(true);
    spamCasts(spam.sim, spam.p, 400, 'lightning_bolt');
    const spamGaps = gaps(spam.events);
    expect(spamGaps.length).toBeGreaterThanOrEqual(4);
    expect(new Set(spamGaps)).toEqual(new Set([60]));
  });

  it('a queued cast with no ready swing fires on completion, unchanged', () => {
    const { sim, p } = makeSim();
    spawnDummy(sim, p, 20);
    const events = captureTicked(sim);
    // auto-attack off: no swing can ever be ready, the queue fires at once
    spamCasts(sim, p, 100);
    const stops = events.filter((e) => e.type === 'castStop' && e.success);
    expect(stops.length).toBeGreaterThanOrEqual(1);
    const sameTick = events.filter((e) => e.__tick === stops[0].__tick);
    expect(sameTick.some((e) => e.type === 'castStart')).toBe(true);
    expect(events.some(isWandBolt)).toBe(false);
  });

  it('a ready swing that cannot land (disarmed) never delays the queued cast', () => {
    const { sim, p } = makeSim();
    spawnDummy(sim, p, 20);
    const events = captureTicked(sim);
    (sim as any).startAutoAttack(p.id);
    // first cast under way, then knock the weapon away: spells keep casting
    // through a disarm, the auto-attack driver refuses the swing
    spamCasts(sim, p, 30);
    p.auras.push({
      id: 'disarm',
      name: 'Disarm',
      kind: 'disarm' as AuraKind,
      remaining: 30,
      duration: 30,
      value: 0,
      sourceId: p.id,
      school: 'physical' as const,
    });
    p.swingTimer = 0;
    const boltsBefore = events.filter(isWandBolt).length;
    spamCasts(sim, p, 60);
    const stops = events.filter((e) => e.type === 'castStop' && e.success);
    expect(stops.length).toBeGreaterThanOrEqual(1);
    const sameTick = events.filter((e) => e.__tick === stops[0].__tick);
    expect(sameTick.some((e) => e.type === 'castStart')).toBe(true);
    expect(events.filter(isWandBolt).length).toBe(boltsBefore);
  });

  it('a shaman queuing Lightning Bolt in melee still lands white swings between casts', () => {
    const { sim, p } = makeSim(7, 'shaman');
    spawnDummy(sim, p, 2);
    const events = captureTicked(sim);
    (sim as any).startAutoAttack(p.id);
    spamCasts(sim, p, 300, 'lightning_bolt');
    const stops = events.filter((e) => e.type === 'castStop' && e.success);
    expect(stops.length).toBeGreaterThanOrEqual(4);
    // a white swing (damage event with no ability label) shares the tick with
    // every completion after the first, just like the wand bolt does
    for (const stop of stops.slice(1)) {
      const sameTick = events.filter((e) => e.__tick === stop.__tick);
      expect(sameTick.some((e) => e.type === 'damage' && e.ability === null)).toBe(true);
    }
  });

  it('does not pull a ready swing ahead of a queued instant spell', () => {
    const { sim, p } = makeSim();
    sim.setSpec('fire');
    const mob = spawnDummy(sim, p, 2);
    const events = captureTicked(sim);
    (sim as any).startAutoAttack(p.id);
    sim.castAbility('fireball');
    while (p.castRemaining > 0.06) sim.tick();
    p.queuedCastAbility = 'fire_blast';
    p.queuedCastAim = null;
    p.swingTimer = 0;
    p.resource = p.maxResource;
    sim.tick();

    const lastTick = Math.max(...events.map((e) => e.__tick as number));
    const sameTick = events.filter((e) => e.__tick === lastTick);
    const blast = sameTick.findIndex((e) => e.type === 'damage' && e.abilityId === 'fire_blast');
    const swing = sameTick.findIndex((e) => isWandBolt(e) && e.targetId === mob.id);
    expect(blast).toBeGreaterThan(-1);
    expect(swing).toBeGreaterThan(-1);
    expect(blast).toBeLessThan(swing);
  });
});

describe('swingReadyForQueuedCast (pure)', () => {
  const base = {
    autoAttack: true,
    swingTimer: 0,
    offhandSwingTimer: 1,
    dualWielding: false,
    offhandWeapon: null,
    targetId: 5,
  };
  it('is ready when auto-attack is armed, the timer is spent and a target is held', () => {
    expect(swingReadyForQueuedCast(base)).toBe(true);
  });
  it('is not ready without auto-attack, with time on the swing timer, or without a target', () => {
    expect(swingReadyForQueuedCast({ ...base, autoAttack: false })).toBe(false);
    expect(swingReadyForQueuedCast({ ...base, swingTimer: 0.3 })).toBe(false);
    expect(swingReadyForQueuedCast({ ...base, targetId: null })).toBe(false);
  });
  it("counts a timer within one tick of zero as ready, the driver's post-decay view", () => {
    expect(swingReadyForQueuedCast({ ...base, swingTimer: DT })).toBe(true);
    expect(swingReadyForQueuedCast({ ...base, swingTimer: DT * 1.5 })).toBe(false);
  });
  it('mirrors the driver: a ready offhand counts only while dual wielding with one equipped', () => {
    const mainBusy = { ...base, swingTimer: 0.5, offhandSwingTimer: 0 };
    expect(swingReadyForQueuedCast(mainBusy)).toBe(false);
    expect(swingReadyForQueuedCast({ ...mainBusy, dualWielding: true })).toBe(false);
    expect(
      swingReadyForQueuedCast({ ...mainBusy, dualWielding: true, offhandWeapon: { id: 'x' } }),
    ).toBe(true);
  });
});
