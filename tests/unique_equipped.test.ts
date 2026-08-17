import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import {
  isUniqueEquipped,
  uniqueEquipConflictSlot,
  uniqueEquipFamily,
} from '../src/sim/equipment_rules';
import { Sim } from '../src/sim/sim';
import type { ItemDef } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

// Legendary items are unique-equipped: a character may wear at most one copy of
// a given legendary FAMILY at a time (rings, dual-wield hands), where a heroic
// upgrade variant (heroicOf) belongs to its base item's family. Non-legendary
// duplicates (the Titan Grip same-id greatsword pair) stay legal, and the rule
// is per family: two DIFFERENT legendaries may be worn together.

const UNIQUE_ERROR = 'You can only equip one of those.';

// Synthetic legendaries for the slot shapes no shipped legendary covers yet: a
// ring (two interchangeable sockets) and a warrior-usable two-hander (the Titan
// Grip interaction). Injected into the live ITEMS table like other suites do
// (grant_line_view, combat_rating) and removed after.
const RING_ID = 'test_unique_band';
const TWOHAND_ID = 'test_worldsplitter';

beforeAll(() => {
  ITEMS[RING_ID] = {
    id: RING_ID,
    name: 'Test Unique Band',
    kind: 'armor',
    slot: 'ring',
    quality: 'legendary',
    requiredLevel: 20,
    stats: { sta: 1 },
    sellValue: 1,
  } as ItemDef;
  ITEMS[TWOHAND_ID] = {
    id: TWOHAND_ID,
    name: 'Test Worldsplitter',
    kind: 'weapon',
    slot: 'mainhand',
    hand: 'twohand',
    quality: 'legendary',
    requiredLevel: 20,
    weapon: { min: 10, max: 20, speed: 3.0 },
    requiredClass: ['warrior', 'rogue', 'hunter', 'shaman', 'paladin'],
    stats: { str: 1 },
    sellValue: 1,
  } as ItemDef;
});

afterAll(() => {
  delete ITEMS[RING_ID];
  delete ITEMS[TWOHAND_ID];
});

function addWithoutAutoEquip(sim: Sim, itemId: string, count = 1): void {
  const meta = sim.meta(sim.player.id)!;
  meta.autoEquip = false;
  sim.addItem(itemId, count);
}

function makeFuryWarrior(seed: number): Sim {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true, world: EMPTY_TEST_WORLD });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('fury')).toBe(true);
  return sim;
}

describe('unique-equipped pure rules (equipment_rules)', () => {
  const legendaryRing: ItemDef = {
    id: 'pure_legendary_ring',
    name: 'Pure Legendary Ring',
    kind: 'armor',
    slot: 'ring',
    quality: 'legendary',
    stats: {},
    sellValue: 1,
  } as ItemDef;
  const epicRing: ItemDef = { ...legendaryRing, id: 'pure_epic_ring', quality: 'epic' } as ItemDef;
  const heroicRing: ItemDef = {
    ...legendaryRing,
    id: 'heroic_pure_legendary_ring',
    heroicOf: 'pure_legendary_ring',
  } as ItemDef;
  const defs: Record<string, ItemDef> = {
    pure_legendary_ring: legendaryRing,
    pure_epic_ring: epicRing,
    heroic_pure_legendary_ring: heroicRing,
  };
  const lookup = (id: string) => defs[id];

  it('classifies every legendary as unique-equipped and nothing else', () => {
    expect(isUniqueEquipped(legendaryRing)).toBe(true);
    expect(isUniqueEquipped(epicRing)).toBe(false);
    expect(isUniqueEquipped({ ...epicRing, quality: undefined } as ItemDef)).toBe(false);
  });

  it('keys a heroic variant to its base family', () => {
    expect(uniqueEquipFamily(heroicRing)).toBe('pure_legendary_ring');
    expect(uniqueEquipFamily(legendaryRing)).toBe('pure_legendary_ring');
  });

  it('reports the worn slot holding a duplicate legendary', () => {
    const equipment = { ring1: 'pure_legendary_ring' };
    expect(uniqueEquipConflictSlot(legendaryRing, equipment, lookup, ['ring2'])).toBe('ring1');
  });

  it('treats the heroic variant of a worn legendary as the same item', () => {
    const equipment = { ring1: 'pure_legendary_ring' };
    expect(uniqueEquipConflictSlot(heroicRing, equipment, lookup, ['ring2'])).toBe('ring1');
    const heroicWorn = { ring1: 'heroic_pure_legendary_ring' };
    expect(uniqueEquipConflictSlot(legendaryRing, heroicWorn, lookup, ['ring2'])).toBe('ring1');
  });

  it('ignores the target slot itself so an in-place replace stays legal', () => {
    const equipment = { ring1: 'pure_legendary_ring' };
    expect(uniqueEquipConflictSlot(legendaryRing, equipment, lookup, ['ring1'])).toBeNull();
  });

  it('ignores a slot this equip displaces', () => {
    const equipment = { mainhand: 'pure_legendary_ring', offhand: 'other' };
    expect(
      uniqueEquipConflictSlot(legendaryRing, equipment, lookup, ['offhand', 'mainhand']),
    ).toBeNull();
  });

  it('never conflicts for a non-legendary duplicate or a different id', () => {
    expect(uniqueEquipConflictSlot(epicRing, { ring1: 'pure_epic_ring' }, lookup, ['ring2'])).toBe(
      null,
    );
    expect(
      uniqueEquipConflictSlot(legendaryRing, { ring1: 'pure_epic_ring' }, lookup, ['ring2']),
    ).toBeNull();
  });
});

describe('unique-equipped enforcement (equipItem)', () => {
  it('refuses a second worn copy of the same legendary weapon', () => {
    const sim = makeFuryWarrior(9001);
    addWithoutAutoEquip(sim, 'kingsbane_last_oath', 2);

    sim.equipItemToSlot('kingsbane_last_oath', 'mainhand');
    expect(sim.equipment.mainhand).toBe('kingsbane_last_oath');
    sim.tick();

    // The click path routes a Fury one-hander to the offhand, which would be
    // the second worn copy.
    const offhandBefore = sim.equipment.offhand;
    sim.equipItem('kingsbane_last_oath');
    const events = sim.tick();
    expect(events.some((e) => e.type === 'error' && e.text === UNIQUE_ERROR)).toBe(true);
    expect(sim.equipment.offhand).toBe(offhandBefore);
    expect(sim.countItem('kingsbane_last_oath')).toBe(1);
  });

  it('refuses an aimed-slot duplicate too', () => {
    const sim = makeFuryWarrior(9002);
    addWithoutAutoEquip(sim, 'kingsbane_last_oath', 2);

    sim.equipItemToSlot('kingsbane_last_oath', 'mainhand');
    sim.tick();
    const offhandBefore = sim.equipment.offhand;
    sim.equipItemToSlot('kingsbane_last_oath', 'offhand');
    const events = sim.tick();

    expect(events.some((e) => e.type === 'error' && e.text === UNIQUE_ERROR)).toBe(true);
    expect(sim.equipment.offhand).toBe(offhandBefore);
  });

  it('refuses the heroic variant of a worn legendary (same family)', () => {
    const sim = makeFuryWarrior(9010);
    addWithoutAutoEquip(sim, 'kingsbane_last_oath');
    addWithoutAutoEquip(sim, 'heroic_kingsbane_last_oath');

    sim.equipItemToSlot('kingsbane_last_oath', 'mainhand');
    sim.tick();
    sim.equipItemToSlot('heroic_kingsbane_last_oath', 'offhand');
    const events = sim.tick();

    expect(events.some((e) => e.type === 'error' && e.text === UNIQUE_ERROR)).toBe(true);
    expect(sim.equipment.mainhand).toBe('kingsbane_last_oath');
    expect(sim.countItem('heroic_kingsbane_last_oath')).toBe(1);
  });

  it('refuses a Titan Grip pair of the same legendary two-hander', () => {
    const sim = makeFuryWarrior(9011);
    addWithoutAutoEquip(sim, TWOHAND_ID, 2);

    sim.equipItem(TWOHAND_ID);
    expect(sim.equipment.mainhand).toBe(TWOHAND_ID);
    sim.tick();
    // The click path routes the second two-hander to the Titan Grip offhand,
    // which the unique rule refuses (nothing is displaced in a titan pair).
    sim.equipItem(TWOHAND_ID);
    const events = sim.tick();

    expect(events.some((e) => e.type === 'error' && e.text === UNIQUE_ERROR)).toBe(true);
    expect(sim.equipment.offhand).toBeUndefined();
    expect(sim.countItem(TWOHAND_ID)).toBe(1);
  });

  it('refuses the second copy of a legendary ring on the free finger', () => {
    const sim = makeFuryWarrior(9012);
    addWithoutAutoEquip(sim, RING_ID, 2);

    sim.equipItem(RING_ID);
    expect(sim.equipment.ring1).toBe(RING_ID);
    sim.tick();
    // The click path resolves the empty ring2 socket; the aimed path targets it
    // directly. Both must refuse the duplicate.
    sim.equipItem(RING_ID);
    let events = sim.tick();
    expect(events.some((e) => e.type === 'error' && e.text === UNIQUE_ERROR)).toBe(true);
    expect(sim.equipment.ring2).toBeUndefined();

    sim.equipItemToSlot(RING_ID, 'ring2');
    events = sim.tick();
    expect(events.some((e) => e.type === 'error' && e.text === UNIQUE_ERROR)).toBe(true);
    expect(sim.equipment.ring2).toBeUndefined();
    expect(sim.countItem(RING_ID)).toBe(1);
  });

  it('allows two different legendaries worn together', () => {
    const sim = makeFuryWarrior(9003);
    addWithoutAutoEquip(sim, 'kingsbane_last_oath');
    addWithoutAutoEquip(sim, 'voidsong_dirk');

    sim.equipItemToSlot('kingsbane_last_oath', 'mainhand');
    sim.equipItem('voidsong_dirk');

    expect(sim.equipment.mainhand).toBe('kingsbane_last_oath');
    expect(sim.equipment.offhand).toBe('voidsong_dirk');
  });

  it('allows replacing a worn legendary with another copy in the same slot', () => {
    const sim = makeFuryWarrior(9004);
    addWithoutAutoEquip(sim, 'kingsbane_last_oath', 2);

    sim.equipItemToSlot('kingsbane_last_oath', 'mainhand');
    sim.tick();
    sim.equipItemToSlot('kingsbane_last_oath', 'mainhand');
    const events = sim.tick();

    expect(events.some((e) => e.type === 'error' && e.text === UNIQUE_ERROR)).toBe(false);
    expect(sim.equipment.mainhand).toBe('kingsbane_last_oath');
    expect(sim.countItem('kingsbane_last_oath')).toBe(1);
  });

  it('keeps a non-legendary same-id Titan Grip pair legal', () => {
    const sim = makeFuryWarrior(9005);
    addWithoutAutoEquip(sim, 'eastbrook_greatsword', 2);

    sim.equipItem('eastbrook_greatsword');
    sim.equipItem('eastbrook_greatsword');

    expect(sim.equipment.mainhand).toBe('eastbrook_greatsword');
    expect(sim.equipment.offhand).toBe('eastbrook_greatsword');
  });

  it('auto-equip skips a duplicate legendary silently', () => {
    const sim = makeFuryWarrior(9013);
    // autoEquip stays on: the first ring auto-equips into the empty ring1, the
    // second copy must be skipped with no refusal toast (auto-equip is a
    // convenience; the explicit equip path owns the error).
    sim.addItem(RING_ID, 1);
    sim.tick();
    expect(sim.equipment.ring1).toBe(RING_ID);

    sim.addItem(RING_ID, 1);
    const events = sim.tick();
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(sim.equipment.ring2).toBeUndefined();
    expect(sim.countItem(RING_ID)).toBe(1);
  });
});

describe('unique-equipped load-time demotion', () => {
  it('benches a persisted duplicate legendary into the bags on load, and says so', () => {
    const sim = makeFuryWarrior(9006);
    const state = sim.serializeCharacter(sim.playerId)!;
    state.equipment.mainhand = 'kingsbane_last_oath';
    state.equipment.offhand = 'kingsbane_last_oath';

    const sim2 = new Sim({
      seed: 9007,
      playerClass: 'warrior',
      noPlayer: true,
      world: EMPTY_TEST_WORLD,
    });
    const pid = sim2.addPlayer('warrior', 'Restored', { state });
    const meta = sim2.meta(pid)!;

    expect(meta.equipment.mainhand).toBe('kingsbane_last_oath');
    expect(meta.equipment.offhand).toBeUndefined();
    expect(sim2.countItem('kingsbane_last_oath', pid)).toBe(1);
    // The player is told, with the same line the respec bench uses.
    const events = sim2.tick();
    const expected = `Unequipped ${ITEMS.kingsbane_last_oath.name}.`;
    expect(events.some((e) => e.type === 'log' && e.text === expected && e.pid === pid)).toBe(true);
  });

  it('benches a persisted heroic duplicate of the same family', () => {
    const sim = makeFuryWarrior(9014);
    const state = sim.serializeCharacter(sim.playerId)!;
    state.equipment.mainhand = 'kingsbane_last_oath';
    state.equipment.offhand = 'heroic_kingsbane_last_oath';

    const sim2 = new Sim({
      seed: 9015,
      playerClass: 'warrior',
      noPlayer: true,
      world: EMPTY_TEST_WORLD,
    });
    const pid = sim2.addPlayer('warrior', 'Restored', { state });
    const meta = sim2.meta(pid)!;

    expect(meta.equipment.mainhand).toBe('kingsbane_last_oath');
    expect(meta.equipment.offhand).toBeUndefined();
    expect(sim2.countItem('heroic_kingsbane_last_oath', pid)).toBe(1);
  });

  it('keeps the worn instance payload and moves the benched one into the bag row', () => {
    const sim = makeFuryWarrior(9016);
    const state = sim.serializeCharacter(sim.playerId)!;
    state.equipment.mainhand = 'kingsbane_last_oath';
    state.equipment.offhand = 'kingsbane_last_oath';
    state.equipmentInstance = {
      mainhand: { enchant: 'ench_keep' },
      offhand: { enchant: 'ench_bench' },
    };

    const sim2 = new Sim({
      seed: 9017,
      playerClass: 'warrior',
      noPlayer: true,
      world: EMPTY_TEST_WORLD,
    });
    const pid = sim2.addPlayer('warrior', 'Restored', { state });
    const meta = sim2.meta(pid)!;

    expect(meta.equipmentInstance.mainhand?.enchant).toBe('ench_keep');
    expect(meta.equipmentInstance.offhand).toBeUndefined();
    const benched = meta.inventory.find(
      (s) => s.itemId === 'kingsbane_last_oath' && s.instance?.enchant === 'ench_bench',
    );
    expect(benched).toBeDefined();
  });

  it('loads two different persisted legendaries untouched', () => {
    const sim = makeFuryWarrior(9008);
    const state = sim.serializeCharacter(sim.playerId)!;
    state.equipment.mainhand = 'kingsbane_last_oath';
    state.equipment.offhand = 'voidsong_dirk';

    const sim2 = new Sim({
      seed: 9009,
      playerClass: 'warrior',
      noPlayer: true,
      world: EMPTY_TEST_WORLD,
    });
    const pid = sim2.addPlayer('warrior', 'Restored', { state });
    const meta = sim2.meta(pid)!;

    expect(meta.equipment.mainhand).toBe('kingsbane_last_oath');
    expect(meta.equipment.offhand).toBe('voidsong_dirk');
    expect(sim2.countItem('kingsbane_last_oath', pid)).toBe(0);
  });
});
