import { describe, expect, it } from 'vitest';
import { applyMaterialInventoryWire } from '../src/net/material_inventory_wire';
import type { InvSlot } from '../src/sim/types';
import { ONLINE_WORLD_AUTH_TYPE, ONLINE_WORLD_LAYOUT_VERSION } from '../src/world_api';

const source = { gatherer: { kind: 'character' as const, id: 11, name: 'Ana' } };
const row: InvSlot = { itemId: 'copper_ore', count: 2, materialSources: [{ source, count: 2 }] };
describe('mixed material inventory wire', () => {
  it('requires the first source-aware client and server epoch', () => {
    expect(ONLINE_WORLD_LAYOUT_VERSION).toBe(27);
    expect(ONLINE_WORLD_AUTH_TYPE).toBe('auth-world-27');
  });
  it('retains both mirrors for omitted and malformed source frames', () => {
    const mirror = { inventory: [row], vendorBuyback: [row] };
    expect(applyMaterialInventoryWire(mirror, {})).toBe(false);
    expect(
      applyMaterialInventoryWire(mirror, {
        inv: [{ ...row, count: 1 }],
        buyback: [{ ...row, instance: { signer: 'Ana' } }],
      }),
    ).toBe(false);
    expect(mirror).toEqual({ inventory: [row], vendorBuyback: [row] });
  });
  it('adopts complete valid sources and explicit empty lists', () => {
    const mirror = { inventory: [] as InvSlot[], vendorBuyback: [row] };
    expect(applyMaterialInventoryWire(mirror, { inv: [row], buyback: [] })).toBe(true);
    expect(mirror).toEqual({ inventory: [row], vendorBuyback: [] });
  });
  it('keeps a dormant material while refusing sources attached to known equipment', () => {
    const mirror = { inventory: [] as InvSlot[], vendorBuyback: [] as InvSlot[] };
    applyMaterialInventoryWire(mirror, { inv: [{ ...row, itemId: 'retired_material' }] });
    expect(mirror.inventory[0].itemId).toBe('retired_material');
    expect(applyMaterialInventoryWire(mirror, { inv: [{ ...row, itemId: 'oiled_boots' }] })).toBe(
      false,
    );
    expect(mirror.inventory[0].itemId).toBe('retired_material');
  });
  it('preserves bag sockets on omitted deltas and marks a socket update dirty', () => {
    const mirror = {
      inventory: [] as InvSlot[],
      vendorBuyback: [] as InvSlot[],
      bags: ['linen_bag', null],
    };
    expect(applyMaterialInventoryWire(mirror, {})).toBe(false);
    expect(mirror.bags).toEqual(['linen_bag', null]);
    expect(applyMaterialInventoryWire(mirror, { bags: [null, null] })).toBe(true);
    expect(mirror.bags).toEqual([null, null]);
  });
});
