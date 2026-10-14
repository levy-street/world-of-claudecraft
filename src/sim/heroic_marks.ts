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

/** Credit `count` marks to a live meta or a saved character state. */
export function creditHeroicMarks(holder: { heroicMarks?: number }, count: number): void {
  const amount = sanitizeHeroicMarks(count);
  if (amount > 0) holder.heroicMarks = sanitizeHeroicMarks((holder.heroicMarks ?? 0) + amount);
}

/** Debit `cost` marks when the balance covers it; false (and no change) otherwise. */
export function spendHeroicMarks(meta: { heroicMarks: number }, cost: number): boolean {
  if (!(cost > 0) || meta.heroicMarks < cost) return false;
  meta.heroicMarks -= cost;
  return true;
}

/** Remove every legacy mark stack from `slots` in place; returns the marks removed. */
function takeLegacyMarkSlots(slots: InvSlot[]): number {
  let total = 0;
  for (let i = slots.length - 1; i >= 0; i--) {
    if (slots[i].itemId !== HEROIC_MARK_CURRENCY_ID) continue;
    total += sanitizeHeroicMarks(slots[i].count);
    slots.splice(i, 1);
  }
  return total;
}

/** Fold legacy `heroic_mark` stacks in the bags and bank into the balance.
 *  Runs once per load, after both containers hydrate; returns the marks moved. */
export function absorbLegacyHeroicMarkSlots(meta: {
  heroicMarks: number;
  inventory: InvSlot[];
  bank: { inventory: InvSlot[] };
}): number {
  const moved = takeLegacyMarkSlots(meta.inventory) + takeLegacyMarkSlots(meta.bank.inventory);
  creditHeroicMarks(meta, moved);
  return moved;
}
