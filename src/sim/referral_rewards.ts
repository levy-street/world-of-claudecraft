import { poolCapacityOf, poolOccupancyOf } from './bag_pools';
import { BACKPACK_SLOTS } from './bags';
import { BANK_BASE_SLOTS, sanitizeBankState, savedBankState } from './bank';
import { restoreBuddyCollection, serializeBuddyCollection } from './buddies';
import type { CharacterState } from './character_state';
import {
  REFERRAL_BAG,
  REFERRAL_FOG_TRINKET,
  REFERRAL_HOLLOW_TRINKET,
  REFERRAL_RAPTOR_REINS,
  REFERRAL_TANK_REINS,
  REFERRAL_TITLE,
} from './content/referral_rewards';
import { isMaterialItemId } from './material_ids';
import { REFERRAL_MILESTONES, type ReferralMilestone } from './referral_cards';
import type { SimContext } from './sim_context';
import { cloneInvSlot, type EquipSlot, type InvSlot } from './types';

/** One receipt per enrolled link, retained only on its currently assigned character.
 * Dedicated protected items are fungible between these receipts. Sockets store item ids,
 * so custody is counted across all personal containers, never inferred from bag position.
 * No reward can leave personal custody before the card binds. */
export type ReferralRewardLedger = Record<string, { redeemed: number }>;

export class ReferralRewardError extends Error {
  constructor(public readonly code: 'capacity' | 'missingReward' | 'locked' | 'invalidMilestone') {
    super(`Referral reward transaction refused: ${code}`);
  }
}

export function ownsReferralTitle(ledger: ReferralRewardLedger | undefined): boolean {
  return Object.values(ledger ?? {}).some((receipt) => (receipt.redeemed & 1) !== 0);
}

function copy(state: CharacterState): CharacterState {
  // CharacterState is a JSON save shape; cloning isolates transaction candidates completely.
  return JSON.parse(JSON.stringify(state)) as CharacterState;
}

function receipt(state: CharacterState, linkId: number): number {
  if (!Number.isSafeInteger(linkId) || linkId <= 0)
    throw new ReferralRewardError('invalidMilestone');
  return state.referralRewards?.[String(linkId)]?.redeemed ?? 0;
}

function putReceipt(state: CharacterState, linkId: number, redeemed: number): void {
  state.referralRewards ??= {};
  state.referralRewards[String(linkId)] = { redeemed };
}

function assertCapacity(state: CharacterState): void {
  const carried = poolCapacityOf(BACKPACK_SLOTS, state.bags ?? []);
  if (poolOccupancyOf(state.inventory, carried, isMaterialItemId).generalUsed > carried.general)
    throw new ReferralRewardError('capacity');
  if (state.bank) {
    const bank = state.bank;
    const pools = poolCapacityOf(
      BANK_BASE_SLOTS + bank.purchasedSlots + bank.bonusSlots,
      bank.socketBags ?? [],
    );
    if (poolOccupancyOf(bank.inventory, pools, isMaterialItemId).generalUsed > pools.general)
      throw new ReferralRewardError('capacity');
  }
}

/** Removes one protected entitlement. Inventory first avoids unseating an equipped bag
 * when an equivalent unequipped copy exists. Every instance payload travels with its copy. */
function take(state: CharacterState, itemId: string, linkId?: number): InvSlot {
  for (const inventory of [state.inventory, state.bank?.inventory, state.vendorBuyback]) {
    const index =
      inventory?.findIndex(
        (slot) =>
          slot.itemId === itemId &&
          slot.count > 0 &&
          (linkId === undefined || slot.instance?.referralLinkId === linkId),
      ) ?? -1;
    if (!inventory || index < 0) continue;
    const slot = cloneInvSlot(inventory[index]);
    slot.count = 1;
    if (--inventory[index].count === 0) inventory.splice(index, 1);
    return slot;
  }
  for (const slot of Object.keys(state.equipment) as EquipSlot[]) {
    if (state.equipment[slot] !== itemId) continue;
    const instance = state.equipmentInstance?.[slot] ?? state.equipmentInstances?.[slot];
    if (linkId !== undefined && instance?.referralLinkId !== linkId) continue;
    delete state.equipment[slot];
    if (state.equipmentInstance) delete state.equipmentInstance[slot];
    if (state.equipmentInstances) delete state.equipmentInstances[slot];
    return { itemId, count: 1, ...(instance ? { instance } : {}) };
  }
  for (const bags of [state.bags, state.bank?.socketBags]) {
    const index = bags?.indexOf(itemId) ?? -1;
    if (!bags || index < 0) continue;
    bags[index] = null;
    return { itemId, count: 1 };
  }
  throw new ReferralRewardError('missingReward');
}

function give(state: CharacterState, item: InvSlot): void {
  state.inventory.push(cloneInvSlot({ ...item, slot: undefined }));
}

function evolve(state: CharacterState, linkId: number): void {
  // Preserve the actual worn/banked copy and its payload, including enchantments.
  for (const inventory of [state.inventory, state.bank?.inventory]) {
    const slot = inventory?.find(
      (item) => item.itemId === REFERRAL_HOLLOW_TRINKET && item.instance?.referralLinkId === linkId,
    );
    if (slot) {
      slot.itemId = REFERRAL_FOG_TRINKET;
      return;
    }
  }
  if (
    state.equipment.trinket === REFERRAL_HOLLOW_TRINKET &&
    (state.equipmentInstance?.trinket ?? state.equipmentInstances?.trinket)?.referralLinkId ===
      linkId
  ) {
    state.equipment.trinket = REFERRAL_FOG_TRINKET;
    return;
  }
  throw new ReferralRewardError('missingReward');
}

/** Pure, immutable transaction candidate. Caller commits this with the card revision.
 * Full bags reject retryable claims; receipts never advance without the corresponding grant. */
export function grantReferralReward(
  state: CharacterState,
  linkId: number,
  milestone: ReferralMilestone,
): CharacterState {
  const position = REFERRAL_MILESTONES.findIndex((entry) => entry.id === milestone);
  if (position < 0) throw new ReferralRewardError('invalidMilestone');
  const redeemed = receipt(state, linkId);
  const bit = 1 << position;
  if (redeemed & bit) return state;
  if ((redeemed & (bit - 1)) !== bit - 1) throw new ReferralRewardError('invalidMilestone');
  const next = copy(state);
  switch (milestone) {
    case 'tutorial':
      give(next, { itemId: REFERRAL_BAG, count: 1 });
      break;
    case 'hollow':
      give(next, {
        itemId: REFERRAL_HOLLOW_TRINKET,
        count: 1,
        instance: { referralLinkId: linkId },
      });
      break;
    case 'fogbinder':
      evolve(next, linkId);
      break;
    case 'gravewyrm':
      next.ridingTrained = true;
      next.mountTrainingFeePaid = true;
      break;
    case 'raid':
      give(next, { itemId: REFERRAL_TANK_REINS, count: 1 });
      break;
  }
  putReceipt(next, linkId, redeemed | bit);
  assertCapacity(next);
  return next;
}

function detach(
  state: CharacterState,
  linkId: number,
): { state: CharacterState; items: InvSlot[] } {
  const redeemed = receipt(state, linkId);
  if (redeemed & 4) throw new ReferralRewardError('locked');
  const next = copy(state);
  const items: InvSlot[] = [];
  if (redeemed & 1) items.push(take(next, REFERRAL_BAG));
  if (redeemed & 2) items.push(take(next, REFERRAL_HOLLOW_TRINKET, linkId));
  if (next.referralRewards) {
    delete next.referralRewards[String(linkId)];
    if (!Object.keys(next.referralRewards).length) delete next.referralRewards;
  }
  if (next.activeTitle === REFERRAL_TITLE && !ownsReferralTitle(next.referralRewards))
    delete next.activeTitle;
  assertCapacity(next);
  return { state: next, items };
}

export function removeReferralRewards(state: CharacterState, linkId: number): CharacterState {
  if (!receipt(state, linkId)) return state;
  return detach(state, linkId).state;
}

export function moveReferralRewards(
  from: CharacterState,
  to: CharacterState,
  linkId: number,
): { from: CharacterState; to: CharacterState } {
  const redeemed = receipt(from, linkId);
  if (!redeemed) return { from, to };
  if (receipt(to, linkId)) throw new ReferralRewardError('invalidMilestone');
  const removed = detach(from, linkId);
  const next = copy(to);
  for (const item of removed.items) give(next, item);
  putReceipt(next, linkId, redeemed);
  assertCapacity(next);
  return { from: removed.state, to: next };
}

/** Called against the inviter's chosen character after the account count commits.
 * The host must fence account-wide tier receipts too, since these are account milestones. */
export function grantReferralInviterReward(
  state: CharacterState,
  completedFriends: number,
): CharacterState {
  const earned = (completedFriends >= 1 ? 1 : 0) | (completedFriends >= 5 ? 2 : 0);
  const prior = state.referralInviterRewards ?? 0;
  if ((prior & earned) === earned) return state;
  const next = copy(state);
  if (earned & 1 && !(prior & 1)) give(next, { itemId: REFERRAL_RAPTOR_REINS, count: 1 });
  if (earned & 2 && !(prior & 2)) {
    next.buddies ??= {};
    next.buddies.owned = [...new Set([...(next.buddies.owned ?? []), 'sapling'])];
  }
  next.referralInviterRewards = prior | earned;
  assertCapacity(next);
  return next;
}

/** Commit projection for a host that fenced the player's storage while awaiting its DB
 * transaction. Only reward-owned domains change; HP, location, combat and quests stay live. */
export function applyReferralRewardState(
  ctx: SimContext,
  pid: number,
  before: CharacterState,
  after: CharacterState,
): boolean {
  const resolved = ctx.resolve(pid);
  if (!resolved) return false;
  const { meta, e: p } = resolved;
  const changed = (key: keyof CharacterState) =>
    JSON.stringify(before[key]) !== JSON.stringify(after[key]);
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  // Passive loot may arrive during the database await even when commands are fenced.
  // Never overwrite it. The host quarantines/reloads on false after a committed write.
  if (changed('inventory') && !same(meta.inventory, before.inventory)) return false;
  if (changed('equipment') && !same(meta.equipment, before.equipment)) return false;
  if (
    (changed('equipmentInstance') || changed('equipment')) &&
    !same(meta.equipmentInstance, before.equipmentInstance ?? {})
  )
    return false;
  if (changed('bags') && !same(meta.bags, before.bags ?? [null, null, null, null])) return false;
  if (changed('bank') && !same(savedBankState(meta.bank), before.bank)) return false;
  if (
    changed('buddies') &&
    !same(serializeBuddyCollection(meta.buddies) ?? undefined, before.buddies)
  )
    return false;
  if (
    !same(meta.referralRewards, before.referralRewards) ||
    meta.referralInviterRewards !== before.referralInviterRewards
  )
    return false;
  if (changed('activeTitle') && meta.activeTitle !== (before.activeTitle ?? null)) return false;
  if (changed('inventory')) meta.inventory = after.inventory.map(cloneInvSlot);
  if (changed('equipment')) meta.equipment = { ...after.equipment };
  if (changed('equipmentInstance'))
    meta.equipmentInstance = structuredClone(after.equipmentInstance ?? {});
  if (changed('bags')) meta.bags = [...(after.bags ?? [null, null, null, null])];
  if (changed('bank')) {
    meta.bank = sanitizeBankState(after.bank);
    meta.bankWireRev++;
  }
  if (changed('buddies')) meta.buddies = restoreBuddyCollection(after.buddies);
  if (changed('ridingTrained')) meta.ridingTrained = after.ridingTrained === true;
  if (changed('mountTrainingFeePaid'))
    meta.mountTrainingFeePaid = after.mountTrainingFeePaid === true;
  meta.referralRewards = after.referralRewards ? structuredClone(after.referralRewards) : undefined;
  meta.referralInviterRewards = after.referralInviterRewards;
  if (changed('activeTitle')) {
    meta.activeTitle = after.activeTitle ?? null;
    p.title = meta.activeTitle;
  }
  ctx.recalcPlayer(p);
  ctx.onInventoryChangedForQuests(meta);
  meta.wireRev++;
  return true;
}
