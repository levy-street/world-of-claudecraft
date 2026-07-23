import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

type TestSim = Sim & {
  addEntity(entity: Entity): void;
  nextId: number;
};

function makeHunter(rows: Record<number, string> = {}): TestSim {
  const sim = new Sim({ seed: 2614, playerClass: 'hunter', autoEquip: false }) as TestSim;
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec: null, rows })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  return sim;
}

function addPet(sim: TestSim, ownerId: number, hp = 500): Entity {
  const owner = sim.entities.get(ownerId);
  if (!owner) throw new Error(`missing pet owner ${ownerId}`);
  const pet = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: owner.pos.x + 2,
    y: owner.pos.y,
    z: owner.pos.z + 1,
  });
  pet.hostile = false;
  pet.ownerId = ownerId;
  pet.maxHp = 1_000;
  pet.hp = hp;
  sim.addEntity(pet);
  return pet;
}

function advance(sim: Sim, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let tick = 0; tick < ticks; tick++) events.push(...sim.tick());
  return events;
}

function castPatchUp(sim: TestSim): SimEvent[] {
  sim.player.resource = sim.player.maxResource;
  sim.player.gcdRemaining = 0;
  sim.castAbility('revive_pet');
  return advance(sim, 61);
}

describe('Hunter Patch Up', () => {
  it('heals only the living owned pet for exactly 240 over 12 sec', () => {
    const sim = makeHunter();
    const ownPet = addPet(sim, sim.playerId);
    const otherPid = sim.addPlayer('hunter', 'Other Hunter');
    const foreignPet = addPet(sim, otherPid);
    sim.player.targetId = foreignPet.id;

    const resolved = sim.resolvedAbility('revive_pet');
    expect(resolved?.def).toMatchObject({
      name: 'Patch Up',
      requiresTarget: false,
    });
    expect(resolved?.effects).toContainEqual({
      type: 'hot',
      total: 240,
      duration: 12,
      interval: 3,
    });

    castPatchUp(sim);

    expect(ownPet.auras).toContainEqual(
      expect.objectContaining({
        id: 'revive_pet',
        kind: 'hot',
        value: 60,
        tickInterval: 3,
        sourceId: sim.playerId,
      }),
    );
    expect(foreignPet.auras.some((aura) => aura.id === 'revive_pet')).toBe(false);
    expect(sim.player.auras.some((aura) => aura.id === 'revive_pet')).toBe(false);

    const periodicEvents = advance(sim, 20 * 12);
    const healEvents = periodicEvents.filter(
      (event): event is Extract<SimEvent, { type: 'heal2' }> =>
        event.type === 'heal2' && event.targetId === ownPet.id,
    );
    expect(healEvents.map((event) => event.amount)).toEqual([60, 60, 60, 60]);
    expect(healEvents.reduce((total, event) => total + event.amount, 0)).toBe(240);
    expect(
      periodicEvents.some((event) => event.type === 'heal2' && event.targetId === foreignPet.id),
    ).toBe(false);
  });

  it('does not heal or revive another hunter pet when the caster owns none', () => {
    const sim = makeHunter();
    const otherPid = sim.addPlayer('hunter', 'Other Hunter');
    const foreignPet = addPet(sim, otherPid, 0);
    foreignPet.dead = true;
    sim.player.targetId = foreignPet.id;

    const events = castPatchUp(sim);

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'error', pid: sim.playerId, text: 'You have no pet.' }),
    );
    expect(foreignPet.dead).toBe(true);
    expect(foreignPet.hp).toBe(0);
    expect(foreignPet.auras.some((aura) => aura.id === 'revive_pet')).toBe(false);
  });

  it('revives the dead owned pet at 35% health', () => {
    const sim = makeHunter();
    const pet = addPet(sim, sim.playerId, 0);
    pet.dead = true;

    castPatchUp(sim);

    expect(pet.dead).toBe(false);
    expect(pet.hp).toBe(350);
    expect(pet.ownerId).toBe(sim.playerId);
    expect(pet.auras.some((aura) => aura.id === 'revive_pet')).toBe(false);
  });

  it('improves the living-pet heal to exactly 360 without changing its cadence', () => {
    const sim = makeHunter({ 11: 'hun_r11_mend_pet' });
    const pet = addPet(sim, sim.playerId);

    expect(sim.resolvedAbility('revive_pet')?.effects).toContainEqual({
      type: 'hot',
      total: 360,
      duration: 12,
      interval: 3,
    });

    castPatchUp(sim);

    expect(pet.auras).toContainEqual(
      expect.objectContaining({
        id: 'revive_pet',
        kind: 'hot',
        value: 90,
        tickInterval: 3,
        sourceId: sim.playerId,
      }),
    );
  });

  it('keeps Master Tamer independent from Patch Up healing', () => {
    const sim = makeHunter({ 17: 'hun_r17_master_tamer' });

    expect(sim.resolvedAbility('revive_pet')?.effects).toContainEqual({
      type: 'hot',
      total: 240,
      duration: 12,
      interval: 3,
    });
  });
});
