// THE craft-side reagent planner (extracted from crafting.ts, PR4 of the
// intentional-gathering program): resolve where EVERY reagent of one craft
// attempt comes from, bags first and then the Materials Vault, and answer
// null the moment any of them cannot be paid in full.
//
// Every crafting.ts call site consumes this and none of them re-derives the
// order: the availability check (hasRecipeMaterials), the lock-only probe
// (insufficientMaterialsIsLockOnly), the bag-capacity scratch gate
// (evaluateCraftAdmission), the real consumption (resolveCraftForRecipe), and
// the Create All batch simulation (maxCraftCountForRecipe). PLAN-THEN-APPLY is
// the shape, deliberately: every site learns the whole attempt is payable
// before any of it is spent, so a craft is all-or-nothing across both pools
// and a reagent list that fails on its LAST line cannot leave the earlier
// lines already consumed.
//
// BOTH pools are tallied across reagents, because planning spends nothing.
// Without the tallies, two reagents naming one material (or two whose grade
// ladders overlap) are each promised the same units, and the attempt is
// admitted for a price it can only half pay: the consume drains the first
// line, the second finds nothing, and the output is granted anyway.
//
// Callers supply their own `carriedCount` (countUnlockedInSlots over the live
// inventory for the real paths and over a scratch copy for the simulating
// ones, so every plan spends only unlocked units) and their own `requiredFor`
// (the batch simulation re-derives the hold-keyed self-signed discount per
// iteration; everyone else reads it off the meta). One plan per reagent, in
// reagent order, so callers may pair the two by index.
//
// The material-goal projection (professions/material_goal_projection.ts,
// PR4) reuses this SAME function for its "payable-craft count up to target"
// answer, bounded at the goal's requested quantity instead of
// CRAFT_BATCH_MAX, so the goal's promise and the real Create All promise can
// never disagree. It does NOT reuse this for its per-reagent shortfall bill:
// that is a distinct partial-plan path (see that module's header) which
// deliberately does not refuse and roll back a craft on a shortfall, because
// the goal wants to know what the REMAINING quantity would still cost, not
// just how many crafts are payable right now.
//
// Pure leaf module: no SimContext, no content-table import, no rng, explicit
// callbacks only, so a Vitest imports it directly (the material_grades.ts /
// reagent_sources.ts contract).

import { drawableCounterFor } from '../materials_vault';
import {
  countMinusPlanned,
  planReagentSourceDraw,
  type ReagentSourcePlan,
  tallyPlannedTakes,
} from './reagent_sources';
import type { ProfessionReagent } from './types';

export function planCraftReagentDraw(
  reagents: readonly ProfessionReagent[],
  requiredFor: (reagent: ProfessionReagent) => number,
  carriedCount: (id: string) => number,
  vaultStock: Record<string, number> | null,
): readonly ReagentSourcePlan[] | null {
  const carriedPlanned = new Map<string, number>();
  const vaultPlanned = new Map<string, number>();
  const carried = countMinusPlanned(carriedCount, carriedPlanned);
  const vault = countMinusPlanned(drawableCounterFor(vaultStock), vaultPlanned);
  const plans: ReagentSourcePlan[] = [];
  for (const reagent of reagents) {
    // Planned across the reagent's grades, in the same order and from the same
    // pools the consumption spends them, so no gate can promise units the
    // removal would not find.
    const plan = planReagentSourceDraw(reagent.itemId, requiredFor(reagent), carried, vault);
    if (plan.shortfall !== 0) return null;
    tallyPlannedTakes(carriedPlanned, plan.carried);
    tallyPlannedTakes(vaultPlanned, plan.vault);
    plans.push(plan);
  }
  return plans;
}
