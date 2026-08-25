// The craft-deny message table (src/ui/crafting_deny_core.ts): every refusal
// reason a craftResult event can carry maps to exactly the key hud.ts's log
// arm rendered before the extraction, and the station arm resolves the
// station type from recipe content. Inputs are plain event fields, identical
// from the offline Sim and the ClientWorld mirror by construction (the event
// union is shared), so one table drives both hosts.
import { describe, expect, it } from 'vitest';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { type CraftDenyReason, craftDenyMessage } from '../src/ui/crafting_deny_core';

describe('craftDenyMessage', () => {
  it('maps every non-station reason to its key, unknown and absent to the materials line', () => {
    const cases: Array<[CraftDenyReason | undefined, string]> = [
      ['unknown_recipe', 'hudChrome.crafting.unknownRecipe'],
      ['combo_requirement_unmet', 'hudChrome.crafting.comboRequirementUnmet'],
      ['busy', 'hudChrome.crafting.busy'],
      ['throttled', 'hudChrome.crafting.busy'],
      ['recipe_not_learned', 'hudChrome.crafting.recipeNotLearned'],
      ['locked', 'hudChrome.crafting.reagentLocked'],
      ['no_bag_space', 'hudChrome.crafting.noBagSpace'],
      ['insufficient_materials', 'hudChrome.crafting.insufficientMaterials'],
      [undefined, 'hudChrome.crafting.insufficientMaterials'],
    ];
    for (const [reason, key] of cases) {
      const msg = craftDenyMessage(reason, 'not-a-recipe');
      expect(msg.key, String(reason)).toBe(key);
      expect(msg.stationType, String(reason)).toBeUndefined();
    }
  });

  it('covers the reason union exhaustively, so a new reason cannot fall through silently', () => {
    // A tenth member added to the craftResult reason union would fall to the
    // generic materials line with no red test; this table is the pin that
    // forces the mapping decision. `satisfies` makes tsc the enforcer.
    const table = {
      unknown_recipe: 'hudChrome.crafting.unknownRecipe',
      insufficient_materials: 'hudChrome.crafting.insufficientMaterials',
      locked: 'hudChrome.crafting.reagentLocked',
      combo_requirement_unmet: 'hudChrome.crafting.comboRequirementUnmet',
      recipe_not_learned: 'hudChrome.crafting.recipeNotLearned',
      throttled: 'hudChrome.crafting.busy',
      busy: 'hudChrome.crafting.busy',
      station_required: 'hudChrome.crafting.stationRequired',
      no_bag_space: 'hudChrome.crafting.noBagSpace',
    } satisfies Record<CraftDenyReason, string>;
    for (const [reason, key] of Object.entries(table)) {
      if (reason === 'station_required') continue;
      expect(craftDenyMessage(reason as CraftDenyReason, 'not-a-recipe').key, reason).toBe(key);
    }
  });

  it('a non-station reason on a REAL station recipe never claims a station is required', () => {
    // The guard's reason conjunct alone separates this from station_required:
    // without it, every refusal on a station recipe would say "requires a
    // station" whatever actually refused the craft.
    const stationRecipe = ALL_RECIPES.find((r) => r.stationType);
    if (!stationRecipe) throw new Error('content invariant: no station recipe exists');
    const msg = craftDenyMessage('locked', stationRecipe.id);
    expect(msg.key).toBe('hudChrome.crafting.reagentLocked');
    expect(msg.stationType).toBeUndefined();
  });

  it('station_required resolves the recipe station and falls back when unresolvable', () => {
    const stationRecipe = ALL_RECIPES.find((r) => r.stationType);
    if (!stationRecipe) throw new Error('content invariant: no station recipe exists');
    const resolved = craftDenyMessage('station_required', stationRecipe.id);
    expect(resolved.key).toBe('hudChrome.crafting.stationRequired');
    expect(resolved.stationType).toBe(stationRecipe.stationType);
    // A stationless recipe and an unknown id both fall through to the
    // generic materials line (the pre-extraction ternary's final else).
    const stationless = ALL_RECIPES.find((r) => !r.stationType);
    if (!stationless) throw new Error('content invariant: no stationless recipe exists');
    expect(craftDenyMessage('station_required', stationless.id)).toEqual({
      key: 'hudChrome.crafting.insufficientMaterials',
    });
    expect(craftDenyMessage('station_required', 'not-a-recipe')).toEqual({
      key: 'hudChrome.crafting.insufficientMaterials',
    });
  });
});
