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

import type { BankInfo } from '../src/world_api';
import { insertBankLedgerRow } from './db';
import { REALM } from './realm';

export type BankLedgerOp = 'deposit' | 'withdraw' | 'buy_slots';

// One row's worth of diff. A deposit/withdraw op yields one element per changed
// item key; a buy_slots op yields one element with item fields null.
export interface BankOpDelta {
  itemId: string | null;
  count: number | null;
  instance: unknown;
  copperDelta: number;
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
