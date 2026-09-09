import { describe, expect, it, vi } from 'vitest';
import {
  CRUCIBLE_COLLECTION_ITEMS,
  CRUCIBLE_COLLECTION_RECIPES,
} from '../src/sim/content/crucible_collections';
import { STATIONS } from '../src/sim/content/professions';
import { ITEMS } from '../src/sim/data';
import { primaryStatBudget } from '../src/sim/item_budget';
import { isEnchantedInstance } from '../src/sim/professions/enchanting';
import {
  COLLECTION_PERFECTING_SOURCE_INCREASE,
  isValidPerfectingBonus,
  perfectedBonusStats,
  withPerfectingBonus,
} from '../src/sim/professions/perfecting_bonus';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import { runCraft } from './helpers/enchant_family_cast';
import { EMPTY_TEST_WORLD } from './sim_shared';

describe('immutable Perfecting collection contributions', () => {
  it('budgets every collection piece at primary-equivalent 38 without changing its base 35', () => {
    expect(COLLECTION_PERFECTING_SOURCE_INCREASE).toBe(3);
    expect(CRUCIBLE_COLLECTION_RECIPES).toHaveLength(33);
    for (const recipe of CRUCIBLE_COLLECTION_RECIPES) {
      const def = CRUCIBLE_COLLECTION_ITEMS[recipe.resultItemId];
      expect(recipe.level).toBe(29);
      const bonus = perfectedBonusStats(def, recipe)!;
      const delta =
        primaryStatBudget(38, 'epic', def.slot) - primaryStatBudget(35, 'epic', def.slot);
      expect(Object.values(bonus).reduce((sum, n) => sum + n, 0)).toBe(delta);
      expect(delta).toBeGreaterThan(0);
      expect(bonus.armor).toBeUndefined();
    }
    expect(perfectedBonusStats(ITEMS.wyrmfall_pendant, { level: 25 })).toEqual({ int: 1, sta: 0 });
  });

  it('retains the originally minted profile across later balance changes and adds no active stats', () => {
    const recipe = CRUCIBLE_COLLECTION_RECIPES[0];
    const def = CRUCIBLE_COLLECTION_ITEMS[recipe.resultItemId];
    const original = withPerfectingBonus(def, recipe, { signer: 'Artisan' });
    const retuned = withPerfectingBonus({ ...def, stats: { int: 500 } }, { level: 90 }, original);
    expect(retuned).toBe(original);
    expect(original.rolled).toBeUndefined();
    expect(original.perfectingBound).toBeUndefined();
    expect(isEnchantedInstance({ ...original, rolled: { stats: {} } })).toBe(false);
    expect(withPerfectingBonus(ITEMS.wyrmfall_pendant, { level: 25 }, {})).toEqual({});
  });

  it.each([
    null,
    [],
    { armor: 1 },
    { str: -1 },
    { int: 0.5 },
    { sta: Number.POSITIVE_INFINITY },
    { str: 10001 },
    { str: { nested: 1 } },
  ])('refuses malformed saved contribution %j atomically', (value) =>
    expect(isValidPerfectingBonus(value)).toBe(false),
  );

  it.each([0, 0.999])(
    'a real craft stores the profile on both head-start and ordinary outputs (roll %s)',
    (roll) => {
      const sim = new Sim({
        seed: 85,
        playerClass: 'warrior',
        autoEquip: false,
        world: EMPTY_TEST_WORLD,
      });
      const meta = sim.players.get(sim.playerId) as PlayerMeta;
      const recipe = CRUCIBLE_COLLECTION_RECIPES[0];
      meta.craftSkills.armorcrafting = 125;
      meta.archetype.activeArchetype = 'armorcrafting';
      meta.knownRecipes.add(recipe.id);
      sim.player.pos = { ...STATIONS.find((s) => s.type === 'forge')!.pos, y: 0 };
      for (const reagent of recipe.reagents) sim.addItem(reagent.itemId, reagent.count);
      vi.spyOn(sim.rng, 'next').mockReturnValue(roll);
      runCraft(sim, recipe.id);
      expect(meta.lastCraftResult?.ok).toBe(true);
      const output = meta.inventory.find((slot) => slot.itemId === recipe.resultItemId)?.instance;
      expect(output?.perfectingBonus).toEqual(
        perfectedBonusStats(ITEMS[recipe.resultItemId], recipe),
      );
      expect(output?.perfecting).toBe(roll === 0 ? 1 : undefined);
      expect(output?.boundTo).toBeUndefined();
      expect(output?.perfectingBound).toBeUndefined();
    },
  );
});
