import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

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
  it('reports the character-bound combo pool (no target anchor)', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('rogue', 'Aleph');
    sim.tick();

    const e = sim.entities.get(pid)!;
    e.comboPoints = 3;
    e.comboUntil = sim.time + 30; // keep the pool alive through the readout tick

    sim.chat('/combo', pid);
    expect(errorText(sim.tick(), pid)).toBe('Combo points: 3/5.');
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
