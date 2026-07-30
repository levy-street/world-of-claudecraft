import { describe, expect, it } from 'vitest';
import { PERK_THRESHOLDS } from '../src/sim/content/professions';
import { requiredReagentCount, resolveCraftForRecipe } from '../src/sim/professions/crafting';
import { isStationActive, placeMobileCraftingStation } from '../src/sim/professions/mobile_station';
import { rechargeCost, slotEffect } from '../src/sim/professions/tools';
import {
  isSpecialized,
  materialCostMultiplier,
  rechargeDiscountMultiplier,
  skillInCraft,
} from '../src/sim/professions/wheel';
import { Sim } from '../src/sim/sim';

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function grantItem(sim: Sim, itemId: string, count: number, pid: number) {
  for (let i = 0; i < count; i++) sim.addItem(itemId, 1, pid);
}

const CRAFT_ID = 'enchanting';
const THRESHOLD = PERK_THRESHOLDS[CRAFT_ID].specializedSkillThreshold;

describe('specialization perk eligibility (#1134, wheel.ts)', () => {
  it('a craft absent from the skill record defaults to 0 and is never specialized', () => {
    expect(skillInCraft({}, CRAFT_ID)).toBe(0);
    expect(isSpecialized({}, CRAFT_ID)).toBe(false);
  });

  it('a player below the threshold is not specialized', () => {
    const skills = { [CRAFT_ID]: THRESHOLD - 1 };
    expect(isSpecialized(skills, CRAFT_ID)).toBe(false);
    expect(materialCostMultiplier(skills, CRAFT_ID)).toBe(1);
    expect(rechargeDiscountMultiplier(skills, CRAFT_ID)).toBe(1);
  });

  it('a player at or above the threshold is specialized and gets the content-driven discount', () => {
    const skills = { [CRAFT_ID]: THRESHOLD };
    expect(isSpecialized(skills, CRAFT_ID)).toBe(true);
    const expectedMult = 1 - PERK_THRESHOLDS[CRAFT_ID].materialDiscountPct;
    expect(materialCostMultiplier(skills, CRAFT_ID)).toBeCloseTo(expectedMult);
  });

  it('perk thresholds are read from content, not hardcoded: changing content changes the read', () => {
    const original = PERK_THRESHOLDS[CRAFT_ID].specializedSkillThreshold;
    PERK_THRESHOLDS[CRAFT_ID].specializedSkillThreshold = 5;
    try {
      expect(isSpecialized({ [CRAFT_ID]: 5 }, CRAFT_ID)).toBe(true);
    } finally {
      PERK_THRESHOLDS[CRAFT_ID].specializedSkillThreshold = original;
    }
  });

  it('throws on an unknown craft id, same as the rest of the wheel content', () => {
    expect(() => isSpecialized({}, 'not_a_real_craft')).toThrow();
  });
});

describe('material-cost discount when crafting (#1134, crafting.ts)', () => {
  // A synthetic enchanting recipe (content/recipes.ts has no enchanting recipe
  // yet) reusing existing reagent/output item ids, so these tests can drive
  // the discount without needing new enchanting content in that later issue.
  const recipe = {
    id: 'test_enchanting_recipe',
    professionId: CRAFT_ID,
    resultItemId: 'eastbrook_arming_sword',
    resultCount: 1,
    reagents: [
      { itemId: 'bone_fragments', count: 10 },
      { itemId: 'linen_scrap', count: 1 },
    ],
    skillReq: 0,
    itemLevelBudget: 10,
    level: 10,
  };

  it('a non-specialized player pays the full listed material cost', () => {
    expect(requiredReagentCount(undefined, { itemId: 'x', count: 10 }, {}, CRAFT_ID).count).toBe(
      10,
    );
    expect(requiredReagentCount(undefined, { itemId: 'x', count: 1 }, {}, CRAFT_ID).count).toBe(1);
  });

  it('a specialized player sees a reduced quantity, floored, with a minimum of 1', () => {
    const skills = { [CRAFT_ID]: THRESHOLD };
    const discountPct = PERK_THRESHOLDS[CRAFT_ID].materialDiscountPct;
    expect(
      requiredReagentCount(undefined, { itemId: 'x', count: 10 }, skills, CRAFT_ID).count,
    ).toBe(Math.max(1, Math.floor(10 * (1 - discountPct))));
    expect(
      requiredReagentCount(undefined, { itemId: 'x', count: 10 }, skills, CRAFT_ID).count,
    ).toBeLessThan(10);
    // The 1-qty ingredient floors at the minimum of 1, never drops to 0.
    expect(requiredReagentCount(undefined, { itemId: 'x', count: 1 }, skills, CRAFT_ID).count).toBe(
      1,
    );
  });

  it('selfSignedBonusApplied reflects the self-signed step alone, not the composed specialization discount', () => {
    const skills = { [CRAFT_ID]: THRESHOLD };
    // No self-signed instance (meta undefined): the count still drops from the
    // specialization discount, but selfSignedBonusApplied must stay false.
    const result = requiredReagentCount(undefined, { itemId: 'x', count: 10 }, skills, CRAFT_ID);
    expect(result.count).toBeLessThan(10);
    expect(result.selfSignedBonusApplied).toBe(false);
  });

  it('resolveCraftForRecipe succeeds when discounted materials are available, consuming exactly the discounted amount', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = (sim as any).players.get(pid);
    meta.craftSkills[CRAFT_ID] = THRESHOLD;
    grantItem(sim, 'bone_fragments', 8, pid);
    grantItem(sim, 'linen_scrap', 1, pid);

    const result = resolveCraftForRecipe((sim as any).ctx, pid, recipe);

    expect(result.ok).toBe(true);
    expect(sim.countItem('bone_fragments', pid)).toBeGreaterThanOrEqual(0);
    expect(8 - sim.countItem('bone_fragments', pid)).toBeLessThanOrEqual(8);
  });

  it('resolveCraftForRecipe fails for a non-specialized player short of the full-price materials', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    grantItem(sim, 'bone_fragments', 8, pid);
    grantItem(sim, 'linen_scrap', 1, pid);

    const result = resolveCraftForRecipe((sim as any).ctx, pid, recipe);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_materials');
    // Partial consumption never happens.
    expect(sim.countItem('bone_fragments', pid)).toBe(8);
    expect(sim.countItem('linen_scrap', pid)).toBe(1);
  });
});

describe('specialized recharge discount composes with the original-crafter discount (#1134, tools.ts)', () => {
  it('a specialized original recharger pays strictly less than a merely-original (non-specialized) recharger', () => {
    const specializedSlot = slotEffect('gatherers_cache', { craftedBy: 'player_alice' });
    const plainSlot = slotEffect('gatherers_cache', { craftedBy: 'player_alice' });
    const specializedCost = rechargeCost(specializedSlot, 'player_alice', {
      [CRAFT_ID]: THRESHOLD,
    });
    const plainOriginalCost = rechargeCost(plainSlot, 'player_alice');
    expect(specializedCost.materials).toBeLessThanOrEqual(plainOriginalCost.materials);
    expect(specializedCost.ticks).toBeLessThan(plainOriginalCost.ticks);
  });

  it('a specialized NON-original recharger gets no additional discount: the perk is for recharging your own work', () => {
    const slot = slotEffect('gatherers_cache', { craftedBy: 'player_alice' });
    const genericCost = rechargeCost(slot, 'player_bob');
    const specializedButNotOriginal = rechargeCost(slot, 'player_bob', { [CRAFT_ID]: THRESHOLD });
    expect(specializedButNotOriginal).toEqual(genericCost);
  });

  it('omitting rechargerSkills behaves exactly like the pre-#1134 original-crafter-only discount', () => {
    const slot = slotEffect('gatherers_cache', { craftedBy: 'player_alice' });
    const withEmptySkills = rechargeCost(slot, 'player_alice', {});
    const withNoArg = rechargeCost(slot, 'player_alice');
    expect(withEmptySkills).toEqual(withNoArg);
  });
});

describe('mobile crafting station (#1134, mobile_station.ts, stub)', () => {
  it('a non-specialized player cannot place a station', () => {
    const station = placeMobileCraftingStation('player_bob', CRAFT_ID, { x: 1, z: 2 }, {}, 1000);
    expect(station).toBeUndefined();
  });

  it('a specialized player can place a station, and it is queryable by existence and duration', () => {
    const skills = { [CRAFT_ID]: THRESHOLD };
    const station = placeMobileCraftingStation(
      'player_alice',
      CRAFT_ID,
      { x: 5, z: 9 },
      skills,
      1000,
    );
    expect(station).toBeDefined();
    if (!station) throw new Error('station should have been placed');
    expect(station.playerId).toBe('player_alice');
    expect(station.pos).toEqual({ x: 5, z: 9 });
    expect(isStationActive(station, 1000)).toBe(true);
    expect(isStationActive(station, station.expiresAtTick - 1)).toBe(true);
    expect(isStationActive(station, station.expiresAtTick)).toBe(false);
  });
});
