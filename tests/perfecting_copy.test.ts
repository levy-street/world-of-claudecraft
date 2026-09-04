import { describe, expect, it } from 'vitest';
import { parsePerfectItemRef } from '../server/perfect_item_ref';
import { fingerprint128 } from '../src/sim/fingerprint128';
import { baggedCopyAnchor } from '../src/sim/item_copy_anchor';
import { itemCopyPin } from '../src/sim/item_copy_ref';
import { sanitizeItemInstancePayloadOnLoad } from '../src/sim/item_instance_load';
import {
  PERFECTING_ATTEMPT_COST,
  PERFECTING_SKILL_REQ,
  type PerfectItemRef,
} from '../src/sim/professions/perfecting';
import { capturePerfectItemRef } from '../src/sim/professions/perfecting_copy';
import { Sim } from '../src/sim/sim';
import type { InvSlot } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

const APEX = 'wyrmfall_pendant';

function setup(perfected = false) {
  const sim = new Sim({
    seed: 5,
    playerClass: 'warrior',
    autoEquip: false,
    world: EMPTY_TEST_WORLD,
  });
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('test player missing');
  meta.inventory.length = 0;
  meta.craftSkills.jewelcrafting = PERFECTING_SKILL_REQ;
  meta.inventory.push({ itemId: 'linen_cloth', count: 1 });
  for (const cost of PERFECTING_ATTEMPT_COST) {
    meta.inventory.push({ itemId: cost.itemId, count: cost.count });
  }
  meta.inventory.push({ itemId: 'deed_of_making', count: 1 });
  const selected: InvSlot = {
    itemId: APEX,
    count: 1,
    instance: { signer: 'First', ...(perfected ? { perfected: true } : {}) },
  };
  const sibling: InvSlot = {
    itemId: APEX,
    count: 1,
    instance: { signer: 'Second', ...(perfected ? { perfected: true } : {}) },
  };
  meta.inventory.push(selected, sibling);
  const bag = meta.inventory.indexOf(selected);
  const anchor = baggedCopyAnchor(meta.inventory, APEX, bag);
  if (!anchor) throw new Error('selected copy missing');
  const copy = { pin: fingerprint128(itemCopyPin(selected)), anchor };
  const ref = { bag, itemId: APEX, copy };
  let draws = 0;
  sim.rng.next = () => {
    draws++;
    return 0;
  };
  return { sim, meta, selected, sibling, ref, draws: () => draws };
}

describe('Perfecting captured copy validation', () => {
  it.each([false, true])(
    'accepts large retained payloads and rejects changed unknown data (changed=%s)',
    (changed) => {
      const { sim, meta, selected, sibling, ref, draws } = setup();
      const sanitized = sanitizeItemInstancePayloadOnLoad({
        rolled: Object.fromEntries(
          Array.from({ length: 9 }, (_, i) => [`future_${i}`, { data: 'x'.repeat(990) }]),
        ),
      });
      expect(sanitized.dropped).toEqual([]);
      selected.instance = sanitized.payload;
      expect(itemCopyPin(selected).length).toBeGreaterThan(8192);
      const captured = capturePerfectItemRef(
        {
          inventory: meta.inventory,
          equipment: meta.equipment,
          equipmentInstances: meta.equipmentInstance,
        },
        { bag: ref.bag, itemId: APEX },
      );
      const parsed = parsePerfectItemRef({ bag: ref.bag, item: APEX, copy: captured.copy });
      expect(parsed).not.toBeNull();
      if (!parsed) throw new Error('captured selection rejected');
      expect(parsed.copy?.pin).toMatch(/^[0-9a-f]{32}$/);
      if (changed) {
        (
          selected.instance as unknown as { rolled: { future_0: { data: string } } }
        ).rolled.future_0.data = 'y'.repeat(990);
      }
      const before = structuredClone(meta.inventory);
      sim.perfectItem(parsed);
      expect(draws()).toBe(changed ? 0 : 1);
      if (changed) expect(meta.inventory).toEqual(before);
      else {
        expect(selected.instance?.perfecting).toBe(1);
        expect(sibling.instance?.perfecting).toBeUndefined();
      }
    },
  );

  it.each([false, true])('refuses a sibling at the captured cell (promotion=%s)', (perfected) => {
    const { sim, meta, selected, sibling, ref, draws } = setup(perfected);
    meta.inventory.splice(0, 1);
    expect(meta.inventory[ref.bag]).toBe(sibling);
    const before = structuredClone(meta.inventory);
    sim.perfectItem(ref, perfected ? 'Dawn Glory' : undefined);
    expect(meta.inventory).toEqual(before);
    expect(selected.instance?.boundTo).toBeUndefined();
    expect(sibling.instance?.name).toBeUndefined();
    expect(draws()).toBe(0);
  });

  it('refuses an equal-count replacement whose payload differs', () => {
    const { sim, meta, ref, draws } = setup();
    meta.inventory[ref.bag] = { itemId: APEX, count: 1, instance: { signer: 'Replacement' } };
    const before = structuredClone(meta.inventory);
    sim.perfectItem(ref);
    expect(meta.inventory).toEqual(before);
    expect(draws()).toBe(0);
  });

  it('refuses a worn same-ID swap after capture', () => {
    const { sim, meta, selected, sibling, draws } = setup();
    meta.equipment.neck = APEX;
    meta.equipmentInstance.neck = selected.instance;
    const ref: PerfectItemRef & { copy: { pin: string } } = {
      slot: 'neck',
      copy: {
        pin: fingerprint128(itemCopyPin({ itemId: APEX, count: 1, instance: selected.instance })),
      },
    };
    meta.equipmentInstance.neck = sibling.instance;
    const before = structuredClone(meta.inventory);
    sim.perfectItem(ref);
    expect(meta.inventory).toEqual(before);
    expect(sibling.instance?.boundTo).toBeUndefined();
    expect(draws()).toBe(0);
  });

  it('mutates the originally resolved object when consuming materials shifts its cell', () => {
    const { sim, meta, selected, sibling, ref, draws } = setup();
    sim.perfectItem(ref);
    expect(meta.inventory.indexOf(selected)).toBe(ref.bag - 3);
    expect(selected.instance?.perfecting).toBe(1);
    expect(sibling.instance?.perfecting).toBeUndefined();
    expect(draws()).toBe(1);
  });

  it('the wire parser preserves a captured copy and refuses malformed tokens', () => {
    const { ref } = setup();
    expect(parsePerfectItemRef({ bag: ref.bag, item: APEX, ...{ copy: ref.copy } })).toEqual(ref);
    expect(parsePerfectItemRef({ slot: 'neck', copy: ref.copy })).toBeNull();
    for (const copy of [
      null,
      {},
      { pin: '' },
      { pin: 'x'.repeat(8193), anchor: { ordinal: 0, count: 1 } },
      { pin: 'a'.repeat(31), anchor: { ordinal: 0, count: 1 } },
      { pin: 'a'.repeat(33), anchor: { ordinal: 0, count: 1 } },
      { pin: `${'a'.repeat(32)}\n`, anchor: { ordinal: 0, count: 1 } },
      { pin: 'A'.repeat(32), anchor: { ordinal: 0, count: 1 } },
      { pin: 'g'.repeat(32), anchor: { ordinal: 0, count: 1 } },
      { pin: ref.copy.pin, anchor: { ordinal: 1, count: 1 } },
    ]) {
      expect(parsePerfectItemRef({ bag: ref.bag, item: APEX, ...{ copy } })).toBeNull();
    }
  });

  it('keeps semantic property order stable and includes crafted provenance', () => {
    const { meta, selected, ref } = setup();
    const reads = {
      inventory: meta.inventory,
      equipment: meta.equipment,
      equipmentInstances: meta.equipmentInstance,
    };
    const capture = () => capturePerfectItemRef(reads, { bag: ref.bag, itemId: APEX }).copy?.pin;
    selected.instance = { signer: 'First', rolled: { stats: { sta: 2, agi: 3 } } };
    const initial = capture();
    selected.instance = { rolled: { stats: { agi: 3, sta: 2 } }, signer: 'First' };
    expect(capture()).toBe(initial);
    selected.craftedRecipeId = 'future_recipe';
    expect(capture()).not.toBe(initial);
  });

  it('never turns an absent selection into the hash of an empty value', () => {
    const { sim, meta, draws } = setup();
    const captured = capturePerfectItemRef(
      {
        inventory: meta.inventory,
        equipment: meta.equipment,
        equipmentInstances: meta.equipmentInstance,
      },
      { slot: 'neck' },
    );
    expect(captured.copy?.pin).toBe('');
    expect(parsePerfectItemRef({ slot: 'neck', copy: captured.copy })).toBeNull();
    meta.equipment.neck = APEX;
    const before = structuredClone(meta.inventory);
    sim.perfectItem(captured);
    expect(meta.inventory).toEqual(before);
    expect(meta.equipmentInstance.neck).toBeUndefined();
    expect(draws()).toBe(0);
  });
});
