import type { InvSlot } from '../sim/types';

// ---------------------------------------------------------------------------
// The Guild Bank: a shared, guild-owned treasury plus pooled item store, the
// guild-scale sibling of the personal bank (bank.ts). Officer-plus only (leader
// included): members get no data and no UI tab. guildBankInfo streams only
// while an officer-plus stands at a banker NPC (the bankInfo pattern); offline
// play never has a guild, so the offline Sim reads null and every command is
// inert. A new guild's bank is UNOPENED (0 item slots; treasury gold ops work
// from day one): ladder rung 0 opens it for 24 slots, paid from the clicking
// officer's own purse, and rungs 1+ are treasury-bought 6-slot expansions
// (GUILD_BANK_RUNG_PRICES in src/sim/guild_bank.ts); the treasury is
// capped and deposits beyond the cap are refused, never truncated.
//
// The guild_bank_* wire tokens, dispatch, and the snapshot mirror are live:
// ClientWorld sends them and the server acts through the sim's pid-first
// guildBank*For entry points. The offline Sim arm is inert forever (offline
// play never has a guild). Books are not persisted until Phase 3.
// ---------------------------------------------------------------------------

export interface GuildBankInfo {
  treasury: number; // copper the guild holds, within [0, GUILD_BANK_TREASURY_CAP]
  slots: InvSlot[]; // the pooled contents (a boundary clone, never a live sim reference)
  capacity: number; // total slot budget: the granted slots of every bought rung
  // Granted slots across bought ladder rungs, always a value from
  // GUILD_BANK_LADDER_POSITIONS: 0 while the bank is UNOPENED (the client
  // derives the open-the-bank pane from this), 24 once opened, +6 per expansion.
  purchasedSlots: number;
  // Copper price of the NEXT ladder rung (table lookup, never client-supplied;
  // rung 0 is purse-paid, rungs 1+ treasury-paid), null once the ladder is done.
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
