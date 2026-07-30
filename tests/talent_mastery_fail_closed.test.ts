import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type SpecDef, TALENTS, type TalentEffect } from '../src/sim/content/talents';
import { ensureLocaleLoaded, setLanguage, supportedLanguages } from '../src/ui/i18n';
import { tTalent } from '../src/ui/talent_i18n';

// The spec panels render the mastery line through tTalent('talentMastery'). Outside
// English that text is GENERATED from the effect record, and the generator used to
// print the literal "undefined" for any effect field it had no label for (the PTR
// screenshot: "Aumenta undefined en 70%"). These tests pin the fail-closed contract:
// unknown fields are skipped, and when nothing at all is generatable the authored
// English description is used. The literal string "undefined" must never render.

function syntheticSpec(effect: TalentEffect): SpecDef {
  return {
    id: 'synthetic_spec',
    class: 'warrior',
    name: 'Synthetic Spec',
    role: 'dps',
    icon: 'x',
    description: 'Synthetic spec used by the fail-closed mastery formatter guard.',
    signature: 'mortal_strike',
    mastery: {
      name: 'Synthetic Mastery',
      description: 'Increases synthetic output by 70%.',
      effect,
    },
  };
}

// A future sim field the formatter has no label for yet, alongside one known field.
const MIXED_EFFECT = {
  stats: { crit: 0.05, mysteryNewStatPct: 0.4 },
  global: { mysteryNewGlobalPct: 0.7 },
} as unknown as TalentEffect;

// An effect made ONLY of unmapped fields: nothing is generatable at all.
const OPAQUE_EFFECT = {
  global: { mysteryNewGlobalPct: 0.7 },
} as unknown as TalentEffect;

describe('mastery formatter fails closed on unmapped effect fields', () => {
  beforeAll(async () => {
    for (const lang of supportedLanguages) await ensureLocaleLoaded(lang);
  });
  afterAll(() => setLanguage('en'));

  it('never renders the literal "undefined" for an unmapped field in any locale', () => {
    const spec = syntheticSpec(MIXED_EFFECT);
    for (const lang of supportedLanguages) {
      setLanguage(lang);
      const rendered = tTalent({ kind: 'talentMastery', spec, field: 'description' });
      expect(rendered, `${lang} rendered: ${rendered}`).not.toContain('undefined');
    }
  });

  it('still renders the known fields of a partially-unmapped effect (es regression shape)', () => {
    setLanguage('es');
    const rendered = tTalent({
      kind: 'talentMastery',
      spec: syntheticSpec(MIXED_EFFECT),
      field: 'description',
    });
    // The known crit field renders localized with its number; the unmapped 40%/70%
    // fields are skipped entirely (no "Aumenta undefined en 70%").
    expect(rendered).toContain('5');
    expect(rendered).not.toContain('70');
    expect(rendered).not.toContain('undefined');
  });

  it('falls back to the authored English description when nothing is generatable', () => {
    setLanguage('es');
    const spec = syntheticSpec(OPAQUE_EFFECT);
    const rendered = tTalent({ kind: 'talentMastery', spec, field: 'description' });
    expect(rendered).toBe('Increases synthetic output by 70%.');
  });

  it('sweep: none of the 27 real masteries renders "undefined" in any supported locale', () => {
    const specs = Object.values(TALENTS).flatMap((classTalents) => classTalents.specs);
    expect(specs).toHaveLength(27);
    for (const lang of supportedLanguages) {
      setLanguage(lang);
      for (const spec of specs) {
        for (const field of ['name', 'description'] as const) {
          const rendered = tTalent({ kind: 'talentMastery', spec, field });
          expect(
            rendered,
            `${lang} ${spec.class}:${spec.id} mastery ${field}: ${rendered}`,
          ).not.toContain('undefined');
          expect(rendered.trim().length, `${lang} ${spec.class}:${spec.id}`).toBeGreaterThan(0);
        }
      }
    }
  });
});
