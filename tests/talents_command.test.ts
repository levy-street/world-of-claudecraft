import { describe, expect, it } from 'vitest';
import {
  ROW_LEVELS,
  rowForLevel,
  type TalentAllocation,
  talentsFor,
} from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import { MAX_LEVEL, type SimEvent } from '../src/sim/types';

// "/talents" emits a self-only `error` event (the same self-reply channel /who
// uses) and returns null, so we collect the text from the next tick's events.
function readout(sim: Sim, cmd: string): string | undefined {
  sim.tick(); // drain any setup events first
  expect(sim.chat(cmd)).toBeNull(); // readouts are never logged as chat
  const errs = sim
    .tick()
    .filter((e: SimEvent): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error');
  return errs.at(-1)?.text;
}

describe('/talents readout', () => {
  it('reports not-yet-unlocked below the talent level', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' }); // fresh = level 1
    const text = readout(sim, '/talents');
    expect(text).toBe('You have not unlocked talents yet — they begin at level 5.');
  });

  it('shows the specialization and selected/unlocked row counts', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    sim.setPlayerLevel(MAX_LEVEL); // all six choice rows are available at level 20
    expect(
      sim.applyTalents({
        spec: 'arms',
        rows: {
          5: 'war_row_double_charge',
          8: 'war_row_die_by_the_sword',
          11: 'war_row_storm_bolt',
        },
      }),
    ).toBe(true);

    const armsName = talentsFor('warrior')!.specs.find((s) => s.id === 'arms')!.name;
    const text = readout(sim, '/talents');
    expect(text).toBe(`Talents: ${armsName} - 3/6 rows selected. 3 unspent.`);
  });

  it('reports no specialization when none is chosen', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    sim.setPlayerLevel(MAX_LEVEL);
    expect(
      sim.applyTalents({
        spec: null,
        rows: { 5: 'war_row_pursuit', 8: 'war_row_second_wind' },
      }),
    ).toBe(true);

    const text = readout(sim, '/talents');
    expect(text).toBe('Talents: no specialization - 2/6 rows selected. 4 unspent.');
  });

  it('omits the unspent suffix when all rows are selected and aliases resolve', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    sim.setPlayerLevel(MAX_LEVEL);
    const allocation: TalentAllocation = {
      spec: null,
      rows: Object.fromEntries(
        ROW_LEVELS.map((level) => [level, rowForLevel('warrior', level)!.options[0].id]),
      ),
    };
    expect(sim.applyTalents(allocation)).toBe(true);

    const text = readout(sim, '/talent'); // alias
    expect(text).toBe('Talents: no specialization - 6/6 rows selected.');
    expect(readout(sim, '/spec')).toBe(text); // alias parity
  });
});
