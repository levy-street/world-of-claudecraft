// Pure, host-agnostic view model for the recipe-training window
// (Professions 2.0 Phase 9).
//
// The pure-core half of the pure-core + thin-consumer split (reference
// vendor_view.ts): it decides which recipes a station master lists and in
// which of the three states each row renders. The DOM/i18n side lives in
// train_window.ts. DOM-free and i18n-free so the trainer tests can drive it
// directly.
//
// State predicate mirrors the sim exactly (professions/crafting.ts
// isRecipeKnown + professions/training.ts teachTierMet): known = empty/no
// acquisition list OR the id is in the viewer's mirrored knownRecipes;
// teachable = 'trainer' acquisition AND the viewer's craft tier meets the
// recipe's tier AND not yet known; locked = 'trainer' acquisition AND tier
// unmet. Locked rows are ALWAYS produced (the visible ladder: the player
// must see what a master will eventually teach), never dropped.

import { STATION_TYPE_BY_CRAFT, STATIONS } from '../../../sim/content/professions';
import { ALL_RECIPES } from '../../../sim/content/recipes';
import type { StationType } from '../../../sim/professions/stations';
import { teachTierMet, trainingFeeFor } from '../../../sim/professions/training';
import type { ProfessionRecipeRecord } from '../../../sim/professions/types';
import { TIER_SKILL_STEP, tierForSkill } from '../../../sim/professions/wheel';
import type { ItemDef } from '../../../sim/types';

export type TrainRowState = 'known' | 'teachable' | 'locked';

export interface TrainRow {
  recipeId: string;
  /** The craft this recipe belongs to (a craft id, localized by the painter). */
  professionId: string;
  resultItemId: string;
  /** The result item def when the item table resolves it (display name/icon). */
  item?: ItemDef;
  /** The recipe's flat skill requirement (the ladder sort key). */
  skillReq: number;
  state: TrainRowState;
  /** Training fee in copper (professions/training.ts TRAINING_FEE_BY_TIER). */
  feeCopper: number;
  /** Advisory only; the authoritative train path recharges the balance check. */
  affordable: boolean;
  /** Present only on locked rows: the named tier requirement, as the craft id
   *  and the flat skill threshold of the recipe's tier (tier * step). */
  requirement?: { craft: string; skill: number };
}

export interface TrainView {
  /** The master's station type, or null when `masterNpcId` runs no station. */
  stationType: StationType | null;
  rows: TrainRow[];
}

export interface TrainViewDeps {
  /** The viewer's mirrored known-recipe ids (CraftingIdentityView.knownRecipes). */
  knownRecipes: readonly string[];
  /** The viewer's flat per-craft skills (CraftingIdentityView.craftSkills). */
  craftSkills: Readonly<Record<string, number>>;
  /** The viewer's copper balance, for the advisory affordability flag. */
  copper: number;
  items: Record<string, ItemDef>;
}

/** True when a station master with `masterNpcId` exists (the gossip dialog's
 *  Train-option gate; template id, never an entity id). */
export function isStationMasterNpc(masterNpcId: string): boolean {
  return STATIONS.some((station) => station.masterNpcId === masterNpcId);
}

/** The viewer-side knownness predicate over the MIRRORED known set: exactly
 *  crafting.ts isRecipeKnown's rule (an empty or absent acquisition list is
 *  grandfathered known to everyone; otherwise the id must be in the set),
 *  restated for hosts that hold CraftingIdentityView data instead of
 *  PlayerMeta. The crafting window's known-filter and the train ladder's
 *  known state MUST agree, so both call this one helper. */
export function isRecipeKnownForViewer(
  recipe: ProfessionRecipeRecord,
  known: ReadonlySet<string>,
): boolean {
  return !recipe.acquisition || recipe.acquisition.length === 0 || known.has(recipe.id);
}

function rowState(
  recipe: ProfessionRecipeRecord,
  known: ReadonlySet<string>,
  craftSkills: Readonly<Record<string, number>>,
): TrainRowState | null {
  if (isRecipeKnownForViewer(recipe, known)) {
    return 'known';
  }
  // A recipe this master's station serves but that is not trainer-taught
  // (drop/quest acquisition; none exist today) has no honest row state at a
  // trainer: it is neither teachable nor tier-locked here, so it is omitted
  // rather than rendered with a misleading requirement.
  if (!recipe.acquisition?.includes('trainer')) return null;
  // The sim's own predicate, not a mirror of it: the row can never drift
  // from what resolveTrain will actually allow.
  return teachTierMet(recipe, craftSkills) ? 'teachable' : 'locked';
}

/**
 * Build the training view for one station master: the master resolves to a
 * station (STATIONS masterNpcId), the station type to its crafts
 * (STATION_TYPE_BY_CRAFT), and every recipe of those crafts becomes a row.
 * Rows sort by craft, then skillReq, then id (a stable ladder).
 */
export function buildTrainView(masterNpcId: string, deps: TrainViewDeps): TrainView {
  const station = STATIONS.find((entry) => entry.masterNpcId === masterNpcId);
  if (!station) return { stationType: null, rows: [] };
  const crafts = new Set(
    Object.keys(STATION_TYPE_BY_CRAFT).filter(
      (craftId) => STATION_TYPE_BY_CRAFT[craftId] === station.type,
    ),
  );
  const known = new Set(deps.knownRecipes);
  const rows: TrainRow[] = [];
  for (const recipe of ALL_RECIPES) {
    if (!crafts.has(recipe.professionId)) continue;
    const state = rowState(recipe, known, deps.craftSkills);
    if (state === null) continue;
    const feeCopper = trainingFeeFor(recipe);
    rows.push({
      recipeId: recipe.id,
      professionId: recipe.professionId,
      resultItemId: recipe.resultItemId,
      item: deps.items[recipe.resultItemId],
      skillReq: recipe.skillReq,
      state,
      feeCopper,
      affordable: deps.copper >= feeCopper,
      ...(state === 'locked'
        ? {
            requirement: {
              craft: recipe.professionId,
              skill: tierForSkill(recipe.skillReq) * TIER_SKILL_STEP,
            },
          }
        : {}),
    });
  }
  rows.sort((a, b) => {
    if (a.professionId !== b.professionId) return a.professionId < b.professionId ? -1 : 1;
    if (a.skillReq !== b.skillReq) return a.skillReq - b.skillReq;
    return a.recipeId < b.recipeId ? -1 : 1;
  });
  return { stationType: station.type, rows };
}
