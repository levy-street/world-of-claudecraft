import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { canEquipItem, resolveEquipSlot, slotAcceptsItem } from '../src/sim/equipment_rules';
import { primaryStatBudget, SLOT_STAT_MULT, slotStatMultForItem } from '../src/sim/item_budget';
import { LAUNCH_PAPERDOLL_SLOTS } from '../src/sim/launch_paperdoll_slots';
import { buildGearSet, planGearSwap } from '../src/sim/loadout_gear';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES, ALL_EQUIP_SLOTS, isEquipSlot, type JewelryItemDef } from '../src/sim/types';

// Synthetic definitions exercise the slot without adding unrequested game content.
const TRINKET: JewelryItemDef = {
  ...ITEMS.seal_of_the_nine_oaths,
  id: 'test_trinket',
  name: 'Test Trinket',
  kind: 'armor',
  slot: 'trinket',
  armorType: undefined,
  weapon: undefined,
  stats: { str: 7, sta: 4 },
};
const SECOND = { ...TRINKET, id: 'test_trinket_second' };

beforeEach(() => {
  ITEMS[TRINKET.id] = TRINKET;
  ITEMS[SECOND.id] = SECOND;
});
afterEach(() => {
  delete ITEMS[TRINKET.id];
  delete ITEMS[SECOND.id];
});

function makeSim() {
  const sim = new Sim({ seed: 7, playerClass: 'warrior' });
  sim.setPlayerLevel(20);
  return sim;
}

describe('single functional trinket slot', () => {
  it('uses the unarmored accessory budget without a held-offhand override', () => {
    expect(SLOT_STAT_MULT.trinket).toBe(0.6);
    expect(slotStatMultForItem(TRINKET)).toBeUndefined();
    expect(primaryStatBudget(20, 'epic', TRINKET.slot, slotStatMultForItem(TRINKET))).toBe(8);
    expect(primaryStatBudget(20, 'rare', TRINKET.slot)).toBe(7);
  });

  it('extends the live slots without changing launch completion requirements', () => {
    expect(ALL_EQUIP_SLOTS.filter((slot) => slot === 'trinket')).toEqual(['trinket']);
    expect(isEquipSlot('trinket')).toBe(true);
    expect(isEquipSlot('trinket2')).toBe(false);
    expect(LAUNCH_PAPERDOLL_SLOTS).not.toContain('trinket');
    expect(resolveEquipSlot(TRINKET, {})).toBe('trinket');
    for (const cls of ALL_CLASSES) expect(canEquipItem(cls, TRINKET)).toBe(true);
    for (const slot of ALL_EQUIP_SLOTS) {
      expect(slotAcceptsItem(TRINKET, slot)).toBe(slot === 'trinket');
    }
    expect(slotAcceptsItem(ITEMS.seal_of_the_nine_oaths, 'trinket')).toBe(false);
    expect(slotAcceptsItem(ITEMS.training_mace, 'trinket')).toBe(false);
  });

  it('equips from bags, applies passive stats, replaces and unequips without losing copies', () => {
    const sim = makeSim();
    const before = { ...sim.player.stats };
    sim.addItem(TRINKET.id, 1);
    sim.addItem(SECOND.id, 1);
    sim.equipItem(TRINKET.id);
    expect(sim.equipment.trinket).toBe(TRINKET.id);
    expect(sim.countItem(TRINKET.id)).toBe(0);
    expect(sim.player.stats.str).toBe(before.str + 7);
    expect(sim.player.stats.sta).toBe(before.sta + 4);
    sim.equipItemToSlot(SECOND.id, 'trinket');
    expect(sim.equipment.trinket).toBe(SECOND.id);
    expect(sim.countItem(TRINKET.id)).toBe(1);
    expect(sim.unequipItem('trinket')).toBe(true);
    expect(sim.equipment.trinket).toBeUndefined();
    expect(sim.countItem(SECOND.id)).toBe(1);
    expect(sim.player.stats).toEqual(before);
  });

  it('refuses mismatched slots and below-level equip without consuming inventory', () => {
    const sim = new Sim({ seed: 7, playerClass: 'mage' });
    sim.addItem(TRINKET.id, 1);
    sim.equipItem(TRINKET.id);
    expect(sim.equipment.trinket).toBeUndefined();
    sim.setPlayerLevel(20);
    sim.equipItemToSlot(TRINKET.id, 'neck');
    expect(sim.equipment.trinket).toBeUndefined();
    expect(sim.countItem(TRINKET.id)).toBe(1);
    sim.equipItemToSlot(TRINKET.id, 'trinket');
    expect(sim.equipment.trinket).toBe(TRINKET.id);
  });

  it('round-trips equipped per-copy payload and restores its stats through character saves', () => {
    const sim = makeSim();
    sim.addItem(TRINKET.id, 1);
    const bag = sim.inventory.find((row) => row.itemId === TRINKET.id)!;
    bag.instance = { signer: 'Test Smith', rolled: { stats: { str: 11, sta: 6 } } };
    sim.equipItem(TRINKET.id);
    const state = sim.serializeCharacter(sim.player.id)!;
    expect(state.equipment.trinket).toBe(TRINKET.id);
    expect(state.equipmentInstance?.trinket).toEqual(bag.instance);
    const loaded = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = loaded.addPlayer('warrior', 'Reloaded', {
      state: JSON.parse(JSON.stringify(state)),
    });
    expect(loaded.meta(pid)?.equipment.trinket).toBe(TRINKET.id);
    expect(loaded.meta(pid)?.equipmentInstance?.trinket).toEqual(bag.instance);
    expect(loaded.entities.get(pid)?.stats).toEqual(sim.player.stats);
    expect(loaded.unequipItem('trinket', pid)).toBe(true);
    expect(loaded.meta(pid)?.inventory.find((row) => row.itemId === TRINKET.id)?.instance).toEqual(
      bag.instance,
    );
  });

  it('loads an existing save with no trinket without inventing gear or changing stats', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.player.id)!;
    expect(state.equipment).not.toHaveProperty('trinket');
    const loaded = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = loaded.addPlayer('warrior', 'Legacy', { state });
    expect(loaded.meta(pid)?.equipment).toEqual(state.equipment);
    expect(loaded.entities.get(pid)?.stats).toEqual(sim.player.stats);
  });

  it('preserves the legacy payload alias and keeps save size bounded across reloads', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.player.id)!;
    // Measure the persisted equipment surface, excluding unrelated join-time
    // normalization (deeds and ledger metadata can grow on a first reload).
    const bytes = (value: typeof state) =>
      Buffer.byteLength(
        JSON.stringify({
          equipment: value.equipment,
          instances: value.equipmentInstance ?? value.equipmentInstances,
        }),
        'utf8',
      );
    const before = bytes(state);
    state.equipment.trinket = TRINKET.id;
    state.equipmentInstances = { trinket: { signer: 'Test Smith' } };
    delete state.equipmentInstance;
    expect(bytes(state) - before).toBeLessThan(200);
    let saved = state;
    let stableBytes = 0;
    for (let pass = 0; pass < 3; pass++) {
      const loaded = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
      const pid = loaded.addPlayer('warrior', 'Reloaded', { state: saved });
      saved = loaded.serializeCharacter(pid)!;
      expect(saved.equipmentInstance?.trinket).toEqual({ signer: 'Test Smith' });
      expect(bytes(saved) - before).toBeLessThan(200);
      if (pass > 0) expect(bytes(saved)).toBe(stableBytes);
      stableBytes = bytes(saved);
    }
  });

  it('captures a trinket in a loadout and resolves its exact copy from bags', () => {
    const payload = { signer: 'Test Smith' };
    const set = buildGearSet({ trinket: TRINKET.id }, { trinket: payload });
    const plan = planGearSwap(set, [{ itemId: TRINKET.id, count: 1, instance: payload }], {}, {});
    expect(plan.equips).toHaveLength(1);
    expect(plan.equips[0]).toMatchObject({ slot: 'trinket', itemId: TRINKET.id });
    expect(plan.unavailable).toEqual([]);
  });
});
