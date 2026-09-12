// The wield gate's two farming-report fixes (the "Farming Tools not working
// correctly" report), pinned at the pure leaf (src/sim/professions/wield_gate.ts):
//
// 1. DEGRADE, NOT DROP. An owned land tool whose tier the holder cannot yet
//    wield is no longer filtered out of the bag scan; it works as the best
//    tier the holder CAN wield. The report's brick: every hoe upgrade recipe
//    consumes the previous hoe, so a farmer who crafted the tier-2 hoe under
//    its requirement was left with NO usable hoe and could not plant even the
//    tier-1 crops they had been planting. A tool never loses function by
//    being upgraded now.
// 2. FARMING'S OWN LADDER. The land wield table (40/70/85/100) was written
//    against the node ladders; farming's crops open on the 25-point band
//    (content/farm_crops.ts farmCropSkillThreshold: 0/25/50/75), so a tier-2
//    seed said "25" while its hoe said "40". Farming's hoe requirements now
//    ARE the crop thresholds, so the two numbers can never disagree.

import { describe, expect, it } from 'vitest';
import { farmCropSkillThreshold } from '../src/sim/content/farm_crops';
import { ITEMS } from '../src/sim/data';
import { NO_TOOL_OWNED } from '../src/sim/professions/tools';
import {
  bestWieldableAnyGatherToolTier,
  bestWieldableGatherToolTierOrNone,
  canWieldGatherTool,
  effectiveWieldableTier,
  FARMING_WIELD_REQUIREMENT_BY_TIER,
  minWieldRequirementToWork,
  minWieldRequirementToWorkAny,
  TIER2_TOOL_WIELD_PROFICIENCY,
  TIER3_TOOL_WIELD_PROFICIENCY,
  wieldRequirementFor,
  wieldRequirementForTier,
} from '../src/sim/professions/wield_gate';
import type { InvSlot } from '../src/sim/types';

function inv(...ids: string[]): InvSlot[] {
  return ids.map((itemId) => ({ itemId, count: 1 }));
}

describe('farming reads its own wield ladder, derived from the crop bands', () => {
  it('the hoe requirement for each tier IS the crop threshold of that tier', () => {
    // Tier 5 is the apex hoe: it asks for the mastered counter like every
    // other tier-5 land tool, since no tier-5 crop exists to derive from.
    expect(FARMING_WIELD_REQUIREMENT_BY_TIER).toEqual({ 1: 0, 2: 25, 3: 50, 4: 75, 5: 100 });
    for (const tier of [1, 2, 3, 4]) {
      expect(wieldRequirementFor('farming', tier)).toBe(farmCropSkillThreshold(tier));
    }
    expect(wieldRequirementFor('farming', 5)).toBe(100);
    // Literals, not just the derivation: a band retune that moved the seeds
    // must show up here as a deliberate re-pin.
    expect([1, 2, 3, 4, 5].map((t) => wieldRequirementFor('farming', t))).toEqual([
      0, 25, 50, 75, 100,
    ]);
  });

  it('the land professions keep the shared node ladder, fishing stays exempt', () => {
    for (const professionId of ['mining', 'logging', 'herbalism'] as const) {
      for (const tier of [1, 2, 3, 4, 5]) {
        expect(wieldRequirementFor(professionId, tier)).toBe(wieldRequirementForTier(tier));
      }
    }
    expect([1, 2, 3, 4, 5].map((t) => wieldRequirementFor('fishing', t))).toEqual([0, 0, 0, 0, 0]);
  });

  it('the frozen farming table cannot be mutated at runtime', () => {
    expect(Object.isFrozen(FARMING_WIELD_REQUIREMENT_BY_TIER)).toBe(true);
  });

  it('canWieldGatherTool gates the hoe on the farming ladder, not the node ladder', () => {
    expect(canWieldGatherTool('farming', 2, 24)).toBe(false);
    expect(canWieldGatherTool('farming', 2, 25)).toBe(true);
    // The same tier on mining still asks 40.
    expect(canWieldGatherTool('mining', 2, 25)).toBe(false);
    expect(canWieldGatherTool('mining', 2, TIER2_TOOL_WIELD_PROFICIENCY)).toBe(true);
    // Malformed proficiency LOCKS (the resolveVendorRowGate contract), but a
    // tier-1 tool wields at 0 anyway.
    expect(canWieldGatherTool('farming', 2, Number.NaN)).toBe(false);
    expect(canWieldGatherTool('farming', 1, undefined)).toBe(true);
  });
});

describe('an unwieldable land tool degrades to the best wieldable tier (never drops out)', () => {
  it('effectiveWieldableTier walks the ladder down from the tool tier', () => {
    // A tier-3 pick: tier 1 at mining 0, tier 2 from 40, its full tier from 70.
    expect(effectiveWieldableTier('mining', 3, 0)).toBe(1);
    expect(effectiveWieldableTier('mining', 3, TIER2_TOOL_WIELD_PROFICIENCY)).toBe(2);
    expect(effectiveWieldableTier('mining', 3, TIER3_TOOL_WIELD_PROFICIENCY - 1)).toBe(2);
    expect(effectiveWieldableTier('mining', 3, TIER3_TOOL_WIELD_PROFICIENCY)).toBe(3);
    // A rod never degrades (the R22 exemption).
    expect(effectiveWieldableTier('fishing', 3, 0)).toBe(3);
    // Tier 1 is the floor: a tool can never read below the entry rung.
    expect(effectiveWieldableTier('farming', 4, 0)).toBe(1);
    expect(effectiveWieldableTier('farming', 4, 25)).toBe(2);
    expect(effectiveWieldableTier('farming', 4, 74)).toBe(3);
    expect(effectiveWieldableTier('farming', 4, 75)).toBe(4);
  });

  it('the report: a tier-2 hoe alone at farming 0 still plants tier-1 crops (works as tier 1)', () => {
    // Before the fix this read NO_TOOL_OWNED: the farmer who crafted the
    // bronze hoe (which ate their garden hoe) could plant nothing at all.
    expect(bestWieldableGatherToolTierOrNone(inv('bronze_hoe'), 'farming', 0, ITEMS)).toBe(1);
    expect(bestWieldableGatherToolTierOrNone(inv('bronze_hoe'), 'farming', 24, ITEMS)).toBe(1);
    // At the crop threshold the hoe wields in full: tier-2 seeds and tier-2
    // hoe open on the SAME number.
    expect(bestWieldableGatherToolTierOrNone(inv('bronze_hoe'), 'farming', 25, ITEMS)).toBe(2);
    // The apex hoe at zero proficiency is a tier-1 hoe, not a brick.
    expect(bestWieldableGatherToolTierOrNone(inv('evergarden_hoe'), 'farming', 0, ITEMS)).toBe(1);
  });

  it('the same rule on the node ladders: a tier-2 pick at mining 0 is a tier-1 pick', () => {
    expect(bestWieldableGatherToolTierOrNone(inv('iron_mining_pick'), 'mining', 0, ITEMS)).toBe(1);
    expect(
      bestWieldableGatherToolTierOrNone(
        inv('iron_mining_pick'),
        'mining',
        TIER2_TOOL_WIELD_PROFICIENCY,
        ITEMS,
      ),
    ).toBe(2);
    // A wieldable lower tool beside an unwieldable higher one: the best
    // EFFECTIVE tier wins, which is the same tier 1 either way.
    expect(
      bestWieldableGatherToolTierOrNone(
        inv('copper_mining_pick', 'mithril_mining_pick'),
        'mining',
        0,
        ITEMS,
      ),
    ).toBe(1);
    // No tool of the profession at all is still NO_TOOL_OWNED: degrade needs
    // a tool to degrade, so node gathering keeps requiring a real implement.
    expect(bestWieldableGatherToolTierOrNone(inv('bronze_hoe'), 'mining', 100, ITEMS)).toBe(
      NO_TOOL_OWNED,
    );
    expect(bestWieldableGatherToolTierOrNone(inv(), 'mining', 100, ITEMS)).toBe(NO_TOOL_OWNED);
  });

  it('the any-profession corpse scan sees the degraded tier, floored at bare hands', () => {
    // An unwieldable tier-3 pick reads as tier 1, which is the bare-hands
    // floor anyway; at mining 40 it reads 2, at 70 its full 3.
    expect(bestWieldableAnyGatherToolTier(inv('mithril_mining_pick'), {}, ITEMS)).toBe(1);
    expect(
      bestWieldableAnyGatherToolTier(
        inv('mithril_mining_pick'),
        { mining: TIER2_TOOL_WIELD_PROFICIENCY },
        ITEMS,
      ),
    ).toBe(2);
    expect(
      bestWieldableAnyGatherToolTier(
        inv('mithril_mining_pick'),
        { mining: TIER3_TOOL_WIELD_PROFICIENCY },
        ITEMS,
      ),
    ).toBe(3);
  });

  it('a denial names the requirement of the TARGET tier, which is now what unlocks it', () => {
    // Owning only the tier-3 pick and wanting tier-2 ground: 40 is what opens
    // it (the pick works as tier 2 from 40), not the pick's own 70.
    expect(minWieldRequirementToWork(inv('mithril_mining_pick'), 'mining', 2, ITEMS)).toBe(
      TIER2_TOOL_WIELD_PROFICIENCY,
    );
    expect(minWieldRequirementToWork(inv('mithril_mining_pick'), 'mining', 3, ITEMS)).toBe(
      TIER3_TOOL_WIELD_PROFICIENCY,
    );
    // Farming names the crop-band number.
    expect(minWieldRequirementToWork(inv('bronze_hoe'), 'farming', 2, ITEMS)).toBe(25);
    // Nothing covering the target: null, the plain no-tool arm's signal.
    expect(minWieldRequirementToWork(inv('copper_mining_pick'), 'mining', 2, ITEMS)).toBe(null);
    expect(minWieldRequirementToWorkAny(inv('mithril_mining_pick'), 2, ITEMS)).toBe(
      TIER2_TOOL_WIELD_PROFICIENCY,
    );
  });
});
