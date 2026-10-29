// Lantern Seals: Lantern Hall's guild currency, a PlayerMeta counter like Heroic
// Marks (heroic_marks.ts), never a bag stack. Every grant reaches the counter
// through the inventory hub (Sim.addItem): currency_grants.ts credits the
// reward id LANTERN_SEAL_ITEM_ID here instead of stacking it, so a contract
// payout (guild_contracts.ts payContract) is never lost to full bags, and the
// bag capacity gates treat it as costing no space. The quartermaster
// (guild_quartermaster.ts) debits the counter.
//
// Legacy saves: seals used to be the soulbound `lantern_seal` bag item, whose
// def stays (a shipped id is retired, never deleted; content/guild_contracts.ts).
// Loading a character folds every such stack left in its bags or bank into the
// counter (absorbLegacyLanternSealSlots), so nothing a player earned is lost,
// and the next save writes the counter alone.
//
// `src/sim`-pure (no DOM/Three, no wall-clock, draws no rng).

import { LANTERN_SEAL_ITEM_ID } from './content/guild_contracts';
import type { InvSlot } from './types';

/** A persisted or wire balance, clamped to a whole, non-negative safe integer. */
export function sanitizeLanternSeals(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(raw)));
}

/** A valid earned credit cannot fit the supported scalar balance. */
export class LanternSealsCapacityError extends RangeError {
  constructor() {
    super('lantern seals credit overflow');
  }
}

/** Validate before mutation so a representational limit never burns seals. */
function creditedLanternSeals(balance: number | undefined, count: number): number {
  const amount = Math.max(0, Math.floor(count));
  const current = sanitizeLanternSeals(balance);
  if (!Number.isFinite(count) || !Number.isSafeInteger(amount))
    throw new RangeError('lantern seals credit overflow');
  const next = current + amount;
  if (!Number.isSafeInteger(next)) {
    if (balance === undefined || (Number.isSafeInteger(balance) && balance >= 0)) {
      throw new LanternSealsCapacityError();
    }
    throw new RangeError('lantern seals credit overflow');
  }
  return next;
}

/** Credit `count` seals, refusing overflow before changing the holder. */
export function creditLanternSeals(holder: { lanternSeals?: number }, count: number): void {
  const next = creditedLanternSeals(holder.lanternSeals, count);
  if (next > 0) holder.lanternSeals = next;
}

/** Preflight a whole parcel before its other rewards, gates or receipts change. */
export function assertLanternSealsGrantsFit(
  holder: { lanternSeals?: number },
  items: readonly { itemId: string; count: number; instance?: unknown }[],
): void {
  let balance = holder.lanternSeals;
  for (const item of items) {
    if (item.itemId === LANTERN_SEAL_ITEM_ID && !item.instance) {
      balance = creditedLanternSeals(balance, item.count);
    }
  }
}

/** Debit `cost` seals when the balance covers it; false (and no change) otherwise. */
export function spendLanternSeals(holder: { lanternSeals?: number }, cost: number): boolean {
  const balance = sanitizeLanternSeals(holder.lanternSeals);
  if (!(cost > 0) || balance < cost) return false;
  holder.lanternSeals = balance - cost;
  return true;
}

/** Fold legacy `lantern_seal` stacks in the bags and bank into the balance.
 *  Runs once per load, after both containers hydrate; returns the seals moved. */
export function absorbLegacyLanternSealSlots(meta: {
  lanternSeals?: number;
  inventory: InvSlot[];
  bank: { inventory: InvSlot[] };
}): number {
  // Preflight the complete conversion before removing either container's stock.
  const before = sanitizeLanternSeals(meta.lanternSeals);
  let balance = before;
  for (const slots of [meta.inventory, meta.bank.inventory]) {
    for (const slot of slots) {
      if (slot.itemId === LANTERN_SEAL_ITEM_ID) balance = creditedLanternSeals(balance, slot.count);
    }
  }
  for (const slots of [meta.inventory, meta.bank.inventory]) {
    for (let i = slots.length - 1; i >= 0; i--) {
      if (slots[i].itemId === LANTERN_SEAL_ITEM_ID) slots.splice(i, 1);
    }
  }
  meta.lanternSeals = balance;
  return balance - before;
}
