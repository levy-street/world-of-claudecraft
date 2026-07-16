// Player-to-player trade (G2/G2b). The trade SESSION + INVITE state stay
// Sim-owned fields (live ctx views: `trades`, `tradeInvites`); the leave-path
// cleanup + the joint invite-expiry sweep reach them through the same seam. The
// inventory hub (addItem/removeItem/countItem) stays on Sim and is consumed via
// ctx. This module draws no rng.
//
// Two lanes:
// - items + copper only: the classic synchronous atomic swap, unchanged in
//   ordering and emissions (parity golden player_trade pins it).
// - any external pledge (Claudium / $WOC): both offers move into session escrow
//   and the session parks in 'settling'; the SERVER settles the external legs
//   (service transfer / on-chain verification) and then calls
//   tradeSettleComplete or tradeSettleFail. Escrow delivery and refunds fall
//   back to Ravenpost mail (never destroy; reaches offline owners), the same
//   doctrine the World Market and mail attachments already use.
//
// Offers are validated fungible-vs-instance aware: fungible rows only ever
// consume plain stacks (countFungibleItem/removeFungibleItem), and a
// signed/rolled/enchanted copy trades ONLY as an explicit count-1 instance row
// whose payload the sim captures from the owner's real inventory, so an
// ItemInstancePayload survives the swap intact (previously trade silently
// stripped it). Character-bound copies (`boundTo`) never trade, matching
// soulbound. Items flagged noMarketList are refused like mail/market already
// refuse them.

import type { TradeInfo } from '../../world_api';
import { bagCapacity, fitsAll, removeStacked } from '../bags';
import { ITEMS } from '../data';
import type { PlayerMeta, TradeOfferState, TradeSession } from '../sim';
import type { SimContext } from '../sim_context';
import { cloneItemInstancePayload, dist2d, type InvSlot, type ItemInstancePayload } from '../types';

// A trade is only offered/kept while both parties are within this many yards;
// the drift sweep cancels an open session once they wander past TRADE_RANGE + 4.
const TRADE_RANGE = 10;

// Offer rows per side (fungible stacks and explicit instance copies combined).
const TRADE_OFFER_SLOTS = 6;

// $WOC pledge amounts arrive as UI-units decimal strings and stay strings end to
// end inside the sim (the server converts to base units for verification; no
// float ever touches a token amount). Bounded so a canonical amount always fits
// well inside a u64 at any sane mint decimals.
const WOC_AMOUNT_RE = /^\d{1,10}(?:\.\d{1,9})?$/;

export function normalizeWocAmount(raw: string): string | null {
  if (!WOC_AMOUNT_RE.test(raw)) return null;
  const [wholeRaw, fracRaw = ''] = raw.split('.');
  const whole = wholeRaw.replace(/^0+(?=\d)/, '');
  const frac = fracRaw.replace(/0+$/, '');
  if (whole === '0' && frac === '') return null;
  return frac ? `${whole}.${frac}` : whole;
}

function emptyOffer(): TradeOfferState {
  return { items: [], copper: 0, claudium: 0, woc: '0' };
}

export function offerHasExternal(offer: TradeOfferState): boolean {
  return offer.claudium > 0 || offer.woc !== '0';
}

// --- instance-row helpers -----------------------------------------------------

function recordEq(a?: Record<string, number>, b?: Record<string, number>): boolean {
  const ka = a ? Object.keys(a) : [];
  const kb = b ? Object.keys(b) : [];
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!b || b[k] !== a?.[k]) return false;
  return true;
}

export function instanceEq(a: ItemInstancePayload, b: ItemInstancePayload): boolean {
  return (
    a.signer === b.signer &&
    a.boundTo === b.boundTo &&
    (a.rolled?.quality ?? undefined) === (b.rolled?.quality ?? undefined) &&
    recordEq(a.rolled?.stats, b.rolled?.stats) &&
    recordEq(a.charges, b.charges)
  );
}

// The wire's instance field is only ever a SELECTOR the sim matches against the
// owner's real slots; the matched slot's own payload is what gets captured and
// transferred, so a client can never mint or mutate payload content.
function sanitizeInstanceSelector(raw: unknown): ItemInstancePayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const out: ItemInstancePayload = {};
  if (typeof src.signer === 'string') out.signer = src.signer;
  if (typeof src.boundTo === 'number') out.boundTo = src.boundTo;
  if (src.rolled && typeof src.rolled === 'object') {
    const r = src.rolled as Record<string, unknown>;
    const rolled: { quality?: string; stats?: Record<string, number> } = {};
    if (typeof r.quality === 'string') rolled.quality = r.quality;
    if (r.stats && typeof r.stats === 'object') {
      const stats: Record<string, number> = {};
      for (const [k, v] of Object.entries(r.stats as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v)) stats[k] = v;
      }
      rolled.stats = stats;
    }
    out.rolled = rolled;
  }
  if (src.charges && typeof src.charges === 'object') {
    const charges: Record<string, number> = {};
    for (const [k, v] of Object.entries(src.charges as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) charges[k] = v;
    }
    out.charges = charges;
  }
  return out;
}

function findInstanceSlot(
  inventory: InvSlot[],
  itemId: string,
  selector: ItemInstancePayload,
  claimed: Set<number>,
): number {
  for (let i = 0; i < inventory.length; i++) {
    if (claimed.has(i)) continue;
    const s = inventory[i];
    if (s.itemId !== itemId || !s.instance) continue;
    if (instanceEq(s.instance, selector)) return i;
  }
  return -1;
}

// Removes the exact instanced copy from the owner's bags and returns it, or
// null when it is no longer there (offer coverage is re-validated before every
// transfer, so a null here aborts nothing mid-swap).
function takeInstanceSlot(
  inventory: InvSlot[],
  itemId: string,
  selector: ItemInstancePayload,
): InvSlot | null {
  const idx = findInstanceSlot(inventory, itemId, selector, new Set());
  if (idx < 0) return null;
  const [slot] = inventory.splice(idx, 1);
  return slot;
}

// --- the command surface ------------------------------------------------------

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
    offerA: emptyOffer(),
    offerB: emptyOffer(),
    acceptedA: false,
    acceptedB: false,
    phase: 'open',
  };
  ctx.trades.set(session.a, session);
  ctx.trades.set(session.b, session);
  for (const tPid of [session.a, session.b]) {
    ctx.emit({ type: 'log', text: 'Trade window opened.', color: '#8df', pid: tPid });
  }
}

// An active decline (the invitee said no, distinct from letting the 30s invite
// lapse): drops the invite and tells the requester. Duel and party both have
// this; trade historically did not, so requesters could only infer from silence.
export function tradeDecline(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const invite = ctx.tradeInvites.get(r.meta.entityId);
  if (!invite || invite.expires < ctx.time) return;
  ctx.tradeInvites.delete(r.meta.entityId);
  if (!ctx.players.get(invite.fromPid)) return;
  ctx.emit({ type: 'tradeDeclined', byName: r.meta.name, pid: invite.fromPid });
}

export function tradeSetOffer(
  ctx: SimContext,
  items: InvSlot[],
  copper: number,
  claudium: number,
  woc: string,
  pid?: number,
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const session = ctx.trades.get(r.meta.entityId);
  if (!session || session.phase !== 'open') return;

  // validate the offer against the player's bags. Fungible rows merge per item
  // id so the offered TOTAL is checked (not each slot in isolation) and are
  // counted fungible-only, so plain rows can never consume a signed/rolled
  // copy. Instance rows are matched one real slot each, payload captured from
  // the owner's inventory.
  const fungible = new Map<string, number>();
  const instanceRows: InvSlot[] = [];
  const claimed = new Set<number>();
  for (const slot of items.slice(0, TRADE_OFFER_SLOTS)) {
    // slots come straight off the wire; reject anything malformed
    if (!slot || typeof slot.itemId !== 'string') continue;
    const def = ITEMS[slot.itemId];
    // quest, soulbound, and no-market items never trade (mail and the World
    // Market already refuse noMarketList; trade previously missed it)
    if (!def || def.kind === 'quest' || def.soulbound || def.noMarketList) continue;
    if (slot.instance !== undefined && slot.instance !== null) {
      const selector = sanitizeInstanceSelector(slot.instance);
      if (!selector || selector.boundTo !== undefined) continue; // bound copies never trade
      const idx = findInstanceSlot(r.meta.inventory, slot.itemId, selector, claimed);
      if (idx < 0) continue;
      const real = r.meta.inventory[idx].instance;
      if (!real || real.boundTo !== undefined) continue;
      claimed.add(idx);
      instanceRows.push({
        itemId: slot.itemId,
        count: 1,
        instance: cloneItemInstancePayload(real),
      });
    } else {
      if (!Number.isFinite(slot.count)) continue;
      const count = Math.max(1, Math.floor(slot.count));
      fungible.set(slot.itemId, (fungible.get(slot.itemId) ?? 0) + count);
    }
  }
  const cleaned: InvSlot[] = [...instanceRows];
  for (const [itemId, count] of fungible) {
    if (ctx.countFungibleItem(itemId, r.meta.entityId) < count) continue;
    cleaned.push({ itemId, count });
  }

  // external pledges: reject loudly when a rail is off (never silently strip a
  // pledge the player thinks they staged), clamp Claudium to the host's cached
  // balance (the service re-validates at settlement, so staleness is safe)
  const myPid = r.meta.entityId;
  const otherPid = session.a === myPid ? session.b : session.a;
  const otherOffer = session.a === myPid ? session.offerB : session.offerA;
  const rails = ctx.tradeRails(myPid);
  let claudiumPledge = 0;
  if (Number.isFinite(claudium) && claudium > 0) {
    if (!rails.claudium.available) {
      ctx.error(myPid, 'Claudium trading is not available.');
    } else {
      claudiumPledge = Math.min(Math.floor(claudium), Math.max(0, rails.claudium.balance));
    }
  }
  let wocPledge = '0';
  if (typeof woc === 'string' && woc !== '' && woc !== '0') {
    const normalized = normalizeWocAmount(woc);
    if (normalized !== null) {
      if (!rails.woc.available) {
        ctx.error(myPid, 'WOC trading is not available.');
      } else if (!rails.woc.linked) {
        ctx.error(myPid, 'Link a wallet to trade WOC.');
      } else if (!ctx.tradeRails(otherPid).woc.linked) {
        ctx.error(myPid, 'Your trade partner has no linked wallet.');
      } else if (otherOffer.woc !== '0') {
        // Single-$WOC-leg rule (fix F1a/r1#1): $WOC is irreversible, so a two-sided
        // pledge has no safe automatic terminal state (one leg can land while the
        // other never does). Only one side may offer $WOC; whoever pledges second is
        // refused. A net single leg still expresses every economic outcome.
        ctx.error(myPid, 'Only one side of a trade can offer WOC.');
      } else {
        wocPledge = normalized;
      }
    }
  }

  const offer: TradeOfferState = {
    items: cleaned,
    copper: Math.max(0, Math.min(Math.floor(copper), r.meta.copper)),
    claudium: claudiumPledge,
    woc: wocPledge,
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
  if (!session || session.phase !== 'open') return;
  if (session.a === r.meta.entityId) session.acceptedA = true;
  else session.acceptedB = true;
  if (!(session.acceptedA && session.acceptedB)) return;

  const metaA = ctx.players.get(session.a);
  const metaB = ctx.players.get(session.b);
  if (!metaA || !metaB) {
    tradeCancel(ctx, session.a);
    return;
  }
  // Belt for the single-$WOC-leg rule (fix F1a): tradeSetOffer refuses the second
  // pledge, but if both offers somehow carry $WOC by confirm time, fail closed the
  // same way the offer-invalid branch does (both sides told, session closed) rather
  // than escrow a trade with no safe automatic terminal state.
  if (session.offerA.woc !== '0' && session.offerB.woc !== '0') {
    for (const tPid of [session.a, session.b])
      ctx.error(tPid, 'Only one side of a trade can offer WOC.');
    closeTrade(ctx, session);
    return;
  }
  // final validation before anything moves
  const valid =
    session.offerA.copper <= metaA.copper &&
    session.offerB.copper <= metaB.copper &&
    offerCovered(ctx, metaA, session.offerA.items, session.a) &&
    offerCovered(ctx, metaB, session.offerB.items, session.b);
  if (!valid) {
    for (const tPid of [session.a, session.b])
      ctx.error(tPid, 'Trade failed: items or money no longer available.');
    closeTrade(ctx, session);
    return;
  }
  // capacity gate: each side must fit what they RECEIVE after what they GIVE
  // leaves their bags (simulated on a scratch copy; nothing moved yet)
  const fitsAfterSwap = (meta: PlayerMeta, gives: InvSlot[], receives: InvSlot[]): boolean => {
    const scratch = meta.inventory.map((s) => ({ ...s }));
    for (const s of gives) scratchRemove(scratch, s);
    return fitsAll(scratch, bagCapacity(meta.bags), receives);
  };
  if (
    !fitsAfterSwap(metaA, session.offerA.items, session.offerB.items) ||
    !fitsAfterSwap(metaB, session.offerB.items, session.offerA.items)
  ) {
    for (const tPid of [session.a, session.b])
      ctx.error(tPid, 'Trade failed: not enough bag space.');
    closeTrade(ctx, session);
    return;
  }

  if (offerHasExternal(session.offerA) || offerHasExternal(session.offerB)) {
    // external lane: escrow both sides NOW (goods leave the bags, so a crash,
    // logout, timeout, or cancellation can never double-spend them), capture
    // stable mail identities, and park the session for the server's settlement
    // orchestrator. The sim never talks to a service or a chain itself.
    session.charA = { key: ctx.tradeMailKey(session.a), name: metaA.name };
    session.charB = { key: ctx.tradeMailKey(session.b), name: metaB.name };
    session.escrowA = escrowOffer(ctx, metaA, session.offerA, session.a);
    session.escrowB = escrowOffer(ctx, metaB, session.offerB, session.b);
    session.phase = 'settling';
    ctx.emit({ type: 'tradeSettle', a: session.a, b: session.b, pid: session.a });
    return;
  }

  // classic lane: synchronous atomic swap, same emissions and ordering as ever
  metaA.copper = metaA.copper - session.offerA.copper + session.offerB.copper;
  metaB.copper = metaB.copper - session.offerB.copper + session.offerA.copper;
  giveOffer(ctx, session.offerA.items, metaA, session.a, session.b);
  giveOffer(ctx, session.offerB.items, metaB, session.b, session.a);
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
    // Server-swallowed accounting event (classic lane): the moved detail so the
    // server can write the trade_ledger row and force the durable two-row pair
    // save. Emitted after tradeDone so the existing event order up to tradeDone is
    // untouched; a client never receives it and the offline HUD ignores it. Gated
    // on nonEmpty (fix F7h): an all-empty double-confirm changes nothing, so the
    // server never pays a full two-row lease-fenced save + ledger write for it.
    //
    // Sizing envelope for this forced save: player-paced trades (a human accept +
    // a human confirm per side), 6-slot offers, behind the per-connection message
    // rate cap upstream, so the added save frequency stays within the pool budget.
    ctx.emit({
      type: 'tradeLedger',
      a: session.a,
      b: session.b,
      itemsA: session.offerA.items,
      itemsB: session.offerB.items,
      copperA: session.offerA.copper,
      copperB: session.offerB.copper,
      claudiumA: 0,
      claudiumB: 0,
      wocA: '0',
      wocB: '0',
      pid: session.a,
    });
  }
  closeTrade(ctx, session);
}

export function tradeCancel(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const session = ctx.trades.get(r.meta.entityId);
  if (!session) return;
  // a 'settling' session is past the point of player cancellation inside the
  // sim: external legs may already be executing, so only the server's
  // orchestrator may unwind it (tradeSettleFail) once it knows the leg states
  if (session.phase !== 'open') return;
  for (const tPid of [session.a, session.b]) {
    ctx.emit({ type: 'log', text: 'Trade cancelled.', color: '#8df', pid: tPid });
  }
  closeTrade(ctx, session);
}

// --- settlement outcomes (server-driven; unreachable offline) ------------------

export function tradeSettleComplete(ctx: SimContext, pid: number): void {
  const session = ctx.trades.get(pid);
  if (!session || session.phase !== 'settling') return;
  if (!session.charA || !session.charB || !session.escrowA || !session.escrowB) return;
  deliverGoods(ctx, session.b, session.charB, session.escrowA, 'delivery');
  deliverGoods(ctx, session.a, session.charA, session.escrowB, 'delivery');
  for (const tPid of [session.a, session.b]) {
    if (!isSameCharacter(ctx, tPid, tPid === session.a ? session.charA : session.charB)) continue;
    ctx.emit({ type: 'log', text: 'Trade complete.', color: '#8df', pid: tPid });
    ctx.emit({ type: 'tradeDone', pid: tPid });
  }
  // an external pledge is never empty, so a settled trade always counts; the
  // deed stat lives on PlayerMeta, so only still-online sides can be bumped
  const metaA = ctx.players.get(session.a);
  const metaB = ctx.players.get(session.b);
  if (metaA && isSameCharacter(ctx, session.a, session.charA))
    ctx.bumpDeedStat(metaA, 'tradesCompleted', 1);
  if (metaB && isSameCharacter(ctx, session.b, session.charB))
    ctx.bumpDeedStat(metaB, 'tradesCompleted', 1);
  // Server-swallowed accounting event (settling lane): the full moved detail
  // (escrowed goods + settled external pledges) so the server can write the
  // trade_ledger row against the open settlement. Emitted after tradeDone so the
  // established event order is untouched; escrowA/escrowB are non-null here (the
  // guard above returned otherwise).
  ctx.emit({
    type: 'tradeLedger',
    a: session.a,
    b: session.b,
    itemsA: session.escrowA.items,
    itemsB: session.escrowB.items,
    copperA: session.escrowA.copper,
    copperB: session.escrowB.copper,
    claudiumA: session.offerA.claudium,
    claudiumB: session.offerB.claudium,
    wocA: session.offerA.woc,
    wocB: session.offerB.woc,
    pid: session.a,
  });
  closeTrade(ctx, session);
}

export function tradeSettleFail(
  ctx: SimContext,
  pid: number,
  reason: 'timeout' | 'cancelled' | 'unavailable',
): void {
  const session = ctx.trades.get(pid);
  if (!session || session.phase !== 'settling') return;
  if (!session.charA || !session.charB || !session.escrowA || !session.escrowB) return;
  // unwind: each side gets their own goods back (bags first, mail as the net)
  deliverGoods(ctx, session.a, session.charA, session.escrowA, 'refund');
  deliverGoods(ctx, session.b, session.charB, session.escrowB, 'refund');
  for (const tPid of [session.a, session.b]) {
    if (!isSameCharacter(ctx, tPid, tPid === session.a ? session.charA : session.charB)) continue;
    ctx.emit({ type: 'tradeSettleFailed', reason, pid: tPid });
  }
  closeTrade(ctx, session);
}

// --- internals ------------------------------------------------------------------

// scratch-copy removal for the capacity simulation: an instance row frees its
// own whole slot (never decrements a plain stack), a fungible row decrements
// stacks highest-index-first exactly as the real removal will
function scratchRemove(scratch: InvSlot[], row: InvSlot): void {
  if (row.instance) {
    const idx = scratch.findIndex(
      (s) => s.itemId === row.itemId && s.instance && instanceEq(s.instance, row.instance!),
    );
    if (idx >= 0) scratch.splice(idx, 1);
    return;
  }
  removeStacked(scratch, row.itemId, row.count);
}

// moves one side's offered items to the counterparty, preserving instance
// payloads (offer coverage was re-validated immediately before)
function giveOffer(
  ctx: SimContext,
  items: InvSlot[],
  fromMeta: PlayerMeta,
  fromPid: number,
  toPid: number,
): void {
  for (const s of items) {
    if (s.instance) {
      const taken = takeInstanceSlot(fromMeta.inventory, s.itemId, s.instance);
      if (taken?.instance) {
        ctx.addItemInstance(s.itemId, cloneItemInstancePayload(taken.instance), toPid);
      }
    } else {
      ctx.removeFungibleItem(s.itemId, s.count, fromPid);
      ctx.addItem(s.itemId, s.count, toPid);
    }
  }
}

// pulls one side's validated offer out of their bags and wallet into escrow
function escrowOffer(
  ctx: SimContext,
  meta: PlayerMeta,
  offer: TradeOfferState,
  pid: number,
): { items: InvSlot[]; copper: number } {
  const items: InvSlot[] = [];
  for (const s of offer.items) {
    if (s.instance) {
      const taken = takeInstanceSlot(meta.inventory, s.itemId, s.instance);
      if (taken) items.push(taken);
    } else {
      ctx.removeFungibleItem(s.itemId, s.count, pid);
      items.push({ itemId: s.itemId, count: s.count });
    }
  }
  meta.copper -= offer.copper;
  return { items, copper: offer.copper };
}

// A settling session outlives its participants' presence, and entity ids are
// session-scoped: before touching a pid's bags or toasting it, prove the pid
// still belongs to the character captured at settle start.
function isSameCharacter(
  ctx: SimContext,
  pid: number,
  char: { key: string; name: string } | undefined,
): boolean {
  if (!char) return false;
  return ctx.players.has(pid) && ctx.tradeMailKey(pid) === char.key;
}

// escrow release: bags for whatever fits an online recipient, an authored
// Ravenpost letter for everything else (offline recipients, full bags). The
// letter path never refuses and never destroys, the mail/market doctrine.
function deliverGoods(
  ctx: SimContext,
  toPid: number,
  toChar: { key: string; name: string },
  goods: { items: InvSlot[]; copper: number },
  flavor: 'delivery' | 'refund',
): void {
  const online = isSameCharacter(ctx, toPid, toChar);
  const meta = online ? ctx.players.get(toPid) : undefined;
  const mailItems: InvSlot[] = [];
  let mailCopper = 0;
  if (meta) {
    meta.copper += goods.copper;
    for (const s of goods.items) {
      if (s.instance) {
        if (ctx.canAddItem(s.itemId, 1, toPid)) {
          ctx.addItemInstance(s.itemId, cloneItemInstancePayload(s.instance), toPid);
        } else {
          mailItems.push(s);
        }
      } else if (ctx.canAddItem(s.itemId, s.count, toPid)) {
        ctx.addItem(s.itemId, s.count, toPid);
      } else {
        mailItems.push(s);
      }
    }
  } else {
    mailCopper = goods.copper;
    mailItems.push(...goods.items);
  }
  if (mailItems.length > 0 || mailCopper > 0) {
    ctx.sendTradeLetter(toChar.key, toChar.name, flavor, mailCopper, mailItems);
  }
}

// true when the player's bags cover the offered rows: fungible totals are
// summed per item id and counted against PLAIN stacks only, and every instance
// row must still match a distinct real slot
function offerCovered(ctx: SimContext, meta: PlayerMeta, items: InvSlot[], pid: number): boolean {
  const totals = new Map<string, number>();
  const claimed = new Set<number>();
  for (const s of items) {
    if (s.instance) {
      const idx = findInstanceSlot(meta.inventory, s.itemId, s.instance, claimed);
      if (idx < 0) return false;
      claimed.add(idx);
    } else {
      totals.set(s.itemId, (totals.get(s.itemId) ?? 0) + s.count);
    }
  }
  for (const [itemId, count] of totals) {
    if (ctx.countFungibleItem(itemId, pid) < count) return false;
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
  // cancel trades when the parties drift apart. A 'settling' session is exempt:
  // its goods are escrowed, so distance and death are harmless while the server
  // finishes or unwinds the external legs.
  const seen = new Set<TradeSession>();
  for (const session of ctx.trades.values()) {
    if (seen.has(session)) continue;
    seen.add(session);
    if (session.phase !== 'open') continue;
    const ea = ctx.entities.get(session.a);
    const eb = ctx.entities.get(session.b);
    if (!ea || !eb || dist2d(ea.pos, eb.pos) > TRADE_RANGE + 4 || ea.dead || eb.dead) {
      tradeCancel(ctx, session.a);
    }
  }
}

// Builds the IWorld TradeInfo view for `pid` (the local/RL player). The rails
// flags are a pure UI affordance (which pledge inputs to show); every pledge is
// re-validated on set and settlement is authoritative server-side. The
// server-enriched fields (wocPay, settle) are absent here by design: the
// offline Sim knows nothing of payment URIs or leg progress.
export function tradeInfoFor(ctx: SimContext, pid: number): TradeInfo | null {
  const t = tradeFor(ctx, pid);
  if (!t) return null;
  const mine = t.a === pid;
  const otherPid = mine ? t.b : t.a;
  const myRails = ctx.tradeRails(pid);
  const otherRails = ctx.tradeRails(otherPid);
  return {
    otherPid,
    otherName: ctx.players.get(otherPid)?.name ?? '?',
    myOffer: mine ? t.offerA : t.offerB,
    theirOffer: mine ? t.offerB : t.offerA,
    myAccepted: mine ? t.acceptedA : t.acceptedB,
    theirAccepted: mine ? t.acceptedB : t.acceptedA,
    phase: t.phase,
    rails: {
      claudium: myRails.claudium.available,
      woc: myRails.woc.available && myRails.woc.linked && otherRails.woc.linked,
    },
  };
}
