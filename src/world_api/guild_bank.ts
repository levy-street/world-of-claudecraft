import type { InvSlot } from '../sim/types';

// ---------------------------------------------------------------------------
// The Guild Bank: a shared, guild-owned treasury plus pooled item store, the
// guild-scale sibling of the personal bank (bank.ts). Officer-plus only (leader
// included): members get no data and no UI tab. guildBankInfo streams only
// while an officer-plus stands at a banker NPC (the bankInfo pattern); offline
// play never has a guild, so the offline Sim reads null and every command is
// inert. The base 12 slots grow in treasury-bought 6-slot blocks
// (GUILD_BANK_EXPANSION_PRICES in src/sim/guild_bank.ts); the treasury is
// capped and deposits beyond the cap are refused, never truncated.
//
// Phase 1 lands the facet with stubs in both worlds; the guild_bank_* wire
// tokens, dispatch, and the snapshot mirror land in Phase 2.
// ---------------------------------------------------------------------------

export interface GuildBankInfo {
  treasury: number; // copper the guild holds, within [0, GUILD_BANK_TREASURY_CAP]
  slots: InvSlot[]; // the pooled contents (a boundary clone, never a live sim reference)
  capacity: number; // total slot budget: base + purchased
  purchasedSlots: number; // treasury-bought slots, always a multiple of the 6-slot block
  // Copper price of the NEXT expansion (table lookup, never client-supplied),
  // null once every expansion is bought.
  nextExpansionPrice: number | null;
}

export interface IWorldGuildBank {
  // Non-null only while an officer-plus guild member stands at a banker NPC.
  guildBankInfo: GuildBankInfo | null;
  guildBankDepositGold(amount: number): void;
  guildBankWithdrawGold(amount: number): void;
  guildBankDeposit(slotIndex: number, count?: number): void;
  guildBankWithdraw(slotIndex: number, count?: number): void;
  guildBankBuySlots(): void;
}
