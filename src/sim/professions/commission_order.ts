// The commission order board (Professions 2.0, issue #1298): a lightweight
// job-board layered on top of the Maker's Bond bind-on-trade primitive
// (commission.ts, issue #2207). A requester opens an order naming a recipe
// and a scope (the open board, or one named crafter); a crafter accepts it,
// crafts the recipe with the commission opt-in exactly as before (crafting.ts
// mints bindOnTrade, unchanged by this module), then delivers the freshly
// commissioned, still-unbound copy straight to the requester. Delivery is the
// SAME bind-on-first-trade stamp trade.ts's grantOffer applies, performed
// face to face (the requester must be in range) instead of through the
// interactive trade window, because mail and the World Market already refuse
// an instanced payload (#2207's own note): an order's delivery step is the
// one direct channel a commissioned piece can travel through to its second
// owner.
//
// An order carries NO escrow: opening one holds no gold or materials (the
// design doc flags recipient-tied required materials as a later extension
// needing order-time escrow; out of scope here, see the module CLAUDE.md).
// It is in-memory Sim state only (like trades/duels), not persisted across a
// server restart; updateCommissionOrders below is the retention sweep every
// unbounded live collection needs (server/CLAUDE.md "Hot paths"): an
// unaccepted order past ORDER_OPEN_EXPIRE_SECONDS flips to 'expired', and a
// terminal order (delivered/cancelled/expired) past ORDER_RETAIN_SECONDS is
// pruned outright.
//
// This module is `src/sim`-pure (src/sim/CLAUDE.md): no DOM/render/ui/game/
// net imports, no randomness at all (the board draws nothing), no Sim import
// (PlayerMeta arrives type-only, the crafting.ts/commission.ts idiom).

import { bagCapacity, countFit } from '../bags';
import { recipeById } from '../content/recipes';
import { ITEMS } from '../data';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { findPlayerByName } from '../social/chat';
import { cloneItemInstancePayload, dist2d } from '../types';
import { isCommissionEligible } from './commission';

/** 'open': any crafter may accept. 'crafter': only the named crafter may. */
export type CommissionOrderScope = 'open' | 'crafter';

export type CommissionOrderStatus = 'open' | 'accepted' | 'delivered' | 'cancelled' | 'expired';

export interface CommissionOrder {
  id: number;
  requesterId: number;
  requesterName: string;
  recipeId: string;
  itemId: string;
  scope: CommissionOrderScope;
  /** Set iff scope === 'crafter'. */
  crafterId?: number;
  crafterName?: string;
  status: CommissionOrderStatus;
  acceptedBy?: number;
  acceptedByName?: string;
  /** ctx.time the order was opened. */
  openedAt: number;
  /** ctx.time the order reached a terminal status (delivered/cancelled/expired). */
  settledAt?: number;
}

const MAX_OPEN_ORDERS_PER_REQUESTER = 5;
// An unaccepted order expires after this long (24 sim-hours).
const ORDER_OPEN_EXPIRE_SECONDS = 24 * 3600;
// A terminal order (delivered/cancelled/expired) stays visible this long
// before the sweep prunes it, so the closing state actually reaches the
// viewer's next snapshot before the row disappears.
const ORDER_RETAIN_SECONDS = 10 * 60;
// Face-to-face delivery range: the trade.ts TRADE_RANGE precedent.
const DELIVER_RANGE = 10;

export type OpenOrderDenyReason =
  | 'unknown_recipe'
  | 'not_commission_eligible'
  | 'unknown_crafter'
  | 'self_crafter'
  | 'too_many_open';

export type AcceptOrderDenyReason =
  | 'unknown_order'
  | 'order_not_open'
  | 'self_order'
  | 'not_eligible_crafter';

export type CancelOrderDenyReason = 'unknown_order' | 'not_your_order' | 'order_not_open';

export type DeliverOrderDenyReason =
  | 'unknown_order'
  | 'order_not_accepted'
  | 'not_your_acceptance'
  | 'not_crafted'
  | 'deliver_out_of_range'
  | 'no_space';

export interface OpenOrderResult {
  ok: boolean;
  orderId?: number;
  reason?: OpenOrderDenyReason;
}
export interface AcceptOrderResult {
  ok: boolean;
  orderId: number;
  reason?: AcceptOrderDenyReason;
}
export interface CancelOrderResult {
  ok: boolean;
  orderId: number;
  reason?: CancelOrderDenyReason;
}
export interface DeliverOrderResult {
  ok: boolean;
  orderId: number;
  itemId?: string;
  reason?: DeliverOrderDenyReason;
}

/** Render-safe per-viewer projection: src/world_api/professions.ts
 *  CommissionOrderView mirrors this shape field-for-field. */
export interface CommissionOrderRow {
  id: number;
  requesterName: string;
  recipeId: string;
  itemId: string;
  scope: CommissionOrderScope;
  crafterName?: string;
  status: CommissionOrderStatus;
  acceptedByName?: string;
  mine: boolean;
  mineToCraft: boolean;
}

/**
 * Open a commission order: names a known, commission-eligible recipe and a
 * scope. 'crafter' scope resolves `crafterName` the same way a whisper does
 * (findPlayerByName): an exact-case match wins, otherwise an unambiguous
 * case-insensitive one. No escrow: nothing is charged or reserved.
 */
export function openCommissionOrder(
  ctx: SimContext,
  recipeId: string,
  scope: CommissionOrderScope,
  crafterName: string | undefined,
  pid?: number,
): OpenOrderResult {
  const r = ctx.resolve(pid);
  if (!r) return { ok: false };
  const recipe = recipeById(recipeId);
  if (!recipe) return { ok: false, reason: 'unknown_recipe' };
  if (!isCommissionEligible(ITEMS[recipe.resultItemId])) {
    return { ok: false, reason: 'not_commission_eligible' };
  }
  let crafterId: number | undefined;
  let resolvedCrafterName: string | undefined;
  if (scope === 'crafter') {
    const target = crafterName ? findPlayerByName(ctx, crafterName) : null;
    if (!target) return { ok: false, reason: 'unknown_crafter' };
    if (target.entityId === r.meta.entityId) return { ok: false, reason: 'self_crafter' };
    crafterId = target.entityId;
    resolvedCrafterName = target.name;
  }
  const openCount = ctx.commissionOrderBoard.reduce(
    (n, o) => n + (o.requesterId === r.meta.entityId && o.status === 'open' ? 1 : 0),
    0,
  );
  if (openCount >= MAX_OPEN_ORDERS_PER_REQUESTER) return { ok: false, reason: 'too_many_open' };
  const id = ctx.nextCommissionOrderId++;
  ctx.commissionOrderBoard.push({
    id,
    requesterId: r.meta.entityId,
    requesterName: r.meta.name,
    recipeId,
    itemId: recipe.resultItemId,
    scope,
    crafterId,
    crafterName: resolvedCrafterName,
    status: 'open',
    openedAt: ctx.time,
  });
  ctx.bumpCommissionOrderBoardRev();
  return { ok: true, orderId: id };
}

/** Cancel an order the caller opened, while it is still unaccepted. */
export function cancelCommissionOrder(
  ctx: SimContext,
  orderId: number,
  pid?: number,
): CancelOrderResult {
  const r = ctx.resolve(pid);
  if (!r) return { ok: false, orderId };
  const order = ctx.commissionOrderBoard.find((o) => o.id === orderId);
  if (!order) return { ok: false, orderId, reason: 'unknown_order' };
  if (order.requesterId !== r.meta.entityId)
    return { ok: false, orderId, reason: 'not_your_order' };
  if (order.status !== 'open') return { ok: false, orderId, reason: 'order_not_open' };
  order.status = 'cancelled';
  order.settledAt = ctx.time;
  ctx.bumpCommissionOrderBoardRev();
  return { ok: true, orderId };
}

/** Accept an open order as the crafter: 'open' scope admits anyone but the
 *  requester, 'crafter' scope admits only the order's named target. */
export function acceptCommissionOrder(
  ctx: SimContext,
  orderId: number,
  pid?: number,
): AcceptOrderResult {
  const r = ctx.resolve(pid);
  if (!r) return { ok: false, orderId };
  const order = ctx.commissionOrderBoard.find((o) => o.id === orderId);
  if (!order) return { ok: false, orderId, reason: 'unknown_order' };
  if (order.status !== 'open') return { ok: false, orderId, reason: 'order_not_open' };
  if (order.requesterId === r.meta.entityId) return { ok: false, orderId, reason: 'self_order' };
  if (order.scope === 'crafter' && order.crafterId !== r.meta.entityId) {
    return { ok: false, orderId, reason: 'not_eligible_crafter' };
  }
  order.status = 'accepted';
  order.acceptedBy = r.meta.entityId;
  order.acceptedByName = r.meta.name;
  ctx.bumpCommissionOrderBoardRev();
  return { ok: true, orderId };
}

/** The first (lowest bag index) inventory slot holding a commission-armed,
 *  still-unbound copy of `itemId`: the exact output crafting.ts's commission
 *  opt-in mints, before any trade has stamped boundTo onto it. */
function firstUnboundCommissionedSlot(meta: PlayerMeta, itemId: string): number {
  const inventory = meta.inventory ?? [];
  for (let i = 0; i < inventory.length; i++) {
    const slot = inventory[i];
    if (
      slot.itemId === itemId &&
      slot.instance?.bindOnTrade === true &&
      slot.instance.boundTo === undefined
    ) {
      return i;
    }
  }
  return -1;
}

/**
 * Deliver the order's commissioned item to its requester: finds the caller's
 * own held commission-armed unbound copy, then stamps boundTo the same way
 * trade.ts's grantOffer does on a first trade. Deny order mirrors the
 * commission.ts resolveUnbind doctrine (state checks before possession
 * before the external constraint before capacity), so a duplicate command
 * resolves order_not_accepted before touching bags at all:
 * 1. unknown order id;
 * 2. order not in 'accepted' status;
 * 3. caller is not the crafter who accepted it;
 * 4. caller holds no unbound commissioned copy of the item: not_crafted;
 * 5. the requester is not resolvable or not within DELIVER_RANGE:
 *    deliver_out_of_range;
 * 6. the requester's bags have no room for the incoming copy: no_space;
 * 7. otherwise ok: the copy leaves the crafter's bags (commission-eligible
 *    kinds never stack, so the slot always holds exactly one) and grants to
 *    the requester with boundTo stamped, exactly like a completed trade.
 */
export function deliverCommissionOrder(
  ctx: SimContext,
  orderId: number,
  pid?: number,
): DeliverOrderResult {
  const r = ctx.resolve(pid);
  if (!r) return { ok: false, orderId };
  const order = ctx.commissionOrderBoard.find((o) => o.id === orderId);
  if (!order) return { ok: false, orderId, reason: 'unknown_order' };
  if (order.status !== 'accepted') return { ok: false, orderId, reason: 'order_not_accepted' };
  if (order.acceptedBy !== r.meta.entityId) {
    return { ok: false, orderId, reason: 'not_your_acceptance' };
  }
  const slotIdx = firstUnboundCommissionedSlot(r.meta, order.itemId);
  if (slotIdx === -1) return { ok: false, orderId, itemId: order.itemId, reason: 'not_crafted' };
  const requesterMeta = ctx.players.get(order.requesterId);
  const requesterEntity = ctx.entities.get(order.requesterId);
  if (
    !requesterMeta ||
    !requesterEntity ||
    requesterEntity.dead ||
    dist2d(r.e.pos, requesterEntity.pos) > DELIVER_RANGE
  ) {
    return { ok: false, orderId, itemId: order.itemId, reason: 'deliver_out_of_range' };
  }
  const slot = r.meta.inventory[slotIdx];
  const instance = slot?.instance;
  // Unreachable: firstUnboundCommissionedSlot found this slot on this same
  // meta within the same synchronous call. Guarded before any mutation, the
  // resolveUnbind precedent, so a future refactor's failure mode is a no-op.
  if (instance === undefined)
    return { ok: false, orderId, itemId: order.itemId, reason: 'not_crafted' };
  const freed = cloneItemInstancePayload(instance);
  freed.boundTo = order.requesterId;
  if (
    countFit(requesterMeta.inventory, bagCapacity(requesterMeta.bags), order.itemId, 1, freed) < 1
  ) {
    return { ok: false, orderId, itemId: order.itemId, reason: 'no_space' };
  }
  // Commission-eligible kinds (weapon/armor/held_offhand) never stack past
  // one copy per slot (bags.ts UNSTACKED_KINDS), so removing this one slot is
  // always the whole unit; no count-1 split like the unbind stack-split arm.
  r.meta.inventory.splice(slotIdx, 1);
  ctx.onInventoryChangedForQuests(r.meta);
  // movement: the crafter hands the requester a piece they already hold, the
  // player-to-player shape a trade has, so it is not a world-sourced obtain.
  ctx.addItemInstance(order.itemId, freed, order.requesterId, 1, { movement: true });
  order.status = 'delivered';
  order.settledAt = ctx.time;
  ctx.bumpCommissionOrderBoardRev();
  return { ok: true, orderId, itemId: order.itemId };
}

/** The per-viewer projection `commissionOrders` IWorld reads: the viewer's
 *  own requests (any status), any order they accepted, plus every currently
 *  open order the open board or a 'crafter' scope names them for. Newest
 *  first. */
export function commissionOrdersFor(ctx: SimContext, pid: number): CommissionOrderRow[] {
  const rows: CommissionOrderRow[] = [];
  for (const o of ctx.commissionOrderBoard) {
    const mine = o.requesterId === pid;
    const targetedAtMe = o.scope === 'crafter' && o.crafterId === pid;
    const acceptedByMe = o.acceptedBy === pid;
    const onOpenBoard = o.status === 'open' && (o.scope === 'open' || targetedAtMe);
    if (!mine && !acceptedByMe && !onOpenBoard) continue;
    rows.push({
      id: o.id,
      requesterName: o.requesterName,
      recipeId: o.recipeId,
      itemId: o.itemId,
      scope: o.scope,
      crafterName: o.crafterName,
      status: o.status,
      acceptedByName: o.acceptedByName,
      mine,
      mineToCraft: acceptedByMe || (targetedAtMe && o.status === 'open'),
    });
  }
  rows.sort((a, b) => b.id - a.id);
  return rows;
}

/** The retention sweep (server/CLAUDE.md "Hot paths"): every unbounded live
 *  collection needs one. Called once per tick from the end-of-tick block,
 *  beside updateTradesAndInvites. Draws no rng. Each settle or drop advances
 *  the board revision the server's corder snapshot gate polls, like every
 *  other mutation site in this module. */
export function updateCommissionOrders(ctx: SimContext): void {
  for (let i = ctx.commissionOrderBoard.length - 1; i >= 0; i--) {
    const order = ctx.commissionOrderBoard[i];
    if (order.status === 'open' && ctx.time - order.openedAt > ORDER_OPEN_EXPIRE_SECONDS) {
      order.status = 'expired';
      order.settledAt = ctx.time;
      ctx.bumpCommissionOrderBoardRev();
      continue;
    }
    if (order.settledAt !== undefined && ctx.time - order.settledAt > ORDER_RETAIN_SECONDS) {
      ctx.commissionOrderBoard.splice(i, 1);
      ctx.bumpCommissionOrderBoardRev();
    }
  }
}
