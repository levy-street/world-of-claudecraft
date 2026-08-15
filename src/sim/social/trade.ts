// Player-to-player trade (G2), extracted verbatim from the Sim monolith behind
// SimContext. The trade SESSION + INVITE state stay Sim-owned fields (live ctx
// views: `trades`, `tradeInvites`), like E1's delayedEvents; the leave-path
// cleanup + the joint invite-expiry sweep reach them through the same seam. The
// inventory hub stays on Sim and is consumed via ctx. Instanced payloads cross
// intact through removeOffer/grantOffer; Rift gear remains owner-bound and is
// excluded explicitly. This is a MOVE: the statements, branches, and iteration order are
// byte-identical to the pre-move methods (the immutability waiver applies, so the
// in-place mutation of the shared TradeSession / PlayerMeta.copper is preserved).
//
// Sim keeps thin same-named delegates for the public methods so the IWorld + server
// + leave-path + tick() call sites resolve unchanged; this module draws no rng.

import type { TradeInfo } from '../../world_api';
import { addStacked, bagCapacity, countFit, removeStacked } from '../bags';
import { RIFT_GEAR_ITEM_IDS } from '../content/rift/items';
import { ITEMS } from '../data';
import {
  removeVendorSellUnits,
  sellerSignedCharmDeprioritize,
  type VendorRemovedUnit,
} from '../items';
import type { PlayerMeta, TradeSession } from '../sim';
import type { SimContext } from '../sim_context';
import { dist2d, type InvSlot, type ItemInstancePayload } from '../types';

// A trade is only offered/kept while both parties are within this many yards;
// the drift sweep cancels an open session once they wander past TRADE_RANGE + 4.
const TRADE_RANGE = 10;
const RIFT_GEAR_ITEMS = new Set<string>(RIFT_GEAR_ITEM_IDS);

// The one trade-locked predicate (Professions 2.0). A copy is
// trade-locked once its payload carries boundTo: a bound instance stays with
// its owner and is never offered, revalidated-in, or consumed by a swap.
// (bindOnTrade only ARMS the lock; boundTo is the applied lock, stamped on the
// recipient's copy in grantOffer below.) Used at the three trade sites: the
// offerable-count gate in tradeSetOffer, the confirm-time revalidation in
// offerCovered, and the removal preference in removeOffer/fitsAfterSwap.
function isTradeLocked(instance: ItemInstancePayload | undefined): boolean {
  return instance?.boundTo !== undefined;
}

// How many held copies of itemId are trade-locked (boundTo set). A bound copy
// is always instanced, so this only ever counts instanced slots; a plain stack
// never contributes. Kept as a SUBTRACTION from ctx.countItem (offerableCount
// below) rather than a direct unbound sum so the count stays correct against
// any inventory hub: the offline Sim keeps its slots on meta.inventory, but a
// decoupled test ctx may store copies elsewhere and leave meta.inventory empty,
// where the bound count is simply zero and every copy is offerable.
function boundCount(meta: PlayerMeta, itemId: string): number {
  let n = 0;
  // `?? []`: a decoupled test ctx (tests/heroic_soulbound.test.ts's fake) may
  // model counts elsewhere and carry NO inventory array at all; per the
  // documented intent above, its bound count is simply zero.
  for (const s of meta.inventory ?? []) {
    if (s.itemId === itemId && isTradeLocked(s.instance)) n += s.count;
  }
  return n;
}

// The count of itemId the player may actually trade: the raw held total minus
// the trade-locked copies. tradeSetOffer and offerCovered gate on this instead
// of the raw held total so a bound copy is never offered nor passes final
// validation.
function offerableCount(ctx: SimContext, meta: PlayerMeta, itemId: string): number {
  return ctx.countItem(itemId, meta.entityId) - boundCount(meta, itemId);
}

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
    if (!def || def.kind === 'quest' || def.soulbound || RIFT_GEAR_ITEMS.has(slot.itemId)) {
      continue;
    }
    merged.set(slot.itemId, (merged.get(slot.itemId) ?? 0) + count);
  }
  const cleaned: InvSlot[] = [];
  // The offerable count EXCLUDES trade-locked copies. When the raw
  // held count covers the offered count but the unbound count does not, the
  // player is trying to trade a bound copy: deny ONCE for the whole offer and
  // clamp that line to the unbound copies they can actually give (dropping it
  // entirely when none is unbound). The def-level quest/soulbound silent drop
  // above stays exactly as-is.
  let boundDenied = false;
  for (const [itemId, count] of merged) {
    if (ctx.countItem(itemId, r.meta.entityId) < count) continue;
    const unbound = offerableCount(ctx, r.meta, itemId);
    if (unbound < count) {
      boundDenied = true;
      if (unbound > 0) cleaned.push({ itemId, count: unbound });
      continue;
    }
    cleaned.push({ itemId, count });
  }
  if (boundDenied) ctx.error(r.meta.entityId, 'That item is bound and cannot be traded.');
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
// preserving each removed unit's ItemInstancePayload (enchants, signed
// materials, rolled quality, boundTo) AND its plain-stack craftedRecipeId
// marker (bags.ts InvSlot.craftedRecipeId, professions/crafting.ts) for
// grantOffer instead of re-granting a marker-free plain copy. Losing the
// marker let a crafted item launder its provenance across a trade: the
// recipient's copy looked identical to a never-crafted one, so disenchanting
// it granted full Enchanting skill and bypassed the anti-farming gate
// (professions/enchanting.ts isCraftedDisenchantVictim) the same way an
// untracked vendor buyback used to before items.ts's removeVendorSellUnits/
// recordVendorBuyback started threading the marker through sell/buyback.
// Trade reuses that exact per-unit removal instead of removePreferFungible,
// which only ever reported the instanced remainder and bulk-decremented the
// plain count with no record of which stack (and therefore which marker) it
// came from.
// sellItem is the SAME threading, one pipe over: it records vendor buyback
// (items.ts recordVendorBuyback) with each consumed unit's payload and
// marker as its own deep-cloned buyback row, so a sold item round-trips
// both through buyback the way a trade round-trips them here.
// BOTH removals must run before EITHER grant: when the two offers share an
// itemId, granting first inflates the counter-party's stock, so their removal
// consumes just-received copies (removeItem scans highest-index-first, exactly
// where addItemInstance pushes) and a swapped instance bounces straight back
// to its owner, or gets spared while a plain copy crosses in its place.
type PendingGrant = { itemId: string; units: VendorRemovedUnit[] };

// The copy-choice predicate moved to items.ts (the phase 18 whole-branch
// review widened it to the vendor and discard arms, and items.ts cannot
// import from social/ without a cycle); re-exported here so every existing
// importer and the source-scrape pins keep their seam. One definition still
// feeds the real removal AND the capacity model below.
export { sellerSignedCharmDeprioritize };

function removeOffer(ctx: SimContext, items: InvSlot[], fromPid: number): PendingGrant[] {
  const grants: PendingGrant[] = [];
  // The copy-choice fix: when an instanced CHARM copy must ship, the
  // seller's own self-signed copies go last (sellerSignedCharmDeprioritize
  // above owns the predicate and its scope).
  const sellerName = ctx.resolve(fromPid)?.meta.name;
  for (const s of items) {
    // A trade removal NEVER consumes a trade-locked copy. The offer
    // was already clamped to the unbound count (tradeSetOffer / offerCovered),
    // so enough unbound copies exist; the skip predicate is defence in depth so
    // removeVendorSellUnits's highest-index-first walk spares a bound copy even
    // if one sits above an unbound one. The deprioritize second pass makes the
    // seller's own self-signed charm copies go last; a caller passing no
    // predicate keeps the single-pass walk byte-identical.
    const units = removeVendorSellUnits(
      ctx,
      s.itemId,
      s.count,
      fromPid,
      isTradeLocked,
      sellerSignedCharmDeprioritize(sellerName, s.itemId),
    );
    grants.push({ itemId: s.itemId, units });
  }
  return grants;
}

function grantOffer(ctx: SimContext, grants: PendingGrant[], toPid: number): void {
  for (const g of grants) {
    // Plain units (no instance payload) re-grant bucketed by craftedRecipeId:
    // a marker-free stack and a crafted stack of the same itemId stay two
    // separate stacks on arrival (bags.ts addStacked keys its merge on the
    // marker too), instead of one addItem call washing every plain unit's
    // provenance into whichever marker happened to be checked last.
    const plainByRecipe = new Map<string | undefined, number>();
    for (const unit of g.units) {
      if (unit.instance) continue;
      plainByRecipe.set(unit.craftedRecipeId, (plainByRecipe.get(unit.craftedRecipeId) ?? 0) + 1);
    }
    for (const [craftedRecipeId, count] of plainByRecipe) {
      // movement: the other player already held these, so the trade moves them
      // rather than sourcing them from the world (no Reliquary obtain count).
      ctx.addItem(g.itemId, count, toPid, { craftedRecipeId, movement: true });
    }
    for (const unit of g.units) {
      if (!unit.instance) continue;
      // Bind-on-trade stamp: a payload armed with bindOnTrade locks
      // to the recipient the first time it changes hands. The instances here
      // are per-unit deep clones (removeVendorSellUnits mirrors removeItem's
      // contract; the final unit of a fully-consumed slot is the original,
      // whose slot is already gone), so stamping boundTo in place is safe and
      // never aliases a surviving stack. Generic over the payload: any future
      // bind-on-trade good rides this same arm with nothing item-specific here.
      if (unit.instance.bindOnTrade === true && unit.instance.boundTo === undefined) {
        unit.instance.boundTo = toPid;
      }
      // movement: the instanced arm of the same handover (see the plain arm).
      ctx.addItemInstance(g.itemId, unit.instance, toPid, 1, {
        craftedRecipeId: unit.craftedRecipeId,
        movement: true,
      });
    }
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
  // instanced copy via addItemInstance, which merges only into a byte-equal
  // identical-payload stack with room and otherwise takes a fresh
  // slot, never a plain stack of the same itemId. fitsAll alone assumes every
  // unit of a receive can stack, which under-predicts slot usage whenever the
  // giver's stock for that item is (partly) instanced copies, letting a
  // receiver end up over capacity. Mirror removePreferFungible's own split
  // here: the giver's fungible stock stacks on arrival; the instanced
  // remainder transfers in removeOffer's EXACT walk order, highest-index
  // -first with a charm offer's seller-signed copies consumed last (the
  // sellerSignedCharmDeprioritize two-pass). One predicate definition feeds
  // both the model and the removal, so the payloads modeled merge-aware
  // against the scratch bags are the payloads the transfer actually ships.
  const fitsAfterSwap = (
    meta: PlayerMeta,
    giver: PlayerMeta,
    gives: InvSlot[],
    receives: InvSlot[],
  ): boolean => {
    const scratch = meta.inventory.map((s) => ({ ...s }));
    for (const s of gives) removeStacked(scratch, s.itemId, s.count);
    const capacity = bagCapacity(meta.bags);
    for (const s of receives) {
      const plainCount = Math.min(s.count, ctx.countFungibleItem(s.itemId, giver.entityId));
      if (plainCount > 0) {
        // grantOffer re-grants the plain units bucketed by craftedRecipeId (a
        // marker-free stack and a crafted stack of the same itemId never merge
        // on arrival, bags.ts addStacked keys on the marker); model that same
        // bucket split here, walking the giver's plain slots highest-index-
        // first (removeVendorSellUnits's order) instead of one flat
        // marker-free countFit/addStacked call, or this capacity pre-check
        // can see room in a stack the real grant cannot merge into and
        // underpredict the receiver's slot usage (#2605 review).
        const plainByRecipe = new Map<string | undefined, number>();
        let plainLeft = plainCount;
        for (let i = giver.inventory.length - 1; i >= 0 && plainLeft > 0; i--) {
          const g = giver.inventory[i];
          if (g.itemId !== s.itemId || g.instance) continue;
          const take = Math.min(g.count, plainLeft);
          plainByRecipe.set(g.craftedRecipeId, (plainByRecipe.get(g.craftedRecipeId) ?? 0) + take);
          plainLeft -= take;
        }
        for (const [craftedRecipeId, count] of plainByRecipe) {
          if (countFit(scratch, capacity, s.itemId, count, undefined, craftedRecipeId) < count)
            return false;
          addStacked(scratch, s.itemId, count, undefined, craftedRecipeId);
        }
      }
      let remaining = s.count - plainCount;
      // The same predicate the removal builds, from the same RESOLVE (the
      // fix-round review): removeOffer sources the name through
      // ctx.resolve, which answers null when either half is missing, so
      // the model must share that failure mode or a meta-present,
      // entity-absent state builds a predicate the removal never applies.
      // The model's two passes must pick the same copies in the same order
      // or the modeled payloads diverge from the shipped ones (the phase
      // 14 QA's proven overflow).
      const deprioritize = sellerSignedCharmDeprioritize(
        ctx.resolve(giver.entityId)?.meta.name,
        s.itemId,
      );
      const modelPass = (takeDeprioritized: boolean): boolean => {
        for (let i = giver.inventory.length - 1; i >= 0 && remaining > 0; i--) {
          const g = giver.inventory[i];
          // Skip trade-locked copies here too: the real transfer
          // (removeOffer) spares them, so the capacity model must walk the same
          // unbound instanced slots or it would mis-estimate the receiver's slots.
          if (g.itemId !== s.itemId || !g.instance || isTradeLocked(g.instance)) continue;
          if ((deprioritize?.(g.instance) ?? false) !== takeDeprioritized) continue;
          // Model the payload AS IT ARRIVES: grantOffer stamps boundTo onto an
          // armed copy on this first trade, and a stamped payload merges
          // differently than the giver's pre-stamp copy (#2139: a capacity
          // pre-check that disagrees with the real grant re-opens the overflow
          // class, in both directions).
          const arrival =
            g.instance.bindOnTrade === true && g.instance.boundTo === undefined
              ? { ...g.instance, boundTo: meta.entityId }
              : g.instance;
          const take = Math.min(g.count, remaining);
          remaining -= take;
          if (countFit(scratch, capacity, s.itemId, take, arrival) < take) return false;
          addStacked(scratch, s.itemId, take, arrival);
        }
        return true;
      };
      if (!modelPass(false)) return false;
      if (deprioritize && remaining > 0 && !modelPass(true)) return false;
      // Stock the giver's inventory list does not surface (a stubbed store in
      // tests, or a desynced offer the final validation above already
      // covered): the conservative one-fresh-slot-per-unit model.
      for (let i = 0; i < remaining; i++) {
        if (scratch.length >= capacity) return false;
        scratch.push({ itemId: s.itemId, count: 1, instance: {} });
      }
    }
    return true;
  };
  if (
    !fitsAfterSwap(metaA, metaB, session.offerA.items, session.offerB.items) ||
    !fitsAfterSwap(metaB, metaA, session.offerB.items, session.offerA.items)
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
// duplicate slots: a per-slot check would let duplicates each pass alone.
// Counts against the UNBOUND copies only (unboundCount), the same
// exclusion tradeSetOffer applies, so a copy bound between set-offer and
// confirm can never slip through final validation into the swap.
function offerCovered(ctx: SimContext, items: InvSlot[], pid: number): boolean {
  const meta = ctx.players.get(pid);
  const totals = new Map<string, number>();
  for (const s of items) totals.set(s.itemId, (totals.get(s.itemId) ?? 0) + s.count);
  for (const [itemId, count] of totals) {
    const available = meta ? offerableCount(ctx, meta, itemId) : ctx.countItem(itemId, pid);
    if (available < count) return false;
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
