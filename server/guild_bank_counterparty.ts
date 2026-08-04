// The COUNTERPARTY side of a guild bank op: what the ACTING CHARACTER'S purse
// and bags gave or received, measured from the same server-derived before/after
// snapshot pair the container (book) side is measured from.
//
// WHY THIS EXISTS. bank_ledger used to record the RECEIVING side only, so a
// guild-side replay was self-consistent BY CONSTRUCTION: every row said what
// the book gained and the book was reconciled against exactly those rows. A
// mint that ends up sitting in a player's purse moves value ACROSS that
// boundary, so it can never show up inside it. Every dupe this feature had
// moved value between a purse and a book, and not one of them was visible to
// scripts/bank_audit.mjs. The counterparty side closes that: with both halves
// recorded, an op that did not conserve is an arithmetic fact on one row
// instead of an invisible one.
//
// PURE and host-free (unit-tested directly): it takes plain snapshots, never a
// Sim, a session, or the database. The dispatch observer (server/game.ts
// runGuildBankOp) reads the snapshots either side of the sim call and hands
// them here; nothing here reads client data, and nothing here mutates the sim.

import type { InvSlot } from '../src/sim/types';

/** The acting character's carried value, as a LIVE view. Deliberately the
 *  minimum the arithmetic needs, so a test can build one by hand and the
 *  observer can build one from `PlayerMeta` without a cast. */
export interface CounterpartyActor {
  copper: number;
  inventory: readonly InvSlot[];
}

/** The same thing FROZEN at one instant, which is what the arithmetic takes.
 *
 *  This type exists to make one trap unrepresentable. `PlayerMeta.inventory`
 *  is a LIVE array that the sim mutates in place, so a before/after pair that
 *  held two references to it would be two references to the SAME array: every
 *  item movement would difference to zero and the check would silently pass
 *  everything, which is the exact failure mode the whole feature is here to
 *  stop. `counterpartySnapshot` copies the quantities out; `counterpartyMovement`
 *  only accepts the copies. */
export interface CounterpartySnapshot {
  copper: number;
  items: Map<string, number>;
}

/** What the counterparty gained across one op, signed from the ACTING
 *  CHARACTER'S point of view: negative means they gave it up. Items are keyed
 *  by item id ALONE, deliberately: the book side's key is the projected
 *  snapshot slot (id + instance + craft provenance) while the bags side is the
 *  raw live slot, and a payload that projects differently across that boundary
 *  would look like a phantom imbalance. One guild bank op moves exactly one
 *  item id (pinned in tests/bank_ledger.test.ts), so the id is enough to
 *  attribute the movement, and matching on it can only ever under-report a
 *  same-id/different-payload split, never invent an imbalance. */
export interface CounterpartyMovement {
  copper: number;
  items: Map<string, number>;
}

/** The minimum a ledger delta must expose to be stamped. Structural on
 *  purpose: server/bank_ledger.ts's BankOpDelta satisfies it, and this module
 *  stays free of that import (and of the cycle it would create). */
export interface CounterpartyStampTarget {
  itemId: string | null;
  counterpartyCopperDelta?: number | null;
  counterpartyCount?: number | null;
}

function itemCounts(inventory: readonly InvSlot[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const slot of inventory) {
    if (!slot || typeof slot.itemId !== 'string') continue;
    const n = Number(slot.count) || 0;
    m.set(slot.itemId, (m.get(slot.itemId) ?? 0) + n);
  }
  return m;
}

/** Freeze one instant of the acting character's carried value. Null in, null
 *  out: the operator purge path has no acting character at all. */
export function counterpartySnapshot(actor: CounterpartyActor | null): CounterpartySnapshot | null {
  if (!actor) return null;
  return { copper: Number(actor.copper) || 0, items: itemCounts(actor.inventory) };
}

/** Signed after-minus-before movement between two FROZEN snapshots. A missing
 *  snapshot on EITHER side means "there is no counterparty here" and yields an
 *  all-zero movement, which is the truth for the operator purge path: nobody's
 *  purse or bags took part in it (the item is destroyed, and the audit
 *  balances that against the purge's own destruction term). It is NOT a
 *  null/unknown: a recorded zero is what lets the audit check the op instead
 *  of skipping it. */
export function counterpartyMovement(
  before: CounterpartySnapshot | null,
  after: CounterpartySnapshot | null,
): CounterpartyMovement {
  if (!before || !after) return { copper: 0, items: new Map() };
  const items = new Map<string, number>();
  for (const id of new Set([...before.items.keys(), ...after.items.keys()])) {
    const delta = (after.items.get(id) ?? 0) - (before.items.get(id) ?? 0);
    if (delta !== 0) items.set(id, delta);
  }
  return { copper: after.copper - before.copper, items };
}

/** True when the acting character's purse and bags did not move at all. */
export function counterpartyIdle(movement: CounterpartyMovement): boolean {
  if (movement.copper !== 0) return false;
  for (const delta of movement.items.values()) if (delta !== 0) return false;
  return true;
}

/** Stamp one op's deltas with their share of the counterparty movement.
 *
 *  The share is DRAINED rather than copied, so the stamped numbers sum to
 *  exactly the movement that happened: the first delta takes the whole copper
 *  movement and each delta takes the remaining movement for its own item id.
 *  A guild op produces exactly one delta in practice, so the drain is the
 *  identity there; it exists so a future multi-key op can never double-count a
 *  purse into two rows (which would read as a doubled mint) or split one bag
 *  movement across two rows twice over.
 *
 *  Every delta ends up with a NUMBER, never undefined: a guild row that
 *  reaches the ledger always carries a recorded counterparty side, and NULL in
 *  the column means only "written before this existed" or "personal bank".
 *
 *  RETURNS THE UNDRAINED REMAINDER, and the caller must not drop it. Movement
 *  that no delta claimed is bags (or a purse) moving under an item id the book
 *  never touched, which balances every written row by construction and would
 *  otherwise leave NO trace at all: the same invisible purse/book crossing this
 *  whole feature exists to surface, arriving from the other side. The caller
 *  gives it the orphan treatment (counterpartyOrphan below). */
export function stampCounterpartyDeltas(
  deltas: readonly CounterpartyStampTarget[],
  movement: CounterpartyMovement,
): CounterpartyMovement {
  let copper = movement.copper;
  const items = new Map(movement.items);
  for (const delta of deltas) {
    delta.counterpartyCopperDelta = copper;
    copper = 0;
    if (delta.itemId === null) {
      delta.counterpartyCount = 0;
      continue;
    }
    delta.counterpartyCount = items.get(delta.itemId) ?? 0;
    items.delete(delta.itemId);
  }
  for (const [id, delta] of items) if (delta === 0) items.delete(id);
  return { copper, items };
}

/** The ORPHAN row's payload, or null when there is nothing orphaned.
 *
 *  An orphan is the pure form of the failure mode this whole slice exists for:
 *  the acting character's purse or bags moved while the guild book did not
 *  move at all. The book diff is then empty, so the observer would write NO
 *  row, and the audit would replay a perfectly self-consistent book forever.
 *  No legitimate op reaches it (every op either moves both sides or refuses
 *  and moves neither), so reaching it is by definition a defect, and the row
 *  is written precisely so the defect is not silent.
 *
 *  The named item is the lowest item id that moved (deterministic); the FULL
 *  movement rides the row's `instance` evidence payload, so a multi-item
 *  orphan is reported whole even though the row's own count names one. */
export function counterpartyOrphan(
  movement: CounterpartyMovement,
): { itemId: string | null; count: number | null; copperDelta: number } | null {
  if (counterpartyIdle(movement)) return null;
  const moved = [...movement.items.entries()]
    .filter(([, delta]) => delta !== 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const first = moved[0];
  return {
    itemId: first ? first[0] : null,
    count: first ? first[1] : null,
    copperDelta: movement.copper,
  };
}

/** The orphan row's evidence payload: the attempted op plus the whole
 *  movement, so an operator reading one row knows what was attempted and
 *  everything that moved under it. */
export function counterpartyOrphanEvidence(
  op: string,
  movement: CounterpartyMovement,
): { attemptedOp: string; copper: number; items: Record<string, number> } {
  const items: Record<string, number> = {};
  for (const [id, delta] of [...movement.items.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    if (delta !== 0) items[id] = delta;
  }
  return { attemptedOp: op, copper: movement.copper, items };
}
