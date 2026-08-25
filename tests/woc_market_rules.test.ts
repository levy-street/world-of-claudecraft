import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  adoptableBondCents,
  antiSnipeExtendedEndMs,
  bondCents,
  listingEligibility,
  listingReturnCustodyRef,
  listingSoldNoticeCustodyRef,
  minIncrementCents,
  minNextBidCents,
  screenWireFailReason,
  screenWirePendingReason,
  settlementCustodyRef,
  strikeSuspensionMs,
  validListingParams,
  validSettlementTransition,
  WOC_MARKET_ABANDON_EXEMPT_FAIL_REASONS,
  WOC_MARKET_ANTI_SNIPE_CAP_SECONDS,
  WOC_MARKET_ANTI_SNIPE_EXTENSION_SECONDS,
  WOC_MARKET_ANTI_SNIPE_WINDOW_SECONDS,
  WOC_MARKET_BOND_MAX_CENTS,
  WOC_MARKET_BOND_PENDING_TTL_SECONDS,
  WOC_MARKET_BOND_POLL_PARK_SECONDS,
  WOC_MARKET_BUY_NOW_ABANDON_WINDOW_SECONDS,
  WOC_MARKET_BUY_NOW_ABANDONS_PER_HOUR,
  WOC_MARKET_BUY_NOW_LOCK_SECONDS,
  WOC_MARKET_BUY_NOW_RECLAIM_COOLDOWN_SECONDS,
  WOC_MARKET_CONFIRM_UNAVAILABLE_REASON,
  WOC_MARKET_DIRECTED_HOLD_SECONDS,
  WOC_MARKET_DURATION_HOURS,
  WOC_MARKET_LEDGER_MATCHED_REASON,
  WOC_MARKET_MAX_ACTIVE_LISTINGS,
  WOC_MARKET_MAX_PRICE_CENTS,
  WOC_MARKET_MIN_PRICE_CENTS,
  WOC_MARKET_OFFER_CONVERGE_MAX_AGE_SECONDS,
  WOC_MARKET_OFFER_CONVERGE_SECONDS,
  WOC_MARKET_QUOTE_TTL_SECONDS,
  WOC_MARKET_RESTRICTED_POLICY,
  WOC_MARKET_SETTLEMENT_WINDOW_SECONDS,
  WOC_MARKET_STRANDED_RECLAIM_SECONDS,
  WOC_MARKET_WIRE_FAIL_REASONS,
  WOC_MARKET_WIRE_PENDING_REASONS,
  WOC_MARKET_WIRE_REASON_OTHER,
  type WocEligibilityPolicy,
  type WocListingParams,
  type WocSettlementState,
} from '../server/woc_market_rules';
import type { ItemDef, ItemInstancePayload } from '../src/sim/types';
import { stripComments } from './helpers/strip_comments';

// Pure, IO-free decision core: every case here is a plain input-to-output pin,
// no clocks, no DB, no fetch (the module takes injected timestamps). The one
// exception: the tunables block reads server/woc_market.ts source for two
// comment-stripped identity pins, because the park delay's VALUE coincides
// with the pending TTL and a constant swap is behaviorally invisible.

const DAY_MS = 24 * 3600 * 1000;

describe('tunables: literal pins', () => {
  // A constant compared against itself proves nothing (the retention-sweep
  // pin rationale), so every tunable is pinned to its literal: changing one
  // must be a deliberate edit that reddens this block.
  it('pins the quote TTL to 90 s, inside the PRD 60 to 120 second band', () => {
    expect(WOC_MARKET_QUOTE_TTL_SECONDS).toBe(90);
    expect(WOC_MARKET_QUOTE_TTL_SECONDS).toBeGreaterThanOrEqual(60);
    expect(WOC_MARKET_QUOTE_TTL_SECONDS).toBeLessThanOrEqual(120);
  });

  it('pins the settlement window, bond TTL, listing cap, price rails, and reclaim grace', () => {
    expect(WOC_MARKET_SETTLEMENT_WINDOW_SECONDS).toBe(600);
    expect(WOC_MARKET_BOND_PENDING_TTL_SECONDS).toBe(300);
    expect(WOC_MARKET_MAX_ACTIVE_LISTINGS).toBe(12);
    expect(WOC_MARKET_MIN_PRICE_CENTS).toBe(25);
    expect(WOC_MARKET_MAX_PRICE_CENTS).toBe(100_000);
    expect(WOC_MARKET_STRANDED_RECLAIM_SECONDS).toBe(300);
  });

  it('the directed hold IS the settlement window, by identity, and the converge age clears every transaction bound', () => {
    // Identity, not a copied literal (the H12 ruling): a directed sale is
    // bought immediately or not at all, so the hold makes the same promise the
    // settlement window makes, and retuning one must retune the other.
    expect(WOC_MARKET_DIRECTED_HOLD_SECONDS).toBe(WOC_MARKET_SETTLEMENT_WINDOW_SECONDS);
    // Both constants are 600, so the comparison above CANNOT fail on a copied
    // literal: it is exactly as green either way. The identity itself is
    // therefore pinned at the definition site, comment-stripped so the
    // docblock claiming the identity cannot satisfy the pin for it.
    const rules = stripComments(
      readFileSync(new URL('../server/woc_market_rules.ts', import.meta.url), 'utf8'),
    );
    expect(rules).toContain(
      'WOC_MARKET_DIRECTED_HOLD_SECONDS = WOC_MARKET_SETTLEMENT_WINDOW_SECONDS',
    );
    // The converge arm may only touch an accepted-unstamped offer after every
    // bound an in-flight acceptance can ride has passed: the 65s COMMIT driver
    // backstop plus the escrow FIFO wait. 300s is comfortably past both and
    // pinned exactly so a retune is a conscious re-derivation.
    expect(WOC_MARKET_OFFER_CONVERGE_SECONDS).toBe(300);
    // The far side of the same window: rows older than a day stopped being
    // rollback evidence (the listings prune SET-NULLs listing_id long after a
    // deal completed), so the arm must leave them alone.
    expect(WOC_MARKET_OFFER_CONVERGE_MAX_AGE_SECONDS).toBe(24 * 3600);
    expect(WOC_MARKET_OFFER_CONVERGE_MAX_AGE_SECONDS).toBeGreaterThan(
      WOC_MARKET_OFFER_CONVERGE_SECONDS,
    );
  });

  it('pins the bond poll park delay and the anti-snipe trio to their literals', () => {
    expect(WOC_MARKET_BOND_POLL_PARK_SECONDS).toBe(300);
    expect(WOC_MARKET_ANTI_SNIPE_WINDOW_SECONDS).toBe(120);
    expect(WOC_MARKET_ANTI_SNIPE_EXTENSION_SECONDS).toBe(120);
    expect(WOC_MARKET_ANTI_SNIPE_CAP_SECONDS).toBe(1800);
    // The park delay VALUE coincides with the bond pending TTL (both 300), so
    // regressing the poll's park age onto the TTL constant is behaviorally
    // invisible while they coincide: pin the constant IDENTITY at the one
    // comparison site instead (comment-stripped, so prose cannot satisfy it).
    const poll = stripComments(
      readFileSync(new URL('../server/woc_market.ts', import.meta.url), 'utf8'),
    );
    // BOTH sides of the comparison: the right operand pins the constant
    // identity, the left pins the signature-first age source (regressing it
    // to placement would defeat the late-signer rule while this stayed
    // green on the right operand alone).
    expect(poll).toContain('> WOC_MARKET_BOND_POLL_PARK_SECONDS * 1000');
    expect(poll).toContain('signedAtMs = bid.bondSignatureAtMs ?? bid.placedAtMs');
  });

  it('pins the abandon-loop cooldown numbers (the QA-judged proposal)', () => {
    // The production reads import the same constants, so a suite comparing
    // them against themselves would stay green at any value.
    expect(WOC_MARKET_BUY_NOW_RECLAIM_COOLDOWN_SECONDS).toBe(1800);
    expect(WOC_MARKET_BUY_NOW_ABANDONS_PER_HOUR).toBe(3);
    expect(WOC_MARKET_BUY_NOW_ABANDON_WINDOW_SECONDS).toBe(3600);
  });

  it('keeps the price ceiling where the bond ladder stops scaling', () => {
    // A relationship, not a second copy of the literal. bondCents is 5% capped at
    // $50, so the bond is proportional right up to $1,000 and flat above it.
    // Raising the ceiling without raising the bond cap therefore makes the bond a
    // shrinking fraction of the largest sales, which is the weak-deterrent shape
    // the whole bond exists to avoid. This forces that to be a conscious edit.
    expect(bondCents(WOC_MARKET_MAX_PRICE_CENTS)).toBe(WOC_MARKET_BOND_MAX_CENTS);
    // And the ceiling leaves a usable band above the floor.
    expect(WOC_MARKET_MAX_PRICE_CENTS).toBeGreaterThan(WOC_MARKET_MIN_PRICE_CENTS * 100);
  });

  it('caps the seller-selectable duration at 48 hours', () => {
    // The MAX is the decision, so it is asserted as a bound and not only as a
    // list: a future addition above 48 has to red this line rather than slip in
    // as one more allowlist entry.
    expect([...WOC_MARKET_DURATION_HOURS]).toEqual([12, 24, 48]);
    expect(Math.max(...WOC_MARKET_DURATION_HOURS)).toBe(48);
    // Ascending, because the client picks its default by index (durationsHours[1]);
    // an unsorted list would silently change which option is preselected.
    expect([...WOC_MARKET_DURATION_HOURS]).toEqual(
      [...WOC_MARKET_DURATION_HOURS].sort((a, b) => a - b),
    );
  });

  it('keeps the buy-now lock STRICTLY longer than one quote lifetime', () => {
    // An honest buyer whose first quote expires must still have lock window
    // left to request a fresh one; an equal or shorter lock silently strands
    // every first-quote-expired buy-now.
    expect(WOC_MARKET_BUY_NOW_LOCK_SECONDS).toBeGreaterThan(WOC_MARKET_QUOTE_TTL_SECONDS);
  });
});

describe('minIncrementCents: the increment ladder band edges', () => {
  // Band edges belong to the HIGHER band (the doc comment's contract), so both
  // sides of every boundary are pinned.
  it.each([
    [999, 25],
    [1000, 100],
    [4999, 100],
    [5000, 500],
    [19999, 500],
    [20000, 1000],
  ])('current %i cents steps by %i cents', (current, step) => {
    expect(minIncrementCents(current)).toBe(step);
  });
});

describe('minNextBidCents', () => {
  it('is the start price when no bid is standing', () => {
    expect(minNextBidCents(null, 2500)).toBe(2500);
  });

  it('is the standing bid plus its own ladder increment', () => {
    expect(minNextBidCents(999, 25)).toBe(999 + 25);
    expect(minNextBidCents(5000, 25)).toBe(5000 + 500);
    expect(minNextBidCents(20000, 25)).toBe(20000 + 1000);
  });
});

describe('antiSnipeExtendedEndMs', () => {
  it('does not extend for a bid outside the final window', () => {
    // 120_001 ms before the end: one ms outside the 120 s window.
    expect(antiSnipeExtendedEndMs(879_999, 1_000_000, 1_000_000)).toBeNull();
  });

  it('extends an in-window bid to bidAtMs + 120 s', () => {
    expect(antiSnipeExtendedEndMs(940_000, 1_000_000, 1_000_000)).toBe(940_000 + 120_000);
  });

  it('caps the extension at exactly baseEndsAtMs + 1800 s', () => {
    // The auction has already been extended to 2_750_000; a late bid would
    // reach 2_820_000 but the cap from the ORIGINAL end (1_000_000) clamps it.
    expect(antiSnipeExtendedEndMs(2_700_000, 2_750_000, 1_000_000)).toBe(1_000_000 + 1_800_000);
  });

  it('does not extend a bid landing at or after the end', () => {
    expect(antiSnipeExtendedEndMs(1_000_000, 1_000_000, 1_000_000)).toBeNull();
    expect(antiSnipeExtendedEndMs(1_000_001, 1_000_000, 1_000_000)).toBeNull();
  });

  it('does not move the end backward when the cap is already spent', () => {
    // endsAtMs already sits at the cap; the would-be extension clamps to the
    // same instant, which is not forward, so the bid does not extend.
    expect(antiSnipeExtendedEndMs(2_750_000, 2_800_000, 1_000_000)).toBeNull();
  });

  it('does not re-issue an end the auction already has (bid + 120 s == end)', () => {
    // The window admits a bid exactly 120 s out, but its extension lands
    // exactly ON the current end: equal is not forward, so null.
    expect(antiSnipeExtendedEndMs(880_000, 1_000_000, 5_000_000)).toBeNull();
  });
});

describe('bondCents: 5% clamped to $1 .. $50, never above the bid', () => {
  it('takes 5% mid-range', () => {
    expect(bondCents(10_000)).toBe(500);
  });

  it('clamps up to the $1 minimum', () => {
    expect(bondCents(1000)).toBe(100);
  });

  it('clamps down to the $50 maximum', () => {
    expect(bondCents(2_000_000)).toBe(5000);
  });

  it('never exceeds the bid itself', () => {
    expect(bondCents(50)).toBe(50);
  });

  it('rounds a fractional cent UP, matching the service ceil rule exactly', () => {
    // The service owns the bond figure (clampedBondCentsForBid: pure bps
    // ceil, then the clamp, then min with the bid). This mirror exists for
    // display only, and it must agree at half-cent boundaries or the figure
    // the player was shown differs from the one they are quoted: 2001 cents
    // at 500 bps is 100.05, which ceils to 101 where round gave 100.
    expect(bondCents(2001)).toBe(101);
    expect(bondCents(2019)).toBe(101);
  });
});

describe('strikeSuspensionMs: the progressive suspension ladder', () => {
  it.each([
    [1, 0],
    [2, 3 * DAY_MS],
    [3, 14 * DAY_MS],
    [4, 90 * DAY_MS],
    [5, 365 * DAY_MS],
    [9, 365 * DAY_MS],
  ])('strike %i suspends for %i ms', (strikes, ms) => {
    expect(strikeSuspensionMs(strikes)).toBe(ms);
  });
});

describe('validListingParams', () => {
  const params = (over: Partial<WocListingParams> = {}): WocListingParams => ({
    format: 'auction',
    directedBuyerAccount: null,
    startCents: 1000,
    reserveCents: null,
    buyNowCents: null,
    durationHours: 24,
    offerNext: false,
    ...over,
  });

  it('refuses an unknown format', () => {
    expect(validListingParams(params({ format: 'dutch' as WocListingParams['format'] }))).toEqual({
      ok: false,
      reason: 'bad_format',
    });
  });

  it('refuses a start below the price floor', () => {
    expect(validListingParams(params({ startCents: WOC_MARKET_MIN_PRICE_CENTS - 1 }))).toEqual({
      ok: false,
      reason: 'bad_start',
    });
  });

  it('refuses a start above the price ceiling', () => {
    expect(validListingParams(params({ startCents: WOC_MARKET_MAX_PRICE_CENTS + 1 }))).toEqual({
      ok: false,
      reason: 'bad_start',
    });
  });

  it('refuses a non-integer start (values are integer cents)', () => {
    expect(validListingParams(params({ startCents: 100.5 }))).toEqual({
      ok: false,
      reason: 'bad_start',
    });
  });

  it('refuses a duration off the fixed allowlist', () => {
    expect(validListingParams(params({ durationHours: 10 }))).toEqual({
      ok: false,
      reason: 'bad_duration',
    });
  });

  it.each([72, 168])(
    'refuses %i hours: the two options the 48-hour cap retired',
    (durationHours) => {
      // These were valid before the cap, so they are the one behaviour change here
      // and worth naming rather than leaving to the allowlist equality above.
      expect(validListingParams(params({ durationHours }))).toEqual({
        ok: false,
        reason: 'bad_duration',
      });
    },
  );

  it.each([...WOC_MARKET_DURATION_HOURS])('still accepts %i hours', (durationHours) => {
    expect(validListingParams(params({ durationHours }))).toEqual({ ok: true });
  });

  it('refuses a buy-now format with no buy-now price', () => {
    expect(validListingParams(params({ format: 'buy_now', buyNowCents: null }))).toEqual({
      ok: false,
      reason: 'bad_buy_now',
    });
  });

  it('accepts a combined auction that carries a reserve AND a buy-now', () => {
    // The combined format is creatable again. An auction that also names a
    // price ending it early is the one listing shape the other two cannot
    // express, and unlike a pure buy-now it keeps its reserve.
    expect(
      validListingParams(
        params({
          format: 'auction_buy_now',
          startCents: 1000,
          reserveCents: 2000,
          buyNowCents: 3000,
        }),
      ),
    ).toEqual({ ok: true });
    // And without a reserve, which is the common case.
    expect(
      validListingParams(
        params({ format: 'auction_buy_now', startCents: 1000, buyNowCents: 2000 }),
      ),
    ).toEqual({ ok: true });
  });

  it('refuses a combined listing with no buy-now price', () => {
    // The format NAMES a buy-now, so omitting the price is the same defect as
    // a 'buy_now' with none: the format and the field must agree.
    expect(validListingParams(params({ format: 'auction_buy_now', buyNowCents: null }))).toEqual({
      ok: false,
      reason: 'bad_buy_now',
    });
  });

  it('refuses a combined buy-now at or below the RESERVE, not merely the start', () => {
    // The floor is max(start, reserve). A buy-now under the reserve would let a
    // buyer take the item for less than the seller swore they would accept,
    // which is the whole point of setting one. Only the combined format can hit
    // this: a pure buy-now has no reserve to sit under.
    expect(
      validListingParams(
        params({
          format: 'auction_buy_now',
          startCents: 1000,
          reserveCents: 2000,
          buyNowCents: 2000,
        }),
      ),
    ).toEqual({ ok: false, reason: 'bad_buy_now' });
    expect(
      validListingParams(
        params({
          format: 'auction_buy_now',
          startCents: 1000,
          reserveCents: 2000,
          buyNowCents: 1999,
        }),
      ),
    ).toEqual({ ok: false, reason: 'bad_buy_now' });
    // A cent above the reserve is the boundary, and it is accepted. Note this
    // price already clears the START, so a floor that forgot the reserve would
    // pass all three of these.
    expect(
      validListingParams(
        params({
          format: 'auction_buy_now',
          startCents: 1000,
          reserveCents: 2000,
          buyNowCents: 2001,
        }),
      ),
    ).toEqual({ ok: true });
  });

  it('still refuses a reserve BELOW the start on a combined listing', () => {
    expect(
      validListingParams(
        params({
          format: 'auction_buy_now',
          startCents: 1000,
          reserveCents: 500,
          buyNowCents: 3000,
        }),
      ),
    ).toEqual({ ok: false, reason: 'bad_reserve' });
  });

  it('refuses a buy-now price on a plain auction', () => {
    expect(validListingParams(params({ format: 'auction', buyNowCents: 2000 }))).toEqual({
      ok: false,
      reason: 'bad_buy_now',
    });
  });

  it('accepts a pure buy-now priced AT the start, and refuses one below it', () => {
    // A pure buy-now takes no bids, so its start is only the browse sort key
    // and start === price is a coherent single price (no opening bid can match
    // it). This is what lets a mount list at exactly the 25c minimum: the
    // client synthesizes start = price, and price - 1 = 24 used to fall under
    // the floor and refuse with an unactionable bad_start.
    expect(
      validListingParams(params({ format: 'buy_now', startCents: 1000, buyNowCents: 1000 })),
    ).toEqual({ ok: true });
    expect(
      validListingParams(
        params({
          format: 'buy_now',
          startCents: WOC_MARKET_MIN_PRICE_CENTS,
          buyNowCents: WOC_MARKET_MIN_PRICE_CENTS,
        }),
      ),
    ).toEqual({ ok: true });
    // Below the start is still incoherent (the sort key would sit above the
    // price), so it is refused.
    expect(
      validListingParams(params({ format: 'buy_now', startCents: 1000, buyNowCents: 999 })),
    ).toEqual({ ok: false, reason: 'bad_buy_now' });
  });

  it('keeps the STRICT floor on a combined auction (a bid could match an equal buy-now)', () => {
    // auction_buy_now has real bidding, so a buy-now equal to the start would
    // be matched by the opening bid, leaving two prices for one sale. Equal is
    // refused here even though the pure format above accepts it.
    expect(
      validListingParams(
        params({ format: 'auction_buy_now', startCents: 1000, buyNowCents: 1000 }),
      ),
    ).toEqual({ ok: false, reason: 'bad_buy_now' });
    expect(
      validListingParams(
        params({ format: 'auction_buy_now', startCents: 1000, buyNowCents: 1001 }),
      ),
    ).toEqual({ ok: true });
  });

  it('refuses a reserve below the starting bid', () => {
    expect(validListingParams(params({ startCents: 1000, reserveCents: 500 }))).toEqual({
      ok: false,
      reason: 'bad_reserve',
    });
  });

  it('refuses a reserve on a pure buy-now listing', () => {
    expect(
      validListingParams(params({ format: 'buy_now', reserveCents: 1000, buyNowCents: 1000 })),
    ).toEqual({ ok: false, reason: 'bad_reserve' });
  });

  it('accepts a plain auction, with and without a reserve at or above the start', () => {
    expect(validListingParams(params())).toEqual({ ok: true });
    expect(validListingParams(params({ reserveCents: 1000 }))).toEqual({ ok: true });
    expect(validListingParams(params({ reserveCents: 2500 }))).toEqual({ ok: true });
  });

  it('accepts a pure buy-now listing priced above the start', () => {
    expect(
      validListingParams(
        params({ format: 'buy_now', startCents: 1000, buyNowCents: 2500, durationHours: 12 }),
      ),
    ).toEqual({ ok: true });
  });

  it('all three formats are creatable, and nothing else is', () => {
    // The whole creatable set, pinned. A fourth format appearing (or one of
    // these disappearing) should fail here rather than in a UI review.
    for (const format of ['auction', 'buy_now', 'auction_buy_now'] as const) {
      const p =
        format === 'auction'
          ? params({ format, startCents: 1000 })
          : params({ format, startCents: 1000, buyNowCents: 2000 });
      expect(validListingParams(p), format).toEqual({ ok: true });
    }
    for (const format of ['dutch', '', 'AUCTION', 'buy-now']) {
      expect(validListingParams(params({ format: format as never })), format).toEqual({
        ok: false,
        reason: 'bad_format',
      });
    }
  });
});

describe('listingEligibility', () => {
  // Minimal synthetic defs: each case flips exactly one property off an
  // otherwise-eligible epic chest piece, so the refusal reason is decisive.
  const equipDef = (over: Record<string, unknown> = {}): ItemDef =>
    ({
      id: 'syn_plate',
      name: 'Synthetic Plate',
      kind: 'armor',
      armorType: 'plate',
      slot: 'chest',
      quality: 'epic',
      sellValue: 10,
      ...over,
    }) as unknown as ItemDef;

  const policy = WOC_MARKET_RESTRICTED_POLICY;

  it('accepts eligible epic equipment', () => {
    expect(listingEligibility(equipDef(), undefined, policy)).toEqual({ ok: true });
  });

  it('refuses an unknown item', () => {
    expect(listingEligibility(undefined, undefined, policy)).toEqual({
      ok: false,
      reason: 'unknown_item',
    });
  });

  it('refuses a soulbound def', () => {
    expect(listingEligibility(equipDef({ soulbound: true }), undefined, policy)).toEqual({
      ok: false,
      reason: 'soulbound',
    });
  });

  it('refuses a quest item', () => {
    expect(listingEligibility(equipDef({ kind: 'quest' }), undefined, policy)).toEqual({
      ok: false,
      reason: 'quest_item',
    });
  });

  it('refuses a def barred from market listing', () => {
    expect(listingEligibility(equipDef({ noMarketList: true }), undefined, policy)).toEqual({
      ok: false,
      reason: 'no_market_list',
    });
  });

  it('refuses a character-bound copy via instance.boundTo', () => {
    const instance: ItemInstancePayload = { boundTo: 7 };
    expect(listingEligibility(equipDef(), instance, policy)).toEqual({
      ok: false,
      reason: 'bound_copy',
    });
  });

  it('refuses a still-armed commissioned copy via instance.bindOnTrade', () => {
    // The refusal is decided here, before any custody action: an armed copy
    // binds to its next owner, and an escrow has no owner for the stamp.
    const instance: ItemInstancePayload = { bindOnTrade: true };
    expect(listingEligibility(equipDef(), instance, policy)).toEqual({
      ok: false,
      reason: 'bind_armed',
    });
  });

  it('refuses an item on the policy exclusion list', () => {
    const excluding: WocEligibilityPolicy = {
      ...WOC_MARKET_RESTRICTED_POLICY,
      excludedItemIds: new Set(['syn_plate']),
    };
    expect(listingEligibility(equipDef(), undefined, excluding)).toEqual({
      ok: false,
      reason: 'excluded_item',
    });
  });

  it('refuses a def with no equip slot as not an eligible category', () => {
    expect(
      listingEligibility(
        equipDef({ kind: 'tool', slot: undefined, armorType: undefined }),
        undefined,
        policy,
      ),
    ).toEqual({ ok: false, reason: 'not_eligible_category' });
  });

  it('refuses rare equipment under an epic floor', () => {
    expect(listingEligibility(equipDef({ quality: 'rare' }), undefined, policy)).toEqual({
      ok: false,
      reason: 'below_quality_floor',
    });
  });

  it('lets a rolled epic quality beat a rare def quality', () => {
    const instance: ItemInstancePayload = { rolled: { quality: 'epic' } };
    expect(listingEligibility(equipDef({ quality: 'rare' }), instance, policy)).toEqual({
      ok: true,
    });
  });

  it('lets a rolled rare quality drop an epic def below the floor', () => {
    const instance: ItemInstancePayload = { rolled: { quality: 'rare' } };
    expect(listingEligibility(equipDef(), instance, policy)).toEqual({
      ok: false,
      reason: 'below_quality_floor',
    });
  });

  // --- the two collectible categories ---------------------------------------
  // Mounts and chroma plates trade at EVERY rarity, and each carries the very
  // flag that keeps it out of the gold economy: a mount is soulbound (holding
  // the reins IS owning the mount) and a plate is noMarketList. Both tolerances
  // are scoped to this policy; the item defs are untouched.

  const mountDef = (over: Record<string, unknown> = {}): ItemDef =>
    ({
      id: 'reins_syn',
      name: 'Reins of the Synthetic Steed',
      kind: 'mount',
      mount: 'valorsteed',
      quality: 'common',
      soulbound: true,
      sellValue: 10,
      ...over,
    }) as unknown as ItemDef;

  const chromaDef = (over: Record<string, unknown> = {}): ItemDef =>
    ({
      id: 'syn_chroma_armor_plate',
      name: 'Synthetic Chroma Plate',
      kind: 'consumable',
      quality: 'uncommon',
      noMarketList: true,
      use: { type: 'mechChroma', chromaId: 'syn_chroma' },
      sellValue: 10,
      ...over,
    }) as unknown as ItemDef;

  it.each(['common', 'uncommon', 'rare', 'epic', 'legendary'])(
    'accepts a soulbound mount at %s, with no floor applied',
    (quality) => {
      expect(listingEligibility(mountDef({ quality }), undefined, policy)).toEqual({ ok: true });
    },
  );

  it.each(['common', 'uncommon', 'rare', 'epic'])(
    'accepts a noMarketList chroma plate at %s, with no floor applied',
    (quality) => {
      expect(listingEligibility(chromaDef({ quality }), undefined, policy)).toEqual({ ok: true });
    },
  );

  it('still refuses BOTH categories when the realm turns them off', () => {
    const off: WocEligibilityPolicy = {
      ...WOC_MARKET_RESTRICTED_POLICY,
      allowMounts: false,
      allowMechChromas: false,
    };
    expect(listingEligibility(mountDef(), undefined, off)).toEqual({
      ok: false,
      reason: 'not_eligible_category',
    });
    expect(listingEligibility(chromaDef(), undefined, off)).toEqual({
      ok: false,
      reason: 'not_eligible_category',
    });
  });

  it('keeps the absolute locks absolute for both categories', () => {
    // The tolerances are scoped to ONE flag each, not a blanket pass. A bound
    // copy and the exclusion list still refuse, and a mount does not inherit the
    // chroma's noMarketList tolerance or the other way round.
    const bound: ItemInstancePayload = { boundTo: 7 };
    expect(listingEligibility(mountDef(), bound, policy)).toEqual({
      ok: false,
      reason: 'bound_copy',
    });
    expect(listingEligibility(chromaDef(), bound, policy)).toEqual({
      ok: false,
      reason: 'bound_copy',
    });
    expect(listingEligibility(mountDef({ noMarketList: true }), undefined, policy)).toEqual({
      ok: false,
      reason: 'no_market_list',
    });
    expect(listingEligibility(chromaDef({ soulbound: true }), undefined, policy)).toEqual({
      ok: false,
      reason: 'soulbound',
    });
    const excluded: WocEligibilityPolicy = {
      ...WOC_MARKET_RESTRICTED_POLICY,
      excludedItemIds: new Set(['reins_syn']),
    };
    expect(listingEligibility(mountDef(), undefined, excluded)).toEqual({
      ok: false,
      reason: 'excluded_item',
    });
  });

  it('turns both categories ON in the shipped policy', () => {
    // The point of the change, pinned against the real exported policy rather
    // than a fixture: flipping either default off silently delists a collection.
    expect(WOC_MARKET_RESTRICTED_POLICY.allowMounts).toBe(true);
    expect(WOC_MARKET_RESTRICTED_POLICY.allowMechChromas).toBe(true);
  });
});

describe('validSettlementTransition', () => {
  const allowed: Array<[WocSettlementState, WocSettlementState]> = [
    ['offered', 'confirming'],
    ['offered', 'expired'],
    ['confirming', 'confirmed'],
    ['confirming', 'failed'],
    ['confirming', 'offered'],
    // The H15 park, and its two operator arms.
    ['confirming', 'review'],
    ['review', 'confirmed'],
    ['review', 'failed'],
    ['confirmed', 'delivering'],
    ['delivering', 'delivered'],
    ['failed', 'offered'],
    ['failed', 'expired'],
  ];

  it.each(allowed)('allows %s to %s', (from, to) => {
    expect(validSettlementTransition(from, to)).toBe(true);
  });

  const forbidden: Array<[WocSettlementState, WocSettlementState]> = [
    // delivered is terminal: it may go nowhere.
    ['delivered', 'offered'],
    ['delivered', 'confirming'],
    ['delivered', 'confirmed'],
    ['delivered', 'delivering'],
    ['delivered', 'expired'],
    ['delivered', 'failed'],
    // confirmation cannot be skipped, and expiry is terminal.
    ['offered', 'confirmed'],
    ['expired', 'offered'],
    // Review is reachable ONLY from an aged confirming row, and it resolves
    // only through the two operator arms (never straight to delivery, never
    // expired around the default pass).
    ['offered', 'review'],
    ['failed', 'review'],
    ['review', 'delivering'],
    ['review', 'expired'],
    ['review', 'offered'],
  ];

  it.each(forbidden)('forbids %s to %s', (from, to) => {
    expect(validSettlementTransition(from, to)).toBe(false);
  });
});

describe('custody references: the PostOffice book-once dedupe keys', () => {
  // Pinned as literals: these strings are persisted dedupe keys, so any drift
  // would double-book or orphan a custody parcel.
  it('pins the exact literal shapes for id 7', () => {
    expect(settlementCustodyRef(7)).toBe('woc_settlement:7');
    expect(listingReturnCustodyRef(7)).toBe('woc_listing_return:7');
    expect(listingSoldNoticeCustodyRef(7)).toBe('woc_listing_sold:7');
  });
});

describe('a directed sale (the p2p trade agreed in the trade window)', () => {
  const directed = (over: Partial<WocListingParams> = {}): WocListingParams => ({
    format: 'buy_now',
    startCents: 2000,
    reserveCents: null,
    buyNowCents: 2000,
    durationHours: 12,
    offerNext: false,
    directedBuyerAccount: 77,
    ...over,
  });

  it('accepts a fixed price addressed to one account', () => {
    expect(validListingParams(directed())).toEqual({ ok: true });
  });

  it('refuses an AUCTION form, which a single permitted buyer cannot bid in', () => {
    // Not a policy preference: an auction's mechanism is competing bidders, and
    // a directed sale permits exactly one, so the form would be a bidding war
    // held with oneself.
    expect(validListingParams(directed({ format: 'auction', buyNowCents: null }))).toEqual({
      ok: false,
      reason: 'bad_directed_buyer',
    });
    // The combined format has an auction underneath it, so it is refused for the
    // same reason, and by THIS rule rather than by the format allowlist: it is
    // creatable in a public listing. A rule that only named 'auction' would let
    // it through.
    expect(validListingParams(directed({ format: 'auction_buy_now' }))).toEqual({
      ok: false,
      reason: 'bad_directed_buyer',
    });
  });

  it('refuses an account id that is not a real positive integer', () => {
    // This value alone decides who may buy, so a malformed one must never reach
    // the row: 0 and negatives address nobody, and a float addresses no row at all.
    for (const bad of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      const res = validListingParams(directed({ directedBuyerAccount: bad }));
      expect(res, `${bad}`).toEqual({ ok: false, reason: 'bad_directed_buyer' });
    }
  });

  it('still applies every ordinary price rule', () => {
    // A directed sale is the same listing with a counterparty, not a bypass: the
    // floor, the ceiling and the duration allowlist all continue to hold.
    expect(validListingParams(directed({ buyNowCents: 1 }))).toEqual({
      ok: false,
      reason: 'bad_buy_now',
    });
    expect(validListingParams(directed({ durationHours: 72 }))).toEqual({
      ok: false,
      reason: 'bad_duration',
    });
  });

  it('requires the two price fields to AGREE, where a public listing requires them to differ', () => {
    // One agreed price means start and buy-now are the same number. A second,
    // higher buy-now would be a price the two players never agreed on.
    expect(validListingParams(directed({ buyNowCents: 3000 }))).toEqual({
      ok: false,
      reason: 'bad_buy_now',
    });
    // And a public AUCTION buy-now is genuinely the opposite, which is what
    // proves the two arms are separate rather than one accidentally covering
    // both: the same equal prices with no designated buyer, as an auction with
    // real bidding, are refused for NOT differing (a public pure buy-now takes
    // no bids and accepts equal prices, tested above; the strict-differ rule is
    // the auction's).
    expect(
      validListingParams(directed({ directedBuyerAccount: null, format: 'auction_buy_now' })),
    ).toEqual({
      ok: false,
      reason: 'bad_buy_now',
    });
    expect(
      validListingParams(
        directed({ directedBuyerAccount: null, format: 'auction_buy_now', buyNowCents: 3000 }),
      ),
    ).toEqual({ ok: true });
  });
});

describe('the wire reason screens', () => {
  it('names the load-bearing verdicts as literal members', () => {
    // The ledger-matched word gates the anti-snipe extension; the split
    // sibling and the outage word are what the client distinguishes. Literal
    // pins, not constant round-trips: a drifted string must fail HERE.
    expect(WOC_MARKET_LEDGER_MATCHED_REASON).toBe('awaiting_finality');
    expect(WOC_MARKET_CONFIRM_UNAVAILABLE_REASON).toBe('service_unavailable');
    // The abandon exempt LIST is pinned by composition, not just its member
    // constant: adding a second member silently widens the abandon AND strike
    // exemptions, and the ruling on the list obliges a new positive arm WITH
    // any addition. This pin is that obligation's enforcement signal.
    expect(WOC_MARKET_ABANDON_EXEMPT_FAIL_REASONS).toEqual(['service_unavailable']);
    expect([...WOC_MARKET_WIRE_PENDING_REASONS].sort()).toEqual([
      'awaiting_finality',
      'not_yet_visible',
      'service_unavailable',
    ]);
    // The verifier's terminal vocabulary the client localizes; the five words
    // the chain-verifier round minted are the ones a drift would silently
    // orphan, so they are pinned by name on top of the full-list sweep below.
    for (const owed of [
      'burn_missing',
      'burn_mismatch',
      'burn_authority_mismatch',
      'unexpected_credit',
      'signature_already_settled',
    ]) {
      expect(WOC_MARKET_WIRE_FAIL_REASONS).toContain(owed);
    }
    // The WHOLE terminal vocabulary as a sorted literal, like the pending
    // list above: the per-member screen sweep below iterates the constant
    // itself, so without this pin a deleted word shrinks both sides together
    // and its verdicts silently reach players as 'other'.
    expect([...WOC_MARKET_WIRE_FAIL_REASONS].sort()).toEqual([
      'bad_signature',
      'burn_authority_mismatch',
      'burn_mismatch',
      'burn_missing',
      'confirming_overdue',
      'expired',
      'forfeited',
      'invalid_signature',
      'leg_mismatch',
      'memo_mismatch',
      'payer_debit_mismatch',
      'payer_mismatch',
      'quote_expired',
      'refunded',
      'refused',
      'rejected',
      'signature_already_settled',
      'signature_conflict',
      'signature_did_not_match_quote',
      'superseded',
      'transaction_failed',
      'unexpected_credit',
      'unknown_reference',
      'window_elapsed',
    ]);
  });

  it('passes every pinned member through verbatim, both screens', () => {
    for (const member of WOC_MARKET_WIRE_PENDING_REASONS) {
      expect(screenWirePendingReason(member)).toBe(member);
    }
    for (const member of WOC_MARKET_WIRE_FAIL_REASONS) {
      expect(screenWireFailReason(member)).toBe(member);
    }
  });

  it('collapses anything else to the stable other token and keeps null', () => {
    expect(WOC_MARKET_WIRE_REASON_OTHER).toBe('other');
    expect(screenWirePendingReason('dev_chain_unknown_memo')).toBe('other');
    expect(screenWirePendingReason('burn_missing')).toBe('other'); // wrong arm
    expect(screenWirePendingReason(null)).toBeNull();
    expect(screenWireFailReason('some_future_service_word')).toBe('other');
    expect(screenWireFailReason('awaiting_finality')).toBe('other'); // wrong arm
    expect(screenWireFailReason(null)).toBeNull();
  });
});

describe('adoptableBondCents: the wire figure is bounded before adoption', () => {
  it('accepts a positive integer at or under the bid', () => {
    expect(adoptableBondCents(101, 2001)).toBe(101);
    expect(adoptableBondCents(2001, 2001)).toBe(2001); // the == bid boundary
    expect(adoptableBondCents(1, 2001)).toBe(1);
  });

  it('refuses each bad dimension on its own', () => {
    // Per-dimension negatives: each case trips exactly one arm of the guard.
    // The bid itself is route-bounded at WOC_MARKET_MAX_PRICE_CENTS, so the
    // at-or-under-the-bid arm transitively keeps the persisted figure far
    // inside the INT column too.
    expect(adoptableBondCents(100.5, 2001), 'non-integer').toBeNull();
    expect(adoptableBondCents(0, 2001), 'zero').toBeNull();
    expect(adoptableBondCents(-5, 2001), 'negative').toBeNull();
    expect(adoptableBondCents(2002, 2001), 'above the bid').toBeNull();
  });
});

describe('every game-written fail_reason word is a vocabulary member or a pinned exclusion', () => {
  // The vocabulary doc claims it is the union of the service verdicts and the
  // game-recorded reasons a FAILED row can carry, but only the service half
  // has a drift signal (the once-per-word warn). This scan closes the game
  // half: a NEW game-written word outside the vocabulary would render every
  // affected buyer the generic line with no red test and no log. Expired-only
  // words are excluded ON PURPOSE (never rendered: failDetailReason gates to
  // failed rows, and these three are stamped on rows leaving through expiry).
  // KNOWN scan limits, accepted: the writer corpus is the two files below (a
  // third writer file would need adding here; today only woc_market.ts calls
  // transitionSettlement and only woc_market_db.ts writes fail_reason SQL
  // literals); a 4th argument built from a template literal or a call result
  // yields no word (the ?? 'refused' fallback keeps a literal in every such
  // call today); and an exclusion member whose SQL write disappears goes dead
  // silently (the positive controls below cover two of the three).
  const EXPIRED_ONLY_EXCLUSIONS = ['listing_cancelled', 'listing_suspended', 'schema_dedupe'];

  /** The 4th argument of every transitionSettlement(...) call, by a depth
   *  walk (the calls span lines, so a flat regex under-reaches). */
  function transitionFailReasonLiterals(src: string): string[] {
    const words: string[] = [];
    let from = 0;
    for (;;) {
      const at = src.indexOf('transitionSettlement(', from);
      if (at === -1) break;
      let depth = 0;
      let end = at + 'transitionSettlement('.length - 1;
      for (let i = end; i < src.length; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      const call = src.slice(at, end + 1);
      // Split the argument list at top level and read the 4th argument only:
      // the 2nd/3rd args are STATE tokens, some of which ('expired') collide
      // with vocabulary words and must not launder the scan.
      const inner = call.slice(call.indexOf('(') + 1, -1);
      const args: string[] = [];
      let level = 0;
      let cur = '';
      for (const ch of inner) {
        if (ch === '(' || ch === '[' || ch === '{') level++;
        if (ch === ')' || ch === ']' || ch === '}') level--;
        if (ch === ',' && level === 0) {
          args.push(cur);
          cur = '';
        } else {
          cur += ch;
        }
      }
      args.push(cur);
      // Comparison operands inside a ternary condition (state === 'failed'
      // ? ... : 'window_elapsed') are STATE reads, not written reasons.
      const failArg = (args[3] ?? '').replace(/[=!]==\s*'[a-z_]+'/g, '');
      for (const m of failArg.matchAll(/'([a-z_]+)'/g)) words.push(m[1]);
      from = end + 1;
    }
    return words;
  }

  it('the transition calls and the direct SQL writes stay inside the pinned union', () => {
    const market = stripComments(
      readFileSync(new URL('../server/woc_market.ts', import.meta.url), 'utf8'),
    );
    const db = stripComments(
      readFileSync(new URL('../server/woc_market_db.ts', import.meta.url), 'utf8'),
    );
    const fromTransitions = transitionFailReasonLiterals(market);
    const fromSql = [...db.matchAll(/fail_reason = '([a-z_]+)'/g)].map((m) => m[1]);
    // Positive controls: the scan really sees the known writers on each arm,
    // so a refactor that blinds an extraction regex goes red instead of
    // silently passing an empty set.
    expect(fromTransitions).toContain('refused');
    expect(fromTransitions).toContain('confirming_overdue');
    expect(fromTransitions).toContain('window_elapsed');
    expect(fromSql).toContain('listing_cancelled');
    expect(fromSql).toContain('schema_dedupe');
    const union = new Set([...WOC_MARKET_WIRE_FAIL_REASONS, ...EXPIRED_ONLY_EXCLUSIONS]);
    for (const word of [...fromTransitions, ...fromSql]) {
      expect(
        union.has(word),
        `game-written fail_reason '${word}' needs a vocabulary decision`,
      ).toBe(true);
    }
  });
});
