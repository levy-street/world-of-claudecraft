// Pure view-core for the Guild tab of the Bank window (#bank-window), the
// officer-plus pooled store read off the IWorld guildBankInfo mirror. DOM/Three/
// i18n-free: it maps the proximity+rank-gated GuildBankInfo snapshot (null for
// members, offline, away from a banker, dead, or while the book is not loaded)
// to a flat render model the thin pane painter (guild_bank_window.ts) draws.
// Money stays RAW COPPER here; the painter formats it through the i18n
// formatMoney / moneyHtml at the boundary (the BankBuySlotsModel.nextCost
// precedent). Registered in UI_PURE_CORES; unit-tested against both Sim- and
// ClientWorld-shaped inputs in tests/guild_bank_view.test.ts.
//
// DORMANT slots are the one place this core diverges from bank_view.ts: the
// guild bank is an anonymous exchange pipe, so a slot the pipe policy refuses
// (quest / soulbound / noMarketList / a per-copy transfer lock) is
// unwithdrawable BOTH ways (src/sim/guild_bank.ts guildBankPipeRefusal) and
// also blocks guild disband (the documented v1 limitation in
// docs/guild-bank/state.md). Such a slot MUST render visibly distinct and must
// NEVER be hidden the way the personal bank drops unknown-id slots. The
// predicate here mirrors the sim's def-level rules plus the per-copy lock;
// a tampered row whose ONLY refusal dimension was a transfer lock arrives with
// its lock fields stripped by the publicInstanceView projection, so that copy
// renders as an ordinary slot and its withdraw round-trips to the sim's own
// localized refusal (the wire deliberately does not broadcast bind identity).
// An UNKNOWN item id is a separate dormant-shaped state (a content update
// removed the def): it renders distinct too, but the sim allows withdrawing it
// (the recovery path), so it stays actionable.
//
// UNOPENED banks: a guild that has bought no ladder rung yet has 0 item
// slots (purchasedSlots 0). The model's 'unopened' kind renders the treasury
// section as normal plus the open-the-bank row (rung 0: 24 slots for the
// PURSE-paid table price) instead of the slot grid; its affordability reads
// the acting officer's live purse, the one deliberate purse read in this core.

import {
  GUILD_BANK_EXPANSION_SLOTS,
  GUILD_BANK_RUNG_PRICES,
  GUILD_BANK_TREASURY_CAP,
  guildBankRungsBought,
} from '../sim/guild_bank';
import { isTransferLockedInstance } from '../sim/item_instance_transfer';
import type { InvSlot, ItemInstancePayload } from '../sim/types';
import type { GuildBankInfo } from '../world_api';
import { bagQualityKey } from './bags_view';

/** The item facts the guild grid needs from the item table: the quality tint
 *  plus the pipe-policy def dimensions. A miss (unknown id) marks the slot
 *  unknown rather than dropping it (slots are never hidden here). */
export type GuildBankItemLookup = (itemId: string) =>
  | {
      quality?: string;
      kind?: string;
      soulbound?: boolean;
      noMarketList?: boolean;
    }
  | undefined;

/** The client mirror of the sim's guildBankPipeRefusal for a slot ALREADY IN
 *  the book: true when the withdraw side would refuse it (dormant). The def
 *  dimensions come from the lookup; the per-copy lock reads the slot payload
 *  (a projected dormant copy has its lock fields stripped, see the header).
 *  An unknown def is NOT dormant by this predicate: the sim withdraw allows it. */
export function guildBankSlotDormant(
  slot: Pick<InvSlot, 'itemId' | 'instance'>,
  item: ReturnType<GuildBankItemLookup>,
): boolean {
  if (item) {
    if (item.kind === 'quest') return true;
    if (item.soulbound) return true;
    if (item.noMarketList) return true;
  }
  return isTransferLockedInstance(slot.instance);
}

/** One guild bank cell. `slotIndex` is the index into GuildBankInfo.slots and
 *  is the exact wire argument for guildBankWithdraw (order preserved verbatim;
 *  the guild tab has no search/sort layer, so nothing reorders or drops slots:
 *  a dormant slot must stay visible). */
export interface GuildBankSlotModel {
  slotIndex: number;
  itemId: string;
  /** False when the item table has no def for this id (a removed item): the
   *  painter renders the recoverable-unknown cell instead of an icon. */
  known: boolean;
  count: number;
  showCount: boolean; // count > 1 (a lone item hides its "1")
  qualityKey: string; // item quality ?? 'common' (bagQualityKey semantics)
  /** Pipe-refused (unwithdrawable) slot: renders visibly distinct, never hidden. */
  dormant: boolean;
  /** Per-copy payload passthrough for the tooltip's instance lines. Dormant
   *  slots arrive already projected (publicInstanceView) by the sim read. */
  instance?: ItemInstancePayload;
}

/** The header counter: occupied slots over the total budget. */
export interface GuildBankCapacityModel {
  used: number;
  total: number;
  purchasedSlots: number;
}

/** The treasury row: raw copper plus the two gold-action enablements. The
 *  enablement reads only SNAPSHOT state (never the live purse), so the render
 *  signature the window diffs stays purse-free: deposit is possible while the
 *  treasury is below its cap, withdraw while it holds anything. The per-prompt
 *  maxima are resolved at prompt-open time from the live purse (see
 *  guildBankGoldDepositMax / guildBankGoldWithdrawMax). */
export interface GuildBankTreasuryModel {
  copper: number;
  canDepositGold: boolean; // treasury below GUILD_BANK_TREASURY_CAP
  canWithdrawGold: boolean; // treasury > 0
}

/** The expand-slots footer: the next block's copper price (null once maxed),
 *  the block size, the maxed flag, and whether the TREASURY can afford it now
 *  (informational styling only: the button never gates on affordability, the
 *  family precedent; the sim refuses with its own localized line). */
export interface GuildBankBuySlotsModel {
  nextPrice: number | null;
  blockSlots: number;
  maxed: boolean;
  affordable: boolean;
}

/** The open-the-bank row of the UNOPENED pane: ladder rung 0's copper price
 *  and whether the ACTING OFFICER'S OWN PURSE covers it right now (rung 0 is
 *  purse-paid, unlike every later rung's treasury enablement; the marker is
 *  informational styling only, the button never gates on it). */
export interface GuildBankOpenModel {
  price: number;
  affordable: boolean;
}

/** The whole guild pane model: 'hidden' when guildBankInfo is null (member
 *  rank, offline, away, dead, or the book not loaded); 'unopened' while the
 *  guild has bought no ladder rung yet (0 item slots: the treasury section
 *  renders as normal plus the open-the-bank row instead of the slot grid);
 *  else the populated grid + treasury + buy panel. */
export type GuildBankViewModel =
  | { kind: 'hidden' }
  | {
      kind: 'unopened';
      treasury: GuildBankTreasuryModel;
      open: GuildBankOpenModel;
    }
  | {
      kind: 'guild';
      treasury: GuildBankTreasuryModel;
      capacity: GuildBankCapacityModel;
      slots: GuildBankSlotModel[];
      // Free cells to paint after the items. Over-capacity states (a tampered
      // book with used > total) clamp to 0, never a negative pad.
      emptyCells: number;
      empty: boolean; // no occupied slots
      buy: GuildBankBuySlotsModel;
      hasDormant: boolean; // any dormant slot present (drives the legend line)
    };

/** Map the gated guild bank snapshot to the render model. `info` is null
 *  whenever the tab must not render (both worlds), which yields 'hidden'.
 *  `purseCopper` is the acting officer's LIVE purse, read only by the
 *  unopened pane's rung-0 affordability (rung 0 is purse-paid); the opened
 *  pane's enablement stays snapshot-only (purse-free) as before.
 *  Slot order and indices are preserved verbatim; nothing is dropped. */
export function buildGuildBankView(
  info: GuildBankInfo | null,
  lookup: GuildBankItemLookup,
  purseCopper: number,
): GuildBankViewModel {
  if (!info) return { kind: 'hidden' };
  const treasury: GuildBankTreasuryModel = {
    copper: info.treasury,
    canDepositGold: info.treasury < GUILD_BANK_TREASURY_CAP,
    canWithdrawGold: info.treasury > 0,
  };
  if (guildBankRungsBought(info.purchasedSlots) === 0) {
    // No rung bought yet: the bank is unopened (0 item slots). Rung 0's price
    // rides the same nextExpansionPrice field (defensively falling back to
    // the table literal, unreachable off a real snapshot).
    const price = info.nextExpansionPrice ?? GUILD_BANK_RUNG_PRICES[0];
    return {
      kind: 'unopened',
      treasury,
      open: { price, affordable: Math.floor(purseCopper) >= price },
    };
  }
  const slots: GuildBankSlotModel[] = info.slots.map((slot, slotIndex) => {
    const item = lookup(slot.itemId);
    return {
      slotIndex,
      itemId: slot.itemId,
      known: item !== undefined,
      count: slot.count,
      showCount: slot.count > 1,
      qualityKey: bagQualityKey(item ?? {}),
      dormant: guildBankSlotDormant(slot, item),
      instance: slot.instance,
    };
  });
  const used = slots.length;
  const total = info.capacity;
  return {
    kind: 'guild',
    treasury,
    capacity: {
      used,
      total,
      purchasedSlots: info.purchasedSlots,
    },
    slots,
    emptyCells: Math.max(0, total - used),
    empty: used === 0,
    buy: {
      nextPrice: info.nextExpansionPrice,
      blockSlots: GUILD_BANK_EXPANSION_SLOTS,
      maxed: info.nextExpansionPrice === null,
      affordable: info.nextExpansionPrice !== null && info.treasury >= info.nextExpansionPrice,
    },
    hasDormant: slots.some((s) => s.dormant),
  };
}

/** What a click on a guild bank slot does: a whole-stack withdraw, the split
 *  prompt (shift on a multi-count fungible), or nothing (empty cell). A DORMANT
 *  slot still sends the plain withdraw (never the split prompt): the sim
 *  refuses it with its own localized line, so the refusal round-trips through
 *  the facet instead of being silenced client-side, and the same path covers
 *  the projected-lock copy this core cannot detect (see the header). */
export type GuildBankSlotAction =
  | { kind: 'withdraw'; slotIndex: number }
  | { kind: 'withdrawPartial'; slotIndex: number; max: number }
  | { kind: 'none' };

export function guildBankSlotAction(
  slot: InvSlot | undefined,
  slotIndex: number,
  shift: boolean,
  dormant: boolean,
): GuildBankSlotAction {
  if (!slot) return { kind: 'none' };
  if (!dormant && shift && slot.count > 1 && !slot.instance) {
    return { kind: 'withdrawPartial', slotIndex, max: slot.count };
  }
  return { kind: 'withdraw', slotIndex };
}

// Copper-per-denomination (the market_view / mailbox_window constants).
const COPPER_PER_GOLD = 10_000;
const COPPER_PER_SILVER = 100;

/** Compose the three coin-prompt fields into copper. Each field is floored and
 *  clamped non-negative independently, so a malformed field never poisons the
 *  others (the mailbox read() semantics). */
export function coinFieldsToCopper(gold: number, silver: number, copper: number): number {
  const part = (v: number) => Math.max(0, Math.floor(Number(v)) || 0);
  return part(gold) * COPPER_PER_GOLD + part(silver) * COPPER_PER_SILVER + part(copper);
}

/** The most copper a gold DEPOSIT prompt may submit right now: bounded by the
 *  live purse and the treasury headroom. 0 when nothing can move. */
export function guildBankGoldDepositMax(purseCopper: number, treasuryCopper: number): number {
  return Math.max(
    0,
    Math.min(Math.floor(purseCopper), GUILD_BANK_TREASURY_CAP - Math.floor(treasuryCopper)),
  );
}

/** The most copper a gold WITHDRAW prompt may submit right now: bounded by the
 *  treasury and the integer-safe purse headroom (the sim's own refusal bound). */
export function guildBankGoldWithdrawMax(purseCopper: number, treasuryCopper: number): number {
  return Math.max(
    0,
    Math.min(Math.floor(treasuryCopper), Number.MAX_SAFE_INTEGER - Math.floor(purseCopper)),
  );
}

/** Clamp a composed prompt amount against its max. Null means REFUSE the
 *  submit (nothing to send: zero, negative, or no headroom at all), never a
 *  clamped-to-zero send the sim would treat as malformed. */
export function clampGoldAmount(amount: number, max: number): number | null {
  if (!Number.isFinite(amount)) return null;
  const a = Math.min(Math.floor(amount), Math.floor(max));
  return a > 0 ? a : null;
}
