import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'mage', noPlayer: true });
}

function errors(events: SimEvent[]): Extract<SimEvent, { type: 'error' }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error');
}

// The readout emits a self-targeted error event, collected on the next tick.
function readout(sim: Sim, cmd: string, pid: number): string {
  sim.chat(cmd, pid);
  const errs = errors(sim.tick());
  expect(errs.length).toBe(1);
  expect(errs[0].pid).toBe(pid);
  return errs[0].text;
}

describe('/consumable command', () => {
  it('reports nothing when not eating or drinking', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('mage', 'Aleph');
    sim.tick();
    expect(readout(sim, '/consumable', a)).toBe('You are not eating or drinking.');
  });

  it('reports food and drink running concurrently with their own timers', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('mage', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.eating = { itemId: 'baked_bread', kind: 'food', hpPer2s: 7, manaPer2s: 0, remaining: 12 };
    e.drinking = { itemId: 'spring_water', kind: 'drink', hpPer2s: 0, manaPer2s: 8, remaining: 9 };
    expect(readout(sim, '/consumable', a)).toBe(
      'You are eating Cottage Loaf (+7 HP/2s, 12s left) and drinking Cold Well Water (+8 mana/2s, 9s left).',
    );
  });

  it('reports drink alone when only drinking', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('mage', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.drinking = { itemId: 'spring_water', kind: 'drink', hpPer2s: 0, manaPer2s: 8, remaining: 5 };
    expect(readout(sim, '/consumable', a)).toBe(
      'You are drinking Cold Well Water (+8 mana/2s, 5s left).',
    );
  });

  it('rounds the remaining time up so a partial second still shows', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('mage', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.eating = { itemId: 'baked_bread', kind: 'food', hpPer2s: 7, manaPer2s: 0, remaining: 0.3 };
    expect(readout(sim, '/consumable', a)).toBe('You are eating Cottage Loaf (+7 HP/2s, 1s left).');
  });

  it('responds to the /eat and /drink aliases', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('mage', 'Aleph');
    sim.tick();
    expect(readout(sim, '/eat', a)).toBe('You are not eating or drinking.');
    expect(readout(sim, '/drink', a)).toBe('You are not eating or drinking.');
  });
});
