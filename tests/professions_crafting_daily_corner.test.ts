// The daily-gate ladder corner (Masterwrought phase 18, daily-gate-ladder-
// corner): a daily stamp for a recipe the character does NOT know is only
// mintable by a DB-tampered row, because the stamp is written on the resolve's
// success path (which already proved knownness through the shared admission)
// and the load clamp keeps stamps only for live oncePerDay ids. The admission
// ladder must therefore answer for the tampered character exactly as it would
// without the stamp: the deliberate daily-first order is a KNOWN-recipe rule
// (no other gate's remedy changes a stamped KNOWN recipe's outcome), and it
// must never promote a tampered stamp into a daily_limit answer for a recipe
// the character could not craft today anyway.
import { describe, expect, it } from 'vitest';
import { evaluateCraftAdmission } from '../src/sim/professions/crafting';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import { EMPTY_TEST_WORLD } from './sim_shared';

const DAY = '2026-08-31';

function world(seed = 7): { sim: Sim; pid: number; meta: PlayerMeta } {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, world: EMPTY_TEST_WORLD });
  sim.resetDay = DAY;
  const pid = sim.playerId;
  return { sim, pid, meta: sim.players.get(pid) as PlayerMeta };
}

/** A station-free, combo-free oncePerDay recipe behind a learn step, so the
 *  arms under test (daily vs recipe_not_learned) answer alone; the result
 *  item is a real def but no case below ever reaches the material gates. */
const GATED_DAILY: ProfessionRecipeRecord = {
  id: '__daily_corner_probe',
  professionId: 'alchemy',
  resultItemId: 'makers_ember',
  resultCount: 1,
  reagents: [],
  skillReq: 0,
  itemLevelBudget: 1,
  level: 1,
  acquisition: ['trainer'],
  oncePerDay: true,
};

/** The same recipe with an unmet combo requirement: the ladder arm BETWEEN
 *  the daily gate and the knownness gate, so order stays observable. */
const GATED_DAILY_COMBO: ProfessionRecipeRecord = {
  ...GATED_DAILY,
  id: '__daily_corner_combo_probe',
  comboRequirement: { craftA: 'armorcrafting', craftB: 'weaponcrafting', minTier: 1 },
};

function stamp(meta: PlayerMeta, recipeId: string): void {
  meta.craftDaily = { date: DAY, crafted: new Set([recipeId]) };
}

describe('the daily-before-not_learned ladder corner (a DB-tampered stamp)', () => {
  it('a stamp for an UNKNOWN recipe falls through to recipe_not_learned, never daily_limit', () => {
    const { sim, pid, meta } = world(7);
    stamp(meta, GATED_DAILY.id);
    const denial = evaluateCraftAdmission(sim.ctx, pid, GATED_DAILY);
    expect(denial?.reason).toBe('recipe_not_learned');
    // No countdown rides the fall-through: retryAfterSeconds is the daily
    // refusal's field alone.
    expect(denial?.retryAfterSeconds).toBeUndefined();
  });

  it('the tampered character answers exactly like the unstamped one, on every ladder shape', () => {
    // The fall-through rule stated whole: for a character who does not know
    // the recipe, the stamp must change NOTHING about the admission answer,
    // whichever arm of the ladder ends up denying.
    for (const recipe of [GATED_DAILY, GATED_DAILY_COMBO]) {
      const clean = world(8);
      const tampered = world(8);
      stamp(tampered.meta, recipe.id);
      const cleanDenial = evaluateCraftAdmission(clean.sim.ctx, clean.pid, recipe);
      const tamperedDenial = evaluateCraftAdmission(tampered.sim.ctx, tampered.pid, recipe);
      expect(tamperedDenial, recipe.id).toEqual(cleanDenial);
      expect(cleanDenial?.reason, recipe.id).toBeDefined();
    }
  });

  it('the deliberate daily-first order survives for a KNOWN recipe', () => {
    // A learned, stamped recipe reads daily_limit even while a LATER arm
    // (the unmet combo requirement) would also deny: reordering the daily
    // gate behind the combo or knownness arms fails here in the red
    // direction.
    const { sim, pid, meta } = world(9);
    meta.knownRecipes.add(GATED_DAILY_COMBO.id);
    stamp(meta, GATED_DAILY_COMBO.id);
    const denial = evaluateCraftAdmission(sim.ctx, pid, GATED_DAILY_COMBO);
    expect(denial?.reason).toBe('daily_limit');
  });
});
