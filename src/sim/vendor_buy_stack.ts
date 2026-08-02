// Pure, host-agnostic helper: how many units a bulk ("buy stack") vendor
// purchase should grant.
//
// Classic vendors sell most goods one unit per click (issue #2374: buying 20
// crafting reagents took 20 clicks). A bulk purchase buys as many units as the
// player can currently afford, capped at the item's real bag stack size
// (src/sim/bags.ts stackSizeOf), never erroring for wanting more than one: the
// caller (items.ts buyItem) floors the result at 1 so an unaffordable request
// still surfaces the ordinary "Not enough money" error instead of silently
// buying zero.
//
// Keeping this a leaf (no Sim state, no DOM) lets BOTH the sim's authoritative
// buy path (items.ts buyItem) and the vendor window's UI preview (ui/hud/vendor/
// vendor_view.ts) share one rule, so the "Buy Stack xN" affordance can never
// promise more than the server actually grants.
//
// DOM-free and deterministic so tests/vendor_buy_stack.test.ts drives it directly.

import { stackSizeOf } from './bags';
import type { ItemDef } from './types';

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
