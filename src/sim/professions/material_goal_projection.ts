// Intentional gathering, PR4: the pure material-goal projection.
//
// Given a recipe, an explicit craft quantity, and a snapshot of a character's
// holdings, answer per-reagent required/carried/stored/reachable/missing/
// inaccessible counts plus how many of the requested crafts are actually
// payable right now. This module owns NONE of the eligibility/daily/
// commission/access/cache decisions crafting.ts's admission gate makes: the
// caller resolves the recipe, the craft skills, the drawable vault stock
// (vault_craft_gate.ts's place gate) and hands them in already resolved. This
// is a read-only projection: it clones every scratch structure it mutates and
// never touches the caller's inventory, bank, or vault arrays.
//
// TWO DELIBERATELY DIFFERENT SIMULATIONS OVER THE SAME INPUTS, not one
// generalized walker, because they answer different questions:
//
// - `payableCraftCount` reuses crafting.ts's own all-or-nothing planner
//   (craft_reagent_plan.ts `planCraftReagentDraw`, the exact function
//   `maxCraftCountForRecipe` runs), bounded at the goal's requested quantity
//   instead of CRAFT_BATCH_MAX. A craft that cannot pay EVERY reagent in full
//   consumes nothing and stops the count there, so this number can never
//   promise more than a real Create All would deliver.
// - The per-reagent bill (required/reachable/missing) is a DISTINCT partial
//   plan: it keeps walking every one of the `quantity` requested crafts even
//   past the point a craft would actually fail, because the goal wants to
//   know the FULL remaining cost, not just how far the player could get
//   today. A reagent that runs out mid-projection contributes its full
//   undiscounted requirement to every later craft's tally (no premium can be
//   manufactured from units that are not there).
//
// WITHIN one hypothetical craft, every reagent is priced and planned against
// the SAME pre-craft scratch: a sibling row's self-signed discount and
// availability must never see an earlier row's consumption (only the tally
// maps evolve mid-craft, to stop two rows sharing a grade ladder from
// double-booking one unit); the actual removal/vault-spend is applied only
// after the whole craft is planned. This mirrors craft_reagent_plan.ts's own
// plan-then-apply shape exactly.
//
// Both walks re-derive the #1145 hold-keyed self-signed discount every craft
// from a mutating scratch copy (never the caller's real inventory), so
// "holding a premium unit today does not guarantee the same discount after
// earlier crafts spend it" and there is no one-shot discounted multiplication
// anywhere in this file.
//
// OWNED vs REACHABLE is ONE coherent physical allocation, not two
// independent passes: the bill above already knows exactly which physical
// units (carried and drawable-vault) it actually drew toward each row, across
// every requested craft. Those exact takes seed `carried`/`stored` for the
// owning row. A SECOND pass then tops up only each row's still-unmet
// requirement (`required - reachable`) from the remaining raw pool: bag
// units the bill never reached (locked ones included), the personal bank, and
// the full vault (special/restricted rows included) minus every unit ANY row
// already reserved as a reachable take. This is what keeps
// `reachable <= carried + stored <= required` and stops a locked bag slot or
// a restricted vault row from being credited to a row a DIFFERENT row's
// reachable draw already spent. `inaccessible` is exactly the top-up amount:
// owned but never reachable this projection.
//
// Pure leaf module: no SimContext, no Sim/PlayerMeta import, no rng, no
// clock. Reuses crafting.ts's `requiredReagentCountFor`/`holdsSelfSignedInstance`
// (the single-surface discount math), material_grades.ts `materialGradeIds`,
// item_lock.ts `countUnlockedInSlots`/`removeUnlockedFromSlots`/
// `countRawInSlots`, reagent_sources.ts `planReagentSourceDraw`/
// `countMinusPlanned`/`tallyPlannedTakes`, materials_vault.ts
// `drawableCounterFor`/`consumeVaultStock`/`vaultStoredCount`, and
// craft_reagent_plan.ts `planCraftReagentDraw`. No parallel allocation
// algorithm and no duplicate discount math are introduced here.

import { countRawInSlots, countUnlockedInSlots, removeUnlockedFromSlots } from '../item_lock';
import {
  consumeVaultStock,
  drawableCounterFor,
  type MaterialsVaultState,
  vaultStoredCount,
} from '../materials_vault';
import type { InvSlot } from '../types';
import { planCraftReagentDraw } from './craft_reagent_plan';
import { holdsSelfSignedInstance, requiredReagentCountFor } from './crafting';
import { materialGradeIds } from './material_grades';
import { countMinusPlanned, planReagentSourceDraw, tallyPlannedTakes } from './reagent_sources';
import type { ProfessionReagent, ProfessionRecipeRecord } from './types';
import type { CraftSkillState } from './wheel';

/** Lower/upper bound on an explicit tracked-goal craft quantity (issue: track
 *  one recipe/commission goal at a time with an explicit craft quantity). */
export const MATERIAL_GOAL_MIN_QUANTITY = 1;
export const MATERIAL_GOAL_MAX_QUANTITY = 50;

/** One reagent's projected standing against the goal's full `quantity`.
 *
 *  `requiredCount`/`reachableCount`/`missingCount` are totals ACROSS every
 *  requested craft (not one craft's listed count), because the #1145
 *  self-signed discount can expire mid-projection and the composed
 *  requirement then differs craft to craft.
 *
 *  `carriedCount`/`storedCount` are OWNED totals: the row's own reachable
 *  takes (carried units actually drawn, vault units actually drawn) plus
 *  whatever additional locked bags/personal bank/restricted vault stock was
 *  topped up on top, never exceeding `requiredCount` and never double-counted
 *  against a sibling reagent row. `reachableCount` is the strictly narrower
 *  SPENDABLE subset (`reachableCount <= carriedCount + storedCount`), so
 *  `inaccessibleCount` (owned but not currently usable, e.g. a locked bag
 *  slot or a restricted vault row) is always
 *  `carriedCount + storedCount - reachableCount`. */
export interface MaterialGoalReagentRow {
  readonly itemId: string;
  readonly requiredCount: number;
  readonly carriedCount: number;
  readonly storedCount: number;
  readonly reachableCount: number;
  readonly missingCount: number;
  readonly inaccessibleCount: number;
  /** True exactly when `reachableCount >= requiredCount`: the projected bill
   *  for this reagent across the full `quantity` is genuinely payable now,
   *  not merely owned. */
  readonly materialReady: boolean;
}

export interface ProjectMaterialGoalReagentsInput {
  readonly recipe: ProfessionRecipeRecord;
  /** The tracked goal's explicit craft quantity. Must be a safe integer in
   *  [MATERIAL_GOAL_MIN_QUANTITY, MATERIAL_GOAL_MAX_QUANTITY]; an invalid
   *  value refuses outright rather than clamping into a different target. */
  readonly quantity: number;
  /** The crafting character's own name, for the #1145 self-signed hold check
   *  (holdsSelfSignedInstance/requiredReagentCountFor). */
  readonly crafterName: string;
  readonly craftSkills: CraftSkillState;
  /** Internal DTO field name (never persisted/wire): the caller's live
   *  `meta.archetype.isJackOfAllTrades` reserved flag, passed through
   *  unchanged to `requiredReagentCountFor`. Renamed here so this projection
   *  never mints its own `isJackOfAllTrades` object member, which
   *  `tests/recipe_economy.test.ts` reserves for the one true mint. */
  readonly jackAttuned: boolean;
  /** The character's live bag contents. Never mutated: every simulation below
   *  runs on a cloned scratch copy. */
  readonly carriedInventory: readonly InvSlot[];
  /** The character's personal bank contents. Crafting never draws from the
   *  bank (reagent_sources.ts: bags, then the Materials Vault, full stop), so
   *  bank units can only ever raise `storedCount`/`inaccessibleCount`, never
   *  `reachableCount`. */
  readonly bankInventory: readonly InvSlot[];
  /** The character's full Materials Vault state (compact stock plus
   *  identity-preserving special rows), for the OWNED `storedCount` total.
   *  Never mutated. */
  readonly vault: MaterialsVaultState;
  /** The place-gated, already-resolved drawable vault stock
   *  (vault_craft_gate.ts via materials_vault.ts `craftVaultStockFor`/
   *  `vaultDrawStock`), or null when this player may not draw from the vault
   *  from where they stand. This is the ONLY vault view that feeds
   *  `reachableCount`; the full `vault` above is for the owned total alone. */
  readonly drawableVaultStock: Record<string, number> | null;
}

export interface MaterialGoalProjection {
  readonly ok: true;
  readonly recipeId: string;
  readonly quantity: number;
  readonly rows: readonly MaterialGoalReagentRow[];
  /** True exactly when every row is materialReady. */
  readonly allMaterialsReady: boolean;
  /** How many of the requested `quantity` crafts are payable right now,
   *  reusing crafting.ts's own all-or-nothing sequential batch planner
   *  (craft_reagent_plan.ts), bounded at `quantity`. Zero reagents always
   *  answers `quantity` (a free-floor recipe is instantly payable). */
  readonly payableCraftCount: number;
}

export interface InvalidMaterialGoalQuantity {
  readonly ok: false;
  readonly reason: 'invalid_quantity';
}

export type ProjectMaterialGoalReagentsResult =
  | MaterialGoalProjection
  | InvalidMaterialGoalQuantity;

function isValidGoalQuantity(quantity: number): boolean {
  return (
    Number.isSafeInteger(quantity) &&
    quantity >= MATERIAL_GOAL_MIN_QUANTITY &&
    quantity <= MATERIAL_GOAL_MAX_QUANTITY
  );
}

/** Whether `inventory` currently holds a self-signed copy of `reagent`,
 *  spanning its grade ladder (material_grades.ts), the exact inline
 *  expression crafting.ts's own batch simulation (`maxCraftCountForRecipe`)
 *  evaluates against its scratch copy each iteration. */
function holdsSelfSignedReagent(
  inventory: readonly InvSlot[],
  crafterName: string,
  reagent: ProfessionReagent,
): boolean {
  return materialGradeIds(reagent.itemId).some((gradeId) =>
    holdsSelfSignedInstance(inventory, crafterName, gradeId),
  );
}

/** A throwaway MaterialsVaultState wrapping a scratch drawable-stock clone, so
 *  the projection can reuse `consumeVaultStock`/`drawableCounterFor` (the
 *  materials_vault.ts machinery `maxCraftCountForRecipe` itself reuses)
 *  without touching the caller's real vault. `special`/`upgrades` are inert
 *  for a drawable-stock scratch: the input is already the folded, eligible
 *  per-id total. */
function scratchDrawableVault(
  drawableVaultStock: Record<string, number> | null,
): MaterialsVaultState | null {
  if (drawableVaultStock === null) return null;
  return { stock: { ...drawableVaultStock }, special: [], upgrades: 0 };
}

/** The all-or-nothing "how many of `quantity` crafts are payable right now"
 *  answer: crafting.ts's own sequential batch planner
 *  (craft_reagent_plan.ts `planCraftReagentDraw`), the exact reuse
 *  `maxCraftCountForRecipe` performs, bounded at `quantity` instead of
 *  CRAFT_BATCH_MAX. A reagent shortfall on any craft stops the count there;
 *  nothing from that craft is applied to the scratch (plan-then-apply). */
function projectPayableCraftCount(input: ProjectMaterialGoalReagentsInput): number {
  const { recipe, quantity, crafterName, craftSkills, jackAttuned, carriedInventory } = input;
  if (recipe.reagents.length === 0) return quantity;
  const scratchCarried: InvSlot[] = carriedInventory.map((slot) => ({ ...slot }));
  const scratchVault = scratchDrawableVault(input.drawableVaultStock);
  let crafts = 0;
  while (crafts < quantity) {
    const plans = planCraftReagentDraw(
      recipe.reagents,
      (reagent) =>
        requiredReagentCountFor(
          holdsSelfSignedReagent(scratchCarried, crafterName, reagent),
          reagent,
          craftSkills,
          recipe.professionId,
          jackAttuned,
        ).count,
      (id) => countUnlockedInSlots(scratchCarried, id),
      scratchVault?.stock ?? null,
    );
    if (plans === null) break;
    for (const plan of plans) {
      for (const take of plan.carried) {
        removeUnlockedFromSlots(scratchCarried, take.itemId, take.count);
      }
      if (scratchVault) {
        for (const take of plan.vault) consumeVaultStock(scratchVault, take.itemId, take.count);
      }
    }
    crafts++;
  }
  return crafts;
}

/** The distinct partial-plan shortfall bill, plus the exact physical takes it
 *  recorded per row (carried and drawable-vault, summed across every
 *  requested craft), so the owned allocation below can seed each row with
 *  what it actually drew rather than re-deriving a second, possibly
 *  conflicting allocation from scratch. */
interface ReagentBillResult {
  /** Per-row required/reachable totals across the full `quantity`. */
  readonly required: readonly number[];
  readonly reachable: readonly number[];
  /** Per-row split of `reachable` by source: `reachableCarriedByRow[i] +
   *  reachableStoredByRow[i] === reachable[i]`. */
  readonly reachableCarriedByRow: readonly number[];
  readonly reachableStoredByRow: readonly number[];
  /** The SAME takes as the two arrays above, re-keyed by item id (summed
   *  across every row and craft): the owned allocation subtracts these so a
   *  physical unit already reserved to any row's reachable draw can never be
   *  handed to a different row's owned-but-unreachable top-up too. */
  readonly reachableCarriedByItemId: ReadonlyMap<string, number>;
  readonly reachableStoredByItemId: ReadonlyMap<string, number>;
}

/**
 * `quantity` hypothetical crafts, each reagent planned and applied
 * INDEPENDENTLY of its siblings (never refusing the whole craft on one
 * reagent's shortfall), so a reagent that runs out still lets every other
 * reagent's tally keep accruing for the remaining requested crafts.
 *
 * WITHIN one craft, every row is priced and planned against the SAME
 * pre-craft scratch (only the tally maps evolve, to stop two rows sharing a
 * grade ladder from double-booking one unit); the actual removal/vault-spend
 * for the whole craft is applied only once every row is planned. A row's
 * self-signed discount must never be evaluated after an earlier SIBLING row
 * already spent the copy that held it.
 */
function projectReagentBill(input: ProjectMaterialGoalReagentsInput): ReagentBillResult {
  const { recipe, quantity, crafterName, craftSkills, jackAttuned, carriedInventory } = input;
  const required = recipe.reagents.map(() => 0);
  const reachable = recipe.reagents.map(() => 0);
  const reachableCarriedByRow = recipe.reagents.map(() => 0);
  const reachableStoredByRow = recipe.reagents.map(() => 0);
  const reachableCarriedByItemId = new Map<string, number>();
  const reachableStoredByItemId = new Map<string, number>();
  const result: ReagentBillResult = {
    required,
    reachable,
    reachableCarriedByRow,
    reachableStoredByRow,
    reachableCarriedByItemId,
    reachableStoredByItemId,
  };
  if (recipe.reagents.length === 0) return result;
  const scratchCarried: InvSlot[] = carriedInventory.map((slot) => ({ ...slot }));
  const scratchVault = scratchDrawableVault(input.drawableVaultStock);

  for (let craft = 0; craft < quantity; craft++) {
    const carriedPlanned = new Map<string, number>();
    const vaultPlanned = new Map<string, number>();
    const carriedCounter = countMinusPlanned(
      (id: string) => countUnlockedInSlots(scratchCarried, id),
      carriedPlanned,
    );
    const vaultBase = scratchVault ? drawableCounterFor(scratchVault.stock) : null;
    const vaultCounter = vaultBase ? countMinusPlanned(vaultBase, vaultPlanned) : null;

    const plans = recipe.reagents.map((reagent, i) => {
      const need = requiredReagentCountFor(
        holdsSelfSignedReagent(scratchCarried, crafterName, reagent),
        reagent,
        craftSkills,
        recipe.professionId,
        jackAttuned,
      ).count;
      const plan = planReagentSourceDraw(reagent.itemId, need, carriedCounter, vaultCounter);
      tallyPlannedTakes(carriedPlanned, plan.carried);
      tallyPlannedTakes(vaultPlanned, plan.vault);
      required[i] += need;
      reachable[i] += plan.planned;
      return plan;
    });

    plans.forEach((plan, i) => {
      let carriedTaken = 0;
      for (const take of plan.carried) {
        removeUnlockedFromSlots(scratchCarried, take.itemId, take.count);
        carriedTaken += take.count;
        reachableCarriedByItemId.set(
          take.itemId,
          (reachableCarriedByItemId.get(take.itemId) ?? 0) + take.count,
        );
      }
      reachableCarriedByRow[i] += carriedTaken;
      if (!scratchVault) return;
      let vaultTaken = 0;
      for (const take of plan.vault) {
        consumeVaultStock(scratchVault, take.itemId, take.count);
        vaultTaken += take.count;
        reachableStoredByItemId.set(
          take.itemId,
          (reachableStoredByItemId.get(take.itemId) ?? 0) + take.count,
        );
      }
      reachableStoredByRow[i] += vaultTaken;
    });
  }
  return result;
}

/** The OWNED display allocation: seed each row with the bill's own reachable
 *  takes, then top up only its still-unmet requirement (`required -
 *  reachable`) from the remaining raw pool (locked bags included, personal
 *  bank, and the full vault, special/restricted rows included) with every
 *  reachable take already excluded, so a physical unit reserved to one row's
 *  reachable draw can never ALSO be credited to a different row's
 *  owned-but-unreachable top-up. Reuses `planReagentSourceDraw` with the
 *  carried/vault tiers repurposed as carried/stored, not a second grade
 *  walker. */
function projectOwnedAllocation(
  recipe: ProfessionRecipeRecord,
  bill: ReagentBillResult,
  carriedInventory: readonly InvSlot[],
  bankInventory: readonly InvSlot[],
  vault: MaterialsVaultState,
): { readonly carried: readonly number[]; readonly stored: readonly number[] } {
  const carriedPlanned = new Map(bill.reachableCarriedByItemId);
  const storedPlanned = new Map(bill.reachableStoredByItemId);
  const rawCarried = countMinusPlanned(
    (id: string) => countRawInSlots(carriedInventory, id),
    carriedPlanned,
  );
  const rawStored = countMinusPlanned(
    (id: string) => countRawInSlots(bankInventory, id) + vaultStoredCount(vault, id),
    storedPlanned,
  );
  const carried: number[] = [];
  const stored: number[] = [];
  recipe.reagents.forEach((reagent, i) => {
    const reachableCarried = bill.reachableCarriedByRow[i];
    const reachableStored = bill.reachableStoredByRow[i];
    const remainingNeed = Math.max(0, bill.required[i] - reachableCarried - reachableStored);
    const plan = planReagentSourceDraw(reagent.itemId, remainingNeed, rawCarried, rawStored);
    tallyPlannedTakes(carriedPlanned, plan.carried);
    tallyPlannedTakes(storedPlanned, plan.vault);
    const extraCarried = plan.carried.reduce((n, take) => n + take.count, 0);
    const extraStored = plan.vault.reduce((n, take) => n + take.count, 0);
    carried.push(reachableCarried + extraCarried);
    stored.push(reachableStored + extraStored);
  });
  return { carried, stored };
}

/**
 * Project one tracked material goal: for the recipe's declared reagents,
 * how much is required to craft `quantity` copies, how much of that is
 * carried/stored/reachable/missing/inaccessible, and how many of the
 * requested crafts are payable right now.
 *
 * Read-only: never mutates `carriedInventory`, `bankInventory`, or `vault`.
 * An invalid `quantity` (not a safe integer, or outside
 * [MATERIAL_GOAL_MIN_QUANTITY, MATERIAL_GOAL_MAX_QUANTITY]) refuses with
 * `{ ok: false, reason: 'invalid_quantity' }` rather than clamping into a
 * different target.
 */
export function projectMaterialGoalReagents(
  input: ProjectMaterialGoalReagentsInput,
): ProjectMaterialGoalReagentsResult {
  const { recipe, quantity } = input;
  if (!isValidGoalQuantity(quantity)) {
    return { ok: false, reason: 'invalid_quantity' };
  }
  const bill = projectReagentBill(input);
  const { carried, stored } = projectOwnedAllocation(
    recipe,
    bill,
    input.carriedInventory,
    input.bankInventory,
    input.vault,
  );
  const rows: MaterialGoalReagentRow[] = recipe.reagents.map((reagent, i) => {
    const requiredCount = bill.required[i];
    const reachableCount = bill.reachable[i];
    const carriedCount = carried[i];
    const storedCount = stored[i];
    const missingCount = Math.max(0, requiredCount - carriedCount - storedCount);
    const inaccessibleCount = Math.max(0, carriedCount + storedCount - reachableCount);
    return {
      itemId: reagent.itemId,
      requiredCount,
      carriedCount,
      storedCount,
      reachableCount,
      missingCount,
      inaccessibleCount,
      materialReady: reachableCount >= requiredCount,
    };
  });
  return {
    ok: true,
    recipeId: recipe.id,
    quantity,
    rows,
    allMaterialsReady: rows.every((row) => row.materialReady),
    payableCraftCount: projectPayableCraftCount(input),
  };
}
