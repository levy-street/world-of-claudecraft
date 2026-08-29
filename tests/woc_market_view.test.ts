import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { exchangeHardLock, exchangeItemCategory } from '../src/sim/exchange_eligibility';
import type { InvSlot, ItemDef } from '../src/sim/types';
import {
  browseItemFilterIds,
  browseQualityOptions,
  buildWocMarketView,
  canCancelListing,
  countdownSigBucket,
  lockedOutRows,
  sellableRows,
  type WocActivityView,
  type WocBidView,
  type WocEstimateView,
  type WocListingView,
  type WocMarketStatus,
  type WocMarketViewInput,
  type WocMarketViewModel,
  type WocSaleView,
  type WocSettlementView,
  wocMarketViewSig,
  wocQuoteCountdownSig,
} from '../src/ui/woc_market_view';

// Pure core: DOM/i18n-free, deterministic, the caller passes nowMs. Inputs are
// hand-built structural twins of the SDK payloads; the sell-tab fixtures are
// REAL ids resolved from the live ITEMS table so the pre-filter is exercised
// against shipped content, not synthetic defs.

const NOW = 1_000_000;

// ---------------------------------------------------------------------------
// Real-content fixtures for the sell-tab pre-filter
// ---------------------------------------------------------------------------

const allItems = Object.values(ITEMS) as ItemDef[];
const findId = (label: string, pred: (d: ItemDef) => boolean): string => {
  const def = allItems.find(pred);
  if (!def) throw new Error(`ITEMS fixture not found: ${label}`);
  return def.id;
};

const epicEquipId = findId(
  'eligible epic equipment',
  (d) =>
    d.slot !== undefined &&
    d.quality === 'epic' &&
    !d.soulbound &&
    !d.noMarketList &&
    d.kind !== 'quest',
);
// Slot-bearing on purpose, so the soulbound arm (not the slot arm) refuses it.
const soulboundId = findId(
  'soulbound equipment',
  (d) => d.slot !== undefined && d.soulbound === true,
);
const questKindId = findId('quest-kind item', (d) => d.kind === 'quest');
// noMarketList AND not a chroma plate: every plate carries that flag and the
// Exchange now tolerates it for that category, so an unscoped pick could resolve
// to a plate and this arm would assert the opposite of the rule.
const noMarketListId = findId(
  'noMarketList non-chroma item',
  (d) => d.noMarketList === true && exchangeItemCategory(d) !== 'mech_chroma',
);
// Category 'other' explicitly, not merely "no slot": a mount also has no slot
// and is deliberately tradable now, so the old spelling of this fixture would
// have drifted into testing nothing.
const noSlotId = findId(
  'def in no tradable category',
  (d) => exchangeItemCategory(d) === 'other' && exchangeHardLock(d, undefined) === null,
);
// The two collectible categories, resolved from shipped content.
const mountItemId = findId('a mount item', (d) => exchangeItemCategory(d) === 'mount');
const chromaPlateId = findId('a chroma plate', (d) => exchangeItemCategory(d) === 'mech_chroma');
const rareEquipId = findId(
  'rare equipment',
  (d) =>
    d.slot !== undefined &&
    d.quality === 'rare' &&
    !d.soulbound &&
    !d.noMarketList &&
    d.kind !== 'quest',
);

// ---------------------------------------------------------------------------
// Input builders
// ---------------------------------------------------------------------------

const makeStatus = (over: Partial<WocMarketStatus> = {}): WocMarketStatus => ({
  ok: true,
  enabled: true,
  price: { available: true, healthy: true, tokensPerUsd: 100, asOfMs: 900_000 },
  maxActiveListings: 12,
  durationsHours: [12, 24, 48],
  minPriceCents: 25,
  maxPriceCents: 100_000,
  allowMounts: true,
  allowMechChromas: true,
  qualityFloor: 'epic',
  settlementWindowSeconds: 600,
  ...over,
});

const makeListing = (over: Partial<WocListingView> = {}): WocListingView => ({
  id: 1,
  item: { itemId: epicEquipId, count: 1 },
  itemId: epicEquipId,
  quality: 'epic',
  format: 'auction',
  sellerName: 'Seller',
  mine: false,
  startCents: 1000,
  hasReserve: false,
  reserveMet: null,
  buyNowCents: null,
  offerNext: false,
  status: 'active',
  resolution: null,
  currentBidCents: null,
  minNextBidCents: 1000,
  minNextBidBondCents: 100,
  buyNowLocked: false,
  endsAtMs: NOW + 90_500,
  createdAtMs: NOW - 3_600_000,
  ...over,
});

const makeBrowse = (
  over: Partial<WocMarketViewInput['browse']> = {},
): WocMarketViewInput['browse'] => ({
  listings: [],
  hasMore: false,
  page: 0,
  pageSize: 25,
  loading: false,
  failed: false,
  selectedId: null,
  detail: null,
  estimate: null,
  sales: null,
  ...over,
});

const makeActivity = (over: Partial<WocActivityView> = {}): WocActivityView => ({
  listings: [],
  bids: [],
  settlements: [],
  strikes: null,
  termsAcceptedAtMs: null,
  walletLinked: true,
  ...over,
});

const makeBid = (over: Partial<WocBidView> = {}): WocBidView => ({
  id: 11,
  listingId: 1,
  amountCents: 1500,
  status: 'active',
  bondCents: 100,
  bondConfirming: false,
  bondState: 'confirmed',
  bondReference: null,
  bondQuoteExpiresAtMs: null,
  placedAtMs: NOW - 60_000,
  ...over,
});

const makeSettlement = (over: Partial<WocSettlementView> = {}): WocSettlementView => ({
  id: 21,
  listingId: 1,
  attempt: 1,
  amountCents: 2500,
  state: 'offered',
  quoteReference: null,
  quoteExpiresAtMs: null,
  deadlineAtMs: NOW + 30_000,
  createdAtMs: NOW - 60_000,
  ...over,
});

const makeInput = (over: Partial<WocMarketViewInput> = {}): WocMarketViewInput => ({
  capable: true,
  status: makeStatus(),
  statusFailed: false,
  walletLinked: true,
  tab: 'browse',
  nowMs: NOW,
  browse: makeBrowse(),
  inventory: [],
  activity: null,
  ...over,
});

const ready = (input: WocMarketViewInput): Extract<WocMarketViewModel, { kind: 'ready' }> => {
  const model = buildWocMarketView(input);
  if (model.kind !== 'ready') throw new Error(`expected a ready model, got ${model.kind}`);
  return model;
};

// ---------------------------------------------------------------------------

describe('woc_market_view fixtures', () => {
  it('resolved every real-content fixture from ITEMS', () => {
    for (const id of [
      epicEquipId,
      soulboundId,
      questKindId,
      noMarketListId,
      noSlotId,
      rareEquipId,
    ]) {
      expect(typeof id).toBe('string');
      expect(ITEMS[id]).toBeTruthy();
    }
  });
});

describe('gate states', () => {
  it('is unavailable on a platform-incapable build', () => {
    expect(buildWocMarketView(makeInput({ capable: false })).kind).toBe('unavailable');
  });

  it('is error when the status fetch failed', () => {
    expect(buildWocMarketView(makeInput({ statusFailed: true })).kind).toBe('error');
  });

  it('is loading while the status is null', () => {
    expect(buildWocMarketView(makeInput({ status: null })).kind).toBe('loading');
  });

  it('is error when the status payload carries ok false', () => {
    expect(buildWocMarketView(makeInput({ status: makeStatus({ ok: false }) })).kind).toBe('error');
  });

  it('is disabled when the market is off for this realm', () => {
    expect(buildWocMarketView(makeInput({ status: makeStatus({ enabled: false }) })).kind).toBe(
      'disabled',
    );
  });
});

describe('paused derivation', () => {
  it('pauses when the price feed is unavailable', () => {
    const status = makeStatus({
      price: { available: false, healthy: true, tokensPerUsd: null, asOfMs: null },
    });
    expect(ready(makeInput({ status })).paused).toBe(true);
  });

  it('pauses when the price feed is unhealthy', () => {
    const status = makeStatus({
      price: { available: true, healthy: false, tokensPerUsd: 100, asOfMs: 1 },
    });
    expect(ready(makeInput({ status })).paused).toBe(true);
  });

  it('runs when the feed is available and healthy', () => {
    expect(ready(makeInput()).paused).toBe(false);
  });
});

const BOTH_ON = { mounts: true, mechChromas: true } as const;

describe('lockedOutRows: only what UNLOCKING would bring back', () => {
  // The caption "locked items are not listed here" is only true for a copy the
  // player's own lock refuses and nothing stronger. Asking the bags "is
  // anything locked" said it about copies the picker would never have offered.
  it('reports a locked copy of otherwise eligible equipment', () => {
    const inventory: InvSlot[] = [{ itemId: epicEquipId, count: 1, instance: { locked: true } }];
    expect(sellableRows(inventory, 'epic', BOTH_ON)).toEqual([]);
    expect(lockedOutRows(inventory, 'epic', BOTH_ON)).toEqual([
      { index: 0, itemId: epicEquipId, quality: 'epic', instance: { locked: true } },
    ]);
  });

  it.each([
    ['a def with no equip slot', noSlotId],
    ['a soulbound def', soulboundId],
    ['a quest-kind def', questKindId],
    ['rare equipment under the epic floor', rareEquipId],
  ])('says nothing about a locked %s, which unlocking would not bring back', (_l, itemId) => {
    const inventory: InvSlot[] = [{ itemId, count: 1, instance: { locked: true } }];
    expect(sellableRows(inventory, 'epic', BOTH_ON)).toEqual([]);
    expect(lockedOutRows(inventory, 'epic', BOTH_ON)).toEqual([]);
  });

  it('says nothing about an eligible copy that is NOT locked', () => {
    const inventory: InvSlot[] = [{ itemId: epicEquipId, count: 1 }];
    expect(sellableRows(inventory, 'epic', BOTH_ON)).toHaveLength(1);
    expect(lockedOutRows(inventory, 'epic', BOTH_ON)).toEqual([]);
  });

  it('respects the same quality floor as the picker it mirrors', () => {
    // A locked epic is reported at the epic floor and goes quiet at legendary,
    // which is the picker's own rule seen from the other side.
    const inventory: InvSlot[] = [{ itemId: epicEquipId, count: 1, instance: { locked: true } }];
    expect(lockedOutRows(inventory, 'epic', BOTH_ON)).toHaveLength(1);
    expect(lockedOutRows(inventory, 'legendary', BOTH_ON)).toEqual([]);
  });
});

describe('sellableRows: the sell-tab pre-filter over real ITEMS', () => {
  it('passes eligible epic equipment and preserves its inventory index', () => {
    const inventory: InvSlot[] = [
      { itemId: noSlotId, count: 1 },
      { itemId: epicEquipId, count: 1 },
    ];
    expect(sellableRows(inventory, 'epic', BOTH_ON)).toEqual([
      { index: 1, itemId: epicEquipId, quality: 'epic', instance: undefined },
    ]);
  });

  it.each([
    ['a def with no equip slot', noSlotId],
    ['a soulbound def', soulboundId],
    ['a noMarketList def', noMarketListId],
    ['a quest-kind def', questKindId],
    ['rare equipment under the epic floor', rareEquipId],
  ])('refuses %s', (_label, itemId) => {
    expect(sellableRows([{ itemId, count: 1 }], 'epic', BOTH_ON)).toEqual([]);
  });

  it('refuses a character-bound copy of otherwise eligible equipment', () => {
    const inventory: InvSlot[] = [{ itemId: epicEquipId, count: 1, instance: { boundTo: 3 } }];
    expect(sellableRows(inventory, 'epic', BOTH_ON)).toEqual([]);
  });

  it('drops an ARMED bind-on-trade copy, and keeps the same copy disarmed', () => {
    // bindOnTrade with no stamp yet: the copy binds to whoever receives it
    // next, and an escrow listing is an anonymous pipe with nobody for the
    // stamp to land on. The picker has to hide it, or the seller reaches the
    // listing form for an item the server's extraction then refuses.
    // The control is the SAME payload minus the flag, so the drop is
    // attributable to the arming rather than to anything else in the fixture.
    const armed: InvSlot[] = [
      { itemId: epicEquipId, count: 1, instance: { signer: 'Selara', bindOnTrade: true } },
    ];
    expect(sellableRows(armed, 'epic', BOTH_ON)).toEqual([]);
    const disarmed: InvSlot[] = [{ itemId: epicEquipId, count: 1, instance: { signer: 'Selara' } }];
    expect(sellableRows(disarmed, 'epic', BOTH_ON)).toEqual([
      { index: 0, itemId: epicEquipId, quality: 'epic', instance: { signer: 'Selara' } },
    ]);
  });

  it('hides a copy the owner item-locked, and offers the same copy unlocked', () => {
    // R10: the lock is liftable in the bags, so the picker hides the locked
    // copy (the server would refuse it) while the unlocked control proves the
    // drop is attributable to the flag alone.
    const locked: InvSlot[] = [{ itemId: epicEquipId, count: 1, instance: { locked: true } }];
    expect(sellableRows(locked, 'epic', BOTH_ON)).toEqual([]);
    const unlocked: InvSlot[] = [{ itemId: epicEquipId, count: 1, instance: { locked: false } }];
    expect(sellableRows(unlocked, 'epic', BOTH_ON)).toEqual([
      { index: 0, itemId: epicEquipId, quality: 'epic', instance: { locked: false } },
    ]);
  });

  it('lets a rolled epic quality lift a rare def over an epic floor', () => {
    const instance = { rolled: { quality: 'epic' } };
    expect(sellableRows([{ itemId: rareEquipId, count: 1, instance }], 'epic', BOTH_ON)).toEqual([
      { index: 0, itemId: rareEquipId, quality: 'epic', instance },
    ]);
  });

  it('offers a mount and a chroma plate from real content, under an epic floor', () => {
    // Under the SAME epic floor that refuses rare equipment above: the floor is
    // the equipment floor and must not reach either collectible category. Both
    // fixtures are below epic in shipped content, so a floor bug shows up here.
    const inventory: InvSlot[] = [
      { itemId: mountItemId, count: 1 },
      { itemId: chromaPlateId, count: 1 },
    ];
    expect(sellableRows(inventory, 'epic', BOTH_ON).map((r) => r.itemId)).toEqual([
      mountItemId,
      chromaPlateId,
    ]);
  });

  it('withholds each category when the realm has it off, independently', () => {
    // Independently, because one shared switch would make an operator disabling
    // mounts also delist every suit skin.
    const inventory: InvSlot[] = [
      { itemId: mountItemId, count: 1 },
      { itemId: chromaPlateId, count: 1 },
    ];
    expect(
      sellableRows(inventory, 'epic', { mounts: false, mechChromas: true }).map((r) => r.itemId),
    ).toEqual([chromaPlateId]);
    expect(
      sellableRows(inventory, 'epic', { mounts: true, mechChromas: false }).map((r) => r.itemId),
    ).toEqual([mountItemId]);
    expect(sellableRows(inventory, 'epic', { mounts: false, mechChromas: false })).toEqual([]);
  });

  it('still refuses a BOUND copy of a mount, switch on or not', () => {
    const inventory: InvSlot[] = [{ itemId: mountItemId, count: 1, instance: { boundTo: 3 } }];
    expect(sellableRows(inventory, 'epic', BOTH_ON)).toEqual([]);
  });
});

describe('listing row mapping', () => {
  it('clamps remainingMs at 0 for a past endsAt and passes future ones through', () => {
    const model = ready(
      makeInput({
        browse: makeBrowse({
          listings: [
            makeListing({ id: 1, endsAtMs: NOW - 5000 }),
            makeListing({ id: 2, endsAtMs: NOW + 90_500 }),
          ],
        }),
      }),
    );
    expect(model.browse.rows[0]?.remainingMs).toBe(0);
    expect(model.browse.rows[1]?.remainingMs).toBe(90_500);
  });

  it('derives the reserve badge from hasReserve and reserveMet', () => {
    const model = ready(
      makeInput({
        browse: makeBrowse({
          listings: [
            makeListing({ id: 1, hasReserve: false, reserveMet: null }),
            makeListing({ id: 2, hasReserve: true, reserveMet: true }),
            makeListing({ id: 3, hasReserve: true, reserveMet: false }),
          ],
        }),
      }),
    );
    expect(model.browse.rows.map((r) => r.reserveBadge)).toEqual([null, 'met', 'not_met']);
  });

  it('marks exactly the selected id and passes status/resolution through', () => {
    const model = ready(
      makeInput({
        browse: makeBrowse({
          listings: [
            makeListing({ id: 1 }),
            makeListing({ id: 2, status: 'closed', resolution: 'sold' }),
          ],
          selectedId: 2,
        }),
      }),
    );
    expect(model.browse.rows.map((r) => r.selected)).toEqual([false, true]);
    expect(model.browse.rows[1]?.status).toBe('closed');
    expect(model.browse.rows[1]?.resolution).toBe('sold');
  });
});

describe('detail resolution', () => {
  const estimate: WocEstimateView = {
    available: true,
    usdCents: 1500,
    amount: { base: '150000', tokens: 1500 },
    asOfMs: 950_000,
  };
  const sale: WocSaleView = {
    id: 5,
    itemId: epicEquipId,
    priceCents: 4000,
    sellerName: 'Old Seller',
    buyerName: 'Old Buyer',
    atMs: NOW - 86_400_000,
  };

  it('prefers browse.detail when present, passing estimate and sales through', () => {
    const model = ready(
      makeInput({
        browse: makeBrowse({
          listings: [makeListing({ id: 1 })],
          selectedId: 1,
          detail: makeListing({ id: 99, offerNext: true }),
          estimate,
          sales: [sale],
        }),
      }),
    );
    expect(model.browse.detail?.row.id).toBe(99);
    expect(model.browse.detail?.offerNext).toBe(true);
    expect(model.browse.detail?.estimateAmount).toEqual({ base: '150000', tokens: 1500 });
    expect(model.browse.detail?.estimateAsOfMs).toBe(950_000);
    expect(model.browse.detail?.sales).toEqual([sale]);
  });

  it('falls back to the selected row in listings, with [] for null sales', () => {
    const model = ready(
      makeInput({
        browse: makeBrowse({
          listings: [makeListing({ id: 1 }), makeListing({ id: 2 })],
          selectedId: 2,
          detail: null,
          sales: null,
        }),
      }),
    );
    expect(model.browse.detail?.row.id).toBe(2);
    expect(model.browse.detail?.sales).toEqual([]);
    expect(model.browse.detail?.estimateAmount).toBeNull();
  });

  it('is null with no detail and no selected row', () => {
    const model = ready(
      makeInput({ browse: makeBrowse({ listings: [makeListing({ id: 1 })], selectedId: null }) }),
    );
    expect(model.browse.detail).toBeNull();
  });
});

describe('activity mapping', () => {
  const activityModel = (activity: WocActivityView) => {
    const model = ready(makeInput({ activity }));
    if (!model.activity) throw new Error('expected an activity model');
    return model.activity;
  };

  it('carries the sale price to the row; an older server without it reads null', () => {
    // The listing row keeps current_bid_cents forever ($1 in the shipped bug),
    // while the sales table holds the actual sale price ($3 on a buy-now that
    // outran the bidding). The activity read joins it through as soldCents so
    // the seller's "Sold" row can name the price the sale actually closed at.
    const a = activityModel(
      makeActivity({
        listings: [
          makeListing({
            id: 1,
            status: 'closed',
            resolution: 'sold',
            currentBidCents: 100,
            soldCents: 300,
          }),
          makeListing({ id: 2, status: 'closed', resolution: 'sold', currentBidCents: 100 }),
        ],
      }),
    );
    expect(a.listings.map((l) => l.soldCents)).toEqual([300, null]);
  });

  it('passes a null bond quote expiry through and clamps a live one', () => {
    const a = activityModel(
      makeActivity({
        bids: [
          makeBid({ id: 1, bondQuoteExpiresAtMs: null }),
          makeBid({ id: 2, bondQuoteExpiresAtMs: NOW + 5000 }),
          makeBid({ id: 3, bondQuoteExpiresAtMs: NOW - 1 }),
        ],
      }),
    );
    expect(a.bids.map((b) => b.bondQuoteRemainingMs)).toEqual([null, 5000, 0]);
  });

  it('clamps the settlement deadline and quote countdowns', () => {
    const a = activityModel(
      makeActivity({
        settlements: [
          makeSettlement({ id: 1, deadlineAtMs: NOW + 30_000, quoteExpiresAtMs: NOW + 2000 }),
          makeSettlement({ id: 2, deadlineAtMs: NOW - 10, quoteExpiresAtMs: null }),
        ],
      }),
    );
    expect(a.settlements[0]?.deadlineRemainingMs).toBe(30_000);
    expect(a.settlements[0]?.quoteRemainingMs).toBe(2000);
    expect(a.settlements[1]?.deadlineRemainingMs).toBe(0);
    expect(a.settlements[1]?.quoteRemainingMs).toBeNull();
  });

  it('passes the screened failReason through the settlement model untouched', () => {
    // The painter renders the WHY line for a failed payment from this field;
    // a model that drops it turns every failure back into a bare label.
    const a = activityModel(
      makeActivity({
        settlements: [
          makeSettlement({ id: 1, state: 'failed', failReason: 'burn_missing' }),
          makeSettlement({ id: 2 }),
        ],
      }),
    );
    expect(a.settlements[0]?.failReason).toBe('burn_missing');
    expect(a.settlements[1]?.failReason).toBeUndefined();
  });

  it('gates the WHY line in the MODEL: failed rows only, expired rows excluded', () => {
    // failDetailReason is the painter's whole verdict, so this is the
    // behavioral home of the gate. An expired row KEEPS a chain-refused
    // try's failReason (the sweep COALESCEs it), and rendering a mismatch
    // line under "Expired unpaid" would accuse a buyer who walked away.
    const a = activityModel(
      makeActivity({
        settlements: [
          makeSettlement({ id: 1, state: 'failed', failReason: 'burn_missing' }),
          makeSettlement({ id: 2, state: 'expired', failReason: 'leg_mismatch' }),
          makeSettlement({ id: 3, state: 'failed' }),
        ],
      }),
    );
    expect(a.settlements[0]?.failDetailReason).toBe('burn_missing');
    expect(a.settlements[1]?.failDetailReason).toBeNull();
    expect(a.settlements[2]?.failDetailReason).toBeNull();
  });

  it('defaults strikes to 0 with no strike record', () => {
    const a = activityModel(makeActivity({ strikes: null }));
    expect(a.strikes).toBe(0);
    expect(a.suspendedRemainingMs).toBeNull();
  });

  it('drops a suspension already in the past and counts down a live one', () => {
    const past = activityModel(
      makeActivity({ strikes: { strikes: 2, suspendedUntilMs: NOW - 1 } }),
    );
    expect(past.strikes).toBe(2);
    expect(past.suspendedRemainingMs).toBeNull();
    const live = activityModel(
      makeActivity({ strikes: { strikes: 3, suspendedUntilMs: NOW + 60_000 } }),
    );
    expect(live.suspendedRemainingMs).toBe(60_000);
  });

  it('derives termsAccepted from the acceptance timestamp', () => {
    expect(activityModel(makeActivity({ termsAcceptedAtMs: 123 })).termsAccepted).toBe(true);
    expect(activityModel(makeActivity({ termsAcceptedAtMs: null })).termsAccepted).toBe(false);
  });
});

describe('hasMore passthrough', () => {
  // The server ships a has-more probe rather than a total, so the model
  // carries the boolean verbatim (no client-side page math to derive).
  it.each([[true], [false]])('passes hasMore %s through to the browse model', (hasMore) => {
    expect(ready(makeInput({ browse: makeBrowse({ hasMore }) })).browse.hasMore).toBe(hasMore);
  });

  it('moves the repaint signature when hasMore flips', () => {
    const closed = wocMarketViewSig(
      buildWocMarketView(makeInput({ browse: makeBrowse({ hasMore: false }) })),
    );
    const open = wocMarketViewSig(
      buildWocMarketView(makeInput({ browse: makeBrowse({ hasMore: true }) })),
    );
    expect(open).not.toBe(closed);
  });
});

describe('countdownSigBucket', () => {
  // Second resolution inside the final two minutes (the anti-snipe window),
  // minute resolution beyond it; the 120_000 edge belongs to the minute band.
  it.each([
    [0, 0],
    [999, 0],
    [1000, 1],
    [119_999, 119],
    [120_000, 122],
    [179_999, 122],
    [180_000, 123],
  ])('buckets %i ms into signature bucket %i', (remainingMs, bucket) => {
    expect(countdownSigBucket(remainingMs)).toBe(bucket);
  });
});

describe('wocMarketViewSig', () => {
  // A listing whose countdown sits mid-second (remaining 10_500 ms at NOW), so
  // a sub-second nowMs advance stays inside the same whole-second bucket.
  const sigInput = (over: Partial<WocMarketViewInput> = {}): WocMarketViewInput =>
    makeInput({
      browse: makeBrowse({
        listings: [makeListing({ id: 1, endsAtMs: NOW + 10_500, currentBidCents: 100 })],
        hasMore: false,
      }),
      ...over,
    });

  it('is identical for the same input, call after call', () => {
    const a = wocMarketViewSig(buildWocMarketView(sigInput()));
    const b = wocMarketViewSig(buildWocMarketView(sigInput()));
    expect(a).toBe(b);
  });

  it('moves when a listing currentCents changes', () => {
    const base = wocMarketViewSig(buildWocMarketView(sigInput()));
    const bumped = wocMarketViewSig(
      buildWocMarketView(
        makeInput({
          browse: makeBrowse({
            listings: [makeListing({ id: 1, endsAtMs: NOW + 10_500, currentBidCents: 125 })],
            hasMore: false,
          }),
        }),
      ),
    );
    expect(bumped).not.toBe(base);
  });

  it('moves when the tab changes', () => {
    const browse = wocMarketViewSig(buildWocMarketView(sigInput({ tab: 'browse' })));
    const sell = wocMarketViewSig(buildWocMarketView(sigInput({ tab: 'sell' })));
    expect(sell).not.toBe(browse);
  });

  it('moves when a countdown crosses a whole second', () => {
    const before = wocMarketViewSig(buildWocMarketView(sigInput({ nowMs: NOW })));
    const after = wocMarketViewSig(buildWocMarketView(sigInput({ nowMs: NOW + 1000 })));
    expect(after).not.toBe(before);
  });

  it('does not move for a sub-second advance with nothing else changed', () => {
    const before = wocMarketViewSig(buildWocMarketView(sigInput({ nowMs: NOW })));
    const after = wocMarketViewSig(buildWocMarketView(sigInput({ nowMs: NOW + 200 })));
    expect(after).toBe(before);
  });

  it('moves when a failed settlement changes its WHY verdict, state unmoved', () => {
    // The revival loop can re-fail a row under a NEW reason while the state
    // string reads 'failed' both times; a signature that misses it leaves the
    // old accusation on screen until something else changes.
    const withReason = (failReason: string) =>
      wocMarketViewSig(
        buildWocMarketView(
          sigInput({
            activity: makeActivity({
              settlements: [makeSettlement({ id: 1, state: 'failed', failReason })],
            }),
          }),
        ),
      );
    expect(withReason('burn_missing')).not.toBe(withReason('unexpected_credit'));
  });

  it('digests non-ready models to their kind string', () => {
    expect(wocMarketViewSig(buildWocMarketView(makeInput({ capable: false })))).toBe('unavailable');
    expect(wocMarketViewSig(buildWocMarketView(makeInput({ status: null })))).toBe('loading');
    expect(wocMarketViewSig(buildWocMarketView(makeInput({ statusFailed: true })))).toBe('error');
    expect(
      wocMarketViewSig(buildWocMarketView(makeInput({ status: makeStatus({ enabled: false }) }))),
    ).toBe('disabled');
  });
});

describe('determinism', () => {
  it('builds deeply equal models from the same input object', () => {
    const input = makeInput({
      browse: makeBrowse({
        listings: [
          makeListing({ id: 1, hasReserve: true, reserveMet: false, currentBidCents: 200 }),
          makeListing({ id: 2, endsAtMs: NOW - 1 }),
        ],
        hasMore: true,
        selectedId: 1,
        detail: makeListing({ id: 1 }),
        estimate: { available: true, usdCents: 1500, amount: { base: '1', tokens: 15 }, asOfMs: 1 },
        sales: [],
      }),
      inventory: [{ itemId: epicEquipId, count: 1 }],
      activity: makeActivity({
        listings: [makeListing({ id: 3 })],
        bids: [makeBid()],
        settlements: [makeSettlement()],
        strikes: { strikes: 1, suspendedUntilMs: NOW + 1000 },
        termsAcceptedAtMs: NOW - 1,
      }),
    });
    expect(buildWocMarketView(input)).toEqual(buildWocMarketView(input));
  });
});

describe('canCancelListing (the one cancel gate both surfaces share)', () => {
  const row = { status: 'active', currentCents: null as number | null, cancelPending: false };
  it('offers Cancel on an active, unbid listing with no cancel intent', () => {
    expect(canCancelListing(row)).toBe(true);
  });
  it('withholds it per dimension: a bid, a pending cancel, a non-active status', () => {
    expect(canCancelListing({ ...row, currentCents: 500 }), 'bid landed').toBe(false);
    expect(canCancelListing({ ...row, cancelPending: true }), 'cancel already asked').toBe(false);
    expect(canCancelListing({ ...row, status: 'closed' }), 'not active').toBe(false);
    expect(canCancelListing({ ...row, status: 'settling' })).toBe(false);
  });
});

describe('wocMarketViewSig: the Activity listings digest', () => {
  it("moves when a bid lands on one of the seller's own listings (currentCents)", () => {
    // The seller's Cancel button is gated on an unbid listing and the price
    // cell renders the bid; a poll that brings the first bid must repaint or
    // the seller keeps a dead Cancel and the start price.
    const withBid = (currentBidCents: number | null) =>
      wocMarketViewSig(
        buildWocMarketView(
          makeInput({
            tab: 'activity',
            activity: makeActivity({
              listings: [makeListing({ id: 9, mine: true, currentBidCents })],
            }),
          }),
        ),
      );
    expect(withBid(null)).not.toBe(withBid(500));
  });
});

describe('resolved policy figures on the model', () => {
  it('passes the bond schedule through, and null when the server did not send one', () => {
    const schedule = { rateBps: 500, minCents: 100, maxCents: 5000, pendingTtlSeconds: 300 };
    expect(ready(makeInput({ status: makeStatus({ bond: schedule }) })).bondSchedule).toEqual(
      schedule,
    );
    // An older server: the disclosures must render figure-free, so absence is
    // an explicit null the painter can branch on, never an undefined slip.
    expect(ready(makeInput()).bondSchedule).toBeNull();
  });

  it('hands the sell caption the same policy figures the pre-filter applied', () => {
    const model = ready(
      makeInput({
        status: makeStatus({ qualityFloor: 'rare', allowMounts: true, allowMechChromas: false }),
      }),
    );
    expect(model.sell.qualityFloor).toBe('rare');
    expect(model.sell.allowMounts).toBe(true);
    expect(model.sell.allowMechChromas).toBe(false);
  });
});

describe('the Browse filters resolve in the view core', () => {
  it('offers the realm floor and up as the quality vocabulary, in rank order', () => {
    const noCollectibles = { mounts: false, mechChromas: false };
    expect(browseQualityOptions('rare', noCollectibles)).toEqual(['rare', 'epic', 'legendary']);
    expect(browseQualityOptions('legendary', noCollectibles)).toEqual(['legendary']);
    // An unknown floor word falls back to the epic default rather than
    // offering everything (the sellableRows fallback, one rule).
    expect(browseQualityOptions('mythic-nonsense', noCollectibles)).toEqual(['epic', 'legendary']);
  });

  it('widens down to uncommon while a collectible category is allowed', () => {
    // Mounts and chromas bypass the equipment floor (sellableRows) and rank
    // down to uncommon (SkinRank), so those listings genuinely exist and the
    // filter must be able to reach them. Either switch alone widens; the
    // floor never RAISES past itself (a rare floor stays reachable).
    expect(browseQualityOptions('epic', { mounts: true, mechChromas: false })).toEqual([
      'uncommon',
      'rare',
      'epic',
      'legendary',
    ]);
    expect(browseQualityOptions('epic', { mounts: false, mechChromas: true })).toEqual([
      'uncommon',
      'rare',
      'epic',
      'legendary',
    ]);
  });

  it('resolves an item query to ids by localized-name substring, with the three distinct answers', () => {
    const name = (id: string): string =>
      ({ a_sword: 'Kingsbane Sword', b_sword: 'Sword of Dawn', c_helm: 'Iron Helm' })[id] ?? id;
    const ids = ['a_sword', 'b_sword', 'c_helm'];
    // null: no filter (empty query).
    expect(browseItemFilterIds('   ', name, ids)).toBeNull();
    // ids: the matching subset, case-insensitively.
    expect(browseItemFilterIds('SWORD', name, ids)).toEqual(['a_sword', 'b_sword']);
    // []: a real "nothing matches" the caller paints as empty.
    expect(browseItemFilterIds('zzz', name, ids)).toEqual([]);
    // Past the cap the query is too broad to narrow: null (no filter), never
    // a truncated arbitrary subset that would silently hide listings.
    expect(browseItemFilterIds('sword', name, ids, 1)).toBeNull();
  });
});

describe('wocQuoteCountdownSig: the pending quote repaint key', () => {
  it('keys on SECONDS, matching the resolution the countdown is displayed at', () => {
    // A finer key would rebuild the window many times per second for a string
    // that did not change; the ceiling keeps 0.2s remaining reading as 1, the
    // way the countdown itself is shown.
    const now = 1_000_000;
    expect(wocQuoteCountdownSig(now + 90_000, now)).toBe('90');
    expect(wocQuoteCountdownSig(now + 90_400, now)).toBe('91');
    expect(wocQuoteCountdownSig(now + 200, now)).toBe('1');
  });

  it('floors at zero once the quote has run out, and is empty with no deadline', () => {
    // No pending quote means no key at all, so an idle window still rests.
    expect(wocQuoteCountdownSig(500, 1_000)).toBe('0');
    expect(wocQuoteCountdownSig(null, 1_000)).toBe('');
    expect(wocQuoteCountdownSig(undefined, 1_000)).toBe('');
  });
});
