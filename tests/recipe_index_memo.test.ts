import { afterAll, describe, expect, it } from 'vitest';

// The recipe index memo contract (src/sim/content/recipes.ts
// ensureRecipeIndexes): recipeById and recipeForResultItem are served from two
// lazily built Maps that rebuild whenever ALL_RECIPES.length changes. Building
// those maps ONCE at module load was rejected deliberately (see
// docs/prd/masterwrought/state.md, phase 09 review record: "the pattern suites
// push synthetic recipes at runtime, so load-frozen maps were rejected
// deliberately"), so nothing here proposes freezing them, a WeakMap, or any
// other keying. What was missing is a pin on the rebuild contract itself:
// every live pusher (tests/recipe_pattern_items.test.ts,
// tests/recipe_pattern_tooltip_view.test.ts) depends on a push being visible
// to recipeById, and on the splice-restore in afterAll making it invisible
// again, but each of those suites reads the recipes it pushed and would still
// pass against a plain linear scan. This suite drives the memo directly: it
// pins that growth and shrink both invalidate, and that the ONE case the
// source comment concedes is outside the contract, a same-length in-place row
// swap, is served stale. That last arm is a limitation pin, not a bug report.
//
// Fixtures follow the push/splice idiom the pattern suites use (push onto the
// live ALL_RECIPES, splice by identity in afterAll). The suite restores the
// array inside each test and asserts at the end that ALL_RECIPES is identical
// to the snapshot taken at load, row identity included.

import { ALL_RECIPES, recipeById, recipeForResultItem } from '../src/sim/content/recipes';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';

// Snapshot taken before any fixture is pushed: the end-of-suite integrity arm
// compares against this, by identity per row, not just by length.
const BASELINE: readonly ProfessionRecipeRecord[] = [...ALL_RECIPES];
const BASELINE_LENGTH = ALL_RECIPES.length;

// The first shipped row. First-insertion-wins in ensureRecipeIndexes makes
// this the one id whose lookup result is identity-decidable no matter what
// else the table holds, which is what makes it a safe memo-warming probe.
const FIRST_SHIPPED = BASELINE[0];

/** Minimal valid ProfessionRecipeRecord: every required field, nothing else. */
function syntheticRecipe(id: string, resultItemId: string): ProfessionRecipeRecord {
  return {
    id,
    professionId: 'alchemy',
    resultItemId,
    resultCount: 1,
    reagents: [{ itemId: 'bone_fragments', count: 1 }],
    skillReq: 0,
    itemLevelBudget: 1,
    level: 1,
  };
}

const ID_PROBE = syntheticRecipe('recipe_test_memo_id_probe', 'test_memo_id_probe_item');
const RESULT_PROBE = syntheticRecipe(
  'recipe_test_memo_result_probe',
  'test_memo_result_probe_item',
);
const SWAP_BASE = syntheticRecipe('recipe_test_memo_swap_base', 'test_memo_swap_base_item');
const SWAP_VARIANT = syntheticRecipe(
  'recipe_test_memo_swap_variant',
  'test_memo_swap_variant_item',
);
const FILLER = syntheticRecipe('recipe_test_memo_filler', 'test_memo_filler_item');

const FIXTURES = [ID_PROBE, RESULT_PROBE, SWAP_BASE, SWAP_VARIANT, FILLER];

// Safety net only: every test below restores the array itself, so a green run
// never needs this. It matters when an assertion throws mid-mutation, which
// would otherwise leave a synthetic row visible to the integrity arm.
afterAll(() => {
  for (const recipe of FIXTURES) {
    const at = ALL_RECIPES.indexOf(recipe);
    if (at >= 0) ALL_RECIPES.splice(at, 1);
  }
});

/**
 * Force the lazy index to be built for the array's CURRENT length, so the
 * mutation under test is the only thing that can trigger the next rebuild.
 */
function warmIndex(): void {
  expect(recipeById(FIRST_SHIPPED.id)).toBe(FIRST_SHIPPED);
}

describe('recipe index memo rebuild contract', () => {
  it('rebuilds on growth: recipeById sees a recipe pushed after the memo was warmed', () => {
    warmIndex();
    expect(recipeById(ID_PROBE.id)).toBeUndefined();

    ALL_RECIPES.push(ID_PROBE);
    expect(recipeById(ID_PROBE.id)).toBe(ID_PROBE);

    ALL_RECIPES.splice(ALL_RECIPES.indexOf(ID_PROBE), 1);
    expect(ALL_RECIPES.length).toBe(BASELINE_LENGTH);
  });

  it('rebuilds on shrink: recipeById drops a recipe spliced out after the memo was warmed', () => {
    ALL_RECIPES.push(ID_PROBE);
    // Warm at the GROWN length, so the map under test actually holds the row.
    expect(recipeById(ID_PROBE.id)).toBe(ID_PROBE);

    ALL_RECIPES.splice(ALL_RECIPES.indexOf(ID_PROBE), 1);
    expect(recipeById(ID_PROBE.id)).toBeUndefined();
    // The shrink rebuild must not have damaged the shipped rows it kept.
    expect(recipeById(FIRST_SHIPPED.id)).toBe(FIRST_SHIPPED);
    expect(ALL_RECIPES.length).toBe(BASELINE_LENGTH);
  });

  it('rebuilds on growth: recipeForResultItem sees a recipe pushed after warming', () => {
    warmIndex();
    expect(recipeForResultItem(RESULT_PROBE.resultItemId)).toBeUndefined();

    ALL_RECIPES.push(RESULT_PROBE);
    expect(recipeForResultItem(RESULT_PROBE.resultItemId)).toBe(RESULT_PROBE);

    ALL_RECIPES.splice(ALL_RECIPES.indexOf(RESULT_PROBE), 1);
    expect(ALL_RECIPES.length).toBe(BASELINE_LENGTH);
  });

  it('rebuilds on shrink: recipeForResultItem drops a recipe spliced out after warming', () => {
    ALL_RECIPES.push(RESULT_PROBE);
    expect(recipeForResultItem(RESULT_PROBE.resultItemId)).toBe(RESULT_PROBE);

    ALL_RECIPES.splice(ALL_RECIPES.indexOf(RESULT_PROBE), 1);
    expect(recipeForResultItem(RESULT_PROBE.resultItemId)).toBeUndefined();
    expect(recipeForResultItem(FIRST_SHIPPED.resultItemId)).toBe(FIRST_SHIPPED);
    expect(ALL_RECIPES.length).toBe(BASELINE_LENGTH);
  });

  // CONTRACT DOCUMENTATION, not a defect report. The source comment states it
  // outright: "a same-length in-place swap is outside the contract (nothing
  // replaces rows)", and the load-frozen alternative was rejected deliberately
  // per docs/prd/masterwrought/state.md. The assertions below therefore pin the
  // DOCUMENTED limitation rather than argue with it: replacing a row in place
  // keeps the length unchanged, the length is the whole cache key, so the old
  // row keeps being served. If someone later changes the keying (a revision
  // counter, a content hash, an explicit invalidate call), these expectations
  // flip and this test goes red, which is the point: the keying change shows up
  // as a deliberate diff here instead of silently altering the contract.
  it('serves a same-length in-place row swap stale (the documented limitation)', () => {
    ALL_RECIPES.push(SWAP_BASE);
    const at = ALL_RECIPES.indexOf(SWAP_BASE);
    // Warm at the grown length so the swap cannot ride a rebuild that a later
    // lookup would have triggered anyway.
    expect(recipeById(SWAP_BASE.id)).toBe(SWAP_BASE);

    // The out-of-contract mutation: one row replaced, length untouched.
    ALL_RECIPES[at] = SWAP_VARIANT;
    expect(ALL_RECIPES.length).toBe(BASELINE_LENGTH + 1);

    // Stale by design, both indexes: the new row is invisible and the row that
    // is no longer in the array is still handed back.
    expect(recipeById(SWAP_VARIANT.id)).toBeUndefined();
    expect(recipeById(SWAP_BASE.id)).toBe(SWAP_BASE);
    expect(recipeForResultItem(SWAP_VARIANT.resultItemId)).toBeUndefined();
    expect(recipeForResultItem(SWAP_BASE.resultItemId)).toBe(SWAP_BASE);

    // Prove the length key is the SOLE reason for the misses above: with the
    // swapped row still installed, change nothing but the length and both
    // readings invert immediately.
    ALL_RECIPES.push(FILLER);
    expect(recipeById(SWAP_VARIANT.id)).toBe(SWAP_VARIANT);
    expect(recipeById(SWAP_BASE.id)).toBeUndefined();
    expect(recipeForResultItem(SWAP_VARIANT.resultItemId)).toBe(SWAP_VARIANT);

    ALL_RECIPES.splice(ALL_RECIPES.indexOf(FILLER), 1);
    ALL_RECIPES[at] = SWAP_BASE;
    expect(ALL_RECIPES[at]).toBe(SWAP_BASE);
    ALL_RECIPES.splice(at, 1);
    expect(ALL_RECIPES.length).toBe(BASELINE_LENGTH);
    expect(recipeById(SWAP_BASE.id)).toBeUndefined();
  });

  it('leaves ALL_RECIPES exactly as it found it', () => {
    expect(ALL_RECIPES.length).toBe(BASELINE_LENGTH);
    // Identity per row, not deep equality: an in-place swap for a structurally
    // identical clone would pass a toEqual and still have moved the array.
    for (let i = 0; i < BASELINE_LENGTH; i++) {
      expect(ALL_RECIPES[i]).toBe(BASELINE[i]);
    }
    for (const fixture of FIXTURES) {
      expect(ALL_RECIPES.indexOf(fixture)).toBe(-1);
    }
    // And the live readers agree with the restored array.
    expect(recipeById(FIRST_SHIPPED.id)).toBe(FIRST_SHIPPED);
  });
});
