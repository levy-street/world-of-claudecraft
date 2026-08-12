// Table test for the craft-denial chat-line model (Masterwrought Phase 07
// review round). Every reason arm is pinned to its literal key, so a swapped
// or dropped arm in the mapping fails HERE decisively; the hud.ts caller is
// pinned as a thin wire in tests/profession_identity_card.test.ts.
import { describe, expect, it } from 'vitest';
import { craftDenialLine, DENIAL_KEY_BY_REASON } from '../src/ui/craft_denial_line_view';

describe('craft_denial_line_view', () => {
  it('maps every plain denial reason to its literal key', () => {
    const cases = [
      ['unknown_recipe', 'hudChrome.crafting.unknownRecipe'],
      ['combo_requirement_unmet', 'hudChrome.crafting.comboRequirementUnmet'],
      ['busy', 'hudChrome.crafting.busy'],
      ['throttled', 'hudChrome.crafting.busy'],
      ['recipe_not_learned', 'hudChrome.crafting.recipeNotLearned'],
      ['no_bag_space', 'hudChrome.crafting.noBagSpace'],
      ['daily_limit', 'hudChrome.crafting.dailyLimit'],
      ['insufficient_materials', 'hudChrome.crafting.insufficientMaterials'],
    ] as const;
    for (const [reason, key] of cases) {
      expect(craftDenialLine(reason, undefined)).toEqual({ key });
      // A recipe station type on a non-station denial never leaks into the
      // line: the type is read for the station_required arm alone.
      expect(craftDenialLine(reason, 'forge')).toEqual({ key });
    }
    // Completeness: the hand-written table above covers the WHOLE reason
    // union. The KEYS stay literal (independent expectations, never derived
    // from the Record, which would be a self-comparison); only MEMBERSHIP is
    // derived, so a tenth reason that satisfies tsc-exhaustiveness with a
    // copy-pasted key still reds here until the table gains its row.
    expect(Object.keys(DENIAL_KEY_BY_REASON).sort()).toEqual(
      [...cases.map(([reason]) => reason), 'station_required'].sort(),
    );
  });

  it('an absent reason reads as the generic materials line (the historical fall-through)', () => {
    expect(craftDenialLine(undefined, undefined)).toEqual({
      key: 'hudChrome.crafting.insufficientMaterials',
    });
  });

  it('station_required with a resolvable recipe names the station', () => {
    expect(craftDenialLine('station_required', 'apothecary')).toEqual({
      key: 'hudChrome.crafting.stationRequired',
      stationType: 'apothecary',
    });
  });

  it('station_required with an unresolvable recipe falls through to the materials line', () => {
    expect(craftDenialLine('station_required', undefined)).toEqual({
      key: 'hudChrome.crafting.insufficientMaterials',
    });
  });
});
