// Cross-character bank movement reuses the personal bank's exact-copy and
// material-source transfer core. Inputs stay detached until the host commits.
import type { BankInfo } from '../world_api/bank';
import { poolOccupancyOf } from './bag_pools';
import { bagPools } from './bags';
import { bankPools, moveBetweenContainers, type SavedBankState, sanitizeBankState } from './bank';
import type { CharacterState } from './character_state';
import { ITEMS } from './data';
import { itemInstancePayloadsEqual } from './item_instance_merge';
import { isMaterialItemId } from './material_ids';
import { cloneMaterialData, materialPayloadKey } from './material_payload_identity';
import { isTransferLockedInstance } from './transfer_lock';
import type { InvSlot, ItemInstancePayload } from './types';

export interface MembershipBankTransferRequest {
  direction: 'deposit' | 'withdraw';
  slotIndex: number;
  count?: number;
  expectedSlot: InvSlot;
}

export type MembershipBankRefusal = 'invalid' | 'stale' | 'bound' | 'no_fit';
export type MembershipBankPlan =
  | { ok: false; error: MembershipBankRefusal }
  | { ok: true; inventory: InvSlot[]; bank: SavedBankState; moved: number; item: InvSlot };

/** Geometry sanitizes independently of contents. Legacy overflow and unknown
 * persisted payload fields must survive an unrelated cross-character move. */
export function membershipBankView(saved: SavedBankState | undefined): BankInfo {
  const geometry = sanitizeBankState({ ...saved, inventory: [] });
  const slots = cloneMaterialData(saved?.inventory ?? []);
  const pools = bankPools(geometry);
  const occupancy = poolOccupancyOf(slots, pools, isMaterialItemId);
  return {
    slots,
    capacity: pools.general + pools.materials,
    purchasedSlots: geometry.purchasedSlots,
    bonusSlots: geometry.bonusSlots,
    nextExpansionCost: null,
    bonusSources: [],
    socketsUnlocked: geometry.unlockedSockets,
    socketBags: [...geometry.socketBags],
    nextSocketCost: null,
    generalCapacity: pools.general,
    materialsCapacity: pools.materials,
    generalUsed: occupancy.generalUsed,
    materialsUsed: occupancy.materialsUsed,
  };
}

export function planMembershipBankTransfer(
  actor: Pick<CharacterState, 'inventory' | 'bags'>,
  saved: SavedBankState | undefined,
  request: MembershipBankTransferRequest,
): MembershipBankPlan {
  if (
    (request.direction !== 'deposit' && request.direction !== 'withdraw') ||
    !Number.isSafeInteger(request.slotIndex) ||
    request.slotIndex < 0 ||
    (request.count !== undefined && (!Number.isSafeInteger(request.count) || request.count <= 0))
  )
    return { ok: false, error: 'invalid' };
  const geometry = sanitizeBankState({ ...saved, inventory: [] });
  const inventory = cloneMaterialData(actor.inventory);
  const bank: SavedBankState = saved
    ? cloneMaterialData(saved)
    : { inventory: [], purchasedSlots: 0, bonusSlots: 0 };
  const source = request.direction === 'deposit' ? inventory : bank.inventory;
  const destination = request.direction === 'deposit' ? bank.inventory : inventory;
  const item = source[request.slotIndex];
  // Compare the whole shown slot, including count and exact source composition,
  // independent of JSONB key order. Never fall back to another copy by item id.
  if (
    !item ||
    !request.expectedSlot ||
    !itemInstancePayloadsEqual(
      item as unknown as ItemInstancePayload,
      request.expectedSlot as unknown as ItemInstancePayload,
    )
  )
    return { ok: false, error: 'stale' };
  const def = ITEMS[item.itemId];
  if (!def || !Number.isSafeInteger(item.count) || item.count <= 0) {
    return { ok: false, error: 'invalid' };
  }
  if (
    def.kind === 'quest' ||
    def.soulbound ||
    def.noMarketList ||
    isTransferLockedInstance(item.instance) ||
    item.instance?.locked
  ) {
    return { ok: false, error: 'bound' };
  }
  const copiedItem = cloneMaterialData(item);
  const result = moveBetweenContainers(
    source,
    request.slotIndex,
    request.count,
    destination,
    request.direction === 'deposit' ? bankPools(geometry) : bagPools(actor.bags ?? []),
  );
  if (result.refusal) return { ok: false, error: result.refusal };
  return { ok: true, inventory, bank, moved: result.moved, item: copiedItem };
}

/** Apply only the committed transfer delta to the live bags. Passive grants
 * may append unrelated slots while SQL awaits; those must never be overwritten.
 * An affected stack changing, or a grant occupying the needed space, is a
 * conflict: the host quarantines and reloads the proven durable result. */
export function applyMembershipBankInventoryPlan(
  live: readonly InvSlot[],
  before: readonly InvSlot[],
  after: readonly InvSlot[],
  bags: readonly (string | null)[],
): InvSlot[] | null {
  // Reuse the canonical structural encoder over the WHOLE slot, not merely
  // its ordinary payload identity: counts, sources and unknown fields all
  // participate. Its key-order/undefined rules match the equality check above.
  // Counted multisets make this linear in slot count even for legacy overflow;
  // repeated find/splice would scan and shift a whole inventory per row.
  const keyOf = (slot: InvSlot): string =>
    materialPayloadKey({ itemId: slot.itemId, instance: slot as unknown as ItemInstancePayload });
  const afterKeys = after.map(keyOf);
  const unmatchedAfter = new Map<string, number>();
  const unchanged = new Map<string, number>();
  const removals = new Map<string, number>();
  for (const key of afterKeys) unmatchedAfter.set(key, (unmatchedAfter.get(key) ?? 0) + 1);
  for (const slot of before) {
    const key = keyOf(slot);
    const available = unmatchedAfter.get(key) ?? 0;
    if (available > 0) {
      unmatchedAfter.set(key, available - 1);
      unchanged.set(key, (unchanged.get(key) ?? 0) + 1);
    } else removals.set(key, (removals.get(key) ?? 0) + 1);
  }
  const retained: InvSlot[] = [];
  for (const slot of live) {
    const key = keyOf(slot);
    const remove = removals.get(key) ?? 0;
    if (remove > 0) removals.set(key, remove - 1);
    else retained.push(slot);
  }
  for (const count of removals.values()) if (count > 0) return null;
  for (let index = 0; index < after.length; index++) {
    const key = afterKeys[index];
    const skip = unchanged.get(key) ?? 0;
    if (skip > 0) unchanged.set(key, skip - 1);
    else retained.push(after[index]);
  }
  const result = cloneMaterialData(retained);
  const pools = bagPools(bags);
  const prior = poolOccupancyOf([...live], pools, isMaterialItemId);
  const next = poolOccupancyOf(result, pools, isMaterialItemId);
  if (
    next.generalUsed > Math.max(pools.general, prior.generalUsed) ||
    next.materialsUsed > Math.max(pools.materials, prior.materialsUsed)
  )
    return null;
  return result;
}
