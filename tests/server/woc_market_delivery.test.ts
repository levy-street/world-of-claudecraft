// Direct-rig pins for the extracted delivery arms
// (server/woc_market_delivery.ts) where the service suites cannot reach the
// behavior decisively: the stamp-ledger high-water (the maps hold
// exactly-once intents nothing may drop, so the bound is a counted,
// re-arming warn rather than a cap). The park-cap arithmetic lives in
// tests/server/woc_market_local_ledgers.test.ts; the flow behavior rides the
// service and escrow-queue suites.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { WocListingRow, WocSweepErrorTag } from '../../server/woc_market';
import {
  createWocMarketDeliveryArms,
  type WocDeliveryCtx,
  wocStampHighWaterCount,
} from '../../server/woc_market_delivery';
import {
  WOC_LOCAL_PARK_MAX_ENTRIES,
  WOC_LOCAL_STAMP_HIGH_WATER,
  wocParkRefusalCount,
} from '../../server/woc_market_local_ledgers';

/** A minimal ctx whose mail persist FAILS after the intent stamp, so every
 *  drive adds one retained pendingMail entry (the stamp survives a persist
 *  failure by design: it is the resume evidence). */
function makeCtx(): { ctx: WocDeliveryCtx; sweepErrors: [WocSweepErrorTag, unknown][] } {
  const sweepErrors: [WocSweepErrorTag, unknown][] = [];
  const partial = {
    db: {
      deliveryTarget: async () => ({ characterId: 21, name: 'Aldan' }),
      claimCustodyRef: async () => true,
      markCustodyMailIntent: async () => true,
      markCustodyRefBooked: async () => {},
      markItemDisposed: async () => {},
    },
    custody: {
      persistMailParcel: async () => {
        throw new Error('post office down');
      },
      hasParcel: () => false,
    },
    realm: 'test-realm',
    now: () => 1_000_000,
    sweepError: (arm: WocSweepErrorTag, err: unknown) => {
      sweepErrors.push([arm, err]);
    },
    pruneLocalLedgers: () => {},
    parkedDeliveries: new Map<number, number>(),
    parkedReturns: new Map<number, number>(),
    pendingGrants: new Map<
      string,
      { characterId: number; leaseNonce: string | undefined; stampMs: number }
    >(),
    pendingMail: new Map<string, { stampMs: number; written: boolean }>(),
    parkRetryMs: 60_000,
    sweepBatch: 25,
  };
  // The partial rig hides behind a cast, so a FUTURE WocDeliveryCtx member
  // the arms start reading would silently arrive undefined (the fake-union
  // class at smaller radius). The proxy makes any unstubbed access fail
  // loudly at test time instead.
  const strict = new Proxy(partial, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && !(prop in target)) {
        throw new Error(`WocDeliveryCtx member not stubbed by this rig: ${prop}`);
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as WocDeliveryCtx;
  return { ctx: strict, sweepErrors };
}

const listing = (id: number): WocListingRow =>
  ({
    id,
    sellerAccount: 4,
    sellerCharacter: 11,
    resolution: 'no_bids',
    item: { itemId: 'iron_sword', count: 1 },
  }) as unknown as WocListingRow;

describe('the stamp-ledger high-water (counted, re-arming, never shedding)', () => {
  it('warns once per crossing, counts it, and never drops an intent', async () => {
    const { ctx } = makeCtx();
    const arms = createWocMarketDeliveryArms(ctx);
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // One below the mark: the next stamp is the crossing.
      for (let i = 0; i < WOC_LOCAL_STAMP_HIGH_WATER - 1; i++) {
        ctx.pendingMail.set(`seed-${i}`, { stampMs: 1, written: true });
      }
      const before = wocStampHighWaterCount();
      await expect(arms.returnListingItem(listing(1))).rejects.toThrow('post office down');
      // The stamp SURVIVED the failed persist (grew, never shed), the
      // crossing warned exactly once, and the counter dates it.
      expect(ctx.pendingMail.size).toBe(WOC_LOCAL_STAMP_HIGH_WATER);
      expect(wocStampHighWaterCount()).toBe(before + 1);
      const highWaterWarns = () =>
        warns.mock.calls.filter((c) => String(c[0]).includes('intent ledger high water'));
      expect(highWaterWarns()).toHaveLength(1);
      // Above the mark, the latch holds: a second stamp is not a second line.
      await expect(arms.returnListingItem(listing(2))).rejects.toThrow('post office down');
      expect(ctx.pendingMail.size).toBe(WOC_LOCAL_STAMP_HIGH_WATER + 1);
      expect(wocStampHighWaterCount()).toBe(before + 1);
      expect(highWaterWarns()).toHaveLength(1);
      // Drain below the mark (the TTL prune's job in production), stamp
      // again: the latch re-armed and the NEXT crossing warns and counts.
      for (let i = 0; i < 10; i++) ctx.pendingMail.delete(`seed-${i}`);
      await expect(arms.returnListingItem(listing(3))).rejects.toThrow('post office down');
      expect(highWaterWarns()).toHaveLength(1);
      for (let i = 10; i < 10 + 12; i++) {
        ctx.pendingMail.set(`refill-${i}`, { stampMs: 1, written: true });
      }
      await expect(arms.returnListingItem(listing(4))).rejects.toThrow('post office down');
      expect(wocStampHighWaterCount()).toBe(before + 2);
      expect(highWaterWarns()).toHaveLength(2);
    } finally {
      warns.mockRestore();
    }
  });

  it('the total across BOTH stamp maps is what crosses the mark', async () => {
    // The review round: per-map comparison let 400 grants plus 400 mail
    // intents sit silent; the incident is entries HELD, wherever they sit.
    const { ctx } = makeCtx();
    const arms = createWocMarketDeliveryArms(ctx);
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const half = Math.floor(WOC_LOCAL_STAMP_HIGH_WATER / 2);
      for (let i = 0; i < half; i++) {
        ctx.pendingGrants.set(`g-${i}`, { characterId: 1, leaseNonce: 'n', stampMs: 1 });
        ctx.pendingMail.set(`m-${i}`, { stampMs: 1, written: true });
      }
      const before = wocStampHighWaterCount();
      await expect(arms.returnListingItem(listing(9))).rejects.toThrow('post office down');
      expect(wocStampHighWaterCount()).toBe(before + 1);
      expect(
        warns.mock.calls.filter((c) => String(c[0]).includes('intent ledger high water')),
      ).toHaveLength(1);
    } finally {
      warns.mockRestore();
    }
  });

  it('EVERY stamp site arms the watcher (call-site completeness, comment-stripped)', async () => {
    // The behavioral case above reaches the crossing through ONE of the three
    // stamp sites (the mail stamp in bookCustodyOnce). The other two, the
    // hand-off mail stamp and the pendingGrants stamp, are invisible to it:
    // dropping watchStampHighWater() after either leaves the suite green, and
    // a realm whose held intents are all GRANT intents would then never warn
    // and never count, which is exactly the incident the bound exists for.
    // So the ARMING is pinned structurally, at every site, by exact count.
    const { stripComments } = await import('../helpers/strip_comments');
    const src = stripComments(
      readFileSync(new URL('../../server/woc_market_delivery.ts', import.meta.url), 'utf8'),
    );
    const stampSites = src.split(/ctx\.pending(?:Grants|Mail)\.set\(/).slice(1);
    expect(stampSites).toHaveLength(3);
    for (const [i, site] of stampSites.entries()) {
      expect(
        site.slice(0, 400).includes('watchStampHighWater()'),
        `stamp site ${i + 1} arms the high-water watcher`,
      ).toBe(true);
    }
    // Totals agree, so an extra call cannot stand in for a missing one.
    expect(src.match(/watchStampHighWater\(\);/g) ?? []).toHaveLength(3);
  });
});

describe('a cap-refused park at the ARM (not just the unit)', () => {
  it('claims no standing park but still rotates the row off the batch head', async () => {
    // wocParkRow's refusal is pinned at the unit (local_ledgers), but the
    // arm's own consequence is the part that can silently rot: the stat is
    // incremented INSIDE the guard while the rotation write sits outside it,
    // so rewriting `if (wocParkRow(...)) scope.parked++` to two statements
    // is invisible to every other suite, and the standing-parks stat would
    // then overstate during exactly the mass-park incident the cap exists
    // for. Both halves are asserted here, in one drive.
    const { ctx } = makeCtx();
    const touched: number[] = [];
    const db = ctx.db as unknown as Record<string, unknown>;
    // A returns-arm drive: the shared rig stubs the delivery-side members,
    // and a null delivery target is the cleanest way to make the arm's
    // attempt answer false (the park path) rather than throw (the isolation
    // path, which never reaches the park at all).
    db.deliveryTarget = async () => null;
    db.undisposedClosedListings = async () => [listing(77)];
    db.touchListingRow = async (id: number) => {
      touched.push(id);
    };
    // Fill the park map to the cap with OTHER ids, so listing 77's park is
    // refused as a NEW entry rather than admitted as a re-park.
    for (let i = 0; i < WOC_LOCAL_PARK_MAX_ENTRIES; i++) {
      ctx.parkedReturns.set(1000 + i, 2_000_000);
    }
    const arms = createWocMarketDeliveryArms(ctx);
    const scope = { contended: false, parked: 0 };
    const refusalsBefore = wocParkRefusalCount();

    await arms.returnUndisposedItems(1_000_000, scope);

    // Refused and COUNTED, so the operator sees the cap biting...
    expect(wocParkRefusalCount()).toBe(refusalsBefore + 1);
    expect(ctx.parkedReturns.has(77)).toBe(false);
    // ...the standing-parks stat does NOT claim it (the row is un-excluded
    // and simply retries next pass)...
    expect(scope.parked).toBe(0);
    // ...and the rotation still fired, or a refused row would own the batch
    // head every pass and starve the rest of the backlog.
    expect(touched).toEqual([77]);
  });
});
