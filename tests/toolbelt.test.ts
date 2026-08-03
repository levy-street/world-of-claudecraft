import { describe, expect, it } from 'vitest';
import { BACKPACK_SLOTS, bagCapacity } from '../src/sim/bags';
import { GATHERING_PROFESSION_IDS } from '../src/sim/content/professions';
import { ITEMS } from '../src/sim/data';
import { bestOwnedGatherToolTierOrNone, hasFishingImplement } from '../src/sim/professions/tools';
import { Sim } from '../src/sim/sim';
import {
  emptyToolbelt,
  isBeltableTool,
  isToolbeltItem,
  isToolSlotId,
  sanitizeToolbeltState,
  storedTools,
  TOOL_SLOT_IDS,
  toolSearchInventory,
  toolSlotOf,
} from '../src/sim/toolbelt';
import type { InvSlot } from '../src/sim/types';

const makeSim = () => new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });

// Give the player one copy of an item without going through a capacity-gated
// grant path, matching how the other sim suites seed an inventory.
const give = (sim: Sim, itemId: string, count = 1): void => {
  sim.addItem(itemId, count);
};

describe('toolbelt slot vocabulary', () => {
  it('has exactly one slot per tool type in the game', () => {
    // The belt's slot list IS the gathering-profession list, so "a slot for
    // every type of tool" cannot drift as professions are added.
    expect([...TOOL_SLOT_IDS]).toEqual([...GATHERING_PROFESSION_IDS]);
    expect(TOOL_SLOT_IDS.length).toBeGreaterThan(0);
  });

  it('files each tool under its own profession, and both fishing implements together', () => {
    expect(toolSlotOf(ITEMS.copper_mining_pick)).toBe('mining');
    expect(toolSlotOf(ITEMS.arcanite_mining_pick)).toBe('mining');
    expect(toolSlotOf(ITEMS.handaxe)).toBe('logging');
    expect(toolSlotOf(ITEMS.gathering_sickle)).toBe('herbalism');
    // The simple pole (use.type 'fishing') and the tiered rods (gatherTool)
    // share the one fishing slot, exactly the pair hasFishingImplement accepts.
    expect(toolSlotOf(ITEMS.simple_fishing_pole)).toBe('fishing');
    expect(toolSlotOf(ITEMS.ironreel_fishing_rod)).toBe('fishing');
  });

  it('refuses everything that is not a gathering tool, kind:"tool" cosmetics included', () => {
    expect(toolSlotOf(ITEMS.baked_bread)).toBeUndefined();
    expect(toolSlotOf(ITEMS.worn_sword)).toBeUndefined();
    expect(toolSlotOf(ITEMS.linen_pouch)).toBeUndefined();
    // kind 'tool' is a grab bag: these are cosmetic tokens, not real tools.
    expect(isBeltableTool(ITEMS.event_skin_token)).toBe(false);
    expect(isBeltableTool(ITEMS.heroic_mark)).toBe(false);
    expect(isBeltableTool(ITEMS.copper_mining_pick)).toBe(true);
  });

  it('recognizes the container item, and validates the wire slot vocabulary', () => {
    expect(isToolbeltItem(ITEMS.toolbelt)).toBe(true);
    expect(isToolbeltItem(ITEMS.linen_pouch)).toBe(false);
    expect(isToolSlotId('mining')).toBe(true);
    expect(isToolSlotId('smithing')).toBe(false);
    expect(isToolSlotId('__proto__')).toBe(false);
  });
});

describe('toolbelt is not a bag', () => {
  it('grants no pooled slots, so wearing one never moves bagCapacity', () => {
    const sim = makeSim();
    const before = sim.bagCapacity;
    give(sim, 'toolbelt');
    sim.equipToolbelt('toolbelt');
    expect(sim.toolbelt.equipped).toBe('toolbelt');
    expect(sim.bagCapacity).toBe(before);
    expect(sim.bagCapacity).toBe(bagCapacity(sim.bags));
  });

  it('cannot be equipped into a general bag socket', () => {
    const sim = makeSim();
    give(sim, 'toolbelt');
    sim.equipBag('toolbelt', 0);
    expect(sim.bags[0]).toBeNull();
    // Still carried: the refused equip consumed nothing.
    expect(sim.countItem('toolbelt')).toBe(1);
  });
});

describe('storing and taking tools', () => {
  it('moves a tool out of the pooled inventory into its typed slot', () => {
    const sim = makeSim();
    give(sim, 'toolbelt');
    give(sim, 'copper_mining_pick');
    sim.equipToolbelt('toolbelt');
    const used = sim.inventory.length;

    sim.storeToolInBelt('copper_mining_pick');

    expect(sim.countItem('copper_mining_pick')).toBe(0);
    expect(sim.inventory.length).toBe(used - 1);
    expect(sim.toolbelt.slots.mining?.itemId).toBe('copper_mining_pick');
  });

  it('frees one backpack slot per tool type, four in total', () => {
    const sim = makeSim();
    give(sim, 'toolbelt');
    sim.equipToolbelt('toolbelt');
    const tools = ['copper_mining_pick', 'handaxe', 'gathering_sickle', 'ironreel_fishing_rod'];
    for (const id of tools) give(sim, id);
    const carried = sim.inventory.length;

    for (const id of tools) sim.storeToolInBelt(id);

    expect(sim.inventory.length).toBe(carried - tools.length);
    expect(storedTools(sim.toolbelt)).toHaveLength(tools.length);
  });

  it('swaps within a slot rather than stacking two tools of one type', () => {
    const sim = makeSim();
    give(sim, 'toolbelt');
    give(sim, 'copper_mining_pick');
    give(sim, 'iron_mining_pick');
    sim.equipToolbelt('toolbelt');

    sim.storeToolInBelt('copper_mining_pick');
    sim.storeToolInBelt('iron_mining_pick');

    expect(sim.toolbelt.slots.mining?.itemId).toBe('iron_mining_pick');
    // The displaced tool is returned, never destroyed.
    expect(sim.countItem('copper_mining_pick')).toBe(1);
    expect(storedTools(sim.toolbelt)).toHaveLength(1);
  });

  it('refuses a non-tool, and refuses anything at all with no belt worn', () => {
    const sim = makeSim();
    give(sim, 'toolbelt');
    give(sim, 'baked_bread');
    give(sim, 'copper_mining_pick');

    // No belt worn yet.
    sim.storeToolInBelt('copper_mining_pick');
    expect(storedTools(sim.toolbelt)).toHaveLength(0);
    expect(sim.countItem('copper_mining_pick')).toBe(1);

    sim.equipToolbelt('toolbelt');
    const bread = sim.countItem('baked_bread');
    sim.storeToolInBelt('baked_bread');
    expect(storedTools(sim.toolbelt)).toHaveLength(0);
    expect(sim.countItem('baked_bread')).toBe(bread);
  });

  it('takes a tool back out into the inventory', () => {
    const sim = makeSim();
    give(sim, 'toolbelt');
    give(sim, 'copper_mining_pick');
    sim.equipToolbelt('toolbelt');
    sim.storeToolInBelt('copper_mining_pick');

    sim.takeToolFromBelt('mining');

    expect(sim.countItem('copper_mining_pick')).toBe(1);
    expect(sim.toolbelt.slots.mining).toBeUndefined();
  });

  it('refuses to take a tool out into a full backpack, never destroying it', () => {
    const sim = makeSim();
    give(sim, 'toolbelt');
    give(sim, 'copper_mining_pick');
    sim.equipToolbelt('toolbelt');
    sim.storeToolInBelt('copper_mining_pick');
    // Fill every remaining pooled slot with distinct unstackable items.
    while (sim.inventory.length < sim.bagCapacity) sim.addItem('worn_sword', 1);

    sim.takeToolFromBelt('mining');

    expect(sim.toolbelt.slots.mining?.itemId).toBe('copper_mining_pick');
    expect(sim.inventory.length).toBe(sim.bagCapacity);
  });
});

describe('unequipping the belt', () => {
  it('returns the belt and every tool it holds', () => {
    const sim = makeSim();
    give(sim, 'toolbelt');
    give(sim, 'copper_mining_pick');
    give(sim, 'handaxe');
    sim.equipToolbelt('toolbelt');
    sim.storeToolInBelt('copper_mining_pick');
    sim.storeToolInBelt('handaxe');

    sim.unequipToolbelt();

    expect(sim.toolbelt.equipped).toBeNull();
    expect(storedTools(sim.toolbelt)).toHaveLength(0);
    expect(sim.countItem('toolbelt')).toBe(1);
    expect(sim.countItem('copper_mining_pick')).toBe(1);
    expect(sim.countItem('handaxe')).toBe(1);
  });

  it('refuses when the belt plus its contents would not all fit', () => {
    const sim = makeSim();
    give(sim, 'toolbelt');
    give(sim, 'copper_mining_pick');
    sim.equipToolbelt('toolbelt');
    sim.storeToolInBelt('copper_mining_pick');
    // Belt + pick need two free slots; leave exactly one.
    while (sim.inventory.length < sim.bagCapacity - 1) sim.addItem('worn_sword', 1);

    sim.unequipToolbelt();

    expect(sim.toolbelt.equipped).toBe('toolbelt');
    expect(sim.toolbelt.slots.mining?.itemId).toBe('copper_mining_pick');
  });
});

describe('a belted tool still counts as carried', () => {
  it('combines both containers into one owned-tool view', () => {
    const inventory: InvSlot[] = [{ itemId: 'baked_bread', count: 1 }];
    const belt = emptyToolbelt();
    belt.equipped = 'toolbelt';
    belt.slots.mining = { itemId: 'mithril_mining_pick', count: 1 };

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
    const belt = emptyToolbelt();
    belt.equipped = 'toolbelt';
    belt.slots.fishing = { itemId: 'simple_fishing_pole', count: 1 };
    expect(hasFishingImplement([], ITEMS)).toBe(false);
    expect(hasFishingImplement(toolSearchInventory([], belt), ITEMS)).toBe(true);
  });

  it('gathers through the live sim with the pick belted, not carried', () => {
    const sim = makeSim();
    give(sim, 'toolbelt');
    give(sim, 'mithril_mining_pick');
    sim.equipToolbelt('toolbelt');
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

describe('persistence', () => {
  it('round-trips the belt through serialize and load', () => {
    const sim = makeSim();
    give(sim, 'toolbelt');
    give(sim, 'copper_mining_pick');
    sim.equipToolbelt('toolbelt');
    sim.storeToolInBelt('copper_mining_pick');

    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.toolbelt?.equipped).toBe('toolbelt');

    const loaded = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    loaded.addPlayer('warrior', 'Restored', { state });

    expect(loaded.toolbelt.equipped).toBe('toolbelt');
    expect(loaded.toolbelt.slots.mining?.itemId).toBe('copper_mining_pick');
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
  it('spills a tool filed under the wrong type rather than stranding it', () => {
    const { state, spill } = sanitizeToolbeltState({
      equipped: 'toolbelt',
      // A pick under the logging key: unreachable if kept.
      slots: { logging: { itemId: 'copper_mining_pick', count: 1 } },
    });
    expect(state.equipped).toBe('toolbelt');
    expect(state.slots.logging).toBeUndefined();
    expect(spill.map((s) => s.itemId)).toEqual(['copper_mining_pick']);
  });

  it('spills stored contents when no belt is worn', () => {
    const { state, spill } = sanitizeToolbeltState({
      equipped: null,
      slots: { mining: { itemId: 'copper_mining_pick', count: 1 } },
    });
    expect(state.equipped).toBeNull();
    expect(storedTools(state)).toHaveLength(0);
    expect(spill.map((s) => s.itemId)).toEqual(['copper_mining_pick']);
  });

  it('drops an equipped id that is not a toolbelt, and clamps a tampered count', () => {
    const notABelt = sanitizeToolbeltState({ equipped: 'linen_pouch', slots: {} });
    expect(notABelt.state.equipped).toBeNull();

    const tampered = sanitizeToolbeltState({
      equipped: 'toolbelt',
      slots: { mining: { itemId: 'copper_mining_pick', count: 99 } },
    });
    expect(tampered.state.slots.mining?.count).toBe(1);
  });

  it('tolerates junk input', () => {
    expect(sanitizeToolbeltState(undefined).state).toEqual(emptyToolbelt());
    expect(sanitizeToolbeltState(null).state).toEqual(emptyToolbelt());
    expect(sanitizeToolbeltState('nonsense').state).toEqual(emptyToolbelt());
    expect(sanitizeToolbeltState({ equipped: 'toolbelt', slots: 7 }).state.slots).toEqual({});
  });
});
