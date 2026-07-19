import { describe, expect, it } from 'vitest';
import { exclusiveAuraConflicts } from '../src/sim/combat/exclusive_aura';

// Paladin auras share one exclusion group; unrelated effects do not.
const GROUPS: Record<string, string | undefined> = {
  devotion_aura: 'paladin_aura',
  retribution_aura: 'paladin_aura',
  concentration_aura: 'paladin_aura',
  serpent_sting: undefined,
};
const groupOf = (id: string) => GROUPS[id];

describe('exclusiveAuraConflicts', () => {
  it('returns no conflicts when the ability has no group', () => {
    const auras = [{ id: 'devotion_aura' }];
    expect(exclusiveAuraConflicts(undefined, 'serpent_sting', auras, groupOf)).toEqual([]);
  });

  it('flags a sibling aura already active', () => {
    const auras = [{ id: 'serpent_sting' }, { id: 'devotion_aura' }];
    expect(exclusiveAuraConflicts('paladin_aura', 'retribution_aura', auras, groupOf)).toEqual([1]);
  });

  it('does not flag a re-cast of the same aura', () => {
    const auras = [{ id: 'devotion_aura' }];
    expect(exclusiveAuraConflicts('paladin_aura', 'devotion_aura', auras, groupOf)).toEqual([]);
  });

  it('does not flag unrelated (non-group) auras', () => {
    const auras = [{ id: 'serpent_sting' }];
    expect(exclusiveAuraConflicts('paladin_aura', 'devotion_aura', auras, groupOf)).toEqual([]);
  });

  it('returns every sibling in DESCENDING index order (safe to splice)', () => {
    const auras = [
      { id: 'devotion_aura' },
      { id: 'serpent_sting' },
      { id: 'retribution_aura' },
    ];
    expect(exclusiveAuraConflicts('paladin_aura', 'concentration_aura', auras, groupOf)).toEqual([
      2, 0,
    ]);
  });
});
