// The enchant formula acquisition gate (raid professions,
// docs/prd/ignivar-raid-professions.md): an EnchantDef carrying a non-empty
// acquisition list must be learned into knownRecipes before applyEnchant
// accepts it, on EVERY arm (the gate lives in resolveApplyEnchant's shared
// prologue, so bagged, worn, and both replace arms inherit it). An enchant
// with no acquisition list is grandfathered, known to everyone: every
// pre-raid enchant ships that way and stays exactly as free as before.
import { afterAll, describe, expect, it } from 'vitest';
import { ENCHANTS, type EnchantDef } from '../src/sim/content/enchants';
import { isEnchantKnown, resolveApplyEnchant } from '../src/sim/professions/enchanting';
import {
  resolveFormulaTeach,
  useRecipeScroll,
  useRecipeScrollForFormula,
} from '../src/sim/professions/recipe_scrolls';
import { Sim } from '../src/sim/sim';

const GATED_ID = 'test_gated_formula';
const GATED: EnchantDef = {
  id: GATED_ID,
  name: 'Test Gated Formula',
  itemSlot: 'mainhand',
  reagents: [],
  statBonus: { str: 1 },
  acquisition: ['drop'],
  skillReq: 100,
};
ENCHANTS[GATED_ID] = GATED;
afterAll(() => {
  delete ENCHANTS[GATED_ID];
});

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function metaOf(sim: Sim) {
  const meta = (sim as any).players.get(sim.playerId);
  if (!meta) throw new Error('player meta missing');
  return meta;
}

describe('enchant formula gate: isEnchantKnown', () => {
  it('grandfathers every enchant without an acquisition list', () => {
    for (const enchant of Object.values(ENCHANTS)) {
      if (enchant.id === GATED_ID) continue;
      expect(isEnchantKnown(undefined, enchant)).toBe(true);
    }
  });

  it('gates a formula with an acquisition list on knownRecipes', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    expect(isEnchantKnown(meta, GATED)).toBe(false);
    meta.knownRecipes.add(GATED_ID);
    expect(isEnchantKnown(meta, GATED)).toBe(true);
    // No meta at all never knows a gated formula.
    expect(isEnchantKnown(undefined, GATED)).toBe(false);
  });
});

describe('enchant formula gate: the apply arms', () => {
  it('denies formula_not_learned on the bagged arm before any other gate', () => {
    const sim = makeSim();
    // Nothing held, no reagents: the knowledge deny still wins, proving the
    // gate sits in the shared prologue ahead of not_held/materials.
    const result = resolveApplyEnchant(sim.ctx, sim.playerId, 'worn_sword', GATED_ID);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('formula_not_learned');
  });

  it('denies formula_not_learned on the worn arm too', () => {
    const sim = makeSim();
    const result = resolveApplyEnchant(sim.ctx, sim.playerId, 'worn_sword', GATED_ID, 'mainhand');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('formula_not_learned');
  });

  it('after learning, the deny moves past knowledge to the ordinary gates', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.knownRecipes.add(GATED_ID);
    const result = resolveApplyEnchant(sim.ctx, sim.playerId, 'worn_sword', GATED_ID);
    expect(result.ok).toBe(false);
    expect(result.reason).not.toBe('formula_not_learned');
  });

  it('a grandfathered enchant never trips the gate', () => {
    const sim = makeSim();
    const free = Object.values(ENCHANTS).find((e) => !e.acquisition);
    if (!free) throw new Error('no grandfathered enchant in content');
    const result = resolveApplyEnchant(sim.ctx, sim.playerId, 'worn_sword', free.id);
    expect(result.reason).not.toBe('formula_not_learned');
  });
});

describe('enchant formula scrolls', () => {
  it('teaches at the enchanting tier floor and refuses below it', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.craftSkills.enchanting = 99;
    expect(resolveFormulaTeach(meta, GATED)).toBe('scroll_tier_unmet');
    meta.craftSkills.enchanting = 100;
    expect(resolveFormulaTeach(meta, GATED)).toBeNull();
  });

  it('success learns the formula into knownRecipes and consumes the scroll', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.craftSkills.enchanting = 100;
    let consumed = 0;
    useRecipeScrollForFormula(sim.ctx, meta, GATED, () => consumed++);
    expect(consumed).toBe(1);
    expect(meta.knownRecipes.has(GATED_ID)).toBe(true);
    const events = sim.tick().filter((ev: any) => ev.type === 'recipeScrollResult');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ ok: true, recipeId: GATED_ID });
    // And the apply gate opens: the deny is no longer knowledge.
    const result = resolveApplyEnchant(sim.ctx, sim.playerId, 'worn_sword', GATED_ID);
    expect(result.reason).not.toBe('formula_not_learned');
  });

  it('useRecipeScroll resolves a formula id through the enchant table', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.craftSkills.enchanting = 100;
    let consumed = 0;
    useRecipeScroll(sim.ctx, meta, GATED_ID, () => consumed++);
    expect(consumed).toBe(1);
    expect(meta.knownRecipes.has(GATED_ID)).toBe(true);
  });

  it('a scroll for a grandfathered enchant reads already known', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.craftSkills.enchanting = 125;
    const free = Object.values(ENCHANTS).find((e) => !e.acquisition);
    if (!free) throw new Error('no grandfathered enchant in content');
    let consumed = 0;
    useRecipeScroll(sim.ctx, meta, free.id, () => consumed++);
    expect(consumed).toBe(0);
    const events = sim.tick().filter((ev: any) => ev.type === 'recipeScrollResult');
    expect(events[0]).toMatchObject({ ok: false, reason: 'scroll_already_known' });
  });
});
