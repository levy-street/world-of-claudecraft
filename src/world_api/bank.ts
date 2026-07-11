import type { InvSlot } from '../sim/types';

// ---------------------------------------------------------------------------
// The Bank (the per-character deposit box). A second pooled item store beside
// the carried backpack + bags: capacity is a flat slot budget over one list
// (nothing pins an item to a fixed cell), and the state is per-character,
// serialized inside the character save exactly like inventory/bags. bankInfo
// streams only while standing at a banker NPC (the mailInfo pattern). The base
// 24 slots grow in copper-bought 6-slot blocks (BANK_EXPANSION_PRICES) plus a
// server-stamped bonus-slot grant (recomputed at every join by the entitlement registry).
// ---------------------------------------------------------------------------

/** One row of the server-computed bonus-slot breakdown: which account action grants
 *  (or could grant) bonus bank slots, and how far along it is. Earned status is
 *  derived (slots > 0); rows for unearned sources advertise what linking would grant.
 *  The list is append-only data: a future source (X, Twitch) is a new row with a new
 *  id, never a shape change. Offline worlds always carry an empty list. */
export interface BankBonusSource {
  id: string; // stable source id ('email' | 'discord' | 'wallet' | 'referral'; future sources append)
  slots: number; // slots this source grants right now
  maxSlots: number; // slots it grants when fully earned
  count?: number; // progress numerator (referral: qualified referees, capped for display)
  cap?: number; // progress denominator (referral: the referral cap)
}

export interface BankInfo {
  slots: InvSlot[]; // the pooled bank contents (a boundary clone, never a live sim reference)
  capacity: number; // total slot budget: base + purchased + bonus
  purchasedSlots: number; // copper-bought slots, always a multiple of the 6-slot block
  bonusSlots: number; // server-granted bonus slots, recomputed and stamped at every join
  // Copper price of the NEXT expansion, null once purchased slots are maxed.
  nextExpansionCost: number | null;
  // The per-source breakdown behind bonusSlots (server-stamped at join; [] offline).
  bonusSources: BankBonusSource[];
}

export interface IWorldBank {
  // Non-null only while standing at a banker NPC.
  bankInfo: BankInfo | null;
  bankDeposit(slotIndex: number, count?: number): void;
  bankWithdraw(slotIndex: number, count?: number): void;
  bankBuySlots(): void;
}
