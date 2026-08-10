import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function errorText(events: SimEvent[]): string | undefined {
  const e = events.find((ev): ev is Extract<SimEvent, { type: 'error' }> => ev.type === 'error');
  return e?.text;
}

describe('/manaregen command', () => {
  it('reports full-rate regen once past the five-second rule', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('mage', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.fiveSecondRule = 6;
    sim.chat('/manaregen', a);
    expect(errorText(sim.tick())).toBe(
      'Your mana is regenerating at full rate (out of combat for 5s+).',
    );
  });

  it('reports the reduced in-combat rate and resume countdown while the rule is active', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('mage', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.fiveSecondRule = 2.4; // 5 - 2.4 = 2.6 -> ceil 3
    sim.chat('/5sr', a);
    expect(errorText(sim.tick())).toBe(
      'Your mana is regenerating at 30% while in combat, full rate in 3s (you spent mana recently).',
    );
  });

  it('tells non-mana classes the mechanic does not apply', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph'); // rage user
    sim.tick();
    sim.chat('/regen', a);
    expect(errorText(sim.tick())).toBe('Mana regeneration does not apply to your class.');
  });
});
