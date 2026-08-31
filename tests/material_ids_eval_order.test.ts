// Module-evaluation-order probes around the material registry. The canonical
// gathering and salvage tables now live in pure leaves, which cuts the former
// bags -> material_ids -> command module -> bags cycle and lets material_ids
// derive one eager registry. Entering through every former cycle member still
// protects the boundary: any future runtime edge back into a command module
// would make at least one fresh-module arm fail or answer from partial content.
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Type-only, so it is erased at emit and cannot put src/sim/sim.ts (or
// anything it reaches) into the runtime graph ahead of an arm's entry module.
// The value imports in this file are ALL dynamic, inside the arms, on purpose.
import type { PlayerMeta } from '../src/sim/sim';

describe('material_ids evaluation-order probe (pure table leaves keep the registry eager)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('evaluates cleanly with bags.ts as the entry module', async () => {
    const mod = await import('../src/sim/bags');
    expect(mod.BACKPACK_SLOTS).toBe(16);
  });

  it('evaluates cleanly with material_ids.ts as the entry module, and the set answers', async () => {
    const mod = await import('../src/sim/material_ids');
    const ids = mod.materialItemIds();
    expect(ids).toBe(mod.MATERIAL_ITEM_IDS);
    expect(ids.size).toBeGreaterThan(0);
    expect(ids.has('copper_ore')).toBe(true);
  });

  it('evaluates cleanly with data.ts as the entry module, and the eager derive is complete', async () => {
    // The data-first order: material_ids.ts reads ITEMS and ALL_RECIPES from
    // src/sim/data.ts at module evaluation, so entering the graph through the
    // merged data module itself is the order most likely to hand the eager
    // derive a half-evaluated table. (The finding named content/data.ts; the
    // merged module material_ids actually imports is src/sim/data.ts.)
    const data = await import('../src/sim/data');
    expect(Object.keys(data.ITEMS).length).toBeGreaterThan(0);
    expect(data.ALL_RECIPES.length).toBeGreaterThan(0);
    const ids = await import('../src/sim/material_ids');
    const set = ids.materialItemIds();
    expect(set.size).toBeGreaterThan(0);
    expect(set.has('copper_ore')).toBe(true);
    // COMPLETE under this entry order, not merely crash-free or non-empty: a
    // derive over a half-evaluated table would produce a smaller set without
    // throwing, so re-derive from the now-fully-evaluated live tables and
    // require exact agreement.
    const derivation = await import('../src/sim/material_derivation');
    const professions = await import('../src/sim/content/professions');
    const crucible = await import('../src/sim/content/crucible_professions');
    const enchants = await import('../src/sim/content/enchants');
    const gathering = await import('../src/sim/professions/gathering_materials');
    const grades = await import('../src/sim/professions/material_grades');
    const salvage = await import('../src/sim/professions/salvage_materials');
    const rederived = derivation.deriveMaterialItemIds({
      nodeMaterialTable: gathering.NODE_MATERIAL_TABLE,
      materialGrades: grades.MATERIAL_GRADES,
      harvestComponentItems: professions.HARVEST_COMPONENT_ITEMS,
      harvestComponentSpecimens: professions.HARVEST_COMPONENT_SPECIMENS,
      salvageMaterialByQuality: salvage.SALVAGE_MATERIAL_BY_QUALITY,
      recipes: data.ALL_RECIPES,
      enchants: enchants.ENCHANTS,
      recipePendingMaterialItemIds: crucible.CRUCIBLE_RECIPE_PENDING_MATERIAL_ITEM_IDS,
      items: data.ITEMS,
    });
    expect([...set].sort()).toEqual([...rederived].sort());
  });

  it('evaluates cleanly with content/enchants.ts as the entry module', async () => {
    const mod = await import('../src/sim/content/enchants');
    expect(Object.keys(mod.ENCHANTS).length).toBeGreaterThan(0);
    const ids = await import('../src/sim/material_ids');
    expect(ids.materialItemIds().size).toBeGreaterThan(0);
    expect(ids.isMaterialItemId('copper_ore')).toBe(true);
  });

  it('evaluates cleanly with content/professions.ts as the entry module', async () => {
    const mod = await import('../src/sim/content/professions');
    expect(Object.keys(mod.HARVEST_COMPONENT_ITEMS).length).toBeGreaterThan(0);
    const ids = await import('../src/sim/material_ids');
    expect(ids.materialItemIds().size).toBeGreaterThan(0);
    expect(ids.isMaterialItemId('copper_ore')).toBe(true);
  });

  it('evaluates cleanly with the recipe-pending material table as the entry module', async () => {
    const mod = await import('../src/sim/content/crucible_professions');
    expect(mod.CRUCIBLE_RECIPE_PENDING_MATERIAL_ITEM_IDS).toContain('lastflame_core');
    const ids = await import('../src/sim/material_ids');
    expect(ids.isMaterialItemId('lastflame_core')).toBe(true);
  });

  it('evaluates cleanly with professions/gathering.ts as the entry module', async () => {
    const mod = await import('../src/sim/professions/gathering');
    expect(Object.keys(mod.NODE_MATERIAL_TABLE).length).toBeGreaterThan(0);
    // The derive must also be CORRECT under this entry order, not merely
    // crash-free: an eager derive that read a half-evaluated table would
    // produce a wrong set without throwing.
    const ids = await import('../src/sim/material_ids');
    expect(ids.isMaterialItemId('copper_ore')).toBe(true);
  });

  it('evaluates cleanly with professions/salvage.ts as the entry module', async () => {
    const mod = await import('../src/sim/professions/salvage');
    expect(Object.keys(mod.SALVAGE_MATERIAL_BY_QUALITY).length).toBeGreaterThan(0);
    const ids = await import('../src/sim/material_ids');
    expect(ids.isMaterialItemId('copper_ore')).toBe(true);
  });

  it('evaluates cleanly with items.ts as the entry module, and the taxonomy answers', async () => {
    const mod = await import('../src/sim/items');
    const { ITEMS } = await import('../src/sim/data');
    // junkSellableSlot is the entry module's OWN pure export: calling it
    // proves items.ts finished evaluating, not merely that importing it threw
    // nothing. tangled_weed is poor-quality junk (sellable), copper_ore is
    // common (never a gray bulk sell).
    expect(mod.junkSellableSlot(ITEMS.tangled_weed, { count: 1 })).toBe(true);
    expect(mod.junkSellableSlot(ITEMS.copper_ore, { count: 1 })).toBe(false);
    const ids = await import('../src/sim/material_ids');
    expect(ids.isMaterialItemId('copper_ore')).toBe(true);
  });

  it('evaluates cleanly with vendor_buy_stack.ts as the entry module, and its fit cap reaches the registry', async () => {
    const mod = await import('../src/sim/vendor_buy_stack');
    const { ITEMS } = await import('../src/sim/data');
    // maxBuyCount routes through bags.countFit -> bag_pools.freePoolSlots ->
    // material_ids.isMaterialItemId, so this is the registry read, taken
    // from the entry module's own export rather than a bystander import. With
    // only a materials-pool slot free, copper_ore fills it (20 to a stack, one
    // unit per purchase) and the non-material loaf cannot take it at all.
    const pools = { general: 0, materials: 1 };
    expect(mod.maxBuyCount([], pools, ITEMS.copper_ore)).toBe(20);
    expect(mod.maxBuyCount([], pools, ITEMS.baked_bread)).toBe(0);
    const ids = await import('../src/sim/material_ids');
    expect(ids.isMaterialItemId('copper_ore')).toBe(true);
  });

  it('evaluates cleanly with professions/battlefield_xp.ts as the entry module', async () => {
    const mod = await import('../src/sim/professions/battlefield_xp');
    const { emptyCraftSkills } = await import('../src/sim/professions/wheel');
    const skills = emptyCraftSkills();
    // A REAL grant, not a short-circuit zero: the trickle only lands once this
    // module's ITEMS lookup, its recipe attribution, and gathering.ts's rarity
    // gate all resolve, and every one of those is a member-or-neighbor read
    // taken under a battlefield_xp-first entry order.
    const amount = mod.battlefieldExperienceTrickle(skills, {
      itemId: 'minor_healing_potion', // recipe_minor_healing_potion -> alchemy
      instance: { signer: 'Aria', rolled: { quality: 'rare' } },
      observerName: 'Aria',
      observerActiveArchetype: 'alchemy',
    });
    expect(mod.BATTLEFIELD_XP_TRICKLE).toBe(0.25);
    expect(amount).toBe(mod.BATTLEFIELD_XP_TRICKLE);
    expect(skills.alchemy).toBe(mod.BATTLEFIELD_XP_TRICKLE);
    const ids = await import('../src/sim/material_ids');
    expect(ids.isMaterialItemId('copper_ore')).toBe(true);
  });

  it('evaluates cleanly with sim.ts as the entry module, the order production uses', async () => {
    const mod = await import('../src/sim/sim');
    const sim = new mod.Sim({ seed: 1, playerClass: 'warrior' });
    expect(sim.canAddItem('copper_ore', 1)).toBe(true);
  });

  it('evaluates cleanly with bag_pools.ts as the entry module, and its ITEMS read answers', async () => {
    const mod = await import('../src/sim/bag_pools');
    expect(mod.generalOnlyPools(4)).toEqual({ general: 4, materials: 0 });
    // generalOnlyPools is pure arithmetic and never touches ITEMS, so it alone
    // would not exercise this module's `import { ITEMS } from './data'` under a
    // bag_pools-first entry order. poolCapacityOf does: linen_pouch is a
    // 6-slot UNRESTRICTED bag (src/sim/content/items.ts, bagSlots 6, no
    // materialsOnly), so its slots feed the general pool and the materials
    // pool stays empty. A half-evaluated ITEMS would resolve the def to
    // undefined and report general 0 here.
    expect(mod.poolCapacityOf(0, ['linen_pouch'])).toEqual({ general: 6, materials: 0 });
  });

  it('evaluates cleanly with materials_vault.ts as the entry module, and the vault set matches', async () => {
    const vault = await import('../src/sim/materials_vault');
    const ids = await import('../src/sim/material_ids');
    expect([...vault.vaultMaterialIds()].sort()).toEqual([...ids.materialItemIds()].sort());
  });

  it('a bags-first load reaches the eager material set correctly', async () => {
    // Enter through bags.ts, then ask the fit gate a question whose answer
    // needs the eagerly derived canonical set.
    const bags = await import('../src/sim/bags');
    const pools = { general: 0, materials: 1 };
    expect(bags.countFit([], pools, 'copper_ore', 1)).toBe(1); // a material may take the pool
    expect(bags.countFit([], pools, 'baked_bread', 1)).toBe(0); // a non-material may not
  });
});

// The SAME Tarjan over the RUNTIME imports of src/sim finds a SECOND strongly
// connected component in this packet's territory, five modules wide, and it is
// disjoint from the bags component above: edges run FROM this ring INTO the
// bags ring (bank/materials_vault/crafting all import bags.ts) and never back,
// which is what keeps them two components rather than one twelve-module blob.
// Every member here has exactly ONE internal out-edge, so it is a plain ring:
//
//   bank.ts -> item_instance_load.ts (sanitizeItemInstancePayloadOnLoad,
//     boundCraftedRecipeIdOnLoad, warnDroppedInstanceKeys)
//   item_instance_load.ts -> professions/training.ts (MAX_KNOWN_RECIPE_ID_LENGTH)
//   professions/training.ts -> professions/crafting.ts (isRecipeKnown)
//   professions/crafting.ts -> materials_vault.ts (craftVaultStockFor,
//     consumeVaultStock, drawableCounterFor, emitVaultCraftConsume)
//   materials_vault.ts -> bank.ts (nearBanker)
//
// This ring is PRE-EXISTING, not phase 05's doing: phase 03 added
// materials_vault.ts with its nearBanker read of bank.ts, and phase 04 wired
// crafting.ts to the vault, which is the edge that closed it. Phase 05 (the
// two-pool bag mechanic) only touched modules that were already in it. It is
// probed HERE because two of the five members are this packet's own modules,
// so the packet owns the hazard whether or not it created it, and because only
// materials_vault.ts had an entry arm before this block.
//
// The ring already carries one module-EVALUATION-TIME cross-cycle read:
// professions/crafting.ts aliases materials_vault.ts's drawableCounterFor at
// top level (`const vaultCounterFor = drawableCounterFor`). That is safe today
// only because drawableCounterFor is a hoisted function DECLARATION, so it is
// initialized before any module body in the graph runs. Rewritten as an arrow
// `const` it would sit in TDZ under exactly one entry order, materials_vault
// first, where the depth-first evaluation runs crafting.ts's body BEFORE
// materials_vault.ts's, and no ordinary suite enters there. Same shape as the
// bags ring, same remedy: enter at every member in turn.

// A missing content record would otherwise silently weaken an arm below into
// a check against undefined, so the lookups throw instead. Dev-channel English
// (a test-only throw nothing renders), and it keeps the arms free of non-null
// assertions.
function requireContent<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`content record missing: ${what}`);
  return value;
}

describe('bank/vault evaluation-order probe (the pre-existing craft-load ring stays lazy)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('evaluates cleanly with bank.ts as the entry module, and its load bound crosses the ring', async () => {
    const mod = await import('../src/sim/bank');
    // bankCapacity is the entry module's OWN export, so an answer from it
    // proves bank.ts finished evaluating: 24 base slots, plus one 6-slot
    // copper expansion, plus 2 server-stamped bonus slots.
    expect(mod.BANK_BASE_SLOTS).toBe(24);
    expect(
      mod.bankCapacity({
        inventory: [],
        purchasedSlots: 6,
        bonusSlots: 2,
        unlockedSockets: 0,
        socketBags: [null, null, null, null],
        appliedStorageKeys: [],
      }),
    ).toBe(32);
    // sanitizeBankState is the cross-ring read, and it crosses TWO edges in
    // one call: bank.ts -> item_instance_load.ts (boundCraftedRecipeIdOnLoad)
    // -> professions/training.ts (MAX_KNOWN_RECIPE_ID_LENGTH, the ceiling the
    // marker is judged against). A marker of exactly the ceiling survives, one
    // character longer drops, and only that row's drop is reported. Passing a
    // sink keeps the dev-channel warn quiet.
    const { MAX_KNOWN_RECIPE_ID_LENGTH } = await import('../src/sim/professions/training');
    const drops: string[] = [];
    const state = mod.sanitizeBankState(
      {
        inventory: [
          {
            itemId: 'copper_ore',
            count: 1,
            craftedRecipeId: 'r'.repeat(MAX_KNOWN_RECIPE_ID_LENGTH),
          },
          {
            itemId: 'iron_ore',
            count: 1,
            craftedRecipeId: 'r'.repeat(MAX_KNOWN_RECIPE_ID_LENGTH + 1),
          },
        ],
        purchasedSlots: 0,
        bonusSlots: 0,
      },
      undefined,
      drops,
    );
    expect(state.inventory[0].craftedRecipeId).toBe('r'.repeat(MAX_KNOWN_RECIPE_ID_LENGTH));
    expect(state.inventory[1].craftedRecipeId).toBeUndefined();
    expect(drops).toEqual(['bank.iron_ore.craftedRecipeId']);
    // The phase 06 edge: bank.ts -> material_ids.ts (isMaterialItemId, the
    // occupancy predicate bankInfoFor binds). The bystander read proves the
    // predicate is CORRECT under this entry order, not merely crash-free,
    // the same rule every other arm in this file follows.
    const ids = await import('../src/sim/material_ids');
    expect(ids.isMaterialItemId('copper_ore')).toBe(true);
    expect(ids.isMaterialItemId('baked_bread')).toBe(false);
  });

  it('evaluates cleanly with item_instance_load.ts as the entry module, and its ceiling arrives from across the ring', async () => {
    const mod = await import('../src/sim/item_instance_load');
    // The entry module's own sanitizer answering proves it finished
    // evaluating: an over-ceiling string drops ALONE and the legal signer,
    // which answers to the name shape rather than the string ceiling, stays.
    const { payload, dropped } = mod.sanitizeItemInstancePayloadOnLoad({
      signer: 'Aria',
      enchantId: 'x'.repeat(mod.MAX_INSTANCE_STRING_LENGTH + 1),
    });
    expect(payload).toEqual({ signer: 'Aria' });
    expect(dropped).toEqual(['enchantId']);
    // The cross-ring read: boundCraftedRecipeIdOnLoad judges the slot-level
    // marker against professions/training.ts's MAX_KNOWN_RECIPE_ID_LENGTH, so
    // this pair answers only when the next member up the ring evaluated too.
    // The ceiling is pinned to its literal because the two payloads below are
    // built FROM it: without the pin, a silent widening would move the inputs
    // and the arms in lockstep and never go red.
    const { MAX_KNOWN_RECIPE_ID_LENGTH } = await import('../src/sim/professions/training');
    expect(MAX_KNOWN_RECIPE_ID_LENGTH).toBe(64);
    const drops: string[] = [];
    const atCeiling: { itemId: string; craftedRecipeId?: unknown } = {
      itemId: 'copper_ore',
      craftedRecipeId: 'r'.repeat(MAX_KNOWN_RECIPE_ID_LENGTH),
    };
    const overCeiling: { itemId: string; craftedRecipeId?: unknown } = {
      itemId: 'iron_ore',
      craftedRecipeId: 'r'.repeat(MAX_KNOWN_RECIPE_ID_LENGTH + 1),
    };
    mod.boundCraftedRecipeIdOnLoad(atCeiling, drops, 'bags');
    mod.boundCraftedRecipeIdOnLoad(overCeiling, drops, 'bags');
    expect(atCeiling.craftedRecipeId).toBe('r'.repeat(MAX_KNOWN_RECIPE_ID_LENGTH));
    expect(overCeiling.craftedRecipeId).toBeUndefined();
    expect(drops).toEqual(['bags.iron_ore.craftedRecipeId']);
  });

  it('evaluates cleanly with professions/training.ts as the entry module, and its known-check crosses the ring', async () => {
    const mod = await import('../src/sim/professions/training');
    const { recipeById } = await import('../src/sim/content/recipes');
    const combo = requireContent(
      recipeById('recipe_volatile_flux_elixir'),
      'recipe_volatile_flux_elixir',
    );
    // The entry module's OWN fee curve, derived from real content: the
    // alchemy combo's skillReq 25 is recipe tier 1 (wheel.ts TIER_SKILL_STEP
    // 25), and TRAINING_FEE_BY_TIER prices tier 1 at 25 silver.
    expect(combo.skillReq).toBe(25);
    expect(mod.trainingFeeFor(combo)).toBe(2500);
    // The cross-ring read: resolveTrain's second deny arm IS
    // professions/crafting.ts's isRecipeKnown. Same recipe, same spot, no
    // stations in either call, so the known set is the ONLY difference between
    // the two: the reasons discriminate that cross-ring call rather than
    // merely reaching it. A stubbed-out isRecipeKnown fails one arm or the
    // other whichever constant it returned.
    const meta = { knownRecipes: new Set<string>(), craftSkills: {}, copper: 0 };
    const notYet = mod.resolveTrain([], meta as unknown as PlayerMeta, { x: 0, z: 0 }, combo.id);
    expect(notYet.reason).toBe('train_out_of_range');
    meta.knownRecipes.add(combo.id);
    const known = mod.resolveTrain([], meta as unknown as PlayerMeta, { x: 0, z: 0 }, combo.id);
    expect(known.reason).toBe('train_already_known');
    expect(known.fee).toBe(2500);
  });

  it('evaluates cleanly with professions/crafting.ts as the entry module, and the vault adapter it aliases answers', async () => {
    const mod = await import('../src/sim/professions/crafting');
    const { recipeById } = await import('../src/sim/content/recipes');
    // isRecipeKnown is the entry module's own pure export, and the pair is
    // decisive: a recipe with no acquisition list is known to everyone, a
    // trainer-taught one to nobody who has not learned it. Answering at all
    // proves crafting.ts's body ran to completion, which is where its
    // evaluation-time `vaultCounterFor = drawableCounterFor` alias is read, so
    // this arm is also the tripwire for that read going TDZ.
    const jerky = requireContent(recipeById('recipe_tough_jerky'), 'recipe_tough_jerky');
    const combo = requireContent(
      recipeById('recipe_volatile_flux_elixir'),
      'recipe_volatile_flux_elixir',
    );
    expect(mod.isRecipeKnown(undefined, jerky)).toBe(true);
    expect(mod.isRecipeKnown(undefined, combo)).toBe(false);
    // The alias is module-private, so the arm pins the binding it aliases
    // instead: the adapter must preserve null (the carried-only path) and
    // otherwise count the stock row it was handed.
    const vault = await import('../src/sim/materials_vault');
    expect(vault.drawableCounterFor(null)).toBeNull();
    expect(vault.drawableCounterFor({ copper_ore: 5 })?.('copper_ore')).toBe(5);
  });
});
