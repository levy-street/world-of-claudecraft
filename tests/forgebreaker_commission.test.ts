import { describe, expect, it } from 'vitest';
import { ALL_RECIPES, ITEMS } from '../src/sim/data';
import { isCommissionEligible } from '../src/sim/professions/commission';
import { openCommissionOrder } from '../src/sim/professions/commission_order';
import { resolveCraftForRecipe } from '../src/sim/professions/crafting';
import { Sim } from '../src/sim/sim';
import { expectDefined } from './helpers/defined';

const HAMMER = 'varkhul_forgebreaker';
const RECIPE = 'recipe_varkhul_forgebreaker';

describe('the self-crafted Forgebreaker never offers a commission', () => {
  it('excludes the soulbound hammer while preserving ordinary weapon commissions', () => {
    expect(isCommissionEligible(ITEMS[HAMMER])).toBe(false);
    expect(isCommissionEligible(ITEMS.eastbrook_arming_sword)).toBe(true);
    // Existing crafted equipment remains commissionable: the hammer is the
    // only soulbound recipe output affected by the def-level restriction.
    expect(
      ALL_RECIPES.filter((recipe) => ITEMS[recipe.resultItemId]?.soulbound)
        .map((recipe) => recipe.id)
        .sort(),
    ).toEqual([RECIPE]);
  });

  it('rejects the undeliverable order without reserving inventory or spending gold', () => {
    const sim = new Sim({ seed: 4, playerClass: 'warrior', autoEquip: false });
    const before = sim.serializeCharacter(sim.playerId);
    expect(openCommissionOrder(sim.ctx, RECIPE, 'open', undefined, sim.playerId)).toEqual({
      ok: false,
      reason: 'not_commission_eligible',
    });
    expect(sim.ctx.commissionOrderBoard).toEqual([]);
    expect(sim.serializeCharacter(sim.playerId)).toEqual(before);
  });

  it('ignores a requested commission flag when minting the owner-only hammer', () => {
    const sim = new Sim({ seed: 4, playerClass: 'warrior', autoEquip: false });
    const meta = expectDefined(sim.players.get(sim.playerId));
    meta.craftSkills.weaponcrafting = 125;
    meta.copper = 100000;
    meta.knownRecipes.add(RECIPE);
    const forge = expectDefined(
      sim.ctx.stationPlacements.find((station) => station.type === 'forge'),
    );
    sim.player.pos = { x: forge.pos.x, y: sim.player.pos.y, z: forge.pos.z };
    const recipe = expectDefined(ALL_RECIPES.find((candidate) => candidate.id === RECIPE));
    for (const reagent of recipe.reagents) sim.addItem(reagent.itemId, reagent.count);
    const result = resolveCraftForRecipe(sim.ctx, sim.playerId, recipe, true);
    expect(result).toMatchObject({ ok: true });
    const output = expectDefined(meta.inventory.find((slot) => slot.itemId === HAMMER));
    expect(output.instance?.signer).toBe(meta.name);
    expect(output.instance?.bindOnTrade).toBeUndefined();
    expect(ITEMS[output.itemId].soulbound).toBe(true);
    expect(meta.knownRecipes.has(RECIPE)).toBe(false);
  });
});
