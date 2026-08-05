// Pure, host-agnostic vendor purchase quantity math: the one leaf owning the
// row-unit model for the sim's authoritative buy path (items.ts buyItem) and
// the vendor window's UI preview (ui/hud/vendor/vendor_view.ts consumes the
// force-1 predicate and the prompt cap; it recomputes the display total from
// the same row-unit price, held in lockstep by a cross-check in
// tests/vendor_view.test.ts), so no vendor affordance can promise a quantity
// the server would not grant.
//
// Two purchase axes live here, deliberately together (one seam, phase 21):
// - The bulk ("buy stack") verb, #2374: classic vendors sell most goods one
//   unit per click (buying 20 crafting reagents took 20 clicks); a bulk
//   purchase buys as many units as the player can currently afford, capped at
//   the item's real bag stack size (src/sim/bags.ts stackSizeOf), never
//   erroring for wanting more than one: the caller (items.ts buyItem) floors
//   the result at 1 so an unaffordable request still surfaces the ordinary
//   "Not enough money" error instead of silently buying zero. Unit-based by
//   design: a bulk food buy may grant a non-multiple of the 5-unit row unit.
// - The count path (the 1x/5x/10x/custom control row): row-unit-based, a
//   count of N is N ordinary purchases resolved atomically. Counts are
//   sanitized (sanitizeBuyCount), never coerced; totals are overflow-guarded
//   BEFORE any balance compare (buyPurchaseTotals); and the Q23 force-1 rows
//   (vendorCountForced) never multiply.
//
// Latent asymmetry, named so it stays deliberate: vendorCountForced treats
// soulbound as force-1 but bulkEligible (items.ts buyItem) does not exclude
// soulbound, so a soulbound copper-priced stackable would bulk-multiply while
// the count path forces it to 1. No such item exists today (the only
// soulbound row with a buyValue is a mount, force-1 on both paths); a future
// soulbound consumable must pick ONE rule here.
//
// DOM-free and deterministic so tests/vendor_buy_stack.test.ts drives it directly.

import { countFit, stackSizeOf } from './bags';
import type { InvSlot, ItemDef } from './types';
import { vendorStackSize } from './vendor_stack';

/** The one explicit `buyItem` request shape, shared by the IWorld facet, both
 *  world implementations, and the server dispatch. An options bag rather than
 *  positional slots on purpose: Sim.buyItem also threads an optional numeric
 *  pid, and any positional count slot beside it compiles green while routing a
 *  count into pid (or a pid into count) under structural typing; the bag turns
 *  every such stale call site into a compile error instead. */
export interface VendorBuyOptions {
  /** Row units (purchases) to buy in one command; omitted or 1 is the
   *  ordinary single purchase and stays byte-identical on the wire. */
  count?: number;
  /** The bulk ("Buy Stack") verb (#2374). On a hand-crafted frame carrying
   *  both fields, bulk wins (the shipped verb's precedence, applied in
   *  items.ts buyItem so all three hosts agree); the client never sends both. */
  bulk?: boolean;
}

/**
 * How many units a bulk purchase of `def` grants: as many as `availableCopper`
 * affords at `unitCopper` per unit, capped at the item's bag stack size.
 * `unitCopper <= 0` (a free vendor, e.g. the dev-only epic gear stock) always
 * returns the full stack size, since there is no affordability limit to apply.
 * Returns 0 when even one unit is unaffordable; callers that never want a
 * zero-quantity purchase should floor the result at 1 themselves.
 */
export function bulkBuyQuantity(def: ItemDef, unitCopper: number, availableCopper: number): number {
  const max = stackSizeOf(def);
  if (unitCopper <= 0) return max;
  const affordable = Math.floor(Math.max(0, availableCopper) / unitCopper);
  return Math.max(0, Math.min(max, affordable));
}

/**
 * Sanitize a wire/facet purchase count. Absent means the ordinary single
 * purchase (1). A present count is accepted only when it is already a legal
 * integer request: a safe integer of at least 1. Everything else (0,
 * negative, NaN, Infinity, fractional, beyond safe-integer range) returns
 * null and the caller denies with a toast (Q20): hostile input on a money
 * path is refused, never coerced, because flooring or clamping a crafted
 * value would charge for a quantity no legitimate client ever sent (the
 * sender only emits integers from the control row and the capped prompt).
 */
export function sanitizeBuyCount(count: number | undefined): number | null {
  if (count === undefined) return 1;
  if (!Number.isSafeInteger(count) || count < 1) return null;
  return count;
}

/** True for the Q23 force-1 rows: honor-priced (honor is authored per
 *  purchase and never multiplied), soulbound, mount, and the riding-service
 *  entry. A count on such a row applies as exactly 1, today's single
 *  purchase; the UI keeps these rows at 1x semantics for the same reason.
 *  The honor arm mirrors items.ts buyItem's own price read (floored,
 *  non-finite treated as unpriced) so the predicate can never disagree with
 *  what the buy path actually charges. */
export function vendorCountForced(def: ItemDef): boolean {
  const honor = def.priceHonor;
  const honorPriced = honor !== undefined && Number.isFinite(honor) && Math.floor(honor) > 0;
  return (
    def.kind === 'mount' || def.teachesRiding === true || def.soulbound === true || honorPriced
  );
}

/** Atomic totals for a count-N purchase, all three products verified to stay
 *  safe integers. Returns null on overflow so the caller can deny BEFORE any
 *  balance compare runs (the same reason the market caps its ask price:
 *  comparing an overflowed total is comparing garbage). The copper/honor
 *  asymmetry is explicit here: copper is the per-unit buyValue times every
 *  unit granted, honor is a per-purchase price times the purchase count. */
export interface VendorPurchaseTotals {
  /** Total units granted: vendorStackSize(def) per purchase, times count. */
  units: number;
  /** Total copper debited: the per-unit price times `units`. */
  copper: number;
  /** Total honor debited: the per-purchase price times `count`. */
  honor: number;
}

export function buyPurchaseTotals(
  def: ItemDef,
  unitCopper: number,
  honorPerPurchase: number,
  count: number,
): VendorPurchaseTotals | null {
  const units = vendorStackSize(def) * count;
  const copper = unitCopper * units;
  const honor = honorPerPurchase * count;
  if (!Number.isSafeInteger(units) || !Number.isSafeInteger(copper) || !Number.isSafeInteger(honor))
    return null;
  return { units, copper, honor };
}

/**
 * The custom-amount prompt's cap (Q19): how many ROW UNITS (purchases) of
 * `def` currently fit in the bags, derived from the sim's own countFit so the
 * shown maximum can never promise a quantity the capacity pre-check in
 * buyItem would then refuse. Can return 0 (nothing fits); the prompt floors
 * its input at 1 and lets the server's refuse-whole answer a full-bag buy
 * honestly. Deliberately fit-only, not affordability-capped: the settlement
 * shows the fit maximum and lets an unaffordable amount refuse whole with
 * the money toast.
 */
export function maxBuyCount(inventory: readonly InvSlot[], capacity: number, def: ItemDef): number {
  const unitFit = countFit(inventory, capacity, def.id, Number.MAX_SAFE_INTEGER);
  return Math.floor(unitFit / vendorStackSize(def));
}
