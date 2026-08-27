// The Crucible raid professions content wave, end to end
// (docs/prd/ignivar-raid-professions.md): the authored ids resolve, the
// derived item levels land on the PRD's 37/39, the scroll-taught full loop
// runs scroll -> learn -> craft at the forge, the core stays undiscounted in
// the REAL recipes, and the formula teaches and applies. Content pins keep
// the loot wiring and the hammer chain honest.
import { describe, expect, it } from 'vitest';
import {
  CRUCIBLE_PROFESSION_ITEMS,
  CRUCIBLE_RECIPES,
} from '../src/sim/content/crucible_professions';
import { DUNGEON_MOBS } from '../src/sim/content/dungeons';
import { ENCHANTS } from '../src/sim/content/enchants';
import { recipeById } from '../src/sim/content/recipes';
import { ITEMS, QUESTS, STATIONS } from '../src/sim/data';
import { itemLevel } from '../src/sim/item_level';
import { requiredReagentCount } from '../src/sim/professions/crafting';
import { Sim } from '../src/sim/sim';
import { completeEnchantFamilyCast } from './helpers/enchant_family_cast';

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function metaOf(sim: Sim) {
  const meta = (sim as any).players.get(sim.playerId);
  if (!meta) throw new Error('player meta missing');
  return meta;
}

/** Finish a started craft cast (the professions_crafting.test.ts harness). */
function completeCraftCastNow(sim: Sim, pid = sim.playerId) {
  const p = (sim as any).entities.get(pid);
  const meta = (sim as any).players.get(pid);
  if (!p || !meta) throw new Error('player missing');
  p.castingAbility = null;
  p.castRemaining = 0;
  sim.ctx.completeCraftCast(p, meta);
}

function moveToForge(sim: Sim) {
  const forge = STATIONS.find((s) => s.type === 'forge');
  if (!forge) throw new Error('no forge station');
  const p = (sim as any).entities.get(sim.playerId);
  p.pos.x = forge.pos.x;
  p.pos.z = forge.pos.z;
}

describe('crucible professions content: referential shape', () => {
  it('every authored item id resolves in the merged ITEMS table', () => {
    for (const id of Object.keys(CRUCIBLE_PROFESSION_ITEMS)) {
      expect(ITEMS[id], id).toBeDefined();
    }
  });

  it('every scroll teaches a resolvable id whose acquisition matches its path', () => {
    for (const item of Object.values(CRUCIBLE_PROFESSION_ITEMS)) {
      if (item.use?.type !== 'teachRecipe') continue;
      expect(item.kind, item.id).toBe('recipe');
      expect(item.noVendorSell, item.id).toBe(true);
      const target = item.use.recipeId;
      const recipe = recipeById(target);
      const formula = ENCHANTS[target];
      expect(recipe ?? formula, `${item.id} teaches unknown id ${target}`).toBeDefined();
      // A dropped scroll must be learnable from the 'drop' source, or every
      // use would refuse wrong_source (the authoring bug the leaf guards).
      expect((recipe ?? formula)?.acquisition, target).toContain('drop');
    }
  });

  it('the hammer recipe is quest-taught and the chain is wired', () => {
    const recipe = recipeById('recipe_forgefathers_requiem');
    expect(recipe?.acquisition).toEqual(['quest']);
    expect(recipe?.skillReq).toBe(125);
    const q1 = QUESTS.q_forgefathers_requiem;
    const q2 = QUESTS.q_requiem_at_the_forge;
    expect(q1?.recipeReward).toBe('recipe_forgefathers_requiem');
    expect(q2?.requiresQuest).toBe('q_forgefathers_requiem');
    expect(q2?.objectives[0]).toMatchObject({
      type: 'craft',
      recipeId: 'recipe_forgefathers_requiem',
    });
    // The starter drops off Varkhul only while the chain quest is active.
    const varkhul = DUNGEON_MOBS.varkhul_forgefather_of_the_last_flame;
    expect(
      varkhul.loot.some(
        (row) => row.itemId === 'forgefathers_ember' && row.questId === 'q_forgefathers_requiem',
      ),
    ).toBe(true);
  });

  it('derives the PRD item levels: epics 37, the hammer 39', () => {
    expect(itemLevel(ITEMS.cruciblewrought_warhelm)).toBe(37);
    expect(itemLevel(ITEMS.emberveil_legguards)).toBe(37);
    expect(itemLevel(ITEMS.vestment_of_the_last_spring)).toBe(37);
    expect(itemLevel(ITEMS.forgefathers_requiem)).toBe(39);
  });

  it('both bosses guarantee a core and share the scroll roll group', () => {
    for (const bossId of [
      'ignivar_herald_of_the_last_flame',
      'varkhul_forgefather_of_the_last_flame',
    ]) {
      const loot = DUNGEON_MOBS[bossId].loot;
      expect(
        loot.filter((row) => row.itemId === 'lastflame_core' && row.chance === 1),
        bossId,
      ).toHaveLength(1);
      expect(
        loot.filter((row) => row.rollGroup === 'crucible_scrolls'),
        bossId,
      ).toHaveLength(4);
    }
  });
});

describe('crucible professions: the full loop', () => {
  it('scroll -> learn -> craft the warhelm at the forge', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.craftSkills.armorcrafting = 100;
    sim.addItem('plans_cruciblewrought_warhelm', 1, sim.playerId);
    sim.useItem('plans_cruciblewrought_warhelm', sim.playerId);
    expect(meta.knownRecipes.has('recipe_cruciblewrought_warhelm')).toBe(true);
    expect(sim.countItem('plans_cruciblewrought_warhelm', sim.playerId)).toBe(0);

    sim.addItem('lastflame_core', 6, sim.playerId);
    // The specialized discount applies to the gathered rows, so 5 fine ore
    // and 2 logs cover the discounted requirement; the core is exempt and
    // needs all 6 (the assertions below pin both).
    sim.addItem('fine_thorium_ore', 6, sim.playerId);
    sim.addItem('fine_elderwood_log', 2, sim.playerId);
    moveToForge(sim);
    sim.craftItem('recipe_cruciblewrought_warhelm');
    completeCraftCastNow(sim);
    expect(sim.countItem('cruciblewrought_warhelm', sim.playerId)).toBe(1);
    expect(sim.countItem('lastflame_core', sim.playerId)).toBe(0);
  });

  it('the core rows stay undiscounted in every REAL recipe for a specialist', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    for (const recipe of CRUCIBLE_RECIPES) {
      meta.craftSkills[recipe.professionId] = 125;
      for (const reagent of recipe.reagents) {
        const required = requiredReagentCount(
          meta,
          reagent,
          meta.craftSkills,
          recipe.professionId,
        ).count;
        if (reagent.itemId === 'lastflame_core') {
          expect(required, `${recipe.id} core row`).toBe(reagent.count);
        } else {
          expect(required, `${recipe.id} ${reagent.itemId}`).toBeLessThan(reagent.count);
        }
      }
    }
  });

  it('formula scroll -> learn -> apply the proc enchant on a bagged weapon', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.craftSkills.enchanting = 100;
    sim.addItem('formula_lastflame_zeal', 1, sim.playerId);
    sim.useItem('formula_lastflame_zeal', sim.playerId);
    expect(meta.knownRecipes.has('enchant_weapon_lastflame_zeal')).toBe(true);

    sim.addItem('worn_sword', 1, sim.playerId);
    sim.addItem('lastflame_core', 3, sim.playerId);
    sim.addItem('arcane_shard', 2, sim.playerId);
    sim.applyEnchant('worn_sword', 'enchant_weapon_lastflame_zeal');
    completeEnchantFamilyCast(sim);
    const slot = meta.inventory.find(
      (s: any) =>
        s.itemId === 'worn_sword' && s.instance?.enchant === 'enchant_weapon_lastflame_zeal',
    );
    expect(slot).toBeDefined();
    expect(sim.countItem('lastflame_core', sim.playerId)).toBe(0);
    expect(sim.countItem('arcane_shard', sim.playerId)).toBe(0);
  });
});
