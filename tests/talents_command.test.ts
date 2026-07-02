import { describe, expect, it } from 'vitest';
import { talentsFor } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import { MAX_LEVEL, type SimEvent } from '../src/sim/types';

function readout(sim: Sim, cmd: string): string | undefined {
  sim.tick();
  expect(sim.chat(cmd)).toBeNull();
  const errs = sim
    .tick()
    .filter((e: SimEvent): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error');
  return errs.at(-1)?.text;
}

describe('/talents readout', () => {
  it('shows rows picked before the specialization gate', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    const text = readout(sim, '/talents');
    expect(text).toBe('Talents: no specialization, 0/0 choice rows picked. Specializations unlock at level 10.');
  });

  it('shows spec and picked row count', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    sim.setPlayerLevel(MAX_LEVEL);
    expect(sim.applyTalents({ spec: 'arms', rows: { 5: 'war_r5_juggernaut' } })).toBe(true);

    const armsName = talentsFor('warrior')!.specs.find((s) => s.id === 'arms')!.name;
    const text = readout(sim, '/talents');
    expect(text).toBe(`Talents: ${armsName}, 1/6 choice rows picked.`);
  });

  it('reports no specialization when none is chosen and aliases resolve', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    sim.setPlayerLevel(MAX_LEVEL);
    expect(sim.applyTalents({ spec: null, rows: { 5: 'war_r5_juggernaut', 8: 'war_r8_pummel' } })).toBe(true);

    const text = readout(sim, '/talent');
    expect(text).toBe('Talents: no specialization, 2/6 choice rows picked.');
    expect(readout(sim, '/spec')).toBe(text);
  });
});
