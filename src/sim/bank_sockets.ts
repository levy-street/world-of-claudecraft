// Bank bag sockets: the three gold-only socket commands (Bank Storage phase
// 06). Four sockets sit as a tier ABOVE the untouched twelve-rung slot ladder
// (bank.ts BANK_EXPANSION_PRICES): each unlock is bought with exact copper,
// cheapest first, and each unlocked socket holds one bag item out of the
// player economy. A socketed bag's slots join the bank's two-pool budget
// (bank.ts bankPools over the container-agnostic bag_pools.ts split) exactly
// like a carried bag joins the backpack's.
//
// This module follows the bags.ts/bank.ts pattern: command bodies as free
// functions `fn(ctx, ...)` behind SimContext; backing state stays on Sim
// (PlayerMeta.bank, the BankState socket fields); Sim keeps thin same-named
// delegates. Every command is banker-gated through the ONE proximity gate
// (bank.ts nearBanker).
//
// Item-safety doctrine, the covenant this whole family is built on:
// - Nothing is ever destroyed by a capacity change. Unsocketing (or swapping
//   away) a bag whose removal leaves the bank over budget is ALLOWED: the bank
//   keeps every item and new deposits stay blocked until space frees, the same
//   tolerance sanitizeBankState and bag_pools.ts state. A bank-side shrink
//   guard would be theater here: unsocket-then-socket reaches the same state
//   in two legal steps, so the honest rule is one doctrine, not a bypassable
//   refusal. The compounded worst-ordering bound this yields is pinned in
//   tests/bank_sockets.test.ts.
// - The one refusal that exists is carried-side: an unsocketed bag that cannot
//   fit in the bags refuses cleanly rather than dropping anything.
// - Container moves stay on raw addStacked, NEVER the Sim addItem hub: the hub
//   bumps reliquary obtain tallies, and a socket round trip is a movement, not
//   an acquisition (the bankWithdraw precedent).
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no Math.random/
// Date.now (enforced by tests/architecture.test.ts). This module draws NO rng.

import { addStacked, bagPools, bagsFullError, canAddItem } from './bags';
import { BANK_BAG_SOCKETS, bumpBankWireRev, nearBanker, nearBankerTemplateId } from './bank';
import { ITEMS } from './data';
import * as deedsMod from './deeds';
import {
  consumeSelectedInventorySlot,
  newestMatchingSlot,
  selectedInventorySlot,
} from './item_copy_ref';
import type { SimContext } from './sim_context';

const inRange = (socket: number): boolean =>
  Number.isInteger(socket) && socket >= 0 && socket < BANK_BAG_SOCKETS;

/** Buy the next bank bag socket for exact copper, non-refundable, in order,
 *  cheapest first, exactly like the slot ladder (bankBuySlots). Blocked at the
 *  socket ceiling and when the player cannot afford the table price; neither
 *  refusal mutates anything. */
export function bankUnlockSocket(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  if (p.dead) return; // the market/mail town-service idiom: dead players bank nothing
  if (!nearBanker(ctx, p)) {
    ctx.error(meta.entityId, 'You are too far from the banker.');
    return;
  }
  const unlocked = meta.bank.unlockedSockets;
  if (unlocked >= BANK_BAG_SOCKETS) {
    ctx.error(meta.entityId, 'Your bank has no more bag sockets to unlock.');
    return;
  }
  // The boot-resolved table (defaults to BANK_SOCKET_PRICES), never client-supplied.
  const price = ctx.storagePrices.bankSockets[unlocked];
  if (meta.copper < price) {
    ctx.error(meta.entityId, 'You cannot afford that bag socket.');
    return;
  }
  meta.copper -= price;
  meta.bank.unlockedSockets += 1;
  bumpBankWireRev(meta);
  ctx.notice(meta.entityId, 'You unlock a bank bag socket.');
  // A completed unlock is banker business; the gate above guarantees a banker.
  const bankerId = nearBankerTemplateId(ctx, p);
  if (bankerId) deedsMod.onBankerBusinessForDeeds(ctx, meta, bankerId);
  // unlockedSockets feeds a deed meter, so re-check this player's triggers.
  ctx.markDeedsDirty(meta.entityId);
}

/** Socket a carried bag into an unlocked bank socket (first empty when
 *  omitted). Socketing into an occupied socket swaps: the old bag returns to
 *  the slot the new one freed, so the swap itself never needs spare carried
 *  room (the equipBag model, including its documented tolerated imprecision:
 *  consuming off a legacy overstacked bag slot frees no slot, so the carried
 *  inventory can land one slot past budget, blocking new adds and destroying
 *  nothing). The bank side takes NO capacity guard: a swap that shrinks a pool
 *  leaves the bank in the tolerated over-capacity state (module header). */
export function bankSocketBag(
  ctx: SimContext,
  itemId: string,
  socket?: number,
  pid?: number,
  slotIndex?: number,
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  if (p.dead) return; // the market/mail town-service idiom: dead players bank nothing
  if (!nearBanker(ctx, p)) {
    ctx.error(meta.entityId, 'You are too far from the banker.');
    return;
  }
  const def = ITEMS[itemId];
  if (def?.kind !== 'bag') return;
  if (ctx.countItem(itemId, meta.entityId) <= 0) {
    ctx.error(meta.entityId, "You don't have that item.");
    return;
  }
  const unlocked = meta.bank.unlockedSockets;
  let target = socket;
  if (target === undefined) {
    // First empty UNLOCKED socket; sanitize guarantees no bag ever sits in a
    // locked one, so the scan is bounded by the unlock count.
    target = -1;
    for (let i = 0; i < unlocked; i++) {
      if (meta.bank.socketBags[i] === null) {
        target = i;
        break;
      }
    }
    if (target === -1) {
      ctx.error(meta.entityId, 'You have no open bank bag socket.');
      return;
    }
  }
  // Malformed or locked targets return silently (cheat/desync; the UI never
  // offers a locked socket), the equipBag inRange idiom.
  if (!inRange(target) || target >= unlocked) return;
  // Bank sockets store only a bare item id, exactly like carried sockets
  // (meta.bags): there is nowhere to park an instance payload or a
  // craftedRecipeId while a bag is socketed, so refuse a payload-bearing copy
  // outright BEFORE consuming it rather than destroying the payload on the
  // way out (the equipBag #2837 peek, same tri-state contract).
  const peeked =
    slotIndex !== undefined
      ? selectedInventorySlot(meta.inventory, itemId, slotIndex)
      : newestMatchingSlot(meta.inventory, itemId);
  // ONE refusal for the whole tri-state, and the COUNT predicate is
  // load-bearing rather than defensive. selectedInventorySlot already refuses a
  // slot with count < 1; the id-only peek (newestMatchingSlot) does not, and the
  // consume below walks PAST such a slot: Sim.removeItem takes
  // Math.min(s.count, 1), so a count of 0 yields nothing, splices the slot and
  // continues to the next match. A corrupt carried row can therefore steer the
  // peek onto a plain slot while the consume destroys an INSTANCED copy beneath
  // it (a negative count is worse: the remaining budget GROWS and the whole
  // instanced stack goes). The carried load path clamps counts only upward, so
  // such a row survives a load whole, which is the threat model
  // item_instance_load.ts already designs against. Refusing here keeps the peek
  // and the consume on ONE slot and conserves items in both directions: nothing
  // destroyed, and no bag minted out of an empty slot. materials_vault.ts
  // guards its own deposits with the same predicate.
  if (!peeked || !Number.isInteger(peeked.count) || peeked.count < 1) {
    ctx.error(meta.entityId, "You don't have that item.");
    return;
  }
  if (peeked.instance || peeked.craftedRecipeId !== undefined) {
    ctx.error(meta.entityId, 'That bag cannot be socketed while it carries a special property.');
    return;
  }
  // A named slot consumes exactly that copy; an id-only call keeps the legacy
  // newest-first walk (ctx.removeItem) untouched. Tri-state-aware like
  // equipBag: a silent no-op keeps a peek/consume divergence from socketing a
  // bag AND leaving its source copy behind.
  if (slotIndex !== undefined) {
    if (consumeSelectedInventorySlot(meta.inventory, itemId, slotIndex) === null) return;
  } else {
    ctx.removeItem(itemId, 1, meta.entityId);
  }
  const old = meta.bank.socketBags[target];
  // Raw addStacked, never the addItem hub (module header: a swap is a
  // movement, and the hub would inflate reliquary obtain tallies).
  if (old) addStacked(meta.inventory, old, 1);
  meta.bank.socketBags[target] = itemId;
  bumpBankWireRev(meta);
  ctx.onInventoryChangedForQuests(meta);
  ctx.emit({
    type: 'log',
    text: `Socketed ${def.name} into your bank.`,
    color: '#8f8',
    pid: meta.entityId,
  });
  // Completed socketing is banker business; the gate above guarantees a banker.
  const bankerId = nearBankerTemplateId(ctx, p);
  if (bankerId) deedsMod.onBankerBusinessForDeeds(ctx, meta, bankerId);
}

/** Return the bag in `socket` to the carried inventory. Refused ONLY when the
 *  bag item itself cannot fit in the bags (nothing is ever force-dropped); the
 *  bank side is deliberately guardless, so a removal that leaves the banked
 *  items over the shrunk budget is ALLOWED and lands in the tolerated
 *  over-capacity state: every item kept, new deposits blocked until space
 *  frees (module header; the divergence from unequipBag's carried-side
 *  refusal is the phase 06 design, not an oversight). */
export function bankUnsocketBag(ctx: SimContext, socket: number, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  if (p.dead) return; // the market/mail town-service idiom: dead players bank nothing
  if (!nearBanker(ctx, p)) {
    ctx.error(meta.entityId, 'You are too far from the banker.');
    return;
  }
  if (!inRange(socket)) return;
  // A locked socket needs no guard of its own: sanitize and bankSocketBag
  // keep every locked slot null, so the empty-socket return covers it.
  const itemId = meta.bank.socketBags[socket];
  if (!itemId) return;
  // Carried-side fit for the returning bag: a bag is never a material, so the
  // check needs a general-pool slot (bag_pools.ts freePoolSlots via countFit).
  if (!canAddItem(meta.inventory, bagPools(meta.bags), itemId, 1)) {
    bagsFullError(ctx, meta.entityId);
    return;
  }
  meta.bank.socketBags[socket] = null;
  bumpBankWireRev(meta);
  // Raw addStacked, never the addItem hub (module header).
  addStacked(meta.inventory, itemId, 1);
  ctx.onInventoryChangedForQuests(meta);
  // def is always defined here (sanitize admits only real bag ids into
  // sockets and bankSocketBag re-checks), so the ?? arm is unreachable
  // defense: a raw id in a log line beats a crash on a broken invariant.
  const def = ITEMS[itemId];
  ctx.emit({
    type: 'log',
    text: `Unsocketed ${def?.name ?? itemId} from your bank.`,
    color: '#8f8',
    pid: meta.entityId,
  });
  // A completed unsocket is banker business; the gate above guarantees a banker.
  const bankerId = nearBankerTemplateId(ctx, p);
  if (bankerId) deedsMod.onBankerBusinessForDeeds(ctx, meta, bankerId);
}
