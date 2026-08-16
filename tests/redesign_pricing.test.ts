import { describe, expect, it } from 'vitest';
import { REDESIGN_PRICE_BANDS, redesignPriceCopper } from '../src/sim/content/redesign_pricing';
import { MAX_LEVEL } from '../src/sim/types';

// The Stylist's price ladder is data-as-code: a declarative band table plus one
// pure lookup, importable with no Sim, no world, and no NPC. These tests pin the
// two properties the purchase path relies on (the table is contiguous and
// exhaustive over every real level) and the authored coin values, so a future
// re-band fails HERE with a readable diff instead of silently charging a level
// the wrong price at the counter.

const SILVER = 100;
const GOLD = 100 * SILVER;

describe('redesign price bands', () => {
  it('charges the authored coin value in every band', () => {
    // The product ruling, level by level. Written out rather than derived from
    // the table so the test disagrees with a bad edit instead of following it.
    expect(redesignPriceCopper(1)).toBe(25 * SILVER);
    expect(redesignPriceCopper(7)).toBe(25 * SILVER);
    expect(redesignPriceCopper(8)).toBe(75 * SILVER);
    expect(redesignPriceCopper(13)).toBe(75 * SILVER);
    expect(redesignPriceCopper(14)).toBe(2 * GOLD);
    expect(redesignPriceCopper(19)).toBe(2 * GOLD);
    expect(redesignPriceCopper(20)).toBe(5 * GOLD);
  });

  it('covers every level from 1 to MAX_LEVEL exactly once', () => {
    // Contiguity + exhaustiveness together: no gap (which the lookup would have
    // to paper over with its fallback) and no overlap (two rungs claiming one
    // level, where the answer depends on table order).
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const matching = REDESIGN_PRICE_BANDS.filter(
        (band) => level >= band.minLevel && level <= band.maxLevel,
      );
      expect(matching, `level ${level} must match exactly one band`).toHaveLength(1);
    }
    expect(REDESIGN_PRICE_BANDS[0].minLevel).toBe(1);
    expect(REDESIGN_PRICE_BANDS[REDESIGN_PRICE_BANDS.length - 1].maxLevel).toBe(MAX_LEVEL);
    for (let i = 1; i < REDESIGN_PRICE_BANDS.length; i++) {
      expect(REDESIGN_PRICE_BANDS[i].minLevel).toBe(REDESIGN_PRICE_BANDS[i - 1].maxLevel + 1);
    }
  });

  it('never gets cheaper as the buyer levels up', () => {
    for (let level = 2; level <= MAX_LEVEL; level++) {
      expect(redesignPriceCopper(level)).toBeGreaterThanOrEqual(redesignPriceCopper(level - 1));
    }
  });

  it('is total over nonsense input, and never free', () => {
    // The one caller is an authoritative purchase, so a malformed level must
    // still name a REAL band rather than falling through to zero. Clamping, not
    // null, is what keeps "no price" from ever meaning "no charge".
    for (const level of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 99, 3.7]) {
      expect(redesignPriceCopper(level)).toBeGreaterThan(0);
    }
    expect(redesignPriceCopper(0)).toBe(redesignPriceCopper(1));
    expect(redesignPriceCopper(-5)).toBe(redesignPriceCopper(1));
    expect(redesignPriceCopper(99)).toBe(redesignPriceCopper(MAX_LEVEL));
    expect(redesignPriceCopper(Number.NaN)).toBe(redesignPriceCopper(1));
    // Fractional levels floor into their band rather than falling between rungs.
    expect(redesignPriceCopper(7.9)).toBe(redesignPriceCopper(7));
  });

  it('lands every band on a clean coin value', () => {
    // The bands are quoted to players as "25 silver" / "2 gold": a price with a
    // stray copper remainder would render as "1g 99s 99c" and read as a bug.
    for (const band of REDESIGN_PRICE_BANDS) {
      expect(band.copper % SILVER, `band ${band.minLevel}-${band.maxLevel}`).toBe(0);
    }
  });
});
