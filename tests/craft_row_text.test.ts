// The craft row's words, driven straight through the two modules the
// professions and crafting windows compose: role and ceiling chips, the
// next-unlock line, the difficulty label and the duration chip.

import { describe, expect, it } from 'vitest';
import {
  craftDifficultyLabel,
  DURATION_FRACTION_DIGITS,
  durationChipText,
} from '../src/ui/hud/professions/craft_row_chip_text';
import {
  craftCeilingLabel,
  craftNextUnlockText,
  craftRoleLabel,
} from '../src/ui/hud/professions/craft_row_labels';

describe('craft row chip labels', () => {
  it('gives every role and every ceiling its own non-empty wording', () => {
    const roles = ['major', 'hobby', 'dormant', 'unattuned'] as const;
    const ceilings = ['unlimited', 'rare', 'common'] as const;
    const roleLabels = roles.map(craftRoleLabel);
    const ceilingLabels = ceilings.map(craftCeilingLabel);
    for (const label of [...roleLabels, ...ceilingLabels]) expect(label).not.toBe('');
    expect(new Set(roleLabels).size, 'no two roles read the same').toBe(roles.length);
    expect(new Set(ceilingLabels).size, 'no two ceilings read the same').toBe(ceilings.length);
  });

  it('separates the four skill-gain difficulties, so the tint is never the only cue', () => {
    const difficulties = ['full', 'reduced', 'minimal', 'none'] as const;
    const labels = difficulties.map(craftDifficultyLabel);
    for (const label of labels) expect(label).not.toBe('');
    expect(new Set(labels).size).toBe(difficulties.length);
  });
});

describe('craftNextUnlockText', () => {
  it('names the mastered end state, and counts the points left otherwise', () => {
    const mastered = craftNextUnlockText({ kind: 'mastered' });
    const specialized = craftNextUnlockText({
      kind: 'specialized',
      pointsRemaining: 25,
      materialDiscountPct: 10,
    });
    const tier = craftNextUnlockText({ kind: 'tier', targetTier: 3, pointsRemaining: 25 });
    expect(mastered).not.toBe('');
    expect(mastered).not.toContain('25');
    expect(specialized).toContain('25');
    expect(tier).toContain('25');
    expect(specialized, 'the two point lines say different things').not.toBe(tier);
  });
});

describe('durationChipText', () => {
  it('spells whole seconds whole and fractional seconds to two places', () => {
    expect(DURATION_FRACTION_DIGITS).toBe(2);
    expect(durationChipText(2)).toContain('2');
    expect(durationChipText(2)).not.toContain('2.0');
    expect(durationChipText(1.75)).toContain('1.75');
  });
});
