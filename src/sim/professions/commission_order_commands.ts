// The commission order board's COMMAND EMIT bodies (Professions 2.0, issue
// #1298), extracted from src/sim/sim.ts at Masterwrought phase 12 (the
// monolith ratchet: the coordinator keeps four one-line delegates). A MOVE,
// not a rewrite: each body is the coordinator's verbatim, with `this.*`
// rewritten onto the SimContext primitives it was already reaching through
// (`ctx.commissionOrderBoard`, `ctx.players`, `ctx.primaryId`, `ctx.emit`).
// One verb per entry (open/cancel/accept/deliver): each resolves through
// commission_order.ts (the pure validator + mutator, this module's sibling)
// and emits ONE personal, text-free commissionOrderResult event; the client
// renders localized copy off action/reason. The durable order state itself
// converges through the per-viewer commissionOrders read on the coordinator,
// which re-diffs for every affected player on the very next snapshot (no
// extra fan-out needed). Draws NO rng in any arm (commission_order.ts's own
// contract).
import type { SimContext } from '../sim_context';
import {
  acceptCommissionOrder,
  type CommissionOrderScope,
  cancelCommissionOrder,
  deliverCommissionOrder,
  openCommissionOrder,
} from './commission_order';

// The item id of a still-tracked order (open/accepted/or a terminal order
// still inside its retention window), for the open/cancel/accept success
// lines below: those three result shapes carry only orderId (deliver's
// own DeliverOrderResult is the one that already returns itemId), so this
// resolves it off the live board the same tick the mutation applied.
function commissionOrderItemId(ctx: SimContext, orderId: number | undefined): string | undefined {
  if (orderId === undefined) return undefined;
  return ctx.commissionOrderBoard.find((o) => o.id === orderId)?.itemId;
}

// The requester's display name off the same still-retained board entry, for
// the 'deliver' success line (the acting pid is the CRAFTER there, not the
// requester the "You deliver X to {name}" copy needs to name).
function commissionOrderRequesterName(
  ctx: SimContext,
  orderId: number | undefined,
): string | undefined {
  if (orderId === undefined) return undefined;
  return ctx.commissionOrderBoard.find((o) => o.id === orderId)?.requesterName;
}

export function openCommissionOrderCommand(
  ctx: SimContext,
  recipeId: string,
  scope: CommissionOrderScope,
  crafterName?: string,
  pid?: number,
): void {
  const result = openCommissionOrder(ctx, recipeId, scope, crafterName, pid);
  const meta = ctx.players.get(pid ?? ctx.primaryId);
  ctx.emit({
    type: 'commissionOrderResult',
    action: 'open',
    ok: result.ok,
    orderId: result.orderId,
    itemId: result.ok ? commissionOrderItemId(ctx, result.orderId) : undefined,
    reason: result.reason,
    pid: meta?.entityId,
  });
}

export function cancelCommissionOrderCommand(ctx: SimContext, orderId: number, pid?: number): void {
  const itemId = commissionOrderItemId(ctx, orderId);
  const result = cancelCommissionOrder(ctx, orderId, pid);
  const meta = ctx.players.get(pid ?? ctx.primaryId);
  ctx.emit({
    type: 'commissionOrderResult',
    action: 'cancel',
    ok: result.ok,
    orderId: result.orderId,
    itemId: result.ok ? itemId : undefined,
    reason: result.reason,
    pid: meta?.entityId,
  });
}

export function acceptCommissionOrderCommand(ctx: SimContext, orderId: number, pid?: number): void {
  const itemId = commissionOrderItemId(ctx, orderId);
  const result = acceptCommissionOrder(ctx, orderId, pid);
  const meta = ctx.players.get(pid ?? ctx.primaryId);
  ctx.emit({
    type: 'commissionOrderResult',
    action: 'accept',
    ok: result.ok,
    orderId: result.orderId,
    itemId: result.ok ? itemId : undefined,
    reason: result.reason,
    pid: meta?.entityId,
  });
}

export function deliverCommissionOrderCommand(
  ctx: SimContext,
  orderId: number,
  pid?: number,
): void {
  // Resolve the requester's name off the board BEFORE the mutation (deliver
  // moves the order to 'delivered', so a post-mutation lookup would still
  // find it inside its retention window, but resolve pre-mutation to match
  // the itemId precedent above and stay correct if retention ever shrinks).
  const requesterName = commissionOrderRequesterName(ctx, orderId);
  const result = deliverCommissionOrder(ctx, orderId, pid);
  const meta = ctx.players.get(pid ?? ctx.primaryId);
  ctx.emit({
    type: 'commissionOrderResult',
    action: 'deliver',
    ok: result.ok,
    orderId: result.orderId,
    itemId: result.itemId,
    requesterName: result.ok ? requesterName : undefined,
    reason: result.reason,
    pid: meta?.entityId,
  });
}
