import { describe, expect, it } from 'vitest';
import {
  rowForLevel,
  rowTreeFor,
  TALENTS,
  validateRowTree,
  validateTalentTree,
} from '../src/sim/content/talents';

function optionIds(level: 5 | 8 | 11 | 14 | 17 | 20): string[] {
  const row = rowForLevel('shaman', level);
  if (!row) throw new Error(`Missing Shaman level-${level} row`);
  return row.options.map((option) => option.id);
}

describe('Shaman PBE structural feedback', () => {
  it('moves Rebounding Current to the Thunder Ward unlock tier', () => {
    expect(optionIds(5)).toContain('sha_r8_shock_efficiency');
    expect(optionIds(5)).not.toContain('sha_r5_improved_lightning_shield');
    expect(optionIds(8)).toContain('sha_r5_improved_lightning_shield');

    const tree = rowTreeFor('shaman');
    if (!tree) throw new Error('Missing Shaman talent rows');
    expect(validateTalentTree(TALENTS.shaman)).toEqual([]);
    expect(validateRowTree(tree)).toEqual([]);
  });
});
