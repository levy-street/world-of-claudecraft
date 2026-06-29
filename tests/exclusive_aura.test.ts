import { describe, expect, it } from 'vitest';
import { exclusiveAuraConflicts } from '../src/sim/combat/exclusive_aura';

// Hunter aspects all share the 'aspect' group; nothing else does.
const GROUPS: Record<string, string | undefined> = {
  aspect_of_the_hawk: 'aspect',
  aspect_of_the_monkey: 'aspect',
  aspect_of_the_cheetah: 'aspect',
  serpent_sting: undefined,
};
const groupOf = (id: string) => GROUPS[id];

describe('exclusiveAuraConflicts', () => {
  it('returns no conflicts when the ability has no group', () => {
    const auras = [{ id: 'aspect_of_the_hawk' }];
    expect(exclusiveAuraConflicts(undefined, 'serpent_sting', auras, groupOf)).toEqual([]);
  });

  it('flags a sibling aspect already active', () => {
    const auras = [{ id: 'serpent_sting' }, { id: 'aspect_of_the_hawk' }];
    expect(exclusiveAuraConflicts('aspect', 'aspect_of_the_monkey', auras, groupOf)).toEqual([1]);
  });

  it('does not flag a re-cast of the same aspect', () => {
    const auras = [{ id: 'aspect_of_the_hawk' }];
    expect(exclusiveAuraConflicts('aspect', 'aspect_of_the_hawk', auras, groupOf)).toEqual([]);
  });

  it('does not flag unrelated (non-group) auras', () => {
    const auras = [{ id: 'serpent_sting' }];
    expect(exclusiveAuraConflicts('aspect', 'aspect_of_the_hawk', auras, groupOf)).toEqual([]);
  });

  it('returns every sibling in DESCENDING index order (safe to splice)', () => {
    const auras = [
      { id: 'aspect_of_the_hawk' },
      { id: 'serpent_sting' },
      { id: 'aspect_of_the_cheetah' },
    ];
    expect(exclusiveAuraConflicts('aspect', 'aspect_of_the_monkey', auras, groupOf)).toEqual([
      2, 0,
    ]);
  });
});
