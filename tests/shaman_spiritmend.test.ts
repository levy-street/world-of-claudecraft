import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity, SimEvent } from '../src/sim/types';

const MENDING_CURRENT_ID = 'shaman_mending_current';

interface SpiritmendSetup {
  sim: Sim;
  healer: Entity;
  healerId: number;
  ally: Entity;
  allyId: number;
  secondAlly: Entity;
  secondAllyId: number;
}

function place(sim: Sim, entity: Entity, x: number, z: number): void {
  entity.pos = sim.groundPos(x, z);
  entity.prevPos = { ...entity.pos };
  (sim as unknown as { rebucket(entity: Entity): void }).rebucket(entity);
}

function setup(seed = 2820): SpiritmendSetup {
  const sim = new Sim({ seed, playerClass: 'shaman', noPlayer: true });
  const healerId = sim.addPlayer('shaman', 'Currentkeeper');
  const allyId = sim.addPlayer('warrior', 'Riverstone');
  const secondAllyId = sim.addPlayer('mage', 'Reed');
  for (const pid of [healerId, allyId, secondAllyId]) sim.setPlayerLevel(20, pid);
  expect(sim.setSpec('restoration', healerId)).toBe(true);

  const healer = sim.entities.get(healerId);
  const ally = sim.entities.get(allyId);
  const secondAlly = sim.entities.get(secondAllyId);
  if (!healer || !ally || !secondAlly) throw new Error('missing Spiritmend party member');
  place(sim, healer, 720, 0);
  place(sim, ally, 724, 0);
  place(sim, secondAlly, 728, 0);
  healer.resource = healer.maxResource;
  ally.hp = Math.round(ally.maxHp * 0.35);
  secondAlly.hp = Math.round(secondAlly.maxHp * 0.3);
  sim.drainEvents();
  return { sim, healer, healerId, ally, allyId, secondAlly, secondAllyId };
}

function currentFor(entity: Entity, sourceId: number): Aura | undefined {
  return entity.auras.find((aura) => aura.id === MENDING_CURRENT_ID && aura.sourceId === sourceId);
}

function seedCurrent(entity: Entity, sourceId: number, amount: number): void {
  entity.auras.push({
    id: MENDING_CURRENT_ID,
    name: 'Mending Current',
    kind: 'hot',
    remaining: 12,
    duration: 12,
    value: amount,
    tickInterval: 3,
    tickTimer: 3,
    sourceId,
    school: 'nature',
  });
}

function castAndResolve(
  sim: Sim,
  healer: Entity,
  abilityId: string,
  targetId: number,
  seconds = 5,
): SimEvent[] {
  healer.resource = healer.maxResource;
  healer.gcdRemaining = 0;
  sim.targetEntity(targetId, healer.id);
  sim.castAbility(abilityId, healer.id);
  const events: SimEvent[] = [];
  for (let tick = 0; tick < 20 * seconds; tick++) events.push(...sim.tick());
  return events;
}

function healingFor(events: readonly SimEvent[], sourceId: number, targetId: number): number {
  let total = 0;
  for (const event of events) {
    if (event.type === 'heal2' && event.sourceId === sourceId && event.targetId === targetId) {
      total += event.amount;
    }
  }
  return total;
}

describe('Shaman v0.29 Spiritmend', () => {
  it('creates, enlarges, refreshes, and caps one owner-scoped Mending Current', () => {
    const { sim, healer, healerId, ally, allyId } = setup();
    castAndResolve(sim, healer, 'healing_wave', allyId);
    const first = currentFor(ally, healerId);
    expect(first).toBeDefined();
    expect(first?.duration).toBe(12);
    expect(first?.value).toBeGreaterThan(0);

    const firstAmount = first?.value ?? 0;
    castAndResolve(sim, healer, 'healing_wave', allyId);
    const owned = ally.auras.filter(
      (aura) => aura.id === MENDING_CURRENT_ID && aura.sourceId === healerId,
    );
    expect(owned).toHaveLength(1);
    expect(owned[0].value).toBeGreaterThan(firstAmount);
    expect(owned[0].value).toBeLessThanOrEqual(ally.maxHp * 0.3);
    // The helper continues ticking after the cast resolves; a refreshed
    // 12-second pool should still retain roughly nine seconds here.
    expect(owned[0].remaining).toBeGreaterThan(9);
  });

  it('ticks healing out of the same stored pool without an expiry burst', () => {
    const { sim, healerId, ally } = setup(2821);
    ally.hp = Math.round(ally.maxHp * 0.2);
    seedCurrent(ally, healerId, 300);

    const tickEvents: SimEvent[] = [];
    for (let tick = 0; tick < 20 * 3; tick++) tickEvents.push(...sim.tick());
    const remaining = currentFor(ally, healerId)?.value;
    expect(healingFor(tickEvents, healerId, ally.id)).toBeGreaterThan(0);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThan(300);

    const beforeExpiry = ally.hp;
    const expiryEvents: SimEvent[] = [];
    for (let tick = 0; tick < 20 * 10; tick++) expiryEvents.push(...sim.tick());
    expect(currentFor(ally, healerId)).toBeUndefined();
    expect(healingFor(expiryEvents.slice(-1), healerId, ally.id)).toBe(0);
    expect(ally.hp).toBeGreaterThanOrEqual(beforeExpiry);
  });

  it('gives Tidecall two recharging instant uses and preserves them on an invalid cast', () => {
    const { sim, healer, allyId } = setup(2822);
    expect(sim.resolvedAbility('tidecall', healer.id)).toMatchObject({
      castTime: 0,
      charges: 2,
      cooldown: 12,
    });

    castAndResolve(sim, healer, 'tidecall', allyId, 1);
    expect(healer.abilityCharges?.tidecall).toMatchObject({
      charges: 1,
      maxCharges: 2,
      rechargeLength: 12,
    });

    const stateBefore = structuredClone(healer.abilityCharges?.tidecall);
    const manaBefore = healer.resource;
    place(sim, sim.entities.get(allyId) as Entity, 720, 100);
    sim.castAbility('tidecall', healer.id);
    expect(healer.abilityCharges?.tidecall).toEqual(stateBefore);
    expect(healer.resource).toBe(manaBefore);
  });

  it('makes Lifespring increase deposits without changing Tidecall charge count', () => {
    const baseline = setup(2823);
    castAndResolve(baseline.sim, baseline.healer, 'healing_wave', baseline.allyId);
    const baselineDeposit = currentFor(baseline.ally, baseline.healerId)?.value ?? 0;

    const enhanced = setup(2823);
    castAndResolve(enhanced.sim, enhanced.healer, 'lifespring_weapon', enhanced.healerId, 1);
    castAndResolve(enhanced.sim, enhanced.healer, 'healing_wave', enhanced.allyId);
    const enhancedDeposit = currentFor(enhanced.ally, enhanced.healerId)?.value ?? 0;

    expect(enhancedDeposit).toBeGreaterThan(baselineDeposit);
    expect(enhanced.sim.resolvedAbility('tidecall', enhanced.healerId)?.charges).toBe(2);
  });

  it("consumes every reached owned pool once while preserving another Shaman's pool", () => {
    const { sim, healer, healerId, ally, allyId, secondAlly } = setup(2824);
    const otherId = sim.addPlayer('shaman', 'Othercurrent');
    sim.setPlayerLevel(20, otherId);
    sim.setSpec('restoration', otherId);
    const other = sim.entities.get(otherId);
    if (!other) throw new Error('missing second Spiritmend Shaman');
    place(sim, other, 760, 0);

    seedCurrent(healer, healerId, 120);
    seedCurrent(ally, healerId, 160);
    seedCurrent(secondAlly, healerId, 140);
    seedCurrent(ally, otherId, 180);

    const events = castAndResolve(sim, healer, 'chain_heal', allyId);

    expect(currentFor(healer, healerId)).toBeUndefined();
    expect(currentFor(ally, healerId)).toBeUndefined();
    expect(currentFor(secondAlly, healerId)).toBeUndefined();
    // The other healer's pool continues ticking normally, but is not consumed.
    expect(currentFor(ally, otherId)?.value).toBeGreaterThan(0);
    expect(
      events.filter(
        (event) =>
          event.type === 'heal2' &&
          event.sourceId === healerId &&
          event.ability === 'Mending Current',
      ),
    ).toHaveLength(3);
  });

  it('keeps canonical Cascading Mend useful on an unprepared ally', () => {
    const { sim, healer, healerId, allyId } = setup(2825);
    const events = castAndResolve(sim, healer, 'chain_heal', allyId);

    expect(healingFor(events, healerId, allyId)).toBeGreaterThan(0);
  });

  it('unleashes one owned Mending Current into a burst and one-hit guard', () => {
    const { sim, healer, healerId, ally, allyId } = setup(2826);
    castAndResolve(sim, healer, 'lifespring_weapon', healerId, 1);
    ally.hp = ally.maxHp - 300;
    seedCurrent(ally, healerId, 200);

    const events = castAndResolve(sim, healer, 'unleash_weapon', allyId, 1);

    expect(currentFor(ally, healerId)).toBeUndefined();
    expect(healingFor(events, healerId, allyId)).toBe(250);
    const guard = ally.auras.find((aura) => aura.id === 'unleash_weapon' && aura.kind === 'absorb');
    expect(guard?.value).toBe(125);

    const beforeHit = ally.hp;
    sim.ctx.dealDamage(null, ally, 175, false, 'physical', 'Test Hit', 'hit');
    expect(ally.hp).toBe(beforeHit - 50);
    expect(ally.auras.some((aura) => aura.id === 'unleash_weapon' && aura.kind === 'absorb')).toBe(
      false,
    );
  });

  it('bases the one-hit guard on effective healing and refuses an empty unleash', () => {
    const { sim, healer, healerId, ally, allyId } = setup(2827);
    castAndResolve(sim, healer, 'lifespring_weapon', healerId, 1);
    ally.hp = ally.maxHp - 40;
    seedCurrent(ally, healerId, 200);

    castAndResolve(sim, healer, 'unleash_weapon', allyId, 1);

    const guard = ally.auras.find((aura) => aura.id === 'unleash_weapon' && aura.kind === 'absorb');
    expect(guard?.value).toBe(20);

    healer.resource = healer.maxResource;
    healer.gcdRemaining = 0;
    healer.cooldowns.delete('unleash_weapon');
    sim.targetEntity(allyId, healerId);
    sim.drainEvents();
    const manaBefore = healer.resource;
    sim.castAbility('unleash_weapon', healerId);
    expect(healer.resource).toBe(manaBefore);
    expect(healer.cooldowns.has('unleash_weapon')).toBe(false);
    expect(sim.drainEvents()).toContainEqual({
      type: 'error',
      text: 'That ability is not ready yet.',
      pid: healerId,
    });
  });
});
