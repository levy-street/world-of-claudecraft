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
import { bagCapacity, bagsFullError, instancedCountCap } from './bags';
import { moveBetweenContainers, nearBanker } from './bank';
import { ITEMS } from './data';
import { formatMoney } from './format_money';
import { isTransferLockedInstance, publicInstanceView } from './item_instance_transfer';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { cloneInvSlot, type InvSlot } from './types';

/** One-time fee the founder pays when a guild is created (10 gold). Charged in
 *  Phase 3's guild_create dispatch AFTER the guild row exists (create first,
 *  then deduct: a crash between them yields a free guild, never lost gold). */
export const GUILD_CREATION_FEE_COPPER = 100_000;

/** Slots every guild bank starts with, before any expansion. */
export const GUILD_BANK_BASE_SLOTS = 12;

/** Slots one treasury-bought expansion adds; also the granularity purchasedSlots
 *  stays on (sanitize floors to a whole expansion so price indexing stays coherent). */
export const GUILD_BANK_EXPANSION_SLOTS = 6;

/** Copper price of each successive expansion, ALWAYS looked up by
 *  purchased-expansion count (never client-supplied) and paid from the guild
 *  treasury, not personal copper. 5g, 10g, 25g, 50g, 100g, 250g; 440g total;
 *  max 48 slots (base 12 + 6 expansions of 6). */
export const GUILD_BANK_EXPANSION_PRICES: readonly number[] = [
  50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000,
];

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
  /** Treasury-bought slots, always a whole multiple of GUILD_BANK_EXPANSION_SLOTS. */
  purchasedSlots: number;
}

/** The bank's current slot budget. Over-capacity inventories are tolerated (a
 *  tampered/legacy save may overflow); capacity only blocks new deposits,
 *  exactly like the personal bank. */
export function guildBankCapacity(bank: GuildBankState): number {
  return GUILD_BANK_BASE_SLOTS + bank.purchasedSlots;
}

/** Copper price of the NEXT expansion (a table lookup indexed by
 *  purchased-expansion count), or null once every expansion is bought. */
export function guildBankNextExpansionPrice(bank: GuildBankState): number | null {
  const purchased = Math.floor(bank.purchasedSlots / GUILD_BANK_EXPANSION_SLOTS);
  return GUILD_BANK_EXPANSION_PRICES[purchased] ?? null;
}

export function createEmptyGuildBankState(): GuildBankState {
  return { treasury: 0, inventory: [], purchasedSlots: 0 };
}

/** The ONE load path for persisted guild bank state (the sanitizeBankState
 *  contract): tampered/legacy shapes sanitize; items are NEVER destroyed (an
 *  unknown-but-string itemId stays as dormant recoverable data, the mail
 *  precedent); over-capacity inventories are tolerated (never truncated).
 *  treasury clamps into [0, GUILD_BANK_TREASURY_CAP]; purchasedSlots clamps
 *  into range and floors to a whole expansion so price indexing stays coherent. */
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
  const maxPurchased = GUILD_BANK_EXPANSION_PRICES.length * GUILD_BANK_EXPANSION_SLOTS;
  let purchasedSlots = Math.max(
    0,
    Math.min(maxPurchased, Math.floor(Number(r.purchasedSlots)) || 0),
  );
  purchasedSlots -= purchasedSlots % GUILD_BANK_EXPANSION_SLOTS;
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
 *  copper actually charged. Called by the server AFTER the guild row commits
 *  (create-then-charge, state.md: a crash between the two yields a free guild,
 *  never lost gold). The server refuses a poor founder BEFORE any DB work, so
 *  a shortfall here means copper was spent mid-flight: the charge clamps to
 *  the purse (never negative) rather than refusing a guild that already
 *  exists. Deliberately emits NO player line (the "You found the guild" arm
 *  is the celebration; the purse delta rides the normal self snapshot). */
export function chargeGuildCreationFee(ctx: SimContext, pid: number): number {
  const r = resolveActor(ctx, pid);
  if (!r) return 0;
  const charged = Math.min(r.meta.copper, GUILD_CREATION_FEE_COPPER);
  if (charged <= 0) return 0;
  r.meta.copper -= charged;
  return charged;
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
 *  philosophy). Returns the refusal line, or null when the slot may move. */
function guildBankPipeRefusal(slot: InvSlot): string | null {
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

/** Buy the next 6-slot guild bank expansion, paid from the guild TREASURY
 *  (never personal copper), at the table price for the current purchase count
 *  (never client-supplied). Blocked at the ladder's end; no refusal mutates. */
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
  const price = guildBankNextExpansionPrice(book);
  if (price === null) {
    ctx.error(meta.entityId, 'The guild bank cannot be expanded further.');
    return;
  }
  if (book.treasury < price) {
    ctx.error(meta.entityId, 'Your guild cannot afford that expansion.');
    return;
  }
  book.treasury -= price;
  book.purchasedSlots += GUILD_BANK_EXPANSION_SLOTS;
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
