// Pure, host-agnostic view model for the recipe-training window
// (Professions 2.0).
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

import { ALL_RECIPES, recipeById } from '../../../sim/content/recipes';
import type { StationType } from '../../../sim/professions/stations';
import {
  teachTierMet,
  trainingFeeFor,
  trainingStationTypeFor,
} from '../../../sim/professions/training';
import type { ProfessionRecipeRecord } from '../../../sim/professions/types';
import { TIER_SKILL_STEP, tierForSkill } from '../../../sim/professions/wheel';
import type { ItemDef, StationDef } from '../../../sim/types';

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
  /** Present only on a teachable row whose learn is in flight
   *  (TrainViewDeps.pendingRecipes): the painter disables the button so a
   *  second activation never re-sends the command (issue #2342). */
  pending?: boolean;
  /** Training fee in copper (professions/training.ts TRAINING_FEE_BY_TIER). */
  feeCopper: number;
  /** Whether the reserved purse covers the fee (availableTrainCopper). The
   *  painter turns this into the Learn button's disabled state, so it is a
   *  client-side estimate with teeth, not advisory chrome; the authoritative
   *  train path still recharges the balance check server-side. */
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
  /** Physical stations exposed by the active IWorld. */
  stations: readonly StationDef[];
  /** The viewer's mirrored known-recipe ids (CraftingIdentityView.knownRecipes). */
  knownRecipes: readonly string[];
  /** The viewer's flat per-craft skills (CraftingIdentityView.craftSkills). */
  craftSkills: Readonly<Record<string, number>>;
  /** The viewer's copper balance, priced through the fee reserve into each
   *  row's affordable flag (see TrainRow.affordable). */
  copper: number;
  items: Record<string, ItemDef>;
  /** Recipe ids with a learn currently in flight (the HUD's
   *  TrainLearnTracker, issue #2342): a teachable row in this set renders
   *  pending (disabled, statePending label). While the mirrored known set
   *  does not answer for a flight, its fee is also reserved against the
   *  purse (see buildTrainView's reserve) so sibling teachable rows flip
   *  unaffordable the moment a Learn click leaves, never after a failed
   *  second click. Absent means none. */
  pendingRecipes?: ReadonlySet<string>;
  /** Server-confirmed learns (trainResult ok) the mirrored knownRecipes set
   *  may not carry yet: unioned into the known set so the row flips to Known
   *  the moment the result lands, never a repaint behind the cprof mirror.
   *  Their fees stay reserved until the mirror carries the grant, because
   *  the cprof grant and the debited copper ride the same self-frame: an
   *  unmirrored confirm means an unmirrored debit. Absent means none. */
  confirmedRecipes?: ReadonlySet<string>;
}

/**
 * Purse available for pricing one train row after unsettled Learn fees are
 * reserved. `reservedRecipes` holds the ids whose fee the purse number does
 * not answer for yet; buildTrainView derives it as pending flights plus
 * confirmed-but-unmirrored grants, minus anything the MIRRORED known set
 * already carries (mirrored knownness and the copper debit arrive together
 * in both hosts, so a mirror-known learn is a settled fee). The row under
 * pricing is excluded from the reserve so its own gold fee chip stays honest
 * under the disabled pending state (the painter's pending arm pins that
 * look). Clamped at 0: online the debited copper can mirror while a flight
 * is still open, and a negative purse would wrongly disable free tier-0
 * rows. Pure and host-agnostic so the view tests pin it directly.
 */
export function availableTrainCopper(
  copper: number,
  reservedRecipes?: ReadonlySet<string>,
  /** Recipe id of the row being priced; its own reserved fee is not held against it. */
  excludeRecipeId?: string,
): number {
  if (!reservedRecipes || reservedRecipes.size === 0) return copper;
  let reserved = 0;
  for (const id of reservedRecipes) {
    if (id === excludeRecipeId) continue;
    const recipe = recipeById(id);
    if (recipe) reserved += trainingFeeFor(recipe);
  }
  return Math.max(0, copper - reserved);
}

/** True when a station master with `masterNpcId` exists (the gossip dialog's
 *  Train-option gate; template id, never an entity id). */
export function isStationMasterNpc(masterNpcId: string, stations: readonly StationDef[]): boolean {
  return stations.some((station) => station.masterNpcId === masterNpcId);
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
 * station (STATIONS masterNpcId), and every recipe whose teaching home is
 * that station's type becomes a row. The home is the sim's own
 * trainingStationTypeFor (the recipe's stationType, else its craft's
 * station), the same resolution resolveTrain's range arm applies, so a
 * recipe this list shows is exactly one this master teaches: the tool-effect
 * charms (enchanting home, toolworks binding) list at the toolworks because
 * that is where resolveTrain teaches them. Rows sort by craft, then
 * skillReq, then id (a stable ladder).
 */
export function buildTrainView(masterNpcId: string, deps: TrainViewDeps): TrainView {
  const station = deps.stations.find((entry) => entry.masterNpcId === masterNpcId);
  if (!station) return { stationType: null, rows: [] };
  const known = new Set(deps.knownRecipes);
  // The fee reserve: flights and confirms whose charge the purse number does
  // not answer for yet. An id the MIRROR already knows is a settled fee:
  // offline the debit and the grant land synchronously before the click
  // repaint, and online the cprof grant and the debited copper ride the same
  // self-frame, so mirrored knownness is exactly the observable that the fee
  // left the purse. Filtering the reserve on it kills both failure
  // directions at once: an already-debited purse is never reserved a second
  // time, and a sibling's gold chip cannot flash back between trainResult ok
  // and the copper mirror landing.
  const reserved = new Set<string>();
  if (deps.pendingRecipes) {
    for (const id of deps.pendingRecipes) if (!known.has(id)) reserved.add(id);
  }
  if (deps.confirmedRecipes) {
    for (const id of deps.confirmedRecipes) if (!known.has(id)) reserved.add(id);
  }
  // Confirmed-but-unmirrored learns read Known immediately: knownness wins
  // over any stale pending flag for the same id (resolve() cleared it anyway).
  if (deps.confirmedRecipes) for (const id of deps.confirmedRecipes) known.add(id);
  const rows: TrainRow[] = [];
  for (const recipe of ALL_RECIPES) {
    if (trainingStationTypeFor(recipe) !== station.type) continue;
    const state = rowState(recipe, known, deps.craftSkills);
    if (state === null) continue;
    const feeCopper = trainingFeeFor(recipe);
    const spendable = availableTrainCopper(deps.copper, reserved, recipe.id);
    rows.push({
      recipeId: recipe.id,
      professionId: recipe.professionId,
      resultItemId: recipe.resultItemId,
      item: deps.items[recipe.resultItemId],
      skillReq: recipe.skillReq,
      state,
      ...(state === 'teachable' && deps.pendingRecipes?.has(recipe.id) ? { pending: true } : {}),
      feeCopper,
      affordable: spendable >= feeCopper,
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
