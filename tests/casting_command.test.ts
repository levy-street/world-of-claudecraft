import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { SimEvent } from '../src/sim/types';
import { FISHING_CAST_ID } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'mage', noPlayer: true });
}

function errorText(events: SimEvent[]): string | undefined {
  return events.find((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')?.text;
}

function casting(sim: Sim, pid: number): string | undefined {
  sim.chat('/casting', pid);
  return errorText(sim.tick());
}

describe('/casting command', () => {
  it('reports nothing when the player is idle', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('mage', 'Aleph');
    sim.tick();
    expect(casting(sim, a)).toBe('You are not casting anything.');
  });

  it('reports a normal cast with the ability name and fractional times', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('mage', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.castingAbility = 'fireball';
    e.castTotal = 2.5;
    e.castRemaining = 1.8;
    e.channeling = false;
    expect(casting(sim, a)).toBe('Casting Fireball — 1.8s of 2.5s remaining.');
  });

  it('uses "Channeling" for a channelled spell', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('mage', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.castingAbility = 'arcane_missiles';
    e.castTotal = 6.0;
    e.castRemaining = 4.2;
    e.channeling = true;
    expect(casting(sim, a)).toBe('Channeling Arcane Missiles — 4.2s of 6.0s remaining.');
  });

  it('special-cases the fishing sentinel', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('mage', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.castingAbility = FISHING_CAST_ID;
    e.castTotal = 5.0;
    e.castRemaining = 3.1;
    e.channeling = false;
    expect(casting(sim, a)).toBe('You are fishing — 3.1s of 5.0s remaining.');
  });

  it('responds to the /cast and /castbar aliases', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('mage', 'Aleph');
    sim.tick();
    sim.chat('/cast', a);
    expect(errorText(sim.tick())).toBe('You are not casting anything.');
    sim.chat('/castbar', a);
    expect(errorText(sim.tick())).toBe('You are not casting anything.');
  });
});
