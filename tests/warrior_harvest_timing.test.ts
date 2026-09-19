import { afterEach, expect, it, vi } from 'vitest';
import { RED_HARVEST_IMPACT_DELAY } from '../src/sim/combat/warrior_harvest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { drainDelayedEvents } from '../src/sim/entity_roster';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type SimEvent } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

afterEach(() => vi.restoreAllMocks());

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
  const at = (time: number) => {
    sim.time = time;
    drainDelayedEvents(sim.ctx);
    return sim.drainEvents();
  };
  return { sim, p, target, at };
}

function damage(events: SimEvent[]) {
  return events.filter(
    (e): e is Extract<SimEvent, { type: 'damage' }> =>
      e.type === 'damage' && e.ability === 'Red Harvest',
  );
}

it('spends once, opens immediately and delivers exactly one three-hit batch at the deadline', () => {
  const { sim, p, target, at } = fixture();
  vi.spyOn(sim.ctx.rng, 'next').mockReturnValue(0.9);
  const resolve = vi.spyOn(sim.ctx, 'runEffects');
  p.abilityCharges = {
    ...p.abilityCharges,
    raging_gale: { charges: 1, maxCharges: 2, recharge: 8, rechargeLength: 8, recharges: [8] },
  };
  sim.castAbility('red_harvest');
  const start = sim.drainEvents();
  expect(damage(start)).toEqual([]);
  expect(start.filter((e) => e.type === 'spellfx' && e.ability === 'red_harvest')).toEqual([
    expect.objectContaining({ fx: 'selfCast', sourceId: p.id, targetId: target.id }),
  ]);
  expect(p.resource).toBe(20);
  expect(p.gcdRemaining).toBeGreaterThan(0);
  expect(p.abilityCharges.raging_gale.charges).toBe(1);
  expect(p.auras.some((a) => a.kind === 'enrage')).toBe(false);
  const hp = target.hp;
  expect(damage(at(RED_HARVEST_IMPACT_DELAY - 0.00001))).toEqual([]);
  expect(target.hp).toBe(hp);
  expect(resolve).not.toHaveBeenCalled();
  const hits = damage(at(RED_HARVEST_IMPACT_DELAY));
  expect(hits).toHaveLength(3);
  expect(hits.every((e) => e.amount > 0 && e.attackAnimationStarted === true)).toBe(true);
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(target.hp).toBeLessThan(hp);
  expect(p.abilityCharges.raging_gale.charges).toBe(2);
  expect(p.auras.filter((a) => a.kind === 'enrage')).toHaveLength(1);
  const after = target.hp;
  expect(damage(at(2))).toEqual([]);
  expect(target.hp).toBe(after);
  expect(resolve).toHaveBeenCalledTimes(1);
});

it.each([
  'source-death',
  'target-death',
  'source-removed',
  'target-replaced',
  'metadata-removed',
  'friendly',
  'range',
  'line-of-sight',
] as const)('cancels without damage or rolls on %s', (reason) => {
  const { sim, p, target, at } = fixture();
  sim.castAbility('red_harvest');
  sim.drainEvents();
  if (reason === 'source-death') p.dead = true;
  if (reason === 'target-death') target.dead = true;
  if (reason === 'source-removed') sim.entities.delete(p.id);
  if (reason === 'target-replaced') sim.entities.set(target.id, { ...target });
  if (reason === 'metadata-removed') sim.ctx.players.delete(p.id);
  if (reason === 'friendly') vi.spyOn(sim.ctx, 'isHostileTo').mockReturnValue(false);
  if (reason === 'range') target.pos.z += 50;
  if (reason === 'line-of-sight') vi.spyOn(sim.ctx, 'lineOfSightBlocked').mockReturnValue(true);
  const rolls = vi.spyOn(sim.ctx.rng, 'next');
  const resolve = vi.spyOn(sim.ctx, 'runEffects');
  expect(damage(at(RED_HARVEST_IMPACT_DELAY))).toEqual([]);
  expect(resolve).not.toHaveBeenCalled();
  expect(rolls).not.toHaveBeenCalled();
  expect(p.resource).toBe(20);
  expect(sim.ctx.delayedEvents).toHaveLength(0);
});

it('keeps the committed victim when the player selects another target', () => {
  const { sim, target, at } = fixture();
  vi.spyOn(sim.ctx.rng, 'next').mockReturnValue(0.9);
  sim.castAbility('red_harvest');
  const other: Entity = { ...target, id: target.id + 1, pos: { ...target.pos }, auras: [] };
  sim.ctx.addEntity(other);
  sim.targetEntity(other.id, sim.playerId);
  const hits = damage(at(RED_HARVEST_IMPACT_DELAY));
  expect(hits).toHaveLength(3);
  expect(hits.every((e) => e.targetId === target.id)).toBe(true);
  expect(other.hp).toBe(other.maxHp);
});

it('stops after a lethal first strike without requiring a third damage event', () => {
  const { sim, p, target, at } = fixture();
  vi.spyOn(sim.ctx.rng, 'next').mockReturnValue(0.9);
  target.hp = 1;
  sim.castAbility('red_harvest');
  expect(target.dead).toBe(false);
  const hits = damage(at(RED_HARVEST_IMPACT_DELAY));
  expect(hits).toHaveLength(1);
  expect(hits[0].attackAnimationStarted).toBe(true);
  expect(target.dead).toBe(true);
  expect(p.auras.filter((a) => a.kind === 'enrage')).toHaveLength(1);
  expect(damage(at(1))).toEqual([]);
});

it.each(['miss', 'dodge', 'parry'] as const)(
  'marks delayed %s results without restarting the gesture',
  (kind) => {
    const { sim, p, target, at } = fixture();
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
    const hits = damage(at(RED_HARVEST_IMPACT_DELAY));
    expect(hits).toHaveLength(3);
    expect(hits.every((e) => e.kind === kind && e.attackAnimationStarted === true)).toBe(true);
  },
);

it('repeats the same event trace and final state from the same seed', () => {
  function run() {
    const { sim, p, target, at } = fixture();
    sim.castAbility('red_harvest');
    return {
      events: [...sim.drainEvents(), ...at(0.5)],
      hp: target.hp,
      rage: p.resource,
      auras: p.auras,
      pending: sim.ctx.delayedEvents.length,
    };
  }
  expect(run()).toEqual(run());
});

it('does not slip one tick when the real 20 Hz clock accumulates fractional seconds', () => {
  const { sim, at } = fixture();
  vi.spyOn(sim.ctx.rng, 'next').mockReturnValue(0.9);
  sim.castAbility('red_harvest');
  for (let tick = 1; tick < 10; tick++) expect(damage(at(sim.time + DT))).toEqual([]);
  expect(damage(at(sim.time + DT))).toHaveLength(3);
});

it('lets the existing damage pipeline retain full immunity without inventing positive hits', () => {
  const { sim, target, at } = fixture();
  vi.spyOn(sim.ctx.rng, 'next').mockReturnValue(0.9);
  sim.castAbility('red_harvest');
  target.damageImmune = true;
  const hp = target.hp;
  expect(damage(at(RED_HARVEST_IMPACT_DELAY)).filter((e) => e.amount > 0)).toEqual([]);
  expect(target.hp).toBe(hp);
  expect(sim.ctx.delayedEvents).toHaveLength(0);
});
