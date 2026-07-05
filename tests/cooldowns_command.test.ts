import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function errors(events: SimEvent[]): Extract<SimEvent, { type: 'error' }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error');
}

describe('/cooldowns command', () => {
  it('reports nothing on cooldown when the map is empty', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    sim.chat('/cooldowns', a);
    const errs = errors(sim.tick());
    expect(errs.length).toBe(1);
    expect(errs[0].pid).toBe(a);
    expect(errs[0].text).toBe('No abilities are on cooldown.');
  });

  it('lists active cooldowns soonest-ready first with ceil-rounded seconds', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    // insert out of order to prove the readout sorts ascending by remaining
    e.cooldowns.set('execute', 12);
    e.cooldowns.set('charge', 2.4);

    sim.chat('/cooldowns', a);
    const errs = errors(sim.tick());
    expect(errs.length).toBe(1);
    // 2.4s ceils to 3s while still active; Onrush sorts before Early Grave
    expect(errs[0].text).toBe('Abilities on cooldown (2): Onrush (3s), Early Grave (12s).');
  });

  it('accepts the /cd and /cds aliases', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    for (const cmd of ['/cd', '/cds']) {
      sim.chat(cmd, a);
      const errs = errors(sim.tick());
      expect(errs.length).toBe(1);
      expect(errs[0].text).toBe('No abilities are on cooldown.');
    }
  });

  it('is self-only: produces no chat event and is not logged', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    const result = sim.chat('/cooldowns', a);
    expect(result).toBeNull();
    expect(sim.tick().some((ev) => ev.type === 'chat')).toBe(false);
  });
});
