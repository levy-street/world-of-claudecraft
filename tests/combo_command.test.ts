import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'rogue', noPlayer: true });
}

function errorText(events: SimEvent[], pid: number): string | undefined {
  const err = events.filter(
    (e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error' && e.pid === pid,
  );
  return err.length ? err[err.length - 1].text : undefined;
}

describe('/combo command', () => {
  it('reports combo points and the target they are built on', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('rogue', 'Aleph');
    const foe = sim.addPlayer('warrior', 'Bet');
    sim.tick();

    const e = sim.entities.get(pid)!;
    e.comboPoints = 3;
    e.comboTargetId = foe;

    sim.chat('/combo', pid);
    expect(errorText(sim.tick(), pid)).toBe('Combo points: 3/5 on Bet.');
  });

  it('omits the target when it can no longer be resolved', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('rogue', 'Aleph');
    sim.tick();

    const e = sim.entities.get(pid)!;
    e.comboPoints = 5;
    e.comboTargetId = 999999; // no such entity

    sim.chat('/combo', pid);
    expect(errorText(sim.tick(), pid)).toBe('Combo points: 5/5.');
  });

  it('reports an empty pool when no combo points are built up', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('rogue', 'Aleph');
    sim.tick();

    sim.chat('/cp', pid);
    expect(errorText(sim.tick(), pid)).toBe('You have no combo points built up.');
  });

  it('is reachable via the /combopoints alias and stays self-only and unlogged', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('rogue', 'Aleph');
    sim.tick();

    const sent = sim.chat('/combopoints', pid);
    expect(sent).toBeNull();
    expect(errorText(sim.tick(), pid)).toBe('You have no combo points built up.');
  });
});
