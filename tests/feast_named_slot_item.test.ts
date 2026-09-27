// A NAMED place_feast places the feast that sits in the named slot.
//
// The bags window classifies EVERY `item.feast` as the placeFeast verb and
// sends the dedicated `place_feast` command with the clicked slot (no item
// id). The sim resolved that slot against the PARTY feast id, so a clicked
// apex feast (Sageleaf, Stonepot, Warspice) never matched its own slot and
// the player saw "You have no feast to set out" with the feast in bags.
// The bare (slot-less) command keeps its pinned meaning: it places a
// harvest_feast and can never place an apex feast.
import { describe, expect, it } from 'vitest';
import { FARM_FEAST_ITEM_ID, feastItemIdAtSlot } from '../src/sim/professions/feast';
import { Sim } from '../src/sim/sim';
import { EMPTY_TEST_WORLD } from './sim_shared';

const APEX_FEASTS = ['sageleaf_feast', 'stonepot_feast', 'warspice_feast'] as const;

function rig() {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    world: EMPTY_TEST_WORLD,
  });
  const pid = sim.addPlayer('warrior', 'Cook');
  sim.setPlayerLevel(20, pid);
  return { sim, pid };
}

function placedFeasts(sim: Sim, from: number) {
  return sim.events.slice(from).filter((e) => e.type === 'farmFeastPlaced');
}

function denials(sim: Sim, from: number) {
  return sim.events
    .slice(from)
    .filter((e) => e.type === 'farmDenied')
    .map((e) => (e as { reason: string }).reason);
}

describe('placeFeast with a named slot', () => {
  it.each(APEX_FEASTS)('places the %s copy the player clicked and spends it', (feastId) => {
    const { sim, pid } = rig();
    sim.addItem(feastId, 1, pid);
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('player meta missing');
    const slotIndex = meta.inventory.findIndex((s) => s.itemId === feastId);
    expect(slotIndex).toBeGreaterThanOrEqual(0);
    const from = sim.events.length;
    sim.placeFeast(pid, slotIndex);
    expect(denials(sim, from)).toEqual([]);
    const placed = placedFeasts(sim, from);
    expect(placed).toHaveLength(1);
    const entity = sim.entities.get(placed[0].feastId);
    expect(entity?.templateId).toBe(feastId);
    expect(sim.countItem(feastId, pid)).toBe(0);
  });

  it('a named apex slot never spends a party feast held elsewhere in the bags', () => {
    const { sim, pid } = rig();
    sim.addItem(FARM_FEAST_ITEM_ID, 1, pid);
    sim.addItem('sageleaf_feast', 1, pid);
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('player meta missing');
    const slotIndex = meta.inventory.findIndex((s) => s.itemId === 'sageleaf_feast');
    const from = sim.events.length;
    sim.placeFeast(pid, slotIndex);
    const placed = placedFeasts(sim, from);
    expect(placed).toHaveLength(1);
    expect(sim.entities.get(placed[0].feastId)?.templateId).toBe('sageleaf_feast');
    expect(sim.countItem(FARM_FEAST_ITEM_ID, pid)).toBe(1);
    expect(sim.countItem('sageleaf_feast', pid)).toBe(0);
  });

  it('a BARE placeFeast still places only the party feast, never an apex feast', () => {
    const { sim, pid } = rig();
    sim.addItem('sageleaf_feast', 1, pid);
    const from = sim.events.length;
    sim.placeFeast(pid);
    expect(placedFeasts(sim, from)).toHaveLength(0);
    expect(denials(sim, from)).toEqual(['no_feast']);
    expect(sim.countItem('sageleaf_feast', pid)).toBe(1);
  });

  it('a named slot holding a non-feast item is refused, nothing is spent', () => {
    const { sim, pid } = rig();
    sim.addItem(FARM_FEAST_ITEM_ID, 1, pid);
    sim.addItem('sageleaf_chowder', 1, pid);
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('player meta missing');
    const slotIndex = meta.inventory.findIndex((s) => s.itemId === 'sageleaf_chowder');
    const from = sim.events.length;
    sim.placeFeast(pid, slotIndex);
    expect(placedFeasts(sim, from)).toHaveLength(0);
    expect(denials(sim, from)).toEqual(['no_feast']);
    expect(sim.countItem(FARM_FEAST_ITEM_ID, pid)).toBe(1);
    expect(sim.countItem('sageleaf_chowder', pid)).toBe(1);
  });
});

describe('feastItemIdAtSlot', () => {
  it('resolves the feast id in the slot, and the party feast for anything else', () => {
    const inv = [{ itemId: 'sageleaf_feast' }, { itemId: 'sageleaf_chowder' }, { itemId: '' }];
    expect(feastItemIdAtSlot(inv, 0)).toBe('sageleaf_feast');
    expect(feastItemIdAtSlot(inv, 1)).toBe(FARM_FEAST_ITEM_ID);
    expect(feastItemIdAtSlot(inv, 2)).toBe(FARM_FEAST_ITEM_ID);
    expect(feastItemIdAtSlot(inv, undefined)).toBe(FARM_FEAST_ITEM_ID);
    expect(feastItemIdAtSlot(inv, 99)).toBe(FARM_FEAST_ITEM_ID);
    expect(feastItemIdAtSlot(inv, -1)).toBe(FARM_FEAST_ITEM_ID);
  });
});
