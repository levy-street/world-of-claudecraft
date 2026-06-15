import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { SimEvent, Entity } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'hunter', noPlayer: true });
}

function errorText(events: SimEvent[]): string | undefined {
  const err = events.find((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error');
  return err?.text;
}

// Hand a player a pet by adopting an existing wild mob, mirroring what a
// completed tame leaves behind (ownerId set, full health, friendly).
function givePet(sim: Sim, ownerPid: number): Entity {
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead && e.ownerId === null) {
      e.ownerId = ownerPid;
      e.hostile = false;
      e.hp = e.maxHp;
      return e;
    }
  }
  throw new Error('no wild mob available to adopt as a pet');
}

describe('/pet command', () => {
  it('reports name, level, family, and health for an active pet', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('hunter', 'Aleph');
    const pet = givePet(sim, a);
    sim.tick();

    sim.chat('/pet', a);
    const events = sim.tick();
    // self-only readout: never reaches the chat channel
    expect(events.some((e) => e.type === 'chat')).toBe(false);
    const text = errorText(events)!;
    expect(text).toContain(`Your pet: ${pet.name}`);
    expect(text).toContain(`level ${pet.level}`);
    expect(text).toContain(`HP ${pet.hp}/${pet.maxHp}`);
    expect(text).toContain('(100%)');
  });

  it('rounds the health percentage from live pet HP', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('hunter', 'Aleph');
    const pet = givePet(sim, a);
    pet.hp = Math.round(pet.maxHp * 0.5);
    sim.tick();

    sim.chat('/pet', a);
    const text = errorText(sim.tick())!;
    expect(text).toContain('(50%)');
  });

  it('tells players without a pet that they have none', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('hunter', 'Aleph');
    sim.tick();

    sim.chat('/pet', a);
    const events = sim.tick();
    expect(events.some((e) => e.type === 'chat')).toBe(false);
    expect(errorText(events)).toBe('You do not have a pet.');
  });

  it('supports the /companion and /pets aliases', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('hunter', 'Aleph');
    const pet = givePet(sim, a);
    sim.tick();

    for (const cmd of ['/companion', '/pets']) {
      sim.chat(cmd, a);
      expect(errorText(sim.tick())).toContain(`Your pet: ${pet.name}`);
    }
  });
});
