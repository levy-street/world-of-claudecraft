// The Stylist's redesign-credit price ladder: what one character redesign costs,
// banded by the buyer's level at the moment of purchase.
//
// Data-as-code on purpose. The bands are a tuning knob the design team moves, so
// they are a declarative table plus one pure lookup rather than a switch buried in
// the purchase path: `tests/redesign_pricing.test.ts` imports this directly, with
// no Sim, no world, and no NPC.
//
// Prices are authored in COPPER (the sim's one money unit) but chosen so every
// band lands on a clean coin value a player reads without arithmetic: 25 silver,
// 75 silver, 2 gold, 5 gold. The ladder is deliberately gentle at the bottom, where
// a new player's whole purse is a few silver, and steep at the cap, where 5 gold is
// pocket change next to the 80 gold riding skill.
//
// The price is snapshotted at PURCHASE time (the Sim reads it once, charges, and
// increments the credit). A credit already bought is worth one redesign forever,
// so levelling up later never retroactively costs more, and a re-band here never
// touches a credit someone already owns.

import { MAX_LEVEL } from '../types';

/** Copper per silver / per gold, so the band table below reads in coins rather
 *  than in four- and five-digit copper literals. */
const SILVER = 100;
const GOLD = 100 * SILVER;

/** One rung of the ladder: every level from `minLevel` to `maxLevel` inclusive
 *  pays `copper`. */
export interface RedesignPriceBand {
  readonly minLevel: number;
  readonly maxLevel: number;
  readonly copper: number;
}

/**
 * The ladder, low band first. Contiguous and exhaustive over levels 1..MAX_LEVEL:
 * `tests/redesign_pricing.test.ts` pins both properties, so a future band edit
 * that leaves a gap (or overlaps two rungs) fails there instead of silently
 * charging a level the wrong price at the counter.
 */
export const REDESIGN_PRICE_BANDS: readonly RedesignPriceBand[] = [
  { minLevel: 1, maxLevel: 7, copper: 25 * SILVER },
  { minLevel: 8, maxLevel: 13, copper: 75 * SILVER },
  { minLevel: 14, maxLevel: 19, copper: 2 * GOLD },
  { minLevel: 20, maxLevel: MAX_LEVEL, copper: 5 * GOLD },
];

/**
 * What a redesign credit costs a character at `level`, in copper.
 *
 * Total over every input, including nonsense: a non-finite or fractional level is
 * floored and clamped into [1, MAX_LEVEL] rather than returning null, because the
 * one caller is an authoritative purchase and a price of "no price" there would
 * have to invent a refusal. Clamping keeps a malformed level paying a REAL band
 * (the nearest one) instead of ever paying zero.
 */
export function redesignPriceCopper(level: number): number {
  const lvl = Number.isFinite(level) ? Math.floor(level) : 1;
  const clamped = Math.max(1, Math.min(MAX_LEVEL, lvl));
  for (const band of REDESIGN_PRICE_BANDS) {
    if (clamped >= band.minLevel && clamped <= band.maxLevel) return band.copper;
  }
  // Unreachable while the table stays exhaustive (pinned by the test). The top
  // band is the safe fallback: a gap must never hand out a free redesign.
  return REDESIGN_PRICE_BANDS[REDESIGN_PRICE_BANDS.length - 1].copper;
}
