import { describe, expect, it } from 'vitest';
import { resolveApplyEnchant } from '../src/sim/professions/enchanting';
import { Sim } from '../src/sim/sim';
import { enchantsForReagent, enchantTargets } from '../src/ui/hud/professions/enchant_apply_view';
import { learnedProfessionName } from '../src/ui/hud/professions/learned_profession_name';
import { EMPTY_TEST_WORLD } from './sim_shared';

const FORMULA = 'formula_lastflame_zeal';
const ENCHANT = 'enchant_weapon_lastflame_zeal';
const WEAPON = 'duskforged_warblade';

function setup(skill = 100) {
  const sim = new Sim({
    seed: 317,
    playerClass: 'warrior',
    autoEquip: false,
    world: EMPTY_TEST_WORLD,
  });
  const pid = sim.playerId;
  const meta = sim.meta(pid);
  if (!meta) throw new Error('test player missing');
  meta.craftSkills.enchanting = skill;
  sim.addItem(FORMULA, 2);
  sim.addItem(WEAPON, 1);
  sim.addItem('lastflame_core', 3);
  sim.addItem('arcane_shard', 2);
  sim.drainEvents();
  return { sim, pid, meta };
}

describe('raid enchant formula acquisition', () => {
  it('learns exactly once through useItem and saves that knowledge', () => {
    const { sim, pid, meta } = setup();
    sim.useItem(FORMULA);
    expect(meta.knownRecipes.has(ENCHANT)).toBe(true);
    expect(sim.countItem(FORMULA)).toBe(1);
    expect(sim.drainEvents()).toContainEqual({
      type: 'trainResult',
      pid,
      ok: true,
      recipeId: ENCHANT,
    });
    sim.useItem(FORMULA);
    expect(sim.countItem(FORMULA)).toBe(1);
    expect(sim.serializeCharacter(pid)?.knownRecipes).toContain(ENCHANT);
  });

  it.each([0, 99])('keeps the formula below skill 100 (%s)', (skill) => {
    const { sim, meta } = setup(skill);
    sim.useItem(FORMULA);
    expect(meta.knownRecipes.has(ENCHANT)).toBe(false);
    expect(sim.countItem(FORMULA)).toBe(2);
  });

  it('refuses an invalid selected copy without teaching or consuming', () => {
    const { sim, meta } = setup();
    sim.useItem(FORMULA, undefined, 999);
    expect(meta.knownRecipes.has(ENCHANT)).toBe(false);
    expect(sim.countItem(FORMULA)).toBe(2);
  });

  it('requires learned knowledge on direct resolution and cast admission', () => {
    const { sim, pid, meta } = setup();
    const before = structuredClone(meta.inventory);
    const ctx = (sim as unknown as { ctx: Parameters<typeof resolveApplyEnchant>[0] }).ctx;
    expect(resolveApplyEnchant(ctx, pid, WEAPON, ENCHANT)).toMatchObject({
      ok: false,
      reason: 'recipe_not_learned',
    });
    sim.applyEnchant(WEAPON, ENCHANT);
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'enchantResult', ok: false, reason: 'recipe_not_learned' }),
    );
    expect(meta.inventory).toEqual(before);
    sim.useItem(FORMULA);
    expect(resolveApplyEnchant(ctx, pid, WEAPON, ENCHANT)).toMatchObject({ ok: true });
    expect(sim.countItem('lastflame_core')).toBe(0);
    expect(meta.inventory.find((slot) => slot.itemId === WEAPON)?.instance?.enchant).toBe(ENCHANT);
  });

  it('lists the formula gate honestly and exposes proc values without fake flat stats', () => {
    const { meta } = setup();
    const viewer = { synced: true, enchantingSkill: 100, knownRecipes: [] as string[] };
    const row = enchantsForReagent(meta.inventory, 'lastflame_core', viewer)[0];
    expect(row).toMatchObject({ enchantId: ENCHANT, known: false, effects: [] });
    expect(enchantTargets(meta.inventory, ENCHANT, [], viewer)).toEqual([]);
    const learned = { ...viewer, knownRecipes: [ENCHANT] };
    expect(enchantsForReagent(meta.inventory, 'lastflame_core', learned)[0].known).toBe(true);
    expect(enchantTargets(meta.inventory, ENCHANT, [], learned)).toHaveLength(1);
  });

  it('localizes learned formula feedback as an enchant name, not a raw id', () => {
    expect(learnedProfessionName(ENCHANT)).toBe("Last Flame's Zeal");
  });
});
