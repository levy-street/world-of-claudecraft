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

import { CRAFT_GOLD_SINK_COPPER_PER_BUDGET } from '../sim/content/professions';
import { ALL_RECIPES } from '../sim/content/recipes';
import { countUnlockedInSlots } from '../sim/item_lock';
import { drawableCounterFor, drawableVaultCount } from '../sim/materials_vault';
import { craftSkillGainMultiplier } from '../sim/professions/archetype';
import {
  type ComboEligibilityReason,
  comboEligibility,
} from '../sim/professions/combo_eligibility';
import { isCommissionEligible } from '../sim/professions/commission';
import { holdsSelfSignedInstance, requiredReagentCountFor } from '../sim/professions/crafting';
import { countAcrossGrades, materialGradeIds } from '../sim/professions/material_grades';
import {
  countMinusPlanned,
  planReagentSourceDraw,
  tallyPlannedTakes,
} from '../sim/professions/reagent_sources';
import { type StationType, stationsOfType } from '../sim/professions/stations';
import { trainingStationTypeFor } from '../sim/professions/training';
import type { ProfessionRecipeRecord } from '../sim/professions/types';
import { MINIMAL_TIER_MULTIPLIER, REDUCED_TIER_MULTIPLIER } from '../sim/professions/wheel';
import type { InvSlot, ItemDef, StationDef } from '../sim/types';
import { recipeDurationSec } from './craft_cast_view';
import { isRecipeKnownForViewer } from './hud/vendor/train_view';

export interface RecipeDefLike {
  id: string;
  professionId: string;
  resultItemId: string;
  resultCount: number;
  reagents: readonly { itemId: string; count: number }[];
  skillReq: number;
  // The recipe's item-level budget, the #1301 gold-sink fee's input (see
  // CraftingRecipeRow.craftFeeCopper below). Optional so a caller that only
  // needs reagent/craftable/difficulty logic (most existing tests) can omit
  // it; a recipe with no budget charges no fee.
  itemLevelBudget?: number;
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
  /** Units of the FINE grade this craft would consume because base stock
   *  runs short (the UX pass): resolved through the sim's own reagent plan
   *  (base drains first, D8), so the warning and the spend can never
   *  disagree. Counted across BOTH source tiers (a fine unit drawn from the
   *  vault still spends 2x gather value, so it still warns). 0 when the base
   *  covers the bill, and 0 while the row is unsatisfied (an uncraftable
   *  recipe warns about nothing). */
  fineSubstituted: number;
  /** Units this craft would draw from the Materials Vault because carried
   *  stock runs short (Bank Storage Phase 04): resolved through the SAME
   *  shared planReagentSourceDraw the sim's admission gate and consume use
   *  (carried always drains first), so the stated vault spend and the real
   *  one can never disagree. 0 when carried covers the bill, when the world
   *  reports vault draw unavailable here (vaultStock null), and while the
   *  row is unsatisfied. May overlap fineSubstituted (a fine unit drawn from
   *  the vault counts in both: one warns about grade value, this one about
   *  source). */
  vaultDrawn: number;
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
  /** Expected craft-cast duration in sim seconds (Craft Cast System Phase 2).
   *  Content table via craftCastDurationSec; actionable info, identical on
   *  every graphics preset (duration chip is never tier-gated). */
  durationSec: number;
  /** The #1301 gold-sink fee this craft charges, in copper: the SAME formula
   *  crafting.ts resolveCraftForRecipe charges
   *  (Math.ceil(itemLevelBudget * CRAFT_GOLD_SINK_COPPER_PER_BUDGET)), so the
   *  displayed fee and the charged fee can never diverge. Zero for a recipe
   *  with no itemLevelBudget. Previously charged silently with no line item
   *  anywhere in the crafting window; now surfaced so a player can weigh it
   *  against material and vendor value before crafting. */
  craftFeeCopper: number;
}

export interface CraftingView {
  recipes: CraftingRecipeRow[];
  /** True when vault draw is BLOCKED at this location (a gated context, the
   *  Phase 04 QA note) AND some reagent row across the KNOWN recipes is
   *  unsatisfied: the situation where the invisible vault might have made
   *  the difference, so the window states the place-based reason in words
   *  (the stationOutOfRange precedent) instead of leaving rows silently
   *  short. The painter additionally scopes the RENDER to the selected
   *  section's rows, so an all-green visible tab stays quiet. Never true for
   *  a merely EMPTY vault (vaultStock {} is not blocked). */
  vaultNote: boolean;
}

export interface CraftingIdentityLike {
  synced: boolean;
  activeArchetype: string | null;
  pairedMajor: string | null;
  hobbyCraft: string | null;
}

// Lock-aware (issue 3042): a player-locked reagent copy is not spendable, so
// it must never count toward "you have enough" here either, or the Craft
// button would light up green for a craft the sim then refuses. The same
// count the sim's own hasRecipeMaterials/resolveCraftForRecipe gate on
// (src/sim/item_lock.ts countUnlockedInSlots), so the two can never disagree
// about whether a recipe is craftable.
function countInInventory(inventory: readonly InvSlot[], itemId: string): number {
  return countUnlockedInSlots(inventory, itemId);
}

/** The two per-item inventory facts a reagent row needs (see the memo in
 *  buildCraftingView). */
type ReagentFacts = { have: number; selfSigned: boolean };

/**
 * Build the structured crafting view from raw inputs: the recipe content list,
 * the local player's inventory, the item table (for display name/icon/
 * quality), and the local player's flat craft skills (for the combo-recipe
 * gate, #1132; defaults to empty so existing common-tier-only callers, e.g.
 * tests, need not pass it), and the set of station types the player is
 * currently in range of (station-bound recipes: physical stations
 * plus the own active mobile station, precomputed once per repaint by the
 * HUD via stations.ts inRangeStationTypes; defaults to empty, i.e. out of
 * range of everything, so station-free callers need not pass it), and the
 * local player's name (the #1145 self-signed reduction: defaults to null,
 * meaning the self-signed check never matches; the #1134 specialization
 * discount still applies from craftSkills either way), and the drawable
 * Materials Vault stock as visible to crafting HERE (IWorld craftVaultStock,
 * Bank Storage Phase 04: null means vault draw is unavailable at this
 * location; for every SHIPPED recipe the null view is byte-identical to the
 * pre-vault one, and the one divergence is deliberate and content-guarded:
 * the carried-tier cross-reagent tally applies on the null path too, so an
 * OVERLAPPING recipe that the old per-item fold called satisfied on both
 * rows is now correctly unsatisfied on the second; defaults to null so every
 * existing caller is unchanged), and `vaultBlocked` (Phase 04 QA): true when
 * the location itself refuses vault draw, which is a DISTINCT fact from a
 * null vaultStock default (an old caller passing nothing must not render a
 * blocked note), used only to derive `vaultNote`. Read-only:
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
  playerName: string | null = null,
  vaultStock: Readonly<Record<string, number>> | null = null,
  vaultBlocked = false,
): CraftingView {
  // One mutable copy for the sim-side pure functions (their CraftSkills
  // parameter is mutable-typed); they never write it, this is typing only.
  const skills = { ...craftSkills };
  // Every known recipe is rowed on each rebuild and recipes share reagents
  // (a craft's recipes pull from the same ore/flux pool), so the two
  // O(inventory) probes per reagent (stack count plus the #1145 self-signed
  // check) memoize per itemId. Only the per-ITEM facts are cached, never the
  // required count (that also depends on the recipe: its professionId and
  // this reagent's listed count), and the cache lives only for this one
  // build, so a rebuild re-reads the live inventory through the same
  // single-surface helpers.
  const reagentFacts = new Map<string, ReagentFacts>();
  // The vault tier's per-grade count callback, shared by the have fold and
  // the per-row plan below: null when the world reports vault draw
  // unavailable here, so the planner's vault tier is simply absent and every
  // number degrades to the pre-vault value. drawableCounterFor re-applies the
  // drawable rule per read, so a test double handing raw stock is still read
  // safely (the shared null-or-counter adapter, materials_vault.ts).
  const vaultCount = drawableCounterFor(vaultStock);
  const factsFor = (itemId: string): ReagentFacts => {
    let facts = reagentFacts.get(itemId);
    if (!facts) {
      facts = {
        // Counted across the reagent's material grades, exactly as the sim's
        // hasRecipeMaterials does (D8, professions/material_grades.ts). A fine
        // grade satisfies a requirement for its base, so counting the declared
        // id alone would grey the Craft button out for a craft the sim would
        // perform: eastbrook_vale is all tier-1 veins, so any tier-2 tool stops
        // the plain grade dropping and every recipe naming it would go
        // unbuildable through the window while resolveCraft accepted it.
        // Vault-backed availability folds in the SAME way (Phase 04): the sim's
        // admission gate admits carried plus drawable vault stock, so the
        // displayed have and the Craft gate track the server's answer in both
        // hosts (countAcrossGrades and the vault fold share the grade walk).
        have:
          countAcrossGrades(itemId, (gradeId) => countInInventory(inventory, gradeId)) +
          (vaultCount === null ? 0 : countAcrossGrades(itemId, vaultCount)),
        selfSigned:
          playerName !== null &&
          materialGradeIds(itemId).some((gradeId) =>
            holdsSelfSignedInstance(inventory, playerName, gradeId),
          ),
      };
      reagentFacts.set(itemId, facts);
    }
    return facts;
  };
  const rows: CraftingRecipeRow[] = recipes.map((recipe) => {
    // Cross-reagent tallies (the Phase 04 review round): the sim's
    // planCraftReagentDraw refuses to promise the same units to two reagents,
    // so this projection tallies BOTH pools across the recipe's reagents in
    // the same order, or the Craft button would lie for a recipe whose
    // reagents name one material (or overlap grade ladders). No shipped
    // recipe does (the content guard in tests/crafting_view.test.ts pins
    // that), so every shipped answer is byte-identical; the tally is what
    // keeps the window honest the day content changes.
    const carriedPlanned = new Map<string, number>();
    const vaultPlanned = new Map<string, number>();
    const reagentRows: CraftingReagentRow[] = recipe.reagents.map((reagent) => {
      const { have, selfSigned } = factsFor(reagent.itemId);
      // The requirement the sim actually charges: the SAME shared
      // requiredReagentCountFor the resolver's availability check and
      // consumption use (crafting.ts, #1134 specialization discount composed
      // with the #1145 self-signed reduction), fed the same grade-spanning
      // self-signed fact the sim feeds it, so the displayed count and the
      // Craft gate can never diverge from what a craft consumes.
      const required = requiredReagentCountFor(
        selfSigned,
        reagent,
        skills,
        recipe.professionId,
      ).count;
      // The satisfaction, substitution and vault-draw signals (the UX pass +
      // Phase 04): all read off the SAME planReagentSourceDraw the sim's
      // admission gate and consume use (carried drains first, base before
      // fine inside each tier, both pools tallied across reagents), so
      // neither the Craft gate nor a stated spend can disagree with the real
      // one. `have` stays the raw per-item fold above (display: what the
      // player holds in total), while `satisfied` is the tallied plan's
      // answer, exactly the sim's split. A partial plan still tallies its
      // takes: units are claimed in reagent order, the planner's own rule.
      const plan = planReagentSourceDraw(
        reagent.itemId,
        required,
        countMinusPlanned((gradeId) => countInInventory(inventory, gradeId), carriedPlanned),
        countMinusPlanned(vaultCount, vaultPlanned),
      );
      tallyPlannedTakes(carriedPlanned, plan.carried);
      tallyPlannedTakes(vaultPlanned, plan.vault);
      const satisfied = plan.shortfall === 0;
      // 0 while the row is unsatisfied: an uncraftable recipe warns about
      // nothing (the pinned pre-vault rule).
      const fineSubstituted = satisfied
        ? [...plan.carried, ...plan.vault]
            .filter((take) => take.itemId !== reagent.itemId)
            .reduce((sum, take) => sum + take.count, 0)
        : 0;
      const vaultDrawn = satisfied ? plan.vault.reduce((sum, take) => sum + take.count, 0) : 0;
      return {
        itemId: reagent.itemId,
        item: items[reagent.itemId],
        required,
        have,
        satisfied,
        fineSubstituted,
        vaultDrawn,
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
      durationSec: recipeDurationSec(recipe),
      craftFeeCopper: Math.ceil((recipe.itemLevelBudget ?? 0) * CRAFT_GOLD_SINK_COPPER_PER_BUDGET),
      craftable:
        reagentRows.every((r) => r.satisfied) &&
        eligibility?.ok !== false &&
        (station === null || station.inRange),
    };
  });
  return {
    recipes: rows,
    vaultNote: vaultBlocked && rows.some((row) => row.reagents.some((r) => !r.satisfied)),
  };
}

// Every item id any recipe consumes, derived ONCE from static content. Both
// hosts serve ALL_RECIPES verbatim as IWorld#recipeList (src/sim/sim.ts,
// src/net/online.ts), and reagent ids are authored literals, so this set can
// never miss a reagent the window might row.
// Grades included: three of the nine fine grades (the eastbrook ones) are
// reagents in NO recipe, so a declared-id-only set would let a player gather
// them all afternoon without the open window ever re-converging, which is the
// #2375 failure mode this signature exists to close.
const REAGENT_ITEM_IDS: ReadonlySet<string> = new Set(
  ALL_RECIPES.flatMap((recipe) =>
    recipe.reagents.flatMap((reagent) => materialGradeIds(reagent.itemId)),
  ),
);

/**
 * Compact signature of every bag fact buildCraftingView above reads, so an
 * OPEN crafting window can converge on an inventory change without repainting
 * per frame (issue #2375: buying, looting, or trading for the last reagent
 * left the Craft button disabled until the window was closed and reopened).
 *
 * The window is a cold painter, so the HUD diffs this the same way it diffs
 * stationTypesSignature for the station-range edge. Two properties earn their
 * keep here:
 *  - COMPLETE. Per reagent id it carries the summed stack count (the only
 *    input to countInInventory, and therefore to `have`, `satisfied`, and the
 *    Craft gate) plus whether the VIEWER signed any stack of it, the one
 *    instance fact the #1145 self-signed quantity reduction asks about
 *    (holdsSelfSignedInstance). Those two are the whole of what the view reads
 *    off the bag: money and free bag slots are server-side deny reasons, not
 *    terms in `craftable`. If either ever enters the gate, it belongs here too.
 *  - QUIET. Non-reagent items are skipped and ids are emitted sorted, so
 *    looting a grey, rearranging the bags, or a stranger-signed stack changing
 *    hands never repaints the window under the player.
 *
 * The vault term (Phase 04): the drawable vault rows the view folds into
 * `have` join under a distinct `V:` prefix, restricted to reagent ids and
 * emitted sorted like the bag rows, so a craft that consumed vault stock (or
 * a deposit made at the banker with the window open) converges the open
 * window exactly the way a bag change does. A null vaultStock encodes the
 * DISTINCT `V!|` blocked sentinel ('!' can never open a `V:` row: item ids
 * are lowercase snake_case, content-guarded): the Phase 04 QA vault note
 * renders from blocked-ness, so a gate flip must repaint even when no
 * drawable reagent row changed. (This deliberately supersedes the original
 * {}-equals-null encoding, which was only correct while the view treated
 * the two identically.)
 */
export function craftingReagentSig(
  inventory: readonly InvSlot[],
  playerName: string | null,
  vaultStock: Readonly<Record<string, number>> | null = null,
): string {
  const totals = new Map<string, number>();
  const selfSigned = new Set<string>();
  for (const slot of inventory) {
    if (!REAGENT_ITEM_IDS.has(slot.itemId)) continue;
    totals.set(slot.itemId, (totals.get(slot.itemId) ?? 0) + slot.count);
    if (playerName !== null && slot.instance?.signer === playerName) selfSigned.add(slot.itemId);
  }
  let sig = '';
  for (const itemId of [...totals.keys()].sort())
    sig += `${itemId}:${totals.get(itemId)}:${selfSigned.has(itemId) ? 1 : 0}|`;
  if (vaultStock === null) sig += 'V!|';
  if (vaultStock !== null) {
    const vaultRows: [string, number][] = [];
    for (const itemId of Object.keys(vaultStock)) {
      if (!REAGENT_ITEM_IDS.has(itemId)) continue;
      const count = drawableVaultCount(vaultStock, itemId);
      if (count > 0) vaultRows.push([itemId, count]);
    }
    vaultRows.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [itemId, count] of vaultRows) sig += `V:${itemId}:${count}|`;
  }
  return sig;
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

/** True when `craftId` would own a tab for this viewer: at least one recipe
 *  of that craft is known (craftingTabs' membership rule, restated through
 *  the SHARED isRecipeKnownForViewer predicate without building the view).
 *  The gossip Crafting shortcut checks this before persisting its pre-select
 *  so it never clobbers the saved tab preference (issue #2347) with a craft
 *  the window cannot show; resolveSelectedCraft still guards the render. */
export function craftOwnsTab(
  recipes: readonly ProfessionRecipeRecord[],
  knownRecipes: readonly string[],
  craftId: string,
): boolean {
  const known = new Set(knownRecipes);
  return recipes.some(
    (recipe) => recipe.professionId === craftId && isRecipeKnownForViewer(recipe, known),
  );
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
 * learned, mapped to that recipe's teaching home (trainingStationTypeFor:
 * the recipe's own stationType, else the station serving its craft) and the
 * resident master (the station registry). Drives the crafting window's
 * per-section "learnable at a master" discoverability hint: a section renders
 * the hint iff its craft is in this map.
 *
 * Uses the SHARED isRecipeKnownForViewer predicate (train_view.ts), never a
 * second knownness rule, so the hint can never disagree with the train ladder
 * or the crafting window's known-recipe filter. A recipe with no resolvable
 * teaching home (no stationType and an unstationed craft) is never hinted:
 * there would be no master to point at. Read-only over
 * static content plus the viewer's mirrored known set (both hosts carry
 * knownRecipes on cprof, so no new IWorld member is needed).
 */
export function craftLearnHints(
  knownRecipes: readonly string[],
  stations: readonly StationDef[],
): Map<string, CraftLearnHint> {
  const known = new Set(knownRecipes);
  const hints = new Map<string, CraftLearnHint>();
  for (const recipe of ALL_RECIPES) {
    if (hints.has(recipe.professionId)) continue;
    if (!recipe.acquisition?.includes('trainer')) continue;
    if (isRecipeKnownForViewer(recipe, known)) continue;
    // The recipe's own teaching home (its stationType, else its craft's
    // station), shared with resolveTrain and the trainer list: an
    // enchanting-home charm recipe hints at the toolworks master who
    // actually teaches it, not at a station its craft does not have.
    const stationType = trainingStationTypeFor(recipe);
    if (!stationType) continue;
    const station = stationsOfType(stations, stationType)[0];
    if (!station) continue;
    hints.set(recipe.professionId, { stationType, masterNpcId: station.masterNpcId });
  }
  return hints;
}
