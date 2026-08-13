import { describe, expect, it } from 'vitest';
import { updatePlayerAutoAttack } from '../src/sim/combat/auto_attack';
import { warspiritCadence } from '../src/sim/combat/shaman_warspirit';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

const GALEHEART_ID = 'galeheart_weapon';
const STONEBOUND_ID = 'rockbiter_weapon';
const STORMCAST_ID = 'shaman_stormcast';
const STORMCAST_CHEAP_ID = 'shaman_stormcast_cheap';

function setup(seed = 2810): { sim: Sim; shaman: Entity; target: Entity } {
  const sim = new Sim({ seed, playerClass: 'shaman', noPlayer: true, autoEquip: true });
  const pid = sim.addPlayer('shaman', 'Cadence');
  sim.setPlayerLevel(20, pid);
  expect(sim.setSpec('enhancement', pid)).toBe(true);
  const shaman = sim.entities.get(pid);
  if (!shaman) throw new Error('missing Warspirit Shaman');
  shaman.resource = shaman.maxResource;

  const target = createMob(90_010, MOBS.forest_wolf, 20, {
    x: shaman.pos.x,
    y: shaman.pos.y,
    z: shaman.pos.z + 3,
  });
  target.hostile = true;
  target.hp = target.maxHp = 999_999;
  sim.entities.set(target.id, target);
  (sim as unknown as { rebucket(entity: Entity): void }).rebucket(target);
  sim.targetEntity(target.id, pid);
  shaman.facing = Math.atan2(target.pos.x - shaman.pos.x, target.pos.z - shaman.pos.z);
  sim.drainEvents();
  return { sim, shaman, target };
}

function castInstant(sim: Sim, shaman: Entity, abilityId: string): SimEvent[] {
  shaman.resource = shaman.maxResource;
  shaman.gcdRemaining = 0;
  sim.castAbility(abilityId, shaman.id);
  return sim.tick();
}

function landedSwing(sim: Sim, shaman: Entity, target: Entity): SimEvent[] {
  const events: SimEvent[] = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    const connected = (
      sim as unknown as {
        meleeSwing(
          attacker: Entity,
          defender: Entity,
          bonus: number,
          ability: string | null,
          opts: { cannotBeDodged: boolean },
        ): boolean;
      }
    ).meleeSwing(shaman, target, 0, null, { cannotBeDodged: true });
    events.push(...sim.drainEvents());
    if (connected) return events;
  }
  throw new Error('could not produce a landed melee swing');
}

function galeheartEchoes(events: readonly SimEvent[]): SimEvent[] {
  return events.filter(
    (event) =>
      event.type === 'damage' && event.kind === 'hit' && event.ability === 'Galeheart Echo',
  );
}

describe('Shaman v0.29 Warspirit', () => {
  it('triggers two non-recursive Galeheart echoes and one Stormcast every third landed step', () => {
    const { sim, shaman, target } = setup();
    castInstant(sim, shaman, GALEHEART_ID);

    const events = [
      ...landedSwing(sim, shaman, target),
      ...landedSwing(sim, shaman, target),
      ...landedSwing(sim, shaman, target),
    ];

    expect(galeheartEchoes(events)).toHaveLength(2);
    expect(shaman.auras.filter((aura) => aura.id === STORMCAST_ID)).toHaveLength(1);
    expect(shaman.auras.find((aura) => aura.id === STORMCAST_ID)?.duration).toBe(12);

    const next = landedSwing(sim, shaman, target);
    expect(galeheartEchoes(next)).toHaveLength(0);
  });

  it('lets Ancestral Strike add two steps but trigger at most one Galeheart event', () => {
    const { sim, shaman, target } = setup(2811);
    castInstant(sim, shaman, GALEHEART_ID);
    landedSwing(sim, shaman, target);

    const events = castInstant(sim, shaman, 'stormstrike');

    expect(galeheartEchoes(events)).toHaveLength(2);
    expect(shaman.auras.filter((aura) => aura.id === STORMCAST_ID)).toHaveLength(1);
  });

  it('spends Stormcast only after a successful eligible cast and halves its Mana cost', () => {
    const { sim, shaman, target } = setup(2812);
    castInstant(sim, shaman, STONEBOUND_ID);
    for (let step = 0; step < 3; step++) landedSwing(sim, shaman, target);
    const stormcast = shaman.auras.find((aura) => aura.id === STORMCAST_ID);
    expect(stormcast).toBeDefined();

    const definition = sim.resolvedAbility('healing_wave', shaman.id);
    expect(definition).toBeDefined();
    shaman.gcdRemaining = 0;
    const manaBefore = shaman.resource;
    sim.castAbility('healing_wave', shaman.id);

    expect(shaman.castingAbility).toBeNull();
    // The cast path has always CEILED a discounted cost (casting_lifecycle's
    // `Math.ceil(res.cost * cheap)`), which only showed once Mending Waters resolved to
    // an odd cost: the v0.31 healer rebalance moved it from 90 to 115, so half is 57.5
    // and the sim charges 58. Assert the ceiling, not an exact half, so the pin holds at
    // any cost parity.
    expect(manaBefore - shaman.resource).toBe(Math.ceil((definition?.cost ?? 0) * 0.5));
    expect(shaman.auras.some((aura) => aura.id === STORMCAST_ID)).toBe(false);
  });

  it('uses Stormcast for its instant half-cost spell without consuming Clearcasting', () => {
    const { sim, shaman, target } = setup(2816);
    castInstant(sim, shaman, STONEBOUND_ID);
    for (let step = 0; step < 3; step++) landedSwing(sim, shaman, target);
    shaman.auras.push({
      id: 'set_clearcasting',
      name: 'Clearcasting',
      kind: 'next_cast_free',
      value: 0,
      remaining: 12,
      duration: 12,
      sourceId: shaman.id,
      school: 'nature',
    });
    const definition = sim.resolvedAbility('healing_wave', shaman.id);
    if (!definition) throw new Error('missing Healing Wave');
    shaman.gcdRemaining = 0;
    const manaBefore = shaman.resource;

    sim.castAbility('healing_wave', shaman.id);

    expect(manaBefore - shaman.resource).toBe(Math.ceil(definition.cost * 0.5));
    expect(shaman.auras.some((aura) => aura.id === 'set_clearcasting')).toBe(true);
    expect(shaman.auras.some((aura) => aura.id === STORMCAST_ID)).toBe(false);
    expect(shaman.auras.some((aura) => aura.id === STORMCAST_CHEAP_ID)).toBe(false);
  });

  it('refunds both Stormcast components when an Arc Bolt projectile fizzles', () => {
    const { sim, shaman, target } = setup(2814);
    castInstant(sim, shaman, STONEBOUND_ID);
    for (let step = 0; step < 3; step++) landedSwing(sim, shaman, target);

    shaman.gcdRemaining = 0;
    shaman.resource = shaman.maxResource;
    sim.castAbility('lightning_bolt', shaman.id);
    expect(sim.ctx.pendingProjectiles).toHaveLength(1);
    expect(shaman.auras.some((aura) => aura.id === STORMCAST_ID)).toBe(false);
    expect(shaman.auras.some((aura) => aura.id === STORMCAST_CHEAP_ID)).toBe(false);

    target.dead = true;
    target.hp = 0;
    sim.tick();
    expect(shaman.auras.some((aura) => aura.id === STORMCAST_ID)).toBe(true);
    expect(shaman.auras.some((aura) => aura.id === STORMCAST_CHEAP_ID)).toBe(true);
  });

  it('advances the shared cadence from both real dual-wield auto attacks', () => {
    const { sim, shaman, target } = setup(2815);
    sim.addItem('training_mace', 1, shaman.id);
    sim.equipItem('training_mace', shaman.id);
    expect(shaman.dualWielding).toBe(true);
    expect(shaman.offhandWeapon).not.toBeNull();
    castInstant(sim, shaman, GALEHEART_ID);

    const meta = sim.meta(shaman.id);
    if (!meta) throw new Error('missing Warspirit metadata');
    sim.rng.next = () => 0.99;
    shaman.autoAttack = true;
    shaman.swingTimer = 0;
    shaman.offhandSwingTimer = 0;
    updatePlayerAutoAttack(sim.ctx, shaman, meta);

    const swings = sim
      .drainEvents()
      .filter(
        (event) =>
          event.type === 'damage' &&
          event.sourceId === shaman.id &&
          event.targetId === target.id &&
          event.ability === null &&
          event.kind === 'hit',
      );
    expect(swings).toHaveLength(2);
    expect(warspiritCadence(shaman)).toBe(2);
  });

  it('does not add the generic dual-wield miss penalty to its cadence weapons', () => {
    const { sim, shaman, target } = setup(2817);
    sim.addItem('training_mace', 1, shaman.id);
    sim.equipItem('training_mace', shaman.id);
    expect(shaman.dualWielding).toBe(true);
    castInstant(sim, shaman, GALEHEART_ID);

    const meta = sim.meta(shaman.id);
    if (!meta) throw new Error('missing Warspirit metadata');
    shaman.hitBonus = 0;
    sim.rng.next = () => 0.1;
    shaman.autoAttack = true;
    shaman.swingTimer = 0;
    shaman.offhandSwingTimer = 0;
    updatePlayerAutoAttack(sim.ctx, shaman, meta);

    const swingKinds = sim
      .drainEvents()
      .flatMap((event) =>
        event.type === 'damage' &&
        event.sourceId === shaman.id &&
        event.targetId === target.id &&
        event.ability === null
          ? [event.kind]
          : [],
      );
    expect(swingKinds).toEqual(['hit', 'hit']);
  });

  it('makes Stonebound an exclusive defensive posture and removes every rider on exit', () => {
    const { sim, shaman, target } = setup(2813);
    castInstant(sim, shaman, GALEHEART_ID);
    expect(shaman.auras.some((aura) => aura.id === GALEHEART_ID)).toBe(true);

    const baseArmor = (sim as unknown as { effectiveArmor(entity: Entity): number }).effectiveArmor(
      shaman,
    );
    castInstant(sim, shaman, STONEBOUND_ID);
    expect(shaman.auras.some((aura) => aura.id === GALEHEART_ID)).toBe(false);
    expect(shaman.auras.some((aura) => aura.id === STONEBOUND_ID)).toBe(true);
    expect(
      (sim as unknown as { effectiveArmor(entity: Entity): number }).effectiveArmor(shaman),
    ).toBeCloseTo(Math.round(baseArmor * 1.3), 5);

    castInstant(sim, shaman, 'earth_shock');
    for (let tick = 0; tick < 20 * 3; tick++) sim.tick();
    expect(target.forcedTargetId).toBe(shaman.id);
    expect(target.forcedTargetTimer).toBeGreaterThan(0);

    castInstant(sim, shaman, GALEHEART_ID);
    expect(shaman.auras.some((aura) => aura.id === STONEBOUND_ID)).toBe(false);
    expect(
      (sim as unknown as { effectiveArmor(entity: Entity): number }).effectiveArmor(shaman),
    ).toBeCloseTo(baseArmor, 5);
    expect(target.forcedTargetId).not.toBe(shaman.id);
    expect(target.forcedTargetTimer).toBe(0);
  });
});
