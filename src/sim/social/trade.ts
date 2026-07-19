// Player-to-player trade (G2), extracted verbatim from the Sim monolith behind
// SimContext. The trade SESSION + INVITE state stay Sim-owned fields (live ctx
// views: `trades`, `tradeInvites`), like E1's delayedEvents; the leave-path
// cleanup + the joint invite-expiry sweep reach them through the same seam. The
// inventory hub (addItem/removeItem/countItem) stays on Sim and is consumed via
// ctx. This is a MOVE: the statements, branches, and iteration order are
// byte-identical to the pre-move methods (the immutability waiver applies, so the
// in-place mutation of the shared TradeSession / PlayerMeta.copper is preserved).
//
// Sim keeps thin same-named delegates for the public methods so the IWorld + server
// + leave-path + tick() call sites resolve unchanged; this module draws no rng.

import type { TradeInfo } from '../../world_api';
import { addStacked, bagCapacity, countFit, removeStacked } from '../bags';
import { ITEMS } from '../data';
import { removePreferFungible } from '../items';
import type { PlayerMeta, TradeSession } from '../sim';
import type { SimContext } from '../sim_context';
import { dist2d, type InvSlot, type ItemInstancePayload } from '../types';

// A trade is only offered/kept while both parties are within this many yards;
// the drift sweep cancels an open session once they wander past TRADE_RANGE + 4.
const TRADE_RANGE = 10;

export function tradeRequest(ctx: SimContext, targetPid: number, pid?: number): void {
  const r = ctx.resolve(pid);
  const target = ctx.players.get(targetPid);
  const targetE = ctx.entities.get(targetPid);
  if (!r || !target || !targetE) return;
  if (targetPid === r.meta.entityId) return;
  if (ctx.trades.has(r.meta.entityId) || ctx.trades.has(targetPid)) {
    ctx.error(r.meta.entityId, 'A trade is already in progress.');
    return;
  }
  if (dist2d(r.e.pos, targetE.pos) > TRADE_RANGE) {
    ctx.error(r.meta.entityId, 'Target is too far away to trade.');
    return;
  }
  if (ctx.hasPendingSocialInvite(targetPid)) {
    ctx.error(r.meta.entityId, `${target.name} already has a pending invitation.`);
    return;
  }
  ctx.tradeInvites.set(targetPid, { fromPid: r.meta.entityId, expires: ctx.time + 30 });
  ctx.emit({
    type: 'tradeRequest',
    fromPid: r.meta.entityId,
    fromName: r.meta.name,
    pid: targetPid,
  });
  ctx.emit({
    type: 'log',
    text: `You have requested to trade with ${target.name}.`,
    color: '#8df',
    pid: r.meta.entityId,
  });
}

export function tradeAccept(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const invite = ctx.tradeInvites.get(r.meta.entityId);
  if (!invite || invite.expires < ctx.time) {
    ctx.error(r.meta.entityId, 'The trade request has expired.');
    return;
  }
  ctx.tradeInvites.delete(r.meta.entityId);
  if (!ctx.players.get(invite.fromPid)) return;
  if (ctx.trades.has(invite.fromPid) || ctx.trades.has(r.meta.entityId)) {
    ctx.error(r.meta.entityId, 'That player is already trading.');
    return;
  }
  const session: TradeSession = {
    a: invite.fromPid,
    b: r.meta.entityId,
    offerA: { items: [], copper: 0 },
    offerB: { items: [], copper: 0 },
    acceptedA: false,
    acceptedB: false,
  };
  ctx.trades.set(session.a, session);
  ctx.trades.set(session.b, session);
  for (const tPid of [session.a, session.b]) {
    ctx.emit({ type: 'log', text: 'Trade window opened.', color: '#8df', pid: tPid });
  }
}

export function tradeSetOffer(
  ctx: SimContext,
  items: InvSlot[],
  copper: number,
  pid?: number,
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const session = ctx.trades.get(r.meta.entityId);
  if (!session) return;
  // validate the offer against the player's bags; merge duplicate slots so
  // the offered total per item is checked, not each slot in isolation
  const merged = new Map<string, number>();
  for (const slot of items.slice(0, 6)) {
    // slots come straight off the wire — reject anything malformed
    if (!slot || typeof slot.itemId !== 'string' || !Number.isFinite(slot.count)) continue;
    const count = Math.max(1, Math.floor(slot.count));
    const def = ITEMS[slot.itemId];
    if (!def || def.kind === 'quest' || def.soulbound) continue; // quest + soulbound items never trade
    merged.set(slot.itemId, (merged.get(slot.itemId) ?? 0) + count);
  }
  const cleaned: InvSlot[] = [];
  for (const [itemId, count] of merged) {
    if (ctx.countItem(itemId, r.meta.entityId) < count) continue;
    cleaned.push({ itemId, count });
  }
  const offer = {
    items: cleaned,
    copper: Math.max(0, Math.min(Math.floor(copper), r.meta.copper)),
  };
  if (session.a === r.meta.entityId) session.offerA = offer;
  else session.offerB = offer;
  session.acceptedA = false;
  session.acceptedB = false;
}

// Removal phase of the swap: consumes one side's offer out of their bags,
// preserving each slot's ItemInstancePayload (enchants, signed materials,
// rolled quality, boundTo) for grantOffer instead of re-granting plain copies.
// removePreferFungible already reports exactly which consumed slots carried an
// instance; grantOffer only had to route those payloads back in through
// addItemInstance rather than discarding them, the same way discardItem never
// needed to because a discarded item's payload does not need to reappear
// anywhere. sellItem is NOT the same case: it records vendor buyback (items.ts
// sellItem), and buyback re-grants a plain copy today, so a sold instanced item
// still loses its payload there; that is a pre-existing sibling of this bug,
// not fixed by this change.
// BOTH removals must run before EITHER grant: when the two offers share an
// itemId, granting first inflates the counter-party's stock, so their removal
// consumes just-received copies (removeItem scans highest-index-first, exactly
// where addItemInstance pushes) and a swapped instance bounces straight back
// to its owner, or gets spared while a plain copy crosses in its place.
type PendingGrant = { itemId: string; plainCount: number; instances: ItemInstancePayload[] };

function removeOffer(ctx: SimContext, items: InvSlot[], fromPid: number): PendingGrant[] {
  const grants: PendingGrant[] = [];
  for (const s of items) {
    const instances = removePreferFungible(ctx, s.itemId, s.count, fromPid);
    grants.push({ itemId: s.itemId, plainCount: s.count - instances.length, instances });
  }
  return grants;
}

function grantOffer(ctx: SimContext, grants: PendingGrant[], toPid: number): void {
  for (const g of grants) {
    if (g.plainCount > 0) ctx.addItem(g.itemId, g.plainCount, toPid);
    for (const instance of g.instances) ctx.addItemInstance(g.itemId, instance, toPid);
  }
}

export function tradeConfirm(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const session = ctx.trades.get(r.meta.entityId);
  if (!session) return;
  if (session.a === r.meta.entityId) session.acceptedA = true;
  else session.acceptedB = true;
  if (!(session.acceptedA && session.acceptedB)) return;

  const metaA = ctx.players.get(session.a);
  const metaB = ctx.players.get(session.b);
  if (!metaA || !metaB) {
    tradeCancel(ctx, session.a);
    return;
  }
  // final validation before the atomic swap
  const valid =
    session.offerA.copper <= metaA.copper &&
    session.offerB.copper <= metaB.copper &&
    offerCovered(ctx, session.offerA.items, session.a) &&
    offerCovered(ctx, session.offerB.items, session.b);
  if (!valid) {
    for (const tPid of [session.a, session.b])
      ctx.error(tPid, 'Trade failed: items or money no longer available.');
    closeTrade(ctx, session);
    return;
  }
  // capacity gate: each side must fit what they RECEIVE after what they GIVE
  // leaves their bags (simulated on a scratch copy; nothing moved yet). A
  // receive is not uniformly fungible: grantOffer (below) grants each
  // instanced copy via addItemInstance, which always takes a fresh slot and
  // never merges into a plain stack of the same itemId (bags.ts addStacked
  // skips slots with `.instance`). fitsAll alone assumes every unit of a
  // receive can stack, which under-predicts slot usage whenever the giver's
  // stock for that item is (partly) instanced copies, letting a receiver end
  // up over capacity. Mirror removePreferFungible's own split here: only the
  // giver's fungible stock can stack on arrival; the rest needs one free slot
  // each, exactly like the real transfer.
  const fitsAfterSwap = (
    meta: PlayerMeta,
    giverPid: number,
    gives: InvSlot[],
    receives: InvSlot[],
  ): boolean => {
    const scratch = meta.inventory.map((s) => ({ ...s }));
    for (const s of gives) removeStacked(scratch, s.itemId, s.count);
    const capacity = bagCapacity(meta.bags);
    for (const s of receives) {
      const instancedCount = Math.max(0, s.count - ctx.countFungibleItem(s.itemId, giverPid));
      const plainCount = s.count - instancedCount;
      if (plainCount > 0) {
        if (countFit(scratch, capacity, s.itemId, plainCount) < plainCount) return false;
        addStacked(scratch, s.itemId, plainCount);
      }
      for (let i = 0; i < instancedCount; i++) {
        if (scratch.length >= capacity) return false;
        scratch.push({ itemId: s.itemId, count: 1, instance: {} });
      }
    }
    return true;
  };
  if (
    !fitsAfterSwap(metaA, session.b, session.offerA.items, session.offerB.items) ||
    !fitsAfterSwap(metaB, session.a, session.offerB.items, session.offerA.items)
  ) {
    for (const tPid of [session.a, session.b])
      ctx.error(tPid, 'Trade failed: not enough bag space.');
    closeTrade(ctx, session);
    return;
  }
  // swap
  metaA.copper = metaA.copper - session.offerA.copper + session.offerB.copper;
  metaB.copper = metaB.copper - session.offerB.copper + session.offerA.copper;
  const grantsToB = removeOffer(ctx, session.offerA.items, session.a);
  const grantsToA = removeOffer(ctx, session.offerB.items, session.b);
  grantOffer(ctx, grantsToB, session.b);
  grantOffer(ctx, grantsToA, session.a);
  for (const tPid of [session.a, session.b]) {
    ctx.emit({ type: 'log', text: 'Trade complete.', color: '#8df', pid: tPid });
    ctx.emit({ type: 'tradeDone', pid: tPid });
  }
  // The goods have moved; count the completed trade for both sides, but only when
  // something actually changed hands. A zero-item, zero-copper double-confirm still
  // completes (and emits tradeDone), but it is not a trade for deed purposes:
  // soc_first_trade must not unlock on an empty handshake.
  const nonEmpty =
    session.offerA.items.length > 0 ||
    session.offerB.items.length > 0 ||
    session.offerA.copper > 0 ||
    session.offerB.copper > 0;
  if (nonEmpty) {
    ctx.bumpDeedStat(metaA, 'tradesCompleted', 1);
    ctx.bumpDeedStat(metaB, 'tradesCompleted', 1);
  }
  closeTrade(ctx, session);
}

export function tradeCancel(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const session = ctx.trades.get(r.meta.entityId);
  if (!session) return;
  for (const tPid of [session.a, session.b]) {
    ctx.emit({ type: 'log', text: 'Trade cancelled.', color: '#8df', pid: tPid });
  }
  closeTrade(ctx, session);
}

// true when the player's bags cover the offered totals per item, summing
// duplicate slots — a per-slot check would let duplicates each pass alone
function offerCovered(ctx: SimContext, items: InvSlot[], pid: number): boolean {
  const totals = new Map<string, number>();
  for (const s of items) totals.set(s.itemId, (totals.get(s.itemId) ?? 0) + s.count);
  for (const [itemId, count] of totals) {
    if (ctx.countItem(itemId, pid) < count) return false;
  }
  return true;
}

function closeTrade(ctx: SimContext, session: TradeSession): void {
  ctx.trades.delete(session.a);
  ctx.trades.delete(session.b);
}

export function tradeFor(ctx: SimContext, pid: number): TradeSession | null {
  return ctx.trades.get(pid) ?? null;
}

export function updateTradesAndInvites(ctx: SimContext): void {
  // expire stale invites
  for (const map of [ctx.partyInvites, ctx.tradeInvites, ctx.duelInvites]) {
    for (const [pid, invite] of map) {
      if (invite.expires < ctx.time) map.delete(pid);
    }
  }
  // cancel trades when the parties drift apart
  const seen = new Set<TradeSession>();
  for (const session of ctx.trades.values()) {
    if (seen.has(session)) continue;
    seen.add(session);
    const ea = ctx.entities.get(session.a);
    const eb = ctx.entities.get(session.b);
    if (!ea || !eb || dist2d(ea.pos, eb.pos) > TRADE_RANGE + 4 || ea.dead || eb.dead) {
      tradeCancel(ctx, session.a);
    }
  }
}

// Builds the IWorld TradeInfo view for `pid` (the local/RL player). Moved verbatim
// from the `Sim.tradeInfo` getter, which now delegates here.
export function tradeInfoFor(ctx: SimContext, pid: number): TradeInfo | null {
  const t = tradeFor(ctx, pid);
  if (!t) return null;
  const mine = t.a === pid;
  const otherPid = mine ? t.b : t.a;
  return {
    otherPid,
    otherName: ctx.players.get(otherPid)?.name ?? '?',
    myOffer: mine ? t.offerA : t.offerB,
    theirOffer: mine ? t.offerB : t.offerA,
    myAccepted: mine ? t.acceptedA : t.acceptedB,
    theirAccepted: mine ? t.acceptedB : t.acceptedA,
  };
}
