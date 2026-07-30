import { describe, expect, it } from 'vitest';
import { comboEligibility } from '../src/sim/professions/combo_eligibility';

const requirement = {
  craftA: 'armorcrafting',
  craftB: 'weaponcrafting',
  minTier: 1,
};

const skilled = { armorcrafting: 25, weaponcrafting: 25, cooking: 500 };

describe('comboEligibility', () => {
  it('allows the exact active pair in either order when both tier ceilings are met', () => {
    expect(
      comboEligibility(requirement, skilled, {
        activeArchetype: 'armorcrafting',
        pairedMajor: 'weaponcrafting',
        hobbyCraft: 'leatherworking',
      }),
    ).toMatchObject({ ok: true, reason: null });
    expect(
      comboEligibility(requirement, skilled, {
        activeArchetype: 'weaponcrafting',
        pairedMajor: 'armorcrafting',
        hobbyCraft: 'tailoring',
      }).ok,
    ).toBe(true);
  });

  it.each([
    ['unattuned', null, null, 'cooking', 'not_attuned'],
    ['wrong pair', 'weaponcrafting', 'jewelcrafting', 'cooking', 'wrong_pair'],
    ['major plus hobby', 'armorcrafting', 'engineering', 'weaponcrafting', 'wrong_pair'],
  ] as const)(
    'denies %s high-skill state',
    (_label, activeArchetype, pairedMajor, hobbyCraft, reason) => {
      expect(
        comboEligibility(requirement, skilled, { activeArchetype, pairedMajor, hobbyCraft }),
      ).toMatchObject({ ok: false, reason });
    },
  );

  it('denies the exact pair when one required tier is low', () => {
    expect(
      comboEligibility(
        requirement,
        { armorcrafting: 25, weaponcrafting: 24 },
        {
          activeArchetype: 'armorcrafting',
          pairedMajor: 'weaponcrafting',
          hobbyCraft: 'leatherworking',
        },
      ),
    ).toMatchObject({ ok: false, reason: 'tier_unmet', unmetCrafts: ['weaponcrafting'] });
  });

  it('denies the exact pair when only craftA misses its tier, naming just that craft', () => {
    expect(
      comboEligibility(
        requirement,
        { armorcrafting: 24, weaponcrafting: 25 },
        {
          activeArchetype: 'armorcrafting',
          pairedMajor: 'weaponcrafting',
          hobbyCraft: 'leatherworking',
        },
      ),
    ).toMatchObject({ ok: false, reason: 'tier_unmet', unmetCrafts: ['armorcrafting'] });
  });

  it('names BOTH crafts in unmetCrafts when neither reaches the required tier', () => {
    expect(
      comboEligibility(
        requirement,
        { armorcrafting: 0, weaponcrafting: 24 },
        {
          activeArchetype: 'armorcrafting',
          pairedMajor: 'weaponcrafting',
          hobbyCraft: 'leatherworking',
        },
      ),
    ).toMatchObject({
      ok: false,
      reason: 'tier_unmet',
      unmetCrafts: ['armorcrafting', 'weaponcrafting'],
    });
  });

  it('treats a half-formed identity (major set, no paired major) as not attuned', () => {
    expect(
      comboEligibility(requirement, skilled, {
        activeArchetype: 'armorcrafting',
        pairedMajor: null,
        hobbyCraft: null,
      }),
    ).toMatchObject({ ok: false, reason: 'not_attuned' });
  });

  it('allows a recipe without a combo requirement in every identity state', () => {
    expect(
      comboEligibility(
        undefined,
        {},
        {
          activeArchetype: null,
          pairedMajor: null,
          hobbyCraft: null,
        },
      ),
    ).toMatchObject({ ok: true, reason: null });
  });
});
