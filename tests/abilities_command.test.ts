import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt, CLASSES } from '../src/sim/content/classes';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function errorAfter(sim: Sim, text: string, pid: number): string | undefined {
  sim.chat(text, pid);
  const events: SimEvent[] = sim.tick();
  expect(events.filter((e) => e.type === 'chat')).toHaveLength(0);
  const err = events.find((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error');
  return err?.text;
}

describe('/abilities command', () => {
  it('lists every known ability with its rank, self-only and unsaid', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const text = errorAfter(sim, '/abilities', a)!;

    const known = abilitiesKnownAt('warrior', sim.entities.get(a)!.level);
    expect(text).toContain(`Spellbook (${known.length}):`);
    // a level-1 warrior knows Reaver Strike but not yet Charge (learnLevel 4)
    expect(text).toContain('Reaver Strike (Rank 1)');
    expect(text).not.toContain('Onrush');
    expect(text.endsWith('.')).toBe(true);
  });

  it('reflects newly learned abilities and higher ranks at a higher level', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const e = sim.entities.get(a)!;
    e.level = 20;
    sim.tick();
    const text = errorAfter(sim, '/abilities', a)!;

    const known = abilitiesKnownAt('warrior', 20);
    expect(text).toContain(`Spellbook (${known.length}):`);
    // Reaver Strike reaches Rank 4 at level 20; Charge is now learned
    expect(text).toContain('Reaver Strike (Rank 4)');
    expect(text).toContain('Onrush (Rank 1)');
  });

  it('accepts the /spells and /spellbook aliases', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('mage', 'Bet');
    sim.tick();
    const first = ABILITIES[CLASSES.mage.abilities[0]].name;
    expect(errorAfter(sim, '/spells', a)).toContain(first);
    expect(errorAfter(sim, '/spellbook', a)).toContain('Spellbook');
  });
});
