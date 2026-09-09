import { describe, expect, it } from 'vitest';
import type { MaterialsVaultState } from '../src/sim/materials_vault';
import {
  MATERIAL_GOAL_MAX_QUANTITY,
  MATERIAL_GOAL_MIN_QUANTITY,
  type ProjectMaterialGoalReagentsInput,
  projectMaterialGoalReagents,
} from '../src/sim/professions/material_goal_projection';
import type { ProfessionReagent, ProfessionRecipeRecord } from '../src/sim/professions/types';
import type { InvSlot } from '../src/sim/types';

// The pure material-goal projection (intentional gathering PR4). No Sim, no
// SimContext: every fixture below is a hand-built InvSlot/recipe literal, and
// every expected number is a worked-by-hand total, never derived by calling
// crafting.ts's own resolvers first (that would just be pinning whatever this
// module happens to compute).

const CRAFT_ID = 'leatherworking'; // a real CRAFT_RING id: requiredReagentCountFor's
// specialization lookup (wheel.ts thresholdFor) throws on an unknown craft id.

function makeRecipe(
  reagents: readonly ProfessionReagent[],
  overrides: Partial<ProfessionRecipeRecord> = {},
): ProfessionRecipeRecord {
  return {
    id: 'recipe_test_goal',
    professionId: CRAFT_ID,
    resultItemId: 'test_output',
    resultCount: 1,
    reagents,
    skillReq: 0,
    itemLevelBudget: 1,
    level: 1,
    ...overrides,
  };
}

function plainSlot(itemId: string, count: number): InvSlot {
  return { itemId, count };
}

function signedSlot(itemId: string, count: number, signer: string): InvSlot {
  return { itemId, count, instance: { signer } };
}

function lockedSlot(itemId: string, count: number): InvSlot {
  return { itemId, count, instance: { locked: true } };
}

function emptyVault(stock: Record<string, number> = {}): MaterialsVaultState {
  return { stock, special: [], upgrades: 0 };
}

const CRAFTER_NAME = 'Reuben';

function baseInput(
  overrides: Partial<ProjectMaterialGoalReagentsInput>,
): ProjectMaterialGoalReagentsInput {
  return {
    recipe: makeRecipe([]),
    quantity: 1,
    crafterName: CRAFTER_NAME,
    craftSkills: {},
    jackAttuned: false,
    carriedInventory: [],
    bankInventory: [],
    vault: emptyVault(),
    drawableVaultStock: null,
    ...overrides,
  };
}

describe('invalid quantities and empty recipes', () => {
  it('refuses quantity 0 without clamping into quantity 1', () => {
    const result = projectMaterialGoalReagents(baseInput({ quantity: 0 }));
    expect(result).toEqual({ ok: false, reason: 'invalid_quantity' });
  });

  it('refuses quantity past the 50 ceiling without clamping to 50', () => {
    const result = projectMaterialGoalReagents(
      baseInput({ quantity: MATERIAL_GOAL_MAX_QUANTITY + 1 }),
    );
    expect(result).toEqual({ ok: false, reason: 'invalid_quantity' });
  });

  it('refuses a non-integer quantity', () => {
    const result = projectMaterialGoalReagents(baseInput({ quantity: 2.5 }));
    expect(result).toEqual({ ok: false, reason: 'invalid_quantity' });
  });

  it('refuses NaN and negative quantities', () => {
    expect(projectMaterialGoalReagents(baseInput({ quantity: Number.NaN }))).toEqual({
      ok: false,
      reason: 'invalid_quantity',
    });
    expect(projectMaterialGoalReagents(baseInput({ quantity: -1 }))).toEqual({
      ok: false,
      reason: 'invalid_quantity',
    });
  });

  it('accepts the boundary quantities 1 and 50', () => {
    expect(
      projectMaterialGoalReagents(baseInput({ quantity: MATERIAL_GOAL_MIN_QUANTITY })).ok,
    ).toBe(true);
    expect(
      projectMaterialGoalReagents(baseInput({ quantity: MATERIAL_GOAL_MAX_QUANTITY })).ok,
    ).toBe(true);
  });

  it('an empty reagent list is trivially ready for the whole target quantity', () => {
    const result = projectMaterialGoalReagents(baseInput({ recipe: makeRecipe([]), quantity: 5 }));
    expect(result).toMatchObject({
      ok: true,
      rows: [],
      allMaterialsReady: true,
      payableCraftCount: 5,
    });
  });
});

describe('per-craft self-signed discount expiry (no one-shot multiplication)', () => {
  it('2 base units (1 self-signed) plus 6 ordinary fine grade: three crafts, not the naive four', () => {
    // Declared count 3, discounted to 2 while the self-signed base copy is
    // held. The base grade holds exactly 2 units total (signed + plain), so
    // craft 1 (required 2, discounted) drains BOTH of them at once: the
    // discount cannot survive past the craft that happens to exhaust the
    // grade it was read from. From craft 2 on there is no self-signed copy
    // left anywhere (fine grade included), so the full listed count (3)
    // applies against the fine stock alone: 3, then 3, then a fourth craft
    // needs 3 more and finds none. A NAIVE floor(8 units / 2 discounted) = 4
    // would overpromise; the true answer is 3.
    const recipe = makeRecipe([{ itemId: 'copper_ore', count: 3 }]);
    const carriedInventory: InvSlot[] = [
      plainSlot('copper_ore', 1),
      signedSlot('copper_ore', 1, CRAFTER_NAME),
      plainSlot('fine_copper_ore', 6),
    ];

    const result = projectMaterialGoalReagents(
      baseInput({ recipe, quantity: 4, carriedInventory }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.payableCraftCount).toBe(3);
    expect(result.allMaterialsReady).toBe(false);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.itemId).toBe('copper_ore');
    // 2 (craft1, discounted) + 3 + 3 + 3 (craft4, undiscounted throughout).
    expect(row.requiredCount).toBe(11);
    // 2 + 3 + 3 paid in full; craft4 finds nothing left to draw.
    expect(row.reachableCount).toBe(8);
    expect(row.missingCount).toBe(3);
    expect(row.materialReady).toBe(false);
  });

  it('premium-last retention: a surviving self-signed copy discounts every craft it outlives', () => {
    // Plain stock alone (6) covers two discounted crafts (3 + 3) without ever
    // touching the single self-signed fine copy, so the discount holds for
    // BOTH requested crafts, matching crafting.ts's own hold-not-spend rule
    // (material_grade_substitution.test.ts).
    const recipe = makeRecipe([{ itemId: 'copper_ore', count: 4 }]);
    const carriedInventory: InvSlot[] = [
      plainSlot('copper_ore', 6),
      signedSlot('fine_copper_ore', 1, CRAFTER_NAME),
    ];

    const result = projectMaterialGoalReagents(
      baseInput({ recipe, quantity: 2, carriedInventory }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.payableCraftCount).toBe(2);
    const row = result.rows[0];
    expect(row.requiredCount).toBe(6); // 3 + 3, discounted both times
    expect(row.reachableCount).toBe(6);
    expect(row.missingCount).toBe(0);
    expect(row.materialReady).toBe(true);
  });

  it('7 ordinary + 1 non-self premium base: four crafts, the discount never fires', () => {
    // A signed copy belonging to someone else earns no quantity discount, so
    // this is a plain floor(8 / 2) = 4 with the premium unit counted as an
    // ordinary substitutable grade unit (per material_grade_substitution.ts,
    // grade substitution is signer-blind).
    const recipe = makeRecipe([{ itemId: 'copper_ore', count: 2 }]);
    const carriedInventory: InvSlot[] = [
      plainSlot('copper_ore', 7),
      signedSlot('fine_copper_ore', 1, 'Someone Else'),
    ];

    const result = projectMaterialGoalReagents(
      baseInput({ recipe, quantity: 4, carriedInventory }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.payableCraftCount).toBe(4);
    const row = result.rows[0];
    expect(row.requiredCount).toBe(8);
    expect(row.reachableCount).toBe(8);
    expect(row.missingCount).toBe(0);
    expect(row.materialReady).toBe(true);
  });
});

describe('source attribution with no premium gives no discount', () => {
  it('an all-ordinary stock is charged the full listed count', () => {
    const recipe = makeRecipe([{ itemId: 'copper_ore', count: 4 }]);
    const carriedInventory: InvSlot[] = [plainSlot('copper_ore', 4)];

    const result = projectMaterialGoalReagents(
      baseInput({ recipe, quantity: 1, carriedInventory }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const row = result.rows[0];
    expect(row.requiredCount).toBe(4);
    expect(row.reachableCount).toBe(4);
    expect(row.materialReady).toBe(true);
  });
});

describe('shared higher-grade substitute cannot satisfy two reagent rows', () => {
  it('one physical fine copy can pay only the first reagent row that claims it', () => {
    const recipe = makeRecipe([
      { itemId: 'copper_ore', count: 1 },
      { itemId: 'fine_copper_ore', count: 1 },
    ]);
    const carriedInventory: InvSlot[] = [plainSlot('fine_copper_ore', 1)];

    const result = projectMaterialGoalReagents(
      baseInput({ recipe, quantity: 1, carriedInventory }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.rows).toHaveLength(2);
    const [copperOreRow, fineCopperOreRow] = result.rows;
    // The copper_ore row is planned first (reagent order) and substitutes
    // the fine copy in, satisfying it in full.
    expect(copperOreRow.reachableCount).toBe(1);
    expect(copperOreRow.materialReady).toBe(true);
    // The SAME physical unit is gone: the fine_copper_ore row (which cannot
    // substitute upward) finds nothing left, in the bill AND the owned
    // allocation alike.
    expect(fineCopperOreRow.reachableCount).toBe(0);
    expect(fineCopperOreRow.carriedCount).toBe(0);
    expect(fineCopperOreRow.missingCount).toBe(1);
    expect(fineCopperOreRow.materialReady).toBe(false);
    // No craft is actually payable: the all-or-nothing batch planner refuses
    // the whole craft the moment either reagent line comes up short.
    expect(result.payableCraftCount).toBe(0);
  });
});

describe('bags-first then reachable vault', () => {
  it('carried units are drawn before the drawable vault stock', () => {
    const recipe = makeRecipe([{ itemId: 'copper_ore', count: 5 }]);
    const carriedInventory: InvSlot[] = [plainSlot('copper_ore', 2)];
    const vault = emptyVault({ copper_ore: 10 });

    const result = projectMaterialGoalReagents(
      baseInput({
        recipe,
        quantity: 1,
        carriedInventory,
        vault,
        drawableVaultStock: { copper_ore: 10 },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const row = result.rows[0];
    expect(row.requiredCount).toBe(5);
    expect(row.carriedCount).toBe(2);
    expect(row.storedCount).toBe(3); // capped at the remaining 3 the goal needs
    expect(row.reachableCount).toBe(5); // 2 carried + 3 drawn from the vault
    expect(row.missingCount).toBe(0);
    expect(row.inaccessibleCount).toBe(0);
    expect(row.materialReady).toBe(true);
    expect(result.payableCraftCount).toBe(1);
  });
});

describe('locked, banked, and restricted stock are visible but never promise a craft', () => {
  it('owned totals count locked bags, the personal bank, and a place-blocked vault; none of it is reachable', () => {
    const recipe = makeRecipe([{ itemId: 'copper_ore', count: 4 }]);
    const carriedInventory: InvSlot[] = [lockedSlot('copper_ore', 2)];
    const bankInventory: InvSlot[] = [plainSlot('copper_ore', 1)];
    const vault = emptyVault({ copper_ore: 1 });

    const result = projectMaterialGoalReagents(
      baseInput({
        recipe,
        quantity: 1,
        carriedInventory,
        bankInventory,
        vault,
        // Blocked from here (an instanced zone, or no vault at all): the
        // vault's real stock is invisible to the craft draw even though the
        // full vault state above still counts it as owned.
        drawableVaultStock: null,
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const row = result.rows[0];
    expect(row.requiredCount).toBe(4);
    expect(row.carriedCount).toBe(2); // the locked pair, visible as owned
    expect(row.storedCount).toBe(2); // 1 bank + 1 vault, visible as owned
    expect(row.missingCount).toBe(0); // owned totals cover the requirement
    expect(row.reachableCount).toBe(0); // locked, banked, and blocked: none spendable
    expect(row.inaccessibleCount).toBe(4);
    expect(row.materialReady).toBe(false);
    expect(result.payableCraftCount).toBe(0);
  });
});

describe('sibling reagent rows are priced from the SAME pre-craft inventory', () => {
  it('two copper_ore x2 rows against one self-signed unit: both discount, only one reaches it', () => {
    // Both rows list copper_ore x2, discounted to 1 while a self-signed
    // copy is HELD. The discount check must run against the state BEFORE
    // either row's consumption this craft, so row 2 still sees the
    // self-signed copy (it has not been spent yet from row 2's point of
    // view) even though row 1 is the one that will actually take the only
    // physical unit. required is [1, 1] on that basis; only one unit exists,
    // so reachable is [1, 0].
    const recipe = makeRecipe([
      { itemId: 'copper_ore', count: 2 },
      { itemId: 'copper_ore', count: 2 },
    ]);
    const carriedInventory: InvSlot[] = [signedSlot('copper_ore', 1, CRAFTER_NAME)];

    const result = projectMaterialGoalReagents(
      baseInput({ recipe, quantity: 1, carriedInventory }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.rows.map((row) => row.requiredCount)).toEqual([1, 1]);
    expect(result.rows.map((row) => row.reachableCount)).toEqual([1, 0]);
  });
});

describe('owned allocation reserves reachable takes before topping up', () => {
  it('two ordinary fine copies split across a copper_ore row and a fine_copper_ore row', () => {
    // quantity 2: craft 1 spends both physical fine copies (one substituting
    // for row 0's copper_ore, one paying row 1's own fine_copper_ore
    // directly); craft 2 finds nothing left. required [2, 2],
    // reachable [1, 1]. carried/stored must equal exactly what was actually
    // reachable (nothing left over to "own" beyond that), so carried [1, 1],
    // stored [0, 0], and missing [1, 1] (required - carried - stored).
    const recipe = makeRecipe([
      { itemId: 'copper_ore', count: 1 },
      { itemId: 'fine_copper_ore', count: 1 },
    ]);
    const carriedInventory: InvSlot[] = [plainSlot('fine_copper_ore', 2)];

    const result = projectMaterialGoalReagents(
      baseInput({ recipe, quantity: 2, carriedInventory }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.rows.map((row) => row.requiredCount)).toEqual([2, 2]);
    expect(result.rows.map((row) => row.reachableCount)).toEqual([1, 1]);
    expect(result.rows.map((row) => row.carriedCount)).toEqual([1, 1]);
    expect(result.rows.map((row) => row.storedCount)).toEqual([0, 0]);
    expect(result.rows.map((row) => row.missingCount)).toEqual([1, 1]);
    // Every row satisfies reachable <= carried + stored <= required.
    for (const row of result.rows) {
      expect(row.reachableCount).toBeLessThanOrEqual(row.carriedCount + row.storedCount);
      expect(row.carriedCount + row.storedCount).toBeLessThanOrEqual(row.requiredCount);
      expect(row.missingCount + row.carriedCount + row.storedCount).toBe(row.requiredCount);
    }
  });

  it('a locked bag substitute is visible as owned on top of a reachable fine substitute', () => {
    // row 0 (copper_ore x2) is only ever paid 1 unit (the one unlocked
    // fine_copper_ore, reachable), but owns a second unit via the LOCKED
    // copper_ore stack topping up its unmet requirement: carried [2],
    // inaccessible [1] (the locked unit, owned but never spendable). row 1
    // (fine_copper_ore x1) finds its only physical substitute already spent
    // by row 0's reachable draw, so it owns and reaches nothing.
    const recipe = makeRecipe([
      { itemId: 'copper_ore', count: 2 },
      { itemId: 'fine_copper_ore', count: 1 },
    ]);
    const carriedInventory: InvSlot[] = [
      lockedSlot('copper_ore', 3),
      plainSlot('fine_copper_ore', 1),
    ];

    const result = projectMaterialGoalReagents(
      baseInput({ recipe, quantity: 1, carriedInventory }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const [copperOreRow, fineCopperOreRow] = result.rows;
    expect(copperOreRow.reachableCount).toBe(1);
    expect(copperOreRow.carriedCount).toBe(2);
    expect(copperOreRow.storedCount).toBe(0);
    expect(copperOreRow.missingCount).toBe(0);
    expect(copperOreRow.inaccessibleCount).toBe(1);
    expect(copperOreRow.materialReady).toBe(false); // reachable 1 < required 2
    expect(fineCopperOreRow.reachableCount).toBe(0);
    expect(fineCopperOreRow.carriedCount).toBe(0);
    expect(fineCopperOreRow.missingCount).toBe(1);
    expect(result.payableCraftCount).toBe(0);
  });
});

describe('caller state is never mutated', () => {
  it('leaves the carried inventory, bank inventory, and vault untouched', () => {
    const recipe = makeRecipe([{ itemId: 'copper_ore', count: 3 }]);
    const carriedInventory: InvSlot[] = [
      plainSlot('copper_ore', 2),
      signedSlot('copper_ore', 1, CRAFTER_NAME),
    ];
    const bankInventory: InvSlot[] = [plainSlot('copper_ore', 4)];
    const vault = emptyVault({ copper_ore: 5 });
    const input = baseInput({
      recipe,
      quantity: 3,
      carriedInventory,
      bankInventory,
      vault,
      drawableVaultStock: { copper_ore: 5 },
    });
    const carriedSnapshot = structuredClone(carriedInventory);
    const bankSnapshot = structuredClone(bankInventory);
    const vaultSnapshot = structuredClone(vault);
    const drawableSnapshot = structuredClone(input.drawableVaultStock);

    projectMaterialGoalReagents(input);

    expect(carriedInventory).toEqual(carriedSnapshot);
    expect(bankInventory).toEqual(bankSnapshot);
    expect(vault).toEqual(vaultSnapshot);
    expect(input.drawableVaultStock).toEqual(drawableSnapshot);
  });
});
