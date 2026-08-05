import { describe, expect, it } from 'vitest';
import { isUniqueEquipped, uniqueEquipConflictSlot } from '../src/sim/equipment_rules';
import { Sim } from '../src/sim/sim';
import type { ItemDef } from '../src/sim/types';

// Legendary items are unique-equipped: a character may wear at most one copy of
// a given legendary item id at a time (rings, dual-wield hands). Non-legendary
// duplicates (the Titan Grip same-id greatsword pair) stay legal, and the rule
// is per item id: two DIFFERENT legendaries may be worn together.

const UNIQUE_ERROR = 'You can only equip one of those.';

function addWithoutAutoEquip(sim: Sim, itemId: string, count = 1): void {
  const meta = sim.meta(sim.player.id)!;
  meta.autoEquip = false;
  sim.addItem(itemId, count);
}

function makeFuryWarrior(seed: number): Sim {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('fury')).toBe(true);
  return sim;
}

describe('unique-equipped pure rules (equipment_rules)', () => {
  const legendaryRing: ItemDef = {
    id: 'test_legendary_ring',
    name: 'Test Legendary Ring',
    kind: 'armor',
    slot: 'ring',
    quality: 'legendary',
    stats: {},
    sellValue: 1,
  } as ItemDef;
  const epicRing: ItemDef = { ...legendaryRing, id: 'test_epic_ring', quality: 'epic' } as ItemDef;

  it('classifies every legendary as unique-equipped and nothing else', () => {
    expect(isUniqueEquipped(legendaryRing)).toBe(true);
    expect(isUniqueEquipped(epicRing)).toBe(false);
    expect(isUniqueEquipped({ ...epicRing, quality: undefined } as ItemDef)).toBe(false);
  });

  it('reports the worn slot holding a duplicate legendary', () => {
    const equipment = { ring1: 'test_legendary_ring' };
    expect(uniqueEquipConflictSlot(legendaryRing, equipment, ['ring2'])).toBe('ring1');
  });

  it('ignores the target slot itself so an in-place replace stays legal', () => {
    const equipment = { ring1: 'test_legendary_ring' };
    expect(uniqueEquipConflictSlot(legendaryRing, equipment, ['ring1'])).toBeNull();
  });

  it('ignores a slot this equip displaces', () => {
    const equipment = { mainhand: 'test_legendary_ring', offhand: 'other' };
    expect(uniqueEquipConflictSlot(legendaryRing, equipment, ['offhand', 'mainhand'])).toBeNull();
  });

  it('never conflicts for a non-legendary duplicate or a different id', () => {
    expect(uniqueEquipConflictSlot(epicRing, { ring1: 'test_epic_ring' }, ['ring2'])).toBeNull();
    expect(
      uniqueEquipConflictSlot(legendaryRing, { ring1: 'test_epic_ring' }, ['ring2']),
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
});

describe('unique-equipped load-time demotion', () => {
  it('benches a persisted duplicate legendary into the bags on load', () => {
    const sim = makeFuryWarrior(9006);
    const state = sim.serializeCharacter(sim.playerId)!;
    state.equipment.mainhand = 'kingsbane_last_oath';
    state.equipment.offhand = 'kingsbane_last_oath';

    const sim2 = new Sim({ seed: 9007, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Restored', { state });
    const meta = sim2.meta(pid)!;

    expect(meta.equipment.mainhand).toBe('kingsbane_last_oath');
    expect(meta.equipment.offhand).toBeUndefined();
    expect(sim2.countItem('kingsbane_last_oath', pid)).toBe(1);
  });

  it('loads two different persisted legendaries untouched', () => {
    const sim = makeFuryWarrior(9008);
    const state = sim.serializeCharacter(sim.playerId)!;
    state.equipment.mainhand = 'kingsbane_last_oath';
    state.equipment.offhand = 'voidsong_dirk';

    const sim2 = new Sim({ seed: 9009, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Restored', { state });
    const meta = sim2.meta(pid)!;

    expect(meta.equipment.mainhand).toBe('kingsbane_last_oath');
    expect(meta.equipment.offhand).toBe('voidsong_dirk');
    expect(sim2.countItem('kingsbane_last_oath', pid)).toBe(0);
  });
});
