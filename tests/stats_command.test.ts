import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function errorText(events: SimEvent[], pid: number): string | undefined {
  const ev = events.find(
    (e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error' && e.pid === pid,
  );
  return ev?.text;
}

describe('/stats command', () => {
  it('reports a self-only character sheet with the rage resource clause', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    const sent = sim.chat('/stats', a);
    expect(sent).toBeNull(); // not logged or spoken

    const events = sim.tick();
    const text = errorText(events, a)!;
    expect(text).toMatch(/^Level \d+ Warrior — HP \d+\/\d+, Rage \d+\/\d+\. AP \d+, Crit \d+\.\d%, Armor \d+\.$/);
    // self-only: no other player receives the readout
    expect(events.some((e) => e.type === 'error' && e.pid !== a)).toBe(false);
  });

  it('uses the Energy clause for a rogue', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('rogue', 'Gimel');
    sim.tick();

    sim.chat('/stats', a);
    const text = errorText(sim.tick(), a)!;
    expect(text).toContain('Rogue');
    expect(text).toMatch(/Energy \d+\/\d+/);
  });

  it('uses the Mana clause for a mage and accepts the /st and /sheet aliases', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('mage', 'Bet');
    sim.tick();

    for (const cmd of ['/stats', '/st', '/sheet']) {
      sim.chat(cmd, a);
      const text = errorText(sim.tick(), a)!;
      expect(text).toMatch(/Mana \d+\/\d+/);
    }
  });
});
