// Red Harvest resolves on the cast tick like every classic instant (the sim
// never waits on the authored contact timing, which the client owns:
// src/render/ability_vfx/harvest_choreography.ts). These pins guard the
// presentation handshake around that instant result: one opening cue, three
// strikes carrying attackAnimationStarted, refunds and Enrage in the same tick,
// and no deferred work left behind on the delayed-event queue.
import { afterEach, expect, it, vi } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

afterEach(() => vi.restoreAllMocks());

const TICKS_AFTER_CAST = 10;

function fixture() {
  const sim = new Sim({
    seed: 7,
    playerClass: 'warrior',
    autoEquip: true,
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('fury')).toBe(true);
  const p = sim.player;
  const target = createMob(100_001, MOBS.forest_wolf, p.level, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + 2,
  });
  target.hp = target.maxHp = 1_000_000;
  target.hostile = true;
  sim.ctx.addEntity(target);
  sim.targetEntity(target.id, p.id);
  p.facing = 0;
  p.resource = 100;
  p.gcdRemaining = 0;
  p.hitBonus = 1;
  sim.drainEvents();
  // Real ticks after the cast: nothing Red Harvest related may land late.
  const settle = () => {
    const events: SimEvent[] = [];
    for (let tick = 0; tick < TICKS_AFTER_CAST; tick++) events.push(...sim.tick());
    return events;
  };
  return { sim, p, target, settle };
}

function damage(events: SimEvent[]) {
  return events.filter(
    (e): e is Extract<SimEvent, { type: 'damage' }> =>
      e.type === 'damage' && e.ability === 'Red Harvest',
  );
}

it('spends, opens and delivers all three strikes on the cast tick, then nothing more', () => {
  const { sim, p, target, settle } = fixture();
  vi.spyOn(sim.ctx.rng, 'next').mockReturnValue(0.9);
  const resolve = vi.spyOn(sim.ctx, 'runEffects');
  p.abilityCharges = {
    ...p.abilityCharges,
    raging_gale: { charges: 1, maxCharges: 2, recharge: 8, rechargeLength: 8, recharges: [8] },
  };
  const hp = target.hp;
  sim.castAbility('red_harvest');
  const cast = sim.drainEvents();
  const opening = cast.filter((e) => e.type === 'spellfx' && e.ability === 'red_harvest');
  expect(opening).toEqual([
    expect.objectContaining({ fx: 'selfCast', sourceId: p.id, targetId: target.id }),
  ]);
  // The opening cue precedes the strikes so the client starts the clip first.
  expect(cast.indexOf(opening[0])).toBeLessThan(cast.indexOf(damage(cast)[0]));
  const hits = damage(cast);
  expect(hits).toHaveLength(3);
  expect(hits.every((e) => e.amount > 0 && e.attackAnimationStarted === true)).toBe(true);
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(target.hp).toBeLessThan(hp);
  expect(p.resource).toBe(20);
  expect(p.gcdRemaining).toBeGreaterThan(0);
  // Cleaving Blows refund and the guaranteed Enrage land in the same tick.
  expect(p.abilityCharges.raging_gale.charges).toBe(2);
  expect(p.auras.filter((a) => a.kind === 'enrage')).toHaveLength(1);
  // No deferred delivery is left behind for a later tick.
  expect(sim.ctx.delayedEvents).toHaveLength(0);
  const after = target.hp;
  expect(damage(settle())).toEqual([]);
  expect(target.hp).toBe(after);
  expect(resolve).toHaveBeenCalledTimes(1);
});

it('cannot be escaped after the cast: a victim that dies or moves next tick was already hit', () => {
  const { sim, target, settle } = fixture();
  vi.spyOn(sim.ctx.rng, 'next').mockReturnValue(0.9);
  const hp = target.hp;
  sim.castAbility('red_harvest');
  expect(damage(sim.drainEvents())).toHaveLength(3);
  const dealt = hp - target.hp;
  expect(dealt).toBeGreaterThan(0);
  // Moving away or dying afterwards changes nothing: the strikes are already
  // resolved and paid for, and no later tick delivers or refunds anything.
  target.pos.z += 50;
  target.dead = true;
  // (rage keeps moving with combat and decay, so only the paid-and-delivered
  // shape is pinned here: no late strike and nothing queued to deliver later)
  expect(damage(settle())).toEqual([]);
  expect(sim.ctx.delayedEvents).toHaveLength(0);
});

it('stops after a lethal first strike without requiring a third damage event', () => {
  const { sim, p, target } = fixture();
  vi.spyOn(sim.ctx.rng, 'next').mockReturnValue(0.9);
  target.hp = 1;
  sim.castAbility('red_harvest');
  const hits = damage(sim.drainEvents());
  expect(hits).toHaveLength(1);
  expect(hits[0].attackAnimationStarted).toBe(true);
  expect(target.dead).toBe(true);
  expect(p.auras.filter((a) => a.kind === 'enrage')).toHaveLength(1);
});

it.each(['miss', 'dodge', 'parry'] as const)(
  'marks %s results as part of the started performance without restarting the gesture',
  (kind) => {
    const { sim, target } = fixture();
    const p = sim.player;
    p.hitBonus = 0;
    if (kind === 'parry') {
      target.kind = 'player';
      target.templateId = 'warrior';
      target.dodgeChance = 0;
      target.stats.str = 1_000;
      target.facing = Math.PI;
      vi.spyOn(sim.ctx, 'isHostileTo').mockReturnValue(true);
    }
    vi.spyOn(sim.ctx.rng, 'next').mockReturnValue(
      kind === 'miss' ? 0.001 : kind === 'dodge' ? 0.075 : 0.15,
    );
    sim.castAbility('red_harvest');
    const hits = damage(sim.drainEvents());
    expect(hits).toHaveLength(3);
    expect(hits.every((e) => e.kind === kind && e.attackAnimationStarted === true)).toBe(true);
  },
);

it('leaves every other weapon strike without the started-performance flag', () => {
  const { sim, p } = fixture();
  vi.spyOn(sim.ctx.rng, 'next').mockReturnValue(0.9);
  p.resource = 100;
  sim.castAbility('bloodthirst');
  const hits = sim
    .drainEvents()
    .filter((e): e is Extract<SimEvent, { type: 'damage' }> => e.type === 'damage');
  expect(hits.length).toBeGreaterThan(0);
  expect(hits.every((e) => e.attackAnimationStarted === undefined)).toBe(true);
});

it('repeats the same event trace and final state from the same seed', () => {
  function run() {
    const { sim, p, target, settle } = fixture();
    sim.castAbility('red_harvest');
    return {
      events: [...sim.drainEvents(), ...settle()],
      hp: target.hp,
      rage: p.resource,
      auras: p.auras,
      pending: sim.ctx.delayedEvents.length,
    };
  }
  expect(run()).toEqual(run());
});

it('lets the existing damage pipeline retain full immunity without inventing positive hits', () => {
  const { sim, target } = fixture();
  vi.spyOn(sim.ctx.rng, 'next').mockReturnValue(0.9);
  target.damageImmune = true;
  const hp = target.hp;
  sim.castAbility('red_harvest');
  expect(damage(sim.drainEvents()).filter((e) => e.amount > 0)).toEqual([]);
  expect(target.hp).toBe(hp);
});

it('keeps the committed victim: the strikes never follow a target change made after the cast', () => {
  const { sim, target } = fixture();
  vi.spyOn(sim.ctx.rng, 'next').mockReturnValue(0.9);
  const other: Entity = { ...target, id: target.id + 1, pos: { ...target.pos }, auras: [] };
  sim.ctx.addEntity(other);
  sim.castAbility('red_harvest');
  sim.targetEntity(other.id, sim.playerId);
  const hits = damage(sim.drainEvents());
  expect(hits).toHaveLength(3);
  expect(hits.every((e) => e.targetId === target.id)).toBe(true);
  expect(other.hp).toBe(other.maxHp);
});
