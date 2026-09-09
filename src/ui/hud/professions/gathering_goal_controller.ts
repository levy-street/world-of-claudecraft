// The gathering goal tracker's HUD-side coordinator (Intentional Gathering
// PR4): owns the persistent #gathering-goal-tracker panel's signature-gated
// repaint AND the crafting window's per-recipe goal-quantity stepper state,
// so `Hud` stays a thin caller (root CLAUDE.md Modularity: a new HUD feature
// is its own module, never a growing method cluster on the coordinator).
//
// Signature-gated repaint (the delve tracker's own pattern,
// hud/delve/delve_tracker_controller.ts): update() rebuilds the panel only
// when the sim's own read model actually changed, so an ordinary slow-band
// poll with nothing new touches no DOM at all, and the player's scroll
// position or a focused control inside the panel is never disturbed by a
// repaint that changed nothing. relocalize() forces exactly one rebuild by
// clearing the latch, the same shape the delve/reliquary trackers already
// use for a language switch.
//
// Generation guard (the harvest_preference_controller.ts pattern): every
// rebuild bumps a generation counter, and the Clear / harvest-preference
// callbacks handed to the painter close over the generation they were
// PAINTED under, re-checking it before acting. A button from a prior render
// is destroyed by the next real `el.innerHTML` rebuild in the live DOM, but
// the guard is defense in depth against anything that could still hold a
// stale reference (a queued event, a retained node): a detached Clear
// button can never clear a goal it was not rendered for.
//
// The four explicit-action wrappers (onTrackRecipe, onTrack, onClearGoal,
// onSetHarvestPreference) each call update() immediately after sending the
// command, rather than waiting for the next slow tick, so a player's own
// action is reflected at once; onSetHarvestPreference is the ONE place this
// whole feature writes the harvest preference (tracking, selecting a goal,
// rendering, and clearing never do). The panel's per-material
// isCurrentHarvestPreference status is read from the world's OWN
// harvestPreference mirror, never guessed from the command just sent: the
// update() signature covers both the goal and the preference, so a real
// change to either forces exactly one rebuild, and the repaint after
// onSetHarvestPreference shows the new choice offline (where the mirror is
// already current) but stays byte-identical online until the server's
// authoritative preference actually arrives on a snapshot.

import { ITEMS } from '../../../sim/data';
import type { IWorld } from '../../../world_api';
import { CRAFT_BATCH_UI_MAX, clampCraftQty } from './craft_cast_view';
import { type GatheringGoalPanelDeps, renderGatheringGoalPanel } from './gathering_goal_painter';
import { buildGatheringGoalPanelModel, recipeResultFor } from './gathering_goal_view';

/** The PR4 IWorld contract this controller consumes, named for readability
 *  at the call sites below. */
export type GatheringGoalWorld = Pick<
  IWorld,
  | 'gatheringGoal'
  | 'trackGatheringRecipe'
  | 'trackGatheringCommission'
  | 'clearGatheringGoal'
  | 'harvestPreference'
  | 'setHarvestPreference'
>;

export interface GatheringGoalControllerDeps {
  /** The persistent tracker root (#gathering-goal-tracker), resolved once by
   *  the caller like every other tracker in #right-tracker-stack. */
  element: HTMLElement;
  world(): GatheringGoalWorld;
}

export class GatheringGoalController {
  /** Per-recipe goal quantity for the crafting window's Track control
   *  (1..CRAFT_BATCH_UI_MAX), HUD-held exactly like `Hud`'s own
   *  `craftQtyByRecipe`: a repaint the player did not trigger must never
   *  reset their pick, and this quantity is deliberately UNCOUPLED from that
   *  other map (planning a goal past current mats-fit is the point). */
  private readonly goalQtyByRecipe = new Map<string, number>();
  private lastSignature = '';
  /** Bumped on every real rebuild; see the module header's generation guard. */
  private generation = 0;

  constructor(private readonly deps: GatheringGoalControllerDeps) {}

  goalQty(recipeId: string): number {
    return this.goalQtyByRecipe.get(recipeId) ?? 1;
  }

  onGoalQty(recipeId: string, qty: number): void {
    this.goalQtyByRecipe.set(recipeId, clampCraftQty(qty, CRAFT_BATCH_UI_MAX));
  }

  /** Track `recipeId` as the new gathering goal, REPLACING any existing one
   *  (the sim command's own contract), then repaints immediately. */
  onTrackRecipe(recipeId: string, count: number): void {
    this.deps.world().trackGatheringRecipe(recipeId, clampCraftQty(count, CRAFT_BATCH_UI_MAX));
    this.update();
  }

  /** Track an order this viewer has accepted to craft (the commission
   *  board's own canDeliver gate is what may call this at all). */
  onTrack(orderId: number): void {
    this.deps.world().trackGatheringCommission(orderId);
    this.update();
  }

  onClearGoal(): void {
    this.deps.world().clearGatheringGoal();
    this.update();
  }

  /** The ONE explicit preference write this feature performs. Repaints
   *  immediately after, same as the three action wrappers above: offline the
   *  world mirror already reflects the new choice by the time update() reads
   *  it, so the row flips to "current" at once; online the mirror is still
   *  the PRE-command value until the server's authoritative preference
   *  arrives on a later snapshot, so this call is a no-op there (the
   *  signature has not moved) and no row is ever marked current on an
   *  optimistic guess. */
  onSetHarvestPreference(itemId: string): void {
    this.deps.world().setHarvestPreference(itemId);
    this.update();
  }

  /** Re-localize after a language switch (the Hud woc:languagechange
   *  fan-out): every signature member is an id/count/boolean, so a bare
   *  setLanguage never moves it and a plain update() would leave the old
   *  locale on screen; clearing the latch forces exactly one rebuild. */
  relocalize(): void {
    this.lastSignature = '';
    this.update();
  }

  update(): void {
    const world = this.deps.world();
    const goal = world.gatheringGoal;
    const harvestPreference = world.harvestPreference;
    // The signature covers BOTH reads: a preference-only change (no goal
    // edit at all) must still force a rebuild, or a row's isCurrentHarvestPreference
    // status would go stale the moment the player sets a DIFFERENT
    // preference from elsewhere (the harvest preference picker, another
    // material's shortcut) while this goal stays tracked.
    const signature = JSON.stringify({ goal, harvestPreference });
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.generation++;
    const generationAtPaint = this.generation;
    const model = buildGatheringGoalPanelModel(goal, ITEMS, recipeResultFor, harvestPreference);
    const deps: GatheringGoalPanelDeps = {
      onClearGoal: () => {
        if (generationAtPaint !== this.generation) return;
        this.onClearGoal();
      },
      onSetHarvestPreference: (itemId) => {
        if (generationAtPaint !== this.generation) return;
        this.onSetHarvestPreference(itemId);
      },
    };
    renderGatheringGoalPanel(this.deps.element, model, deps);
  }
}
