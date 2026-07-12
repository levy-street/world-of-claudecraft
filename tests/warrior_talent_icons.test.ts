import { describe, expect, it } from 'vitest';
import { WARRIOR_ROWS } from '../src/sim/content/warrior_rows';
import { talentEffectIconRef } from '../src/ui/talent_icons';

const warriorOption = (id: string) => {
  const option = WARRIOR_ROWS.flatMap((row) => row.options).find((item) => item.id === id);
  if (!option) throw new Error(`Missing warrior choice-row option: ${id}`);
  return option;
};

describe('warrior painted talent icons', () => {
  it.each([
    ['war_row_double_charge', 'double_charge'],
    ['war_row_crushing_charge', 'crushing_charge'],
    ['war_row_blood_offering', 'combat_mastery'],
  ])('%s resolves to %s', (optionId, iconId) => {
    expect(talentEffectIconRef(warriorOption(optionId).effect, 'choice')).toEqual({
      kind: 'ability',
      id: iconId,
    });
  });
});
