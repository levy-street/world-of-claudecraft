// Where one reagent's units come from: the bags first, then the Materials
// Vault.
//
// THIS IS THE ONE IMPLEMENTATION OF THAT ORDER. Every consumer, named rather
// than counted (a count here would rot the next time one is added):
//
// - professions/crafting.ts `hasRecipeMaterials`, the availability check
// - professions/crafting.ts `evaluateCraftAdmission`, the bag-capacity scratch
// - professions/crafting.ts `resolveCraftForRecipe`, the real consumption
// - professions/crafting.ts `maxCraftCountForRecipe`, the Create All batch
//   simulation
// - professions/enchanting.ts, all three apply arms plus the three admission
//   arms that mirror them
// - src/ui/crafting_view.ts, the crafting window's own projection, so the
//   button a player sees agrees with the sim that will judge the click
//
// Every one of them must reach the same answer, or a gate approves a spend the
// consumption then performs differently. They all call `planReagentSourceDraw`
// and apply the plan it returns. A SECOND implementation of the carried-first
// order is a defect, not an optimization: the moment two of those sites
// disagree, the player either pays twice or is denied a craft they can afford.
//
// Carried first is the player-facing rule, not an implementation detail. The
// vault is the deep stockpile; the bags are what you are holding. Spending the
// bags first keeps a stockpile from quietly draining while the same material
// sits in the player's own inventory, and it means a full vault never changes
// what a bags-only craft costs.
//
// Pure leaf module: no SimContext, no content-table import, no rng, explicit
// callbacks only, so a Vitest imports it directly (the material_grades.ts /
// tools.ts contract). Deterministic: the walk order comes from `gradeIds`
// alone, never from object-key iteration, so the same holdings always produce
// byte-identical plans.

import { type GradeRemoval, materialGradeIds, planRemovalOver } from './material_grades';

/** No lines at all, shared by reference wherever a tier contributes nothing
 *  (which is EVERY reagent of every bags-only draw, so this is the common case
 *  and deserves to allocate nothing).
 *
 *  Frozen rather than merely readonly-typed: the type stops a caller at
 *  compile time, the freeze stops one at runtime. This file is ESM, so every
 *  consumer runs in strict mode, where a `push` onto a frozen array THROWS
 *  instead of silently succeeding. That matters more than it looks: a silent
 *  mutation here would poison every later empty plan in the process, and two
 *  Sims in one process share this module. */
const NO_TAKES: readonly GradeRemoval[] = Object.freeze([]);

/** One reagent's resolved sourcing: which units come out of the bags, which
 *  come out of the vault, and whether the two together cover the requirement. */
export interface ReagentSourcePlan {
  /** Bag takes, in consumption order. Applied with `ctx.removeItem` on the
   *  real path and `removeStacked` on a scratch copy. These are the ONLY takes
   *  that free bag space. */
  carried: readonly GradeRemoval[];
  /** Vault takes, in consumption order, applied with
   *  `materials_vault.ts consumeVaultStock`. Always empty when the caller
   *  passed a null `vaultCount` (no vault, locked, or draw-blocked here). */
  vault: readonly GradeRemoval[];
  /** Units the two tiers cover between them: `required` on a payable reagent. */
  planned: number;
  /** `required - planned`: 0 when the reagent is payable, positive by exactly
   *  the number of units missing otherwise. Callers gate on `shortfall === 0`
   *  rather than re-deriving a count of their own. */
  shortfall: number;
}

/**
 * Plan one reagent's draw: take what the bags hold first, then cover the
 * remainder from the vault.
 *
 * Both tiers walk `gradeIds` through the SAME kernel (material_grades.ts
 * `planRemovalOver`), so downward grade substitution behaves identically in
 * the vault and in the bags: base grade first, fine grade after. Callers with
 * no grade ladder at all (enchant reagents are grade-blind) pass a
 * single-element `gradeIds` and get single-id plans.
 *
 * `vaultCount` is null for a player who may not draw from the vault HERE,
 * which is the byte-identical-to-before path: the plan is then exactly what
 * `planGradeRemoval` alone would have produced, and `shortfall` reduces to the
 * old "held less than required" test.
 *
 * `required <= 0` returns the empty plan. A non-finite `required` deliberately
 * does NOT: it falls through to the kernel and lands a non-zero (NaN)
 * shortfall, so a corrupt requirement keeps denying the way the old count
 * comparison denied it, rather than reading as satisfied.
 */
export function planReagentSourceDraw(
  itemId: string,
  required: number,
  carriedCount: (id: string) => number,
  vaultCount: ((id: string) => number) | null,
  gradeIds: readonly string[] = materialGradeIds(itemId),
): ReagentSourcePlan {
  if (required <= 0) return { carried: NO_TAKES, vault: NO_TAKES, planned: 0, shortfall: 0 };
  const carried = planRemovalOver(gradeIds, required, carriedCount);
  let planned = 0;
  for (const take of carried) planned += take.count;
  const remainder = required - planned;
  const vault =
    vaultCount !== null && remainder > 0
      ? planRemovalOver(gradeIds, remainder, vaultCount)
      : NO_TAKES;
  for (const take of vault) planned += take.count;
  return { carried, vault, planned, shortfall: required - planned };
}

/**
 * A counting callback with everything an EARLIER reagent of the same
 * evaluation has already claimed subtracted back out, or null when that tier
 * is not in play at all.
 *
 * Planning spends nothing, so any caller that plans several reagents before
 * applying any of them needs this, or two reagents naming the same material
 * are both promised the same units and the evaluation approves a draw the
 * consumption cannot pay. Pair it with `tallyPlannedTakes` on the same Map:
 * count through this, record through that, once per reagent.
 *
 * The one site that does NOT need it is a loop that APPLIES as it walks (the
 * real craft consume spends the live vault record reagent by reagent, so the
 * next reagent already sees the last one's spend). Living here, beside the
 * planner, so the two halves of the rule cannot drift into separate copies.
 */
export function countMinusPlanned(
  count: (id: string) => number,
  planned: ReadonlyMap<string, number>,
): (id: string) => number;
export function countMinusPlanned(
  count: ((id: string) => number) | null,
  planned: ReadonlyMap<string, number>,
): ((id: string) => number) | null;
export function countMinusPlanned(
  count: ((id: string) => number) | null,
  planned: ReadonlyMap<string, number>,
): ((id: string) => number) | null {
  return count === null ? null : (id: string) => Math.max(0, count(id) - (planned.get(id) ?? 0));
}

/** Record one reagent's takes into the tally `countMinusPlanned` reads. */
export function tallyPlannedTakes(
  planned: Map<string, number>,
  takes: readonly GradeRemoval[],
): void {
  for (const take of takes) planned.set(take.itemId, (planned.get(take.itemId) ?? 0) + take.count);
}
