import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { SimEvent } from '../src/sim/types';
import { MAX_LEVEL } from '../src/sim/types';
import { talentsFor } from '../src/sim/content/talents';

// "/talents" emits a self-only `error` event (the same self-reply channel /who
// uses) and returns null, so we collect the text from the next tick's events.
function readout(sim: Sim, cmd: string): string | undefined {
  sim.tick();                       // drain any setup events first
  expect(sim.chat(cmd)).toBeNull(); // readouts are never logged as chat
  const errs = sim.tick().filter((e: SimEvent): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error');
  return errs.at(-1)?.text;
}

describe('/talents readout', () => {
  it('reports not-yet-unlocked below the talent level', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' }); // fresh = level 1
    const text = readout(sim, '/talents');
    expect(text).toBe('You have not unlocked talents yet — they begin at level 10.');
  });

  it('shows spec, spent/total and the per-tree split', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    sim.setPlayerLevel(MAX_LEVEL); // 51 points available at the level-60 cap
    expect(sim.applyTalents({ spec: 'arms', ranks: { war_toughness: 3 }, choices: {} })).toBe(true);

    const total = MAX_LEVEL - 9; // classic formula, level minus 9
    const armsName = talentsFor('warrior')!.specs.find((s) => s.id === 'arms')!.name;
    const text = readout(sim, '/talents');
    expect(text).toBe(
      `Talents: ${armsName} — 3/${total} points spent (Class 3, ${armsName} 0). ${total - 3} unspent.`,
    );
  });

  it('reports no specialization when none is chosen', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    sim.setPlayerLevel(MAX_LEVEL);
    expect(sim.applyTalents({ spec: null, ranks: { war_toughness: 2 }, choices: {} })).toBe(true);

    const total = MAX_LEVEL - 9;
    const text = readout(sim, '/talents');
    expect(text).toBe(
      `Talents: no specialization — 2/${total} points spent (Class 2). ${total - 2} unspent.`,
    );
  });

  it('omits the unspent suffix when all points are spent and aliases resolve', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    sim.setPlayerLevel(20); // 11 points at level 20, exactly spendable below
    // 11 points, all in the class tree (Toughness/Cruelty cap at 3 each here).
    expect(sim.applyTalents({
      spec: null,
      ranks: { war_toughness: 3, war_cruelty: 3, war_deflection: 3, war_imp_thunder_clap: 2 },
      choices: {},
    })).toBe(true);

    const text = readout(sim, '/talent'); // alias
    expect(text).toBe('Talents: no specialization — 11/11 points spent (Class 11).');
    expect(readout(sim, '/spec')).toBe(text); // alias parity
  });
});
