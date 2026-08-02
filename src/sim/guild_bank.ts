// The Guild Bank: a shared, guild-owned treasury plus pooled item store, the
// guild-scale sibling of the personal bank (bank.ts). Phase 1 (foundation)
// lands the state model, the ONE load path, the per-guild book map helpers,
// and the session-only membership stamp; the op bodies (deposit/withdraw/buy)
// and the proximity/rank-gated info read land with the wire in Phase 2, and
// the DB persistence that feeds loadGuildBank/serializeGuildBank in Phase 3.
//
// Books are keyed by the server social DB's guild id. Offline play never has a
// guild, so the map stays empty and every IWorld guild-bank member is inert.
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no Math.random/
// Date.now (enforced by tests/architecture.test.ts). This module draws NO rng.

import { instancedCountCap } from './bags';
import { ITEMS } from './data';
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
 *  id is ignored so a tampered row can never mint a garbage key. */
export function loadGuildBank(ctx: SimContext, guildId: number, raw: unknown): void {
  if (!Number.isInteger(guildId) || guildId <= 0) return;
  ctx.guildBanks.set(guildId, sanitizeGuildBankState(raw));
}

/** Snapshot a guild's book for persistence, deep-cloned (cloneInvSlot, never a
 *  shallow spread) so the save never aliases the live inventory's mutable
 *  instance payloads. Pure shape-out: the server owns the SQL (Phase 3). */
export function serializeGuildBank(ctx: SimContext, guildId: number): GuildBankState | null {
  const book = ctx.guildBanks.get(guildId);
  if (!book) return null;
  return {
    treasury: book.treasury,
    inventory: book.inventory.map(cloneInvSlot),
    purchasedSlots: book.purchasedSlots,
  };
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
