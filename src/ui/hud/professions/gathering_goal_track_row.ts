// Painter-side helper: the crafting window's gathering-goal Track control
// (Intentional Gathering PR4), extracted from crafting_window.ts to keep
// that coordinator under its monolith ceiling (tests/monolith_budget.test.ts).
// Host-agnostic painter-helper contract (src/ui/CLAUDE.md, UI_PAINTER_HELPERS):
// `document` only to mint this row's own detached nodes, no other browser
// global, deterministic, no literal color. It is imported BY the crafting
// window painter and paints nothing itself.
//
// A SEPARATE per-recipe quantity, 1..CRAFT_BATCH_UI_MAX, uncoupled from the
// craft-batch qty stepper (which clamps to the current mats-fit and so cannot
// express a shortage worth planning a goal around). Deliberately a SIBLING
// row of the batch controls, never merged with them. `onTrackRecipe`
// REPLACES the player's current gathering goal; it fires ONLY from the
// explicit Track button, never from a Create click, never from selecting a
// recipe row, and never from a repaint.

import { FOCUS_KEY_ATTR } from '../../focus_restore';
import { formatNumber, t } from '../../i18n';
import { CRAFT_BATCH_UI_MAX, clampCraftQty } from './craft_cast_view';

export interface TrackRowDeps {
  /** Per-recipe goal quantity stepper value (HUD-held so repaints keep the
   *  pick). All three deps render together or not at all: a caller that
   *  supplies none of them gets no goal-tracking row. */
  goalQty?(recipeId: string): number;
  onGoalQty?(recipeId: string, qty: number): void;
  onTrackRecipe?(recipeId: string, count: number): void;
}

/** Appends the goal-track row for `recipeId`/`resultName` onto `item`, or
 *  does nothing when the caller supplied fewer than all three optional deps
 *  (the crafting window's own all-or-nothing contract). Reuses the batch
 *  row's existing flex layout (components.css) and the qty stepper's
 *  existing button styling: `crafting-goal-row` / `crafting-goal-qty-row`
 *  are semantic/test hooks with no rule of their own, the
 *  crafting-daily-chip precedent, so this control needs no new CSS. */
export function renderGatheringGoalTrackRow(
  item: HTMLElement,
  recipeId: string,
  resultName: string,
  deps: TrackRowDeps,
): void {
  const { onTrackRecipe, goalQty: readGoalQty, onGoalQty } = deps;
  if (!onTrackRecipe || !readGoalQty || !onGoalQty) return;

  const goalRow = document.createElement('div');
  goalRow.className = 'crafting-batch-row crafting-goal-row';
  const goalQtyGroup = document.createElement('div');
  goalQtyGroup.className = 'crafting-qty-row crafting-goal-qty-row';
  goalQtyGroup.setAttribute('role', 'group');
  goalQtyGroup.setAttribute('aria-label', t('hudChrome.crafting.goalQtyRowAria'));
  const goalQty = clampCraftQty(readGoalQty(recipeId), CRAFT_BATCH_UI_MAX);
  const goalQtyCount = formatNumber(goalQty, { maximumFractionDigits: 0 });
  const goalDecBtn = document.createElement('button');
  goalDecBtn.type = 'button';
  goalDecBtn.className = 'crafting-qty-btn';
  goalDecBtn.setAttribute(FOCUS_KEY_ATTR, `goal-qty-dec:${recipeId}`);
  goalDecBtn.textContent = '-';
  goalDecBtn.setAttribute(
    'aria-label',
    t('hudChrome.crafting.goalQtyDecreaseAria', { count: goalQtyCount }),
  );
  goalDecBtn.disabled = goalQty <= 1;
  goalDecBtn.addEventListener('click', () => {
    onGoalQty(recipeId, clampCraftQty(goalQty - 1, CRAFT_BATCH_UI_MAX));
  });
  const goalQtyValue = document.createElement('span');
  goalQtyValue.className = 'crafting-qty-value';
  goalQtyValue.textContent = goalQtyCount;
  goalQtyValue.setAttribute('aria-hidden', 'true');
  const goalIncBtn = document.createElement('button');
  goalIncBtn.type = 'button';
  goalIncBtn.className = 'crafting-qty-btn';
  goalIncBtn.setAttribute(FOCUS_KEY_ATTR, `goal-qty-inc:${recipeId}`);
  goalIncBtn.textContent = '+';
  goalIncBtn.setAttribute(
    'aria-label',
    t('hudChrome.crafting.goalQtyIncreaseAria', { count: goalQtyCount }),
  );
  goalIncBtn.disabled = goalQty >= CRAFT_BATCH_UI_MAX;
  goalIncBtn.addEventListener('click', () => {
    onGoalQty(recipeId, clampCraftQty(goalQty + 1, CRAFT_BATCH_UI_MAX));
  });
  goalQtyGroup.appendChild(goalDecBtn);
  goalQtyGroup.appendChild(goalQtyValue);
  goalQtyGroup.appendChild(goalIncBtn);
  goalRow.appendChild(goalQtyGroup);
  const trackBtn = document.createElement('button');
  trackBtn.type = 'button';
  trackBtn.className = 'crafting-create-all-btn crafting-track-goal-btn';
  trackBtn.setAttribute(FOCUS_KEY_ATTR, `track-goal:${recipeId}`);
  trackBtn.textContent = t('hudChrome.crafting.trackGoalButton');
  trackBtn.setAttribute(
    'aria-label',
    t('hudChrome.crafting.trackGoalButtonAria', { name: resultName, count: goalQtyCount }),
  );
  trackBtn.addEventListener('click', () => onTrackRecipe(recipeId, goalQty));
  goalRow.appendChild(trackBtn);
  item.appendChild(goalRow);
}
