// The OPERATOR projection of one guild's live bank: the payload behind
// GET /admin/api/guilds/:id/bank, the discovery surface the dormant-slot purge
// (POST .../bank/purge-slot) is unusable without.
//
// WHY IT EXISTS. The purge takes a slot INDEX plus the itemId that index is
// believed to hold, and it only accepts a slot the anonymous-pipe policy
// refuses. Without a read, an operator had to discover both out of band (SQL on
// guild_banks) before they could type them into the escape hatch. This is that
// read, and it is deliberately the SAME source the purge mutates: the ungated
// guild-scoped snapshot (src/sim/guild_bank.ts guildBankInfoForGuild), so a
// listing and the refusal that follows it can never disagree about what is in
// the book.
//
// THE DORMANT FLAG IS THE PURGE PREDICATE, not a second opinion:
// `guildBankPipeRefusal(slot) !== null` is exactly what purgeDormantGuildBankSlot
// checks, so a slot this view marks dormant is a slot the hatch accepts and a
// slot it does not mark is one the hatch refuses (pinned in
// tests/server/admin_guild_bank_view.test.ts by driving both over one book).
//
// WHAT IS DELIBERATELY WITHHELD. The source snapshot is UNprojected on purpose
// (the purge's ledger row keeps the real instance payload as evidence), which
// makes this the projection boundary: an operator gets the item id, the count
// and the flag, and the per-copy `instance` payload is DROPPED rather than
// reshaped. That payload carries another character's bind identity (boundTo /
// an armed bindOnTrade), which is account-scoped data no dashboard panel needs
// to answer "which slot is stuck". Nothing account-scoped rides this view: no
// account id, no character id or name, no realm, no IP, no depositor (the book
// keeps none).

import { guildBankPipeRefusal } from '../src/sim/guild_bank';
import type { GuildBankInfo } from '../src/world_api';

/** One book slot as an operator sees it. `index` is the index into the live
 *  book and is the exact `slot` argument the purge takes; `itemId` is its
 *  confirmation token (a purge splices, so every higher index shifts down). */
export interface AdminGuildBankSlotView {
  index: number;
  itemId: string;
  count: number;
  /** Pipe-refused: unwithdrawable in both directions, so it blocks disband and
   *  is the ONLY thing the purge will remove. */
  dormant: boolean;
}

/** One guild's bank, operator view. Counts are derived here rather than in the
 *  dashboard so the panel and any future consumer agree on what "used" and
 *  "stuck" mean. */
export interface AdminGuildBankView {
  treasury: number;
  capacity: number;
  purchasedSlots: number;
  /** Occupied slots (the book stores no empty slots: it splices on removal). */
  usedSlots: number;
  /** How many of `slots` are dormant: the "can this guild disband" answer. */
  dormantSlots: number;
  slots: AdminGuildBankSlotView[];
}

/** Project the ungated book snapshot onto the operator payload. Pure: no db, no
 *  runtime, no live sim reference (its input is already a boundary clone). */
export function adminGuildBankView(info: GuildBankInfo): AdminGuildBankView {
  const slots = info.slots.map((slot, index) => ({
    index,
    itemId: slot.itemId,
    count: slot.count,
    dormant: guildBankPipeRefusal(slot) !== null,
  }));
  return {
    treasury: info.treasury,
    capacity: info.capacity,
    purchasedSlots: info.purchasedSlots,
    usedSlots: slots.length,
    dormantSlots: slots.reduce((n, slot) => n + (slot.dormant ? 1 : 0), 0),
    slots,
  };
}
