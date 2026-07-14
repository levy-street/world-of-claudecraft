// Bank: the per-character deposit box, a second pooled item store alongside the
// carried backpack + bags. Like bags, capacity is POOLED (a flat slot budget over
// one inventory list, nothing pins an item to a fixed cell) and per-character: the
// state lives on PlayerMeta.bank and serializes INSIDE the character save, exactly
// like inventory/bags. The base 24 slots grow in 6-slot blocks bought with copper
// (BANK_EXPANSION_PRICES); bonus slots are server-stamped at join (server/bank_entitlements.ts).
//
// This follows the bags.ts pattern: pure move/capacity math a Vitest imports
// directly, plus the three command bodies (bankDeposit/bankWithdraw/bankBuySlots)
// as free functions `fn(ctx, ...)` behind SimContext. Backing state stays on Sim
// (PlayerMeta.bank); Sim keeps thin same-named delegates. Each op has ONE entry
// point, where the banker-proximity gate (nearBanker) lives: the
// player must stand near a `banker: true` NPC to deposit, withdraw, or buy slots.
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no Math.random/Date.now
// (enforced by tests/architecture.test.ts). This module draws NO rng.

import type { BankInfo } from '../world_api';
import { addStacked, bagCapacity, bagsFullError, countFit } from './bags';
import { ITEMS } from './data';
import * as deedsMod from './deeds';
import type { SimContext } from './sim_context';
import { cloneInvSlot, dist2d, type Entity, INTERACT_RANGE, type InvSlot } from './types';

/** Slots every character's bank starts with, before any expansion. */
export const BANK_BASE_SLOTS = 24;
/** Slots one copper expansion adds; also the granularity purchasedSlots stays on. */
export const BANK_EXPANSION_SLOTS = 6;
/** Copper cost of each successive expansion, cheapest first. The entry count is the
 *  purchase cap, so the purchased ceiling is 24 + 12*6 = 96 (an absolute 112 with the
 *  server-stamped bonus slots). Data-as-code: the price is always this table
 *  lookup, never a client-supplied value, so it is inherently overflow-safe. */
export const BANK_EXPANSION_PRICES: readonly number[] = [
  500, 1000, 2500, 5000, 10000, 20000, 40000, 80000, 150000, 300000, 600000, 1200000,
];

/** The most bonus slots the server's entitlement registry can grant: +2 email,
 *  +2 Discord, +2 wallet, +2 per qualified referral capped at 5 (+10), so 16.
 *  This is the load-path clamp for `bonusSlots` (a tampered save must not mint
 *  capacity the registry cannot grant). The server-side registry ceiling is pinned
 *  equal to this constant (tests/bank_entitlements.test.ts), so a future source
 *  (X, Twitch) bumps BOTH in the same change or that tripwire goes red. */
export const BANK_MAX_BONUS_SLOTS = 16;

/** Coerce a persisted/stamped bonus-slot value into [0, BANK_MAX_BONUS_SLOTS]. */
export function clampBonusSlots(raw: unknown): number {
  return Math.max(0, Math.min(BANK_MAX_BONUS_SLOTS, Math.floor(Number(raw)) || 0));
}

/** A character's bank: a pooled item list plus its two slot-budget contributions.
 *  `purchasedSlots` is always a multiple of BANK_EXPANSION_SLOTS in [0, 72];
 *  `bonusSlots` is server-stamped at join by the entitlement registry (0 offline). */
export interface BankState {
  inventory: InvSlot[];
  purchasedSlots: number;
  bonusSlots: number;
}

/** The bank's current slot budget. Over-capacity inventories are tolerated (a
 *  tampered/legacy save may overflow); capacity only blocks new deposits. */
export function bankCapacity(bank: BankState): number {
  return BANK_BASE_SLOTS + bank.purchasedSlots + bank.bonusSlots;
}

export type MoveRefusal = 'invalid' | 'no_fit';
export interface MoveResult {
  moved: number;
  refusal?: MoveRefusal;
}

/** Move one source slot's items into a destination container, ALL-OR-NOTHING: the
 *  full requested count moves or nothing does. Container-agnostic (no ctx, no pid,
 *  no policy: quest-deny is the caller's concern), so the guild-bank/loadout seam
 *  reuses it. Mutates the two arrays ONLY on success.
 *
 *  - `count` undefined = the whole stack.
 *  - An instanced slot (#1165 per-instance payload) moves as ONE indivisible unit
 *    regardless of count: it never merges with a dest stack (a deep clone is pushed
 *    into a fresh slot), so it needs one free dest slot or refuses 'no_fit'.
 *  - A fungible slot reuses the bags.ts stacking rules (countFit/addStacked): the
 *    move fits only when every requested copy fits, then tops up dest stacks and
 *    appends fresh ones. A partial count decrements the source; a whole-stack move
 *    splices the source entry out. */
export function moveBetweenContainers(
  source: InvSlot[],
  sourceIndex: number,
  count: number | undefined,
  dest: InvSlot[],
  destCapacity: number,
): MoveResult {
  if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= source.length) {
    return { moved: 0, refusal: 'invalid' };
  }
  const slot = source[sourceIndex];

  // Instanced: the whole slot moves as one unit (a per-instance payload can never be
  // split or merged), so it always needs a fresh dest slot.
  if (slot.instance) {
    if (dest.length >= destCapacity) return { moved: 0, refusal: 'no_fit' };
    dest.push(cloneInvSlot(slot));
    source.splice(sourceIndex, 1);
    return { moved: slot.count };
  }

  const want = count === undefined ? slot.count : Math.floor(count);
  if (!(want > 0) || want > slot.count) return { moved: 0, refusal: 'invalid' };
  if (countFit(dest, destCapacity, slot.itemId, want) < want) {
    return { moved: 0, refusal: 'no_fit' };
  }
  addStacked(dest, slot.itemId, want);
  if (want >= slot.count) source.splice(sourceIndex, 1);
  else slot.count -= want;
  return { moved: want };
}

/** How close a player must stand to a banker NPC to use the bank. Mirrors the
 *  World Market's reach (nearMerchant in market.ts): INTERACT_RANGE + 2, inclusive. */
const BANKER_RANGE = INTERACT_RANGE + 2;

/** True when the player entity stands within reach of any live banker NPC. Iterates
 *  the ctx.bankerIds anchor list (seeded by the Sim ctor) against the live entities,
 *  the same liveness checks nearMerchant uses (present + kind 'npc'). */
function nearBanker(ctx: SimContext, e: Entity): boolean {
  for (const id of ctx.bankerIds) {
    const b = ctx.entities.get(id);
    if (b && b.kind === 'npc' && dist2d(e.pos, b.pos) <= BANKER_RANGE) return true;
  }
  return false;
}

/** The in-reach banker's templateId, or null when none: the same scan as
 *  nearBanker, resolved to an identity for the deeds NPC ledger. */
function nearBankerTemplateId(ctx: SimContext, p: Entity): string | null {
  for (const id of ctx.bankerIds) {
    const b = ctx.entities.get(id);
    if (b && b.kind === 'npc' && dist2d(p.pos, b.pos) <= BANKER_RANGE) return b.templateId;
  }
  return null;
}

/** Deposit a carried-inventory slot into the bank. Quest items are refused (they
 *  are quest-bound); everything else follows the pooled capacity rules. A counted
 *  fungible leaving the bags must un-credit any collect quest, so success pokes the
 *  quest-inventory recompute. noMarketList is NOT honored here: the bank is
 *  self-storage, not a player-to-player transfer, so only quest-kind is denied. */
export function bankDeposit(
  ctx: SimContext,
  slotIndex: number,
  count?: number,
  pid?: number,
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  if (p.dead) return; // the market/mail town-service idiom: dead players bank nothing
  if (!nearBanker(ctx, p)) {
    ctx.error(meta.entityId, 'You are too far from the banker.');
    return;
  }
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= meta.inventory.length) return;
  const slot = meta.inventory[slotIndex];
  if (ITEMS[slot.itemId]?.kind === 'quest') {
    ctx.error(meta.entityId, 'You cannot store quest items in the bank.');
    return;
  }
  const result = moveBetweenContainers(
    meta.inventory,
    slotIndex,
    count,
    meta.bank.inventory,
    bankCapacity(meta.bank),
  );
  if (result.refusal === 'no_fit') {
    ctx.error(meta.entityId, 'Your bank is full.');
    return;
  }
  if (result.refusal) return; // 'invalid': malformed input (cheat/desync), no player line
  ctx.onInventoryChangedForQuests(meta);
  // A completed deposit is banker business; the gate above guarantees a banker.
  const bankerId = nearBankerTemplateId(ctx, p);
  if (bankerId) deedsMod.onBankerBusinessForDeeds(ctx, meta, bankerId);
}

/** Withdraw a bank slot back into the carried inventory: the mirror of deposit,
 *  gated by the bag capacity. A counted fungible returning to the bags must
 *  re-credit any collect quest, so success pokes the quest-inventory recompute. */
export function bankWithdraw(
  ctx: SimContext,
  slotIndex: number,
  count?: number,
  pid?: number,
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  if (p.dead) return; // the market/mail town-service idiom: dead players bank nothing
  if (!nearBanker(ctx, p)) {
    ctx.error(meta.entityId, 'You are too far from the banker.');
    return;
  }
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= meta.bank.inventory.length) {
    return;
  }
  const result = moveBetweenContainers(
    meta.bank.inventory,
    slotIndex,
    count,
    meta.inventory,
    bagCapacity(meta.bags),
  );
  if (result.refusal === 'no_fit') {
    bagsFullError(ctx, meta.entityId);
    return;
  }
  if (result.refusal) return; // 'invalid': malformed input (cheat/desync), no player line
  ctx.onInventoryChangedForQuests(meta);
  // A completed withdrawal is banker business; the gate above guarantees a banker.
  const bankerId = nearBankerTemplateId(ctx, p);
  if (bankerId) deedsMod.onBankerBusinessForDeeds(ctx, meta, bankerId);
}

/** Buy the next 6-slot bank expansion for exact copper, non-refundable. Blocked at
 *  the purchase cap (BANK_EXPANSION_PRICES.length) and when the player cannot afford
 *  the table price; neither refusal mutates anything. */
export function bankBuySlots(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  if (p.dead) return; // the market/mail town-service idiom: dead players bank nothing
  if (!nearBanker(ctx, p)) {
    ctx.error(meta.entityId, 'You are too far from the banker.');
    return;
  }
  // purchasedSlots is kept on the 6-slot grid (init 0, load floors, +6 here), so this
  // divides evenly; the floor guards a future writer from a fractional price index.
  const purchases = Math.floor(meta.bank.purchasedSlots / BANK_EXPANSION_SLOTS);
  if (purchases >= BANK_EXPANSION_PRICES.length) {
    ctx.error(meta.entityId, 'Your bank cannot be expanded further.');
    return;
  }
  const price = BANK_EXPANSION_PRICES[purchases];
  if (meta.copper < price) {
    ctx.error(meta.entityId, 'You cannot afford that bank expansion.');
    return;
  }
  meta.copper -= price;
  meta.bank.purchasedSlots += BANK_EXPANSION_SLOTS;
  ctx.notice(meta.entityId, 'You purchase additional bank slots.');
  // A completed expansion is banker business; the gate above guarantees a banker.
  const bankerId = nearBankerTemplateId(ctx, p);
  if (bankerId) deedsMod.onBankerBusinessForDeeds(ctx, meta, bankerId);
  // purchasedSlots feeds a deed meter, so re-check this player's triggers.
  ctx.markDeedsDirty(meta.entityId);
}

/** The proximity-gated bank snapshot the IWorld seam exposes (the mailInfoFor
 *  pattern): null unless the player stands within reach of a banker NPC, else a
 *  boundary-cloned view of PlayerMeta.bank. A pure read: it draws NO rng and never
 *  hands out live sim slot references. `nextExpansionCost` is the copper price of
 *  the NEXT expansion, null once every expansion has been purchased. */
export function bankInfoFor(ctx: SimContext, pid: number): BankInfo | null {
  const r = ctx.resolve(pid);
  if (!r) return null;
  const { meta, e: p } = r;
  if (!nearBanker(ctx, p)) return null;
  const bank = meta.bank;
  const purchases = Math.floor(bank.purchasedSlots / BANK_EXPANSION_SLOTS);
  const nextExpansionCost =
    purchases < BANK_EXPANSION_PRICES.length ? BANK_EXPANSION_PRICES[purchases] : null;
  return {
    slots: bank.inventory.map(cloneInvSlot),
    capacity: bankCapacity(bank),
    purchasedSlots: bank.purchasedSlots,
    bonusSlots: bank.bonusSlots,
    nextExpansionCost,
    // Boundary clone, like slots: rows are server-stamped at join and read-only
    // display data, but a caller must never hold a live sim reference.
    bonusSources: meta.bankBonusSources.map((s) => ({ ...s })),
  };
}

/** The ONE load path for persisted bank state. Tampered/legacy saves sanitize;
 *  items are NEVER destroyed (an unknown-but-string itemId stays as dormant
 *  recoverable data, the mail precedent). Over-capacity inventories are tolerated
 *  (never truncated). purchasedSlots is clamped into range and floored to a whole
 *  expansion so the price indexing stays coherent. */
export function sanitizeBankState(raw: unknown): BankState {
  if (!raw || typeof raw !== 'object') {
    return { inventory: [], purchasedSlots: 0, bonusSlots: 0 };
  }
  const r = raw as { inventory?: unknown; purchasedSlots?: unknown; bonusSlots?: unknown };
  const inventory: InvSlot[] = [];
  if (Array.isArray(r.inventory)) {
    for (const entry of r.inventory) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as { itemId?: unknown; count?: unknown; instance?: unknown };
      if (typeof e.itemId !== 'string' || e.itemId === '') continue;
      const hasInstance = !!e.instance && typeof e.instance === 'object';
      // An instanced slot forces count 1: a count above 1 would mint payload copies.
      const count = hasInstance ? 1 : Math.max(1, Math.floor(Number(e.count)) || 1);
      const slot: InvSlot = hasInstance
        ? { itemId: e.itemId, count, instance: e.instance as InvSlot['instance'] }
        : { itemId: e.itemId, count };
      inventory.push(cloneInvSlot(slot));
    }
  }
  const maxPurchased = BANK_EXPANSION_PRICES.length * BANK_EXPANSION_SLOTS;
  let purchasedSlots = Math.max(
    0,
    Math.min(maxPurchased, Math.floor(Number(r.purchasedSlots)) || 0),
  );
  purchasedSlots -= purchasedSlots % BANK_EXPANSION_SLOTS;
  // Clamped to the entitlement-registry ceiling: a tampered save must not mint more
  // capacity than the server can grant. Online joins re-stamp the real value anyway.
  const bonusSlots = clampBonusSlots(r.bonusSlots);
  return { inventory, purchasedSlots, bonusSlots };
}
