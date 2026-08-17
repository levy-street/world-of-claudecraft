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
 * How many times the price may double before it stops climbing.
 *
 * The ladder is meant to make serial redesigning expensive, not to mint numbers
 * nobody can hold: unbounded doubling runs a level-20 price past a safe integer
 * in under fifty purchases, and long before that it is just a wall with extra
 * digits. Six doublings caps the level-20 ladder at 320 gold (5, 10, 20, 40, 80,
 * 160, 320, then flat), which is already four times the 80 gold riding skill.
 * Tune here; `tests/redesign_pricing.test.ts` pins the cap's effect.
 */
export const REDESIGN_MAX_DOUBLINGS = 6;

/** The band price for `level`, before the repeat-purchase ladder is applied. */
export function redesignBandCopper(level: number): number {
  const lvl = Number.isFinite(level) ? Math.floor(level) : 1;
  const clamped = Math.max(1, Math.min(MAX_LEVEL, lvl));
  for (const band of REDESIGN_PRICE_BANDS) {
    if (clamped >= band.minLevel && clamped <= band.maxLevel) return band.copper;
  }
  // Unreachable while the table stays exhaustive (pinned by the test). The top
  // band is the safe fallback: a gap must never hand out a free redesign.
  return REDESIGN_PRICE_BANDS[REDESIGN_PRICE_BANDS.length - 1].copper;
}

/**
 * What a redesign credit costs a character at `level` who has already bought
 * `priorPurchases` of them, in copper.
 *
 * The band sets the FIRST price; every purchase after that DOUBLES it, capped at
 * `REDESIGN_MAX_DOUBLINGS`. At level 20 that is the authored ladder: 5g, 10g,
 * 20g, 40g, 80g, 160g, 320g, then flat.
 *
 * `priorPurchases` is a LIFETIME count, never the credits currently held. Keying
 * it off held credits would let a player buy one, spend it, and be back at the
 * band price forever, which is exactly the serial redesigning the ladder exists
 * to price. Spending a credit must not make the next one cheaper.
 *
 * Total over every input, including nonsense: a non-finite or fractional level is
 * floored and clamped into [1, MAX_LEVEL] rather than returning null, because the
 * one caller is an authoritative purchase and a price of "no price" there would
 * have to invent a refusal. A junk `priorPurchases` floors to zero the same way,
 * which charges the BAND price: the safe direction is undercharging a malformed
 * count, never handing out a free redesign.
 */
export function redesignPriceCopper(level: number, priorPurchases = 0): number {
  const base = redesignBandCopper(level);
  const bought =
    Number.isFinite(priorPurchases) && priorPurchases > 0 ? Math.floor(priorPurchases) : 0;
  return base * 2 ** Math.min(bought, REDESIGN_MAX_DOUBLINGS);
}
