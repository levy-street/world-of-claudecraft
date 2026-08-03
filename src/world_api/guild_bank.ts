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

// ---------------------------------------------------------------------------
// The guild bank ACTIVITY LOG: the social trust mechanism the officer-only
// design rests on. Every guild bank op already writes an append-only
// `bank_ledger` row; this read is what lets the guild SEE those rows, so a
// quiet drain by one officer is visible to the rest instead of being knowledge
// that exists only in the operator's database.
//
// COLD DATA. It is fetched on demand when the log view opens (the
// guildBankLog() read requests it), never on the 20 Hz snapshot stream: it is
// identical for every officer of a guild, it changes only when the book does,
// and 50 rows of prose have no business riding a movement frame.
//
// What a player is shown is deliberately NARROWER than what the ledger holds:
// the internal anomaly ops (`escrow_deficit`, `counterparty_orphan`) are
// operator forensics, not guild history, and never reach the client at all.
// ---------------------------------------------------------------------------

/**
 * How many rows one read returns: the window the server answers with, the hard
 * bound the client decoder truncates at, AND the number the pane's scope line
 * says out loud. It lives on the SEAM because all three of those are the same
 * fact: with the constant duplicated per layer, raising the cap would have left
 * the copy lying in every language while the decoder silently dropped rows.
 *
 * A short recent history rather than an archive, which is what a guild actually
 * reads after "who took the ore?"; it also bounds the frame and the index scan.
 * The full history stays in bank_ledger forever for the audit.
 */
export const GUILD_BANK_LOG_LIMIT = 50;

/** The ops a guild can SEE. A strict subset of the `bank_ledger` op vocabulary
 *  (server/db.ts BankLedgerRow['op']): the two diagnostic anomaly ops are never
 *  projected here, so a client can never render one. */
export type GuildBankLogOp =
  | 'deposit' // an item went into the book
  | 'withdraw' // an item came out of it
  | 'deposit_gold' // copper into the treasury
  | 'withdraw_gold' // copper out of it
  | 'buy_slots' // a treasury-paid expansion rung
  | 'open_bank' // ladder rung 0, opened from the officer's own purse
  | 'create_fee' // the founder's charter fee (a purse payment, not a treasury move)
  | 'admin_purge'; // an operator removed a stuck item; NEVER a guildmate's doing

/** One rendered line of guild bank history. Carries no account id, no character
 *  id, no realm, and no IP: an actor is a DISPLAY NAME or nothing at all. */
export interface GuildBankLogEntry {
  /** The `bank_ledger` row id: monotonic, the stable ordering and de-dupe key.
   *  Not an account-scoped identifier and not addressable by any other route. */
  id: number;
  /** Epoch milliseconds the row was written; rendered through the i18n
   *  date formatter at the painter boundary, never pre-formatted server-side. */
  at: number;
  /** The acting character's display name (player-authored text: the painter
   *  splices it verbatim into an escaping sink, never through t()).
   *  NULL means no guildmate acted, which has exactly two shapes: an
   *  `admin_purge` (whose ledger character column is only the escrow CARRIER, a
   *  bystander who did not order the removal, so naming them would be a lie),
   *  and the unreachable-in-practice deleted-character row. */
  actor: string | null;
  op: GuildBankLogOp;
  /** The item id the op moved, or null for a money/ladder op. */
  itemId: string | null;
  /** How many copies moved (a positive magnitude; the op names the direction). */
  count: number | null;
  /** RAW copper the op moved, a positive magnitude (the op names the
   *  direction); null for an item op. Formatted through the i18n formatMoney at
   *  the painter boundary, never here. */
  copper: number | null;
}

/** The whole log read. `loading` is the in-flight state (entries hold whatever
 *  the last successful response carried, so a refresh never blanks the pane);
 *  `refused` means the server declined the read (a member, a demotion mid-view,
 *  a lost guild), which the pane must say out loud rather than showing an
 *  empty list that reads as "no officer has ever done anything". */
export interface GuildBankLogView {
  state: 'loading' | 'ready' | 'refused';
  entries: readonly GuildBankLogEntry[];
}

export interface IWorldGuildBank {
  // Non-null only while an officer-plus guild member stands at a banker NPC.
  guildBankInfo: GuildBankInfo | null;
  /** The guild bank activity log, fetched ON DEMAND: calling this is what
   *  REQUESTS it (there is no snapshot key for it), so a caller must only call
   *  it while the log view is actually on screen.
   *
   *  Two things bound the traffic, and they are different: this call is
   *  IDEMPOTENT inside its TTL, so a per-frame repaint of an open log view
   *  sends at most one request per TTL rather than one per frame; and while the
   *  view is CLOSED nobody calls it at all, so nothing is sent. Neither alone
   *  is enough (the second is the one a caller can get wrong), which is why the
   *  UI gates on the pane being visible rather than on its remembered sub-view.
   *  The offline Sim has no guild and always answers an empty ready view. */
  guildBankLog(): GuildBankLogView;
  guildBankDepositGold(amount: number): void;
  guildBankWithdrawGold(amount: number): void;
  guildBankDeposit(slotIndex: number, count?: number): void;
  guildBankWithdraw(slotIndex: number, count?: number): void;
  guildBankBuySlots(): void;
}
