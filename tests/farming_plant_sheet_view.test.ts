// The plant sheet's pure core (src/ui/hud/professions/farming_plant_sheet_view.ts): the
// bag-derived offer gates that mirror the sim's own plantCrop order (skill,
// then the unlocked seed, then the hoe), the locked-vs-absent split, the knob
// affordability (including the watch fee plan's legs and its null arm), and
// the selection default. Driven against BOTH a Sim-shaped bag (rows carrying
// extra per-instance fields) and a ClientWorld-mirror-shaped bag (plain
// decoded rows), which must build the identical model.

import { describe, expect, it } from 'vitest';
import {
  FARM_COMPOST_ITEM_ID,
  FARM_CROPS,
  FARM_GROWTH_TONIC_ITEM_ID,
  farmCropSkillThreshold,
} from '../src/sim/content/farm_crops';
import type { FarmPlotView } from '../src/sim/professions/farm_projection';
import { FARM_WATCH_FEE_BY_TIER } from '../src/sim/professions/farm_watch_fee';
import { wieldRequirementForTier } from '../src/sim/professions/wield_gate';
import type { InvSlot } from '../src/sim/types';
import {
  buildPlantSheetView,
  canOpenPlantSheet,
  type PlantSheetInput,
} from '../src/ui/hud/professions/farming_plant_sheet_view';

const WHEAT = FARM_CROPS.vale_wheat; // tier 1
const CARROT = FARM_CROPS.brook_carrot; // tier 1
const RICE = FARM_CROPS.marsh_rice; // tier 2

/** A skill that passes every gate a tier-2 crop consults: the plant threshold
 *  AND the tier-2 hoe's wield requirement. */
const TIER2_SKILL = Math.max(farmCropSkillThreshold(2), wieldRequirementForTier(2));

const slot = (itemId: string, count: number, over: Partial<InvSlot> = {}): InvSlot => ({
  itemId,
  count,
  ...over,
});

const locked = (itemId: string, count: number): InvSlot =>
  slot(itemId, count, { instance: { locked: true } });

const input = (inventory: InvSlot[], over: Partial<PlantSheetInput> = {}): PlantSheetInput => ({
  bedId: 'bed_eastbrook_1',
  inventory,
  myFarmPlots: [],
  farmingSkill: farmCropSkillThreshold(1),
  ...over,
});

const build = (inventory: InvSlot[], over: Partial<PlantSheetInput> = {}) => {
  const view = buildPlantSheetView(input(inventory, over));
  if (view === null) throw new Error('expected a model');
  return view;
};

describe('plant sheet core: the sowable filter', () => {
  it('offers a seed with unlocked copies, the skill, and a wieldable hoe', () => {
    const view = build([slot(WHEAT.seedItemId, 3), slot('garden_hoe', 1)]);
    expect(view.seedRows).toEqual([
      {
        cropId: WHEAT.id,
        seedItemId: WHEAT.seedItemId,
        seedCount: 3,
        tier: 1,
        selected: true,
      },
    ]);
    expect(view.lockedRows).toEqual([]);
    expect(view.selectedCropId).toBe(WHEAT.id);
  });

  it('drops a crop with ZERO copies held entirely, offered nor locked', () => {
    const view = build([slot(WHEAT.seedItemId, 1), slot('garden_hoe', 1)]);
    const listed = [...view.seedRows, ...view.lockedRows].map((row) => row.cropId);
    expect(listed).toEqual([WHEAT.id]);
    expect(listed).not.toContain(CARROT.id);
  });

  it('locks a held seed on the skill gate with the denied.skill line', () => {
    const view = build([slot(RICE.seedItemId, 1), slot('bronze_hoe', 1)], {
      farmingSkill: farmCropSkillThreshold(2) - 1,
    });
    expect(view.seedRows).toEqual([]);
    expect(view.lockedRows).toEqual([
      {
        cropId: RICE.id,
        seedItemId: RICE.seedItemId,
        tier: 2,
        reasonKey: 'hudChrome.farming.denied.skill',
      },
    ]);
  });

  it('locks a seed whose only copies are player-locked with denied.locked', () => {
    const view = build([locked(WHEAT.seedItemId, 2), slot('garden_hoe', 1)]);
    expect(view.seedRows).toEqual([]);
    expect(view.lockedRows).toHaveLength(1);
    expect(view.lockedRows[0]).toMatchObject({
      cropId: WHEAT.id,
      reasonKey: 'hudChrome.farming.denied.locked',
    });
  });

  it('locks on the hoe gate with the tier-named line: no hoe, and a hoe a tier short', () => {
    const noHoe = build([slot(WHEAT.seedItemId, 1)]);
    expect(noHoe.lockedRows).toHaveLength(1);
    expect(noHoe.lockedRows[0]).toMatchObject({
      cropId: WHEAT.id,
      reasonKey: 'hudChrome.gathering.tierRequired.farming',
      reasonParams: { tier: 1 },
    });
    const tierShort = build([slot(RICE.seedItemId, 1), slot('garden_hoe', 1)], {
      farmingSkill: TIER2_SKILL,
    });
    expect(tierShort.lockedRows).toHaveLength(1);
    expect(tierShort.lockedRows[0]).toMatchObject({
      cropId: RICE.id,
      reasonKey: 'hudChrome.gathering.tierRequired.farming',
      reasonParams: { tier: 2 },
    });
  });

  it("mirrors the sim's gate order: skill outranks the locked seed, which outranks the hoe", () => {
    // All three gates fail at once: the reason is the FIRST in sim order.
    const skillFirst = build([locked(RICE.seedItemId, 1)], {
      farmingSkill: farmCropSkillThreshold(2) - 1,
    });
    expect(skillFirst.lockedRows).toHaveLength(1);
    expect(skillFirst.lockedRows[0]?.reasonKey).toBe('hudChrome.farming.denied.skill');
    // Skill passes, seed locked, no hoe: the locked seed names the row.
    const lockedNext = build([locked(RICE.seedItemId, 1)], { farmingSkill: TIER2_SKILL });
    expect(lockedNext.lockedRows).toHaveLength(1);
    expect(lockedNext.lockedRows[0]?.reasonKey).toBe('hudChrome.farming.denied.locked');
  });
});

describe('plant sheet core: selection', () => {
  const twoSeeds = [slot(WHEAT.seedItemId, 1), slot(CARROT.seedItemId, 1), slot('garden_hoe', 1)];

  it('defaults to the first seed row', () => {
    const view = build(twoSeeds);
    expect(view.selectedCropId).toBe(view.seedRows[0]?.cropId);
    expect(view.seedRows.map((row) => row.selected)).toEqual([true, false]);
  });

  it('keeps a sticky selection that is still sowable', () => {
    const view = build(twoSeeds, { selectedCropId: CARROT.id });
    expect(view.selectedCropId).toBe(CARROT.id);
    expect(view.seedRows.find((row) => row.cropId === CARROT.id)?.selected).toBe(true);
  });

  it('falls back to the first row when the sticky selection stopped being sowable', () => {
    const view = build(twoSeeds, { selectedCropId: RICE.id });
    expect(view.selectedCropId).toBe(view.seedRows[0]?.cropId);
  });
});

describe('plant sheet core: knob affordability', () => {
  const sowable = [slot(WHEAT.seedItemId, 1), slot('garden_hoe', 1)];
  const knob = (view: ReturnType<typeof build>, id: string) => {
    const found = view.knobs.find((k) => k.id === id);
    if (!found) throw new Error(`no ${id} knob`);
    return found;
  };

  it('emits no knobs when nothing is sowable (no selection to price them for)', () => {
    expect(build([slot(WHEAT.seedItemId, 1)]).knobs).toEqual([]);
  });

  it('prices compost and the tonic off one unlocked unit, with the shortfall split', () => {
    const held = build([...sowable, slot(FARM_COMPOST_ITEM_ID, 2)]);
    expect(knob(held, 'compost')).toEqual({
      id: 'compost',
      affordable: true,
      legs: [{ itemId: FARM_COMPOST_ITEM_ID, count: 1 }],
      shortKey: null,
    });
    expect(knob(held, 'tonic')).toMatchObject({
      affordable: false,
      shortKey: 'hudChrome.farming.denied.no_tonic',
    });
    const lockedOnly = build([...sowable, locked(FARM_COMPOST_ITEM_ID, 1)]);
    expect(knob(lockedOnly, 'compost')).toMatchObject({
      affordable: false,
      shortKey: 'hudChrome.farming.denied.locked',
    });
    const tonicHeld = build([...sowable, slot(FARM_GROWTH_TONIC_ITEM_ID, 1)]);
    expect(knob(tonicHeld, 'tonic')).toMatchObject({
      affordable: true,
      legs: [{ itemId: FARM_GROWTH_TONIC_ITEM_ID, count: 1 }],
    });
  });

  it('plans the watch fee off unlocked produce: the legs, the shortfall, the locked split', () => {
    const fee = FARM_WATCH_FEE_BY_TIER[1];
    const funded = build([...sowable, slot(WHEAT.produceItemId, fee)]);
    const watch = knob(funded, 'watch');
    expect(watch.affordable).toBe(true);
    expect(watch.legs.reduce((sum, leg) => sum + leg.count, 0)).toBe(fee);
    const short = knob(build([...sowable, slot(WHEAT.produceItemId, fee - 1)]), 'watch');
    expect(short).toMatchObject({
      affordable: false,
      legs: [],
      shortKey: 'hudChrome.farming.denied.no_fee_produce',
    });
    // Raw copies would cover the fee, unlocked ones do not: the locked line.
    const lockedSplit = knob(
      build([...sowable, slot(WHEAT.produceItemId, fee - 1), locked(WHEAT.produceItemId, 1)]),
      'watch',
    );
    expect(lockedSplit.shortKey).toBe('hudChrome.farming.denied.locked');
  });

  it('follows the SELECTED row: a higher-tier pick raises the fee past the same bag', () => {
    const bag = [
      slot(WHEAT.seedItemId, 1),
      slot(RICE.seedItemId, 1),
      slot('bronze_hoe', 1),
      slot(WHEAT.produceItemId, FARM_WATCH_FEE_BY_TIER[1]),
    ];
    const wheatPick = build(bag, { farmingSkill: TIER2_SKILL, selectedCropId: WHEAT.id });
    expect(knob(wheatPick, 'watch').affordable).toBe(true);
    const ricePick = build(bag, { farmingSkill: TIER2_SKILL, selectedCropId: RICE.id });
    expect(knob(ricePick, 'watch').affordable).toBe(false);
  });
});

describe('plant sheet core: the occupancy guard', () => {
  const myPlot: FarmPlotView = {
    bedId: 'bed_eastbrook_1',
    cropId: WHEAT.id,
    plantedAtMs: 0,
    readyAtMs: 1000,
    compost: false,
    watch: false,
    tonic: false,
    notified: false,
    status: 'growing',
  };

  it('canOpenPlantSheet refuses a bed the caller already grows in, and only that bed', () => {
    expect(canOpenPlantSheet('bed_eastbrook_1', [myPlot])).toBe(false);
    expect(canOpenPlantSheet('bed_eastbrook_2', [myPlot])).toBe(true);
  });

  it('never builds a model for an occupied bed', () => {
    expect(
      buildPlantSheetView(
        input([slot(WHEAT.seedItemId, 1), slot('garden_hoe', 1)], { myFarmPlots: [myPlot] }),
      ),
    ).toBeNull();
  });
});

describe('plant sheet core: the two world shapes', () => {
  it('builds the identical model from Sim-shaped and ClientWorld-mirror-shaped bags', () => {
    // Sim rows can carry per-instance payloads and crafting provenance; the
    // mirror carries only the decoded fields. Same items, same model.
    const simShaped = [
      slot(WHEAT.seedItemId, 2, { craftedRecipeId: 'r1', instance: { signer: 'Testchar' } }),
      slot('garden_hoe', 1, { instance: {} }),
      slot(FARM_COMPOST_ITEM_ID, 1, { craftedRecipeId: 'r2' }),
    ] as InvSlot[];
    const clientShaped = [
      slot(WHEAT.seedItemId, 2),
      slot('garden_hoe', 1),
      slot(FARM_COMPOST_ITEM_ID, 1),
    ];
    // Anchor before comparing: two nulls or two empty models would satisfy
    // toEqual vacuously (the review's S7).
    const simModel = buildPlantSheetView(input(simShaped));
    expect(simModel).not.toBeNull();
    expect(simModel?.seedRows.map((row) => row.cropId)).toEqual([WHEAT.id]);
    expect(simModel?.selectedCropId).toBe(WHEAT.id);
    expect(simModel).toEqual(buildPlantSheetView(input(clientShaped)));
  });

  it("pins compost's own shortfall line (denied.no_compost, not a sibling reason)", () => {
    // Bags with a seed and a hoe but NO compost: the compost knob's shortfall
    // must name its own family line (the S6 mutation gap: a swapped reason
    // key survived every other arm).
    const view = buildPlantSheetView(
      input([slot(WHEAT.seedItemId, 1), slot('garden_hoe', 1)] as InvSlot[]),
    );
    const compost = view?.knobs.find((k) => k.id === 'compost');
    expect(compost?.affordable).toBe(false);
    expect(compost?.shortKey).toBe('hudChrome.farming.denied.no_compost');
  });
});
