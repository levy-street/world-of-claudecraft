// The Guild Bank: a shared, guild-owned treasury plus pooled item store, the
// guild-scale sibling of the personal bank (bank.ts). Phase 1 (foundation)
// landed the state model, the ONE load path, the per-guild book map helpers,
// and the session-only membership stamp; Phase 2 (this file's op section)
// lands the five op bodies and the proximity/membership-gated info read (every
// stamped member may LOOK, `canEdit` marks who may act); the DB persistence
// that feeds loadGuildBank/serializeGuildBank is Phase 3.
//
// Books are keyed by the server social DB's guild id. Offline play never has a
// guild, so the map stays empty and every IWorld guild-bank member is inert.
//
// Every op follows the bank/vendor validation order (state.md): resolve, dead
// check, banker proximity, shape, policy (officer-plus rank via the session
// stamp, then the anonymous-pipe item policy: quest, soulbound, noMarketList,
// per-copy transfer locks; see guildBankPipeRefusal), price from the table,
// affordability, capacity (inside moveBetweenContainers' all-or-nothing fit
// check), then the atomic mutation, then emits. NO refusal path mutates
// anything. Deliberately NOT banker business for the Book of Deeds: the
// Gilded Strongbox NPC ledger credit (onBankerBusinessForDeeds) is scoped to
// the PERSONAL bank by design; revisit with the Phase 4 UI if wanted.
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no Math.random/
// Date.now (enforced by tests/architecture.test.ts). This module draws NO rng.

import type { GuildBankInfo } from '../world_api';
import { addStacked, bagCapacity, bagsFullError, instancedCountCap } from './bags';
import { moveBetweenContainers, nearBanker } from './bank';
import { ITEMS } from './data';
import { formatMoney } from './format_money';
import {
  boundCraftedRecipeIdOnLoad,
  sanitizeItemInstancePayloadOnLoad,
  warnDroppedInstanceKeys,
} from './item_instance_load';
import { isTransferLockedInstance, publicInstanceView } from './item_instance_transfer';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { cloneInvSlot, type InvSlot } from './types';

/** One-time fee the founder pays when a guild is created (1 gold).
 *  RESERVE-AT-GATE (revised by Phase 3 QA): deducted synchronously at the
 *  guild_create dispatch gate BEFORE any DB work and refunded on every
 *  refusal arm; charging after the commit left a deterministic fee-dodge
 *  exploit (see chargeGuildCreationFee below and docs/guild-bank/state.md). */
export const GUILD_CREATION_FEE_COPPER = 10_000;

/** Slots one treasury-bought expansion (ladder rungs 1 and up) adds. */
export const GUILD_BANK_EXPANSION_SLOTS = 6;

/** The slot grant of every ladder rung. A new guild starts with a bank of
 *  ZERO item slots (treasury gold ops work from day one; only the item store
 *  is gated): rung 0 OPENS the bank and grants the 24 base slots, paid from
 *  the CLICKING OFFICER'S OWN PURSE (the one-click classic first-tab
 *  precedent), never the treasury; rungs 1 and up are the treasury-paid
 *  6-slot expansions. */
export const GUILD_BANK_RUNG_SLOTS: readonly number[] = [
  24,
  GUILD_BANK_EXPANSION_SLOTS,
  GUILD_BANK_EXPANSION_SLOTS,
  GUILD_BANK_EXPANSION_SLOTS,
  GUILD_BANK_EXPANSION_SLOTS,
  GUILD_BANK_EXPANSION_SLOTS,
  GUILD_BANK_EXPANSION_SLOTS,
];

/** Copper price of each ladder rung, ALWAYS looked up by bought-rung count
 *  (never client-supplied). Rung 0 (9g, opens the bank) is PURSE-paid; rungs
 *  1..6 (2g50s, 5g, 10g, 25g, 50g, 100g; 192g50s total) are TREASURY-paid.
 *  Max 60 slots (24 on opening + 6 expansions of 6). */
export const GUILD_BANK_RUNG_PRICES: readonly number[] = [
  90_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000,
];

/** Every VALID purchasedSlots value: the cumulative slot total after each
 *  bought rung ([0, 24, 30, 36, 42, 48, 54, 60]). sanitizeGuildBankState
 *  floors onto this table so price indexing stays coherent even on a
 *  tampered save. */
export const GUILD_BANK_LADDER_POSITIONS: readonly number[] = GUILD_BANK_RUNG_SLOTS.reduce<
  number[]
>((positions, grant) => [...positions, positions[positions.length - 1] + grant], [0]);

/** How many ladder rungs a purchasedSlots value represents: the index of the
 *  LARGEST ladder position at or below it (a non-position value floors down,
 *  mirroring sanitizeGuildBankState, so a tampered count can never index a
 *  price it did not pay for). */
export function guildBankRungsBought(purchasedSlots: number): number {
  let rungs = 0;
  for (let i = 1; i < GUILD_BANK_LADDER_POSITIONS.length; i++) {
    if (GUILD_BANK_LADDER_POSITIONS[i] <= purchasedSlots) rungs = i;
  }
  return rungs;
}

/** Treasury ceiling in copper (100,000 gold). A deposit that would exceed it is
 *  REFUSED with an error (Phase 2 op body), never truncated; only the load path
 *  clamps, because a tampered save has no deposit to refuse. */
export const GUILD_BANK_TREASURY_CAP = 1_000_000_000;

/** Guild ranks as the server social DB models them (server/social.ts
 *  GuildRank). Redeclared here because src/sim never imports from server/; the
 *  string values are the shared contract the stamp entry point normalizes
 *  against, and tests/guild_bank.test.ts pins the two declarations in lockstep
 *  (type equality both ways plus the literal value list), so a rank added on
 *  one side without the other fails a test instead of silently stamping null. */
export const GUILD_RANKS = ['leader', 'officer', 'member'] as const;
export type GuildRank = (typeof GUILD_RANKS)[number];

/** The session-only membership stamp the server writes onto PlayerMeta (see
 *  Sim.setPlayerGuildMembership): the authorization input the guild bank's
 *  officer-plus gate reads in Phase 2. Never persisted; guilds live in the
 *  server social DB and the stamp is re-applied at join and on every
 *  membership or rank change. */
export interface GuildMembership {
  guildId: number;
  rank: GuildRank;
}

export interface GuildBankState {
  /** Copper the guild holds, always within [0, GUILD_BANK_TREASURY_CAP]. */
  treasury: number;
  /** The pooled item list; capacity only blocks new deposits (bags.ts sense). */
  inventory: InvSlot[];
  /** Granted slots across the bought ladder rungs, always a value from
   *  GUILD_BANK_LADDER_POSITIONS: 0 while the bank is UNOPENED, 24 once rung 0
   *  opened it, then +6 per treasury expansion. */
  purchasedSlots: number;
}

/** The bank's current slot budget: the sum of granted slots across bought
 *  rungs (0 while unopened). Over-capacity inventories are tolerated (a
 *  tampered/legacy save may overflow); capacity only blocks new deposits,
 *  exactly like the personal bank. */
export function guildBankCapacity(bank: GuildBankState): number {
  return GUILD_BANK_LADDER_POSITIONS[guildBankRungsBought(bank.purchasedSlots)];
}

/** Copper price of the NEXT ladder rung (a table lookup indexed by
 *  bought-rung count: rung 0 opens the bank, purse-paid; rungs 1+ expand it,
 *  treasury-paid), or null once every rung is bought. */
export function guildBankNextExpansionPrice(bank: GuildBankState): number | null {
  return GUILD_BANK_RUNG_PRICES[guildBankRungsBought(bank.purchasedSlots)] ?? null;
}

export function createEmptyGuildBankState(): GuildBankState {
  return { treasury: 0, inventory: [], purchasedSlots: 0 };
}

/** The ONE load path for persisted guild bank state (the sanitizeBankState
 *  contract): tampered/legacy shapes sanitize; items are NEVER destroyed (an
 *  unknown-but-string itemId stays as dormant recoverable data, the mail
 *  precedent); over-capacity inventories are tolerated (never truncated).
 *  treasury clamps into [0, GUILD_BANK_TREASURY_CAP]; purchasedSlots clamps
 *  into range and floors to a VALID ladder position (0, 24, 30, ..., 60) so
 *  price indexing stays coherent.
 *
 *  Every row takes the SHARED load-side bounds (src/sim/item_instance_load.ts),
 *  exactly like the personal bank arm beside it: the crafted-recipe marker
 *  through `boundCraftedRecipeIdOnLoad` and the instance payload through
 *  `sanitizeItemInstancePayloadOnLoad`, junk KEYS dropping while the row itself
 *  never does. This arm used to take both verbatim, which broke the
 *  one-sanitizer doctrine for the newest persisted container: an oversized
 *  marker or a signer string would then ride EVERY autosave of that book
 *  forever, which is also the realistic road to a book past the row size bound.
 *
 *  The rift REBUILD the personal arm can do is deliberately skipped here: it
 *  keys on an owning character and a book has no owner, which is the same
 *  branch `sanitizeBankState` takes for an ownerId-less caller. A rift copy in
 *  a book is a tampered or legacy row in the first place (rift gear rides
 *  noMarketList, so the anonymous pipe refuses it in both directions); it stays
 *  as dormant recoverable data for the operator hatch rather than being
 *  destroyed here.
 *
 *  `droppedSink` aggregates the drop diagnostics for a caller loading many
 *  books (the boot load); a sink-less call logs one aggregate line per CALL. */
export function sanitizeGuildBankState(raw: unknown, droppedSink?: string[]): GuildBankState {
  if (!raw || typeof raw !== 'object') return createEmptyGuildBankState();
  const r = raw as { treasury?: unknown; inventory?: unknown; purchasedSlots?: unknown };
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
      // The shared doctrine helper judges the RAW marker, so a non-string or
      // oversized one is dropped AND reported rather than silently kept.
      const rawMarker: { itemId: string; craftedRecipeId?: unknown } = {
        itemId: e.itemId,
        craftedRecipeId: e.craftedRecipeId,
      };
      boundCraftedRecipeIdOnLoad(rawMarker, localDrops, 'guildbank');
      const craftedRecipeId = rawMarker.craftedRecipeId as string | undefined;
      const instanceCap = instancedCountCap(
        ITEMS[e.itemId],
        hasInstance ? (e.instance as InvSlot['instance']) : undefined,
      );
      // Computed from the payload AS STORED, so dropping a junk key below can
      // never widen a tampered stack.
      const count = Math.min(instanceCap, Math.max(1, Math.floor(Number(e.count)) || 1));
      const slot: InvSlot = hasInstance
        ? { itemId: e.itemId, count, instance: e.instance as InvSlot['instance'] }
        : { itemId: e.itemId, count };
      if (craftedRecipeId !== undefined) slot.craftedRecipeId = craftedRecipeId;
      const cleaned = cloneInvSlot(slot);
      // Applied to the CLONE, never to the stored row this function does not own.
      if (cleaned.instance) {
        const { payload, dropped } = sanitizeItemInstancePayloadOnLoad(cleaned.instance);
        for (const d of dropped) localDrops.push(`guildbank.${cleaned.itemId}.${d}`);
        if (payload) cleaned.instance = payload;
        else delete cleaned.instance;
      }
      inventory.push(cleaned);
    }
  }
  if (!droppedSink) warnDroppedInstanceKeys('guildbank', localDrops);
  const maxPurchased = GUILD_BANK_LADDER_POSITIONS[GUILD_BANK_LADDER_POSITIONS.length - 1];
  let purchasedSlots = Math.max(
    0,
    Math.min(maxPurchased, Math.floor(Number(r.purchasedSlots)) || 0),
  );
  purchasedSlots = GUILD_BANK_LADDER_POSITIONS[guildBankRungsBought(purchasedSlots)];
  const treasury = Math.max(
    0,
    Math.min(GUILD_BANK_TREASURY_CAP, Math.floor(Number(r.treasury)) || 0),
  );
  return { treasury, inventory, purchasedSlots };
}

/** Install a guild's book through the ONE load path. Pure shape-in: the server
 *  hands raw JSONB in Phase 3; no SQL here. A non-positive or non-integer guild
 *  id is ignored so a tampered row can never mint a garbage key. LOAD-ONCE: a
 *  guild whose book is already live is skipped, because overwriting it would
 *  silently drop deposits not yet flushed to the DB (items are NEVER destroyed).
 *  To reload (realm maintenance, the Phase 3 disband evict), delete the map
 *  entry first; callers must always re-get the book after any evict + reload,
 *  never hold a reference across one. */
export function loadGuildBank(ctx: SimContext, guildId: number, raw: unknown): void {
  if (!Number.isInteger(guildId) || guildId <= 0) return;
  if (ctx.guildBanks.has(guildId)) return;
  ctx.guildBanks.set(guildId, sanitizeGuildBankState(raw));
}

/** Snapshot a guild's book for persistence, deep-cloned (cloneInvSlot, never a
 *  shallow spread) so the save never aliases the live inventory's mutable
 *  instance payloads. Pure shape-out: the server owns the SQL (Phase 3).
 *  Null means the guild has NO loaded book: the persistence caller must SKIP
 *  the write entirely, never persist an empty book over a real row. */
export function serializeGuildBank(ctx: SimContext, guildId: number): GuildBankState | null {
  const book = ctx.guildBanks.get(guildId);
  if (!book) return null;
  return {
    treasury: book.treasury,
    inventory: book.inventory.map(cloneInvSlot),
    purchasedSlots: book.purchasedSlots,
  };
}

/** The SANCTIONED evict: drop a guild's book from the live map. Called by the
 *  server on a committed disband (the guild_banks row cascades away with the
 *  guilds DELETE), and as the first half of the evict-then-load reload path
 *  loadGuildBank documents. Keeps the map bounded on a long-lived realm and
 *  ensures a re-created guild id can never inherit a stale book. Callers must
 *  never hold a book reference across an evict. */
export function evictGuildBank(ctx: SimContext, guildId: number): void {
  ctx.guildBanks.delete(guildId);
}

/** What a guild's live book holds, for the server's disband guard (a disband
 *  must be refused while the bank holds ANY copper or item, or the cascade
 *  delete would destroy them). Null when the guild has no loaded book: the
 *  caller must fail CLOSED on null (refuse the disband), because an unloaded
 *  book cannot prove the DB row is empty. A pure read; never mutates. */
export function guildBankHoldings(
  ctx: SimContext,
  guildId: number,
): { copper: number; items: number } | null {
  const book = ctx.guildBanks.get(guildId);
  if (!book) return null;
  return { copper: book.treasury, items: book.inventory.length };
}

/** Deduct the guild creation fee from the acting player's purse, returning the
 *  copper actually charged. RESERVE-AT-GATE (Phase 3 QA, revising the original
 *  create-then-charge decision): the server charges this SYNCHRONOUSLY at the
 *  guild_create dispatch gate, BEFORE any DB work, and refunds it on every
 *  refusal arm (refundGuildCreationFee below). Charging after the commit left
 *  a deterministic exploit: a client could pipeline guild_create with a spend
 *  (or log out) so the deferred clamped charge collected residue or nothing.
 *  The gate refuses a poor founder first, so the clamp here is defensive
 *  only. Deliberately emits NO player line (the "You found the guild" arm is
 *  the celebration; the purse delta rides the normal self snapshot). */
export function chargeGuildCreationFee(ctx: SimContext, pid: number): number {
  const r = resolveActor(ctx, pid);
  if (!r) return 0;
  const charged = Math.min(r.meta.copper, GUILD_CREATION_FEE_COPPER);
  if (charged <= 0) return 0;
  r.meta.copper -= charged;
  return charged;
}

/** Return a reserved guild creation fee to the acting player's purse (the
 *  refusal arm of the reserve-at-gate flow above: name invalid or taken,
 *  already in a guild, or the create's DB transaction failed). Clamped so the
 *  purse can never exceed the integer-safe bound; returns the copper actually
 *  refunded. Silent like the charge; refunding an unresolvable pid refunds
 *  nothing (the server logs that arm loudly for operator compensation). */
export function refundGuildCreationFee(ctx: SimContext, pid: number, amount: number): number {
  const r = resolveActor(ctx, pid);
  if (!r) return 0;
  if (!Number.isSafeInteger(amount) || amount <= 0) return 0;
  const refunded = Math.min(amount, Number.MAX_SAFE_INTEGER - r.meta.copper);
  if (refunded <= 0) return 0;
  r.meta.copper += refunded;
  return refunded;
}

/** One successful guild bank op's effect on the BOOK, as the server's dispatch
 *  observer recorded it (server/bank_ledger.ts diffGuildBankOp). The log of a
 *  session's un-persisted deltas is that session's UNCOMMITTED WORK, and it is
 *  replayed in BOTH directions:
 *
 *  - FORWARD (applyGuildBankDeltasTo) onto DURABLE truth, to build the escrow
 *    save's book payload: a session persists "the durable book plus its own
 *    deltas", never the whole shared live book, so one officer's save can never
 *    carry another officer's not-yet-durable op into the row.
 *  - BACKWARD (revertGuildBankDeltasTo) onto the LIVE book, when a session can
 *    never persist those deltas (its escrow save fenced out, or its leave flush
 *    exhausted its retries), leaving every other session's work intact.
 *
 *  The two live side by side on purpose. They are exact inverses OF EACH OTHER
 *  ON ONE BOOK whenever each delta's absolute ladder witness matches the book
 *  it is applied to, which is the case the live book always satisfies (the
 *  witness was recorded from that very book); the identity property is pinned
 *  over that corpus in tests/guild_bank.test.ts. They are deliberately NOT a
 *  round trip across DIFFERENT books: forward runs on durable truth and
 *  backward on the live book, and a slot op replayed onto a ladder that has
 *  since moved is a raise-to-N no-op forwards while the inverse's
 *  compare-and-swap declines to undo anything (or, on a book standing exactly
 *  where a LATER rung left it, undoes that rung instead). Those asymmetries
 *  are pinned as explicit cases rather than left to the identity sweep. */
export interface GuildBankOpDelta {
  op:
    | 'deposit_gold'
    | 'withdraw_gold'
    | 'deposit'
    | 'withdraw'
    | 'buy_slots'
    | 'open_bank'
    | 'admin_purge';
  itemId: string | null;
  count: number | null;
  instance: InvSlot['instance'] | null;
  craftedRecipeId?: string | null;
  copperDelta: number;
  /** The book's ladder position BEFORE this op. Slot ops are recorded and
   *  replayed ABSOLUTELY ("this op moved the ladder from before to after"),
   *  never relatively ("+6"): a relative record replayed onto durable truth
   *  that already advanced would double-grant the rung, and a relative undo
   *  could strand a non-ladder position. Zero on every non-slot op (carried,
   *  never read). */
  purchasedSlotsBefore: number;
  /** The book's ladder position AFTER this op: the "raise to at least N"
   *  target the forward replay applies, and the compare-and-swap witness the
   *  inverse checks before undoing anything. */
  purchasedSlotsAfter: number;
}

/** Why a session's own deltas could NOT be replayed forward onto durable
 *  truth. Reaching this means another officer consumed (or depended on) value
 *  that is not durable yet: the D5 consume-then-fence residue class in
 *  docs/guild-bank/state.md. The forward applier is the first code in the
 *  system that can SEE it, because it is the only code that knows both the
 *  durable base and the intended delta, so the server turns a deficit into a
 *  retry and (once it can never resolve) a bank_ledger anomaly row. */
export interface GuildBankDeltaDeficit {
  kind: 'treasury_underflow' | 'treasury_overflow' | 'missing_items' | 'ladder_behind';
  op: GuildBankOpDelta['op'];
  itemId: string | null;
  /** How much of the delta the base could not satisfy: copper for the two
   *  treasury kinds, item copies for missing_items, ladder slots for
   *  ladder_behind. Always positive. */
  shortfall: number;
  /** The stalled delta's own copper movement, SIGNED as the book would have
   *  moved it (negative = copper that would have LEFT the book). Carried so an
   *  operator reading the anomaly row can tell a would-be mint from a would-be
   *  destruction; the kind alone cannot. */
  copperDelta: number;
}

function clampTreasury(v: number): number {
  return Math.max(0, Math.min(GUILD_BANK_TREASURY_CAP, v));
}

/** Key-order-independent serialization for payload equality: object keys are
 *  sorted recursively, so a payload that round-tripped through Postgres JSONB
 *  (which does NOT preserve key insertion order) still compares equal to its
 *  pre-reload clone. Plain data only (the instance payloads are JSON to begin
 *  with).
 *
 *  UNDEFINED-VALUED KEYS ARE DROPPED, matching both `JSON.stringify` (which
 *  omits them, so they can never exist on the DURABLE side) and the repo's
 *  canonical `itemInstancePayloadsEqual` (which filters them before comparing
 *  key counts). Without this, `{ signer: undefined }` serialized differently
 *  from `{}` while the payload it is compared against had round-tripped
 *  through JSONB and lost the key: the live payload would then compare unequal
 *  to its own durable clone, `applyGuildBankDeltasTo` would report a spurious
 *  deficit, and that session's escrow save would be refused forever. No live
 *  site produces such a payload today; the filter removes the class rather
 *  than relying on that staying true.
 *
 *  DELIBERATELY NOT delegated to `itemInstancePayloadsEqual`: this predicate
 *  models the JSON ROUND TRIP (which is the actual difference between the two
 *  sides being compared), and structural `===` disagrees with it on a
 *  non-finite number, where the durable side reads `null` and the live side
 *  holds `NaN`. The two now differ only there, and only by splitting a stack
 *  rather than by moving value. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`);
  return `{${parts.join(',')}}`;
}

/** True when the two instance payloads are the same copy for revert purposes.
 *  Canonical (sorted-key, undefined-dropping) equality, NOT raw
 *  JSON.stringify: one side may have round-tripped through JSONB (the
 *  evict-and-reload arm) and come back with reordered keys; identical payloads
 *  are fungible for conservation, which is all a revert needs. */
function sameInstance(
  a: InvSlot['instance'] | null | undefined,
  b: InvSlot['instance'] | null | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return canonicalJson(a) === canonicalJson(b);
}

/** The delta's item count as a non-negative integer (0 when the delta carries
 *  no item half). Shared by both directions so they can never disagree. */
function deltaCount(d: GuildBankOpDelta): number {
  return Math.max(0, Math.floor(Number(d.count)) || 0);
}

/** The delta's craft-provenance marker as addStacked wants it. */
function deltaRecipe(d: GuildBankOpDelta): string | undefined {
  return typeof d.craftedRecipeId === 'string' && d.craftedRecipeId !== ''
    ? d.craftedRecipeId
    : undefined;
}

/** How many matching copies a book holds. The match is THREE-dimensional
 *  (itemId, the canonical instance payload, AND craftedRecipeId): the book
 *  keeps a crafted and a plain copy of one item as separate slots, and
 *  crossing that line would destroy another officer's provenance. */
function countMatching(book: GuildBankState, d: GuildBankOpDelta): number {
  let held = 0;
  for (const slot of book.inventory) {
    if (
      slot.itemId === d.itemId &&
      sameInstance(slot.instance, d.instance) &&
      (slot.craftedRecipeId ?? null) === (d.craftedRecipeId ?? null)
    ) {
      held += slot.count;
    }
  }
  return held;
}

/** Remove up to `count` matching copies from a book, newest slots first, and
 *  return how many could NOT be found. */
function removeMatching(book: GuildBankState, d: GuildBankOpDelta, count: number): number {
  let remaining = count;
  for (let s = book.inventory.length - 1; s >= 0 && remaining > 0; s--) {
    const slot = book.inventory[s];
    if (
      slot.itemId !== d.itemId ||
      !sameInstance(slot.instance, d.instance) ||
      (slot.craftedRecipeId ?? null) !== (d.craftedRecipeId ?? null)
    ) {
      continue;
    }
    const take = Math.min(slot.count, remaining);
    slot.count -= take;
    remaining -= take;
    if (slot.count <= 0) book.inventory.splice(s, 1);
  }
  return remaining;
}

/** Put copies back through the ONE canonical grant path (bags.ts addStacked):
 *  it merges only into stacks whose payload AND craft provenance match,
 *  respects the per-item stack cap (a replay must never mint an over-stacked
 *  slot no legitimate path can produce), and deep-clones instanced payloads.
 *  Over-CAPACITY is tolerated by the book contract (capacity only blocks new
 *  deposits); over-STACK is not. */
function grantMatching(book: GuildBankState, d: GuildBankOpDelta, count: number): void {
  if (typeof d.itemId !== 'string' || d.itemId === '') return;
  addStacked(book.inventory, d.itemId, count, d.instance ?? undefined, deltaRecipe(d));
}

/** Replay a session's own deltas FORWARD onto a book, oldest first. This is
 *  the escrow save's payload builder: `sanitize(durable row)` then this, which
 *  is why a session can only ever persist ITS OWN work.
 *
 *  ALL OR NOTHING. Returns null when every delta landed (the book is mutated
 *  in place), or the FIRST deficit it hit, in which case the book is left
 *  partially mutated and the caller MUST discard it AND refuse the write.
 *
 *  Refusing is the whole point, and it is not negotiable: a deficit means this
 *  session took value out of the book that durable truth never held, so
 *  writing anything less than the whole log while the paired CHARACTER half
 *  commits mints exactly that difference. Carrying the shortfall forward and
 *  recording it is not a substitute for atomicity, it is a receipt for a mint.
 *  The escrow transaction therefore rolls the character half back too and the
 *  save is retried; see server/game.ts handleGuildBankEscrowRefusal.
 *
 *  Deliberately does NOT re-check capacity: the book contract already
 *  tolerates over-capacity (capacity only blocks new deposits) and the live op
 *  already passed the live check. */
export function applyGuildBankDeltasTo(
  book: GuildBankState,
  deltas: readonly GuildBankOpDelta[],
): GuildBankDeltaDeficit | null {
  for (const d of deltas) {
    if (d.op === 'open_bank' || d.op === 'buy_slots') {
      // ABSOLUTE, never relative: the op moved the ladder from `before` to
      // `after`, and it replays only onto a base standing EXACTLY at `before`.
      // The same compare-and-swap the inverse uses, so the two are exact
      // inverses on any base rather than only on the one the delta came from.
      // A base BELOW it means the officer who bought the lower rung has not
      // committed, so raising here would grant rungs durable truth cannot
      // justify: the same violation as moving copper the book never held, and
      // refused the same way. A base ABOVE it is unreachable in process (a
      // later rung cannot commit before the rung under it) and would charge
      // the treasury for a grant the inverse then declines to undo, so it is
      // refused too. The save retries once the other officer commits, and is
      // rolled back if they never can (server/game.ts
      // handleGuildBankEscrowRefusal).
      if (book.purchasedSlots !== d.purchasedSlotsBefore) {
        return {
          kind: 'ladder_behind',
          op: d.op,
          itemId: null,
          shortfall: Math.abs(d.purchasedSlotsBefore - book.purchasedSlots),
          copperDelta: d.copperDelta,
        };
      }
      // Rung 0 (open_bank) was PURSE-paid, so it moves no treasury copper;
      // rungs 1+ (buy_slots) spent the treasury and must move it here, and a
      // treasury that cannot cover the price refuses the WHOLE delta: granting
      // the rung without its charge would be a free rung in durable truth.
      if (d.op === 'buy_slots') {
        const next = book.treasury + d.copperDelta;
        if (next < 0 || next > GUILD_BANK_TREASURY_CAP) {
          return {
            kind: next < 0 ? 'treasury_underflow' : 'treasury_overflow',
            op: d.op,
            itemId: null,
            shortfall: next < 0 ? -next : next - GUILD_BANK_TREASURY_CAP,
            copperDelta: d.copperDelta,
          };
        }
        book.treasury = next;
      }
      book.purchasedSlots = d.purchasedSlotsAfter;
      continue;
    }
    if (d.op === 'deposit_gold' || d.op === 'withdraw_gold') {
      const next = book.treasury + d.copperDelta;
      if (next < 0 || next > GUILD_BANK_TREASURY_CAP) {
        return {
          kind: next < 0 ? 'treasury_underflow' : 'treasury_overflow',
          op: d.op,
          itemId: null,
          shortfall: next < 0 ? -next : next - GUILD_BANK_TREASURY_CAP,
          copperDelta: d.copperDelta,
        };
      }
      book.treasury = next;
      continue;
    }
    const count = typeof d.itemId === 'string' && d.itemId !== '' ? deltaCount(d) : 0;
    if (count === 0) continue;
    if (d.op === 'deposit') {
      grantMatching(book, d, count);
      continue;
    }
    // withdraw (and admin_purge, the operator escape hatch, which removes a
    // dormant copy exactly the way a withdraw removes a live one): the copies
    // must actually be in durable truth. A shortfall means another officer's
    // un-durable deposit is what this session consumed, and papering over it
    // is what mints the copy. Counted BEFORE removing anything, so a refused
    // replay never half-empties a slot.
    const held = countMatching(book, d);
    if (held < count) {
      return {
        kind: 'missing_items',
        op: d.op,
        itemId: d.itemId,
        shortfall: count - held,
        copperDelta: 0,
      };
    }
    removeMatching(book, d, count);
  }
  return null;
}

/** Replay a session's own deltas BACKWARD onto a book, newest first: the exact
 *  inverse of applyGuildBankDeltasTo. Used on the LIVE book when a session can
 *  never persist those deltas, leaving every OTHER session's unflushed ops
 *  intact.
 *
 *  Inverses CLAMP rather than throw: if another officer already consumed the
 *  un-durable value on the LIVE book, the inverse no-ops on the missing part.
 *  That is no longer a durable residue: the consuming officer's own save is
 *  refused for the same reason and it is rolled back too, so the clamp only
 *  ever describes a live book that is mid-repair. */
export function revertGuildBankDeltasTo(
  book: GuildBankState,
  deltas: readonly GuildBankOpDelta[],
): void {
  for (let i = deltas.length - 1; i >= 0; i--) {
    const d = deltas[i];
    if (d.op === 'open_bank' || d.op === 'buy_slots') {
      // COMPARE-AND-SWAP on the delta's own before/after witness: undo the
      // ladder step only while the book still stands exactly where this op
      // left it. If another session's rung already advanced past it, the undo
      // is skipped ENTIRELY, slot grant and treasury refund together: undoing
      // half of it is what let a revert keep the slots AND re-create the
      // copper (the unconditional refund defect).
      if (book.purchasedSlots !== d.purchasedSlotsAfter) continue;
      book.purchasedSlots = d.purchasedSlotsBefore;
      // Rung 0 was PURSE-paid: the dead session's character half, holding the
      // purse charge, already rolled back by definition, so crediting the
      // treasury here would mint guild copper.
      if (d.op === 'buy_slots') book.treasury = clampTreasury(book.treasury - d.copperDelta);
      continue;
    }
    if (d.op === 'deposit_gold' || d.op === 'withdraw_gold') {
      book.treasury = clampTreasury(book.treasury - d.copperDelta);
      continue;
    }
    if (typeof d.itemId !== 'string' || d.itemId === '') continue;
    const count = deltaCount(d);
    if (count === 0) continue;
    if (d.op === 'deposit') removeMatching(book, d, count);
    // A withdraw and an admin_purge both REMOVED a copy, so both are undone by
    // putting it back. Missing the purge arm here would leave a fenced-out
    // operator removal live on the book with nothing durable behind it.
    else if (d.op === 'withdraw' || d.op === 'admin_purge') grantMatching(book, d, count);
  }
}

/** Key-order-independent identity for netting: the same three-dimensional
 *  (itemId, canonical instance payload, craft provenance) key the replay and
 *  the inverse match on. EXPORTED so the server's log compactor
 *  (server/guild_bank_op_log.ts) nets on exactly this key rather than a second
 *  copy that could disagree about a payload's canonical form. */
export function guildBankDeltaIdentityKey(d: GuildBankOpDelta): string {
  return `${d.itemId ?? ''}|${canonicalJson(d.instance ?? null)}|${d.craftedRecipeId ?? ''}`;
}

/** A REPLAY-EQUIVALENT normalization of a delta log: the same final book as
 *  applyGuildBankDeltasTo would reach, with every intermediate dip removed.
 *
 *   - slot ops keep their order and their absolute ladder witness, but their
 *     treasury CHARGE is lifted out (the ladder is monotone, so the grants are
 *     order independent among themselves);
 *   - item deltas net per identity;
 *   - every copper delta the applier would MOVE nets into ONE gold delta
 *     applied last. open_bank's copperDelta is deliberately EXCLUDED, because
 *     rung 0 was purse-paid and the applier never moves it either: folding it
 *     in would destroy that copper on every netted replay.
 *
 *  Equal in CONSERVED CONTENT (treasury, ladder position, and the item
 *  multiset), not necessarily in slot LAYOUT: removals walk newest-first while
 *  grants fill oldest-first, so a netted run can leave the same copies in a
 *  different slot order than the ordered run would. That is the same
 *  indifference the book contract already has (slot order follows arrival and
 *  the live and durable books diverge anyway between saves), and the pin in
 *  tests/guild_bank.test.ts compares on exactly that basis.
 *
 *  Lives here, beside the applier it must agree with, rather than on the
 *  server side: the two drifting apart is a silent conservation break, so they
 *  are reviewed as one file. The escrow merge uses this as its fallback when
 *  the ordered replay stalls on an artifact of CROSS-SESSION ordering (this
 *  officer withdrew while the live book still held another officer's copper,
 *  and the durable replay put that officer's whole log first). */
export function netGuildBankOpLogForReplay(log: readonly GuildBankOpDelta[]): GuildBankOpDelta[] {
  const out: GuildBankOpDelta[] = [];
  let copper = 0;
  const items = new Map<string, { sample: GuildBankOpDelta; net: number }>();
  for (const d of log) {
    if (d.op === 'open_bank' || d.op === 'buy_slots') {
      // buy_slots spent TREASURY copper, so its charge is lifted into the net;
      // open_bank spent the acting officer's PURSE, which the book never held.
      if (d.op === 'buy_slots') copper += Number(d.copperDelta) || 0;
      out.push({ ...d, copperDelta: 0 });
      continue;
    }
    if (d.op === 'deposit_gold' || d.op === 'withdraw_gold') {
      copper += Number(d.copperDelta) || 0;
      continue;
    }
    // admin_purge is a REMOVAL like a withdraw, so it nets with one: dropping
    // it here would make the netted rescue replay a book that still holds the
    // purged copy while the live book no longer does, which is the same
    // divergence the ordered replay exists to refuse.
    if (d.op !== 'deposit' && d.op !== 'withdraw' && d.op !== 'admin_purge') continue;
    if (typeof d.itemId !== 'string' || d.itemId === '') continue;
    const count = deltaCount(d);
    if (count === 0) continue;
    const key = guildBankDeltaIdentityKey(d);
    const entry = items.get(key) ?? { sample: d, net: 0 };
    entry.net += d.op === 'deposit' ? count : -count;
    items.set(key, entry);
  }
  for (const { sample, net } of items.values()) {
    if (net === 0) continue;
    out.push({
      op: net > 0 ? 'deposit' : 'withdraw',
      itemId: sample.itemId,
      count: Math.abs(net),
      instance: sample.instance ?? null,
      craftedRecipeId: sample.craftedRecipeId ?? null,
      copperDelta: 0,
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 0,
    });
  }
  if (copper !== 0) {
    out.push({
      op: copper > 0 ? 'deposit_gold' : 'withdraw_gold',
      itemId: null,
      count: null,
      instance: null,
      craftedRecipeId: null,
      copperDelta: copper,
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 0,
    });
  }
  return out;
}

/** The ctx-facing delegate (Sim.revertGuildBankDeltas): undo a dead session's
 *  unflushed ops on the LIVE book. Never touches player state, because the
 *  dead session's character half already rolled back by definition. */
export function revertGuildBankDeltas(
  ctx: SimContext,
  guildId: number,
  deltas: readonly GuildBankOpDelta[],
): void {
  const book = ctx.guildBanks.get(guildId);
  if (!book) return;
  revertGuildBankDeltasTo(book, deltas);
}

/** The server-callable membership stamp body (Sim.setPlayerGuildMembership is
 *  the thin facade delegate beside setPlayerGuild). Host-trusted but normalized
 *  anyway: a malformed guild id or rank stamps null rather than garbage. The
 *  row is cloned at this write boundary so the sim never aliases the host's
 *  object (the bankBonus precedent). Pass null on leave, kick, or disband. */
export function stampGuildMembership(
  ctx: SimContext,
  pid: number,
  membership: GuildMembership | null,
): void {
  const meta = ctx.players.get(pid);
  if (!meta) return;
  meta.guildMembership = normalizeGuildMembership(membership);
}

function normalizeGuildMembership(m: GuildMembership | null): GuildMembership | null {
  if (!m || typeof m !== 'object') return null;
  if (!Number.isInteger(m.guildId) || m.guildId <= 0) return null;
  if (!GUILD_RANKS.includes(m.rank)) return null;
  return { guildId: m.guildId, rank: m.rank };
}

// ---------------------------------------------------------------------------
// Phase 2: the op bodies + the gated info read. Free functions over SimContext
// (the bank.ts idiom); the Sim facade exposes them to the server through the
// pid-first `guildBank*For` entry points, while the offline IWorld facet arm
// stays inert forever (offline play never has a guild).
// ---------------------------------------------------------------------------

/** The ranks that may EDIT the guild bank, as a POSITIVE allowlist: the op
 *  gate (requireOfficerBook) refuses everything outside it, and the info read
 *  (guildBankInfoFor) stamps it onto the snapshot as `canEdit` so the client
 *  renders a member's view read-only from the same fact that refuses their
 *  ops. Exactly leader and officer: a rank ever added to GUILD_RANKS (an
 *  initiate tier, say) is DENIED here until this set is deliberately
 *  revisited, because a shared treasury must fail closed, never open. The
 *  VIEW gate is deliberately wider (any stamped member: seeing the pooled
 *  goods and their history is how the guild audits its officers), and
 *  tests/guild_bank.test.ts sweeps every rank through both gates and pins
 *  each passing set. */
const GUILD_BANK_EDIT_RANKS: ReadonlySet<GuildRank> = new Set(['leader', 'officer']);

/** Resolve the REQUIRED acting pid, refusing a non-integer at runtime. The
 *  facade types pid as required, but Sim.resolve falls back to the primary
 *  (local) player when handed undefined, and an economy op must never fail
 *  open into acting for the wrong player, so the module guards the claim
 *  itself instead of leaning on the type checker alone. */
function resolveActor(ctx: SimContext, pid: number): ReturnType<SimContext['resolve']> {
  return Number.isInteger(pid) ? ctx.resolve(pid) : null;
}

/** The shared officer-plus authorization step every op runs AFTER the shape
 *  check: resolves the acting player's stamped membership and the guild's live
 *  book. A missing stamp and a rank outside GUILD_BANK_EDIT_RANKS each REFUSE
 *  with a player line; a stamped guild whose book is not loaded returns silently,
 *  because that is a host wiring state (Phase 3 boot-loads every book before
 *  players join), not a condition the player caused or can act on. Never
 *  mutates. */
function requireOfficerBook(ctx: SimContext, meta: PlayerMeta): GuildBankState | null {
  const m = meta.guildMembership;
  if (!m) {
    ctx.error(meta.entityId, 'You must be in a guild to use the guild bank.');
    return null;
  }
  if (!GUILD_BANK_EDIT_RANKS.has(m.rank)) {
    ctx.error(meta.entityId, 'Only guild officers may use the guild bank.');
    return null;
  }
  return ctx.guildBanks.get(m.guildId) ?? null;
}

/** The guild bank is an ANONYMOUS EXCHANGE PIPE (officer A deposits, officer B
 *  withdraws), NOT self-storage like the personal bank, so it carries the full
 *  pipe policy the World Market and Ravenpost mail enforce, not bank.ts's
 *  deliberately narrow quest-only rule (whose own comment scopes it to
 *  self-storage): def-level quest / soulbound / noMarketList (the rift-gear
 *  family rides noMarketList, the item_instance_transfer.ts contract), plus
 *  the per-copy transfer lock (an armed bindOnTrade or bound boundTo copy
 *  never rides an anonymous pipe where no stamp can land). Checked on BOTH
 *  directions: deposit keeps them out, and withdraw refuses them too so a
 *  tampered or legacy Phase 3 row can never complete the laundering (such a
 *  copy stays dormant in the book, the items-are-never-destroyed load
 *  philosophy). Returns the refusal line, or null when the slot may move.
 *
 *  The WHETHER is direction-independent (the same four dimensions refuse both
 *  ways, so `!== null` stays the one dormant predicate every reader shares);
 *  only the WORDING is direction-aware. `dir` defaults to 'deposit', the arm
 *  every non-withdraw reader (the slot-view projection, the UI parity pin)
 *  wants. Deposit names the dimension (quest / soulbound / generic, the mail
 *  noMailQuestItems grouping precedent); WITHDRAW is one line for every
 *  dimension, because "you cannot STORE that" is simply false when the copy is
 *  already sitting in the book and the player asked to take it out.
 *  EXPORTED for the UI parity pin only (tests/guild_bank_view.test.ts drives
 *  this and the client-side dormant predicate over the whole item table so a
 *  new refusal dimension cannot silently desync the Guild tab's rendering);
 *  no host calls it directly. */
export function guildBankPipeRefusal(
  slot: InvSlot,
  dir: 'deposit' | 'withdraw' = 'deposit',
): string | null {
  const def = ITEMS[slot.itemId];
  const quest = def?.kind === 'quest';
  const refused =
    quest || !!def?.soulbound || !!def?.noMarketList || isTransferLockedInstance(slot.instance);
  if (!refused) return null;
  if (dir === 'withdraw') return 'That item cannot be withdrawn from the guild bank.';
  if (quest) return 'You cannot store quest items in the guild bank.';
  if (def?.soulbound) return 'You cannot store soulbound items in the guild bank.';
  return 'That item cannot be stored in the guild bank.';
}

/** Deposit personal copper into the guild treasury. Refuses (never truncates)
 *  a deposit that would push the treasury past GUILD_BANK_TREASURY_CAP.
 *  `pid` is required on every op: only the server's pid-first facade calls
 *  these (the offline facet arm is inert), so there is no local-player
 *  fallback to fail open into. */
export function guildBankDepositGold(ctx: SimContext, amount: number, pid: number): void {
  const r = resolveActor(ctx, pid);
  if (!r) return;
  const { meta, e: p } = r;
  if (p.dead) return; // the market/mail town-service idiom: dead players bank nothing
  if (!nearBanker(ctx, p)) {
    ctx.error(meta.entityId, 'You are too far from the banker.');
    return;
  }
  // Shape: malformed input (cheat/desync), no player line, the bank.ts idiom.
  if (!Number.isSafeInteger(amount) || amount <= 0) return;
  const book = requireOfficerBook(ctx, meta);
  if (!book) return;
  if (meta.copper < amount) {
    ctx.error(meta.entityId, 'Not enough money.');
    return;
  }
  if (book.treasury + amount > GUILD_BANK_TREASURY_CAP) {
    ctx.error(meta.entityId, 'The guild treasury cannot hold that much.');
    return;
  }
  meta.copper -= amount;
  book.treasury += amount;
  ctx.notice(meta.entityId, `You deposit ${formatMoney(amount)} into the guild treasury.`);
}

/** Withdraw treasury copper into the acting officer's purse. Refuses when the
 *  treasury does not hold the amount, and refuses (never clamps) a withdrawal
 *  that would overflow the player's own copper past the integer-safe bound. */
export function guildBankWithdrawGold(ctx: SimContext, amount: number, pid: number): void {
  const r = resolveActor(ctx, pid);
  if (!r) return;
  const { meta, e: p } = r;
  if (p.dead) return; // the market/mail town-service idiom: dead players bank nothing
  if (!nearBanker(ctx, p)) {
    ctx.error(meta.entityId, 'You are too far from the banker.');
    return;
  }
  // Shape: malformed input (cheat/desync), no player line, the bank.ts idiom.
  if (!Number.isSafeInteger(amount) || amount <= 0) return;
  const book = requireOfficerBook(ctx, meta);
  if (!book) return;
  if (book.treasury < amount) {
    ctx.error(meta.entityId, 'The guild treasury does not hold that much.');
    return;
  }
  // Both operands are safe integers, so the difference is exact: the check can
  // never be fooled by float rounding at the 2^53 boundary.
  if (amount > Number.MAX_SAFE_INTEGER - meta.copper) {
    ctx.error(meta.entityId, 'You cannot carry that much money.');
    return;
  }
  book.treasury -= amount;
  meta.copper += amount;
  ctx.notice(meta.entityId, `You withdraw ${formatMoney(amount)} from the guild treasury.`);
}

/** Deposit a carried-inventory slot into the guild bank. The full anonymous-
 *  pipe policy applies (guildBankPipeRefusal: quest, soulbound, noMarketList,
 *  per-copy transfer locks); an instanced stack moves WHOLE or not at all, and
 *  capacity holds the all-or-nothing line, both inside moveBetweenContainers.
 *  A counted fungible leaving the bags pokes the collect-quest recompute,
 *  exactly like the personal bank. */
export function guildBankDeposit(
  ctx: SimContext,
  slotIndex: number,
  count: number | undefined,
  pid: number,
): void {
  const r = resolveActor(ctx, pid);
  if (!r) return;
  const { meta, e: p } = r;
  if (p.dead) return; // the market/mail town-service idiom: dead players bank nothing
  if (!nearBanker(ctx, p)) {
    ctx.error(meta.entityId, 'You are too far from the banker.');
    return;
  }
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= meta.inventory.length) return;
  const book = requireOfficerBook(ctx, meta);
  if (!book) return;
  const slot = meta.inventory[slotIndex];
  const refusal = guildBankPipeRefusal(slot);
  if (refusal !== null) {
    ctx.error(meta.entityId, refusal);
    return;
  }
  // Captured before the move: a whole-stack success splices the source slot out.
  const itemName = ITEMS[slot.itemId]?.name ?? slot.itemId;
  const result = moveBetweenContainers(
    meta.inventory,
    slotIndex,
    count,
    book.inventory,
    guildBankCapacity(book),
  );
  if (result.refusal === 'no_fit') {
    ctx.error(meta.entityId, 'The guild bank is full.');
    return;
  }
  if (result.refusal) return; // 'invalid': malformed input (cheat/desync), no player line
  ctx.onInventoryChangedForQuests(meta);
  ctx.notice(meta.entityId, `You deposit ${itemName} into the guild bank.`);
}

/** Withdraw a guild bank slot back into the acting officer's bags: the mirror
 *  of guildBankDeposit, gated by the bag capacity AND the same anonymous-pipe
 *  policy (see guildBankPipeRefusal: a tampered/legacy row's locked copy must
 *  never complete a cross-character transfer). */
export function guildBankWithdraw(
  ctx: SimContext,
  slotIndex: number,
  count: number | undefined,
  pid: number,
): void {
  const r = resolveActor(ctx, pid);
  if (!r) return;
  const { meta, e: p } = r;
  if (p.dead) return; // the market/mail town-service idiom: dead players bank nothing
  if (!nearBanker(ctx, p)) {
    ctx.error(meta.entityId, 'You are too far from the banker.');
    return;
  }
  // The primitive half of the shape check; the bounds half needs the book,
  // which the rank gate resolves below.
  if (!Number.isInteger(slotIndex) || slotIndex < 0) return;
  const book = requireOfficerBook(ctx, meta);
  if (!book) return;
  if (slotIndex >= book.inventory.length) return;
  // The pipe policy holds on the way OUT too: a tampered or legacy Phase 3 row
  // holding a locked/soulbound copy must never complete a cross-character
  // transfer; it stays dormant in the book (items are never destroyed). The
  // 'withdraw' arm picks the direction's own wording: a deposit-worded "you
  // cannot store that" is false for a copy already in the book.
  const refusal = guildBankPipeRefusal(book.inventory[slotIndex], 'withdraw');
  if (refusal !== null) {
    ctx.error(meta.entityId, refusal);
    return;
  }
  // Captured before the move: a whole-stack success splices the source slot out.
  const itemName =
    ITEMS[book.inventory[slotIndex].itemId]?.name ?? book.inventory[slotIndex].itemId;
  const result = moveBetweenContainers(
    book.inventory,
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
  ctx.notice(meta.entityId, `You withdraw ${itemName} from the guild bank.`);
}

/** Buy the next ladder rung, at the table price for the current bought-rung
 *  count (never client-supplied). Rung 0 OPENS the bank (24 slots) and is
 *  paid from the CLICKING OFFICER'S OWN PURSE (the one-click classic
 *  first-tab precedent); rungs 1+ are the treasury-paid 6-slot expansions.
 *  Blocked at the ladder's end; no refusal mutates. */
export function guildBankBuySlots(ctx: SimContext, pid: number): void {
  const r = resolveActor(ctx, pid);
  if (!r) return;
  const { meta, e: p } = r;
  if (p.dead) return; // the market/mail town-service idiom: dead players bank nothing
  if (!nearBanker(ctx, p)) {
    ctx.error(meta.entityId, 'You are too far from the banker.');
    return;
  }
  const book = requireOfficerBook(ctx, meta);
  if (!book) return;
  const rung = guildBankRungsBought(book.purchasedSlots);
  const price = GUILD_BANK_RUNG_PRICES[rung] ?? null;
  if (price === null) {
    ctx.error(meta.entityId, 'The guild bank cannot be expanded further.');
    return;
  }
  if (rung === 0) {
    // Opening the bank: the officer's own purse pays, never the treasury.
    if (meta.copper < price) {
      ctx.error(meta.entityId, 'Not enough money.');
      return;
    }
    meta.copper -= price;
    book.purchasedSlots += GUILD_BANK_RUNG_SLOTS[0];
    ctx.notice(meta.entityId, 'You open the guild bank.');
    return;
  }
  if (book.treasury < price) {
    ctx.error(meta.entityId, 'Your guild cannot afford that expansion.');
    return;
  }
  book.treasury -= price;
  book.purchasedSlots += GUILD_BANK_RUNG_SLOTS[rung];
  ctx.notice(meta.entityId, 'You purchase additional guild bank slots.');
}

/** The wire view of ONE book slot: a boundary clone, downgraded to the public
 *  projection when the pipe policy refuses the copy. Deposits can never seat a
 *  locked copy, so this only ever fires on a tampered or legacy Phase 3 row,
 *  which guildBankWithdraw also refuses: such a slot is dormant, and its
 *  boundTo / bindOnTrade fields (another character's bind identity) must not
 *  be broadcast to every guild member just because the row exists (the
 *  audience this projection guards became guild-wide with the v0.35 member
 *  read-only view; the projection itself is unchanged). */
function guildBankSlotView(slot: InvSlot): InvSlot {
  const view = cloneInvSlot(slot);
  if (view.instance && guildBankPipeRefusal(slot) !== null) {
    view.instance = publicInstanceView(view.instance);
  }
  return view;
}

/** The proximity + membership gated guild bank snapshot the server's
 *  maybe('guildBank') stream reads (the bankInfoFor pattern): null unless the
 *  player is alive, within reach of a banker NPC, stamped into a guild (ANY
 *  rank: the view is guild-wide, only editing is officer-plus), and their
 *  guild's book is loaded; else a boundary-cloned view whose `canEdit` flag
 *  carries the GUILD_BANK_EDIT_RANKS verdict for the client's read-only
 *  rendering. The DEAD gate is stricter than the personal bank's on purpose:
 *  the stream must go null on death, leave, kick, and walk-away (each pinned
 *  in tests/guild_bank.test.ts; a demotion to member keeps the stream and
 *  drops only canEdit). A pure read: it draws NO rng and never hands out live
 *  sim slot references. Ships the full instance payload for every slot the
 *  pipe policy allows, because the guild co-owns the pooled contents and a
 *  withdrawer needs the real payload (charges). A slot the policy REFUSES
 *  (only reachable from a tampered or legacy Phase 3 row, since deposit keeps
 *  locked copies out) is dormant and unwithdrawable, so it degrades to the
 *  publicInstanceView projection: no boundTo or armed bindOnTrade (another
 *  character's bind identity) rides the wire to the guild. The read and the
 *  withdraw gate therefore agree slot for slot. */
export function guildBankInfoFor(ctx: SimContext, pid: number): GuildBankInfo | null {
  const r = resolveActor(ctx, pid);
  if (!r) return null;
  const { meta, e: p } = r;
  if (p.dead) return null;
  if (!nearBanker(ctx, p)) return null;
  const m = meta.guildMembership;
  if (!m) return null;
  const book = ctx.guildBanks.get(m.guildId);
  if (!book) return null;
  return bookSnapshot(book, guildBankSlotView, GUILD_BANK_EDIT_RANKS.has(m.rank));
}

/** The one snapshot shape both reads hand back, parameterized ONLY by how a
 *  slot is viewed and by the viewer's edit verdict. Sharing the body keeps the
 *  player read and the operator read from drifting in capacity / price /
 *  ordering; the slot view and canEdit are the two deliberate differences. */
function bookSnapshot(
  book: GuildBankState,
  view: (slot: InvSlot) => InvSlot,
  canEdit: boolean,
): GuildBankInfo {
  return {
    treasury: book.treasury,
    slots: book.inventory.map(view),
    capacity: guildBankCapacity(book),
    purchasedSlots: book.purchasedSlots,
    nextExpansionPrice: guildBankNextExpansionPrice(book),
    canEdit,
  };
}

/** The UNGATED book snapshot for one guild id, for the server's operator path
 *  (there is no acting player, so there is no proximity / rank / alive gate to
 *  apply). Null when the guild has no loaded book, exactly like every other
 *  Phase 3 host seam, so the caller fails closed.
 *
 *  Deliberately NOT downgraded to the publicInstanceView projection the player
 *  read applies to a dormant slot: this read exists so the admin escape hatch's
 *  ledger row can preserve the REAL instance payload as evidence of what was
 *  removed, and a projected payload would erase exactly the bind identity an
 *  operator needs to reconstruct the copy. It is server-only (never an IWorld
 *  member, so it can never ride the wire to a client) and its slots are
 *  boundary clones like every other read here: no live reference escapes. */
export function guildBankInfoForGuild(ctx: SimContext, guildId: number): GuildBankInfo | null {
  const book = ctx.guildBanks.get(guildId);
  if (!book) return null;
  // canEdit true: there is no acting player to rank-gate, and the operator
  // consumers (the admin projection, the op-diff ledger) never read the flag.
  return bookSnapshot(book, cloneInvSlot, true);
}

/** The operator escape hatch for a DORMANT guild bank slot: remove exactly one
 *  slot the anonymous-pipe policy refuses, returning the removed copy (a
 *  boundary clone) as the evidence the server writes into its ledger row, or
 *  null when the removal is refused.
 *
 *  WHY IT EXISTS: an item a later content update flags soulbound / noMarketList
 *  / transfer-locked is refused in BOTH directions, so it can never be
 *  withdrawn, guildBankHoldings stays non-zero forever, and the disband guard
 *  then refuses forever. No player action can clear it (the v1 limitation
 *  recorded in docs/guild-bank/state.md); this is the operator remedy.
 *
 *  SCOPE, deliberately narrow: it removes ONLY a slot guildBankPipeRefusal
 *  actually refuses. An ordinary withdrawable copy is refused here (null), so
 *  the hatch can never become a "delete any guild's items" tool, and an
 *  operator who wants to remove a live item has to make the guild withdraw it
 *  the normal way. A missing book, a non-integer or out-of-range index, and a
 *  healthy slot all refuse without mutating anything.
 *
 *  Purge, not mail: the item is removed. Mailing the copy back to its depositor
 *  needs a depositor identity the book does not keep, and the mail pipe refuses
 *  the same copy anyway; recorded as a possible follow-up in the packet docs. */
export function purgeDormantGuildBankSlot(
  ctx: SimContext,
  guildId: number,
  slotIndex: number,
  expectItemId: string,
): InvSlot | null {
  const book = ctx.guildBanks.get(guildId);
  if (!book) return null;
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= book.inventory.length) {
    return null;
  }
  const slot = book.inventory[slotIndex];
  // CONFIRMATION TOKEN, not decoration: a purge splices the slot out, so every
  // higher index shifts down by one, and an operator working from a stale
  // listing would otherwise destroy a DIFFERENT dormant copy than the one they
  // read. The caller must name the item it believes sits at that index.
  if (typeof expectItemId !== 'string' || slot.itemId !== expectItemId) return null;
  // The one policy gate: only a copy the pipe actually refuses is purgeable.
  // Direction is irrelevant here (the refusal SET is direction-independent), so
  // the default read is the right one.
  if (guildBankPipeRefusal(slot) === null) return null;
  const removed = cloneInvSlot(slot);
  book.inventory.splice(slotIndex, 1);
  return removed;
}
