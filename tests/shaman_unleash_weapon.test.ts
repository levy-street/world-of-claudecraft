import { describe, expect, it } from 'vitest';
import { thunderCharges } from '../src/sim/combat/shaman_thundercall';
import {
  GALEHEART_UNLEASH_HASTE_ID,
  STONEBOUND_UNLEASH_GUARD_ID,
} from '../src/sim/combat/shaman_unleash_weapon';
import { warspiritCadence } from '../src/sim/combat/shaman_warspirit';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

type ShamanSpec = 'elemental' | 'enhancement' | 'restoration';

function place(sim: Sim, entity: Entity, x: number, z: number): void {
  entity.pos = sim.groundPos(x, z);
  entity.prevPos = { ...entity.pos };
  (sim as unknown as { rebucket(entity: Entity): void }).rebucket(entity);
}

function setup(spec: ShamanSpec, seed: number): { sim: Sim; shaman: Entity; target: Entity } {
  const sim = new Sim({ seed, playerClass: 'shaman', noPlayer: true });
  const pid = sim.addPlayer('shaman', 'Unleasher');
  sim.setPlayerLevel(20, pid);
  expect(sim.setSpec(spec, pid)).toBe(true);
  const shaman = sim.entities.get(pid);
  if (!shaman) throw new Error('missing Shaman');
  shaman.resource = shaman.maxResource;
  place(sim, shaman, 720, 0);

  const target = createMob(91_040 + seed, MOBS.forest_wolf, 20, sim.groundPos(722, 0));
  target.hostile = true;
  target.hp = target.maxHp = 100_000;
  sim.entities.set(target.id, target);
  sim.targetEntity(target.id, pid);
  sim.drainEvents();
  return { sim, shaman, target };
}

function castInstant(sim: Sim, shaman: Entity, abilityId: string): SimEvent[] {
  shaman.resource = shaman.maxResource;
  shaman.gcdRemaining = 0;
  sim.castAbility(abilityId, shaman.id);
  return sim.drainEvents();
}

describe('Shaman Unleash Weapon', () => {
  it('is known by all three specializations but requires a supported weapon enchant', () => {
    for (const [index, spec] of (['elemental', 'enhancement', 'restoration'] as const).entries()) {
      const { sim, shaman } = setup(spec, 2900 + index);
      expect(sim.resolvedAbility('unleash_weapon', shaman.id)).toBeDefined();
      const manaBefore = shaman.resource;

      const events = castInstant(sim, shaman, 'unleash_weapon');

      expect(shaman.resource).toBe(manaBefore);
      expect(shaman.cooldowns.has('unleash_weapon')).toBe(false);
      expect(events).toContainEqual({
        type: 'error',
        text: 'That ability is not ready yet.',
        pid: shaman.id,
      });
    }
  });

  it('unleashes Pyrebrand into Fire damage and 2 Thunder', () => {
    const { sim, shaman, target } = setup('elemental', 2903);
    castInstant(sim, shaman, 'flametongue_weapon');
    sim.rng.next = () => 0.5;

    const events = castInstant(sim, shaman, 'unleash_weapon');
    expect(
      events.some(
        (event) =>
          event.type === 'damage' &&
          event.sourceId === shaman.id &&
          event.targetId === target.id &&
          event.school === 'fire' &&
          event.ability === 'Unleash Weapon' &&
          event.amount > 0,
      ),
    ).toBe(true);
    expect(thunderCharges(shaman)).toBe(2);
  });

  it('unleashes Galeheart into a weapon strike, cadence, and attack speed', () => {
    const { sim, shaman, target } = setup('enhancement', 2904);
    castInstant(sim, shaman, 'galeheart_weapon');
    sim.rng.next = () => 0.5;

    const events = castInstant(sim, shaman, 'unleash_weapon');
    expect(
      events.some(
        (event) =>
          event.type === 'damage' &&
          event.sourceId === shaman.id &&
          event.targetId === target.id &&
          event.ability === 'Unleash Weapon' &&
          event.amount > 0,
      ),
    ).toBe(true);
    expect(warspiritCadence(shaman)).toBe(1);
    expect(shaman.auras.find((aura) => aura.id === GALEHEART_UNLEASH_HASTE_ID)).toMatchObject({
      kind: 'buff_haste',
      value: 1.2,
      duration: 6,
    });
  });

  it('unleashes Stonebound into a forced target and short guard', () => {
    const { sim, shaman, target } = setup('enhancement', 2905);
    castInstant(sim, shaman, 'rockbiter_weapon');
    sim.rng.next = () => 0.5;

    castInstant(sim, shaman, 'unleash_weapon');

    expect(target.forcedTargetId).toBe(shaman.id);
    expect(shaman.auras.find((aura) => aura.id === STONEBOUND_UNLEASH_GUARD_ID)).toMatchObject({
      kind: 'buff_dr',
      value: 0.2,
      duration: 4,
    });
  });
});
