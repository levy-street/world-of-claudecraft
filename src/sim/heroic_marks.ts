// Heroic Marks: the heroic-dungeon currency, a PlayerMeta counter like Delve
// Marks, never a bag stack. Every grant reaches the counter through ONE door:
// the inventory hub (Sim.addItem) credits the reward-list id
// HEROIC_MARK_CURRENCY_ID here instead of stacking it, so every reward table
// that lists marks (heroic final bosses, emissary caches, clue caskets, hoard
// vaults, durable vault claims and Ravenpost parcels) lands on the balance with
// no per-site plumbing, and the bag capacity gates (bags.ts countFit, fitsAll)
// treat it as costing no space. The Heroic Quartermaster debits the counter.
//
// Legacy saves: marks used to be the soulbound `heroic_mark` bag item, whose
// def stays (a shipped id is retired, never deleted; content/items.ts). Loading
// a character folds every such stack left in its bags or bank into the counter
// (absorbLegacyHeroicMarkSlots), so nothing a player earned is lost, and the
// next save writes the counter alone.
//
// `src/sim`-pure (no DOM/Three, no wall-clock, draws no rng).

import { HEROIC_MARK_CURRENCY_ID } from './content/dungeon_difficulty';
import type { InvSlot } from './types';

/** True for a reward-list id the hub credits as currency rather than an item. */
export function isCurrencyGrantId(itemId: string): boolean {
  return itemId === HEROIC_MARK_CURRENCY_ID;
}

/** A persisted or wire balance, clamped to a whole, non-negative safe integer. */
export function sanitizeHeroicMarks(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(raw)));
}

/** A valid earned credit cannot fit the supported scalar balance. */
export class HeroicMarksCapacityError extends RangeError {
  constructor() {
    super('heroic marks credit overflow');
  }
}

/** Compute a credit before mutation. A representational limit never burns currency. */
function creditedHeroicMarks(balance: number | undefined, count: number): number {
  const amount = Math.max(0, Math.floor(count));
  const current = sanitizeHeroicMarks(balance);
  if (!Number.isFinite(count)) throw new RangeError('heroic marks credit overflow');
  const next = current + amount;
  if (!Number.isSafeInteger(amount)) throw new RangeError('heroic marks credit overflow');
  if (!Number.isSafeInteger(next)) {
    if (balance === undefined || (Number.isSafeInteger(balance) && balance >= 0)) {
      throw new HeroicMarksCapacityError();
    }
    throw new RangeError('heroic marks credit overflow');
  }
  return next;
}

/** Credit `count` marks, refusing overflow before changing the holder. */
export function creditHeroicMarks(holder: { heroicMarks?: number }, count: number): void {
  const next = creditedHeroicMarks(holder.heroicMarks, count);
  if (next > 0) holder.heroicMarks = next;
}

/** Preflight a whole parcel before its other rewards, gates or receipts change. */
export function assertHeroicMarksGrantsFit(
  holder: { heroicMarks?: number },
  items: readonly { itemId: string; count: number; instance?: unknown }[],
): void {
  let balance = holder.heroicMarks;
  for (const item of items) {
    if (isCurrencyGrantId(item.itemId) && !item.instance) {
      balance = creditedHeroicMarks(balance, item.count);
    }
  }
}

/** Debit `cost` marks when the balance covers it; false (and no change) otherwise. */
export function spendHeroicMarks(meta: { heroicMarks: number }, cost: number): boolean {
  if (!(cost > 0) || meta.heroicMarks < cost) return false;
  meta.heroicMarks -= cost;
  return true;
}

/** Fold legacy `heroic_mark` stacks in the bags and bank into the balance.
 *  Runs once per load, after both containers hydrate; returns the marks moved. */
export function absorbLegacyHeroicMarkSlots(meta: {
  heroicMarks: number;
  inventory: InvSlot[];
  bank: { inventory: InvSlot[] };
}): number {
  // First validate the COMPLETE conversion; only then remove its old carriers.
  const before = sanitizeHeroicMarks(meta.heroicMarks);
  let balance = before;
  for (const slots of [meta.inventory, meta.bank.inventory]) {
    for (const slot of slots) {
      if (slot.itemId === HEROIC_MARK_CURRENCY_ID)
        balance = creditedHeroicMarks(balance, slot.count);
    }
  }
  for (const slots of [meta.inventory, meta.bank.inventory]) {
    for (let i = slots.length - 1; i >= 0; i--) {
      if (slots[i].itemId === HEROIC_MARK_CURRENCY_ID) slots.splice(i, 1);
    }
  }
  meta.heroicMarks = balance;
  return balance - before;
}
