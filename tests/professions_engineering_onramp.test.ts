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
import { ALL_RECIPES, recipeById } from '../src/sim/content/recipes';
import { ITEMS, NPCS } from '../src/sim/data';
import { primaryStatBudget, primaryStatSum } from '../src/sim/item_level';
import { requiredLevelFor } from '../src/sim/item_level_req';
import { craftSkillGainMultiplier } from '../src/sim/professions/archetype';
import { PRE_TRAINING_RECIPE_IDS, teachTierMet } from '../src/sim/professions/training';
import { tierForSkill, tierProgressMultiplier } from '../src/sim/professions/wheel';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';

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
        craftSkillGainMultiplier({ engineering: 0 }, null, null, 'engineering', null, recipe.skillReq),
        `${recipe.id} unattuned gain at skill 0`,
      ).toBe(1);
    }
  });

  it('engineering 0 to 25 is gainable unattuned at every point of the band', () => {
    for (const skill of [0, 10, 24]) {
      const gains = trainerLearnableAt(skill).map((r) =>
        craftSkillGainMultiplier({ engineering: skill }, null, null, 'engineering', null, r.skillReq),
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
      for (const id of expected) {
        expect(
          fullGain.map((r) => r.id),
          `band floor ${floor} full-gain rows`,
        ).toContain(id);
      }
      expect(fullGain.length, `band floor ${floor} is not empty`).toBeGreaterThan(0);
    }
  });

  it('neither new recipe joins the frozen grandfather list', () => {
    expect(PRE_TRAINING_RECIPE_IDS).not.toContain('recipe_cogwheel_blank');
    expect(PRE_TRAINING_RECIPE_IDS).not.toContain('recipe_copperlens_ocular');
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
    expect(def.sellValue).toBeGreaterThan(0);
    expect(def.buyValue, 'never vendor-stocked').toBeUndefined();
    expect(def.noMarketList, 'ordinary tradable (masterwrought R18)').toBeUndefined();
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
    // ilvl 16 on the held 0.75 line.
    expect(primaryStatSum(def)).toBe(primaryStatBudget(16, 'uncommon', 'offhand'));
    expect(primaryStatSum(def)).toBe(5);
    // Uncommon stays ungated (leveling greens are never level-gated).
    expect(requiredLevelFor(def)).toBe(1);
  });

  it('no vendor twin exists for either output (masterwrought R23)', () => {
    // The direct arm: neither id carries buyValue (what puts an item on a
    // vendor row) and no NPC stock lists them.
    expect(ITEMS.copperlens_ocular.buyValue).toBeUndefined();
    expect(ITEMS.cogwheel_blank.buyValue).toBeUndefined();
    const stocked = Object.values(NPCS)
      .flatMap((npc) => npc.vendorItems ?? [])
      .filter((id) => id === 'copperlens_ocular' || id === 'cogwheel_blank');
    expect(stocked).toEqual([]);
    // The census arm: no vendor sells ANY held offhand, so the slot itself
    // has no vendor line to undercut. Positive control keeps the field name
    // live: some shipped item really carries buyValue.
    const vendorOffhands = Object.values(ITEMS).filter(
      (d) => d.kind === 'held_offhand' && d.buyValue !== undefined,
    );
    expect(vendorOffhands).toEqual([]);
    expect(Object.values(ITEMS).some((d) => (d.buyValue ?? 0) > 0)).toBe(true);
  });
});
