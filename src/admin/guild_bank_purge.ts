// Request shaping for the guild bank dormant-slot purge (POST
// /admin/api/guilds/:id/bank/purge-slot), the guild_rename.ts pattern for the
// one admin action that destroys player property.
//
// THE ITEM ID IS A CONFIRMATION TOKEN, not decoration: the server splices the
// slot out, so every higher index shifts down by one. An operator acting on a
// stale listing would otherwise destroy a DIFFERENT dormant copy than the one
// they read. The dashboard therefore sends the itemId it LISTED at that index
// and the server refuses on a mismatch (see server/admin.ts
// purgeGuildBankSlotOutcome and src/sim/guild_bank.ts
// purgeDormantGuildBankSlot). Never let an operator type it: it must come from
// the same read the index came from, or the guard proves nothing.
//
// The server owns every real policy (the slot must exist, must actually be
// pipe-refused, and the guild must have a live carrier); this only stops a
// submission that could not possibly be valid and normalizes operator
// whitespace, exactly like buildGuildRename.

/** Client mirror of the server's reason bar (ADMIN_GUILD_REASON_MAX in
 *  server/admin_guilds_db.ts, applied to this route in server/admin.ts): the
 *  same cap the strictly less destructive guild rename beside it carries. The
 *  server refuses past it regardless. */
export const GUILD_BANK_REASON_MAX = 500;

export interface GuildBankPurgeBody {
  slot: number;
  itemId: string;
  reason: string;
}

export type GuildBankPurgeBuild =
  | { body: GuildBankPurgeBody }
  | {
      errorKey:
        | 'guilds.bankPurgeSlotRequired'
        | 'guilds.bankPurgeItemRequired'
        | 'guilds.bankPurgeReasonRequired'
        | 'guilds.bankPurgeReasonTooLong';
    };

export function buildGuildBankPurge(
  slot: number,
  itemId: string,
  reason: string,
): GuildBankPurgeBuild {
  if (!Number.isInteger(slot) || slot < 0) return { errorKey: 'guilds.bankPurgeSlotRequired' };
  const expectItemId = itemId.trim();
  if (!expectItemId) return { errorKey: 'guilds.bankPurgeItemRequired' };
  const moderationReason = reason.trim();
  if (!moderationReason) return { errorKey: 'guilds.bankPurgeReasonRequired' };
  if (moderationReason.length > GUILD_BANK_REASON_MAX) {
    return { errorKey: 'guilds.bankPurgeReasonTooLong' };
  }
  return { body: { slot, itemId: expectItemId, reason: moderationReason } };
}
