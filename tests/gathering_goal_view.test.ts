// Pure-core tests for the gathering goal panel's view model
// (src/ui/hud/professions/gathering_goal_view.ts, Intentional Gathering PR4).
// DOM-free by construction (no import of the painter here); the painter's
// own behavior (callback wiring, focus carry) is covered by
// tests/gathering_goal_painter.test.ts.

import { describe, expect, it } from 'vitest';
import type {
  GatheringGoalIdentity,
  GatheringGoalMaterial,
  GatheringGoalView,
} from '../src/sim/professions/gathering_goal_types';
import type { HarvestPreference } from '../src/sim/professions/harvest_preference';
import type { ItemDef } from '../src/sim/types';
import { buildGatheringGoalPanelModel } from '../src/ui/hud/professions/gathering_goal_view';

function material(overrides: Partial<GatheringGoalMaterial> = {}): GatheringGoalMaterial {
  return {
    itemId: 'rough_hide',
    required: 10,
    carried: 0,
    stored: 0,
    reachable: 0,
    missing: 10,
    inaccessible: 0,
    ...overrides,
  };
}

function view(overrides: Partial<GatheringGoalView> = {}): GatheringGoalView {
  return {
    goal: null,
    status: 'collecting',
    reason: null,
    materials: [],
    payableCrafts: 0,
    storageRestricted: false,
    ...overrides,
  };
}

function item(id: string): ItemDef {
  return { id, name: id, quality: 'common', kind: 'junk', sellValue: 0 } as unknown as ItemDef;
}

const ITEMS: Record<string, ItemDef> = {
  rough_hide: item('rough_hide'),
  iron_ore: item('iron_ore'),
  iron_pick: item('iron_pick'),
};

const RECIPE_LOOKUP = (recipeId: string) =>
  recipeId === 'recipe_iron_pick'
    ? { resultItemId: 'iron_pick', resultCount: 1 }
    : recipeId === 'recipe_stack'
      ? { resultItemId: 'iron_pick', resultCount: 5 }
      : undefined;

describe('buildGatheringGoalPanelModel: read-only construction', () => {
  it('a null goal projects to a null-goal model with no materials, and mutates no input', () => {
    const v = view();
    const frozenItems = Object.freeze({ ...ITEMS });
    const model = buildGatheringGoalPanelModel(v, frozenItems, RECIPE_LOOKUP);
    expect(model.goal).toBeNull();
    expect(model.materials).toEqual([]);
    expect(model.resultItemId).toBeNull();
    expect(model.result).toBeUndefined();
    expect(model.craftCount).toBeNull();
    expect(model.displayCount).toBeNull();
    // The input view is untouched (same reference-equal empty arrays it was
    // built with), proving the core never mutates its arguments.
    expect(v.materials).toHaveLength(0);
  });

  it('never mutates the materials array or its rows', () => {
    const mat = material({ itemId: 'iron_ore', required: 5, reachable: 5 });
    const v = view({
      goal: { kind: 'recipe', recipeId: 'recipe_iron_pick', count: 1 },
      materials: [mat],
    });
    const snapshotBefore = JSON.stringify(mat);
    buildGatheringGoalPanelModel(v, ITEMS, RECIPE_LOOKUP);
    expect(JSON.stringify(mat)).toBe(snapshotBefore);
  });
});

describe('buildGatheringGoalPanelModel: craft count vs total output', () => {
  // recipe_stack produces 5 units per craft (RECIPE_LOOKUP above): the
  // multi-output pin this describe block exists for.
  const goalRecipe: GatheringGoalIdentity = { kind: 'recipe', recipeId: 'recipe_stack', count: 7 };
  const goalCommission: GatheringGoalIdentity = {
    kind: 'commission',
    recipeId: 'recipe_stack',
    orderId: 42,
    count: 1,
  };

  it('a recipe goal reports craftCount as its OWN tracked count, and displayCount as the TOTAL OUTPUT (craftCount * resultCount)', () => {
    const model = buildGatheringGoalPanelModel(view({ goal: goalRecipe }), ITEMS, RECIPE_LOOKUP);
    expect(model.goal).toEqual(goalRecipe);
    expect(model.resultItemId).toBe('iron_pick');
    expect(model.result).toBe(ITEMS.iron_pick);
    // 7 crafts of a 5-per-craft recipe: 35 total items, never 7.
    expect(model.craftCount).toBe(7);
    expect(model.displayCount).toBe(35);
  });

  it('a single-output recipe (resultCount 1) has craftCount === displayCount', () => {
    const model = buildGatheringGoalPanelModel(
      view({ goal: { kind: 'recipe', recipeId: 'recipe_iron_pick', count: 4 } }),
      ITEMS,
      RECIPE_LOOKUP,
    );
    expect(model.craftCount).toBe(4);
    expect(model.displayCount).toBe(4);
  });

  it('a commission is exactly ONE craft of the authoritative recipe: craftCount is 1, displayCount is the recipe resultCount', () => {
    const model = buildGatheringGoalPanelModel(
      view({ goal: goalCommission }),
      ITEMS,
      RECIPE_LOOKUP,
    );
    expect(model.goal).toEqual(goalCommission);
    expect(model.resultItemId).toBe('iron_pick');
    expect(model.craftCount).toBe(1);
    expect(model.displayCount).toBe(5);
  });

  it('an unresolvable recipe id (retired/unknown) yields a null result, craftCount, and displayCount', () => {
    const model = buildGatheringGoalPanelModel(
      view({
        goal: { kind: 'recipe', recipeId: 'no_such_recipe', count: 3 },
        status: 'unavailable',
        reason: 'unknown_recipe',
      }),
      ITEMS,
      RECIPE_LOOKUP,
    );
    expect(model.resultItemId).toBeNull();
    expect(model.result).toBeUndefined();
    expect(model.craftCount).toBeNull();
    expect(model.displayCount).toBeNull();
    expect(model.status).toBe('unavailable');
    expect(model.reason).toBe('unknown_recipe');
  });
});

describe('buildGatheringGoalPanelModel: material rows echo the sim DTO verbatim (no client-side discount)', () => {
  it('passes required/carried/stored/reachable/missing/inaccessible through byte-identical', () => {
    const mat = material({
      itemId: 'iron_ore',
      required: 12,
      carried: 3,
      stored: 4,
      reachable: 5,
      missing: 7,
      inaccessible: 2,
    });
    const model = buildGatheringGoalPanelModel(
      view({ goal: { kind: 'recipe', recipeId: 'recipe_iron_pick', count: 1 }, materials: [mat] }),
      ITEMS,
      RECIPE_LOOKUP,
    );
    const row = model.materials[0];
    expect(row.required).toBe(12);
    expect(row.carried).toBe(3);
    expect(row.stored).toBe(4);
    expect(row.reachable).toBe(5);
    expect(row.missing).toBe(7);
    expect(row.inaccessible).toBe(2);
  });

  it.each([
    { reachable: 5, required: 5, expectSatisfied: true },
    { reachable: 6, required: 5, expectSatisfied: true },
    { reachable: 4, required: 5, expectSatisfied: false },
    { reachable: 0, required: 1, expectSatisfied: false },
  ])(
    'satisfied is exactly reachable >= required ($reachable of $required -> $expectSatisfied)',
    ({ reachable, required, expectSatisfied }) => {
      const model = buildGatheringGoalPanelModel(
        view({
          goal: { kind: 'recipe', recipeId: 'recipe_iron_pick', count: 1 },
          materials: [material({ itemId: 'iron_ore', required, reachable })],
        }),
        ITEMS,
        RECIPE_LOOKUP,
      );
      expect(model.materials[0].satisfied).toBe(expectSatisfied);
    },
  );

  it('exposes an ITEM lookup miss as undefined, never a thrown error', () => {
    const model = buildGatheringGoalPanelModel(
      view({
        goal: { kind: 'recipe', recipeId: 'recipe_iron_pick', count: 1 },
        materials: [material({ itemId: 'no_such_item' })],
      }),
      ITEMS,
      RECIPE_LOOKUP,
    );
    expect(model.materials[0].item).toBeUndefined();
    expect(model.materials[0].itemId).toBe('no_such_item');
  });

  it('a prototype-shaped material id (knownItemDef) resolves to undefined, never the inherited function', () => {
    const model = buildGatheringGoalPanelModel(
      view({
        goal: { kind: 'recipe', recipeId: 'recipe_iron_pick', count: 1 },
        materials: [material({ itemId: 'constructor' })],
      }),
      ITEMS,
      RECIPE_LOOKUP,
    );
    expect(model.materials[0].item).toBeUndefined();
  });

  it('a prototype-shaped RESULT recipeId resolves to no item either', () => {
    const items: Record<string, ItemDef> = { ...ITEMS };
    const model = buildGatheringGoalPanelModel(
      view({ goal: { kind: 'recipe', recipeId: 'recipe_iron_pick', count: 1 } }),
      items,
      () => ({ resultItemId: 'constructor', resultCount: 1 }),
    );
    expect(model.result).toBeUndefined();
  });
});

describe('buildGatheringGoalPanelModel: source hints, exact family membership', () => {
  it('a mined material rows as its own family with no corpse preference target', () => {
    const model = buildGatheringGoalPanelModel(
      view({
        goal: { kind: 'recipe', recipeId: 'recipe_iron_pick', count: 1 },
        materials: [material({ itemId: 'iron_ore' })],
      }),
      ITEMS,
      RECIPE_LOOKUP,
    );
    expect(model.materials[0].sourceFamilyId).toBe('mining');
    expect(model.materials[0].corpsePreferenceItemId).toBeNull();
  });

  it('a corpse-harvest material rows the corpse family with itself as the preference target', () => {
    const model = buildGatheringGoalPanelModel(
      view({
        goal: { kind: 'recipe', recipeId: 'recipe_iron_pick', count: 1 },
        materials: [material({ itemId: 'rough_hide' })],
      }),
      ITEMS,
      RECIPE_LOOKUP,
    );
    expect(model.materials[0].sourceFamilyId).toBe('corpseHarvesting');
    expect(model.materials[0].corpsePreferenceItemId).toBe('rough_hide');
  });

  it('a Pristine specimen material rows the corpse family with its ORDINARY material as the target', () => {
    const model = buildGatheringGoalPanelModel(
      view({
        goal: { kind: 'recipe', recipeId: 'recipe_iron_pick', count: 1 },
        materials: [material({ itemId: 'pristine_hide' })],
      }),
      ITEMS,
      RECIPE_LOOKUP,
    );
    expect(model.materials[0].sourceFamilyId).toBe('corpseHarvesting');
    expect(model.materials[0].corpsePreferenceItemId).toBe('rough_hide');
  });

  it('a material no gathering family supplies rows null, never a counterfeit family', () => {
    const model = buildGatheringGoalPanelModel(
      view({
        goal: { kind: 'recipe', recipeId: 'recipe_iron_pick', count: 1 },
        materials: [material({ itemId: 'gold_coin' })],
      }),
      ITEMS,
      RECIPE_LOOKUP,
    );
    expect(model.materials[0].sourceFamilyId).toBeNull();
    expect(model.materials[0].corpsePreferenceItemId).toBeNull();
  });
});

describe('buildGatheringGoalPanelModel: isCurrentHarvestPreference reads the AUTHORITATIVE preference, never the shortcut target alone', () => {
  function corpseModel(harvestPreference: HarvestPreference | null) {
    return buildGatheringGoalPanelModel(
      view({
        goal: { kind: 'recipe', recipeId: 'recipe_iron_pick', count: 1 },
        materials: [material({ itemId: 'rough_hide' })],
      }),
      ITEMS,
      RECIPE_LOOKUP,
      harvestPreference,
    );
  }

  it('defaults to false when no harvestPreference is passed at all', () => {
    const model = buildGatheringGoalPanelModel(
      view({
        goal: { kind: 'recipe', recipeId: 'recipe_iron_pick', count: 1 },
        materials: [material({ itemId: 'rough_hide' })],
      }),
      ITEMS,
      RECIPE_LOOKUP,
    );
    expect(model.materials[0].isCurrentHarvestPreference).toBe(false);
  });

  it('is false for the "all" preference, even on a row with a real shortcut target', () => {
    expect(corpseModel({ kind: 'all' }).materials[0].isCurrentHarvestPreference).toBe(false);
  });

  it('is false when the preference names a DIFFERENT material', () => {
    expect(
      corpseModel({ kind: 'material', itemId: 'iron_ore' }).materials[0].isCurrentHarvestPreference,
    ).toBe(false);
  });

  it("is true exactly when the preference names this row's corpsePreferenceItemId", () => {
    expect(
      corpseModel({ kind: 'material', itemId: 'rough_hide' }).materials[0]
        .isCurrentHarvestPreference,
    ).toBe(true);
  });

  it('is always false for a row with no corpsePreferenceItemId, even if a material preference happens to match the itemId', () => {
    const model = buildGatheringGoalPanelModel(
      view({
        goal: { kind: 'recipe', recipeId: 'recipe_iron_pick', count: 1 },
        materials: [material({ itemId: 'iron_ore' })],
      }),
      ITEMS,
      RECIPE_LOOKUP,
      { kind: 'material', itemId: 'iron_ore' },
    );
    expect(model.materials[0].corpsePreferenceItemId).toBeNull();
    expect(model.materials[0].isCurrentHarvestPreference).toBe(false);
  });
});

describe('buildGatheringGoalPanelModel: status/reason/payable/storage pass through untouched', () => {
  it.each([
    ['collecting', null] as const,
    ['ready', null] as const,
    ['unavailable', 'daily_limit'] as const,
    ['unavailable', 'batch_limit'] as const,
    ['unavailable', 'commission_unavailable'] as const,
    ['delivered', null] as const,
    ['cancelled', null] as const,
    ['expired', null] as const,
  ])('status %s with reason %s is not reinterpreted', (status, reason) => {
    const model = buildGatheringGoalPanelModel(
      view({ goal: { kind: 'recipe', recipeId: 'recipe_iron_pick', count: 1 }, status, reason }),
      ITEMS,
      RECIPE_LOOKUP,
    );
    expect(model.status).toBe(status);
    expect(model.reason).toBe(reason);
  });

  it('payableCrafts and storageRestricted pass through verbatim', () => {
    const model = buildGatheringGoalPanelModel(
      view({
        goal: { kind: 'recipe', recipeId: 'recipe_iron_pick', count: 1 },
        payableCrafts: 4,
        storageRestricted: true,
      }),
      ITEMS,
      RECIPE_LOOKUP,
    );
    expect(model.payableCrafts).toBe(4);
    expect(model.storageRestricted).toBe(true);
  });
});
