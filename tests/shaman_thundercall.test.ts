import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity, SimEvent } from '../src/sim/types';

const THUNDER_CHARGES_ID = 'shaman_thunder_charges';

function place(sim: Sim, entity: Entity, x: number, z: number): void {
  entity.pos = sim.groundPos(x, z);
  entity.prevPos = { ...entity.pos };
  (sim as unknown as { rebucket(entity: Entity): void }).rebucket(entity);
}

function setup(seed = 2801): { sim: Sim; shaman: Entity; target: Entity } {
  const sim = new Sim({ seed, playerClass: 'shaman', noPlayer: true });
  const pid = sim.addPlayer('shaman', 'Stormbank');
  sim.setPlayerLevel(20, pid);
  expect(sim.setSpec('elemental', pid)).toBe(true);
  const shaman = sim.entities.get(pid);
  if (!shaman) throw new Error('missing Thundercall Shaman');
  shaman.resource = shaman.maxResource;
  place(sim, shaman, 700, 0);

  const target = createMob(90_001, MOBS.training_dummy, 20, sim.groundPos(700, 12));
  target.hostile = true;
  target.hp = target.maxHp = 999_999;
  sim.entities.set(target.id, target);
  (sim as unknown as { rebucket(entity: Entity): void }).rebucket(target);
  sim.targetEntity(target.id, pid);
  shaman.facing = Math.atan2(target.pos.x - shaman.pos.x, target.pos.z - shaman.pos.z);
  sim.drainEvents();
  return { sim, shaman, target };
}

function thunderBank(entity: Entity): Aura | undefined {
  return entity.auras.find((aura) => aura.id === THUNDER_CHARGES_ID);
}

function seedThunderBank(entity: Entity, stacks: number): void {
  entity.auras.push({
    id: THUNDER_CHARGES_ID,
    name: 'Thunder Charges',
    kind: 'internal_cd',
    remaining: 3600,
    duration: 3600,
    value: 0,
    stacks,
    sourceId: entity.id,
    school: 'nature',
  });
}

function resolveCast(sim: Sim, ticks = 20 * 5): SimEvent[] {
  const events: SimEvent[] = [];
  for (let tick = 0; tick < ticks; tick++) events.push(...sim.tick());
  return events;
}

function castArcBolt(sim: Sim, shaman: Entity): SimEvent[] {
  shaman.resource = shaman.maxResource;
  shaman.gcdRemaining = 0;
  sim.castAbility('lightning_bolt', shaman.id);
  return resolveCast(sim);
}

function earthenJoltDamage(
  events: readonly SimEvent[],
  sourceId: number,
  targetId: number,
): number {
  let total = 0;
  for (const event of events) {
    if (
      event.type === 'damage' &&
      event.sourceId === sourceId &&
      event.targetId === targetId &&
      event.ability === 'Earthen Jolt' &&
      event.kind === 'hit'
    ) {
      total += event.amount;
    }
  }
  return total;
}

describe('Shaman v0.28 Thundercall', () => {
  it('builds one offensive charge on a valid Arc Bolt impact without changing Ward charges', () => {
    const { sim, shaman } = setup();
    sim.castAbility('lightning_shield', shaman.id);
    sim.tick();
    const ward = shaman.auras.find((aura) => aura.id === 'lightning_shield');
    expect(ward?.charges).toBe(3);

    castArcBolt(sim, shaman);

    expect(thunderBank(shaman)?.stacks).toBe(1);
    expect(ward?.charges).toBe(3);
  });

  it('grants no charge when an Arc Bolt target dies before impact and caps valid impacts at five', () => {
    const invalid = setup(2802);
    invalid.shaman.resource = invalid.shaman.maxResource;
    invalid.sim.castAbility('lightning_bolt', invalid.shaman.id);
    for (let tick = 0; tick < 20 * 4; tick++) {
      invalid.sim.tick();
      if (invalid.sim.ctx.pendingProjectiles.length > 0) break;
    }
    expect(invalid.sim.ctx.pendingProjectiles.length).toBeGreaterThan(0);
    invalid.target.dead = true;
    invalid.target.hp = 0;
    invalid.sim.tick();
    expect(thunderBank(invalid.shaman)).toBeUndefined();

    const valid = setup(2803);
    for (let cast = 0; cast < 6; cast++) castArcBolt(valid.sim, valid.shaman);
    expect(thunderBank(valid.shaman)?.stacks).toBe(5);
  });

  it('vents Earthen Jolt for concentrated damage and consumes only after success', () => {
    const plain = setup(2804);
    plain.sim.castAbility('earth_shock', plain.shaman.id);
    const plainDamage = earthenJoltDamage(resolveCast(plain.sim), plain.shaman.id, plain.target.id);

    const charged = setup(2804);
    seedThunderBank(charged.shaman, 4);
    charged.sim.castAbility('earth_shock', charged.shaman.id);
    const chargedDamage = earthenJoltDamage(
      resolveCast(charged.sim),
      charged.shaman.id,
      charged.target.id,
    );

    expect(chargedDamage).toBeGreaterThan(plainDamage * 1.8);
    expect(thunderBank(charged.shaman)).toBeUndefined();

    const failed = setup(2805);
    seedThunderBank(failed.shaman, 3);
    place(failed.sim, failed.target, 700, 100);
    const manaBefore = failed.shaman.resource;
    failed.sim.castAbility('earth_shock', failed.shaman.id);
    expect(thunderBank(failed.shaman)?.stacks).toBe(3);
    expect(failed.shaman.resource).toBe(manaBefore);
  });

  it('vents Faultwake at the selected target with deterministic area state', () => {
    const run = () => {
      const { sim, shaman, target } = setup(2806);
      seedThunderBank(shaman, 5);
      sim.castAbility('earthquake', shaman.id);
      const zone = sim.ctx.groundAoEs.find((effect) => effect.sourceId === shaman.id);
      return {
        bank: thunderBank(shaman)?.stacks ?? 0,
        zone: zone ? { x: zone.pos.x, z: zone.pos.z, radius: zone.radius } : null,
        target: { x: target.pos.x, z: target.pos.z },
      };
    };

    const first = run();
    expect(first.bank).toBe(0);
    expect(first.zone).toMatchObject({ x: first.target.x, z: first.target.z, radius: 8 });
    expect(run()).toEqual(first);
  });

  it('uses Primal Mastery to accelerate the same builder and vent loop', () => {
    const { sim, shaman } = setup(2807);
    expect(sim.resolvedAbility('elemental_mastery', shaman.id)?.cooldown).toBe(90);
    sim.castAbility('elemental_mastery', shaman.id);
    const mastery = shaman.auras.find((aura) => aura.id === 'elemental_mastery');
    expect(mastery?.duration).toBe(12);

    shaman.gcdRemaining = 0;
    shaman.resource = shaman.maxResource;
    sim.castAbility('lightning_bolt', shaman.id);
    expect(shaman.castingAbility).toBeNull();
    resolveCast(sim);
    expect(thunderBank(shaman)?.stacks).toBe(2);
  });
});
