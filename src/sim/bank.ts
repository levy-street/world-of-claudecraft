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

import type { BankBonusSource, BankInfo } from '../world_api';
import { freePoolSlots, type PoolCapacity, poolCapacityOf, poolOccupancyOf } from './bag_pools';
import { addStacked, bagPools, bagsFullError, countFit, instancedCountCap } from './bags';
import { isKnownStorageSkuId, STORAGE_SKUS } from './content/storage_charters';
import { ITEMS } from './data';
import * as deedsMod from './deeds';
import {
  boundCraftedRecipeIdOnLoad,
  sanitizeItemInstancePayloadOnLoad,
  warnDroppedInstanceKeys,
} from './item_instance_load';
import { isMergeableInstancePayload } from './item_instance_merge';
import { isMaterialItemId } from './material_ids';
import { sanitizeRiftGearInstance } from './rift/progression';
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

/** Maximum personal-bank capacity bought through the expansion ladder, not
 * including the base, entitlement bonus, or socketed bags. This semantic
 * geometry constant lets wire/UI code validate the counter without importing
 * or naming the server-authoritative price table. */
export const BANK_PURCHASED_SLOTS_MAX = BANK_EXPANSION_PRICES.length * BANK_EXPANSION_SLOTS;

/** The most bonus slots the server's entitlement registry can grant: +2 email,
 *  +2 Discord, +2 wallet, +2 per qualified referral capped at 5 (+10), so 16.
 *  This is the load-path clamp for `bonusSlots` (a tampered save must not mint
 *  capacity the registry cannot grant). The server-side registry ceiling is pinned
 *  equal to this constant (tests/bank_entitlements.test.ts), so a future source
 *  (X, Twitch) bumps BOTH in the same change or that tripwire goes red. */
export const BANK_MAX_BONUS_SLOTS = 16;

/** Bank bag sockets: a second, independent way to grow the bank, sitting as a
 *  tier ABOVE the twelve-rung slot ladder (which is grandfathered untouched).
 *  Each unlocked socket holds one bag item out of the player economy, and the
 *  socketed bag's slots join the bank's two-pool budget exactly like a carried
 *  bag joins the backpack's (bankPools below). DISTINCT from bags.ts
 *  BAG_SOCKETS (the carried count, pinned separately): the two counts may
 *  diverge in a future tuning and must never alias. */
export const BANK_BAG_SOCKETS = 4;
/** Copper cost of each successive socket unlock, cheapest first, charged the
 *  exact-copper way BANK_EXPANSION_PRICES is (100g / 200g / 350g / 500g; 1g is
 *  10000 copper). Data-as-code like the ladder: the price is always this table
 *  lookup, never a client-supplied value. These are the locked launch
 *  defaults; the server-side override seam is storage_prices.ts, and
 *  tests/bank_sockets.test.ts pins them as literals. */
export const BANK_SOCKET_PRICES: readonly number[] = [1000000, 2000000, 3500000, 5000000];

/** Coerce a persisted/stamped bonus-slot value into [0, BANK_MAX_BONUS_SLOTS]. */
export function clampBonusSlots(raw: unknown): number {
  return Math.max(0, Math.min(BANK_MAX_BONUS_SLOTS, Math.floor(Number(raw)) || 0));
}

/** Bump the runtime-only change signal for the owner-only `bank` wire key
 *  (PlayerMeta.bankWireRev, the vaultWireRev twin): called from EVERY write to
 *  meta.bank state a bankInfoFor projection can observe (deposit, withdraw,
 *  both slot-grant rails, the bonus stamp, and the three socket commands in
 *  bank_sockets.ts), so the server's snapshot gate (server/bank_wire.ts) can
 *  skip rebuilding an unchanged projection every tick. Never persisted. */
export function bumpBankWireRev(meta: { bankWireRev: number }): void {
  meta.bankWireRev++;
}

/** Cheap proximity + revision signature for the owner-only `bank` wire (the
 *  materials_vault vaultInfoWireRevFor twin): null unless the player resolves
 *  AND stands within reach of a banker, exactly the gate bankInfoFor applies,
 *  so a null-vs-number flip re-emits on bank open/close and the rev covers
 *  every mutation between. */
export function bankInfoWireRevFor(ctx: SimContext, pid: number): number | null {
  const r = ctx.resolve(pid);
  if (!r || !nearBanker(ctx, r.e)) return null;
  return r.meta.bankWireRev;
}

/** Write the host-stamped bank bonus onto a character, the ONE place that write
 *  happens. Called from addPlayer on BOTH the saved-state and brand-new-character
 *  arms: a first-ever join can already have earned account bonuses. Values are
 *  host-trusted but clamped to the registry ceiling anyway, and the breakdown rows
 *  are cloned at this write boundary so the caller keeps no live reference.
 *
 *  It lives here rather than at the sim.ts call site for the reason emptyBankState
 *  and savedBankState do: the bank blob's shape is owned by ONE module, so a future
 *  bonus-slot field lands here once instead of at every writer. */
export function applyBankBonusStamp(
  meta: { bank: BankState; bankBonusSources: BankBonusSource[]; bankWireRev: number },
  stamp: { bonusSlots: number; sources: readonly BankBonusSource[] },
): void {
  meta.bank.bonusSlots = clampBonusSlots(stamp.bonusSlots);
  meta.bankBonusSources = stamp.sources.map((s) => ({ ...s }));
  // bonusSlots and the breakdown rows both ride bankInfoFor.
  bumpBankWireRev(meta);
}

/** The narrow context slice bankPurchasedSlotsFor reads, declared structurally
 *  rather than as SimContext on purpose: ONE implementation then serves both
 *  hosts, the offline Sim getter passing the real SimContext and
 *  server/bank_wire.ts's self-block emitter passing its own BankSim.ctx sliver.
 *  The alternative was a second thin Sim delegate, and sim.ts sits at a
 *  zero-margin monolith ceiling. Least privilege is the happy side effect: this
 *  read cannot reach anything but the ladder counter. */
export interface BankLadderCtx {
  // `pid` is REQUIRED here even though SimContext declares it optional (which
  // still satisfies this by parameter contravariance). An omitted pid takes
  // SimContext's default-PRIMARY-player path, so an undefined leaking in through
  // a number-typed field would quietly answer for a different character instead
  // of returning null. Nothing can reach that today; requiring it costs a token.
  resolve(pid: number): { meta: { bank: { purchasedSlots: number } } } | null;
}

/** The character's purchased ladder position, readable ANYWHERE (Bank Storage
 *  phase 15). Unlike bankInfoFor below there is deliberately NO banker-proximity
 *  gate: the Strongbox store opens anywhere in the world and gates its charter
 *  list on this number, so gating the read would reproduce the very blindness
 *  ruling 17 records. A pure scalar read: no rng, no clock, no clone, and no live
 *  sim reference handed out. null means the pid resolves to no player, never zero.
 *
 *  THE ONE PROPERTY CALLERS DEPEND ON, at its true scope: for as long as one
 *  character stays RESIDENT (one addPlayer, on one host) this only ever GROWS.
 *  bankBuySlots and bankGrantStorageSlots are the only writers and both are strict
 *  increases; sanitizeBankState clamps on the load path, which runs at join before
 *  any reader exists, and cannot lower a legitimate value because its clamp
 *  ceiling and the grant ceiling are the same table length by construction
 *  (resolveDimension in storage_prices.ts refuses an override of a different
 *  length, pinned both ways in tests/storage_prices.test.ts). tests/bank.test.ts
 *  pins the monotonicity across that whole surface, because the store's fit gate
 *  is only safe while it holds.
 *
 *  RESIDENCY IS NARROWER THAN A CLIENT SESSION, and saying "a session" hid that.
 *  A FRESH JOIN that reloads a row written before the last rung legitimately
 *  comes back LOWER, and there are two reachable ways in. The GOLD rung is the
 *  one with a real window: bank_buy_slots writes no character save, so it waits
 *  on the periodic autosave and an unclean realm death inside that window loses
 *  it. (The Claudium grant does NOT ride that window: it forces its own save at
 *  apply and settles behind the confirmation, so its exposure is only the
 *  apply-to-save gap.) The other way in is the escrow quarantine, which is
 *  stronger than a race: a quarantined session's saves are refused outright, so
 *  nothing it did after its last save can EVER become durable, and planJoin then
 *  refuses the resume so the client re-joins from that row (server/linkdead.ts).
 *  The online mirror reuses one ClientWorld across a reconnect, so the lower
 *  count lands in the same open window. The count gate itself stays correct (it
 *  follows the server), and the client-side belief that does NOT is the store's
 *  carried refused-grant set, which src/ui/charter_fit_memory.ts drops when it
 *  sees the count move down.
 *
 *  The load clamp's floor onto the BANK_EXPANSION_SLOTS grid is only harmless
 *  while every legitimate value is a multiple of it, which is a property of the
 *  GRANT TABLE rather than of this file: tests/bank.test.ts pins it, because an
 *  off-grid charter would make the next join drop the remainder and break the
 *  monotonicity above.
 *
 *  PERSONAL BANK ONLY. src/sim/guild_bank.ts carries an identically named
 *  `purchasedSlots` on the guild BOOK, and that one DOES decrease (the escrow
 *  revert path). Widening this read or BankLadderCtx to serve the guild ladder
 *  would silently kill the property the store's fit gate rests on. */
export function bankPurchasedSlotsFor(ctx: BankLadderCtx, pid: number): number | null {
  const r = ctx.resolve(pid);
  return r ? r.meta.bank.purchasedSlots : null;
}

/** THE one storage-purchase key length bound, shared by every layer that
 *  touches a key: the /api/claudium/spend storage gate refuses a longer key,
 *  bankGrantStorageSlots refuses to APPLY one, and sanitizeBankState refuses
 *  to LOAD one. The three must agree or the exactly-once guard breaks: a key
 *  that applies but cannot persist (or persists but cannot load) silently
 *  vanishes from appliedStorageKeys while the slots survive, and once the
 *  pending row ages out a replayed receipt re-grants for free (the phase 11
 *  review round's one BLOCKING finding). Well above any real key (UUIDs are
 *  36 chars) and well below the btree index tuple bound (~2704 bytes). */
export const BANK_STORAGE_KEY_MAX_LENGTH = 200;

/** A character's bank: a pooled item list plus its slot-budget contributions.
 *  `purchasedSlots` is always a multiple of BANK_EXPANSION_SLOTS in [0, 72];
 *  `bonusSlots` is server-stamped at join by the entitlement registry (0 offline).
 *  `unlockedSockets` is the count of gold-bought bag sockets in
 *  [0, BANK_BAG_SOCKETS], unlocked in order, cheapest first; `socketBags` holds
 *  the bare bag item id sitting in each socket (null = empty), exactly the
 *  PlayerMeta.bags shape, and always has BANK_BAG_SOCKETS entries after load. */
export interface BankState {
  inventory: InvSlot[];
  purchasedSlots: number;
  bonusSlots: number;
  unlockedSockets: number;
  socketBags: (string | null)[];
  /** Idempotency keys of Claudium storage purchases already applied to this
   *  bank (Bank Storage phase 11). The exactly-once dedupe for a paid grant
   *  lives HERE, in the same persisted blob as the purchasedSlots counter it
   *  guards, so a crash between the in-memory apply and the character save
   *  can never split the two: a replayed receipt either finds the key and
   *  refuses, or finds neither key nor slots and applies both again. Bounded
   *  by construction: every applied grant consumes at least one 6-slot rung
   *  of the 72-slot ladder, so at most 12 keys ever accumulate. */
  appliedStorageKeys: string[];
}

/** The persisted JSONB shape of BankState: the socket fields and the applied
 *  storage-purchase keys are OPTIONAL and omitted while at their defaults
 *  (zero sockets, nothing socketed, no Claudium purchase ever applied), so
 *  every save written before each feature existed loads cleanly and every
 *  at-default save stays byte-equal to what it was (the toolEffectSlots
 *  omission idiom; savedBankState below is the one write path).
 *  sanitizeBankState always materializes all three fields on the way in, so
 *  runtime code never sees them absent. */
export type SavedBankState = Omit<
  BankState,
  'unlockedSockets' | 'socketBags' | 'appliedStorageKeys'
> &
  Partial<Pick<BankState, 'unlockedSockets' | 'socketBags' | 'appliedStorageKeys'>>;

/** A fresh character's bank, every field at its default. The ONE construction
 *  path for a bank that has no save behind it (Sim.addPlayer and the
 *  sanitize fallback both use it), so a new BankState field is added here
 *  once, never per call site. */
export function emptyBankState(): BankState {
  return {
    inventory: [],
    purchasedSlots: 0,
    bonusSlots: 0,
    unlockedSockets: 0,
    socketBags: Array<string | null>(BANK_BAG_SOCKETS).fill(null),
    appliedStorageKeys: [],
  };
}

/** The bank's LADDER slot budget: base plus copper-bought plus server-stamped
 *  bonus slots. This is the general-pool base the socket-aware split
 *  (bankPools) builds on, NOT the whole budget once bags are socketed; fit
 *  questions go through bankPools. Over-capacity inventories are tolerated (a
 *  tampered/legacy save may overflow); capacity only blocks new deposits. */
export function bankCapacity(bank: BankState): number {
  return BANK_BASE_SLOTS + bank.purchasedSlots + bank.bonusSlots;
}

/** The bank's two-pool slot budget: the ladder budget above is the
 *  general-pool base, and every socketed bag adds its slots to the pool its
 *  kind feeds, exactly like carried bags (bag_pools.ts owns the split and the
 *  materials-first allocation rule). Every bank fit gate takes this split,
 *  never a flat number, so no call site can quietly keep the old
 *  single-pool model. */
export function bankPools(bank: BankState): PoolCapacity {
  return poolCapacityOf(bankCapacity(bank), bank.socketBags);
}

export type MoveRefusal = 'invalid' | 'no_fit';
/** Why a 'no_fit' refused: 'space' is pool exhaustion for the request (no
 *  free slot the item's pool allows; partial byte-equal merge room counts as
 *  exhaustion, since the remaining SLOTS are what pool allocation is about),
 *  while 'instanced_units' is unit granularity: free usable slots EXIST, but
 *  the slot's NON-MERGEABLE payload absorbs only one unit per fresh slot, so
 *  the indivisible whole cannot land. A MERGEABLE payload never earns the
 *  label: fresh slots absorb full stacks of it, so a refusal with free slots
 *  left (a hand-shaped over-stackSize stack) is a slot shortage that
 *  addStacked's splitting could not cover, which IS pool exhaustion.
 *  Every sim-built non-mergeable slot carries one unit and lands in any free
 *  slot, so 'instanced_units' is reachable only through a tolerated
 *  hand-shaped save's multi-unit non-mergeable stack; the refusal LINE still
 *  must not blame pool allocation for it. */
export type NoFitCause = 'space' | 'instanced_units';
export interface MoveResult {
  moved: number;
  refusal?: MoveRefusal;
  noFitCause?: NoFitCause;
}

/** Move one source slot's items into a destination container, ALL-OR-NOTHING: the
 *  full requested count moves or nothing does. Container-agnostic (no ctx, no pid,
 *  no policy: quest-deny is the caller's concern), so the guild-bank/loadout seam
 *  reuses it. Mutates the two arrays ONLY on success.
 *
 *  - `count` undefined = the whole stack.
 *  - An instanced slot (#1165 per-instance payload) moves as ONE indivisible unit
 *    regardless of count (its units can never be split from their payload).
 *    Identical-payload stacking: the units merge into a byte-equal
 *    mergeable dest stack with room and otherwise land in a fresh deep-cloned
 *    dest slot (countFit/addStacked carry the payload AND the slot's
 *    craftedRecipeId, which an instanced slot can carry too), refusing
 *    'no_fit' only when the whole count cannot land.
 *  - A fungible slot reuses the bags.ts stacking rules (countFit/addStacked),
 *    threading slot.craftedRecipeId through both calls so a plain crafted stack
 *    (InvSlot.craftedRecipeId, no `instance`) keeps its provenance marker and
 *    only merges with a same-recipe dest stack: the move fits only when every
 *    requested copy fits, then tops up dest stacks and appends fresh ones. A
 *    partial count decrements the source; a whole-stack move splices the
 *    source entry out. */
export function moveBetweenContainers(
  source: InvSlot[],
  sourceIndex: number,
  count: number | undefined,
  dest: InvSlot[],
  destPools: PoolCapacity,
): MoveResult {
  if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= source.length) {
    return { moved: 0, refusal: 'invalid' };
  }
  const slot = source[sourceIndex];

  // Instanced: the whole slot moves as one unit (a per-instance payload can never
  // be split from its units), merging into a byte-equal dest stack when one has
  // room and taking a fresh (deep-cloned) dest slot otherwise.
  // craftedRecipeId is threaded through BOTH calls here for exactly the reason
  // the plain arm below spells out: countFit and addStacked key their merge on
  // it, so omitting it strips the marker off any slot that carries an instance
  // payload AND a craft provenance. Two independent reviews found this arm the
  // same way: a crafted weapon that was worn while enchanted is precisely that
  // shape, and so is commissioned sub-rare equipment, whose crafted provenance
  // lives ONLY at slot level. Either way one bank round trip launders a
  // self-crafted item into an indistinguishable found one and it disenchants
  // for the enchanting skill the anti-farm gate exists to deny. addStacked's
  // merge predicate already compares the marker, so a marker-bearing slot never
  // merges into an unmarked stack. Both calls take it or neither does:
  // threading it into only one would make the fit check and the grant disagree
  // about which stacks are mergeable, which is a no_fit-vs-overflow divergence
  // rather than a laundering one.
  if (slot.instance) {
    const fit = countFit(
      dest,
      destPools,
      slot.itemId,
      slot.count,
      slot.instance,
      slot.craftedRecipeId,
    );
    if (fit < slot.count) {
      // Granularity ONLY when the payload is non-mergeable AND a free slot
      // the item's pool allows exists: partial byte-equal merge room with
      // zero free slots IS pool exhaustion ('space'), and so is a MERGEABLE
      // payload short of slots (addStacked would split it across fresh
      // slots, so "cannot be split" would lie about it; only a tolerated
      // hand-shaped save's over-stackSize stack reaches that shape).
      const cause: NoFitCause =
        !isMergeableInstancePayload(slot.instance) &&
        freePoolSlots(dest, destPools, slot.itemId, isMaterialItemId) > 0
          ? 'instanced_units'
          : 'space';
      return { moved: 0, refusal: 'no_fit', noFitCause: cause };
    }
    addStacked(dest, slot.itemId, slot.count, slot.instance, slot.craftedRecipeId);
    source.splice(sourceIndex, 1);
    return { moved: slot.count };
  }

  const want = count === undefined ? slot.count : Math.floor(count);
  if (!(want > 0) || want > slot.count) return { moved: 0, refusal: 'invalid' };
  // Thread the plain-stack craftedRecipeId marker (bags.ts InvSlot.craftedRecipeId)
  // into BOTH the fit check and the grant: without it a bank deposit/withdraw round
  // trip strips the marker (addStacked/countFit key their merge on it), silently
  // laundering a crafted item's disenchant-gate provenance into a plain drop, the
  // same class of bug the trade/market fix closed.
  if (countFit(dest, destPools, slot.itemId, want, undefined, slot.craftedRecipeId) < want) {
    // A fungible shortfall is always pool space: the request is divisible, so
    // any partial room simply is not enough room for the amount asked.
    return { moved: 0, refusal: 'no_fit', noFitCause: 'space' };
  }
  addStacked(dest, slot.itemId, want, undefined, slot.craftedRecipeId);
  if (want >= slot.count) source.splice(sourceIndex, 1);
  else slot.count -= want;
  return { moved: want };
}

/** How close a player must stand to a banker NPC to use the bank. Mirrors the
 *  World Market's reach (nearMerchant in market.ts): INTERACT_RANGE + 2, inclusive. */
const BANKER_RANGE = INTERACT_RANGE + 2;

/** True when the player entity stands within reach of any live banker NPC. Iterates
 *  the ctx.bankerIds anchor list (seeded by the Sim ctor) against the live entities,
 *  the same liveness checks nearMerchant uses (present + kind 'npc'). Exported so
 *  the guild bank (guild_bank.ts) shares the ONE proximity gate with the personal
 *  bank rather than growing a second reach rule. */
export function nearBanker(ctx: SimContext, e: Entity): boolean {
  for (const id of ctx.bankerIds) {
    const b = ctx.entities.get(id);
    if (b && b.kind === 'npc' && dist2d(e.pos, b.pos) <= BANKER_RANGE) return true;
  }
  return false;
}

/** The in-reach banker's templateId, or null when none: the same scan as
 *  nearBanker, resolved to an identity for the deeds NPC ledger. Exported for
 *  the socket commands (bank_sockets.ts), which credit banker business through
 *  the same ONE scan rather than growing a second reach rule. */
export function nearBankerTemplateId(ctx: SimContext, p: Entity): string | null {
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
  // The socket-derived two-pool split (bankPools), never a flat budget: a
  // socketed materials-only satchel adds capacity only materials may take,
  // and countFit inside the move consults the same materials-first
  // allocation rule the carried bags use (bag_pools.ts). Computed once; the
  // no_fit refusal below reads the SAME split so line and gate cannot drift.
  const pools = bankPools(meta.bank);
  const result = moveBetweenContainers(
    meta.inventory,
    slotIndex,
    count,
    meta.bank.inventory,
    pools,
  );
  if (result.refusal === 'no_fit') {
    // The cause is DISCRIMINATED by the move itself (MoveResult.noFitCause).
    // 'instanced_units' means free slots EXIST and only the payload's
    // indivisibility refused, so both pool lines would lie; it gets its own
    // line (re-localized via src/ui/sim_i18n.ts, every sim literal's rule).
    if (result.noFitCause === 'instanced_units') {
      ctx.error(meta.entityId, 'That stack cannot be split to fit the space left in your bank.');
      return;
    }
    // Pool-honest refusal: with the two-pool meter on screen, "full" is a lie
    // when the only room left is materials-only satchel capacity a
    // non-material item may not take. Same occupancy read as the fit gate
    // (bag_pools.ts poolOccupancyOf under the shared material taxonomy).
    const occupancy = poolOccupancyOf(meta.bank.inventory, pools, isMaterialItemId);
    if (!isMaterialItemId(slot.itemId) && pools.materials - occupancy.materialsUsed > 0) {
      ctx.error(meta.entityId, 'Only materials fit in the space left in your bank.');
    } else {
      ctx.error(meta.entityId, 'Your bank is full.');
    }
    return;
  }
  if (result.refusal) return; // 'invalid': malformed input (cheat/desync), no player line
  bumpBankWireRev(meta);
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
    bagPools(meta.bags),
  );
  if (result.refusal === 'no_fit') {
    // The deposit arm's discrimination, mirrored (MoveResult.noFitCause):
    // 'instanced_units' means free bag slots EXIST and only the payload's
    // indivisibility refused, so "Your bags are full." would lie about the
    // same stack the deposit path names honestly; it gets its own line
    // (re-localized via src/ui/sim_i18n.ts, every sim literal's rule).
    if (result.noFitCause === 'instanced_units') {
      ctx.error(meta.entityId, 'That stack cannot be split to fit the space left in your bags.');
      return;
    }
    bagsFullError(ctx, meta.entityId);
    return;
  }
  if (result.refusal) return; // 'invalid': malformed input (cheat/desync), no player line
  bumpBankWireRev(meta);
  ctx.onInventoryChangedForQuests(meta);
  // A completed withdrawal is banker business; the gate above guarantees a banker.
  const bankerId = nearBankerTemplateId(ctx, p);
  if (bankerId) deedsMod.onBankerBusinessForDeeds(ctx, meta, bankerId);
}

/** Buy the next 6-slot bank expansion for exact copper, non-refundable. Blocked at
 *  the purchase cap (the resolved table's length, equal to BANK_EXPANSION_PRICES.length
 *  by construction) and when the player cannot afford the table price; neither
 *  refusal mutates anything. Prices come from ctx.storagePrices (the boot-resolved
 *  table storage_prices.ts builds), never a client-supplied value. */
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
  if (purchases >= ctx.storagePrices.bankExpansions.length) {
    ctx.error(meta.entityId, 'Your bank cannot be expanded further.');
    return;
  }
  const price = ctx.storagePrices.bankExpansions[purchases];
  if (meta.copper < price) {
    ctx.error(meta.entityId, 'You cannot afford that bank expansion.');
    return;
  }
  meta.copper -= price;
  meta.bank.purchasedSlots += BANK_EXPANSION_SLOTS;
  bumpBankWireRev(meta);
  ctx.notice(meta.entityId, 'You purchase additional bank slots.');
  // A completed expansion is banker business; the gate above guarantees a banker.
  const bankerId = nearBankerTemplateId(ctx, p);
  if (bankerId) deedsMod.onBankerBusinessForDeeds(ctx, meta, bankerId);
  // purchasedSlots feeds a deed meter, so re-check this player's triggers.
  ctx.markDeedsDirty(meta.entityId);
}

/** Every outcome of bankGrantStorageSlots. 'fits' is the dry-run success arm
 *  (nothing mutated); 'applied' carries the ladder move for the caller's
 *  ledger row. Refusals are silent return values, never player lines: the
 *  grant is machine-initiated (the Claudium purchase flow), so the server
 *  decides what, if anything, to surface. */
export type StorageGrantResult =
  | { status: 'applied'; purchasedSlotsBefore: number; purchasedSlotsAfter: number }
  | { status: 'fits' }
  | { status: 'already_applied' }
  | { status: 'no_player' }
  | { status: 'unknown_sku' }
  | { status: 'invalid_key' }
  | { status: 'not_next_rung' }
  | { status: 'does_not_fit' };

/** Apply one Claudium storage SKU's slot grant to a character's bank, exactly
 *  once per purchase key: the SERVER-ORIGINATED half of the phase 11 purchase
 *  flow. Deliberately NOT a client command: it is absent from the ws command
 *  allowlist and from IWorld, so a client can never send it; the server calls
 *  it through ctx after the idempotent spend receipt (the pbe_boost.ts
 *  direct-ctx precedent). Deterministic given (state, args): no rng draw, no
 *  clock read, no proximity gate (the buyer paid wherever they stand), no
 *  copper movement, and no dead-player refusal (the receipt is already paid,
 *  so withholding the grant would strand it).
 *
 *  ALL admission rules live here, the one entry point (the bankBuySlots
 *  pattern): the key dedupe against appliedStorageKeys, the FULL-grant fit
 *  check against the purchasable ceiling (REFUSES rather than clamps, so a
 *  partial grant cannot exist), and the next-rung rule for single-rung SKUs
 *  (a rung SKU applies only at exactly its ladder position, so a stale
 *  receipt can neither skip ahead nor replay a lower rung). `dryRun` answers
 *  the same rules without mutating, which is what the server's pre-spend
 *  validation calls; keeping both modes on one body is what keeps the
 *  request-time check and the apply-time re-check from drifting apart.
 *
 *  On success the counter moves and the key lands in the SAME persisted blob
 *  (see BankState.appliedStorageKeys for why that co-location is the
 *  exactly-once guarantee), the buyer gets the existing purchase notice, and
 *  the purchasedSlots deed meter re-checks. No banker-business deed credit:
 *  that deed records transacting AT a banker, and no banker is present. */
export function bankGrantStorageSlots(
  ctx: SimContext,
  pid: number,
  skuId: string,
  purchaseKey: string,
  opts: { dryRun?: boolean } = {},
): StorageGrantResult {
  // Own-property lookup, never the prototype chain: a bracket read would make
  // '__proto__' / 'toString' truthy, skip both refusal gates on undefined
  // fields, and write NaN into purchasedSlots. Unreachable through today's
  // allowlisted route, but this body claims to hold ALL admission rules and
  // the recovery path re-enters with an itemId read back from a table row.
  if (!isKnownStorageSkuId(skuId)) return { status: 'unknown_sku' };
  const sku = STORAGE_SKUS[skuId];
  // Refuse in the sim what the sim cannot durably persist: a key past the
  // shared bound would apply, save, and then be DROPPED by sanitize on the
  // next load, silently voiding the exactly-once guard (see
  // BANK_STORAGE_KEY_MAX_LENGTH).
  if (purchaseKey === '' || purchaseKey.length > BANK_STORAGE_KEY_MAX_LENGTH) {
    return { status: 'invalid_key' };
  }
  const r = ctx.resolve(pid);
  if (!r) return { status: 'no_player' };
  const { meta } = r;
  const bank = meta.bank;
  if (bank.appliedStorageKeys.includes(purchaseKey)) return { status: 'already_applied' };
  // The same resolved table bankBuySlots caps against (length-stable under
  // any override, so this equals BANK_EXPANSION_PRICES.length by construction).
  const ceiling = ctx.storagePrices.bankExpansions.length * BANK_EXPANSION_SLOTS;
  if (bank.purchasedSlots + sku.grantSlots > ceiling) return { status: 'does_not_fit' };
  const purchases = Math.floor(bank.purchasedSlots / BANK_EXPANSION_SLOTS);
  if (sku.ladderIndex !== undefined && sku.ladderIndex !== purchases) {
    return { status: 'not_next_rung' };
  }
  if (opts.dryRun) return { status: 'fits' };
  const purchasedSlotsBefore = bank.purchasedSlots;
  bank.purchasedSlots += sku.grantSlots;
  bank.appliedStorageKeys.push(purchaseKey);
  bumpBankWireRev(r.meta);
  // The same notice the gold buy emits (matched by sim_i18n; no new string).
  ctx.notice(meta.entityId, 'You purchase additional bank slots.');
  // purchasedSlots feeds a deed meter, so re-check this player's triggers.
  ctx.markDeedsDirty(meta.entityId);
  return { status: 'applied', purchasedSlotsBefore, purchasedSlotsAfter: bank.purchasedSlots };
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
    purchases < ctx.storagePrices.bankExpansions.length
      ? ctx.storagePrices.bankExpansions[purchases]
      : null;
  const pools = bankPools(bank);
  // The same taxonomy-predicate binding bags.ts wires into its gates: the
  // readout must count occupancy with the identical rule the deposit gate
  // enforces, or the meter and the refusal disagree.
  const occupancy = poolOccupancyOf(bank.inventory, pools, isMaterialItemId);
  return {
    slots: bank.inventory.map(cloneInvSlot),
    // Both pools summed, written out rather than totalPoolCapacity() because
    // tests/pool_wiring_pins.test.ts bans that token in this file as a
    // pool-collapse revert needle; this is a display total, never a fit answer.
    capacity: pools.general + pools.materials,
    purchasedSlots: bank.purchasedSlots,
    bonusSlots: bank.bonusSlots,
    nextExpansionCost,
    // Boundary clone, like slots: rows are server-stamped at join and read-only
    // display data, but a caller must never hold a live sim reference.
    bonusSources: meta.bankBonusSources.map((s) => ({ ...s })),
    socketsUnlocked: bank.unlockedSockets,
    // Boundary clone, like slots: never a live sim reference.
    socketBags: [...bank.socketBags],
    nextSocketCost:
      bank.unlockedSockets < BANK_BAG_SOCKETS
        ? ctx.storagePrices.bankSockets[bank.unlockedSockets]
        : null,
    generalCapacity: pools.general,
    materialsCapacity: pools.materials,
    generalUsed: occupancy.generalUsed,
    materialsUsed: occupancy.materialsUsed,
  };
}

/** The ONE load path for persisted bank state. Tampered/legacy saves sanitize;
 *  INVENTORY items are NEVER destroyed (an unknown-but-string itemId stays as
 *  dormant recoverable data, the mail precedent). The one deliberate exception
 *  lives on the socket arm below: a bag ID in a socket the save never
 *  unlocked, or one that is not a real bag, loads as an empty socket (the
 *  carried-socket anti-tamper rule; keeping it would mint unpaid capacity).
 *  Over-capacity inventories are tolerated (never truncated). purchasedSlots
 *  is clamped into range and floored to a whole expansion so the price
 *  indexing stays coherent. Every row's instance payload
 *  takes the shared load bound (item_instance_load.ts): junk KEYS drop, the row
 *  itself never does. `owner` names the character in that bound's dev-channel
 *  log only, and is optional because the unit tests call this with a raw blob
 *  and no character at all. When the caller passes `droppedSink` (Sim.addPlayer
 *  does, to aggregate every container into ONE line per character load), drops
 *  are pushed there instead of logged here; a sink-less call still logs one
 *  aggregate line per CALL, never one per row. */
export function sanitizeBankState(
  raw: unknown,
  owner?: string,
  droppedSink?: string[],
  ownerId?: number,
): BankState {
  if (!raw || typeof raw !== 'object') {
    return emptyBankState();
  }
  const r = raw as {
    inventory?: unknown;
    purchasedSlots?: unknown;
    bonusSlots?: unknown;
    unlockedSockets?: unknown;
    socketBags?: unknown;
    appliedStorageKeys?: unknown;
  };
  const inventory: InvSlot[] = [];
  const localDrops: string[] = droppedSink ?? [];
  if (Array.isArray(r.inventory)) {
    for (const entry of r.inventory) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as {
        itemId?: unknown;
        count?: unknown;
        instance?: unknown;
        craftedRecipeId?: unknown;
      };
      if (typeof e.itemId !== 'string' || e.itemId === '') continue;
      const hasInstance = !!e.instance && typeof e.instance === 'object';
      // The ONE shared doctrine helper judges the RAW marker (the fix-wave
      // review found this arm re-implementing the rule with its own quieter
      // reporting: a non-string or oversized marker vanished silently here
      // while the same corruption was reported on the bag and buyback arms).
      const rawMarker: { itemId: string; craftedRecipeId?: unknown } = {
        itemId: e.itemId,
        craftedRecipeId: e.craftedRecipeId,
      };
      boundCraftedRecipeIdOnLoad(rawMarker, localDrops, 'bank');
      const craftedRecipeId = rawMarker.craftedRecipeId as string | undefined;
      // The shared tamper ceiling (bags.ts instancedCountCap, also applied to
      // the carried-inventory hydration in Sim.addPlayer): stack cap for a
      // counted instanced slot (including an in-place locked whole stack), 1
      // for a charge-bearing payload, and an unknown item def stays dormant
      // uncapped data like the plain arm.
      const instanceCap = instancedCountCap(
        ITEMS[e.itemId],
        hasInstance ? (e.instance as InvSlot['instance']) : undefined,
      );
      const count = Math.min(instanceCap, Math.max(1, Math.floor(Number(e.count)) || 1));
      const slot: InvSlot = hasInstance
        ? { itemId: e.itemId, count, instance: e.instance as InvSlot['instance'] }
        : { itemId: e.itemId, count };
      if (craftedRecipeId !== undefined) slot.craftedRecipeId = craftedRecipeId;
      const cleaned = cloneInvSlot(slot);
      // Rift rebuild FIRST, exactly as the bags and equipment arms order it
      // (the whole-branch review: this arm and the buyback arm skipped the
      // rebuild, so the bound's deliberate rift skip left banked rift rows
      // unvalidated). The rebuild reduces a corrupt-but-valid rift row to
      // bounded keys; a refusal drops the instance silently, the equip arm's
      // anti-tamper rule. ownerId absent (a sink-less unit caller) skips the
      // rebuild rather than rebuilding against a wrong owner.
      if (cleaned.instance?.rift && ownerId !== undefined) {
        const rebuilt = sanitizeRiftGearInstance(cleaned.itemId, cleaned.instance, ownerId);
        if (rebuilt) cleaned.instance = rebuilt;
        else delete cleaned.instance;
      }
      // The same load-side payload bound the carried bags and the equipment
      // map take (item_instance_load.ts), applied to the clone above rather
      // than to the stored row, which this function never owns.
      // Banked copies were missed by the first cut and are exactly where a
      // signed instance sits longest, so an unbounded name here would ride
      // every autosave of an account that has not logged in for months. The
      // count clamp above stands: it is computed from the payload AS STORED,
      // so dropping a junk key can never widen a tampered stack.
      if (cleaned.instance) {
        const { payload, dropped } = sanitizeItemInstancePayloadOnLoad(cleaned.instance);
        for (const d of dropped) localDrops.push(`bank.${cleaned.itemId}.${d}`);
        if (payload) cleaned.instance = payload;
        else delete cleaned.instance;
      }
      inventory.push(cleaned);
    }
  }
  // Deliberately the COMPILED table, not a resolved override: this load path
  // has no ctx, and the resolver guarantees every override keeps the compiled
  // length, so the clamp is length-stable under any override.
  // AND THE FUTURE HAZARD, recorded here rather than rediscovered: this clamp is
  // ceiling-shaped, so a later release that LENGTHENS the table makes a rollback
  // ACROSS that release destructive, because the old binary clamps the raised
  // value on load and then persists the loss. That is the professions cap-raise
  // class DEPLOY.md already names; the release that lengthens the table owes its
  // own caveat there.
  let purchasedSlots = Math.max(
    0,
    Math.min(BANK_PURCHASED_SLOTS_MAX, Math.floor(Number(r.purchasedSlots)) || 0),
  );
  purchasedSlots -= purchasedSlots % BANK_EXPANSION_SLOTS;
  // Clamped to the entitlement-registry ceiling: a tampered save must not mint more
  // capacity than the server can grant. Online joins re-stamp the real value anyway.
  const bonusSlots = clampBonusSlots(r.bonusSlots);
  // Socket fields (absent on every pre-socket save: defaults, not tampering).
  // The unlock count clamps into [0, BANK_BAG_SOCKETS]: the ceiling is the one
  // bound the sim can enforce here, the purchasedSlots precedent above. Below
  // it an offline save owner can stamp any count they like (their save, their
  // business, same as purchasedSlots); online saves are server-written, so no
  // client-authored count ever reaches this path.
  const unlockedSockets = Math.max(
    0,
    Math.min(BANK_BAG_SOCKETS, Math.floor(Number(r.unlockedSockets)) || 0),
  );
  // Socketed bag ids load under the SAME rule as a tampered carried socket
  // (Sim.addPlayer's meta.bags walk): a non-string, unknown, or non-bag id
  // loads as an empty socket. A bag id sitting in a socket the save has not
  // unlocked is tamper-minted capacity and loads empty too; the clamp above
  // never mints unlocks, and this arm never mints an occupied socket to match.
  // A materials-only satchel is a valid bag here, not tampering. Over-capacity
  // that follows from emptied sockets is tolerated like every other bank
  // overflow: contents are NEVER destroyed, deposits just stay blocked.
  const rawSockets = Array.isArray(r.socketBags) ? r.socketBags : [];
  const socketBags = Array<string | null>(BANK_BAG_SOCKETS).fill(null);
  for (let i = 0; i < BANK_BAG_SOCKETS && i < unlockedSockets; i++) {
    const id = rawSockets[i];
    socketBags[i] = typeof id === 'string' && ITEMS[id]?.kind === 'bag' ? id : null;
  }
  // The ONE destructive exception (header) is observable: every discarded
  // non-empty socket entry joins the same per-load drop aggregate as a
  // dropped payload key, so a corrupted legitimate save (a paid bag stranded
  // past a corrupt-low unlock count) leaves an audit trail instead of
  // vanishing. Bounded to the four real indices; a tampered oversized array
  // reports as one counted overflow row (the tail scan is capped so a
  // hostile million-entry array cannot balloon the sink).
  for (let i = 0; i < Math.min(rawSockets.length, BANK_BAG_SOCKETS); i++) {
    const id = rawSockets[i];
    if (id === null || id === undefined || socketBags[i] === id) continue;
    localDrops.push(`bank.socket${i}.${String(id).slice(0, 40)}`);
  }
  const overflow = rawSockets
    .slice(BANK_BAG_SOCKETS, BANK_BAG_SOCKETS + 64)
    .filter((x) => x !== null && x !== undefined).length;
  if (overflow > 0) localDrops.push(`bank.socket.overflow.${overflow}`);
  // Applied storage-purchase keys (absent on every pre-phase-11 save:
  // defaults, not tampering). A legitimate bank never exceeds 12 keys (one
  // per applied grant, each at least a whole rung), so the caps exist to keep
  // a tampered blob from riding every save. The length bound is the SHARED
  // constant every write layer enforces first (BANK_STORAGE_KEY_MAX_LENGTH):
  // client-minted keys DO reach this blob online (the phase 11 purchase flow
  // persists them), so a key only ever gets here already inside the bound,
  // and this arm dropping one means tampering, never a legitimate purchase.
  // Dropping is observable through the same per-load drop aggregate as a
  // socket drop; the diagnostic carries the index and LENGTH, never the key
  // value (keys are replay-refusal tokens, not display data).
  const APPLIED_KEY_CAP = 64;
  const rawKeys = Array.isArray(r.appliedStorageKeys) ? r.appliedStorageKeys : [];
  const appliedStorageKeys: string[] = [];
  for (let i = 0; i < rawKeys.length && i < APPLIED_KEY_CAP; i++) {
    const key = rawKeys[i];
    if (
      typeof key === 'string' &&
      key !== '' &&
      key.length <= BANK_STORAGE_KEY_MAX_LENGTH &&
      !appliedStorageKeys.includes(key)
    ) {
      appliedStorageKeys.push(key);
    } else {
      localDrops.push(`bank.storageKey${i}.len${String(key).length}`);
    }
  }
  const keyOverflow = rawKeys.length > APPLIED_KEY_CAP ? rawKeys.length - APPLIED_KEY_CAP : 0;
  if (keyOverflow > 0) localDrops.push(`bank.storageKey.overflow.${keyOverflow}`);
  // Sink-less callers (the unit tests) still get the aggregate diagnostic;
  // sits after the socket arm so its drops ride the same one line per call.
  if (!droppedSink) warnDroppedInstanceKeys(owner ?? 'bank', localDrops);
  return { inventory, purchasedSlots, bonusSlots, unlockedSockets, socketBags, appliedStorageKeys };
}

/** The ONE persistence write path for BankState (the inverse of
 *  sanitizeBankState above; Sim's save path delegates here). Boundary-clones
 *  every list so the saved blob never aliases live sim state.
 *
 *  Socket fields ride only once a socket exists (unlocks never revert, and
 *  sanitize never keeps a bag in a locked socket), so every pre-socket
 *  character's save stays byte-equal (the toolEffectSlots omission idiom in
 *  sim.ts). The socketBags disjunct is belt-and-braces for a state no shipped
 *  writer can produce (a bag with zero unlocks): if it ever arose, this write
 *  keeps the id in the blob only until the NEXT load-save cycle (sanitize
 *  nulls it and logs the drop, then the following save omits both keys), a
 *  last-look diagnostic, not recovery. tests/bank_sockets.test.ts pins both
 *  the omission and the no-decrement invariant that keeps this dead.
 *
 *  appliedStorageKeys rides the same idiom: written only once a Claudium
 *  storage purchase has been applied (keys are never removed), so every
 *  pre-phase-11 save and every never-purchased save stays byte-equal. */
export function savedBankState(bank: BankState): SavedBankState {
  return {
    inventory: bank.inventory.map(cloneInvSlot),
    purchasedSlots: bank.purchasedSlots,
    bonusSlots: bank.bonusSlots,
    ...(bank.unlockedSockets > 0 || bank.socketBags.some((b) => b !== null)
      ? {
          unlockedSockets: bank.unlockedSockets,
          socketBags: [...bank.socketBags],
        }
      : {}),
    ...(bank.appliedStorageKeys.length > 0
      ? { appliedStorageKeys: [...bank.appliedStorageKeys] }
      : {}),
  };
}
