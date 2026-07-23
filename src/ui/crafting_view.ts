// Pure, host-agnostic view model for the crafting window (issue #1127).
//
// This is the pure-core half of the pure-core + thin-consumer split (root
// CLAUDE.md Conventions; reference unit_portrait.ts / vendor_view.ts). It owns
// the one thing the crafting window decides that is worth testing without a
// DOM: for each known recipe, whether the local player currently holds every
// required reagent (so the "Craft" button can be enabled/disabled), and the
// display quantities for each reagent line. The DOM/i18n side lives in a
// thin painter; rendering is driven entirely off the structure returned here.
//
// DOM-free and i18n-free so tests/crafting_view.test.ts can drive it directly.

import { ALL_RECIPES } from '../sim/content/recipes';
import { craftSkillGainMultiplier } from '../sim/professions/archetype';
import {
  type ComboEligibilityReason,
  comboEligibility,
} from '../sim/professions/combo_eligibility';
import { isCommissionEligible } from '../sim/professions/commission';
import { type StationType, stationsOfType, stationTypeForCraft } from '../sim/professions/stations';
import { MINIMAL_TIER_MULTIPLIER, REDUCED_TIER_MULTIPLIER } from '../sim/professions/wheel';
import type { InvSlot, ItemDef } from '../sim/types';
import { isRecipeKnownForViewer } from './hud/vendor/train_view';

export interface RecipeDefLike {
  id: string;
  professionId: string;
  resultItemId: string;
  resultCount: number;
  reagents: readonly { itemId: string; count: number }[];
  skillReq: number;
  // Station-bound recipe (Professions 2.0): craftable only at a
  // station of this type (see src/sim/professions/stations.ts).
  stationType?: StationType;
  // Combo-recipe gate (#1132): present only on a recipe exclusive to one
  // specific adjacent craft pair. See src/sim/professions/types.ts for the
  // authoritative shape and src/sim/professions/crafting.ts for resolution.
  comboRequirement?: {
    craftA: string;
    craftB: string;
    minTier: number;
  };
}

/** The skill-GAIN outlook for crafting a recipe, mirroring the sim's
 *  tier-progress multiplier at the gainCraftSkill call site in
 *  src/sim/professions/crafting.ts: the four-state mastery curve.
 *  'full' (multiplier 1), 'reduced' (REDUCED_TIER_MULTIPLIER, one tier under
 *  capability), 'minimal' (MINIMAL_TIER_MULTIPLIER, two tiers under),
 *  'none' (0: three-plus tiers under capability, or the recipe tier is above
 *  the archetype ceiling). Purely informational, never an admission gate:
 *  there is no skillReq gate on crafting. */
export type CraftDifficulty = 'full' | 'reduced' | 'minimal' | 'none';

export interface CraftingReagentRow {
  itemId: string;
  item?: ItemDef;
  required: number;
  have: number;
  /** True when the player holds at least `required` of this reagent. */
  satisfied: boolean;
}

export interface CraftingRecipeRow {
  recipeId: string;
  professionId: string;
  resultItemId: string;
  result?: ItemDef;
  resultCount: number;
  reagents: CraftingReagentRow[];
  comboRequirement?: {
    craftA: string;
    craftB: string;
    minTier: number;
    met: boolean | null;
    reason: ComboEligibilityReason | 'syncing' | null;
    unmetCrafts: string[];
  };
  /** The recipe's flat skill requirement, surfaced for the skill-req line. */
  skillReq: number;
  /** Skill-gain outlook (see CraftDifficulty). Actionable info: identical on
   *  every graphics preset, and the painter must never carry it color-only. */
  difficulty: CraftDifficulty;
  /** Station gate (formerly #1297's hub boolean): null when the
   *  recipe has no stationType; otherwise WHICH station type it needs and
   *  whether the player is currently in range of one (a physical station or
   *  their own active mobile station, folded into the in-range set the HUD
   *  passes in). */
  station: { required: true; type: StationType; inRange: boolean } | null;
  /** True only when every reagent row is satisfied AND (for a combo recipe) the
   *  player's tier capability meets comboRequirement in both named crafts AND
   *  (for a station-bound recipe) the player is in station range: the "Craft"
   *  action is enabled. The server re-validates every gate on craft. */
  craftable: boolean;
  /** Commission opt-in visibility (Professions 2.0): true iff the
   *  result def is one of the ruled-in equipment kinds (weapon, armor,
   *  held_offhand; src/sim/professions/commission.ts, the SAME predicate the
   *  sim's craft resolver honors, so the control can never show where the
   *  flag would be ignored). The painter renders the per-craft checkbox only
   *  on these rows; the server re-validates eligibility on craft. */
  commissionEligible: boolean;
}

export interface CraftingView {
  recipes: CraftingRecipeRow[];
}

export interface CraftingIdentityLike {
  synced: boolean;
  activeArchetype: string | null;
  pairedMajor: string | null;
  hobbyCraft: string | null;
}

function countInInventory(inventory: readonly InvSlot[], itemId: string): number {
  let n = 0;
  for (const slot of inventory) if (slot.itemId === itemId) n += slot.count;
  return n;
}

/**
 * Build the structured crafting view from raw inputs: the recipe content list,
 * the local player's inventory, the item table (for display name/icon/
 * quality), and the local player's flat craft skills (for the combo-recipe
 * gate, #1132; defaults to empty so existing common-tier-only callers, e.g.
 * tests, need not pass it), and the set of station types the player is
 * currently in range of (station-bound recipes: physical stations
 * plus the own active mobile station, precomputed once per repaint by the
 * HUD via stations.ts inRangeStationTypes; defaults to empty, i.e. out of
 * range of everything, so station-free callers need not pass it). Read-only:
 * never mutates any of its inputs.
 */
export function buildCraftingView(
  recipes: readonly RecipeDefLike[],
  inventory: readonly InvSlot[],
  items: Record<string, ItemDef>,
  craftSkills: Readonly<Record<string, number>> = {},
  identity: CraftingIdentityLike = {
    synced: true,
    activeArchetype: null,
    pairedMajor: null,
    hobbyCraft: null,
  },
  inRangeStations: ReadonlySet<StationType> = new Set(),
): CraftingView {
  // One mutable copy for the sim-side pure functions (their CraftSkills
  // parameter is mutable-typed); they never write it, this is typing only.
  const skills = { ...craftSkills };
  const rows: CraftingRecipeRow[] = recipes.map((recipe) => {
    const reagentRows: CraftingReagentRow[] = recipe.reagents.map((reagent) => {
      const have = countInInventory(inventory, reagent.itemId);
      return {
        itemId: reagent.itemId,
        item: items[reagent.itemId],
        required: reagent.count,
        have,
        satisfied: have >= reagent.count,
      };
    });
    const combo = recipe.comboRequirement;
    const eligibility = identity.synced ? comboEligibility(combo, skills, identity) : null;
    const comboReason: ComboEligibilityReason | 'syncing' | null = identity.synced
      ? (eligibility?.reason ?? null)
      : 'syncing';
    const comboRequirement = combo
      ? {
          ...combo,
          met: eligibility?.ok ?? null,
          reason: comboReason,
          unmetCrafts: eligibility?.unmetCrafts ?? [],
        }
      : undefined;
    // Skill-gain difficulty: the SAME shared craftSkillGainMultiplier the
    // sim's gainCraftSkill site consumes (archetype.ts), so the label can
    // never diverge from the authoritative grant. Computed the same while
    // identity is still syncing (empty pre-cprof skills, null archetype):
    // presentation-neutral, and never a craftable gate either way.
    const multiplier = craftSkillGainMultiplier(
      skills,
      identity.activeArchetype,
      identity.pairedMajor,
      recipe.professionId,
      identity.hobbyCraft,
      recipe.skillReq,
    );
    const difficulty: CraftDifficulty =
      multiplier === 0
        ? 'none'
        : multiplier === REDUCED_TIER_MULTIPLIER
          ? 'reduced'
          : multiplier === MINIMAL_TIER_MULTIPLIER
            ? 'minimal'
            : 'full';
    const station = recipe.stationType
      ? {
          required: true as const,
          type: recipe.stationType,
          inRange: inRangeStations.has(recipe.stationType),
        }
      : null;
    return {
      recipeId: recipe.id,
      professionId: recipe.professionId,
      resultItemId: recipe.resultItemId,
      result: items[recipe.resultItemId],
      resultCount: recipe.resultCount,
      reagents: reagentRows,
      ...(comboRequirement ? { comboRequirement } : {}),
      skillReq: recipe.skillReq,
      difficulty,
      station,
      commissionEligible: isCommissionEligible(items[recipe.resultItemId]),
      craftable:
        reagentRows.every((r) => r.satisfied) &&
        eligibility?.ok !== false &&
        (station === null || station.inRange),
    };
  });
  return { recipes: rows };
}

// ---------------------------------------------------------------------------
// Craft tabs: the window shows one craft at a time behind a tab strip, so a
// ten-craft recipe book stays scannable. The tab list and the selection
// fallback are model decisions (they change what renders), so they live here
// where both hosts' tests pin them; the painter only paints the result.
// ---------------------------------------------------------------------------

export interface CraftingTab {
  professionId: string;
  /** How many known recipes the tab holds (its badge and its right to exist). */
  recipeCount: number;
}

/** The tab strip for a built view: one tab per craft with at least one known
 *  recipe, in order of first appearance in the recipe list (the same order the
 *  window's sections have always used, so tab order never jumps between
 *  repaints of the same content). */
export function craftingTabs(view: CraftingView): CraftingTab[] {
  const tabs: CraftingTab[] = [];
  const byId = new Map<string, CraftingTab>();
  for (const row of view.recipes) {
    const existing = byId.get(row.professionId);
    if (existing) {
      existing.recipeCount += 1;
    } else {
      const tab = { professionId: row.professionId, recipeCount: 1 };
      byId.set(row.professionId, tab);
      tabs.push(tab);
    }
  }
  return tabs;
}

/** Resolve which craft the window actually shows: the requested craft when it
 *  still owns a tab, else the first tab (a craft can vanish from the strip
 *  when its last recipe stops being known, e.g. across a language-agnostic
 *  data refresh), else null for an empty book. */
export function resolveSelectedCraft(
  tabs: readonly CraftingTab[],
  requested: string | null,
): string | null {
  if (requested !== null && tabs.some((tab) => tab.professionId === requested)) return requested;
  return tabs.length > 0 ? tabs[0].professionId : null;
}

/** One craft's "learnable at a master" pointer: the station type that serves it
 *  and the resident master's NPC template id (the painter localizes the master
 *  name through entity i18n and the station name through the station-name
 *  table). */
export interface CraftLearnHint {
  stationType: StationType;
  masterNpcId: string;
}

/**
 * Crafts that have at least one trainer-taught recipe the viewer has NOT
 * learned, mapped to the station type serving that craft (stationTypeForCraft)
 * and the resident master (the station registry). Drives the crafting window's
 * per-section "learnable at a master" discoverability hint: a section renders
 * the hint iff its craft is in this map.
 *
 * Uses the SHARED isRecipeKnownForViewer predicate (train_view.ts), never a
 * second knownness rule, so the hint can never disagree with the train ladder
 * or the crafting window's known-recipe filter. A craft with no physical
 * station (or no seated master) is never hinted: trainer recipes only exist for
 * stationed crafts, and there would be no master to point at. Read-only over
 * static content plus the viewer's mirrored known set (both hosts carry
 * knownRecipes on cprof, so no new IWorld member is needed).
 */
export function craftLearnHints(knownRecipes: readonly string[]): Map<string, CraftLearnHint> {
  const known = new Set(knownRecipes);
  const hints = new Map<string, CraftLearnHint>();
  for (const recipe of ALL_RECIPES) {
    if (hints.has(recipe.professionId)) continue;
    if (!recipe.acquisition?.includes('trainer')) continue;
    if (isRecipeKnownForViewer(recipe, known)) continue;
    const stationType = stationTypeForCraft(recipe.professionId);
    if (!stationType) continue;
    const station = stationsOfType(stationType)[0];
    if (!station) continue;
    hints.set(recipe.professionId, { stationType, masterNpcId: station.masterNpcId });
  }
  return hints;
}
