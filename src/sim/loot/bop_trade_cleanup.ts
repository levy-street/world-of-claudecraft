// Retires bind-on-pickup party-trade markers after they stop authorizing a
// transfer, then restores ordinary stack behavior. The clock is supplied by
// the caller so this leaf stays deterministic and host-neutral.

import { stackSizeOf } from '../bags';
import { ITEMS } from '../data';
import { canStackInstancePayloads, isMergeableInstancePayload } from '../item_instance_merge';
import { cloneItemInstancePayload, type InvSlot } from '../types';
import { partyTradeActive, withoutPartyTradeMarker } from './bop_trade_window';

export interface PartyTradeContainerOwner {
  inventory: InvSlot[];
  bank: { inventory: InvSlot[] };
  vendorBuyback: InvSlot[];
}

export interface PartyTradeContainerChanges {
  inventory: boolean;
  bank: boolean;
  buyback: boolean;
}

export interface PersistedPartyTradeContainers {
  inventory: InvSlot[];
  bank?: { inventory: InvSlot[] };
  vendorBuyback?: InvSlot[];
}

function markerMustRetire(slot: InvSlot, nowMs: number): boolean {
  if (!slot.instance?.partyTrade) return false;
  return !partyTradeActive(slot.instance, nowMs);
}

function slotWithoutPartyTrade(slot: InvSlot): InvSlot {
  const { instance: _instance, ...plain } = slot;
  const instance = withoutPartyTradeMarker(slot.instance as NonNullable<InvSlot['instance']>);
  return instance ? { ...plain, instance } : plain;
}

function freshSlot(source: InvSlot, count: number, keepPosition: boolean): InvSlot {
  const slot: InvSlot = {
    itemId: source.itemId,
    count,
    ...(source.instance ? { instance: cloneItemInstancePayload(source.instance) } : {}),
    ...(source.craftedRecipeId === undefined ? {} : { craftedRecipeId: source.craftedRecipeId }),
    ...(keepPosition && source.slot !== undefined ? { slot: source.slot } : {}),
  };
  return slot;
}

/**
 * Returns the original array when no marker needs retirement. Otherwise it
 * returns new slots with total counts conserved, unrelated payload fields
 * preserved, and newly identical rows coalesced up to the live stack cap.
 */
export function normalizePartyTradeSlots(slots: InvSlot[], nowMs: number): InvSlot[] {
  return normalizePartyTradeSlotsWithPolicy(slots, nowMs, true);
}

interface IndexedSlot {
  sourceIndex: number;
  splitIndex: number;
  slot: InvSlot;
}

function normalizePartyTradeSlotsWithPolicy(
  slots: InvSlot[],
  nowMs: number,
  restack: boolean,
): InvSlot[] {
  const retiring = slots.map((slot) => markerMustRetire(slot, nowMs));
  if (!retiring.some(Boolean)) return slots;

  // Seed the result with unaffected rows. Expired rows may fill those stacks,
  // but two unrelated pre-existing partial stacks are never merged together.
  const result: IndexedSlot[] = slots.flatMap((slot, sourceIndex) =>
    retiring[sourceIndex] ? [] : [{ sourceIndex, splitIndex: 0, slot }],
  );
  for (let sourceIndex = 0; sourceIndex < slots.length; sourceIndex++) {
    if (!retiring[sourceIndex]) continue;
    const source = slotWithoutPartyTrade(slots[sourceIndex]);
    let remaining = source.count;
    const stackCap = stackSizeOf(ITEMS[source.itemId]);
    const mergeable = isMergeableInstancePayload(source.instance);
    if (restack && mergeable) {
      for (const target of result) {
        if (remaining <= 0) break;
        if (
          target.slot.itemId !== source.itemId ||
          target.slot.craftedRecipeId !== source.craftedRecipeId ||
          !canStackInstancePayloads(target.slot.instance, source.instance) ||
          target.slot.count >= stackCap
        ) {
          continue;
        }
        const moved = Math.min(stackCap - target.slot.count, remaining);
        target.slot = { ...target.slot, count: target.slot.count + moved };
        remaining -= moved;
      }
    }
    let splitIndex = 0;
    while (remaining > 0) {
      // A non-mergeable payload (for example a player-locked counted stack) is
      // already one legal persisted row. Never fan it out into one row per unit.
      const count = !restack || !mergeable ? remaining : Math.min(stackCap, remaining);
      result.push({
        sourceIndex,
        splitIndex,
        slot: freshSlot(source, count, splitIndex === 0),
      });
      splitIndex++;
      remaining -= count;
    }
  }
  result.sort((a, b) => a.sourceIndex - b.sourceIndex || a.splitIndex - b.splitIndex);
  return result.map((entry) => entry.slot);
}

/** Normalize general persisted per-character item containers with one clock read. */
export function normalizePartyTradeContainers(
  owner: PartyTradeContainerOwner,
  nowMs: number,
): PartyTradeContainerChanges {
  const inventory = normalizePartyTradeSlots(owner.inventory, nowMs);
  const bank = normalizePartyTradeSlots(owner.bank.inventory, nowMs);
  // Buyback is recency/index ordered and intentionally permits rows above the
  // live stack cap. Strip only the marker; never reorder, split, or coalesce it.
  const buyback = normalizePartyTradeSlotsWithPolicy(owner.vendorBuyback, nowMs, false);
  const changes = {
    inventory: inventory !== owner.inventory,
    bank: bank !== owner.bank.inventory,
    buyback: buyback !== owner.vendorBuyback,
  };
  owner.inventory = inventory;
  owner.bank.inventory = bank;
  owner.vendorBuyback = buyback;
  return changes;
}

/** Normalize the optional JSONB container shape without growing Sim's save coordinator. */
export function normalizePersistedPartyTradeContainers(
  owner: PersistedPartyTradeContainers,
  nowMs: number,
): void {
  const containers = {
    inventory: owner.inventory,
    bank: { inventory: owner.bank?.inventory ?? [] },
    vendorBuyback: owner.vendorBuyback ?? [],
  };
  normalizePartyTradeContainers(containers, nowMs);
  owner.inventory = containers.inventory;
  if (owner.bank) owner.bank.inventory = containers.bank.inventory;
  owner.vendorBuyback = containers.vendorBuyback;
}
