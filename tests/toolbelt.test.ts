import { describe, expect, it } from 'vitest';
import { BACKPACK_SLOTS, bagCapacity } from '../src/sim/bags';
import { recipeById, TOOLBELT_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import { bestOwnedGatherToolTierOrNone, hasFishingImplement } from '../src/sim/professions/tools';
import { teachTierMet } from '../src/sim/professions/training';
import { Sim } from '../src/sim/sim';
import {
  beltSlotCount,
  bestStowCandidate,
  emptyToolbelt,
  isBeltableTool,
  isToolbeltItem,
  sanitizeToolbeltState,
  storedTools,
  toolSearchInventory,
  toolSlotCount,
  toolTypeOf,
} from '../src/sim/toolbelt';
import type { InvSlot } from '../src/sim/types';

const makeSim = () => new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });

// Give the player one copy of an item without going through a capacity-gated
// grant path, matching how the other sim suites seed an inventory.
const give = (sim: Sim, itemId: string, count = 1): void => {
  sim.addItem(itemId, count);
};

// A worn belt with tools already in slot order, for the pure-function tests.
const wornBelt = (equipped: string, ...toolIds: string[]) => {
  const state = emptyToolbelt();
  state.equipped = equipped;
  const capacity = toolSlotCount(ITEMS[equipped]);
  state.slots = Array.from({ length: capacity }, (_, i): InvSlot | null =>
    toolIds[i] ? { itemId: toolIds[i], count: 1 } : null,
  );
  return state;
};

describe('the toolbelt ladder', () => {
  it('has three rungs whose slot counts are authored on the defs: 2, 3, 4', () => {
    expect(toolSlotCount(ITEMS.basic_toolbelt)).toBe(2);
    expect(toolSlotCount(ITEMS.reinforced_toolbelt)).toBe(3);
    expect(toolSlotCount(ITEMS.artisans_toolbelt)).toBe(4);
    // Not a belt: no slots, whatever the def carries elsewhere.
    expect(toolSlotCount(ITEMS.linen_pouch)).toBe(0);
    expect(toolSlotCount(undefined)).toBe(0);
  });

  it('is tailoring-crafted at skill 25/50/75, loom-bound, trainer-taught', () => {
    const gates: Record<string, number> = {
      recipe_basic_toolbelt: 25,
      recipe_reinforced_toolbelt: 50,
      recipe_artisans_toolbelt: 75,
    };
    expect(TOOLBELT_RECIPES.map((r) => r.id).sort()).toEqual(Object.keys(gates).sort());
    for (const recipe of TOOLBELT_RECIPES) {
      expect(recipe.professionId).toBe('tailoring');
      expect(recipe.skillReq).toBe(gates[recipe.id]);
      expect(recipe.stationType).toBe('loom');
      expect(recipe.acquisition).toEqual(['trainer']);
      expect(isToolbeltItem(ITEMS[recipe.resultItemId])).toBe(true);
    }
    // No belt is vendor-stocked: the ladder is the only source.
    for (const item of Object.values(ITEMS)) {
      if (item.kind === 'toolbelt') expect(item.buyValue).toBeUndefined();
    }
  });

  it('each rung teaches exactly at its tier boundary: 24 fails, 25 teaches', () => {
    const basic = recipeById('recipe_basic_toolbelt')!;
    expect(teachTierMet(basic, { tailoring: 24 })).toBe(false);
    expect(teachTierMet(basic, { tailoring: 25 })).toBe(true);
    const reinforced = recipeById('recipe_reinforced_toolbelt')!;
    expect(teachTierMet(reinforced, { tailoring: 49 })).toBe(false);
    expect(teachTierMet(reinforced, { tailoring: 50 })).toBe(true);
    const artisans = recipeById('recipe_artisans_toolbelt')!;
    expect(teachTierMet(artisans, { tailoring: 74 })).toBe(false);
    expect(teachTierMet(artisans, { tailoring: 75 })).toBe(true);
  });
});

describe('tool classification', () => {
  it('types each tool by its profession, and both fishing implements together', () => {
    expect(toolTypeOf(ITEMS.copper_mining_pick)).toBe('mining');
    expect(toolTypeOf(ITEMS.arcanite_mining_pick)).toBe('mining');
    expect(toolTypeOf(ITEMS.handaxe)).toBe('logging');
    expect(toolTypeOf(ITEMS.gathering_sickle)).toBe('herbalism');
    // The simple pole (use.type 'fishing') and the tiered rods (gatherTool)
    // share the one fishing type, exactly the pair hasFishingImplement accepts.
    expect(toolTypeOf(ITEMS.simple_fishing_pole)).toBe('fishing');
    expect(toolTypeOf(ITEMS.ironreel_fishing_rod)).toBe('fishing');
  });

  it('refuses everything that is not a gathering tool, kind:"tool" cosmetics included', () => {
    expect(toolTypeOf(ITEMS.baked_bread)).toBeUndefined();
    expect(toolTypeOf(ITEMS.worn_sword)).toBeUndefined();
    expect(toolTypeOf(ITEMS.linen_pouch)).toBeUndefined();
    // kind 'tool' is a grab bag: these are cosmetic tokens, not real tools.
    expect(isBeltableTool(ITEMS.event_skin_token)).toBe(false);
    expect(isBeltableTool(ITEMS.heroic_mark)).toBe(false);
    expect(isBeltableTool(ITEMS.copper_mining_pick)).toBe(true);
  });

  it('recognizes the container items themselves', () => {
    expect(isToolbeltItem(ITEMS.basic_toolbelt)).toBe(true);
    expect(isToolbeltItem(ITEMS.artisans_toolbelt)).toBe(true);
    expect(isToolbeltItem(ITEMS.linen_pouch)).toBe(false);
  });
});

describe('toolbelt is not a bag', () => {
  it('grants no pooled slots, so wearing one never moves bagCapacity', () => {
    const sim = makeSim();
    const before = sim.bagCapacity;
    give(sim, 'basic_toolbelt');
    sim.equipToolbelt('basic_toolbelt');
    expect(sim.toolbelt.equipped).toBe('basic_toolbelt');
    expect(sim.bagCapacity).toBe(before);
    expect(sim.bagCapacity).toBe(bagCapacity(sim.bags));
  });

  it('cannot be equipped into a general bag socket', () => {
    const sim = makeSim();
    give(sim, 'basic_toolbelt');
    sim.equipBag('basic_toolbelt', 0);
    expect(sim.bags[0]).toBeNull();
    // Still carried: the refused equip consumed nothing.
    expect(sim.countItem('basic_toolbelt')).toBe(1);
  });
});

describe('storing and taking tools', () => {
  it('moves a tool out of the pooled inventory into the first empty slot', () => {
    const sim = makeSim();
    give(sim, 'basic_toolbelt');
    give(sim, 'copper_mining_pick');
    sim.equipToolbelt('basic_toolbelt');
    expect(sim.toolbelt.slots).toEqual([null, null]);
    const used = sim.inventory.length;

    sim.storeToolInBelt('copper_mining_pick');

    expect(sim.countItem('copper_mining_pick')).toBe(0);
    expect(sim.inventory.length).toBe(used - 1);
    expect(sim.toolbelt.slots[0]?.itemId).toBe('copper_mining_pick');
    expect(sim.toolbelt.slots[1]).toBeNull();
  });

  it('slots are generic: any mix of tool types, duplicates included', () => {
    const sim = makeSim();
    give(sim, 'basic_toolbelt');
    give(sim, 'copper_mining_pick');
    give(sim, 'iron_mining_pick');
    sim.equipToolbelt('basic_toolbelt');

    sim.storeToolInBelt('copper_mining_pick');
    sim.storeToolInBelt('iron_mining_pick');

    // Two mining picks belted at once: no typed slot to collide in.
    expect(storedTools(sim.toolbelt).map((s) => s.itemId)).toEqual([
      'copper_mining_pick',
      'iron_mining_pick',
    ]);
  });

  it('refuses a store once every slot is filled, consuming nothing', () => {
    const sim = makeSim();
    give(sim, 'basic_toolbelt');
    sim.equipToolbelt('basic_toolbelt');
    for (const id of ['copper_mining_pick', 'handaxe', 'gathering_sickle']) give(sim, id);

    sim.storeToolInBelt('copper_mining_pick');
    sim.storeToolInBelt('handaxe');
    sim.storeToolInBelt('gathering_sickle'); // 2-slot belt: refused

    expect(storedTools(sim.toolbelt)).toHaveLength(2);
    expect(sim.countItem('gathering_sickle')).toBe(1);
  });

  it('refuses a non-tool, and refuses anything at all with no belt worn', () => {
    const sim = makeSim();
    give(sim, 'basic_toolbelt');
    give(sim, 'baked_bread');
    give(sim, 'copper_mining_pick');

    // No belt worn yet.
    sim.storeToolInBelt('copper_mining_pick');
    expect(storedTools(sim.toolbelt)).toHaveLength(0);
    expect(sim.countItem('copper_mining_pick')).toBe(1);

    sim.equipToolbelt('basic_toolbelt');
    const bread = sim.countItem('baked_bread');
    sim.storeToolInBelt('baked_bread');
    expect(storedTools(sim.toolbelt)).toHaveLength(0);
    expect(sim.countItem('baked_bread')).toBe(bread);
  });

  it('takes a tool back out by position, leaving the other slots in place', () => {
    const sim = makeSim();
    give(sim, 'basic_toolbelt');
    give(sim, 'copper_mining_pick');
    give(sim, 'handaxe');
    sim.equipToolbelt('basic_toolbelt');
    sim.storeToolInBelt('copper_mining_pick');
    sim.storeToolInBelt('handaxe');

    sim.takeToolFromBelt(0);

    expect(sim.countItem('copper_mining_pick')).toBe(1);
    // Position 1 did not shift down: slots are stable.
    expect(sim.toolbelt.slots[0]).toBeNull();
    expect(sim.toolbelt.slots[1]?.itemId).toBe('handaxe');
  });

  it('ignores an out-of-range or non-integer slot index off the wire', () => {
    const sim = makeSim();
    give(sim, 'basic_toolbelt');
    give(sim, 'copper_mining_pick');
    sim.equipToolbelt('basic_toolbelt');
    sim.storeToolInBelt('copper_mining_pick');

    sim.takeToolFromBelt(-1);
    sim.takeToolFromBelt(2);
    sim.takeToolFromBelt(0.5);

    expect(sim.toolbelt.slots[0]?.itemId).toBe('copper_mining_pick');
    expect(sim.countItem('copper_mining_pick')).toBe(0);
  });

  it('refuses to take a tool out into a full backpack, never destroying it', () => {
    const sim = makeSim();
    give(sim, 'basic_toolbelt');
    give(sim, 'copper_mining_pick');
    sim.equipToolbelt('basic_toolbelt');
    sim.storeToolInBelt('copper_mining_pick');
    // Fill every remaining pooled slot with distinct unstackable items.
    while (sim.inventory.length < sim.bagCapacity) sim.addItem('worn_sword', 1);

    sim.takeToolFromBelt(0);

    expect(sim.toolbelt.slots[0]?.itemId).toBe('copper_mining_pick');
    expect(sim.inventory.length).toBe(sim.bagCapacity);
  });
});

describe('swapping along the ladder', () => {
  it('an upgrade carries the stored tools over into the bigger belt', () => {
    const sim = makeSim();
    give(sim, 'basic_toolbelt');
    give(sim, 'artisans_toolbelt');
    give(sim, 'copper_mining_pick');
    give(sim, 'handaxe');
    sim.equipToolbelt('basic_toolbelt');
    sim.storeToolInBelt('copper_mining_pick');
    sim.storeToolInBelt('handaxe');

    sim.equipToolbelt('artisans_toolbelt');

    expect(sim.toolbelt.equipped).toBe('artisans_toolbelt');
    expect(beltSlotCount(sim.toolbelt)).toBe(4);
    expect(sim.toolbelt.slots).toHaveLength(4);
    expect(storedTools(sim.toolbelt).map((s) => s.itemId)).toEqual([
      'copper_mining_pick',
      'handaxe',
    ]);
    // The displaced basic belt came back to the bags.
    expect(sim.countItem('basic_toolbelt')).toBe(1);
  });

  it('a downgrade returns the overflow tools to the inventory', () => {
    const sim = makeSim();
    give(sim, 'basic_toolbelt');
    give(sim, 'reinforced_toolbelt');
    give(sim, 'copper_mining_pick');
    give(sim, 'handaxe');
    give(sim, 'gathering_sickle');
    sim.equipToolbelt('reinforced_toolbelt');
    for (const id of ['copper_mining_pick', 'handaxe', 'gathering_sickle']) sim.storeToolInBelt(id);

    sim.equipToolbelt('basic_toolbelt');

    expect(sim.toolbelt.slots).toHaveLength(2);
    expect(storedTools(sim.toolbelt).map((s) => s.itemId)).toEqual([
      'copper_mining_pick',
      'handaxe',
    ]);
    // The third tool spilled back rather than vanishing with the bigger belt.
    expect(sim.countItem('gathering_sickle')).toBe(1);
    expect(sim.countItem('reinforced_toolbelt')).toBe(1);
  });

  it('refuses a downgrade whose overflow would not fit, changing nothing', () => {
    const sim = makeSim();
    give(sim, 'basic_toolbelt');
    give(sim, 'reinforced_toolbelt');
    give(sim, 'copper_mining_pick');
    give(sim, 'handaxe');
    give(sim, 'gathering_sickle');
    sim.equipToolbelt('reinforced_toolbelt');
    for (const id of ['copper_mining_pick', 'handaxe', 'gathering_sickle']) sim.storeToolInBelt(id);
    // The swap itself is net-zero (new belt out, old belt in), so leave NO
    // free slot: the one overflow tool then has nowhere to land.
    while (sim.inventory.length < sim.bagCapacity) sim.addItem('worn_sword', 1);

    sim.equipToolbelt('basic_toolbelt');

    expect(sim.toolbelt.equipped).toBe('reinforced_toolbelt');
    expect(storedTools(sim.toolbelt)).toHaveLength(3);
    expect(sim.countItem('basic_toolbelt')).toBe(1);
  });
});

describe('unequipping the belt', () => {
  it('returns the belt and every tool it holds', () => {
    const sim = makeSim();
    give(sim, 'basic_toolbelt');
    give(sim, 'copper_mining_pick');
    give(sim, 'handaxe');
    sim.equipToolbelt('basic_toolbelt');
    sim.storeToolInBelt('copper_mining_pick');
    sim.storeToolInBelt('handaxe');

    sim.unequipToolbelt();

    expect(sim.toolbelt.equipped).toBeNull();
    expect(sim.toolbelt.slots).toHaveLength(0);
    expect(sim.countItem('basic_toolbelt')).toBe(1);
    expect(sim.countItem('copper_mining_pick')).toBe(1);
    expect(sim.countItem('handaxe')).toBe(1);
  });

  it('refuses when the belt plus its contents would not all fit', () => {
    const sim = makeSim();
    give(sim, 'basic_toolbelt');
    give(sim, 'copper_mining_pick');
    sim.equipToolbelt('basic_toolbelt');
    sim.storeToolInBelt('copper_mining_pick');
    // Belt + pick need two free slots; leave exactly one.
    while (sim.inventory.length < sim.bagCapacity - 1) sim.addItem('worn_sword', 1);

    sim.unequipToolbelt();

    expect(sim.toolbelt.equipped).toBe('basic_toolbelt');
    expect(sim.toolbelt.slots[0]?.itemId).toBe('copper_mining_pick');
  });
});

describe('a belted tool still counts as carried', () => {
  it('combines both containers into one owned-tool view', () => {
    const inventory: InvSlot[] = [{ itemId: 'baked_bread', count: 1 }];
    const belt = wornBelt('basic_toolbelt', 'mithril_mining_pick');

    // The backpack alone knows about no pick at all.
    expect(bestOwnedGatherToolTierOrNone(inventory, 'mining', ITEMS)).toBe(0);
    // The combined view resolves the belted one.
    expect(
      bestOwnedGatherToolTierOrNone(toolSearchInventory(inventory, belt), 'mining', ITEMS),
    ).toBe(3);
  });

  it('returns the inventory array itself when the belt is empty', () => {
    const inventory: InvSlot[] = [{ itemId: 'baked_bread', count: 1 }];
    expect(toolSearchInventory(inventory, emptyToolbelt())).toBe(inventory);
  });

  it('satisfies the fishing implement gate from the belt', () => {
    const belt = wornBelt('basic_toolbelt', 'simple_fishing_pole');
    expect(hasFishingImplement([], ITEMS)).toBe(false);
    expect(hasFishingImplement(toolSearchInventory([], belt), ITEMS)).toBe(true);
  });

  it('gathers through the live sim with the pick belted, not carried', () => {
    const sim = makeSim();
    give(sim, 'basic_toolbelt');
    give(sim, 'mithril_mining_pick');
    sim.equipToolbelt('basic_toolbelt');
    sim.storeToolInBelt('mithril_mining_pick');

    expect(sim.countItem('mithril_mining_pick')).toBe(0);
    const meta = sim.players.get(sim.playerId);
    if (!meta) throw new Error('primary player meta is missing');
    expect(
      bestOwnedGatherToolTierOrNone(
        toolSearchInventory(meta.inventory, meta.toolbelt),
        'mining',
        ITEMS,
      ),
    ).toBe(3);
  });
});

describe('bestStowCandidate (the one-click fill)', () => {
  it('prefers the highest tier of a type not already belted', () => {
    const inventory: InvSlot[] = [
      { itemId: 'copper_mining_pick', count: 1 },
      { itemId: 'mithril_mining_pick', count: 1 },
      { itemId: 'handaxe', count: 1 },
    ];
    // Nothing belted: the tier-3 pick beats the tier-1 pick and axe.
    expect(bestStowCandidate(inventory, wornBelt('basic_toolbelt'), ITEMS)).toBe(
      'mithril_mining_pick',
    );
    // A pick already belted: mining is covered, so the axe is next.
    expect(
      bestStowCandidate(inventory, wornBelt('basic_toolbelt', 'copper_mining_pick'), ITEMS),
    ).toBe('handaxe');
  });

  it('returns undefined when every carried tool type is already belted', () => {
    const inventory: InvSlot[] = [
      { itemId: 'copper_mining_pick', count: 1 },
      { itemId: 'baked_bread', count: 1 },
    ];
    expect(
      bestStowCandidate(inventory, wornBelt('reinforced_toolbelt', 'iron_mining_pick'), ITEMS),
    ).toBeUndefined();
    expect(bestStowCandidate([], wornBelt('basic_toolbelt'), ITEMS)).toBeUndefined();
  });
});

describe('persistence', () => {
  it('round-trips the belt through serialize and load', () => {
    const sim = makeSim();
    give(sim, 'basic_toolbelt');
    give(sim, 'copper_mining_pick');
    sim.equipToolbelt('basic_toolbelt');
    sim.storeToolInBelt('copper_mining_pick');

    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.toolbelt?.equipped).toBe('basic_toolbelt');

    const loaded = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    loaded.addPlayer('warrior', 'Restored', { state });

    expect(loaded.toolbelt.equipped).toBe('basic_toolbelt');
    expect(loaded.toolbelt.slots).toHaveLength(2);
    expect(loaded.toolbelt.slots[0]?.itemId).toBe('copper_mining_pick');
  });

  it('loads a pre-toolbelt save as an empty belt, leaving the backpack intact', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId)!;
    const carried = state.inventory.length;
    // Simulate a save written before this feature existed.
    delete (state as { toolbelt?: unknown }).toolbelt;

    const loaded = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    loaded.addPlayer('warrior', 'Legacy', { state });

    expect(loaded.toolbelt.equipped).toBeNull();
    expect(storedTools(loaded.toolbelt)).toHaveLength(0);
    expect(loaded.inventory.length).toBe(carried);
    expect(loaded.bagCapacity).toBe(BACKPACK_SLOTS);
  });
});

describe('sanitizeToolbeltState is the one load path', () => {
  it('sizes the slots to the worn belt and spills anything past them', () => {
    const { state, spill } = sanitizeToolbeltState({
      equipped: 'basic_toolbelt',
      slots: [
        { itemId: 'copper_mining_pick', count: 1 },
        { itemId: 'handaxe', count: 1 },
        // A third tool on a 2-slot belt: honored nowhere, so returned.
        { itemId: 'gathering_sickle', count: 1 },
      ],
    });
    expect(state.slots).toHaveLength(2);
    expect(state.slots[0]?.itemId).toBe('copper_mining_pick');
    expect(state.slots[1]?.itemId).toBe('handaxe');
    expect(spill.map((s) => s.itemId)).toEqual(['gathering_sickle']);
  });

  it('preserves empty positions rather than compacting a saved layout', () => {
    const { state, spill } = sanitizeToolbeltState({
      equipped: 'basic_toolbelt',
      slots: [null, { itemId: 'handaxe', count: 1 }],
    });
    expect(state.slots[0]).toBeNull();
    expect(state.slots[1]?.itemId).toBe('handaxe');
    expect(spill).toHaveLength(0);
  });

  it('spills a non-tool, and spills stored contents when no belt is worn', () => {
    const junk = sanitizeToolbeltState({
      equipped: 'basic_toolbelt',
      slots: [{ itemId: 'baked_bread', count: 1 }],
    });
    expect(junk.state.slots[0]).toBeNull();
    expect(junk.spill.map((s) => s.itemId)).toEqual(['baked_bread']);

    const beltless = sanitizeToolbeltState({
      equipped: null,
      slots: [{ itemId: 'copper_mining_pick', count: 1 }],
    });
    expect(beltless.state.equipped).toBeNull();
    expect(beltless.state.slots).toHaveLength(0);
    expect(beltless.spill.map((s) => s.itemId)).toEqual(['copper_mining_pick']);
  });

  it('spills a legacy typed-map save (the pre-ladder shape) back to the bags', () => {
    // Written by the original vendor-toolbelt build: `slots` keyed by
    // profession, under a belt id that no longer exists. Everything comes
    // back to the player; nothing is stranded or destroyed.
    const { state, spill } = sanitizeToolbeltState({
      equipped: 'toolbelt',
      slots: {
        mining: { itemId: 'copper_mining_pick', count: 1 },
        fishing: { itemId: 'simple_fishing_pole', count: 1 },
      },
    });
    expect(state.equipped).toBeNull();
    expect(state.slots).toHaveLength(0);
    expect(spill.map((s) => s.itemId).sort()).toEqual([
      'copper_mining_pick',
      'simple_fishing_pole',
    ]);
  });

  it('drops an equipped id that is not a toolbelt, and clamps a tampered count', () => {
    const notABelt = sanitizeToolbeltState({ equipped: 'linen_pouch', slots: [] });
    expect(notABelt.state.equipped).toBeNull();

    const tampered = sanitizeToolbeltState({
      equipped: 'basic_toolbelt',
      slots: [{ itemId: 'copper_mining_pick', count: 99 }],
    });
    expect(tampered.state.slots[0]?.count).toBe(1);
  });

  it('tolerates junk input', () => {
    expect(sanitizeToolbeltState(undefined).state).toEqual(emptyToolbelt());
    expect(sanitizeToolbeltState(null).state).toEqual(emptyToolbelt());
    expect(sanitizeToolbeltState('nonsense').state).toEqual(emptyToolbelt());
    const numeric = sanitizeToolbeltState({ equipped: 'basic_toolbelt', slots: 7 });
    expect(numeric.state.slots).toEqual([null, null]);
    expect(numeric.spill).toHaveLength(0);
  });
});
