import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function lastError(events: SimEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'error') return e.text;
  }
  return undefined;
}

describe('/combat command', () => {
  it('reports when you are not in combat', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    sim.entities.get(a)!.inCombat = false;

    sim.chat('/combat', a);
    expect(lastError(sim.tick())).toBe('You are not in combat.');
  });

  it('reports the linger countdown while only the combat timer keeps you engaged', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.inCombat = true;
    e.combatTimer = 2; // 5s linger window - 2s elapsed -> 3s remaining

    sim.chat('/cb', a);
    expect(lastError(sim.tick())).toBe('You are in combat — leaving in 3s if no further action.');
  });

  it('reports active engagement when in combat past the linger window', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.inCombat = true;
    e.combatTimer = 99; // engaged: timer well past the drop-out window

    sim.chat('/incombat', a);
    expect(lastError(sim.tick())).toBe('You are in combat (enemies still engaged).');
  });
});
