// Masterwrought Phase 11o (qr-11o-ENG, farming/state.md row 119): the
// engineering on-ramp acceptance.
//
// The measured fault: engineering had nothing craftable below skillReq 75
// beyond the two mid hoe rungs, its cheapest recipe tier sat above the
// unattuned archetype ceiling of 2, so an unattuned character could never
// gain a single point, and an attuned major climbed 0 to 75 on one
// grandfathered recipe family. The fix: recipe_bronze_hoe re-tiered to
// skillReq 0, plus ENGINEERING_ONRAMP_RECIPES (the skill-0 cogwheel_blank,
// consumed by the precision chassis under masterwrought R18's
// add-never-substitute shape, and the skill-25 copperlens_ocular under
// masterwrought R14 and R23).
//
// The learnable sets below are DERIVED from ALL_RECIPES, so a future re-tier
// that reopens the hole reds these arms by name.
import { describe, expect, it } from 'vitest';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { FURY_STOCK } from '../src/sim/content/pvp_honor';
import { ALL_RECIPES, recipeById } from '../src/sim/content/recipes';
import { ITEMS, NPCS } from '../src/sim/data';
import {
  expectedStatBudget,
  itemLevel,
  primaryStatBudget,
  primaryStatSum,
} from '../src/sim/item_level';
import { requiredLevelFor } from '../src/sim/item_level_req';
import { craftSkillGainMultiplier } from '../src/sim/professions/archetype';
import { materialTierBonusForReagents } from '../src/sim/professions/material_tier';
import {
  PRE_TRAINING_RECIPE_IDS,
  teachTierMet,
  trainingFeeFor,
} from '../src/sim/professions/training';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import { tierForSkill, tierProgressMultiplier } from '../src/sim/professions/wheel';

const ENGINEERING = ALL_RECIPES.filter((r) => r.professionId === 'engineering');

function trainerLearnableAt(skill: number): ProfessionRecipeRecord[] {
  return ENGINEERING.filter(
    (r) => (r.acquisition ?? []).includes('trainer') && teachTierMet(r, { engineering: skill }),
  );
}

describe('engineering on-ramp: the unattuned climb (masterwrought Phase 11o)', () => {
  it('an unattuned character has a learnable full-gain row at skill 0', () => {
    const atZero = trainerLearnableAt(0);
    expect(atZero.map((r) => r.id).sort()).toEqual(['recipe_bronze_hoe', 'recipe_cogwheel_blank']);
    for (const recipe of atZero) {
      // Unattuned: activeArchetype null resolves the rare ceiling (tier 2),
      // and a tier-0 row at capability 0 pays the full multiplier.
      expect(
        craftSkillGainMultiplier(
          { engineering: 0 },
          null,
          null,
          'engineering',
          null,
          recipe.skillReq,
        ),
        `${recipe.id} unattuned gain at skill 0`,
      ).toBe(1);
    }
    // The ceiling premise, both directions, so a regressed unattuned ceiling
    // cannot pass on tier-0 rows alone: a tier-1 and a tier-2 rung sit
    // INSIDE the unattuned rare ceiling and still gain, a tier-3 rung sits
    // above it and pays zero.
    expect(craftSkillGainMultiplier({ engineering: 0 }, null, null, 'engineering', null, 25)).toBe(
      1,
    );
    expect(craftSkillGainMultiplier({ engineering: 0 }, null, null, 'engineering', null, 50)).toBe(
      1,
    );
    expect(craftSkillGainMultiplier({ engineering: 0 }, null, null, 'engineering', null, 75)).toBe(
      0,
    );
  });

  it('engineering 0 to 25 is gainable unattuned through the band and across its boundary', () => {
    // 0 and 24 bracket capability tier 0 (the whole climb to 25); 25 is the
    // first point of the next band, so the gain does not cliff at the goal.
    for (const skill of [0, 24, 25]) {
      const gains = trainerLearnableAt(skill).map((r) =>
        craftSkillGainMultiplier(
          { engineering: skill },
          null,
          null,
          'engineering',
          null,
          r.skillReq,
        ),
      );
      expect(Math.max(0, ...gains), `some row still gains at skill ${skill}`).toBeGreaterThan(0);
    }
  });
});

describe('engineering on-ramp: the attuned climb needs no grandfathered tool craft', () => {
  it('a full-gain trainer row exists at every band below 75, excluding the grandfathered set', () => {
    // The walk the settled row names: learnable rows at 0 and 25, and
    // skysilver_hoe covers 50, so an attuned engineer reaches 75 without ever
    // touching the grandfathered tier-3 tool ladder (PRE_TRAINING ids).
    const EXPECTED_BY_BAND: Record<number, string[]> = {
      0: ['recipe_bronze_hoe', 'recipe_cogwheel_blank'],
      25: ['recipe_copperlens_ocular'],
      50: ['recipe_skysilver_hoe'],
    };
    for (const [floorText, expected] of Object.entries(EXPECTED_BY_BAND)) {
      const floor = Number(floorText);
      const fullGain = trainerLearnableAt(floor).filter(
        (r) =>
          !PRE_TRAINING_RECIPE_IDS.includes(r.id) &&
          tierProgressMultiplier(tierForSkill(floor), tierForSkill(r.skillReq)) === 1,
      );
      // The vacuity floor first, so an emptied band names itself before the
      // per-id misses do.
      expect(fullGain.length, `band floor ${floor} is not empty`).toBeGreaterThan(0);
      for (const id of expected) {
        expect(
          fullGain.map((r) => r.id),
          `band floor ${floor} full-gain rows`,
        ).toContain(id);
      }
    }
  });

  it('neither new recipe joins the frozen grandfather list', () => {
    // Positive control first: the list is live and populated (the three
    // re-tiered land tools really ride it), so the not-contains below cannot
    // pass on an emptied list, which would also gut the fullGain filter above.
    expect(PRE_TRAINING_RECIPE_IDS).toContain('recipe_arcanite_mining_pick');
    expect(PRE_TRAINING_RECIPE_IDS.length).toBeGreaterThanOrEqual(21);
    expect(PRE_TRAINING_RECIPE_IDS).not.toContain('recipe_cogwheel_blank');
    expect(PRE_TRAINING_RECIPE_IDS).not.toContain('recipe_copperlens_ocular');
  });

  it('the on-ramp hoe teaches free (the tier-0 fee, the one derived economy delta)', () => {
    // The 25-to-0 re-tier drops recipe_bronze_hoe's teach fee 2500 to 0 by
    // the shipped fee ladder; pinned for symmetry with the masterwork-delta
    // disclosure (a derived magnitude the phase moves is a pinned magnitude).
    const hoe = recipeById('recipe_bronze_hoe');
    expect(hoe).toBeDefined();
    expect(trainingFeeFor(hoe!)).toBe(0);
  });

  it('teachTierMet really can refuse (in-file control for the empty above-cap sweep)', () => {
    // tests/professions_rod_recipes.test.ts pins the above-cap set EMPTY
    // since the 11o re-tier; this synthetic keeps that sweep's predicate
    // provably able to answer true without depending on a sibling suite.
    const chassis = recipeById('recipe_precision_chassis');
    expect(chassis).toBeDefined();
    expect(teachTierMet({ ...chassis!, skillReq: 150 }, { engineering: 125 })).toBe(false);
  });
});

describe('engineering on-ramp: the part feeds the chassis (masterwrought R18)', () => {
  it('the chassis bill gained the cogwheel row and kept every original row', () => {
    const chassis = recipeById('recipe_precision_chassis');
    expect(chassis).toBeDefined();
    const byId = new Map(chassis!.reagents.map((row) => [row.itemId, row.count]));
    // Add-never-substitute: the pre-11o bill survives intact beside the part.
    expect(byId.get('ashwood_log')).toBe(2);
    expect(byId.get('thorium_ore')).toBe(2);
    expect(byId.get('quickening_catalyst')).toBe(1);
    expect(byId.get('cogwheel_blank')).toBe(1);
  });

  it('the part follows the intermediates materials doctrine', () => {
    const def = ITEMS.cogwheel_blank;
    expect(def.kind).toBe('junk');
    expect(def.quality).toBe('common');
    // The exact 18 is load-bearing: it is the basis the chassis gold
    // arithmetic (308 vs 45) and the ocular bill (44 vs 36) are derived
    // from in the recipes.ts row comments.
    expect(def.sellValue).toBe(18);
    expect(def.buyValue, 'never vendor-stocked').toBeUndefined();
    expect(def.noMarketList, 'ordinary tradable (masterwrought R18)').toBeUndefined();
  });

  it('the added tier-0 row leaves the chassis masterwork material bonus unmoved (measured)', () => {
    // The bonus is MASTERWORK_MATERIAL_TIER_CHANCE times the MAX reagent
    // tier; the Catalyst holds the max at tier 2 (0.02), so the tier-0
    // cogwheel changes nothing. Pinned both as the literal and as the
    // with-versus-without identity, so a later tier assignment to the part
    // in material_tier.ts surfaces here rather than silently moving odds.
    const chassis = recipeById('recipe_precision_chassis');
    expect(chassis).toBeDefined();
    const withPart = materialTierBonusForReagents(chassis!.reagents);
    const withoutPart = materialTierBonusForReagents(
      chassis!.reagents.filter((r) => r.itemId !== 'cogwheel_blank'),
    );
    expect(withPart).toBe(0.02);
    expect(withPart).toBe(withoutPart);
  });
});

describe('engineering on-ramp: the gadget honors masterwrought R14 and R23', () => {
  const RATING_KEYS = [
    'spellPower',
    'critRating',
    'hasteRating',
    'hitRating',
    'pvpOffenseRating',
    'pvpDefenseRating',
  ] as const;

  it('pure stats on the formula budget, no use field, no ratings', () => {
    const def = ITEMS.copperlens_ocular;
    expect(def.kind).toBe('held_offhand');
    expect(def.quality).toBe('uncommon');
    expect(def.use, 'masterwrought R14: no new use or proc mechanics').toBeUndefined();
    for (const key of RATING_KEYS) {
      expect(def[key], `${key} stays off the base rung`).toBeUndefined();
    }
    // Formula-exact at the rung convention: level 15 + uncommon bonus 1 =
    // ilvl 16 on the held 0.75 line. The LIVE item level is pinned too, so a
    // drifted recipe.level cannot leave the hardcoded 16 telling a stale
    // story while the shipped item goes off-budget.
    expect(itemLevel(def)).toBe(16);
    expect(expectedStatBudget(def)).toBe(5);
    expect(primaryStatSum(def)).toBe(primaryStatBudget(16, 'uncommon', 'offhand'));
    expect(primaryStatSum(def)).toBe(5);
    // Uncommon stays ungated (leveling greens are never level-gated); the
    // derived consequence of the quality assertion above, kept as an
    // explicit read of the live gate.
    expect(requiredLevelFor(def)).toBe(1);
  });

  it('no vendor twin exists for either output (masterwrought R23), across all three counters', () => {
    // The direct arm: neither id carries buyValue or priceHonor (the two
    // fields that put an item on a purchase row) and no counter stocks them:
    // NPC vendor lists, the Heroic Quartermaster marks stock, and the
    // WARFARE honor stock.
    for (const id of ['copperlens_ocular', 'cogwheel_blank'] as const) {
      expect(ITEMS[id].buyValue, `${id} buyValue`).toBeUndefined();
      expect(ITEMS[id].priceHonor, `${id} priceHonor`).toBeUndefined();
      expect(
        Object.values(NPCS).flatMap((npc) => npc.vendorItems ?? []),
        `${id} on an NPC counter`,
      ).not.toContain(id);
      expect(
        HEROIC_VENDOR_STOCK.map((offer) => offer.itemId),
        `${id} on the marks counter`,
      ).not.toContain(id);
      expect(FURY_STOCK, `${id} on the honor counter`).not.toContain(id);
    }
    // The census arm: no counter of any kind sells ANY held offhand, so the
    // slot itself has no vendor line to undercut.
    const purchasableOffhands = Object.values(ITEMS).filter(
      (d) => d.kind === 'held_offhand' && (d.buyValue !== undefined || d.priceHonor !== undefined),
    );
    expect(purchasableOffhands).toEqual([]);
    const offhandIds = new Set(
      Object.values(ITEMS)
        .filter((d) => d.kind === 'held_offhand')
        .map((d) => d.id),
    );
    expect(HEROIC_VENDOR_STOCK.filter((o) => offhandIds.has(o.itemId))).toEqual([]);
    expect(FURY_STOCK.filter((id) => offhandIds.has(id))).toEqual([]);
    // Positive controls keep every field and table live: some shipped item
    // really carries buyValue, the honor stock really carries priceHonor
    // rows, and ALL THREE counters are populated (the NPC control matters:
    // without it the not-contains arms above would pass over a world whose
    // vendors quietly stopped stocking anything).
    expect(Object.values(ITEMS).some((d) => (d.buyValue ?? 0) > 0)).toBe(true);
    expect(FURY_STOCK.some((id) => (ITEMS[id]?.priceHonor ?? 0) > 0)).toBe(true);
    expect(HEROIC_VENDOR_STOCK.length).toBeGreaterThan(0);
    expect(Object.values(NPCS).flatMap((npc) => npc.vendorItems ?? []).length).toBeGreaterThan(0);
  });
});
