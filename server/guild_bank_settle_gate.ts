// The UNSETTLED gate for guild bank ops. A session may take out of the live
// book only what durable truth already holds plus what its OWN unflushed log
// put in. Value another session deposited but has not yet made durable is
// UNSETTLED: consuming it puts a replay dependency on that session into this
// session's escrow log, and the escrow save honours only a ONE-WAY dependency
// (its refusal arm flushes the other session and retries, see
// server/guild_bank_escrow_refusal.ts).
//
// Two sessions that each consumed the other's unsettled value can never
// commit in any order. The 2026-09-01 production incident was exactly that
// shape: officer A deposited spider legs and took B's venom glands, B
// deposited the venom glands and took A's spider legs, all inside one autosave
// window. Each replay was short on the key the other held, the retry bound
// rolled both back, both were disconnected as "taken over", and the
// per-session reverts of an already-consumed deposit clamped on the live book
// and left a PHANTOM stack that rolled back every officer who withdrew it
// until the realm restarted. The design note that only ladder rungs could
// deadlock was true for ONE fungible (gold: one of two nets is always
// non-negative); it is false as soon as two item identities are involved.
//
// Refusing the consume HERE, at the dispatch boundary, makes that whole class
// unreachable in ordinary play: a log can then only carry deposits (always
// applicable), removals of settled copies, and rungs bought on a settled
// ladder, so a replay refusal and the rollback behind it become the backstop
// they were meant to be. The cost is one "try again in a moment" notice when
// an officer reaches for a deposit made moments ago, and the host flushes the
// depositor on the spot so the retry lands a round trip later.
//
// Pure: the host hands over the live book snapshot and the OTHER holders'
// contributions (server/guild_book_holders.ts keeps them indexed per guild and
// cached per holder); nothing here touches a session or the sim.

import {
  type GuildBankDeltaDeficit,
  type GuildBankOpDelta,
  guildBankDeltaIdentityKey,
  guildBankRungsBought,
} from '../src/sim/guild_bank';
import { isMaterialItemId } from '../src/sim/material_ids';
import type { MaterialSourceTransferSelection } from '../src/sim/material_source_transfer_selection';
import type { InvSlot } from '../src/sim/types';
import type { GuildBankInfo } from '../src/world_api';
import {
  guildBankMaterialSourceContribution,
  guildBankMaterialWithdrawal,
} from './guild_bank_material_settle_gate';

/** The ops the gate judges. Deposits are never gated: a deposit replays onto
 *  any base. The operator purge is not gated either: it removes only a
 *  DORMANT copy the deposit pipe refuses, which can only be durable. */
export const GUILD_BANK_GATED_OPS = ['withdraw', 'withdraw_gold', 'buy_slots'] as const;
export type GuildBankGatedOp = (typeof GUILD_BANK_GATED_OPS)[number];

export function isGuildBankGatedOp(op: string): op is GuildBankGatedOp {
  return (GUILD_BANK_GATED_OPS as readonly string[]).includes(op);
}

/** The client-supplied inputs of one op, as the dispatch site received them
 *  (already type-checked there). The gate mirrors the sim's own admissibility
 *  checks on them and passes every inadmissible shape through UNJUDGED, so a
 *  request the sim is going to refuse anyway can never buy a refusal, an
 *  incident, or a holder flush. */
export interface GuildBankOpRequest {
  readonly slot?: number;
  readonly count?: number;
  readonly amount?: number;
  readonly selection?: MaterialSourceTransferSelection;
}

/** One holder's contribution to a book's unsettled value: its OWN net per
 *  identity key and net treasury copper, positives only, plus whether it holds
 *  a ladder rung. The sum over holders is what the gate judges against.
 *
 *  Positives only, PER HOLDER: a commit is atomic per session, so the worst
 *  durable base for the acting replay is every net-REMOVING holder already
 *  committed (durable lowered) and every net-DEPOSITING holder not yet
 *  committed (its copies still unsettled). Netting one holder's withdrawal
 *  against another holder's deposit would hide the deposit (holder C's
 *  withdraw of 10 cancels holder B's deposit of 10, and the acting officer
 *  takes B's copies ungated), which is the same two-identity cycle the gate
 *  exists to refuse, one officer removed. */
export interface GuildBookContribution {
  /** Per identity key (the escrow replay's three-dimensional key). */
  readonly items: ReadonlyMap<string, number>;
  /** Positive units per normalized material payload and exact source descriptor. */
  readonly sourceUnits: ReadonlyMap<string, number>;
  /** Net treasury copper the replay would MOVE. open_bank is excluded (rung 0
   *  is purse-paid and the applier never moves it), buy_slots is included (its
   *  charge left the treasury). */
  readonly copper: number;
  /** True while any slot op is outstanding: a rung replays only onto the exact
   *  ladder position its witness names, so a rung bought on top of an
   *  unsettled one can never apply first. */
  readonly ladder: boolean;
}

/** The sum of the OTHER holders' contributions on one guild's book. */
export type UnsettledGuildBook = GuildBookContribution;

export const SETTLED_BOOK: UnsettledGuildBook = {
  items: new Map(),
  sourceUnits: new Map(),
  copper: 0,
  ladder: false,
};

export function holderContribution(log: readonly GuildBankOpDelta[]): GuildBookContribution {
  const own = new Map<string, number>();
  let copper = 0;
  let ladder = false;
  for (const d of log) {
    if (d.op === 'open_bank' || d.op === 'buy_slots') {
      ladder = true;
      if (d.op === 'buy_slots') copper += Number(d.copperDelta) || 0;
      continue;
    }
    if (d.op === 'deposit_gold' || d.op === 'withdraw_gold') {
      copper += Number(d.copperDelta) || 0;
      continue;
    }
    if (typeof d.itemId !== 'string' || d.itemId === '') continue;
    const count = Math.max(0, Math.floor(Number(d.count)) || 0);
    if (count === 0) continue;
    const key = guildBankDeltaIdentityKey(d);
    own.set(key, (own.get(key) ?? 0) + (d.op === 'deposit' ? count : -count));
  }
  const items = new Map<string, number>();
  for (const [key, net] of own) if (net > 0) items.set(key, net);
  return {
    items,
    sourceUnits: guildBankMaterialSourceContribution(log),
    copper: Math.max(0, copper),
    ladder,
  };
}

export function sumContributions(
  contributions: Iterable<GuildBookContribution>,
): UnsettledGuildBook {
  const items = new Map<string, number>();
  const sourceUnits = new Map<string, number>();
  let copper = 0;
  let ladder = false;
  for (const c of contributions) {
    for (const [key, net] of c.items) items.set(key, (items.get(key) ?? 0) + net);
    for (const [key, net] of c.sourceUnits) sourceUnits.set(key, (sourceUnits.get(key) ?? 0) + net);
    copper += c.copper;
    ladder = ladder || c.ladder;
  }
  return { items, sourceUnits, copper, ladder };
}

/** Convenience for callers holding raw logs (tests, the unit pins). */
export function unsettledGuildBook(
  logs: Iterable<readonly GuildBankOpDelta[]>,
): UnsettledGuildBook {
  const contributions: GuildBookContribution[] = [];
  for (const log of logs) contributions.push(holderContribution(log));
  return sumContributions(contributions);
}

/** What a refused op would have consumed, named so the host flushes ONLY the
 *  holders whose work feeds it. `items` names the exact identity the gate
 *  matched; `items_of` is the escrow refusal arm's coarser view (its deficit
 *  carries an item id and no payload). */
export type GuildBookDependency =
  | { readonly kind: 'items'; readonly key: string }
  | { readonly kind: 'source_units'; readonly key: string }
  | { readonly kind: 'items_of'; readonly itemId: string }
  | { readonly kind: 'copper' }
  | { readonly kind: 'ladder' };

export function contributesTo(c: GuildBookContribution, dep: GuildBookDependency): boolean {
  switch (dep.kind) {
    case 'items':
      return (c.items.get(dep.key) ?? 0) > 0;
    case 'source_units':
      return (c.sourceUnits.get(dep.key) ?? 0) > 0;
    case 'items_of': {
      const prefix = `${dep.itemId}|`;
      for (const [key, net] of c.items) if (net > 0 && key.startsWith(prefix)) return true;
      for (const [key, net] of c.sourceUnits) if (net > 0 && key.startsWith(prefix)) return true;
      return false;
    }
    case 'copper':
      return c.copper > 0;
    case 'ladder':
      return c.ladder;
  }
}

/** The escrow refusal arm's deficit, as a dependency the flush can filter on. */
export function deficitDependency(
  deficit: GuildBankDeltaDeficit | null,
): GuildBookDependency | null {
  if (!deficit) return null;
  switch (deficit.kind) {
    case 'missing_items':
      return deficit.itemId ? { kind: 'items_of', itemId: deficit.itemId } : null;
    case 'treasury_underflow':
    case 'treasury_overflow':
      return { kind: 'copper' };
    case 'ladder_behind':
      return { kind: 'ladder' };
    case 'source_unreadable':
      // A malformed source journal identifies no trustworthy dependency.
      return null;
  }
}

/** The identity the replay would match this slot's copies on. */
function slotIdentityKey(slot: InvSlot): string {
  return guildBankDeltaIdentityKey({
    itemId: slot.itemId,
    instance: slot.instance ?? null,
    craftedRecipeId: slot.craftedRecipeId ?? null,
  });
}

/** The dependency the op must be refused for, or null when it may run.
 *  `live` is the acting player's EDITABLE book snapshot (guildBankInfoFor with
 *  canEdit; the host never calls this for a read-only view); `unsettled` sums
 *  every OTHER holder's contribution for the same guild.
 *
 *  Every shape the sim refuses on its own passes through unjudged: the same
 *  count and amount rules as src/sim/bank.ts moveBetweenContainers and
 *  src/sim/guild_bank.ts (a plain stack takes a floored count within the
 *  stack, a non-material instanced stack moves whole, materials use the exact
 *  source-aware take and selection rules, an amount is a positive safe
 *  integer within the treasury, a rung has a table price the treasury
 *  covers), so the sim's refusal and wording stay authoritative and an
 *  inadmissible request never buys a refusal, an incident, or a flush. */
export function guildBankUnsettledRefusal(
  op: GuildBankGatedOp,
  request: GuildBankOpRequest,
  live: GuildBankInfo,
  unsettled: UnsettledGuildBook,
): GuildBookDependency | null {
  if (op === 'withdraw') {
    const slot = Number.isInteger(request.slot) ? live.slots[request.slot as number] : undefined;
    if (!slot) return null;
    const material = isMaterialItemId(slot.itemId);
    const materialTake = material
      ? guildBankMaterialWithdrawal(request, live.slots, unsettled.sourceUnits)
      : null;
    if (material && materialTake === null) return null;
    if (!material && request.selection !== undefined) return null;
    const want = materialTake
      ? materialTake.count
      : slot.instance
        ? slot.count
        : request.count === undefined
          ? slot.count
          : Math.floor(request.count);
    if (!(want > 0) || want > slot.count) return null;
    const key = slotIdentityKey(slot);
    const others = unsettled.items.get(key) ?? 0;
    if (others > 0) {
      let held = 0;
      for (const s of live.slots) if (slotIdentityKey(s) === key) held += s.count;
      if (want > held - others) return { kind: 'items', key };
    }
    return materialTake?.dependencyKey
      ? { kind: 'source_units', key: materialTake.dependencyKey }
      : null;
  }
  if (op === 'withdraw_gold') {
    const amount = request.amount;
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) return null;
    if (amount > live.treasury || unsettled.copper <= 0) return null;
    return amount > live.treasury - unsettled.copper ? { kind: 'copper' } : null;
  }
  // buy_slots: the ladder is strictly ordered, so ANY outstanding rung blocks
  // the next; rung 0 (open_bank) is purse-paid and moves no treasury copper,
  // rungs 1+ charge the treasury the table price and answer to the copper rule.
  const price = live.nextExpansionPrice;
  if (price === null) return null;
  if (unsettled.ladder) return { kind: 'ladder' };
  if (guildBankRungsBought(live.purchasedSlots) === 0) return null;
  if (price > live.treasury || unsettled.copper <= 0) return null;
  return price > live.treasury - unsettled.copper ? { kind: 'copper' } : null;
}
