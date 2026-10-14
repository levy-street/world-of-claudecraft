import { describe, expect, it } from 'vitest';
import { applyMaterialInventoryWire } from '../src/net/material_inventory_wire';
import { bagCapacity, bagPools, canAddItem } from '../src/sim/bags';
import { savedMembershipBags } from '../src/sim/membership_bag_slot';
import { planMembershipBankTransfer } from '../src/sim/membership_bank';
import { Sim } from '../src/sim/sim';
import type { InvSlot } from '../src/sim/types';
import { membershipBagSlotLocked } from '../src/ui/membership_bag_socket';

function fixture() {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
  const pid = sim.player.id;
  const meta = sim.players.get(pid)!;
  return { sim, pid, meta };
}
function fifthBag() {
  const result = fixture();
  result.sim.setMembership(result.pid, 60);
  result.meta.inventory = [];
  result.sim.addItem('linen_pouch', 1);
  result.sim.equipBag('linen_pouch', 4);
  return result;
}

describe('membership bag slot', () => {
  it('refuses the fifth slot without membership and preserves four ordinary sockets', () => {
    const { sim, meta } = fixture();
    sim.addItem('linen_pouch', 1);
    const before = structuredClone(meta.inventory);
    sim.equipBag('linen_pouch', 4);
    expect(meta.inventory).toEqual(before);
    expect(meta.bags).toEqual([null, null, null, null]);
    expect(meta.membershipBag).toBeUndefined();
    sim.equipBag('linen_pouch', 3);
    expect(sim.bagCapacity).toBe(22);
  });

  it('grants capacity while active, parks overflow safely on expiry, and restores on renewal', () => {
    const { sim, pid, meta } = fifthBag();
    expect(meta.membershipBag).toBe('linen_pouch');
    expect(meta.bags).toEqual([null, null, null, null, 'linen_pouch']);
    expect(sim.bagCapacity).toBe(22);
    meta.inventory = Array.from({ length: 22 }, () => ({ itemId: 'worn_sword', count: 1 }));
    const before = structuredClone(meta.inventory);
    const revision = meta.wireRev;
    sim.setMembership(pid, 0);
    expect(meta.wireRev).toBeGreaterThan(revision);
    expect(meta.bags).toHaveLength(4);
    expect(meta.membershipBag).toBe('linen_pouch');
    expect(meta.inventory).toEqual(before);
    expect(sim.bagCapacity).toBe(16);
    expect(canAddItem(meta.inventory, bagPools(meta.bags), 'worn_sword', 1)).toBe(false);
    sim.unequipBag(4);
    expect(meta.membershipBag).toBe('linen_pouch');
    sim.setMembership(pid, 60);
    expect(meta.bags[4]).toBe('linen_pouch');
    expect(sim.bagCapacity).toBe(22);
    expect(meta.inventory.filter((slot) => slot.itemId === 'worn_sword')).toEqual(before);
  });

  it('expires on the sim clock and mirrors exactly the same capacity to the client', () => {
    const { sim, pid, meta } = fifthBag();
    const mirror = {
      inventory: [] as InvSlot[],
      vendorBuyback: [] as InvSlot[],
      bags: [] as (string | null)[],
    };
    applyMaterialInventoryWire(mirror, { bags: [...meta.bags] });
    expect(bagCapacity(mirror.bags)).toBe(sim.bagCapacity);
    expect(membershipBagSlotLocked(mirror.bags)).toBe(false);
    sim.setMembership(pid, 0.05);
    const revision = meta.wireRev;
    sim.tick();
    sim.tick();
    expect(meta.wireRev).toBeGreaterThan(revision);
    applyMaterialInventoryWire(mirror, { bags: [...meta.bags] });
    expect(bagCapacity(mirror.bags)).toBe(16);
    expect(membershipBagSlotLocked(mirror.bags)).toBe(true);
  });

  it('saves the equipped bag separately and never restores membership authority from the blob', () => {
    const { sim, pid } = fifthBag();
    const saved = sim.serializeCharacter(pid)!;
    expect(saved.bags).toHaveLength(4);
    expect(saved.membershipBag).toBe('linen_pouch');
    const restored = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const next = restored.addPlayer('warrior', 'Member', { state: saved });
    const meta = restored.players.get(next)!;
    expect(meta.bags).toHaveLength(4);
    expect(bagCapacity(meta.bags)).toBe(16);
    expect(restored.serializeCharacter(next)?.membershipBag).toBe('linen_pouch');
    restored.setMembership(next, 60);
    expect(bagCapacity(meta.bags)).toBe(22);
    meta.inventory = [];
    restored.unequipBag(4, next);
    expect(meta.inventory).toEqual([{ itemId: 'linen_pouch', count: 1 }]);
    expect(restored.serializeCharacter(next)).not.toHaveProperty('membershipBag');
  });

  it('retains unknown saved bag IDs without granting capacity or destroying them', () => {
    const { sim, pid } = fixture();
    const saved = { ...sim.serializeCharacter(pid)!, membershipBag: 'future_member_bag' };
    const restored = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const next = restored.addPlayer('warrior', 'Member', { state: saved });
    expect(restored.serializeCharacter(next)?.membershipBag).toBe('future_member_bag');
    restored.setMembership(next, 60);
    expect(bagCapacity(restored.players.get(next)!.bags)).toBe(16);
    expect(restored.serializeCharacter(next)?.membershipBag).toBe('future_member_bag');
  });

  it('accounts a member materials bag in the materials pool only and retains its contents on expiry', () => {
    const { sim, pid, meta } = fixture();
    sim.setMembership(pid, 60);
    meta.inventory = [];
    sim.addItem('burlap_reagent_pouch', 1);
    sim.equipBag('burlap_reagent_pouch', 4);
    expect(bagPools(meta.bags)).toEqual({ general: 16, materials: 8 });
    meta.inventory = Array.from({ length: 16 }, () => ({ itemId: 'worn_sword', count: 1 }));
    expect(canAddItem(meta.inventory, bagPools(meta.bags), 'worn_sword', 1)).toBe(false);
    expect(canAddItem(meta.inventory, bagPools(meta.bags), 'copper_ore', 20)).toBe(true);
    sim.addItem('copper_ore', 20);
    const before = structuredClone(meta.inventory);
    sim.setMembership(pid, 0);
    expect(bagPools(meta.bags)).toEqual({ general: 16, materials: 0 });
    expect(meta.inventory).toEqual(before);
    sim.setMembership(pid, 60);
    expect(bagPools(meta.bags)).toEqual({ general: 16, materials: 8 });
  });

  it('auto-equips into the fifth empty socket and retains swap and shrink guards', () => {
    const { sim, meta } = fifthBag();
    meta.bags.fill('linen_pouch', 0, 4);
    sim.unequipBag(4);
    sim.equipBag('linen_pouch');
    expect(meta.bags).toEqual(Array(5).fill('linen_pouch'));
    sim.addItem('travelers_knapsack', 1);
    sim.equipBag('travelers_knapsack', 4);
    expect(meta.membershipBag).toBe('travelers_knapsack');
    expect(meta.inventory).toEqual([{ itemId: 'linen_pouch', count: 1 }]);
    meta.inventory = Array.from({ length: 48 }, () => ({ itemId: 'worn_sword', count: 1 }));
    sim.unequipBag(4);
    expect(meta.membershipBag).toBe('travelers_knapsack');
  });

  it('uses the same active member capacity for a committed shared bank withdrawal', () => {
    const { sim, pid } = fifthBag();
    const state = sim.serializeCharacter(pid)!;
    state.inventory = Array.from({ length: 16 }, () => ({ itemId: 'worn_sword', count: 1 }));
    const item = { itemId: 'worn_sword', count: 1 };
    const bank = { inventory: [item], purchasedSlots: 0, bonusSlots: 0 };
    const request = { direction: 'withdraw' as const, slotIndex: 0, expectedSlot: item };
    expect(planMembershipBankTransfer(state, bank, request)).toEqual({
      ok: false,
      error: 'no_fit',
    });
    const memberBags = savedMembershipBags(state);
    expect(planMembershipBankTransfer({ ...state, bags: memberBags }, bank, request).ok).toBe(true);
    expect(state.bags).toHaveLength(4);
  });
});
