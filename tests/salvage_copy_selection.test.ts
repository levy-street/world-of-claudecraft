// Salvage consumes the copy the player SELECTED, not a guessed one.
//
// The reported symptom: destroying an item takes "the most recent one in your
// bag" rather than the one you clicked. Salvage was the live case. It sat next to
// disenchant in the same context menu (`src/ui/bag_item_action_menu.ts`), both
// irreversible, and disenchant passed the bag index while salvage dropped it:
//
//   if (slotIndex === undefined) world.disenchantItem(itemId);
//   else world.disenchantItem(itemId, { slotIndex });   // precise
//   } else world.salvageItem(itemId);                   // guessed
//
// So the same click destroyed a chosen copy through one row and an arbitrary one
// through the other. These tests pin all four arms of the fix: a selection is
// honored, an id-only call keeps its legacy behavior, an invalid selection is
// refused BEFORE the cast starts, and a bag that shifts mid-cast refuses rather
// than salvaging whatever slid into the pinned index.

import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { ItemInstancePayload, SimEvent } from '../src/sim/types';
import { completeEnchantFamilyCast } from './helpers/enchant_family_cast';

/** A salvageable common weapon, the fixture the sibling suites use. */
const COMMON_WEAPON = 'eastbrook_arming_sword';

function makeSim(): Sim {
  return new Sim({ seed: 7, playerClass: 'warrior', autoEquip: false });
}

/** Give the player two copies of one id: an INSTANCED one first, then a plain
 *  one, so "the copy the player chose" and "the newest copy" are different
 *  objects. Without this shape every assertion below would be vacuous. */
function twoCopies(sim: Sim, pid: number): { instancedIndex: number } {
  const meta = sim.players.get(pid);
  if (!meta) throw new Error('no meta');
  meta.inventory.length = 0;
  meta.inventory.push({
    itemId: COMMON_WEAPON,
    count: 1,
    instance: { enchantId: 'ench_test' } as unknown as ItemInstancePayload,
  });
  meta.inventory.push({ itemId: COMMON_WEAPON, count: 1 });
  return { instancedIndex: 0 };
}

function salvageResults(events: SimEvent[]) {
  return events.filter((e): e is Extract<SimEvent, { type: 'salvageResult' }> => {
    return e.type === 'salvageResult';
  });
}

function inventoryOf(sim: Sim, pid: number) {
  return sim.players.get(pid)?.inventory ?? [];
}

describe('salvage consumes the selected copy', () => {
  it('destroys the NAMED slot, leaving the newest copy alone', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const { instancedIndex } = twoCopies(sim, pid);
    sim.drainEvents();

    sim.salvageItem(COMMON_WEAPON, pid, instancedIndex);
    completeEnchantFamilyCast(sim, pid);
    const results = salvageResults(sim.drainEvents());
    expect(results).toHaveLength(1);
    expect(results[0].ok, 'a valid selection salvages').toBe(true);

    // The instanced copy is gone and the plain one survives. Under the old
    // behavior this was reversed.
    const left = inventoryOf(sim, pid).filter((s) => s.itemId === COMMON_WEAPON);
    expect(left).toHaveLength(1);
    expect(left[0].instance, 'the plain copy is what should remain').toBeUndefined();
  });

  it('keeps the legacy prefer-plain walk for an id-only call', () => {
    // Deliberately unchanged. server/pbe_boost.ts and the RL host call by bare
    // id, and the parity goldens drive this arm, so "improving" it forks the
    // world. Salvage's legacy rule prefers a PLAIN copy so an instanced one is
    // never destroyed while an interchangeable shell exists.
    const sim = makeSim();
    const pid = sim.playerId;
    twoCopies(sim, pid);
    sim.drainEvents();

    sim.salvageItem(COMMON_WEAPON, pid);
    completeEnchantFamilyCast(sim, pid);
    expect(salvageResults(sim.drainEvents())[0]?.ok).toBe(true);

    const left = inventoryOf(sim, pid).filter((s) => s.itemId === COMMON_WEAPON);
    expect(left).toHaveLength(1);
    expect(left[0].instance, 'the legacy walk spares the instanced copy').toBeDefined();
  });

  it('refuses an out-of-range selection without starting a cast', () => {
    // A stale or hand-crafted frame. Refusing beats falling back to a guess:
    // the player believes they aimed, so guessing destroys the wrong item under
    // the appearance of a deliberate choice.
    const sim = makeSim();
    const pid = sim.playerId;
    twoCopies(sim, pid);
    sim.drainEvents();

    sim.salvageItem(COMMON_WEAPON, pid, 99);
    const results = salvageResults(sim.drainEvents());
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].reason).toBe('not_held');
    // Nothing was destroyed and no cast is running.
    expect(inventoryOf(sim, pid).filter((s) => s.itemId === COMMON_WEAPON)).toHaveLength(2);
  });

  it('refuses when the bag shifts under the selection mid-cast', () => {
    // The pin's reason to exist. A bag index is stable only within one tick, so
    // a loot or a sort during the cast would otherwise redirect the hit.
    const sim = makeSim();
    const pid = sim.playerId;
    const { instancedIndex } = twoCopies(sim, pid);
    sim.drainEvents();

    sim.salvageItem(COMMON_WEAPON, pid, instancedIndex);
    // The chosen copy moves away and a DIFFERENT copy takes its index.
    const inv = inventoryOf(sim, pid);
    inv[instancedIndex] = { itemId: COMMON_WEAPON, count: 1 };
    completeEnchantFamilyCast(sim, pid);

    const results = salvageResults(sim.drainEvents());
    expect(results).toHaveLength(1);
    expect(results[0].ok, 'a shifted bag must refuse, not salvage the intruder').toBe(false);
    expect(results[0].reason).toBe('not_held');
    expect(inventoryOf(sim, pid).filter((s) => s.itemId === COMMON_WEAPON)).toHaveLength(2);
  });
});
