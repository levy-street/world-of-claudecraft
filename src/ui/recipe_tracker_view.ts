// Pure view-core for the pinned-recipe HUD tracker (#recipe-tracker), the
// Reliquary-tracker recipe scoped to crafting: DOM/i18n-free selection of the
// recipes the player pinned from the crafting window, with each reagent's
// carried count against the count the craft would charge, so a player out in
// the world can see what is still left to farm without opening the window.
// Registered in UI_PURE_CORES; unit-tested in tests/recipe_tracker_view.test.ts.
//
// WHAT IT SHOWS: the pinned recipes in pin order (the deeds watchlist contract:
// insertion order is the display order), each with its reagent lines. A pinned
// id the shipped content no longer knows (a stale pin from an older bundle) is
// skipped rather than rendered as a bare slug; the store prunes it on the next
// toggle.
//
// WHY THE COUNTS MATCH THE WINDOW: `have` folds material grades over the
// UNLOCKED bag slots (countAcrossGrades + countUnlockedInSlots, the exact fold
// buildCraftingView uses for the Craft gate, minus the vault tier a farming
// player cannot draw from in the field), and `need` is
// requiredReagentCountFor, the sim's own charge. A tracker that disagreed with
// the Craft button about the same material would be worse than none.
//
// No clock, no Math.random, no Date.now: this core is scanned for determinism.

import { ALL_RECIPES } from '../sim/content/recipes';
import { countUnlockedInSlots } from '../sim/item_lock';
import { holdsSelfSignedInstance, requiredReagentCountFor } from '../sim/professions/crafting';
import { countAcrossGrades, materialGradeIds } from '../sim/professions/material_grades';
import type { ProfessionReagent, ProfessionRecipeRecord } from '../sim/professions/types';
import type { InvSlot } from '../sim/types';

/** Pinned recipes, and therefore tracker blocks, per character. */
export const RECIPE_TRACK_CAP = 5;

/** The widest reagent list any shipped recipe carries: the painter's per-block
 *  line pool is sized from it once, so no refresh ever grows the DOM. */
export const RECIPE_TRACKER_MAX_REAGENTS = ALL_RECIPES.reduce(
  (max, recipe) => Math.max(max, recipe.reagents.length),
  0,
);

export interface RecipeTrackerReagentLine {
  itemId: string;
  /** Carried count across the reagent's material grades (unlocked slots only). */
  have: number;
  /** The count one craft charges this character (perks and self-signed folded). */
  need: number;
  /** have >= need: this material is farmed. */
  done: boolean;
}

export interface RecipeTrackerLine {
  recipeId: string;
  resultItemId: string;
  resultCount: number;
  reagents: RecipeTrackerReagentLine[];
  /** Every reagent line is done: the recipe is ready to craft at its station. */
  ready: boolean;
}

export interface RecipeTrackerView {
  visible: boolean;
  collapsed: boolean;
  /** Live block count; the header tally while collapsed. */
  count: number;
  /** Empty while collapsed (header only), like the quest tracker. */
  lines: RecipeTrackerLine[];
}

export interface RecipeTrackerInput {
  /** Player-pinned recipe ids in pin order (RecipePinStore owns the set). */
  pinned: ReadonlySet<string>;
  recipeById(recipeId: string): ProfessionRecipeRecord | null;
  /** Carried count for one reagent item id (grade-folded by the caller). */
  have(itemId: string): number;
  /** The count one craft charges for this reagent of this recipe. */
  need(recipe: ProfessionRecipeRecord, reagent: ProfessionReagent): number;
  collapsed: boolean;
}

/** The world reads the live input needs: static recipe content plus the
 *  three per-character surfaces the Craft gate itself folds. Read-only
 *  shapes, so both IWorld hosts and a frozen mirror snapshot satisfy it. */
export interface RecipeTrackerWorld {
  inventory: readonly InvSlot[];
  craftSkills: Readonly<Record<string, number>>;
  recipeList: readonly ProfessionRecipeRecord[];
  player: { name: string };
}

/**
 * Build the tracker view from the pinned set. Collapsed renders the header
 * only (with the block count); expanded renders every pinned recipe the
 * content knows, its reagents in recipe order, each with have/need/done.
 */
export function recipeTrackerView(input: RecipeTrackerInput): RecipeTrackerView {
  const lines: RecipeTrackerLine[] = [];
  for (const recipeId of input.pinned) {
    if (lines.length >= RECIPE_TRACK_CAP) break;
    const recipe = input.recipeById(recipeId);
    if (recipe === null) continue;
    const reagents = recipe.reagents.map((reagent) => {
      const have = input.have(reagent.itemId);
      const need = input.need(recipe, reagent);
      return { itemId: reagent.itemId, have, need, done: have >= need };
    });
    lines.push({
      recipeId: recipe.id,
      resultItemId: recipe.resultItemId,
      resultCount: recipe.resultCount,
      reagents,
      ready: reagents.every((r) => r.done),
    });
  }
  const count = lines.length;
  if (count === 0) return { visible: false, collapsed: input.collapsed, count: 0, lines: [] };
  if (input.collapsed) return { visible: true, collapsed: true, count, lines: [] };
  return { visible: true, collapsed: false, count, lines };
}

/**
 * The live-world input factory: one object the host reuses every build (the
 * closures read the world thunk at call time, so it survives world swaps).
 * `pinned` and `collapsed` are the per-build fields the host assigns.
 */
export function makeRecipeTrackerInput(world: () => RecipeTrackerWorld): RecipeTrackerInput {
  return {
    pinned: new Set(),
    collapsed: false,
    recipeById: (recipeId) => {
      for (const recipe of world().recipeList) if (recipe.id === recipeId) return recipe;
      return null;
    },
    have: (itemId) => {
      const inventory = world().inventory;
      return countAcrossGrades(itemId, (gradeId) => countUnlockedInSlots(inventory, gradeId));
    },
    need: (recipe, reagent) => {
      const w = world();
      // The self-signed discount is a per-character fact the Craft gate also
      // folds (a signed copy of any grade of this material in the bags).
      const selfSigned = materialGradeIds(reagent.itemId).some((gradeId) =>
        holdsSelfSignedInstance(w.inventory, w.player.name, gradeId),
      );
      return requiredReagentCountFor(selfSigned, reagent, { ...w.craftSkills }, recipe.professionId)
        .count;
    },
  };
}

export interface RecipePinToggleResult {
  pinned: ReadonlySet<string>;
  /** True when the add was refused at the cap (the reliquary pinFull contract). */
  full: boolean;
  changed: boolean;
}

/** Toggle a recipe on the pin set, enforcing RECIPE_TRACK_CAP. Returns the
 *  UNCHANGED set plus the full flag when an add hits the cap. */
export function toggleRecipePin(
  pinned: ReadonlySet<string>,
  recipeId: string,
): RecipePinToggleResult {
  if (pinned.has(recipeId)) {
    const next = new Set(pinned);
    next.delete(recipeId);
    return { pinned: next, full: false, changed: true };
  }
  if (pinned.size >= RECIPE_TRACK_CAP) return { pinned, full: true, changed: false };
  const next = new Set(pinned);
  next.add(recipeId);
  return { pinned: next, full: false, changed: true };
}

/** Parse a persisted pin list (tolerant: anything but a string array of known
 *  recipe ids yields the empty set; unknown ids and overflow past the cap are
 *  dropped, so a stale or hand-edited entry can never wedge the tracker). */
export function parseRecipePins(
  raw: string | null,
  known: (recipeId: string) => boolean,
): Set<string> {
  const out = new Set<string>();
  if (raw === null) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!Array.isArray(parsed)) return out;
  for (const id of parsed) {
    if (out.size >= RECIPE_TRACK_CAP) break;
    if (typeof id === 'string' && known(id)) out.add(id);
  }
  return out;
}

/** The inverse of parseRecipePins: pin order preserved. */
export function serializeRecipePins(pinned: ReadonlySet<string>): string {
  return JSON.stringify([...pinned]);
}
