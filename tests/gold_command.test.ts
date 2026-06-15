import { describe, expect, it } from 'vitest';
import { Sim, formatMoney } from '../src/sim/sim';
import { SimEvent } from '../src/sim/types';

function makeSim() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function errorTextFor(events: SimEvent[], pid: number): string | undefined {
  const e = events.find(
    (ev): ev is Extract<SimEvent, { type: 'error' }> => ev.type === 'error' && ev.pid === pid,
  );
  return e?.text;
}

describe('/gold command', () => {
  it('reports your purse with gold/silver/copper formatting', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.players.get(a)!.copper = 123405; // 12g 34s 5c
    sim.tick();

    expect(sim.chat('/gold', a)).toBeNull(); // self-only readout, never logged
    expect(errorTextFor(sim.tick(), a)).toBe(`You have ${formatMoney(123405)}.`);
  });

  it('shows flavor text for an empty purse instead of "0c"', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.players.get(a)!.copper = 0;
    sim.tick();

    sim.chat('/gold', a);
    expect(errorTextFor(sim.tick(), a)).toBe('Your purse is empty.');
  });

  it('accepts the /money and /coins aliases', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.players.get(a)!.copper = 250;
    sim.tick();

    for (const cmd of ['/money', '/coins']) {
      sim.chat(cmd, a);
      expect(errorTextFor(sim.tick(), a)).toBe(`You have ${formatMoney(250)}.`);
    }
  });

  it('is a self-only reply that does not emit a chat event', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.players.get(a)!.copper = 99;
    sim.tick();

    sim.chat('/gold', a);
    const events = sim.tick();
    expect(events.some((e) => e.type === 'chat')).toBe(false);
  });
});
