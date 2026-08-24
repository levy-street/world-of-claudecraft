import { describe, expect, it } from 'vitest';
import { addThunderCharges, thunderCharges } from '../src/sim/combat/shaman_thundercall';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

function classSim(playerClass: 'mage' | 'shaman', spec: 'fire' | 'elemental'): Sim {
  const sim = new Sim({
    seed: 7641,
    playerClass,
    autoEquip: true,
    world: EMPTY_TEST_WORLD,
    playerDirectionalCombat: true,
  });
  sim.setPlayerLevel(20);
  expect(sim.setSpec(spec)).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.spellPower = 0;
  sim.drainEvents();
  return sim;
}

function addDummy(sim: Sim, id: number, x: number, z: number): Entity {
  const mob = createMob(id, MOBS.training_dummy, 20, { x, y: sim.player.pos.y, z });
  mob.hostile = true;
  mob.hp = mob.maxHp = 100_000;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  return mob;
}

function damageEvents(sim: Sim, ability: string): Extract<SimEvent, { type: 'damage' }>[] {
  return sim
    .drainEvents()
    .filter(
      (event): event is Extract<SimEvent, { type: 'damage' }> =>
        event.type === 'damage' && event.ability === ability && event.amount > 0,
    );
}

function advance(sim: Sim, seconds: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let tick = 0; tick < Math.ceil(seconds * 20); tick++) events.push(...sim.tick());
  return events;
}

describe('aimed target-born impact areas', () => {
  it('keeps Cinderfall authored effects, caps five nearest targets, and announces its old VFX at the point', () => {
    const sim = classSim('mage', 'fire');
    const p = sim.player;
    const center = { x: p.pos.x, z: p.pos.z + 12 };
    const dummies = [
      addDummy(sim, 76_401, center.x, center.z),
      addDummy(sim, 76_402, center.x + 1, center.z),
      addDummy(sim, 76_403, center.x - 1, center.z),
      addDummy(sim, 76_404, center.x, center.z + 2),
      addDummy(sim, 76_405, center.x, center.z - 2),
      addDummy(sim, 76_406, center.x + 2.5, center.z),
    ];

    const manaBefore = p.resource;
    sim.castAbilityAt('fire_blast', center);
    const events = sim.drainEvents();
    const hits = events.filter(
      (event): event is Extract<SimEvent, { type: 'damage' }> =>
        event.type === 'damage' && event.ability === 'Cinderfall' && event.amount > 0,
    );

    expect(hits).toHaveLength(5);
    expect(dummies.slice(0, 5).every((dummy) => dummy.hp < dummy.maxHp)).toBe(true);
    expect(dummies[5].hp).toBe(dummies[5].maxHp);
    expect(p.resource).toBe(manaBefore - 85);
    expect(p.targetId).toBe(dummies[0].id);
    expect(p.auras.some((aura) => aura.id === 'heating_up')).toBe(true);
    expect(p.auras.some((aura) => aura.id === 'hot_streak')).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'spellfxAt',
        fx: 'nova',
        ability: 'fire_blast',
        x: center.x,
        z: center.z,
        radius: 3,
      }),
    );
  });

  it('allows an empty area cast to miss while still paying its cost and cooldown', () => {
    const sim = classSim('mage', 'fire');
    const p = sim.player;
    const manaBefore = p.resource;
    const selected = addDummy(sim, 76_410, p.pos.x, p.pos.z + 5);
    sim.targetEntity(selected.id);

    sim.castAbilityAt('fire_blast', { x: p.pos.x, z: p.pos.z + 20 });

    expect(selected.hp).toBe(selected.maxHp);
    expect(p.resource).toBe(manaBefore - 85);
    expect(p.abilityCharges?.fire_blast?.charges).toBe(2);
    expect(p.abilityCharges?.fire_blast?.recharge).toBeGreaterThan(0);
    expect(p.targetId).toBe(selected.id);
    expect(damageEvents(sim, 'Cinderfall')).toHaveLength(0);
  });

  it('snapshots one full Thunder vent across Earthen Jolt targets and consumes it once', () => {
    const sim = classSim('shaman', 'elemental');
    const p = sim.player;
    const center = { x: p.pos.x, z: p.pos.z + 10 };
    const primary = addDummy(sim, 76_420, center.x, center.z);
    const secondary = addDummy(sim, 76_421, center.x + 2, center.z);
    addThunderCharges(sim.ctx, p, 5);
    sim.drainEvents();

    sim.castAbilityAt('earth_shock', center);
    const hits = damageEvents(sim, 'Earthen Jolt');

    expect(hits).toHaveLength(2);
    expect(hits.every((hit) => hit.amount > 61)).toBe(true);
    expect(primary.hp).toBeLessThan(primary.maxHp);
    expect(secondary.hp).toBeLessThan(secondary.maxHp);
    expect(thunderCharges(p)).toBe(0);
    expect(p.cooldowns.get('earth_shock')).toBeGreaterThan(0);
  });
});

describe('authored non-projectile contacts', () => {
  it('lands Cinder Jolt as its authored target-born DoT instead of a green projectile', () => {
    const sim = classSim('shaman', 'elemental');
    const p = sim.player;
    const target = addDummy(sim, 76_430, p.pos.x, p.pos.z + 10);

    sim.castAbilityToward('flame_shock', { x: target.pos.x, z: target.pos.z });
    const events = sim.drainEvents();

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        fx: 'impact',
        ability: 'flame_shock',
        targetId: target.id,
      }),
    );
    expect(events.some((event) => event.type === 'projectileLaunch')).toBe(false);
    expect(target.auras.some((aura) => aura.id === 'flame_shock')).toBe(true);
  });

  it('uses one authored Skybranch impact plus lightning arcs for its hops', () => {
    const sim = classSim('shaman', 'elemental');
    const p = sim.player;
    const primary = addDummy(sim, 76_440, p.pos.x, p.pos.z + 10);
    addDummy(sim, 76_441, p.pos.x + 2, p.pos.z + 10);
    sim.drainEvents();

    sim.castAbilityToward('chain_lightning', { x: primary.pos.x, z: primary.pos.z });
    const events = [...sim.drainEvents(), ...advance(sim, 3)];

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        fx: 'impact',
        ability: 'chain_lightning',
        targetId: primary.id,
      }),
    );
    expect(
      events.filter(
        (event): event is Extract<SimEvent, { type: 'spellfx' }> =>
          event.type === 'spellfx' && event.fx === 'lightning',
      ).length,
    ).toBeGreaterThanOrEqual(2);
    expect(events.some((event) => event.type === 'projectileLaunch')).toBe(false);
  });
});
