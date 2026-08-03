// The Guild Bank: a shared, guild-owned treasury plus pooled item store, the
// guild-scale sibling of the personal bank (bank.ts). Phase 1 (foundation)
// landed the state model, the ONE load path, the per-guild book map helpers,
// and the session-only membership stamp; Phase 2 (this file's op section)
// lands the five op bodies and the proximity/rank-gated info read; the DB
// persistence that feeds loadGuildBank/serializeGuildBank is Phase 3.
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
 *  price indexing stays coherent. */
export function sanitizeGuildBankState(raw: unknown): GuildBankState {
  if (!raw || typeof raw !== 'object') return createEmptyGuildBankState();
  const r = raw as { treasury?: unknown; inventory?: unknown; purchasedSlots?: unknown };
  const inventory: InvSlot[] = [];
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
      const craftedRecipeId =
        typeof e.craftedRecipeId === 'string' && e.craftedRecipeId !== ''
          ? e.craftedRecipeId
          : undefined;
      const instanceCap = instancedCountCap(
        ITEMS[e.itemId],
        hasInstance ? (e.instance as InvSlot['instance']) : undefined,
      );
      const count = Math.min(instanceCap, Math.max(1, Math.floor(Number(e.count)) || 1));
      const slot: InvSlot = hasInstance
        ? { itemId: e.itemId, count, instance: e.instance as InvSlot['instance'] }
        : { itemId: e.itemId, count };
      if (craftedRecipeId !== undefined) slot.craftedRecipeId = craftedRecipeId;
      inventory.push(cloneInvSlot(slot));
    }
  }
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
 *  observer recorded it (server/bank_ledger.ts diffGuildBankOp): the shape
 *  revertGuildBankDeltas below needs to surgically undo a session's unflushed
 *  ops when that session can never persist them (its escrow save fenced out or
 *  exhausted its leave retries while ANOTHER session still holds legitimate
 *  unflushed ops on the same shared book, so an evict-and-reload from durable
 *  truth would destroy those). */
export interface GuildBankOpDelta {
  op: 'deposit_gold' | 'withdraw_gold' | 'deposit' | 'withdraw' | 'buy_slots' | 'open_bank';
  itemId: string | null;
  count: number | null;
  instance: InvSlot['instance'] | null;
  craftedRecipeId?: string | null;
  copperDelta: number;
}

function clampTreasury(v: number): number {
  return Math.max(0, Math.min(GUILD_BANK_TREASURY_CAP, v));
}

/** Key-order-independent serialization for payload equality: object keys are
 *  sorted recursively, so a payload that round-tripped through Postgres JSONB
 *  (which does NOT preserve key insertion order) still compares equal to its
 *  pre-reload clone. Plain data only (the instance payloads are JSON to begin
 *  with). */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`,
  );
  return `{${parts.join(',')}}`;
}

/** True when the two instance payloads are the same copy for revert purposes.
 *  Canonical (sorted-key) equality, NOT raw JSON.stringify: one side may have
 *  round-tripped through JSONB (the evict-and-reload arm) and come back with
 *  reordered keys; identical payloads are fungible for conservation, which is
 *  all a revert needs. */
function sameInstance(
  a: InvSlot['instance'] | null | undefined,
  b: InvSlot['instance'] | null | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return canonicalJson(a) === canonicalJson(b);
}

/** Surgically UNDO a dead session's unflushed ops on a live book, newest
 *  first, leaving every OTHER session's unflushed ops intact. Called by the
 *  server only on the arm where a fenced-out (or leave-exhausted) session's
 *  book mutations can never ride their own escrow save AND another live
 *  session still holds legitimate unflushed ops (so the evict-and-reload arm
 *  would destroy value). Inverses clamp rather than throw: if another officer
 *  already consumed the un-durable value (withdrew the copper or the copy),
 *  the inverse no-ops on the missing part; that residue is the documented
 *  accepted risk in docs/guild-bank/state.md. Never touches player state:
 *  the dead session's character half already rolled back by definition. */
export function revertGuildBankDeltas(
  ctx: SimContext,
  guildId: number,
  deltas: readonly GuildBankOpDelta[],
): void {
  const book = ctx.guildBanks.get(guildId);
  if (!book) return;
  for (let i = deltas.length - 1; i >= 0; i--) {
    const d = deltas[i];
    if (d.op === 'deposit_gold' || d.op === 'withdraw_gold') {
      book.treasury = clampTreasury(book.treasury - d.copperDelta);
      continue;
    }
    if (d.op === 'open_bank') {
      // Rung 0 was PURSE-paid: undo only the slot grant (the dead session's
      // character half, holding the purse charge, already rolled back by
      // definition; crediting the treasury here would mint guild copper).
      // The undo applies ONLY while the book sits exactly at the opened base:
      // if another session's expansion already advanced the ladder (open 0
      // to 24, expansion to 30, then this revert), subtracting the base
      // would strand a NON-LADDER position (6), collapsing capacity below
      // what rungs 1+ paid for. On any other count the grant stays (the
      // clamped-residue contract: never destroy paid value).
      if (book.purchasedSlots === GUILD_BANK_RUNG_SLOTS[0]) {
        book.purchasedSlots = 0;
      }
      continue;
    }
    if (d.op === 'buy_slots') {
      // An expansion (rungs 1+) only ever moves between valid ladder
      // positions at or above the opened base, so the slot undo applies only
      // while the result stays a valid position; the treasury refund applies
      // regardless (clamped, the accepted residue).
      if (book.purchasedSlots - GUILD_BANK_EXPANSION_SLOTS >= GUILD_BANK_RUNG_SLOTS[0]) {
        book.purchasedSlots -= GUILD_BANK_EXPANSION_SLOTS;
      }
      book.treasury = clampTreasury(book.treasury - d.copperDelta);
      continue;
    }
    if (typeof d.itemId !== 'string' || d.itemId === '') continue;
    const count = Math.max(0, Math.floor(Number(d.count)) || 0);
    if (count === 0) continue;
    if (d.op === 'deposit') {
      // Undo a deposit: remove up to `count` matching copies from the book
      // (newest slots first). The match is THREE-dimensional (itemId, the
      // canonical instance payload, AND craftedRecipeId): the book keeps a
      // crafted and a plain copy of one item as separate slots, and removing
      // across that line would destroy another officer's durable provenance.
      // A missing copy no-ops (another officer already withdrew it: the
      // accepted residue).
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
    } else if (d.op === 'withdraw') {
      // Undo a withdraw: put the copy back through the ONE canonical grant
      // path (addStacked): it merges only into stacks whose payload AND craft
      // provenance match, respects the per-item stack cap (a revert must not
      // mint an over-stacked slot no legitimate path can produce), and deep-
      // clones instanced payloads. Over-CAPACITY is tolerated by the book
      // contract (capacity only blocks new deposits); over-STACK is not.
      addStacked(
        book.inventory,
        d.itemId,
        count,
        d.instance ?? undefined,
        typeof d.craftedRecipeId === 'string' && d.craftedRecipeId !== ''
          ? d.craftedRecipeId
          : undefined,
      );
    }
  }
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

/** The ranks the guild bank trusts, as a POSITIVE allowlist shared by the op
 *  gate (requireOfficerBook) and the info read (guildBankInfoFor) so the two
 *  can never drift into a phantom-window or a leak. Exactly leader and
 *  officer: a rank ever added to GUILD_RANKS (an initiate tier, say) is
 *  DENIED here until this set is deliberately revisited, because a shared
 *  treasury must fail closed, never open. tests/guild_bank.test.ts sweeps
 *  every rank through both gates and pins the passing set. */
const GUILD_BANK_RANKS: ReadonlySet<GuildRank> = new Set(['leader', 'officer']);

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
 *  book. A missing stamp and a rank outside GUILD_BANK_RANKS each REFUSE with
 *  a player line; a stamped guild whose book is not loaded returns silently,
 *  because that is a host wiring state (Phase 3 boot-loads every book before
 *  players join), not a condition the player caused or can act on. Never
 *  mutates. */
function requireOfficerBook(ctx: SimContext, meta: PlayerMeta): GuildBankState | null {
  const m = meta.guildMembership;
  if (!m) {
    ctx.error(meta.entityId, 'You must be in a guild to use the guild bank.');
    return null;
  }
  if (!GUILD_BANK_RANKS.has(m.rank)) {
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
 *  EXPORTED for the UI parity pin only (tests/guild_bank_view.test.ts drives
 *  this and the client-side dormant predicate over the whole item table so a
 *  new refusal dimension cannot silently desync the Guild tab's rendering);
 *  no host calls it directly. */
export function guildBankPipeRefusal(slot: InvSlot): string | null {
  const def = ITEMS[slot.itemId];
  if (def?.kind === 'quest') return 'You cannot store quest items in the bank.';
  if (def?.soulbound) return 'You cannot store soulbound items in the guild bank.';
  if (def?.noMarketList) return 'That item cannot be stored in the guild bank.';
  if (isTransferLockedInstance(slot.instance)) {
    return 'That item cannot be stored in the guild bank.';
  }
  return null;
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
  // transfer; it stays dormant in the book (items are never destroyed).
  const refusal = guildBankPipeRefusal(book.inventory[slotIndex]);
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
 *  be broadcast to every officer just because the row exists. */
function guildBankSlotView(slot: InvSlot): InvSlot {
  const view = cloneInvSlot(slot);
  if (view.instance && guildBankPipeRefusal(slot) !== null) {
    view.instance = publicInstanceView(view.instance);
  }
  return view;
}

/** The proximity + rank gated guild bank snapshot the server's maybe('guildBank')
 *  stream reads (the bankInfoFor pattern): null unless the player is alive,
 *  within reach of a banker NPC, stamped officer-plus, and their guild's book is
 *  loaded; else a boundary-cloned view. The DEAD gate is stricter than the
 *  personal bank's on purpose: the stream must go null on death, demotion,
 *  leave, and walk-away (each pinned in tests/guild_bank.test.ts). A pure read:
 *  it draws NO rng and never hands out live sim slot references. Ships the
 *  full instance payload for every slot the pipe policy allows, because
 *  officers co-own the pooled contents and a withdrawer needs the real
 *  payload (charges). A slot the policy REFUSES (only reachable from a
 *  tampered or legacy Phase 3 row, since deposit keeps locked copies out) is
 *  dormant and unwithdrawable, so it degrades to the publicInstanceView
 *  projection: no boundTo or armed bindOnTrade (another character's bind
 *  identity) rides the wire to every officer. The read and the withdraw gate
 *  therefore agree slot for slot. */
export function guildBankInfoFor(ctx: SimContext, pid: number): GuildBankInfo | null {
  const r = resolveActor(ctx, pid);
  if (!r) return null;
  const { meta, e: p } = r;
  if (p.dead) return null;
  if (!nearBanker(ctx, p)) return null;
  const m = meta.guildMembership;
  if (!m || !GUILD_BANK_RANKS.has(m.rank)) return null;
  const book = ctx.guildBanks.get(m.guildId);
  if (!book) return null;
  return {
    treasury: book.treasury,
    slots: book.inventory.map(guildBankSlotView),
    capacity: guildBankCapacity(book),
    purchasedSlots: book.purchasedSlots,
    nextExpansionPrice: guildBankNextExpansionPrice(book),
  };
}
