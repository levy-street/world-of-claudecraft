// Bank Storage phase 14: the ladder-hold policy, driven directly.
//
// The predicate decides when a GOLD bank_buy_slots is refused because a
// Claudium purchase may have money in the air. Every arm here is written as a
// pair: the case that must still BLOCK beside the case that may yield, because
// a policy tested only on its yields would pass with the whole reservation
// deleted.
import { describe, expect, it } from 'vitest';
import {
  AMBIGUITY_HOLD_MAX_MS,
  type LadderHold,
  type LadderHoldReason,
  ladderHoldBlocksGold,
  ladderHoldMaxMs,
  WEDGED_HOLD_MAX_MS,
} from '../../server/storage_ladder_hold';
import { STORAGE_PRICE_MAX_STALE_MS } from '../../server/storage_store_cache';

const T0 = 1_700_000_000_000;
const hold = (reason: LadderHoldReason, sinceMs = T0): LadderHold => ({
  key: 'k',
  reason,
  sinceMs,
});

describe('ladderHoldBlocksGold', () => {
  it('an absent hold never refuses a gold buy', () => {
    expect(ladderHoldBlocksGold(undefined, T0)).toBe(false);
  });

  it('a live purchase and a recovery scan block until the stuck-promise backstop', () => {
    for (const reason of ['purchase', 'recovery-scan'] as const) {
      // The whole point: at every ordinary age it BLOCKS.
      expect(ladderHoldBlocksGold(hold(reason), T0)).toBe(true);
      expect(ladderHoldBlocksGold(hold(reason), T0 + 1)).toBe(true);
      expect(ladderHoldBlocksGold(hold(reason), T0 + WEDGED_HOLD_MAX_MS - 1)).toBe(true);
      // ... and only a genuinely stuck one lets go.
      expect(ladderHoldBlocksGold(hold(reason), T0 + WEDGED_HOLD_MAX_MS)).toBe(false);
    }
  });

  it('an ambiguous settle blocks far past the backstop, and yields at the staleness bound', () => {
    // The two bounds are genuinely different: at an age where a stuck purchase
    // has already been let go, a purchase whose money may have moved is still
    // holding the rail. This is the arm that fails if both reasons were ever
    // collapsed onto one number.
    expect(ladderHoldBlocksGold(hold('settling'), T0 + WEDGED_HOLD_MAX_MS)).toBe(true);
    expect(ladderHoldBlocksGold(hold('settling'), T0 + STORAGE_PRICE_MAX_STALE_MS - 1)).toBe(true);
    // It yields exactly when the Claudium price has aged off the button, read
    // from the price cache's own constant rather than a literal repeated here:
    // a hold module that hardcoded its own number would fail this.
    expect(ladderHoldBlocksGold(hold('settling'), T0 + STORAGE_PRICE_MAX_STALE_MS)).toBe(false);
    expect(ladderHoldBlocksGold(hold('settling'), T0 + STORAGE_PRICE_MAX_STALE_MS + 60_000)).toBe(
      false,
    );
  });

  it('the ambiguity bound IS the price staleness bound, and outlives the backstop', () => {
    expect(AMBIGUITY_HOLD_MAX_MS).toBe(STORAGE_PRICE_MAX_STALE_MS);
    expect(ladderHoldMaxMs('settling')).toBe(STORAGE_PRICE_MAX_STALE_MS);
    expect(ladderHoldMaxMs('purchase')).toBe(WEDGED_HOLD_MAX_MS);
    expect(ladderHoldMaxMs('recovery-scan')).toBe(WEDGED_HOLD_MAX_MS);
    // A scan that PROVED a pending row exists cannot use queue age as evidence
    // that no debit happened. It stays closed until the bounded coordinator
    // admits and transitions or definitively settles that exact row.
    expect(ladderHoldMaxMs('recovery-drive')).toBe(Number.POSITIVE_INFINITY);
    expect(ladderHoldBlocksGold(hold('recovery-drive'), T0 + AMBIGUITY_HOLD_MAX_MS)).toBe(true);
    expect(ladderHoldBlocksGold(hold('recovery-drive'), T0 + AMBIGUITY_HOLD_MAX_MS * 100)).toBe(
      true,
    );
    // The ordering the design rests on: the bound on a BUG must be shorter than
    // the bound on a purchase whose money may have moved.
    expect(WEDGED_HOLD_MAX_MS).toBeLessThan(AMBIGUITY_HOLD_MAX_MS);
  });

  // THE LITERAL ANCHOR, and it is the only assertion in this file that a change
  // to the shared source cannot move with it. Every bound above is expressed
  // THROUGH the production constants, which is right for proving the wiring and
  // useless for proving the magnitude: AMBIGUITY_HOLD_MAX_MS is DEFINED as
  // STORAGE_PRICE_MAX_STALE_MS, so asserting their equality is a self
  // comparison the moment both move together. Retuning the price cache for a
  // rendering or bandwidth reason would then silently retune how long the GOLD
  // rail stays shut over a purchase whose money may already have moved, in
  // either direction, with this whole suite still green. These two assertions
  // are what make that a test failure and therefore a decision.
  it('pins the real durations, so retuning the price cache cannot move a money bound silently', () => {
    expect(WEDGED_HOLD_MAX_MS).toBe(60_000);
    expect(AMBIGUITY_HOLD_MAX_MS).toBe(600_000);
    // The sane range for a hold that shuts a working gold rail over a purchase
    // that MIGHT have debited: long enough that an ordinary service blip
    // resolves inside it, short enough that an outage does not cost the rail.
    // A retune inside this band is a judgment call; outside it is a redesign.
    expect(AMBIGUITY_HOLD_MAX_MS).toBeGreaterThanOrEqual(5 * 60_000);
    expect(AMBIGUITY_HOLD_MAX_MS).toBeLessThanOrEqual(30 * 60_000);
  });

  it('fails CLOSED on a clock it cannot reason about', () => {
    // A clock that moved backwards reads as a negative age. Refusing gold is
    // the safe answer; releasing on it would be a free interleave.
    expect(ladderHoldBlocksGold(hold('settling'), T0 - 1)).toBe(true);
    expect(ladderHoldBlocksGold(hold('purchase'), T0 - STORAGE_PRICE_MAX_STALE_MS)).toBe(true);
    // An unreadable age blocks rather than yielding.
    expect(ladderHoldBlocksGold(hold('purchase'), Number.NaN)).toBe(true);
    expect(ladderHoldBlocksGold(hold('purchase', Number.NaN), T0)).toBe(true);
    expect(ladderHoldBlocksGold(hold('settling'), Number.POSITIVE_INFINITY)).toBe(true);
  });
});
