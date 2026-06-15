import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function errorText(events: SimEvent[]): string | undefined {
  return events.find((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')?.text;
}

describe('/potion command', () => {
  it('reports the combat potion as ready when off cooldown', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.potionCooldownUntil = -1;

    sim.chat('/potion', a);
    expect(errorText(sim.tick())).toBe('Combat potion is ready to use.');
  });

  it('reports remaining cooldown, ceiled, when on cooldown', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    // potionCooldownUntil is an absolute sim-time deadline measured against sim.time.
    e.potionCooldownUntil = sim.time + 22.4;

    sim.chat('/pot', a);
    expect(errorText(sim.tick())).toBe('Combat potion on cooldown — ready in 23s.');
  });

  it('responds to the /potioncd alias', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    sim.entities.get(a)!.potionCooldownUntil = -1;

    sim.chat('/potioncd', a);
    expect(errorText(sim.tick())).toBe('Combat potion is ready to use.');
  });
});
