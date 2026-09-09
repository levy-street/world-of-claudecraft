// Direct test for the extracted profession self-mirror application block
// (src/net/professions_self_mirror.ts), pulled out of ClientWorld.applySnapshot.
// Exercises applyProfessionsSelfMirror against a bare ProfessionsSelfMirrors
// object rather than a real ClientWorld, mirroring the bank_snapshot_wire.test.ts
// idiom for its sibling applyBankSelfWire. Fixture shapes are lifted from the
// existing decode-leaf suites (crafting_wire.test.ts, gathering_goal_wire.test.ts,
// harvest_preference_wire.test.ts) rather than hand-rolled from scratch.

import { describe, expect, it } from 'vitest';
import {
  applyProfessionsSelfMirror,
  type ProfessionsSelfMirrors,
} from '../src/net/professions_self_mirror';
import type { FarmPlotView } from '../src/sim/professions/farm_projection';
import {
  HARVEST_PREFERENCE_ALL,
  HARVEST_PREFERENCE_ALL_TOKEN,
} from '../src/sim/professions/harvest_preference';
import type {
  CommissionOrderView,
  CraftingIdentityView,
  ToolEffectSlotView,
} from '../src/world_api/professions';

function commissionOrder(overrides: Partial<CommissionOrderView> = {}): CommissionOrderView {
  return {
    id: 1,
    requesterName: 'Alice',
    recipeId: 'recipe_test',
    itemId: 'item_test',
    scope: 'open',
    status: 'open',
    mine: false,
    mineToCraft: false,
    ...overrides,
  };
}

function toolEffectSlot(overrides: Partial<ToolEffectSlotView> = {}): ToolEffectSlotView {
  return {
    professionId: 'mining',
    effectId: 'effect_test',
    charges: 3,
    maxCharges: 5,
    confirmMode: 'always',
    selfCrafted: false,
    ...overrides,
  };
}

function farmPlot(overrides: Partial<FarmPlotView> = {}): FarmPlotView {
  return {
    bedId: 'bed_1',
    cropId: 'wheat',
    plantedAtMs: 0,
    readyAtMs: 1000,
    compost: false,
    watch: false,
    tonic: false,
    notified: false,
    status: 'growing',
    ...overrides,
  };
}

function freshTarget(): ProfessionsSelfMirrors {
  return {
    commissionOrders: [],
    lastDisenchantResult: null,
    lastEnchantResult: null,
    lastSalvageResult: null,
    gatheringProficiency: {},
    toolEffectSlots: [],
    harvestPreference: null,
    gatheringGoal: null,
    myFarmPlots: [],
    professionsState: { skills: [] },
    craftSkills: {},
    craftingIdentity: {
      version: 1,
      synced: false,
      craftSkills: {},
      activeArchetype: null,
      pairedMajor: null,
      hobbyCraft: null,
      attunedPairs: [],
      switchCount: 0,
      amendsProgress: 0,
      amendsRequired: 0,
      knownRecipes: [],
      cadenceBlockedQuests: [],
    },
  };
}

// The gathering_goal_wire.test.ts readyRecipeView fixture, trimmed to the one
// shape this suite needs.
function readyRecipeGoal(): unknown {
  return {
    goal: { kind: 'recipe', recipeId: 'recipe_test', count: 5 },
    status: 'ready',
    reason: null,
    materials: [
      {
        itemId: 'rough_hide',
        required: 10,
        carried: 6,
        stored: 4,
        reachable: 10,
        missing: 0,
        inaccessible: 0,
      },
    ],
    payableCrafts: 5,
    storageRestricted: false,
  };
}

// The crafting_wire.test.ts fullPayload fixture: a fully populated modern cprof
// delta as the server actually ships it.
function fullCraftingIdentityPayload(): CraftingIdentityView {
  return {
    version: 1,
    synced: true,
    craftSkills: { alchemy: 3, weaponcrafting: 7 },
    activeArchetype: 'artisan',
    pairedMajor: 'weaponcrafting',
    hobbyCraft: 'cooking',
    attunedPairs: ['weaponcrafting:jewelcrafting'],
    switchCount: 2,
    amendsProgress: 1,
    amendsRequired: 4,
    knownRecipes: ['recipe_a', 'recipe_b'],
    cadenceBlockedQuests: ['work_order_daily'],
  };
}

describe('applyProfessionsSelfMirror: omission retains every mirror', () => {
  it('leaves every field, by reference, untouched when every key is omitted', () => {
    const target = freshTarget();

    // Every array/record/object-shaped field gets a distinct, nonempty,
    // freshly-allocated value (never one that could coincidentally `toEqual`
    // a rebuilt default), so a reference check here can only pass if the
    // function genuinely left the field alone.
    const commissionOrders = [commissionOrder()];
    const lastDisenchantResult = { ok: true, itemId: 'copper_ore', materialItemId: 'dust' };
    const lastEnchantResult = { ok: true, itemId: 'oak_staff', enchantId: 'sharpness' };
    const lastSalvageResult = { ok: true, itemId: 'iron_sword', materialItemId: 'iron_ore' };
    const gatheringProficiency = { mining: 4 };
    const toolEffectSlots = [toolEffectSlot()];
    const harvestPreference = { kind: 'material', itemId: 'rough_hide' } as const;
    const gatheringGoal = readyRecipeGoal() as ProfessionsSelfMirrors['gatheringGoal'];
    const myFarmPlots = [farmPlot()];
    const professionsState = { skills: [{ professionId: 'mining', skill: 5, maxSkill: 100 }] };
    const craftingIdentity = { ...target.craftingIdentity, activeArchetype: 'artisan' };
    const craftSkills = craftingIdentity.craftSkills;

    target.commissionOrders = commissionOrders;
    target.lastDisenchantResult = lastDisenchantResult;
    target.lastEnchantResult = lastEnchantResult;
    target.lastSalvageResult = lastSalvageResult;
    target.gatheringProficiency = gatheringProficiency;
    target.toolEffectSlots = toolEffectSlots;
    target.harvestPreference = harvestPreference;
    target.gatheringGoal = gatheringGoal;
    target.myFarmPlots = myFarmPlots;
    target.professionsState = professionsState;
    target.craftingIdentity = craftingIdentity;
    target.craftSkills = craftSkills;

    applyProfessionsSelfMirror(target, {});

    // Reference identity, not reconstructed equality: `toBe` on every
    // object/array-shaped field, since a `toEqual` pass here would prove
    // nothing about whether the function actually left the field alone.
    expect(target.commissionOrders).toBe(commissionOrders);
    expect(target.lastDisenchantResult).toBe(lastDisenchantResult);
    expect(target.lastEnchantResult).toBe(lastEnchantResult);
    expect(target.lastSalvageResult).toBe(lastSalvageResult);
    expect(target.gatheringProficiency).toBe(gatheringProficiency);
    expect(target.toolEffectSlots).toBe(toolEffectSlots);
    expect(target.harvestPreference).toBe(harvestPreference);
    expect(target.gatheringGoal).toBe(gatheringGoal);
    expect(target.myFarmPlots).toBe(myFarmPlots);
    expect(target.professionsState).toBe(professionsState);
    expect(target.craftingIdentity).toBe(craftingIdentity);
    expect(target.craftSkills).toBe(craftSkills);
  });
});

describe('applyProfessionsSelfMirror: explicit null/default clears per field', () => {
  it('resets the array/record-shaped mirrors to their empty defaults on explicit null', () => {
    const target = freshTarget();
    target.commissionOrders = [commissionOrder()];
    target.gatheringProficiency = { mining: 4 };
    target.toolEffectSlots = [toolEffectSlot()];
    target.myFarmPlots = [farmPlot()];
    target.professionsState = { skills: [{ professionId: 'mining', skill: 5, maxSkill: 100 }] };

    applyProfessionsSelfMirror(target, {
      corder: null,
      gprof: null,
      tslot: null,
      fplot: null,
      prof: null,
    });

    expect(target.commissionOrders).toEqual([]);
    expect(target.gatheringProficiency).toEqual({});
    expect(target.toolEffectSlots).toEqual([]);
    expect(target.myFarmPlots).toEqual([]);
    expect(target.professionsState).toEqual({ skills: [] });
  });

  it('clears the enchanting-action result mirrors to null on explicit null', () => {
    const target = freshTarget();
    target.lastDisenchantResult = { ok: true, itemId: 'copper_ore', materialItemId: 'dust' };
    target.lastEnchantResult = { ok: true, itemId: 'oak_staff', enchantId: 'sharpness' };
    target.lastSalvageResult = { ok: true, itemId: 'iron_sword', materialItemId: 'iron_ore' };

    applyProfessionsSelfMirror(target, { denc: null, ench: null, salv: null });

    expect(target.lastDisenchantResult).toBeNull();
    expect(target.lastEnchantResult).toBeNull();
    expect(target.lastSalvageResult).toBeNull();
  });
});

describe('applyProfessionsSelfMirror: hpref/ggoal refuse malformed to null', () => {
  it('decodes a valid harvest preference token and material id', () => {
    const target = freshTarget();

    applyProfessionsSelfMirror(target, { hpref: HARVEST_PREFERENCE_ALL_TOKEN });
    expect(target.harvestPreference).toEqual(HARVEST_PREFERENCE_ALL);

    applyProfessionsSelfMirror(target, { hpref: 'rough_hide' });
    expect(target.harvestPreference).toEqual({ kind: 'material', itemId: 'rough_hide' });
  });

  it('refuses a malformed hpref to null rather than reviving All', () => {
    const target = freshTarget();
    target.harvestPreference = { kind: 'material', itemId: 'rough_hide' };

    applyProfessionsSelfMirror(target, { hpref: 'two words' });

    expect(target.harvestPreference).toBeNull();
  });

  it('decodes a valid gathering goal view verbatim', () => {
    const target = freshTarget();
    const raw = readyRecipeGoal();

    applyProfessionsSelfMirror(target, { ggoal: raw });

    expect(target.gatheringGoal).toEqual(raw);
  });

  it('refuses a malformed ggoal frame to null rather than a partial projection', () => {
    const target = freshTarget();
    target.gatheringGoal = readyRecipeGoal() as ProfessionsSelfMirrors['gatheringGoal'];

    applyProfessionsSelfMirror(target, {
      ggoal: { ...(readyRecipeGoal() as object), status: 'bogus' },
    });

    expect(target.gatheringGoal).toBeNull();
  });

  it('clears an explicit ggoal:null (the goal-cleared wire value)', () => {
    const target = freshTarget();
    target.gatheringGoal = readyRecipeGoal() as ProfessionsSelfMirrors['gatheringGoal'];

    applyProfessionsSelfMirror(target, { ggoal: null });

    expect(target.gatheringGoal).toBeNull();
  });
});

describe('applyProfessionsSelfMirror: cprof (crafting identity)', () => {
  it('retains the existing identity and craftSkills on explicit cprof:null', () => {
    const target = freshTarget();
    const identity = { ...target.craftingIdentity, activeArchetype: 'artisan' };
    const craftSkills = { alchemy: 2 };
    target.craftingIdentity = identity;
    target.craftSkills = craftSkills;

    applyProfessionsSelfMirror(target, { cprof: null });

    expect(target.craftingIdentity).toBe(identity);
    expect(target.craftSkills).toBe(craftSkills);
  });

  it('updates both craftSkills and craftingIdentity from a valid cprof payload, aliased', () => {
    const target = freshTarget();
    const payload = fullCraftingIdentityPayload();

    applyProfessionsSelfMirror(target, { cprof: payload });

    expect(target.craftingIdentity.craftSkills).toBe(target.craftSkills);
    expect(target.craftSkills).toEqual({ alchemy: 3, weaponcrafting: 7 });
    expect(target.craftSkills).not.toBe(payload.craftSkills);
    expect(target.craftingIdentity.activeArchetype).toBe('artisan');
    expect(target.craftingIdentity.synced).toBe(true);
  });
});
