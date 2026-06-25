// Pure, host-agnostic view model for the professions window.
//
// The pure-core half of the pure-core + thin-consumer split (root CLAUDE.md
// Conventions; the Vendor window is the reference: vendor_view.ts +
// vendor_window.ts). It owns the branching the window needs decided without a
// DOM: which professions are learned, their skill/cap and rank, whether the
// next rank is reachable and affordable, which professions are still learnable
// under the primary cap, and, per learned crafting profession, which recipes
// are locked / craftable given the player's skill and bag reagents.
//
// DOM-free and i18n-free so tests/professions_view.test.ts can drive it
// directly. It imports ONLY from ../sim/data and ../sim/types.

import { PROFESSIONS, RECIPES_BY_PROFESSION } from '../sim/data';
import {
  PROFESSION_PRIMARY_CAP,
  PROFESSION_RANKS,
  professionCap,
  professionColor,
  type InvSlot,
  type ProfessionColor,
  type ProfessionId,
  type ProfessionKind,
} from '../sim/types';

/** One reagent line of a recipe row, resolved against the player's bags. */
export interface ProfessionReagentRow {
  itemId: string;
  /** Reagent count the recipe consumes. */
  need: number;
  /** Total of this item the player currently carries (summed across slots). */
  have: number;
  /** Whether the player carries at least `need` of this reagent. */
  enough: boolean;
}

/** One craftable recipe of a learned profession. */
export interface RecipeRow {
  id: string;
  outputItemId: string;
  outputCount: number;
  reqSkill: number;
  /**
   * Difficulty colour of the recipe at the player's skill. Only meaningful when
   * the recipe is unlocked (skill >= reqSkill); a locked recipe carries the
   * 'orange' placeholder and `locked: true`.
   */
  color: ProfessionColor;
  /** The player's skill is below reqSkill, so the recipe cannot be crafted yet. */
  locked: boolean;
  reagents: ProfessionReagentRow[];
  /** Unlocked AND every reagent is present in sufficient quantity. */
  craftable: boolean;
}

/** The next rank tier a learned profession can train into, when one exists. */
export interface NextRankView {
  rankId: string;
  rankName: string;
  /** Copper to train into this tier. */
  cost: number;
  /** The player carries enough copper to pay `cost`. */
  affordable: boolean;
  /**
   * The current tier's skill cap is reached, so training is unblocked by skill.
   * (Mirrors `atRankCap` on the owning learned row.)
   */
  reachable: boolean;
}

/** A profession the player has learned. */
export interface LearnedProfessionView {
  id: ProfessionId;
  kind: ProfessionKind;
  skill: number;
  /** Skill ceiling allowed by the current rank tier. */
  cap: number;
  rankTier: number;
  rankId: string;
  rankName: string;
  /** skill >= cap: the current tier is maxed. */
  atRankCap: boolean;
  /** Gathering profession this one draws its materials from (crafting only). */
  feedsFrom?: ProfessionId;
  /** Present only when a higher rank tier exists above the current one. */
  nextRank?: NextRankView;
  /** Recipes for this profession, sorted by reqSkill ascending. */
  recipes: RecipeRow[];
}

/** A profession not yet learned, offered only while under the primary cap. */
export interface AvailableProfessionView {
  id: ProfessionId;
  kind: ProfessionKind;
  feedsFrom?: ProfessionId;
}

export interface ProfessionsView {
  /** Number of professions learned. */
  slotsUsed: number;
  /** Primary profession cap (PROFESSION_PRIMARY_CAP). */
  slotCap: number;
  learned: LearnedProfessionView[];
  /** Learnable professions; empty once slotsUsed >= slotCap. */
  available: AvailableProfessionView[];
}

export interface ProfessionsViewInput {
  professions: { id: ProfessionId; skill: number; rankTier: number }[];
  copper: number;
  inventory: InvSlot[];
}

/** Sum the counts of every inventory slot holding `itemId`. */
function countInInventory(inventory: readonly InvSlot[], itemId: string): number {
  let total = 0;
  for (const slot of inventory) {
    if (slot.itemId === itemId) total += slot.count;
  }
  return total;
}

function buildRecipeRows(
  professionId: ProfessionId,
  skill: number,
  inventory: readonly InvSlot[],
): RecipeRow[] {
  const recipes = [...(RECIPES_BY_PROFESSION[professionId] ?? [])].sort(
    (a, b) => a.reqSkill - b.reqSkill,
  );
  return recipes.map((recipe) => {
    const locked = skill < recipe.reqSkill;
    const reagents: ProfessionReagentRow[] = recipe.reagents.map((reagent) => {
      const have = countInInventory(inventory, reagent.itemId);
      return {
        itemId: reagent.itemId,
        need: reagent.count,
        have,
        enough: have >= reagent.count,
      };
    });
    const reagentsReady = reagents.every((r) => r.enough);
    return {
      id: recipe.id,
      outputItemId: recipe.output.itemId,
      outputCount: recipe.output.count,
      reqSkill: recipe.reqSkill,
      // Colour is only meaningful for an unlocked recipe; locked rows carry a
      // stable 'orange' placeholder so consumers never read a misleading band.
      color: locked ? 'orange' : professionColor(skill, recipe.reqSkill, recipe.grey),
      locked,
      reagents,
      craftable: !locked && reagentsReady,
    };
  });
}

function buildNextRank(rankTier: number, atRankCap: boolean, copper: number): NextRankView | undefined {
  const nextTier = Math.floor(rankTier) + 1;
  const next = PROFESSION_RANKS[nextTier];
  if (!next) return undefined;
  return {
    rankId: next.id,
    rankName: next.name,
    cost: next.cost,
    affordable: copper >= next.cost,
    reachable: atRankCap,
  };
}

/**
 * Build the structured professions view from raw player inputs.
 *
 * Learned rows resolve skill/cap/rank, the colour-banded recipe list (sorted by
 * reqSkill, locked rows flagged), and the trainable next rank (reachable iff the
 * current tier's skill cap is reached, affordable iff the player can pay it).
 * The available-to-learn list is the professions NOT learned, offered only while
 * the player is under the primary cap (empty once at the cap).
 */
export function buildProfessionsView(input: ProfessionsViewInput): ProfessionsView {
  const slotCap = PROFESSION_PRIMARY_CAP;
  const slotsUsed = input.professions.length;

  const learned: LearnedProfessionView[] = input.professions.map((entry) => {
    const def = PROFESSIONS[entry.id];
    const cap = professionCap(entry.rankTier);
    const tier = Math.max(0, Math.min(PROFESSION_RANKS.length - 1, Math.floor(entry.rankTier)));
    const rank = PROFESSION_RANKS[tier];
    const atRankCap = entry.skill >= cap;
    return {
      id: entry.id,
      kind: def.kind,
      skill: entry.skill,
      cap,
      rankTier: entry.rankTier,
      rankId: rank.id,
      rankName: rank.name,
      atRankCap,
      feedsFrom: def.feedsFrom,
      nextRank: buildNextRank(entry.rankTier, atRankCap, input.copper),
      recipes: buildRecipeRows(entry.id, entry.skill, input.inventory),
    };
  });

  const learnedIds = new Set(input.professions.map((p) => p.id));
  const available: AvailableProfessionView[] =
    slotsUsed < slotCap
      ? (Object.values(PROFESSIONS) as { id: ProfessionId; kind: ProfessionKind; feedsFrom?: ProfessionId }[])
          .filter((def) => !learnedIds.has(def.id))
          .map((def) => ({ id: def.id, kind: def.kind, feedsFrom: def.feedsFrom }))
      : [];

  return { slotsUsed, slotCap, learned, available };
}
