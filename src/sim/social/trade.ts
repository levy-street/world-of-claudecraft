// Player-to-player trade (G2), extracted verbatim from the Sim monolith behind
// SimContext. The trade SESSION + INVITE state stay Sim-owned fields (live ctx
// views: `trades`, `tradeInvites`), like E1's delayedEvents; the leave-path
// cleanup + the joint invite-expiry sweep reach them through the same seam. The
// inventory hub stays on Sim and is consumed via ctx. Instanced payloads cross
// intact through removeOffer/grantOffer; Rift gear remains owner-bound and is
// excluded explicitly. (The original extraction was a byte-identical MOVE; the
// directed-rail hardening then changed STAGING deliberately: stagedOfferSlots
// previews the swap's own selection so the session offer carries per-copy
// identity, and removeOffer consumes those pinned copies first. The swap's
// removal/grant payload semantics are unchanged.)
//
// Sim keeps thin same-named delegates for the public methods so the IWorld + server
// + leave-path + tick() call sites resolve unchanged; this module draws no rng.

import type { TradeInfo } from '../../world_api';
import { addStacked, bagCapacity, countFit } from '../bags';
import { RIFT_GEAR_ITEM_IDS } from '../content/rift/items';
import { ITEMS } from '../data';
import { itemCopyPin } from '../item_copy_ref';
import { itemInstancePayloadsEqual } from '../item_instance_merge';
import {
  removeSellUnitsFromInventory,
  sellerSignedCharmDeprioritize,
  type VendorRemovedUnit,
} from '../items';
import type { PlayerMeta, TradeSession } from '../sim';
import type { SimContext } from '../sim_context';
import { cloneItemInstancePayload, dist2d, type InvSlot, type ItemInstancePayload } from '../types';

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

/**
 * The per-copy slots a staged line really offers, resolved at STAGE time by
 * the EXACT selection the swap will run (removeSellUnitsFromInventory with the
 * same skip and deprioritize predicates removeOffer passes), over a scratch
 * deep copy of the bags. This is what lets the counterparty's window show,
 * and the $WOC directed-offer pin fingerprint, the REAL copies on the table:
 * the old id-plus-count normalization stripped every instance payload, so a
 * buyer could never see (nor pin) which roll, enchant, or crafted provenance
 * they were agreeing to, and the H10 fingerprint degenerated to an item-id
 * comparison. Consecutive identical units group back into one slot (keyed by
 * itemCopyPin, the copy-identity rule every exchange pipe shares), so a plain
 * stack still reads as one line. The returned payloads are the scratch's own
 * deep clones and never alias the live bags.
 *
 * These slots ship to the COUNTERPARTY in full, deliberately without the
 * anonymous-pipe publicInstanceView trim (the server's tradeWire points
 * here): a trade is a consensual named exchange whose whole point is mutual
 * inspection, so charges, bind arming, and rift state are facts the other
 * player agrees TO, and the $WOC directed pin fingerprints the full
 * identity, so a trimmed wire would let two copies differing only in hidden
 * fields alias one agreement. The per-tick diff cost rides the change-gated
 * wire serialization; its bound is BAG CAPACITY, not the six input lines
 * (each staged line expands into one slot per distinct copy identity, so a
 * line of six distinct instanced units becomes six slots), tens of rows at
 * the worst and the window renders them all uncapped.
 */
function stagedOfferSlots(meta: PlayerMeta, itemId: string, count: number): InvSlot[] {
  const scratch: InvSlot[] = (meta.inventory ?? []).map((s) => ({
    ...s,
    ...(s.instance === undefined ? {} : { instance: cloneItemInstancePayload(s.instance) }),
  }));
  const units = removeSellUnitsFromInventory(
    scratch,
    itemId,
    count,
    isTradeLocked,
    sellerSignedCharmDeprioritize(meta.name, itemId),
  );
  const out: InvSlot[] = [];
  const key = (instance: ItemInstancePayload | undefined, crafted: string | undefined): string =>
    itemCopyPin({
      itemId,
      count: 1,
      ...(instance === undefined ? {} : { instance }),
      ...(crafted === undefined ? {} : { craftedRecipeId: crafted }),
    });
  for (const u of units) {
    const prev = out[out.length - 1];
    if (prev && key(prev.instance, prev.craftedRecipeId) === key(u.instance, u.craftedRecipeId)) {
      prev.count += 1;
      continue;
    }
    out.push({
      itemId,
      count: 1,
      ...(u.instance === undefined ? {} : { instance: u.instance }),
      ...(u.craftedRecipeId === undefined ? {} : { craftedRecipeId: u.craftedRecipeId }),
    });
  }
  return out;
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
  // The preview can only enrich units the INVENTORY ARRAY attributes; a
  // decoupled hub (a ctx that models counts off meta.inventory, the
  // boundCount contract above) validates a count the array cannot cover, and
  // the remainder must keep the old id-plus-count shape rather than vanish
  // from the offer the count checks just proved valid.
  const stagedLine = (itemId: string, count: number): InvSlot[] => {
    const staged = stagedOfferSlots(r.meta, itemId, count);
    const attributed = staged.reduce((n, s) => n + s.count, 0);
    if (attributed < count) staged.push({ itemId, count: count - attributed });
    return staged;
  };
  for (const [itemId, count] of merged) {
    if (ctx.countItem(itemId, r.meta.entityId) < count) continue;
    const unbound = offerableCount(ctx, r.meta, itemId);
    if (unbound < count) {
      boundDenied = true;
      if (unbound > 0) cleaned.push(...stagedLine(itemId, unbound));
      continue;
    }
    cleaned.push(...stagedLine(itemId, count));
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

/** One PLAIN unit whose crafted marker matches the staged slot's, highest
 *  index first (the walk order every removal here shares). Local because
 *  only the pinned-slot removal below wants marker-exact plain consumption;
 *  fires no quest hook (removeOffer batches ONE per staged line, the
 *  pre-preview cadence, so a 20-unit line does not emit 20 progress
 *  events). */
function removePlainMatchingUnit(
  inventory: InvSlot[],
  itemId: string,
  craftedRecipeId: string | undefined,
): VendorRemovedUnit | null {
  for (let i = inventory.length - 1; i >= 0; i--) {
    const s = inventory[i];
    if (s.itemId !== itemId || s.instance || s.craftedRecipeId !== craftedRecipeId) continue;
    s.count -= 1;
    if (s.count <= 0) inventory.splice(i, 1);
    return { instance: undefined, craftedRecipeId };
  }
  return null;
}

/** One INSTANCED unit payload-equal to the staged slot's, highest index
 *  first. Local rather than the shared removeMatchingInstance because that
 *  helper skips on the WIDER anonymous-pipe lock (bindOnTrade AND boundTo),
 *  which would silently route every armed commission copy around the pinned
 *  path; a trade locks boundTo alone (isTradeLocked). The crafted marker is
 *  matched too: it is the third leg of itemCopyPin, so a payload-equal twin
 *  differing only in provenance is a DIFFERENT staged copy (shipping it
 *  changes the disenchant anti-farming verdict and the directed-rail
 *  fingerprint), same as the plain twin's exact-marker rule. Same
 *  clone-on-survival contract as every removal here; no quest hook (see the
 *  plain twin). */
function removeInstancedMatchingUnit(
  inventory: InvSlot[],
  itemId: string,
  instance: ItemInstancePayload,
  craftedRecipeId: string | undefined,
): VendorRemovedUnit | null {
  for (let i = inventory.length - 1; i >= 0; i--) {
    const s = inventory[i];
    if (s.itemId !== itemId || !s.instance || isTradeLocked(s.instance)) continue;
    if (s.craftedRecipeId !== craftedRecipeId) continue;
    if (!itemInstancePayloadsEqual(s.instance, instance)) continue;
    const consumed = s.count === 1 ? s.instance : cloneItemInstancePayload(s.instance);
    s.count -= 1;
    if (s.count <= 0) inventory.splice(i, 1);
    return { instance: consumed, craftedRecipeId };
  }
  return null;
}

/** The offer's unit-selection walk over a caller-supplied inventory: the ONE
 *  definition removeOffer (the live swap) and fitsAfterSwap (the capacity
 *  model, over scratch copies) both run, so the copies the model budgets are
 *  the copies the swap ships BY CONSTRUCTION (the receiver-overflow class:
 *  any second model of this walk re-opens it). Mutates `inventory`; a null
 *  inventory (an unresolved giver) selects nothing, removeOffer's own
 *  failure mode. */
function shippedOfferUnits(
  ctx: SimContext,
  items: InvSlot[],
  fromPid: number,
  inventory: InvSlot[] | null,
): PendingGrant[] {
  const grants: PendingGrant[] = [];
  // The copy-choice fix: when an instanced CHARM copy must ship, the
  // seller's own self-signed copies go last (sellerSignedCharmDeprioritize
  // above owns the predicate and its scope).
  const meta = ctx.resolve(fromPid)?.meta;
  for (const s of items) {
    // The staged slots carry the EXACT copies the stage-time preview
    // selected (stagedOfferSlots), so the swap consumes those copies first:
    // what the counterparty saw is what ships. A copy that left the bags
    // between staging and confirm falls back, per missing unit, to the old
    // generic walk (same predicates), which preserves the pre-preview
    // behavior of moving SOME eligible copy rather than failing the trade;
    // offerCovered has already re-validated the per-id totals.
    //
    // A trade removal NEVER consumes a trade-locked copy. The offer
    // was already clamped to the unbound count (tradeSetOffer / offerCovered),
    // so enough unbound copies exist; the skip predicate is defence in depth so
    // the highest-index-first walks spare a bound copy even if one sits above
    // an unbound one. The deprioritize second pass makes the seller's own
    // self-signed charm copies go last.
    const units: VendorRemovedUnit[] = [];
    if (meta && inventory) {
      for (let unit = 0; unit < s.count; unit++) {
        const matched =
          s.instance !== undefined
            ? removeInstancedMatchingUnit(inventory, s.itemId, s.instance, s.craftedRecipeId)
            : removePlainMatchingUnit(inventory, s.itemId, s.craftedRecipeId);
        if (matched) {
          units.push(matched);
          continue;
        }
        // The marker guarantee ends at the pinned match above: this generic
        // fallback is marker-blind (plain-first, then any eligible instanced
        // copy), so a staged copy that LEFT the bags can ship a
        // marker-differing twin. The shipped unit still carries its own true
        // marker, so nothing is forged; it is the documented "some eligible
        // copy" posture, same as the plain twin's.
        units.push(
          ...removeSellUnitsFromInventory(
            inventory,
            s.itemId,
            1,
            isTradeLocked,
            sellerSignedCharmDeprioritize(meta.name, s.itemId),
          ),
        );
      }
    }
    grants.push({ itemId: s.itemId, units });
  }
  return grants;
}

function removeOffer(ctx: SimContext, items: InvSlot[], fromPid: number): PendingGrant[] {
  const meta = ctx.resolve(fromPid)?.meta;
  const grants = shippedOfferUnits(ctx, items, fromPid, meta ? (meta.inventory ?? []) : null);
  // ONE quest-hook fire per removal batch: the hook is a whole-log recompute
  // that emits only deltas, and every fire here would see the same final
  // state, so a single call carries the same delta SET as N per-id (or
  // per-slot) calls would, minus the wasted walks. What it does NOT preserve
  // is the relative ORDER of per-id questProgress events for a multi-id
  // offer (the hook walks the quest log in log order, where the old per-line
  // fires walked in offer order); both hosts run this same code, so the
  // reorder is cross-host consistent and accepted. Zero staged lines means
  // zero fires.
  if (meta && items.length > 0) ctx.onInventoryChangedForQuests?.(meta);
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
  // leaves their bags (simulated on scratch copies; nothing moved yet). A
  // receive is not uniformly fungible: grantOffer (below) grants each
  // instanced copy via addItemInstance, which merges only into a byte-equal
  // identical-payload same-marker stack with room and otherwise takes a
  // fresh slot, never a plain stack of the same itemId. The model therefore
  // runs the removal's OWN walk (shippedOfferUnits) over scratch bags and
  // budgets exactly the units it returns: the copies the model lands are the
  // copies the swap ships BY CONSTRUCTION. Every previous model here was a
  // second description of that walk, and each description drift re-opened
  // the receiver-overflow class (#2139, #2605, then the QA round's
  // pinned-instanced-copy-vs-fungible-first variant); a walk cannot drift
  // from itself. Units the walk cannot source (a decoupled inventory hub in
  // tests, a desynced offer) ship nothing in the real swap too, so modeling
  // no arrival for them is exact, not optimistic.
  const fitsAfterSwap = (
    meta: PlayerMeta,
    giver: PlayerMeta,
    gives: InvSlot[],
    receives: InvSlot[],
  ): boolean => {
    // What this side GIVES leaves a scratch of their own bags via the real
    // walk (an instanced give frees exactly its own slot, which an id-keyed
    // stack removal could miss).
    const scratchOwn = meta.inventory.map((s) => ({ ...s }));
    shippedOfferUnits(ctx, gives, meta.entityId, scratchOwn);
    const capacity = bagCapacity(meta.bags);
    // What the GIVER ships, resolved by the same walk over the giver's own
    // scratch, then landed unit by unit (sequential add-then-check, so a
    // stack with room for one of three units refuses the third, #2473).
    const scratchGiver = giver.inventory.map((s) => ({ ...s }));
    const shipped = shippedOfferUnits(ctx, receives, giver.entityId, scratchGiver);
    for (const g of shipped) {
      for (const u of g.units) {
        // Model the payload AS IT ARRIVES: grantOffer stamps boundTo onto an
        // armed copy on this first trade, and a stamped payload merges
        // differently than the giver's pre-stamp copy (#2139: a capacity
        // pre-check that disagrees with the real grant re-opens the overflow
        // class, in both directions).
        const arrival =
          u.instance !== undefined &&
          u.instance.bindOnTrade === true &&
          u.instance.boundTo === undefined
            ? { ...u.instance, boundTo: meta.entityId }
            : u.instance;
        if (countFit(scratchOwn, capacity, g.itemId, 1, arrival, u.craftedRecipeId) < 1) {
          return false;
        }
        addStacked(scratchOwn, g.itemId, 1, arrival, u.craftedRecipeId);
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

/**
 * End a trade session that nobody cancelled.
 *
 * Same teardown as tradeCancel, different sentence, and the difference is the
 * whole point: a session can end because the business it existed for is DONE,
 * and telling both players it was "cancelled" contradicts the sale that just
 * completed. This stays deliberately generic, with no notion of what concluded
 * outside the session, so nothing about settlement leaks into the sim.
 */
export function tradeClose(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const session = ctx.trades.get(r.meta.entityId);
  if (!session) return;
  for (const tPid of [session.a, session.b]) {
    ctx.emit({ type: 'log', text: 'Trade window closed.', color: '#8df', pid: tPid });
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
