// Bank ledger: an OBSERVER of the sim's bank ops, never an authority. The sim bank
// methods (bankDeposit / bankWithdraw / bankBuySlots) return void and emit no
// success event by design (the ledger stays server-only, src/sim untouched), so the dispatch
// site detects success by diffing the public read Sim.bankInfoFor(pid) BEFORE and
// AFTER each call. A successful deposit/withdraw always changes the bank slot
// multiset; a successful buy_slots always increases purchasedSlots (its price is
// exactly the BEFORE snapshot's nextExpansionCost); a refused/no-op call changes
// nothing, so an empty diff writes no row. bankInfoFor returns null away from a
// banker, so a null on either side is also a no-op.
//
// diffBankOp is PURE (unit-tested directly). recordBankOp turns each diff element
// into a fire-and-forget insert chained onto a per-process FIFO promise tail: the
// game loop NEVER awaits it, a rejected insert logs and never blocks or reorders
// anything, and the observer can never throw into the caller. A character lives on
// one realm process, so the FIFO preserves that character's op order.

import type { BankInfo, GuildBankInfo } from '../src/world_api';
import { insertBankLedgerRow } from './db';
import { REALM } from './realm';

export type BankLedgerOp = 'deposit' | 'withdraw' | 'buy_slots';

// One row's worth of diff. A deposit/withdraw op yields one element per changed
// item key; a buy_slots op yields one element with item fields null.
export interface BankOpDelta {
  itemId: string | null;
  count: number | null;
  instance: unknown;
  // The moved slot's craft provenance, carried so the guild revert path
  // (Sim.revertGuildBankDeltas, Guild Bank Phase 3 QA) can restore a reverted
  // withdraw byte-identically. Not persisted to bank_ledger (insertBankLedgerRow
  // picks its columns explicitly); absent on personal rows and copper-only rows.
  craftedRecipeId?: string | null;
  copperDelta: number;
  // The book's ladder position BEFORE the op. Not persisted (the ledger
  // columns are picked explicitly), and set only on the GUILD path: the guild
  // escrow log records slot ops ABSOLUTELY ("this op moved the ladder from
  // before to after"), which is what makes the forward replay idempotent and
  // the inverse a compare-and-swap. The personal bank's rows never feed a
  // replay, so they leave it absent.
  purchasedSlotsBefore?: number;
  purchasedSlotsAfter: number;
}

type BankSlot = BankInfo['slots'][number];

// A multiset key over an item slot: the itemId plus a stable serialization of the
// per-instance payload (null when absent). before/after slots come from the same
// bankInfoFor clone path microseconds apart, so JSON.stringify key order is stable
// across the pair and equal payloads serialize identically. Instanced items each
// keep their own key, so a signed/bound copy never merges with a plain stack.
function slotKey(slot: BankSlot): string {
  return JSON.stringify([slot.itemId, slot.instance ?? null]);
}

// Sum per-slot counts by key within one snapshot, keeping a representative slot for
// its itemId/instance. Fungible stacks never split, so a key is normally one slot;
// summing keeps the diff honest if the same key ever appears twice.
function countByKey(slots: BankSlot[]): Map<string, { slot: BankSlot; count: number }> {
  const m = new Map<string, { slot: BankSlot; count: number }>();
  for (const slot of slots) {
    const key = slotKey(slot);
    const existing = m.get(key);
    if (existing) existing.count += slot.count;
    else m.set(key, { slot, count: slot.count });
  }
  return m;
}

// Observe success by diffing the before/after bankInfo snapshots. Returns the
// ledger elements a successful op produced (deposit/withdraw: one per changed item
// key; buy_slots: one purchase row); an empty array means refused / no-op / away
// from a banker, so no row is written.
export function diffBankOp(
  op: BankLedgerOp,
  before: BankInfo | null,
  after: BankInfo | null,
): BankOpDelta[] {
  if (!before || !after) return [];

  if (op === 'buy_slots') {
    if (after.purchasedSlots <= before.purchasedSlots) return [];
    // The price is exactly the BEFORE snapshot's nextExpansionCost (non-null by
    // construction on a real purchase); guard a null defensively as 0.
    const price = before.nextExpansionCost ?? 0;
    return [
      {
        itemId: null,
        count: null,
        instance: null,
        copperDelta: -price,
        purchasedSlotsAfter: after.purchasedSlots,
      },
    ];
  }

  const beforeCounts = countByKey(before.slots);
  const afterCounts = countByKey(after.slots);
  const keys = new Set<string>([...beforeCounts.keys(), ...afterCounts.keys()]);
  const out: BankOpDelta[] = [];
  for (const key of keys) {
    const b = beforeCounts.get(key)?.count ?? 0;
    const a = afterCounts.get(key)?.count ?? 0;
    const delta = a - b;
    // A deposit takes keys the bank GAINED (after > before); a withdraw takes keys
    // it LOST (before > after). A single-slot op changes exactly one key in
    // practice (pinned by test); the array keeps the writer honest if that breaks.
    if (op === 'deposit' && delta > 0) {
      const slot = afterCounts.get(key)?.slot as BankSlot;
      out.push({
        itemId: slot.itemId,
        count: delta,
        instance: slot.instance ?? null,
        copperDelta: 0,
        purchasedSlotsAfter: after.purchasedSlots,
      });
    } else if (op === 'withdraw' && delta < 0) {
      const slot = beforeCounts.get(key)?.slot as BankSlot;
      out.push({
        itemId: slot.itemId,
        count: -delta,
        instance: slot.instance ?? null,
        copperDelta: 0,
        purchasedSlotsAfter: after.purchasedSlots,
      });
    }
  }
  return out;
}

// Per-process FIFO tail. Each insert chains onto it so a character's op rows land
// in order; a rejected insert is caught (logged) and the chain continues.
let tail: Promise<void> = Promise.resolve();

// Record a successful bank op fire-and-forget. Computes the diff and enqueues one
// insert per element onto the FIFO tail. Returns void immediately (never a promise,
// never awaited by the game loop); the whole body is guarded so it can never throw
// into the caller and gameplay never depends on the write landing.
export function recordBankOp(
  op: BankLedgerOp,
  who: { characterId: number; accountId: number },
  before: BankInfo | null,
  after: BankInfo | null,
): void {
  try {
    for (const delta of diffBankOp(op, before, after)) {
      tail = tail
        .then(() =>
          insertBankLedgerRow({
            realm: REALM,
            characterId: who.characterId,
            accountId: who.accountId,
            op,
            itemId: delta.itemId,
            count: delta.count,
            instance: delta.instance,
            copperDelta: delta.copperDelta,
            purchasedSlotsAfter: delta.purchasedSlotsAfter,
            container: 'personal',
            containerId: null,
          }),
        )
        .catch((err) => {
          console.error('bank_ledger write failed:', err);
        });
    }
  } catch (err) {
    // The observer must never fault the dispatch path.
    console.error('bank_ledger recordBankOp failed:', err);
  }
}

// The current FIFO tail, for tests to await the queue draining deterministically.
export function bankLedgerIdle(): Promise<void> {
  return tail;
}

// ---------------------------------------------------------------------------
// Guild bank rows (Guild Bank Phase 3). Same observer discipline as the
// personal bank above: the sim ops return void and emit no success event, so
// the dispatch site diffs Sim.guildBankInfoFor(pid) BEFORE and AFTER each op.
// Rows write container='guild' with container_id = guild id into the SAME
// bank_ledger table; the two gold ops record the TREASURY's copper delta
// (positive on deposit_gold, negative on withdraw_gold), buy_slots the
// negated table price the treasury paid, and item ops carry no copper, so a
// guild's treasury-moving copper deltas replay to its live treasury (the
// audit script's conservation check). Two ops moved PURSE copper and are
// excluded from that replay: create_fee (the founder's fee, the one row with
// no diff, written by the guild_create success arm) and open_bank (ladder
// rung 0, the officer's purse opening the item store).
// The dispatch site needs the diff itself (a non-empty diff marks the book
// dirty for the escrow save), so the differ is exported pure and the recorder
// takes the computed deltas; both share the personal FIFO tail, preserving a
// character's cross-container op order.
// ---------------------------------------------------------------------------

export type GuildBankLedgerOp =
  | 'deposit_gold'
  | 'withdraw_gold'
  | 'deposit'
  | 'withdraw'
  | 'buy_slots'
  | 'open_bank';

// The guild multiset key: itemId + instance payload + craft provenance. The
// third dimension exists because guild deltas feed the revert path
// (Sim.revertGuildBankDeltas), which must restore the exact copy; the
// personal slotKey deliberately keeps its two dimensions (its rows never
// feed a revert).
function guildSlotKey(slot: BankSlot): string {
  return JSON.stringify([slot.itemId, slot.instance ?? null, slot.craftedRecipeId ?? null]);
}

function countByGuildKey(slots: BankSlot[]): Map<string, { slot: BankSlot; count: number }> {
  const m = new Map<string, { slot: BankSlot; count: number }>();
  for (const slot of slots) {
    const key = guildSlotKey(slot);
    const existing = m.get(key);
    if (existing) existing.count += slot.count;
    else m.set(key, { slot, count: slot.count });
  }
  return m;
}

// Observe a guild bank op's outcome by diffing the before/after
// guildBankInfoFor snapshots. Empty means refused / no-op (nothing to record,
// nothing dirty). A successful op always has non-null snapshots on both sides
// (the op itself requires the banker, rank, and book the read gates on), so a
// null on either side is a refusal by construction. A refused (projected)
// slot's key is stable across the pair: the pipe policy refuses it in both
// directions, so it can never move, and equal payloads project identically.
export function diffGuildBankOp(
  op: GuildBankLedgerOp,
  before: GuildBankInfo | null,
  after: GuildBankInfo | null,
): BankOpDelta[] {
  if (!before || !after) return [];

  if (op === 'deposit_gold' || op === 'withdraw_gold') {
    const delta = after.treasury - before.treasury;
    if (op === 'deposit_gold' && delta <= 0) return [];
    if (op === 'withdraw_gold' && delta >= 0) return [];
    return [
      {
        itemId: null,
        count: null,
        instance: null,
        copperDelta: delta,
        purchasedSlotsBefore: before.purchasedSlots,
        purchasedSlotsAfter: after.purchasedSlots,
      },
    ];
  }

  if (op === 'buy_slots' || op === 'open_bank') {
    if (after.purchasedSlots <= before.purchasedSlots) return [];
    // The payer covered exactly the BEFORE snapshot's next table price
    // (non-null by construction on a real purchase); guard null as 0.
    // buy_slots moved TREASURY copper; open_bank (rung 0) moved the acting
    // officer's PURSE, so the audit's treasury replay excludes it like
    // create_fee.
    const price = before.nextExpansionPrice ?? 0;
    return [
      {
        itemId: null,
        count: null,
        instance: null,
        copperDelta: -price,
        purchasedSlotsBefore: before.purchasedSlots,
        purchasedSlotsAfter: after.purchasedSlots,
      },
    ];
  }

  // Item ops: the personal-bank multiset diff over the book's slots, keyed
  // with craftedRecipeId as a THIRD dimension (the personal slotKey has two):
  // the guild deltas carry craftedRecipeId so the revert path can restore a
  // reverted withdraw byte-identically, and a two-dimension key would collapse
  // a crafted and a plain copy of the same item into one key and record
  // whichever slot's provenance came first, minting or destroying
  // disenchant-gate provenance on revert (the Phase 3 QA architecture
  // finding).
  const beforeCounts = countByGuildKey(before.slots);
  const afterCounts = countByGuildKey(after.slots);
  const keys = new Set<string>([...beforeCounts.keys(), ...afterCounts.keys()]);
  const out: BankOpDelta[] = [];
  for (const key of keys) {
    const b = beforeCounts.get(key)?.count ?? 0;
    const a = afterCounts.get(key)?.count ?? 0;
    const delta = a - b;
    if (op === 'deposit' && delta > 0) {
      const slot = afterCounts.get(key)?.slot as BankSlot;
      out.push({
        itemId: slot.itemId,
        count: delta,
        instance: slot.instance ?? null,
        craftedRecipeId: slot.craftedRecipeId ?? null,
        copperDelta: 0,
        purchasedSlotsBefore: before.purchasedSlots,
        purchasedSlotsAfter: after.purchasedSlots,
      });
    } else if (op === 'withdraw' && delta < 0) {
      const slot = beforeCounts.get(key)?.slot as BankSlot;
      out.push({
        itemId: slot.itemId,
        count: -delta,
        instance: slot.instance ?? null,
        craftedRecipeId: slot.craftedRecipeId ?? null,
        copperDelta: 0,
        purchasedSlotsBefore: before.purchasedSlots,
        purchasedSlotsAfter: after.purchasedSlots,
      });
    }
  }
  return out;
}

// Record a successful guild bank op's deltas fire-and-forget onto the shared
// FIFO tail (never awaited by the game loop; a rejected insert logs and never
// blocks or reorders anything). The caller computed the deltas via
// diffGuildBankOp (it needs the success signal to mark the book dirty), so
// this only enqueues; an empty array writes nothing.
export function recordGuildBankDeltas(
  op: GuildBankLedgerOp | 'create_fee' | typeof GUILD_BANK_ESCROW_DEFICIT_OP,
  who: { characterId: number; accountId: number },
  guildId: number,
  deltas: readonly BankOpDelta[],
): void {
  try {
    for (const delta of deltas) {
      tail = tail
        .then(() =>
          insertBankLedgerRow({
            realm: REALM,
            characterId: who.characterId,
            accountId: who.accountId,
            op,
            itemId: delta.itemId,
            count: delta.count,
            instance: delta.instance,
            copperDelta: delta.copperDelta,
            purchasedSlotsAfter: delta.purchasedSlotsAfter,
            container: 'guild',
            containerId: guildId,
          }),
        )
        .catch((err) => {
          console.error('bank_ledger guild write failed:', err);
        });
    }
  } catch (err) {
    // The observer must never fault the dispatch path.
    console.error('bank_ledger recordGuildBankDeltas failed:', err);
  }
}

// The ANOMALY op: an escrow save whose own deltas could not be replayed onto
// durable truth, recorded once the deficit can never resolve (server/game.ts
// resolveGuildBankDeficit). It is NOT an op a player performed: it is the
// audit trail for the D5 consume-then-fence residue in
// docs/guild-bank/state.md, which until the escrow root fix nothing in the
// system could observe (the forward replay is the only code that knows both
// durable truth and the intended delta). scripts/bank_audit.mjs reports every
// one of these as a finding and excludes them from the item, treasury, and
// ladder replays, since they describe work that did NOT land.
export const GUILD_BANK_ESCROW_DEFICIT_OP = 'escrow_deficit';

// Write one anomaly row, fire-and-forget on the shared FIFO tail like every
// other ledger write. copper_delta carries a treasury shortfall as a NEGATIVE
// number (copper that left a purse with no durable book decrement behind it);
// item shortfalls ride item_id + count. purchased_slots_after is 0 and never
// read: the auditor skips these rows in its monotonicity scan.
export function recordGuildBankEscrowDeficit(
  who: { characterId: number; accountId: number },
  guildId: number,
  deficit: { kind: string; op: string; itemId: string | null; shortfall: number },
): void {
  const isItem = deficit.kind === 'missing_items';
  recordGuildBankDeltas(GUILD_BANK_ESCROW_DEFICIT_OP as GuildBankLedgerOp, who, guildId, [
    {
      itemId: isItem ? deficit.itemId : null,
      count: isItem ? deficit.shortfall : null,
      instance: null,
      copperDelta: isItem ? 0 : -deficit.shortfall,
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 0,
    },
  ]);
}

// Record the residue a session ABANDONS: unflushed deltas whose character half
// is already durable but whose book half never landed and never can, because
// the session is gone (fenced out, or logged out with an escrow deficit still
// outstanding). Same anomaly op and the same audit meaning as the deficit row
// above; one row per abandoned delta, and there are normally one or two.
export function recordGuildBankAbandonedDeltas(
  who: { characterId: number; accountId: number },
  guildId: number,
  deltas: readonly {
    op: string;
    itemId: string | null;
    count: number | null;
    copperDelta: number;
  }[],
): void {
  for (const d of deltas) {
    const isItem = d.op === 'deposit' || d.op === 'withdraw';
    recordGuildBankEscrowDeficit(who, guildId, {
      kind: isItem ? 'missing_items' : 'treasury_underflow',
      op: d.op,
      itemId: isItem ? d.itemId : null,
      shortfall: isItem ? Math.abs(Number(d.count) || 0) : Math.abs(d.copperDelta),
    });
  }
}

// The guild_create fee row (reserve-at-gate: the purse was charged at the
// dispatch gate; the row is written only in the create's committed success
// arm, which consumes that reservation). purchased_slots_after is 0: a
// newborn guild has no expansions. copper_delta is the negated copper the
// founder's PURSE paid (never treasury copper), so the audit script excludes
// create_fee from the treasury replay.
export function guildCreateFeeDelta(chargedCopper: number): BankOpDelta {
  return {
    itemId: null,
    count: null,
    instance: null,
    copperDelta: -chargedCopper,
    purchasedSlotsBefore: 0,
    purchasedSlotsAfter: 0,
  };
}
