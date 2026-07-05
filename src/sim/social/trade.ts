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
import { ITEMS } from '../data';
import type { TradeSession } from '../sim';
import type { SimContext } from '../sim_context';
import { dist2d, type InvSlot } from '../types';

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
    if (!def || def.kind === 'quest') continue; // quest items are soulbound-ish
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
  // swap
  metaA.copper = metaA.copper - session.offerA.copper + session.offerB.copper;
  metaB.copper = metaB.copper - session.offerB.copper + session.offerA.copper;
  for (const s of session.offerA.items) {
    ctx.removeItem(s.itemId, s.count, session.a);
    ctx.addItem(s.itemId, s.count, session.b);
  }
  for (const s of session.offerB.items) {
    ctx.removeItem(s.itemId, s.count, session.b);
    ctx.addItem(s.itemId, s.count, session.a);
  }
  for (const tPid of [session.a, session.b]) {
    ctx.emit({ type: 'log', text: 'Trade complete.', color: '#8df', pid: tPid });
    ctx.emit({ type: 'tradeDone', pid: tPid });
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
