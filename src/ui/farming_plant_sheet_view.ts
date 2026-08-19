// Pure, host-agnostic core for the plant sheet: the window a press on a free
// garden bed opens (Phase 9b, the bed verbs). Maps the caller's bags and
// Farming skill to the seeds they can SOW at that bed right now, the seeds
// they hold but cannot sow yet (with the honest reason), and the three
// plant-time care knobs with their affordability.
//
// THESE ARE BAG-DERIVED OFFER GATES, NEVER A PREDICTION. The sheet mirrors
// the sim's own plantCrop gate order (skill, then the unlocked seed, then the
// hoe: src/sim/professions/farming.ts steps 7, 8, 12) so that what it OFFERS
// is exactly what the sim would accept from this bag snapshot, but the sim
// re-validates everything server-side and its farmPlanted / farmDenied events
// are the only outcome feedback. Nothing here rolls, consumes, or promises.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import {
  FARM_COMPOST_ITEM_ID,
  FARM_CROPS,
  FARM_GROWTH_TONIC_ITEM_ID,
} from '../sim/content/farm_crops';
import { ITEMS } from '../sim/data';
import { countUnlockedInSlots } from '../sim/item_lock';
import type { FarmPlotView } from '../sim/professions/farm_projection';
import { planWatchFee } from '../sim/professions/farm_watch_fee';
import { canPlantCrop } from '../sim/professions/farming';
import { canGatherTier, NO_TOOL_OWNED } from '../sim/professions/tools';
import { bestWieldableGatherToolTierOrNone } from '../sim/professions/wield_gate';
import type { InvSlot } from '../sim/types';
import { farmDeniedLineKey } from './farming_view';
import type { TranslationKey } from './i18n.catalog';

/** A seed the caller can sow at this bed right now: at least one UNLOCKED
 *  copy in bags, the crop's skill threshold met, and a wieldable hoe of the
 *  crop's tier carried. */
export interface PlantSheetSeedRow {
  cropId: string;
  seedItemId: string;
  /** Unlocked copies in bags, the count the row's badge shows. */
  seedCount: number;
  tier: number;
  selected: boolean;
}

/** A seed the caller HOLDS copies of but cannot sow yet. The reason is the
 *  FIRST failing gate in the sim's own order, resolved to the same denied-
 *  family line the real refusal would toast, so the sheet and the sim can
 *  never explain one shortfall two ways. Crops with zero copies held do not
 *  appear at all. */
export interface PlantSheetLockedRow {
  cropId: string;
  seedItemId: string;
  tier: number;
  reasonKey: TranslationKey;
  /** Present only on the hoe reason (the tierRequired.farming line). */
  reasonParams?: { tier: number };
}

export type PlantSheetKnobId = 'compost' | 'watch' | 'tonic';

export interface PlantSheetKnobLeg {
  readonly itemId: string;
  readonly count: number;
}

/** One plant-time care knob. Affordability follows the SELECTED seed row
 *  (the watch fee scales with the crop's tier) and reads UNLOCKED counts,
 *  the same counts the sim's payment steps read. */
export interface PlantSheetKnob {
  id: PlantSheetKnobId;
  affordable: boolean;
  /** The cost legs the detail chips render: one unit of the supply item for
   *  compost and the tonic, the planned fee legs for the watch. Empty when
   *  unaffordable (a null watch plan has no legs to show). */
  legs: readonly PlantSheetKnobLeg[];
  /** The shortfall hint, the denied-family line for this knob's payment
   *  (locked when raw copies would have covered it); null when affordable. */
  shortKey: TranslationKey | null;
}

export interface PlantSheetInput {
  bedId: string;
  inventory: readonly InvSlot[];
  /** The caller's own plots (IWorldFarming.myFarmPlots): the occupancy guard.
   *  A bed occupied by MY plot never builds a model. */
  myFarmPlots: readonly FarmPlotView[];
  farmingSkill: number;
  /** The sticky selection across repaints; an id no longer sowable falls back
   *  to the first seed row. */
  selectedCropId?: string | null;
}

export interface PlantSheetViewModel {
  bedId: string;
  seedRows: readonly PlantSheetSeedRow[];
  lockedRows: readonly PlantSheetLockedRow[];
  selectedCropId: string | null;
  /** Empty when nothing is sowable (no selection to price the knobs for). */
  knobs: readonly PlantSheetKnob[];
}

/** Whether the sheet may open for this bed at all: only a bed the caller has
 *  no plot in. Shared by the window and the Hud-side caller so the guard
 *  cannot drift between them. Occupied beds are the harvest verb's business
 *  (the nearby-interaction bed arm), never this window's. */
export function canOpenPlantSheet(bedId: string, myFarmPlots: readonly FarmPlotView[]): boolean {
  return !myFarmPlots.some((plot) => plot.bedId === bedId);
}

/** Raw copies in bags, locked included: the count that splits a locked-copy
 *  shortfall (denied.locked) from a plain shortage, mirroring the sim's own
 *  countUnlockedInSlots-then-ctx.countItem deny split. */
function countRawInSlots(inventory: readonly InvSlot[], itemId: string): number {
  let total = 0;
  for (const slot of inventory) {
    if (slot.itemId === itemId) total += slot.count;
  }
  return total;
}

/** The compost / tonic knob: one unlocked unit of the supply item affords it. */
function supplyKnob(
  id: PlantSheetKnobId,
  itemId: string,
  shortReason: 'no_compost' | 'no_tonic',
  inventory: readonly InvSlot[],
): PlantSheetKnob {
  if (countUnlockedInSlots(inventory, itemId) >= 1) {
    return { id, affordable: true, legs: [{ itemId, count: 1 }], shortKey: null };
  }
  const raw = countRawInSlots(inventory, itemId);
  return {
    id,
    affordable: false,
    legs: [],
    shortKey: farmDeniedLineKey(raw >= 1 ? 'locked' : shortReason),
  };
}

/** Build the sheet's model, or null when the bed holds the caller's own plot
 *  (the caller guards with canOpenPlantSheet; null is the belt-and-braces
 *  answer for a paint that races a just-landed farmPlanted). */
export function buildPlantSheetView(input: PlantSheetInput): PlantSheetViewModel | null {
  if (!canOpenPlantSheet(input.bedId, input.myFarmPlots)) return null;
  const hoeTier = bestWieldableGatherToolTierOrNone(
    input.inventory,
    'farming',
    input.farmingSkill,
    ITEMS,
  );
  const seedRows: PlantSheetSeedRow[] = [];
  const lockedRows: PlantSheetLockedRow[] = [];
  for (const crop of Object.values(FARM_CROPS)) {
    if (countRawInSlots(input.inventory, crop.seedItemId) < 1) continue;
    // The sim's own gate order (plantCrop steps 7, 8, 12): skill, then the
    // unlocked seed, then the hoe. The first failing gate names the row.
    if (!canPlantCrop(crop, input.farmingSkill)) {
      lockedRows.push({
        cropId: crop.id,
        seedItemId: crop.seedItemId,
        tier: crop.tier,
        reasonKey: farmDeniedLineKey('skill'),
      });
      continue;
    }
    const unlocked = countUnlockedInSlots(input.inventory, crop.seedItemId);
    if (unlocked < 1) {
      lockedRows.push({
        cropId: crop.id,
        seedItemId: crop.seedItemId,
        tier: crop.tier,
        reasonKey: farmDeniedLineKey('locked'),
      });
      continue;
    }
    if (hoeTier === NO_TOOL_OWNED || !canGatherTier(hoeTier, crop.tier)) {
      lockedRows.push({
        cropId: crop.id,
        seedItemId: crop.seedItemId,
        tier: crop.tier,
        reasonKey: 'hudChrome.gathering.tierRequired.farming',
        reasonParams: { tier: crop.tier },
      });
      continue;
    }
    seedRows.push({
      cropId: crop.id,
      seedItemId: crop.seedItemId,
      seedCount: unlocked,
      tier: crop.tier,
      selected: false,
    });
  }
  const selectedCropId =
    seedRows.find((row) => row.cropId === input.selectedCropId)?.cropId ??
    seedRows[0]?.cropId ??
    null;
  for (const row of seedRows) row.selected = row.cropId === selectedCropId;
  const knobs: PlantSheetKnob[] = [];
  const selectedTier = seedRows.find((row) => row.selected)?.tier;
  if (selectedTier !== undefined) {
    knobs.push(supplyKnob('compost', FARM_COMPOST_ITEM_ID, 'no_compost', input.inventory));
    const plan = planWatchFee(selectedTier, (itemId) =>
      countUnlockedInSlots(input.inventory, itemId),
    );
    if (plan !== null) {
      knobs.push({ id: 'watch', affordable: true, legs: plan, shortKey: null });
    } else {
      // The sim's own deny split, previewed: a raw-count plan that WOULD have
      // covered the fee means a locked copy is the whole shortfall.
      const rawPlan = planWatchFee(selectedTier, (itemId) =>
        countRawInSlots(input.inventory, itemId),
      );
      knobs.push({
        id: 'watch',
        affordable: false,
        legs: [],
        shortKey: farmDeniedLineKey(rawPlan !== null ? 'locked' : 'no_fee_produce'),
      });
    }
    knobs.push(supplyKnob('tonic', FARM_GROWTH_TONIC_ITEM_ID, 'no_tonic', input.inventory));
  }
  return { bedId: input.bedId, seedRows, lockedRows, selectedCropId, knobs };
}
