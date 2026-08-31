// @vitest-environment happy-dom

// Behavior tests for the woc_trade controller's deps-bag seam
// (src/ui/hud/woc_trade/woc_trade_controller.ts): the one thing the extraction
// invented is Hud field access becoming closure indirection, so what is pinned
// here is the seam's contract, not the render markup (the pure model and the
// arm painter have their own suites). staged() must hand back the LIVE object
// (the unstage click mutates it in place), setStaged must replace it on the
// open and close transitions, and the completion report fires exactly once.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WocOfferView } from '../src/net/woc_market_sdk';
import { ITEMS } from '../src/sim/data';
import { bagQualityKey } from '../src/ui/bags_view';
import { itemDisplayName } from '../src/ui/entity_i18n';
import {
  WocTradeController,
  type WocTradeControllerDeps,
} from '../src/ui/hud/woc_trade/woc_trade_controller';
import { formatDateTime, t } from '../src/ui/i18n';
import { QUALITY_COLOR } from '../src/ui/icons';
import type { WocPendingOffer } from '../src/ui/trade_woc_view';
import { usdText } from '../src/ui/usd_text';
import type { WocMarketHooks } from '../src/ui/woc_market_window';
import type { IWorld } from '../src/world_api';

interface Rig {
  controller: WocTradeController;
  host: {
    staged: { items: { itemId: string; count: number }[]; copper: number };
    inventory: { itemId: string; count: number }[];
    tradeInfo: {
      otherName: string;
      myOffer: { items: { itemId: string; count: number }[]; copper: number };
      theirOffer: { items: { itemId: string; count: number }[]; copper: number };
      myAccepted: boolean;
      theirAccepted: boolean;
    } | null;
    logs: string[];
    pushed: number;
    bagRenders: number;
    setStagedCalls: number;
    balanceRefreshes: number;
    closed: number;
    cancelled: number;
    confirmed: number;
  };
}

function rig(marketHooks: WocMarketHooks | null = null): Rig {
  document.body.innerHTML =
    '<div id="trade-window" style="display:none"></div><div id="bags" style="display:none"></div>';
  const host: Rig['host'] = {
    staged: { items: [], copper: 0 },
    inventory: [],
    tradeInfo: null,
    logs: [],
    pushed: 0,
    bagRenders: 0,
    setStagedCalls: 0,
    balanceRefreshes: 0,
    closed: 0,
    cancelled: 0,
    confirmed: 0,
  };
  const world = {
    get tradeInfo() {
      return host.tradeInfo;
    },
    get inventory() {
      return host.inventory;
    },
    tradeConfirm: () => {
      host.confirmed++;
    },
    tradeCancel: () => {
      host.cancelled++;
    },
    tradeClose: () => {
      host.closed++;
    },
    tradeSetOffer: () => {},
  } as unknown as IWorld;
  const deps: WocTradeControllerDeps = {
    world: () => world,
    marketHooks: () => marketHooks,
    staged: () => host.staged,
    setStaged: (next) => {
      host.setStagedCalls++;
      host.staged = next;
    },
    pushTradeOffer: () => {
      host.pushed++;
    },
    refreshWocBalance: () => {
      host.balanceRefreshes++;
    },
    log: (text) => {
      host.logs.push(text);
    },
    itemIcon: () => '<span class="icon"></span>',
    attachTooltip: () => {},
    itemTooltip: () => '',
    renderBags: () => {
      host.bagRenders++;
    },
  };
  return { controller: new WocTradeController(deps), host };
}

function openTrade(r: Rig, myItems: { itemId: string; count: number }[] = []): void {
  r.host.tradeInfo = {
    otherName: 'Bree',
    myOffer: { items: myItems, copper: 0 },
    theirOffer: { items: [], copper: 0 },
    myAccepted: false,
    theirAccepted: false,
  };
  r.controller.updateTradeWindow();
}

/** A service offer row, typed as the REAL SDK view so the fixture cannot
 *  silently drift from the fields the controller actually reads (itemId feeds
 *  the completion line, settlementState the phase derivation). */
function offerRow(over: Partial<WocOfferView> = {}): WocOfferView {
  return {
    id: 7,
    status: 'pending',
    role: 'buyer',
    buyerName: 'Aldric',
    sellerName: 'Bree',
    itemId: null,
    usdCents: 100,
    listingId: null,
    buyerAccepted: false,
    sellerAccepted: false,
    listingStatus: null,
    listingResolution: null,
    settlementState: null,
    expiresAtMs: 9_999_999_999_999,
    ...over,
  };
}

function heldOffer(over: Partial<WocPendingOffer> = {}): WocPendingOffer {
  return {
    id: 7,
    usdCents: 100,
    tokens: null,
    role: 'buyer',
    phase: 'review',
    listingId: null,
    buyerAccepted: false,
    sellerAccepted: false,
    ...over,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Drain the microtask chain a floating poll promise walks through (the poll's
 *  then body awaits the estimate internally, so one turn is not enough; the
 *  deepest traced chain needs four turns, six leaves margin). Keep the count
 *  ahead of the deepest await chain: an under-drain shows up as the PRESENT
 *  mid-test assertions failing, not as a silent pass. */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

/** A controllable fake of the $WOC market hooks: recorders on every call the
 *  controller makes, with per-test overridable results so a test can hold a
 *  promise in flight or move the service-side truth between polls. */
function fakeHooks(): {
  hooks: WocMarketHooks;
  state: {
    offersResult: { ok: boolean; offers: WocOfferView[] };
    estimateImpl: (cents: number) => Promise<unknown>;
    buyNowImpl: () => Promise<unknown>;
    acceptOfferImpl: () => Promise<unknown>;
    createOfferImpl: () => Promise<unknown>;
    settlementQuoteImpl: () => Promise<unknown>;
    confirmSettlementImpl: () => Promise<unknown>;
    statusImpl: () => Promise<unknown>;
    meImpl: () => Promise<unknown>;
    tradePartnerImpl: () => Promise<unknown>;
    cancelListingImpl: () => Promise<unknown>;
    lastAcceptBody: Record<string, unknown> | null;
    lastCreateBody: Record<string, unknown> | null;
    stepUpSignatureRequired: boolean;
    stepUpOmitSignatureRequired: boolean;
    stepUpGate: Promise<void> | null;
    signMessageImpl: (message: string) => Promise<string>;
    signAndSendImpl: (tx: string) => Promise<string>;
    calls: {
      offers: number;
      estimates: number[];
      buyNows: number;
      acceptOffers: number[];
      stepUpChallenges: Record<string, unknown>[];
      signMessages: string[];
      signAndSends: string[];
      signAndSendArgs: [string, string | null][];
      signMessageArgs: [string, string][];
      createOffers: number;
      resolveOffers: [number, string][];
      statuses: number;
      cancelListings: number[];
    };
  };
} {
  const state = {
    offersResult: { ok: true, offers: [] as WocOfferView[] },
    estimateImpl: (_cents: number): Promise<unknown> =>
      Promise.resolve({ amount: { tokens: 800 }, split: null }),
    buyNowImpl: (): Promise<unknown> => Promise.resolve({ ok: false, code: 'woc_market.disabled' }),
    // The waiting branch by default: agreed, the other side has not yet.
    acceptOfferImpl: (): Promise<unknown> => Promise.resolve({ ok: true, listing: null }),
    createOfferImpl: (): Promise<unknown> =>
      Promise.resolve({ ok: false, code: 'woc_market.disabled' }),
    settlementQuoteImpl: (): Promise<unknown> =>
      Promise.resolve({ ok: false, code: 'woc_market.disabled' }),
    confirmSettlementImpl: (): Promise<unknown> =>
      Promise.resolve({ ok: false, code: 'woc_market.disabled' }),
    statusImpl: (): Promise<unknown> => Promise.resolve({ ok: false }),
    // Durable acceptance by default: the standing tests exercise the deal
    // machinery, not the consent row; the R9 tests override to pending.
    meImpl: (): Promise<unknown> =>
      Promise.resolve({ ok: true, activity: { termsAcceptedAtMs: 1 } }),
    // Null = the lookup answered "cannot be paid" (the historical default
    // here); the offer-face tests override with a verified partner, since a
    // REAL standing deal always has one (createOffer refuses otherwise).
    tradePartnerImpl: (): Promise<unknown> => Promise.resolve({ ok: true, partner: null }),
    cancelListingImpl: (): Promise<unknown> =>
      Promise.resolve({ ok: false, code: 'woc_market.disabled' }),
    lastAcceptBody: null as Record<string, unknown> | null,
    lastCreateBody: null as Record<string, unknown> | null,
    // The challenge answer. Default devsig (wallet-free); a test can flip
    // signatureRequired true and/or defer resolution to exercise the real
    // wallet arm and the in-flight face.
    stepUpSignatureRequired: false as boolean,
    // When true the challenge answer OMITS signatureRequired entirely, so the
    // absent-means-sign contract can be exercised behaviorally.
    stepUpOmitSignatureRequired: false as boolean,
    stepUpGate: null as null | Promise<void>,
    // The wallet message-signer. Default resolves; a test can reject it (a
    // decline) or count calls.
    signMessageImpl: (_message: string): Promise<string> => Promise.resolve('walletsig'),
    // The transaction signer. Default resolves; a test can count calls to prove
    // the pay path drove the wallet rather than the devsig short-circuit.
    signAndSendImpl: (_tx: string): Promise<string> => Promise.resolve('walletTxSig'),
    calls: {
      offers: 0,
      estimates: [] as number[],
      buyNows: 0,
      acceptOffers: [] as number[],
      stepUpChallenges: [] as Record<string, unknown>[],
      signMessages: [] as string[],
      signAndSends: [] as string[],
      signAndSendArgs: [] as [string, string | null][],
      signMessageArgs: [] as [string, string][],
      createOffers: 0,
      resolveOffers: [] as [number, string][],
      statuses: 0,
      cancelListings: [] as number[],
    },
  };
  const hooks = {
    client: {
      offers: () => {
        state.calls.offers++;
        return Promise.resolve(state.offersResult);
      },
      estimate: (cents: number) => {
        state.calls.estimates.push(cents);
        return state.estimateImpl(cents);
      },
      buyNow: () => {
        state.calls.buyNows++;
        return state.buyNowImpl();
      },
      // The step-up mint the SELLER accept runs first (B6/R1). The devsig
      // answer keeps these behavioral tests wallet-free while still proving
      // the proof rides the accept body (nonce recorded per call).
      stepUpChallenge: async (req: Record<string, unknown>) => {
        state.calls.stepUpChallenges.push(req);
        // Optional gate to hold the mint open (the in-flight face / re-entrancy
        // tests await this before resolving).
        if (state.stepUpGate) await state.stepUpGate;
        const nonce = `nonce-${state.calls.stepUpChallenges.length}`;
        return {
          ok: true,
          challenge: {
            nonce,
            message: `step-up message ${nonce}`,
            expiresAtMs: 4_000_000_000_000,
            // An older server may not send the field at all; the client must
            // then default to requiring a signature, never skip it.
            ...(state.stepUpOmitSignatureRequired
              ? {}
              : { signatureRequired: state.stepUpSignatureRequired }),
          },
        };
      },
      acceptOffer: (id: number, body: Record<string, unknown>) => {
        state.calls.acceptOffers.push(id);
        state.lastAcceptBody = body;
        return state.acceptOfferImpl();
      },
      resolveOffer: (id: number, action: string) => {
        state.calls.resolveOffers.push([id, action]);
        return Promise.resolve({ ok: true });
      },
      // The realm floor for the courtesy below-min hint, fetched once at
      // trade open. ok:false by default so existing cases exercise the
      // unknown-floor arm (unknown never blocks); a test overrides statusImpl
      // to drive the hint.
      status: () => {
        state.calls.statuses++;
        return state.statusImpl();
      },
      me: () => state.meImpl(),
      cancelListing: (id: number) => {
        state.calls.cancelListings.push(id);
        return state.cancelListingImpl();
      },
      settlementQuote: () => state.settlementQuoteImpl(),
      confirmSettlement: () => state.confirmSettlementImpl(),
      createOffer: (body: Record<string, unknown>) => {
        state.calls.createOffers++;
        state.lastCreateBody = body;
        return state.createOfferImpl();
      },
      tradePartner: () => state.tradePartnerImpl(),
    },
    characterId: () => 1,
    walletLinked: () => true,
    signAndSendTransactionBase64: (tx: string, reference: string | null) => {
      state.calls.signAndSends.push(tx);
      state.calls.signAndSendArgs.push([tx, reference]);
      return state.signAndSendImpl(tx);
    },
    signMessageBase58: (message: string, stepUpNonce: string) => {
      state.calls.signMessages.push(message);
      state.calls.signMessageArgs.push([message, stepUpNonce]);
      return state.signMessageImpl(message);
    },
  } as unknown as WocMarketHooks;
  return { hooks, state };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the open transition', () => {
  it('shows the window, resets the staged offer through setStaged, and opens the bags', () => {
    const r = rig();
    r.host.staged = { items: [{ itemId: 'wolf_fang', count: 3 }], copper: 500 };
    openTrade(r);
    expect(document.querySelector<HTMLElement>('#trade-window')?.style.display).toBe('block');
    expect(r.host.setStagedCalls).toBe(1);
    expect(r.host.staged).toEqual({ items: [], copper: 0 });
    expect(r.host.bagRenders).toBe(1);
    expect(document.querySelector<HTMLElement>('#bags')?.style.display).toBe('flex');
    expect(document.querySelector('#trade-window .trade-cols')).not.toBeNull();
  });

  it('repaints only when the signature moves: an identical second pass leaves the subtree alone', () => {
    const r = rig();
    openTrade(r);
    const el = document.querySelector<HTMLElement>('#trade-window');
    el?.firstElementChild?.setAttribute('data-probe', 'survives');
    r.controller.updateTradeWindow();
    expect(el?.querySelector('[data-probe]')).not.toBeNull();
  });
});

describe('an unusable offer expiry falls back to the untimed line', () => {
  // Driven through the real send path, not asserted about language constants:
  // each unusable stamp must take the UNTIMED branch, and the usable one must
  // take the timed branch, with nothing thrown on the way (formatDateTime
  // raises RangeError on NaN, so a wrong guard here takes the line down rather
  // than printing something odd).
  const send = async (expiresAtMs: unknown): Promise<{ logs: string[] }> => {
    const h = fakeHooks();
    h.state.createOfferImpl = () =>
      Promise.resolve({ ok: true, offer: { id: 11, usdCents: 250, expiresAtMs } });
    const r = rig(h.hooks);
    r.host.tradeInfo = {
      otherPid: 2,
      otherName: 'Borin',
      myOffer: { items: [], copper: 0 },
      theirOffer: { items: [{ itemId: 'worn_sword', count: 1 }], copper: 0 },
      myAccepted: false,
      theirAccepted: false,
    } as unknown as typeof r.host.tradeInfo;
    const c = r.controller as unknown as {
      wocTradeMode: 'gold' | 'woc';
      wocTradeUsdCents: number | null;
      wocTradePartner: { name: string; walletVerified: boolean } | null;
      wocTradePartnerResolved: boolean;
      wocTradeTermsChecked: boolean;
      sendWocTradeOffer(otherName: string): Promise<void>;
    };
    c.wocTradeMode = 'woc';
    c.wocTradeUsdCents = 250;
    c.wocTradePartner = { name: 'Borin', walletVerified: true };
    c.wocTradePartnerResolved = true;
    c.wocTradeTermsChecked = true;
    await c.sendWocTradeOffer('Borin');
    return { logs: r.host.logs };
  };

  const UNTIMED = t('hudChrome.trade.woc.offerSent', { name: 'Borin' });

  it('takes the untimed line for null, undefined, NaN and an epoch-0 stamp', async () => {
    // null is what the wire really delivers for a missing stamp (JSON writes a
    // server-side NaN as null); NaN is the value a date projection yields and
    // the one a typeof test lets through; 0 is absence written as a number,
    // which a bare finite check would print as a 1970 deadline.
    // Infinity and a negative stamp are what make this decisive against a plain
    // truthy guard: every falsy value alone would pass one. Infinity formats to
    // a RangeError, a negative stamp to a pre-1970 deadline.
    for (const value of [null, undefined, Number.NaN, 0, Number.POSITIVE_INFINITY, -86_400_000]) {
      const { logs } = await send(value);
      expect(logs.at(-1), `expiry ${String(value)} must read as untimed`).toBe(UNTIMED);
    }
  });

  it('takes the timed line for a real stamp', async () => {
    const at = Date.UTC(2026, 7, 19, 2, 28);
    const { logs } = await send(at);
    expect(logs.at(-1)).toBe(
      t('hudChrome.trade.woc.offerSentUntil', {
        name: 'Borin',
        time: formatDateTime(at, { timeStyle: 'short' }),
      }),
    );
    expect(logs.at(-1)).not.toBe(UNTIMED);
  });
});

describe('a staged item renders its name in the quality colour', () => {
  it('carries an inline colour off QUALITY_COLOR, not the icon-frame class', () => {
    // The regression this pins: the row once wrote the .q-<rung> FRAME class
    // onto a bare text span. That family carries border-color plus an epic and
    // legendary glow and no text colour at all, so an epic name rendered in the
    // inherited grey behind a stray halo, and a rare name showed nothing. Every
    // sibling row family (bags, bank, the Exchange's own rows) writes an inline
    // colour off the same map, which is what is asserted here.
    const epic = Object.entries(ITEMS).find(([, def]) => bagQualityKey(def) === 'epic');
    expect(epic, 'the content table still carries an epic item to render').toBeDefined();
    const [epicId] = epic ?? ['', null];
    const r = rig();
    openTrade(r, [{ itemId: epicId, count: 1 }]);
    r.controller.updateTradeWindow();
    const row = document.querySelector<HTMLElement>('#trade-window .trade-item');
    expect(row, 'the staged row renders').not.toBeNull();
    const span = row?.querySelector<HTMLElement>('span[style*="color"]') ?? null;
    expect(span, 'the name span carries an inline colour').not.toBeNull();
    expect(span?.style.color.replace(/\s/g, '')).toBe(QUALITY_COLOR.epic);
    expect(span?.textContent).toBe(itemDisplayName(ITEMS[epicId]));
    // And the frame class is NOT what carries it: a rung class on the text span
    // would paint the halo again.
    expect(row?.innerHTML).not.toContain('class="q-');
  });
});

describe('the unstage click mutates the LIVE staged object', () => {
  it('decrements the very array the host holds and pushes the offer', () => {
    const r = rig();
    // Open with the wolf_fang already in the sim's own-side offer (the cleaned
    // table the row renders from), avoiding a non-null assertion on tradeInfo.
    openTrade(r, [{ itemId: 'wolf_fang', count: 2 }]);
    // Stage after the open reset, exactly as the bags window does: by writing
    // into the same object staged() returns.
    const live = r.host.staged;
    live.items.push({ itemId: 'wolf_fang', count: 2 });
    r.controller.updateTradeWindow();
    const mine = document.querySelector<HTMLElement>('#trade-window .trade-item.mine');
    expect(mine).not.toBeNull();
    mine?.click();
    // The click handler must have walked through staged() to the live array:
    // a defensive copy would leave the host's copy untouched and this red.
    expect(live.items).toEqual([{ itemId: 'wolf_fang', count: 1 }]);
    expect(r.host.staged).toBe(live);
    expect(r.host.pushed).toBe(1);
  });
});

describe('the close transition', () => {
  it('hides the window, resets the staged offer again, and repaints the open bags', () => {
    const r = rig();
    openTrade(r);
    const rendersAfterOpen = r.host.bagRenders;
    r.host.staged.items.push({ itemId: 'wolf_fang', count: 1 });
    r.host.tradeInfo = null;
    r.controller.updateTradeWindow();
    expect(document.querySelector<HTMLElement>('#trade-window')?.style.display).toBe('none');
    expect(r.host.setStagedCalls).toBe(2);
    expect(r.host.staged).toEqual({ items: [], copper: 0 });
    // The bags stayed open through the trade, so the close repaints them.
    expect(r.host.bagRenders).toBe(rendersAfterOpen + 1);
  });
});

type FinishRow = { id: number; usdCents: number; role: 'buyer' | 'seller'; itemId: string | null };

function finishOf(r: Rig): (row: FinishRow) => void {
  return (
    r.controller as unknown as { finishWocTrade: (input: FinishRow) => void }
  ).finishWocTrade.bind(r.controller);
}

describe('the completion report', () => {
  it('fires exactly once per offer id: one line, one balance refresh, one close', () => {
    const r = rig();
    const row: FinishRow = { id: 5, usdCents: 100, role: 'seller', itemId: null };
    const finish = finishOf(r);
    (r.controller as unknown as { wocTradeSplit: unknown }).wocTradeSplit = {
      sellerCents: 90,
      burnCents: 3,
      treasuryCents: 7,
    };
    finish(row);
    finish(row);
    expect(r.host.logs).toHaveLength(1);
    expect(r.host.balanceRefreshes).toBe(1);
    expect(r.host.closed).toBe(1);
    // The settled deal's split dies at the finish clear site too.
    expect((r.controller as unknown as { wocTradeSplit: unknown }).wocTradeSplit).toBeNull();
    // CLOSE, never cancel: a cancel would contradict the payment line just
    // printed, and the sale succeeded.
    expect(r.host.cancelled).toBe(0);
    // A different offer id reports again: the retired set is per id, not global.
    finish({ ...row, id: 6 });
    expect(r.host.logs).toHaveLength(2);
  });

  it('names each side its own news: the seller was PAID, the buyer SPENT', () => {
    const r = rig();
    const finish = finishOf(r);
    finish({ id: 5, usdCents: 100, role: 'seller', itemId: null });
    finish({ id: 6, usdCents: 100, role: 'buyer', itemId: null });
    // The keys are literals HERE, so swapping the role selection in
    // finishWocTrade cannot satisfy both lines.
    expect(r.host.logs[0]).toBe(
      t('hudChrome.trade.woc.paidSeller', { price: usdText(100), item: '' }),
    );
    expect(r.host.logs[1]).toBe(
      t('hudChrome.trade.woc.paidBuyer', { price: usdText(100), item: '' }),
    );
    expect(r.host.logs[0]).not.toBe(r.host.logs[1]);
    // One literal price so the formatter half is not a self-comparison.
    expect(r.host.logs[0]).toContain('$1.00');
  });

  it('resolves a known item id to its display name and keeps a RAW unknown id (R34)', () => {
    const r = rig();
    const finish = finishOf(r);
    finish({ id: 7, usdCents: 100, role: 'seller', itemId: 'wolf_fang' });
    const name = itemDisplayName(ITEMS.wolf_fang);
    expect(name.length).toBeGreaterThan(0);
    expect(r.host.logs[0]).toContain(name);
    // A prototype-key id must take the unknown arm without throwing, and the
    // line names the raw id rather than a blank: a message naming nothing is
    // worse than one the player can at least search.
    finish({ id: 8, usdCents: 100, role: 'seller', itemId: 'constructor' });
    expect(r.host.logs[1]).toContain('constructor');
  });
});

describe('the standing-offer poll ($WOC hooks attached)', () => {
  it('reads the REST rail at most once per 2s window, however often the band repaints', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const h = fakeHooks();
    const r = rig(h.hooks);
    openTrade(r);
    r.controller.updateTradeWindow();
    r.controller.updateTradeWindow();
    // Three passes inside one window: one REST read. The poll runs before the
    // repaint signature, so every pass reaches it; the wall clock is the gate.
    expect(h.state.calls.offers).toBe(1);
    vi.setSystemTime(1_002_000);
    r.controller.updateTradeWindow();
    expect(h.state.calls.offers).toBe(2);
  });

  it('adopts the standing row into the money row and CLEARS it when the row vanishes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const h = fakeHooks();
    h.state.offersResult = { ok: true, offers: [offerRow()] };
    const r = rig(h.hooks);
    openTrade(r);
    await flushAsync();
    r.controller.updateTradeWindow();
    // Side-scoped: a buyer-role offer reads in MY money row (first column),
    // never the counterparty's. The split is a shipped-bug surface.
    expect(
      document.querySelector('#trade-window .trade-col:first-child .trade-woc-money'),
    ).not.toBeNull();
    expect(
      document.querySelector('#trade-window .trade-col:last-child .trade-woc-money'),
    ).toBeNull();
    // The other side withdrew: the service read no longer returns the row. A
    // held offer that never clears paints a deal that no longer exists.
    h.state.offersResult = { ok: true, offers: [] };
    vi.setSystemTime(1_002_000);
    r.controller.updateTradeWindow();
    await flushAsync();
    r.controller.updateTradeWindow();
    expect(document.querySelector('#trade-window .trade-woc-money')).toBeNull();
  });

  it("a seller-role offer reads in THEIR money row, not the seller's own", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const h = fakeHooks();
    // The seller's standing offer: the selector matches sellers by buyerName.
    h.state.offersResult = { ok: true, offers: [offerRow({ role: 'seller', buyerName: 'Bree' })] };
    const r = rig(h.hooks);
    openTrade(r);
    await flushAsync();
    r.controller.updateTradeWindow();
    expect(
      document.querySelector('#trade-window .trade-col:last-child .trade-woc-money'),
    ).not.toBeNull();
    expect(
      document.querySelector('#trade-window .trade-col:first-child .trade-woc-money'),
    ).toBeNull();
  });

  it('the adoption estimate stores the fee split, not only the tokens', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const h = fakeHooks();
    h.state.estimateImpl = () =>
      Promise.resolve({
        amount: { tokens: 800 },
        split: { sellerCents: 90, burnCents: 3, treasuryCents: 7 },
      });
    h.state.offersResult = { ok: true, offers: [offerRow()] };
    const r = rig(h.hooks);
    openTrade(r);
    await flushAsync();
    r.controller.updateTradeWindow();
    await flushAsync();
    // No compose-time estimate ever ran here (nothing was typed): the split
    // must ride the ADOPTION estimate, or a window reopened mid-deal shows
    // blank Fee and You receive lines on the $WOC tab.
    const c = r.controller as unknown as { wocTradeSplit: unknown };
    expect(c.wocTradeSplit).toEqual({ sellerCents: 90, burnCents: 3, treasuryCents: 7 });
  });

  it('a slower earlier estimate never clobbers a newer answer (last write wins)', async () => {
    vi.useFakeTimers();
    const h = fakeHooks();
    const stale = deferred<unknown>();
    const fresh = deferred<unknown>();
    const queue = [stale.promise, fresh.promise];
    h.state.estimateImpl = () => queue.shift() ?? Promise.resolve(null);
    const r = rig(h.hooks);
    openTrade(r);
    const c = r.controller as unknown as {
      onWocTradePrice(cents: number | null): void;
      wocTradeTokens: number | null;
    };
    c.onWocTradePrice(100);
    await vi.advanceTimersByTimeAsync(350);
    c.onWocTradePrice(200);
    await vi.advanceTimersByTimeAsync(350);
    expect(h.state.calls.estimates).toEqual([100, 200]);
    fresh.resolve({ amount: { tokens: 222 }, split: null });
    await flushAsync();
    // The stale answer lands LATE: the sequence guard must drop it.
    stale.resolve({ amount: { tokens: 111 }, split: null });
    await flushAsync();
    expect(c.wocTradeTokens).toBe(222);
  });
});

describe('the payment re-entry guard', () => {
  it('one buy-now lock per purchase: a second Pay mid-flight is a no-op', async () => {
    const h = fakeHooks();
    const buy = deferred<unknown>();
    h.state.buyNowImpl = () => buy.promise;
    const r = rig(h.hooks);
    const c = r.controller as unknown as {
      wocTradeOffer: WocPendingOffer | null;
      payWocTradeOffer(): Promise<void>;
    };
    c.wocTradeOffer = heldOffer({
      role: 'buyer',
      phase: 'awaiting_payment',
      listingId: 41,
      buyerAccepted: true,
      sellerAccepted: true,
    });
    const first = c.payWocTradeOffer();
    const second = c.payWocTradeOffer();
    buy.resolve({ ok: false, code: 'woc_market.disabled' });
    await Promise.all([first, second]);
    expect(h.state.calls.buyNows).toBe(1);
  });
});

describe('the two window buttons', () => {
  it('accept routes by the standing offer AT CLICK TIME: sim confirm only when none', () => {
    const r = rig();
    openTrade(r);
    const accept = [
      ...document.querySelectorAll<HTMLButtonElement>('#trade-window button.btn'),
    ].find((b) => b.textContent === t('hud.trade.accept'));
    expect(accept).toBeTruthy();
    accept?.click();
    expect(r.host.confirmed).toBe(1);
    // A $WOC offer now stands: the sim confirm must NEVER run for it (it would
    // swap the goods for nothing); acceptance is recorded on the offer instead.
    (r.controller as unknown as { wocTradeOffer: WocPendingOffer | null }).wocTradeOffer =
      heldOffer({ role: 'seller' });
    accept?.click();
    expect(r.host.confirmed).toBe(1);
  });

  it('with hooks attached, the standing-offer accept really reaches the service', async () => {
    // The other half of the routing claim: the click must land on
    // acceptOffer, not merely avoid the sim confirm. A buyer brings only
    // money, so no staged item is needed.
    const h = fakeHooks();
    const r = rig(h.hooks);
    openTrade(r);
    (r.controller as unknown as { wocTradeOffer: WocPendingOffer | null }).wocTradeOffer =
      heldOffer({ role: 'buyer' });
    const accept = [
      ...document.querySelectorAll<HTMLButtonElement>('#trade-window button.btn'),
    ].find((b) => b.textContent === t('hud.trade.accept'));
    accept?.click();
    await flushAsync();
    expect(h.state.calls.acceptOffers).toEqual([7]);
    // The BUYER accept is bearer-only by role: no step-up mint, no proof
    // field (their money path signs its own payment later).
    expect(h.state.calls.stepUpChallenges).toEqual([]);
    expect(Object.hasOwn(h.state.lastAcceptBody ?? {}, 'stepUp')).toBe(false);
    expect(r.host.confirmed).toBe(0);
  });

  it('the cancel button routes to sim.tradeCancel, and only there', () => {
    const r = rig();
    openTrade(r);
    const cancel = [
      ...document.querySelectorAll<HTMLButtonElement>('#trade-window button.btn'),
    ].find((b) => b.textContent === t('hud.trade.cancel'));
    expect(cancel).toBeTruthy();
    cancel?.click();
    expect(r.host.cancelled).toBe(1);
    expect(r.host.closed).toBe(0);
    expect(r.host.confirmed).toBe(0);
  });
});

describe('the coin inputs', () => {
  it('a change writes the combined copper into the LIVE staged object', () => {
    const r = rig();
    openTrade(r);
    // Captured AFTER the open reset: the same object staged() returns.
    const live = r.host.staged;
    const g = document.querySelector<HTMLInputElement>('#trade-g');
    const s = document.querySelector<HTMLInputElement>('#trade-s');
    const c = document.querySelector<HTMLInputElement>('#trade-c');
    expect(g && s && c).toBeTruthy();
    if (!g || !s || !c) return;
    g.value = '5';
    s.value = '32';
    c.value = '45';
    g.dispatchEvent(new Event('change'));
    // A copy anywhere on the staged() path loses this write silently.
    expect(live.copper).toBe(5 * 10000 + 32 * 100 + 45);
    expect(r.host.staged).toBe(live);
    expect(r.host.pushed).toBe(1);
  });
});

describe('the escrow-failed retry face', () => {
  it('both agreed with NO listing reopens Accept; an escrowed deal hides it', () => {
    const h = fakeHooks();
    const r = rig(h.hooks);
    openTrade(r);
    const c = r.controller as unknown as { wocTradeOffer: WocPendingOffer | null };
    // The server reopened the offer after a failed escrow: both accepted, no
    // listing. A "Waiting" dead end here had no exit; the button must be live.
    c.wocTradeOffer = heldOffer({
      role: 'seller',
      tokens: 800,
      buyerAccepted: true,
      sellerAccepted: true,
    });
    r.controller.updateTradeWindow();
    const accept = [
      ...document.querySelectorAll<HTMLButtonElement>('#trade-window button.btn'),
    ].find((b) => b.textContent === t('hud.trade.accept'));
    expect(accept).toBeTruthy();
    expect(accept?.disabled).toBe(false);
    expect(accept?.hidden).toBe(false);
    // Counter-shape: the goods escrowed (a listing exists, the phase moved), so
    // there is nothing left to accept and the button HIDES. Located by
    // position (the accept button is appended first), because its text reads
    // Waiting here: a text-based finder would pass on the label alone even if
    // the hidden flag were dropped.
    c.wocTradeOffer = {
      ...(c.wocTradeOffer as WocPendingOffer),
      listingId: 41,
      phase: 'awaiting_payment',
    };
    r.controller.updateTradeWindow();
    // The two window actions live in their own row (the sheet pins it on
    // touch); still exactly two, Accept first.
    const buttons = document.querySelectorAll<HTMLButtonElement>(
      '#trade-window > .trade-actions > button.btn',
    );
    expect(buttons.length).toBe(2);
    expect(buttons[0]?.hidden).toBe(true);
    expect(buttons[0]?.disabled).toBe(true);
  });
});

describe('the accept request body (seller escrow)', () => {
  it('escrows the STAGED copy by its inventory index, or refuses when unfindable', async () => {
    const h = fakeHooks();
    const r = rig(h.hooks);
    // No openTrade here on purpose: the accept path reads staged, inventory,
    // the held offer and the hooks, never the window, and the open poll's
    // empty-result callback would clear the planted offer mid-test.
    // The staged copy sits at inventory index 1: sending the staged POSITION
    // instead read as 0 and escrowed whatever sat first in the bags, which
    // refused the sale at the very last step (the shipped shape).
    r.host.staged.items.push({ itemId: 'worn_sword', count: 1 });
    r.host.inventory.push({ itemId: 'boar_hide', count: 3 }, { itemId: 'worn_sword', count: 1 });
    const c = r.controller as unknown as {
      wocTradeOffer: WocPendingOffer | null;
      acceptWocTradeOffer(): Promise<void>;
    };
    c.wocTradeOffer = heldOffer({ role: 'seller' });
    await c.acceptWocTradeOffer();
    expect(h.state.calls.acceptOffers).toEqual([7]);
    expect(h.state.lastAcceptBody).toMatchObject({
      characterId: 1,
      itemIndex: 1,
      itemId: 'worn_sword',
      // The seller's proof (B6/R1): minted first, devsig under the fake's
      // explicit signatureRequired false, riding the same body.
      stepUp: { nonce: 'nonce-1', signature: 'devsig:nonce-1' },
    });
    expect(h.state.calls.stepUpChallenges).toEqual([
      { operation: 'accept_directed_offer', offerId: 7 },
    ]);
    // The refusal arm: the staged copy is no longer in the bags. Not-found is
    // NOT index 0; refusing beats escrowing the wrong item.
    h.state.calls.acceptOffers.length = 0;
    r.host.inventory.length = 0;
    await c.acceptWocTradeOffer();
    expect(h.state.calls.acceptOffers).toEqual([]);
    expect(r.host.logs.at(-1)).toBe(t('hudChrome.trade.woc.hintAcceptNeedsItem'));
  });

  it('signs the SERVER message on the real-wallet arm, and a DECLINE sends no accept (B6/R1)', async () => {
    // Coverage's untested branch: the fake defaults devsig, so the real
    // signMessageBase58 path never ran. Flip signatureRequired true and reject
    // the sign: the accept must NOT be sent, and the decline copy shows.
    const h = fakeHooks();
    h.state.stepUpSignatureRequired = true;
    h.state.signMessageImpl = () => Promise.reject(new Error('user declined in wallet'));
    const r = rig(h.hooks);
    r.host.staged.items.push({ itemId: 'worn_sword', count: 1 });
    r.host.inventory.push({ itemId: 'worn_sword', count: 1 });
    const c = r.controller as unknown as {
      wocTradeOffer: WocPendingOffer | null;
      acceptWocTradeOffer(): Promise<void>;
    };
    c.wocTradeOffer = heldOffer({ role: 'seller' });
    await c.acceptWocTradeOffer();
    // The wallet was asked to sign the exact server message, WITH the
    // challenge nonce the desktop arm resolves the stored message by (both
    // parameters are strings, so only this runtime pin catches a swap).
    expect(h.state.calls.signMessages).toEqual(['step-up message nonce-1']);
    expect(h.state.calls.signMessageArgs).toEqual([['step-up message nonce-1', 'nonce-1']]);
    // The decline aborts BEFORE acceptOffer: no custody moves on a refused sign.
    expect(h.state.calls.acceptOffers).toEqual([]);
    // The player line is the CLASSIFIED cancel copy, never the wallet's raw
    // prose (the wallet-bridge i18n medium).
    expect(r.host.logs.at(-1)).toBe(t('hudChrome.walletBridge.cancelled'));
    expect(r.host.logs.join('\n')).not.toContain('user declined in wallet');
  });

  it('a message-less sign rejection falls back to the listing decline copy', async () => {
    // The bridge usually throws player-facing text, but a message-less throw
    // must land on the catalog fallback, NOT the empty string; behaviorally
    // pinned since the source scan cannot tell the two branches apart.
    const h = fakeHooks();
    h.state.stepUpSignatureRequired = true;
    h.state.signMessageImpl = () => Promise.reject(new Error(''));
    const r = rig(h.hooks);
    r.host.staged.items.push({ itemId: 'worn_sword', count: 1 });
    r.host.inventory.push({ itemId: 'worn_sword', count: 1 });
    const c = r.controller as unknown as {
      wocTradeOffer: WocPendingOffer | null;
      acceptWocTradeOffer(): Promise<void>;
    };
    c.wocTradeOffer = heldOffer({ role: 'seller' });
    await c.acceptWocTradeOffer();
    expect(h.state.calls.acceptOffers).toEqual([]);
    expect(r.host.logs.at(-1)).toBe(t('hudChrome.wocMarket.signFailedConfirm'));
  });

  it('a real signature reaches the accept body as the proof', async () => {
    const h = fakeHooks();
    h.state.stepUpSignatureRequired = true;
    h.state.signMessageImpl = () => Promise.resolve('REALSIG');
    const r = rig(h.hooks);
    r.host.staged.items.push({ itemId: 'worn_sword', count: 1 });
    r.host.inventory.push({ itemId: 'worn_sword', count: 1 });
    const c = r.controller as unknown as {
      wocTradeOffer: WocPendingOffer | null;
      acceptWocTradeOffer(): Promise<void>;
    };
    c.wocTradeOffer = heldOffer({ role: 'seller' });
    await c.acceptWocTradeOffer();
    expect(h.state.lastAcceptBody).toMatchObject({
      stepUp: { nonce: 'nonce-1', signature: 'REALSIG' },
    });
  });

  it('a double-click during the wallet round trip mints exactly one challenge (re-entrancy)', async () => {
    // Frontend blocking: the Accept button stays labeled Accept during the
    // multi-second wallet handoff; without the guard a second click mints a
    // second challenge and races two acceptances into escrow.
    const h = fakeHooks();
    h.state.stepUpSignatureRequired = true;
    let releaseSign!: () => void;
    h.state.signMessageImpl = () =>
      new Promise<string>((resolve) => {
        releaseSign = () => resolve('REALSIG');
      });
    const r = rig(h.hooks);
    r.host.staged.items.push({ itemId: 'worn_sword', count: 1 });
    r.host.inventory.push({ itemId: 'worn_sword', count: 1 });
    const c = r.controller as unknown as {
      wocTradeOffer: WocPendingOffer | null;
      acceptWocTradeOffer(): Promise<void>;
    };
    c.wocTradeOffer = heldOffer({ role: 'seller' });
    // First click: parks awaiting the wallet signature.
    const first = c.acceptWocTradeOffer();
    await flushAsync();
    // Second click while the first is outstanding: the guard returns early. Do
    // NOT await it (without the guard it would park on the same deferred sign
    // and the test would fail by timeout instead of by this assertion); the
    // guard makes it resolve synchronously, and the mint count is the pin.
    void c.acceptWocTradeOffer();
    await flushAsync();
    expect(h.state.calls.stepUpChallenges, 'exactly one mint').toHaveLength(1);
    // Release the wallet and let the first click finish.
    releaseSign();
    await first;
    expect(h.state.calls.acceptOffers, 'exactly one accept').toEqual([7]);
  });

  it('disables the Accept button while the seller acceptance is in flight, and the flag is in the repaint signature', () => {
    const h = fakeHooks();
    const r = rig(h.hooks);
    const c = r.controller as unknown as {
      wocTradeOffer: WocPendingOffer | null;
      wocTradeAccepting: boolean;
      wocTradeOfferPolledAtMs: number;
    };
    openTrade(r, [{ itemId: 'worn_sword', count: 1 }]);
    // Disable the REST poll for the test (a far-future stamp keeps it throttled)
    // so the planted standing offer is not cleared by an empty poll result.
    c.wocTradeOfferPolledAtMs = Date.now() + 1_000_000;
    c.wocTradeOffer = heldOffer({ role: 'seller' });
    // Commit the signature with the offer present and the flag DOWN: the button
    // reads Accept, enabled (production's steady state before the click).
    r.controller.updateTradeWindow();
    const before = [
      ...document.querySelectorAll<HTMLButtonElement>('#trade-window button.btn'),
    ].find((b) => b.textContent === t('hud.trade.accept'));
    expect(before, 'the button reads Accept before the round trip').toBeTruthy();
    expect(before?.disabled).toBe(false);
    // Flip ONLY the in-flight flag and repaint: because wocTradeAccepting is in
    // the signature, the render is NOT elided (the whole point of the fix), and
    // the button flips to a disabled Waiting.
    c.wocTradeAccepting = true;
    r.controller.updateTradeWindow();
    const during = [
      ...document.querySelectorAll<HTMLButtonElement>('#trade-window button.btn'),
    ].find((b) => b.textContent === t('hud.trade.waiting'));
    expect(during, 'the flag flip repainted a disabled Waiting button').toBeTruthy();
    expect(during?.disabled).toBe(true);
    // And back down: the finally's reset repaints an actionable button again.
    c.wocTradeAccepting = false;
    r.controller.updateTradeWindow();
    const after = [
      ...document.querySelectorAll<HTMLButtonElement>('#trade-window button.btn'),
    ].find((b) => b.textContent === t('hud.trade.accept'));
    expect(after, 'the button is not stuck at Waiting after the round trip').toBeTruthy();
    expect(after?.disabled).toBe(false);
  });

  it('the seller accept flips the in-flight flag across its real wallet round trip', async () => {
    // The behavioral half: the flag is true while the wallet sign is
    // outstanding and false once it settles (drives the face above).
    const h = fakeHooks();
    h.state.stepUpSignatureRequired = true;
    let releaseSign!: () => void;
    h.state.signMessageImpl = () =>
      new Promise<string>((resolve) => {
        releaseSign = () => resolve('REALSIG');
      });
    const r = rig(h.hooks);
    r.host.staged.items.push({ itemId: 'worn_sword', count: 1 });
    r.host.inventory.push({ itemId: 'worn_sword', count: 1 });
    const c = r.controller as unknown as {
      wocTradeOffer: WocPendingOffer | null;
      wocTradeAccepting: boolean;
      acceptWocTradeOffer(): Promise<void>;
    };
    c.wocTradeOffer = heldOffer({ role: 'seller' });
    const started = c.acceptWocTradeOffer();
    await flushAsync();
    expect(c.wocTradeAccepting, 'true while the wallet sign is outstanding').toBe(true);
    releaseSign();
    await started;
    expect(c.wocTradeAccepting, 'false once it settles').toBe(false);
  });

  it('resets BOTH in-flight guards on close, so a dismissed wallet does not stick the next trade', () => {
    const h = fakeHooks();
    const r = rig(h.hooks);
    const c = r.controller as unknown as { wocTradeAccepting: boolean; wocTradePaying: boolean };
    // Open the window first (the close-reset lives in the was-open branch), then
    // simulate BOTH wallet round trips left in flight (desktop signer has no
    // timeout): the accept guard AND the pay guard must clear on close, or the
    // next trade is stuck on whichever one was left set.
    openTrade(r);
    c.wocTradeAccepting = true;
    c.wocTradePaying = true;
    r.host.tradeInfo = null;
    r.controller.updateTradeWindow();
    expect(c.wocTradeAccepting, 'closing the window abandons the accept round trip').toBe(false);
    expect(c.wocTradePaying, 'closing the window abandons the pay round trip').toBe(false);
  });

  it('an absent signatureRequired still drives the wallet (absent means sign)', async () => {
    // The SDK field is optional, so a server that stops sending it must not be
    // read as permission to skip signing. The other tests always set the flag
    // explicitly, so this is the only behavioral cover of the absent case.
    const h = fakeHooks();
    h.state.stepUpOmitSignatureRequired = true;
    const r = rig(h.hooks);
    r.host.staged.items.push({ itemId: 'worn_sword', count: 1 });
    r.host.inventory.push({ itemId: 'worn_sword', count: 1 });
    const c = r.controller as unknown as {
      wocTradeOffer: WocPendingOffer | null;
      acceptWocTradeOffer(): Promise<void>;
    };
    c.wocTradeOffer = heldOffer({ role: 'seller' });
    await c.acceptWocTradeOffer();
    // The wallet WAS driven: a devsig short-circuit would have left this empty.
    expect(h.state.calls.signMessages).toEqual(['step-up message nonce-1']);
    expect(h.state.lastAcceptBody?.stepUp).toMatchObject({
      nonce: 'nonce-1',
      signature: 'walletsig',
    });
  });

  it('refuses a stale accept over a MULTI-SLOT staged table with the one_item WHY', async () => {
    // This belt is the accept-time enforcement of the whole-table one_item
    // rule (the trade window's Accept button never consults the model):
    // resolving an ambiguous first-eligible slot could only turn into a
    // server-side item_mismatch, so the send path refuses locally instead.
    // The HUD-local list holds ONE slot while the sim's cleaned offer holds
    // two, so this also pins that the belt reads the AUTHORITATIVE list.
    const h = fakeHooks();
    const r = rig(h.hooks);
    r.host.staged.items.push({ itemId: 'worn_sword', count: 1 });
    r.host.tradeInfo = {
      otherPid: 2,
      otherName: 'Borin',
      myOffer: {
        items: [
          { itemId: 'worn_sword', count: 1 },
          { itemId: 'boar_hide', count: 1 },
        ],
        copper: 0,
      },
      theirOffer: { items: [], copper: 0 },
      myAccepted: false,
      theirAccepted: false,
    } as unknown as typeof r.host.tradeInfo;
    r.host.inventory.push({ itemId: 'worn_sword', count: 1 }, { itemId: 'boar_hide', count: 1 });
    const c = r.controller as unknown as {
      wocTradeOffer: WocPendingOffer | null;
      acceptWocTradeOffer(): Promise<void>;
    };
    c.wocTradeOffer = heldOffer({ role: 'seller' });
    await c.acceptWocTradeOffer();
    expect(h.state.calls.acceptOffers).toEqual([]);
    expect(r.host.logs.at(-1)).toBe(t('hudChrome.trade.woc.hintOneItem'));
  });

  it('answers needs-item, never one_item, over a table with NOTHING sellable (arm order)', async () => {
    // The ladder-order pin: with no eligible slot at all, "leave only the one
    // being sold" would point at a table holding nothing sellable, so the
    // needs-item arm must win even though the two-slot shape also satisfies
    // the one_item predicate. Mirrors the model's acceptHint ladder.
    const h = fakeHooks();
    const r = rig(h.hooks);
    r.host.staged.items.push({ itemId: 'worn_sword', count: 1 });
    r.host.tradeInfo = {
      otherPid: 2,
      otherName: 'Borin',
      myOffer: {
        items: [
          { itemId: 'boar_hide', count: 1 },
          { itemId: 'boar_hide', count: 1 },
        ],
        copper: 0,
      },
      theirOffer: { items: [], copper: 0 },
      myAccepted: false,
      theirAccepted: false,
    } as unknown as typeof r.host.tradeInfo;
    const c = r.controller as unknown as {
      wocTradeOffer: WocPendingOffer | null;
      acceptWocTradeOffer(): Promise<void>;
    };
    c.wocTradeOffer = heldOffer({ role: 'seller' });
    await c.acceptWocTradeOffer();
    expect(h.state.calls.acceptOffers).toEqual([]);
    expect(r.host.logs.at(-1)).toBe(t('hudChrome.trade.woc.hintAcceptNeedsItem'));
  });

  it('resolves an INSTANCED staged copy through the sim offer, index and payload both', async () => {
    // The fix-round blocker: the HUD-local compose list is id-plus-count
    // only, so resolving from it could only match a PLAIN bag copy; an
    // instanced directed sale either refused at the index resolution or
    // extracted the wrong copy into an item_mismatch. The sim's cleaned
    // offer (tradeInfo.myOffer) carries the per-copy payload the staging
    // preview pinned, and the accept must resolve through IT.
    const h = fakeHooks();
    const r = rig(h.hooks);
    const signed = { itemId: 'worn_sword', count: 1, instance: { signer: 'Ayla' } };
    r.host.staged.items.push({ itemId: 'worn_sword', count: 1 });
    r.host.tradeInfo = {
      otherPid: 2,
      otherName: 'Borin',
      myOffer: { items: [signed], copper: 0 },
      theirOffer: { items: [], copper: 0 },
      myAccepted: false,
      theirAccepted: false,
    } as unknown as typeof r.host.tradeInfo;
    r.host.inventory.push({ itemId: 'worn_sword', count: 1 }, {
      itemId: 'worn_sword',
      count: 1,
      instance: { signer: 'Ayla' },
    } as unknown as {
      itemId: string;
      count: number;
    });
    const c = r.controller as unknown as {
      wocTradeOffer: WocPendingOffer | null;
      acceptWocTradeOffer(): Promise<void>;
    };
    c.wocTradeOffer = heldOffer({ role: 'seller' });
    await c.acceptWocTradeOffer();
    expect(h.state.calls.acceptOffers).toEqual([7]);
    expect(h.state.lastAcceptBody).toMatchObject({
      itemIndex: 1,
      itemId: 'worn_sword',
      expectInstance: { signer: 'Ayla' },
    });
  });
});

describe('the createOffer request body (buyer send)', () => {
  it('names the EXACT copy on the table, and asserts the terms per call', async () => {
    // The offer pins a fingerprint of the copy it is for (H10): the server
    // refuses acceptance of any other copy, so an id-only body would let a
    // seller swap in a re-rolled instance after the price was agreed. The
    // per-call terms flag is the other half: the pay arm's "terms were
    // accepted when the offer was made" premise is only true because the SEND
    // carries it.
    const h = fakeHooks();
    h.state.createOfferImpl = () => Promise.resolve({ ok: true, offer: { id: 11, usdCents: 250 } });
    const r = rig(h.hooks);
    // No openTrade: the send path reads the model's inputs and the hooks, and
    // the open poll's empty-result callback would clear state mid-test (the
    // accept-body suite's rationale).
    const agreed = {
      itemId: 'worn_sword',
      count: 1,
      instance: { signer: 'Ayla', enchant: 'flame_weapon' },
      craftedRecipeId: 'recipe_worn_sword',
    };
    r.host.tradeInfo = {
      otherPid: 2,
      otherName: 'Borin',
      myOffer: { items: [], copper: 0 },
      theirOffer: { items: [agreed], copper: 0 },
      myAccepted: false,
      theirAccepted: false,
    } as unknown as typeof r.host.tradeInfo;
    const c = r.controller as unknown as {
      wocTradeMode: 'gold' | 'woc';
      wocTradeUsdCents: number | null;
      wocTradePartner: { name: string; walletVerified: boolean } | null;
      wocTradePartnerResolved: boolean;
      wocTradeOffer: WocPendingOffer | null;
      sendWocTradeOffer(otherName: string): Promise<void>;
    };
    c.wocTradeMode = 'woc';
    c.wocTradeUsdCents = 250;
    c.wocTradePartner = { name: 'Borin', walletVerified: true };
    c.wocTradePartnerResolved = true;
    // R9: the send carries the consent row's REAL state; the ticked box is
    // what makes the sent acceptTerms true.
    (c as unknown as { wocTradeTermsChecked: boolean }).wocTradeTermsChecked = true;

    await c.sendWocTradeOffer('Borin');

    expect(h.state.calls.createOffers).toBe(1);
    // The WHOLE body, so a dropped field fails here rather than at the server.
    expect(h.state.lastCreateBody).toEqual({
      characterId: 1,
      sellerCharacterName: 'Borin',
      usdCents: 250,
      itemId: 'worn_sword',
      itemInstance: { signer: 'Ayla', enchant: 'flame_weapon' },
      itemCraftedRecipeId: 'recipe_worn_sword',
      acceptTerms: true,
    });
    expect(h.state.lastCreateBody?.acceptTerms).toBe(true);
    // The ok arm really ran: the returned row is what the window now holds.
    expect(c.wocTradeOffer?.id).toBe(11);
    expect(r.host.logs.at(-1)).toBe(t('hudChrome.trade.woc.offerSent', { name: 'Borin' }));
  });

  it('omits the per-copy fields for a PLAIN staged copy rather than sending nulls', async () => {
    // The two optional legs are spread conditionally: a plain copy carries no
    // instance and no marker, and sending either as an explicit null would
    // fingerprint a copy that does not exist.
    const h = fakeHooks();
    h.state.createOfferImpl = () => Promise.resolve({ ok: true, offer: { id: 12, usdCents: 250 } });
    const r = rig(h.hooks);
    r.host.tradeInfo = {
      otherPid: 2,
      otherName: 'Borin',
      myOffer: { items: [], copper: 0 },
      theirOffer: { items: [{ itemId: 'worn_sword', count: 1 }], copper: 0 },
      myAccepted: false,
      theirAccepted: false,
    } as unknown as typeof r.host.tradeInfo;
    const c = r.controller as unknown as {
      wocTradeMode: 'gold' | 'woc';
      wocTradeUsdCents: number | null;
      wocTradePartner: { name: string; walletVerified: boolean } | null;
      wocTradePartnerResolved: boolean;
      sendWocTradeOffer(otherName: string): Promise<void>;
    };
    c.wocTradeMode = 'woc';
    c.wocTradeUsdCents = 250;
    c.wocTradePartner = { name: 'Borin', walletVerified: true };
    c.wocTradePartnerResolved = true;
    // R9: the send carries the consent row's REAL state; the ticked box is
    // what makes the sent acceptTerms true.
    (c as unknown as { wocTradeTermsChecked: boolean }).wocTradeTermsChecked = true;

    await c.sendWocTradeOffer('Borin');

    expect(h.state.calls.createOffers).toBe(1);
    expect(Object.keys(h.state.lastCreateBody ?? {}).sort()).toEqual([
      'acceptTerms',
      'characterId',
      'itemId',
      'sellerCharacterName',
      'usdCents',
    ]);
  });
});

describe('the accept belt past the review window', () => {
  it('logs NOTHING once the goods are escrowed: an empty table is the correct state', async () => {
    // The retired copy named "stage the item" whenever no staged slot
    // resolved, which past review is a lie: the goods left the bags into
    // escrow, so the table is empty BY DESIGN. The model answers a null hint
    // outside review, and a null hint with a refused accept says nothing.
    const h = fakeHooks();
    const r = rig(h.hooks);
    r.host.tradeInfo = {
      otherPid: 2,
      otherName: 'Borin',
      myOffer: { items: [], copper: 0 },
      theirOffer: { items: [], copper: 0 },
      myAccepted: false,
      theirAccepted: false,
    } as unknown as typeof r.host.tradeInfo;
    const c = r.controller as unknown as {
      wocTradeOffer: WocPendingOffer | null;
      acceptWocTradeOffer(): Promise<void>;
    };
    c.wocTradeOffer = heldOffer({
      role: 'seller',
      phase: 'awaiting_payment',
      listingId: 41,
      buyerAccepted: true,
      sellerAccepted: true,
    });

    await c.acceptWocTradeOffer();

    expect(r.host.logs).toEqual([]);
    expect(h.state.calls.acceptOffers).toEqual([]);

    // The counter-shape, so the silence above is a decision rather than a dead
    // path: the SAME empty table inside the review window still earns the
    // needs-item line, because there the goods really are missing.
    c.wocTradeOffer = heldOffer({ role: 'seller' });
    await c.acceptWocTradeOffer();
    expect(r.host.logs).toEqual([t('hudChrome.trade.woc.hintAcceptNeedsItem')]);
    expect(h.state.calls.acceptOffers).toEqual([]);
  });
});

describe('the close-path recovery (the stale-bag race)', () => {
  it('resolves a deal that settled after the window closed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const h = fakeHooks();
    const r = rig(h.hooks);
    openTrade(r);
    // The deal both sides held when the window shut; this side's poll never
    // saw it settle, which is exactly how a seller ended up with a stale bag.
    (r.controller as unknown as { wocTradeOffer: WocPendingOffer | null }).wocTradeOffer =
      heldOffer({ role: 'seller', phase: 'awaiting_payment', listingId: 41 });
    // Server truth at the off-window re-read: the listing resolved sold.
    h.state.offersResult = {
      ok: true,
      offers: [
        offerRow({
          status: 'accepted',
          buyerAccepted: true,
          sellerAccepted: true,
          listingId: 41,
          listingStatus: 'closed',
          listingResolution: 'sold',
          itemId: 'wolf_fang',
        }),
      ],
    };
    r.host.tradeInfo = null;
    r.controller.updateTradeWindow();
    await flushAsync();
    expect(r.host.logs.some((l) => l.includes(itemDisplayName(ITEMS.wolf_fang)))).toBe(true);
    expect(r.host.balanceRefreshes).toBe(1);
    expect(r.host.closed).toBe(1);
  });
});

describe('withdrawing the standing offer', () => {
  it('clears the held offer and names the action to the service', async () => {
    const h = fakeHooks();
    const r = rig(h.hooks);
    // No openTrade: same poll-race rationale as the accept-body suite above.
    const c = r.controller as unknown as {
      wocTradeOffer: WocPendingOffer | null;
      wocTradeSplit: unknown;
      cancelWocTradeOffer(action: 'decline' | 'withdraw'): Promise<void>;
    };
    c.wocTradeOffer = heldOffer();
    c.wocTradeSplit = { sellerCents: 90, burnCents: 3, treasuryCents: 7 };
    await c.cancelWocTradeOffer('withdraw');
    expect(h.state.calls.resolveOffers).toEqual([[7, 'withdraw']]);
    expect(c.wocTradeOffer).toBeNull();
    // The dead deal's split dies with it, at this clear site like the poll's:
    // a later compose form must not paint its Fee / You receive lines.
    expect(c.wocTradeSplit).toBeNull();
  });
});

describe('the pay verdict ladder matches the Exchange window', () => {
  // Two surfaces describing the same confirm answer must make the same claim:
  // review parks to its own line, only 'confirming' takes the pending mapper,
  // and a decided state (confirmed / delivering) takes the settled line. The
  // dev-chain quote (signatureRequired false) skips the wallet, so the ladder
  // is reachable without a wallet stub.
  async function payTo(confirmAnswer: unknown): Promise<string[]> {
    const h = fakeHooks();
    h.state.buyNowImpl = () => Promise.resolve({ ok: true, settlement: { id: 5 }, quote: null });
    h.state.settlementQuoteImpl = () =>
      Promise.resolve({
        ok: true,
        quote: {
          reference: 'dev_woc_1',
          transactionBase64: 'dHg=',
          signatureRequired: false,
          amount: null,
          seller: null,
          burn: null,
          treasury: null,
          bondCents: null,
          expiresAtMs: 9_999_999_999_999,
        },
      });
    h.state.confirmSettlementImpl = () => Promise.resolve(confirmAnswer);
    const r = rig(h.hooks);
    const c = r.controller as unknown as {
      wocTradeOffer: WocPendingOffer | null;
      payWocTradeOffer(): Promise<void>;
    };
    c.wocTradeOffer = heldOffer({
      role: 'buyer',
      phase: 'awaiting_payment',
      listingId: 41,
      buyerAccepted: true,
      sellerAccepted: true,
    });
    // The two-step flow: Pay stages the quote for review, Sign spends it.
    await c.payWocTradeOffer();
    await (c as unknown as { signWocTradeQuote(): Promise<void> }).signWocTradeQuote();
    return r.host.logs;
  }

  it('a review park logs the review line, never the generic pending one', async () => {
    const logs = await payTo({ ok: true, state: 'review' });
    expect(logs).toContain(t('hudChrome.wocMarket.settlementReview'));
    expect(logs).not.toContain(t('hudChrome.trade.woc.settled'));
  });

  it('a confirming answer names WHICH pending it is', async () => {
    const logs = await payTo({ ok: true, state: 'confirming', reason: 'not_yet_visible' });
    expect(logs).toContain(t('hudChrome.wocMarket.paymentNotYetVisible'));
    expect(logs).not.toContain(t('hudChrome.trade.woc.settled'));
  });

  it('a DECIDED payment with delivery owed logs the confirmed line, never a delivery claim', async () => {
    // Confirmed money whose finalize has not run: its own sentence. The old
    // settled line ("on its way by mail") claimed a delivery that had not
    // happened; the poll's settled report still closes the loop when it does.
    for (const state of ['confirmed', 'delivering']) {
      const logs = await payTo({ ok: true, state });
      expect(logs, state).toContain(t('hudChrome.trade.woc.paymentConfirmed'));
      expect(logs, state).not.toContain(t('hudChrome.trade.woc.settled'));
      expect(logs, state).not.toContain(t('hudChrome.wocMarket.paymentPendingGeneric'));
    }
  });

  it('a DELIVERED answer logs the settled line', async () => {
    const logs = await payTo({ ok: true, state: 'delivered' });
    expect(logs).toContain(t('hudChrome.trade.woc.settled'));
    expect(logs).not.toContain(t('hudChrome.wocMarket.paymentPendingGeneric'));
  });

  it('an absent quote signatureRequired still drives the wallet on the PAY path (absent means sign)', async () => {
    // The same absent-means-sign contract as the accept path, on the money leg:
    // a quote that OMITS signatureRequired must go through the wallet, never the
    // devsig short-circuit that would send a stand-in string to confirm.
    const h = fakeHooks();
    let confirmedWith = 'unset';
    h.state.buyNowImpl = () => Promise.resolve({ ok: true, settlement: { id: 5 }, quote: null });
    h.state.settlementQuoteImpl = () =>
      Promise.resolve({
        ok: true,
        quote: {
          reference: 'ref_1',
          transactionBase64: 'dHg=',
          // signatureRequired OMITTED on purpose.
          amount: null,
          seller: null,
          burn: null,
          treasury: null,
          bondCents: null,
          expiresAtMs: 9_999_999_999_999,
        },
      });
    h.state.confirmSettlementImpl = () => Promise.resolve({ ok: true, state: 'confirmed' });
    const hooksWithConfirmSpy = h.hooks as unknown as {
      client: { confirmSettlement: (id: number, sig: string) => Promise<unknown> };
    };
    const origConfirm = hooksWithConfirmSpy.client.confirmSettlement;
    hooksWithConfirmSpy.client.confirmSettlement = (id: number, sig: string) => {
      confirmedWith = sig;
      return origConfirm(id, sig);
    };
    const r = rig(h.hooks);
    const c = r.controller as unknown as {
      wocTradeOffer: WocPendingOffer | null;
      payWocTradeOffer(): Promise<void>;
    };
    c.wocTradeOffer = heldOffer({
      role: 'buyer',
      phase: 'awaiting_payment',
      listingId: 41,
      buyerAccepted: true,
      sellerAccepted: true,
    });
    // The two-step flow: staging the quote must NOT touch the wallet; only
    // the explicit sign step drives it (absent still means sign there).
    await c.payWocTradeOffer();
    expect(h.state.calls.signAndSends, 'review first: no wallet call on Pay').toEqual([]);
    await (c as unknown as { signWocTradeQuote(): Promise<void> }).signWocTradeQuote();
    expect(h.state.calls.signAndSends, 'the wallet transaction signer WAS driven').toEqual([
      'dHg=',
    ]);
    // The signer also receives the quote REFERENCE (the desktop arm resolves
    // the registered quote by it; a dropped argument kills desktop payments).
    expect(h.state.calls.signAndSendArgs).toEqual([['dHg=', 'ref_1']]);
    expect(confirmedWith, 'confirm got the real wallet signature, not a devsig').toBe(
      'walletTxSig',
    );
  });
});

describe('the adoption-stored split dies with its deal', () => {
  it('clearing the offer clears the split, so a later compose form cannot render it', async () => {
    const h = fakeHooks();
    h.state.estimateImpl = () =>
      Promise.resolve({
        amount: { tokens: 800 },
        split: { sellerCents: 90, burnCents: 3, treasuryCents: 7 },
      });
    h.state.offersResult = {
      ok: true,
      offers: [offerRow({ buyerAccepted: true, sellerAccepted: false })],
    };
    const r = rig(h.hooks);
    openTrade(r);
    const c = r.controller as unknown as {
      wocTradeSplit: unknown;
      wocTradeOffer: WocPendingOffer | null;
    };
    vi.useFakeTimers();
    r.controller.updateTradeWindow();
    await vi.advanceTimersByTimeAsync(2100);
    r.controller.updateTradeWindow();
    await flushAsync();
    expect(c.wocTradeSplit, 'the adoption stored the split').not.toBeNull();
    // The other side declines: the next poll finds no standing offer.
    h.state.offersResult = { ok: true, offers: [] };
    await vi.advanceTimersByTimeAsync(2100);
    r.controller.updateTradeWindow();
    await flushAsync();
    expect(c.wocTradeOffer, 'the dead deal is gone').toBeNull();
    expect(c.wocTradeSplit, 'and its split with it').toBeNull();
    vi.useRealTimers();
  });
});

describe('honest deal endings (H13): closed is not settled', () => {
  it('a closed-cancelled deal logs the cancelled line ONCE, never the paid line, and keeps the session', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const h = fakeHooks();
    h.state.offersResult = {
      ok: true,
      offers: [
        offerRow({
          role: 'seller',
          buyerName: 'Bree',
          status: 'accepted',
          listingId: 41,
          listingStatus: 'closed',
          listingResolution: 'cancelled',
          buyerAccepted: true,
          sellerAccepted: true,
        }),
      ],
    };
    const r = rig(h.hooks);
    openTrade(r);
    await flushAsync();
    expect(r.host.logs).toContain(t('hudChrome.trade.woc.closedCancelled'));
    expect(r.host.logs.join('\n')).not.toContain('received a payment');
    // The session STAYS OPEN (a dead deal leaves two players at a live trade
    // window), unlike the settled path which closes it.
    expect(r.host.closed).toBe(0);
    // Exactly once: the row lingers for the grace window, but the retired-id
    // set holds the report.
    vi.setSystemTime(1_002_500);
    r.controller.updateTradeWindow();
    await flushAsync();
    expect(r.host.logs.filter((l) => l === t('hudChrome.trade.woc.closedCancelled'))).toHaveLength(
      1,
    );
    vi.useRealTimers();
  });

  it('an unpaid close and a suspension each log their own honest reason', async () => {
    // Per side for the unpaid end: the buyer whose deal lapsed reads the
    // consequence the pre-commitment note disclosed (a strike); the seller
    // and every suspension read the plain line.
    for (const [resolution, role, key] of [
      ['unsettled', 'buyer', 'hudChrome.trade.woc.closedUnpaidBuyer'],
      ['unsettled', 'seller', 'hudChrome.trade.woc.closedUnpaid'],
      ['suspended', 'buyer', 'hudChrome.trade.woc.closedSuspended'],
    ] as const) {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      const h = fakeHooks();
      h.state.offersResult = {
        ok: true,
        offers: [
          offerRow({
            status: 'accepted',
            role,
            // The counterparty is the trade partner (Bree) on either side.
            ...(role === 'seller' ? { buyerName: 'Bree', sellerName: 'Aldric' } : {}),
            listingId: 41,
            listingStatus: 'closed',
            listingResolution: resolution,
            buyerAccepted: true,
            sellerAccepted: true,
          }),
        ],
      };
      const r = rig(h.hooks);
      openTrade(r);
      await flushAsync();
      expect(r.host.logs, resolution).toContain(t(key));
      // Never the ROLE-CORRECT paid line: the buyer's is "sent a payment",
      // the seller's "received a payment" (a negative pin of the other role's
      // phrase would pass for free).
      const paidKey =
        role === 'buyer' ? 'hudChrome.trade.woc.paidBuyer' : 'hudChrome.trade.woc.paidSeller';
      const paidPhrase = role === 'buyer' ? 'sent a payment' : 'received a payment';
      expect(t(paidKey, { price: 'p', item: 'i' }), "the phrase is this role's line").toContain(
        paidPhrase,
      );
      expect(r.host.logs.join('\n'), resolution).not.toContain(paidPhrase);
      // Every closed arm leaves the session OPEN (a dead deal is not a
      // completed one), the same as the cancelled arm above.
      expect(r.host.closed, resolution).toBe(0);
      vi.useRealTimers();
    }
  });

  it('reports the other side resolving the offer (declined / withdrawn / expired), once', async () => {
    for (const [status, key] of [
      ['declined', 'hudChrome.trade.woc.offerDeclined'],
      ['withdrawn', 'hudChrome.trade.woc.offerWithdrawn'],
      ['expired', 'hudChrome.trade.woc.offerExpired'],
    ] as const) {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      const h = fakeHooks();
      h.state.offersResult = { ok: true, offers: [offerRow()] };
      const r = rig(h.hooks);
      openTrade(r);
      await flushAsync();
      // The counterparty resolves it; the lingering row carries the verdict.
      h.state.offersResult = { ok: true, offers: [offerRow({ status })] };
      vi.setSystemTime(1_002_500);
      r.controller.updateTradeWindow();
      await flushAsync();
      expect(r.host.logs, status).toContain(t(key));
      // Once: the retired-id set holds it across further polls.
      vi.setSystemTime(1_005_000);
      r.controller.updateTradeWindow();
      await flushAsync();
      expect(
        r.host.logs.filter((l) => l === t(key)),
        status,
      ).toHaveLength(1);
      vi.useRealTimers();
    }
  });
});

describe('seller controls (H13): decline and cancel sale, end to end', () => {
  it('the seller review face carries a live Decline that reaches the decline route', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const h = fakeHooks();
    h.state.tradePartnerImpl = () =>
      Promise.resolve({ ok: true, partner: { name: 'Bree', walletVerified: true } });
    h.state.offersResult = {
      ok: true,
      offers: [offerRow({ role: 'seller', buyerName: 'Bree' })],
    };
    const r = rig(h.hooks);
    openTrade(r);
    await flushAsync();
    r.controller.updateTradeWindow();
    const btn = document.querySelector<HTMLElement>('#trade-window [data-woc-decline]');
    expect(btn, 'the decline control renders for the seller').not.toBeNull();
    btn?.click();
    await flushAsync();
    expect(h.state.calls.resolveOffers).toEqual([[7, 'decline']]);
    expect(r.host.logs).toContain(t('hudChrome.trade.woc.youDeclined'));
    vi.useRealTimers();
  });

  it('the buyer keeps Withdraw and never sees Decline; a withdraw logs its own line', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const h = fakeHooks();
    h.state.tradePartnerImpl = () =>
      Promise.resolve({ ok: true, partner: { name: 'Bree', walletVerified: true } });
    h.state.offersResult = { ok: true, offers: [offerRow()] };
    const r = rig(h.hooks);
    openTrade(r);
    await flushAsync();
    r.controller.updateTradeWindow();
    expect(document.querySelector('#trade-window [data-woc-decline]')).toBeNull();
    const btn = document.querySelector<HTMLElement>('#trade-window [data-woc-cancel]');
    expect(btn).not.toBeNull();
    btn?.click();
    await flushAsync();
    expect(h.state.calls.resolveOffers).toEqual([[7, 'withdraw']]);
    expect(r.host.logs).toContain(t('hudChrome.trade.woc.youWithdrew'));
    vi.useRealTimers();
  });

  it('the seller can cancel an unpaid directed sale from the awaiting-payment face', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const h = fakeHooks();
    h.state.tradePartnerImpl = () =>
      Promise.resolve({ ok: true, partner: { name: 'Bree', walletVerified: true } });
    h.state.cancelListingImpl = () => Promise.resolve({ ok: true });
    h.state.offersResult = {
      ok: true,
      offers: [
        offerRow({
          role: 'seller',
          buyerName: 'Bree',
          status: 'accepted',
          listingId: 41,
          listingStatus: 'active',
          buyerAccepted: true,
          sellerAccepted: true,
        }),
      ],
    };
    const r = rig(h.hooks);
    openTrade(r);
    await flushAsync();
    r.controller.updateTradeWindow();
    const btn = document.querySelector<HTMLElement>('#trade-window [data-woc-cancel-sale]');
    expect(btn, 'the cancel-sale control renders for the seller').not.toBeNull();
    btn?.click();
    await flushAsync();
    expect(h.state.calls.cancelListings).toEqual([41]);
    expect(r.host.logs).toContain(t('hudChrome.wocMarket.listingCancelled'));
    const c = r.controller as unknown as { wocTradeOffer: WocPendingOffer | null };
    expect(c.wocTradeOffer, 'the dead deal cleared').toBeNull();
    vi.useRealTimers();
  });

  it('a cancel answered CANCEL-PENDING keeps the deal held: the buyer may still pay', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const h = fakeHooks();
    h.state.tradePartnerImpl = () =>
      Promise.resolve({ ok: true, partner: { name: 'Bree', walletVerified: true } });
    h.state.cancelListingImpl = () => Promise.resolve({ ok: true, cancelPending: true });
    h.state.offersResult = {
      ok: true,
      offers: [
        offerRow({
          role: 'seller',
          buyerName: 'Bree',
          status: 'accepted',
          listingId: 41,
          listingStatus: 'active',
          buyerAccepted: true,
          sellerAccepted: true,
        }),
      ],
    };
    const r = rig(h.hooks);
    openTrade(r);
    await flushAsync();
    r.controller.updateTradeWindow();
    document.querySelector<HTMLElement>('#trade-window [data-woc-cancel-sale]')?.click();
    await flushAsync();
    expect(r.host.logs).toContain(t('hudChrome.wocMarket.listingCancelPending'));
    const c = r.controller as unknown as { wocTradeOffer: WocPendingOffer | null };
    expect(c.wocTradeOffer, 'the deal stays held; the poll resolves it').not.toBeNull();
    vi.useRealTimers();
  });

  it('the buyer face never renders cancel-sale', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const h = fakeHooks();
    h.state.tradePartnerImpl = () =>
      Promise.resolve({ ok: true, partner: { name: 'Bree', walletVerified: true } });
    h.state.offersResult = {
      ok: true,
      offers: [
        offerRow({
          status: 'accepted',
          listingId: 41,
          listingStatus: 'active',
          buyerAccepted: true,
          sellerAccepted: true,
        }),
      ],
    };
    const r = rig(h.hooks);
    openTrade(r);
    await flushAsync();
    r.controller.updateTradeWindow();
    expect(document.querySelector('#trade-window [data-woc-cancel-sale]')).toBeNull();
    vi.useRealTimers();
  });
});

describe('informed waiting: expiry, close-time honesty, fresh money lines', () => {
  it('tells a buyer who closes the window that a LIVE offer still stands, with its expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const h = fakeHooks();
    h.state.offersResult = { ok: true, offers: [offerRow()] };
    const r = rig(h.hooks);
    openTrade(r);
    await flushAsync();
    // The window closes with the offer still pending.
    r.host.tradeInfo = null;
    r.controller.updateTradeWindow();
    await flushAsync();
    const line = r.host.logs.find((l) =>
      l.startsWith(t('hudChrome.trade.woc.offerStandsUntil', { time: '' }).slice(0, 12)),
    );
    expect(line, 'the still-stands line').toBeTruthy();
    vi.useRealTimers();
  });

  it('says nothing about an expiry the row cannot express', async () => {
    // The OTHER expiry read (the offer row's "stands until" line), which had no
    // arm of its own: an epoch-0 stamp is absence written as a number and NaN
    // is what a date projection yields, and formatDateTime throws on the second
    // rather than printing anything. Both must take the silent branch.
    for (const value of [0, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      const h = fakeHooks();
      h.state.offersResult = {
        ok: true,
        offers: [offerRow({ expiresAtMs: value as number })],
      };
      const r = rig(h.hooks);
      openTrade(r);
      await flushAsync();
      r.host.tradeInfo = null;
      r.controller.updateTradeWindow();
      await flushAsync();
      const stem = t('hudChrome.trade.woc.offerStandsUntil', { time: '' }).slice(0, 12);
      expect(
        r.host.logs.find((l) => l.startsWith(stem)),
        `expiry ${String(value)} must not produce a stands-until line`,
      ).toBeUndefined();
      vi.useRealTimers();
    }
  });

  it('a price edit blanks the derived money lines IMMEDIATELY, not after the debounce', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const h = fakeHooks();
    const r = rig(h.hooks);
    openTrade(r);
    const c = r.controller as unknown as {
      onWocTradePrice(cents: number | null): void;
      wocTradeTokens: number | null;
      wocTradeSplit: unknown;
    };
    c.wocTradeTokens = 800;
    c.wocTradeSplit = { sellerCents: 90, burnCents: 3, treasuryCents: 7 };
    c.onWocTradePrice(7500);
    // BEFORE the debounce fires or any estimate lands: the old figures
    // described the previous price and must not sit under the new one.
    expect(c.wocTradeTokens).toBeNull();
    expect(c.wocTradeSplit).toBeNull();
    vi.useRealTimers();
  });

  it('fetches the Exchange floor once per trade and threads it into the hint model', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const h = fakeHooks();
    h.state.statusImpl = () => Promise.resolve({ ok: true, enabled: true, minPriceCents: 100 });
    const r = rig(h.hooks);
    openTrade(r);
    await flushAsync();
    expect(h.state.calls.statuses).toBe(1);
    const c = r.controller as unknown as { wocTradeMinPriceCents: number | null };
    expect(c.wocTradeMinPriceCents).toBe(100);
    // Re-open: the realm-static floor is not re-fetched.
    r.host.tradeInfo = null;
    r.controller.updateTradeWindow();
    openTrade(r);
    await flushAsync();
    expect(h.state.calls.statuses).toBe(1);
    vi.useRealTimers();
  });
});

describe('informed commitment (R9 + the quote review)', () => {
  function buyerDeal(h: ReturnType<typeof fakeHooks>) {
    h.state.buyNowImpl = () =>
      Promise.resolve({ ok: true, settlement: { id: 5, amountCents: 100 }, quote: null });
    h.state.settlementQuoteImpl = () =>
      Promise.resolve({
        ok: true,
        quote: {
          reference: 'ref_q1',
          transactionBase64: 'dHg=',
          signatureRequired: false,
          amount: { base: '100', tokens: 812.5 },
          seller: null,
          burn: null,
          treasury: null,
          bondCents: null,
          expiresAtMs: 9_999_999_999_999,
        },
      });
    const r = rig(h.hooks);
    const c = r.controller as unknown as {
      wocTradeOffer: WocPendingOffer | null;
      wocTradeQuote: { totalTokens: number | null } | null;
      wocTradeSettlement: { offerId: number; id: number; usdCents: number } | null;
      wocTradeTermsAccepted: boolean;
      wocTradeTermsChecked: boolean;
      payWocTradeOffer(): Promise<void>;
      signWocTradeQuote(): Promise<void>;
    };
    c.wocTradeOffer = heldOffer({
      role: 'buyer',
      phase: 'awaiting_payment',
      listingId: 41,
      buyerAccepted: true,
      sellerAccepted: true,
    });
    return { r, c };
  }

  it('Pay stages the quote for review and touches no wallet; Sign is the spend', async () => {
    const h = fakeHooks();
    const { c } = buyerDeal(h);
    await c.payWocTradeOffer();
    expect(c.wocTradeQuote?.totalTokens).toBe(812.5);
    expect(h.state.calls.signAndSends).toEqual([]);
    expect(h.state.calls.buyNows).toBe(1);
  });

  it('Not now keeps the deal payable: the next Pay re-quotes WITHOUT a second buy-now', async () => {
    // A second buyNow would refuse over the buyer's own live lock
    // (buy_now_locked); the stored settlement id is what makes retry work.
    const h = fakeHooks();
    const { c } = buyerDeal(h);
    await c.payWocTradeOffer();
    c.wocTradeQuote = null; // the Not now handler's effect
    await c.payWocTradeOffer();
    expect(c.wocTradeQuote, 're-quoted').not.toBeNull();
    expect(h.state.calls.buyNows, 'one lock claim for the whole deal').toBe(1);
  });

  it('the buy-now send carries the REAL consent state, never a hard-coded true (R9)', async () => {
    const h = fakeHooks();
    let sentTerms: unknown = 'unset';
    const clientWithSpy = h.hooks as unknown as {
      client: { buyNow: (req: Record<string, unknown>) => Promise<unknown> };
    };
    const orig = clientWithSpy.client.buyNow;
    clientWithSpy.client.buyNow = (req) => {
      sentTerms = req.acceptTerms;
      return orig(req);
    };
    const { c } = buyerDeal(h);
    c.wocTradeTermsAccepted = false;
    c.wocTradeTermsChecked = false;
    await c.payWocTradeOffer();
    expect(sentTerms, 'unchecked box sends false; the server refuses honestly').toBe(false);
    // Ticked: the send carries it, and the recorded acceptance flips durable.
    c.wocTradeQuote = null;
    c.wocTradeSettlement = null;
    c.wocTradeTermsChecked = true;
    await c.payWocTradeOffer();
    expect(sentTerms).toBe(true);
    expect(c.wocTradeTermsAccepted, 'the send that carried consent records it').toBe(true);
  });

  it('learns durable acceptance from /me at trade open, so the consent row hides', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const h = fakeHooks();
    h.state.meImpl = () => Promise.resolve({ ok: true, activity: { termsAcceptedAtMs: 123 } });
    const r = rig(h.hooks);
    openTrade(r);
    await flushAsync();
    const c = r.controller as unknown as { wocTradeTermsAccepted: boolean };
    expect(c.wocTradeTermsAccepted).toBe(true);
    vi.useRealTimers();
  });

  it('a pending /me answer leaves the consent row SHOWN (fail toward asking)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const h = fakeHooks();
    h.state.meImpl = () => Promise.resolve({ ok: true, activity: { termsAcceptedAtMs: null } });
    const r = rig(h.hooks);
    openTrade(r);
    await flushAsync();
    const c = r.controller as unknown as { wocTradeTermsAccepted: boolean };
    expect(c.wocTradeTermsAccepted).toBe(false);
    vi.useRealTimers();
  });
});

describe('review-round closures: the arms the first audit found unpinned', () => {
  it('the OFFER SEND carries false when nothing consented, and records a consented send (R9)', async () => {
    // The exact mutant the R9 criterion exists to kill: acceptTerms: true
    // hard-coded back into sendWocTradeOffer passes every other test.
    const h = fakeHooks();
    h.state.createOfferImpl = () =>
      Promise.resolve({
        ok: true,
        offer: { id: 12, usdCents: 250, expiresAtMs: 1_800_000_000_000 },
      });
    const r = rig(h.hooks);
    const agreed = { itemId: 'worn_sword', count: 1 };
    r.host.tradeInfo = {
      otherPid: 2,
      otherName: 'Borin',
      myOffer: { items: [], copper: 0 },
      theirOffer: { items: [agreed], copper: 0 },
      myAccepted: false,
      theirAccepted: false,
    } as unknown as typeof r.host.tradeInfo;
    const c = r.controller as unknown as {
      wocTradeMode: 'gold' | 'woc';
      wocTradeUsdCents: number | null;
      wocTradePartner: { name: string; walletVerified: boolean } | null;
      wocTradePartnerResolved: boolean;
      wocTradeTermsAccepted: boolean;
      wocTradeTermsChecked: boolean;
      wocTradeOffer: WocPendingOffer | null;
      sendWocTradeOffer(otherName: string): Promise<void>;
    };
    c.wocTradeMode = 'woc';
    c.wocTradeUsdCents = 250;
    c.wocTradePartner = { name: 'Borin', walletVerified: true };
    c.wocTradePartnerResolved = true;
    c.wocTradeTermsAccepted = false;
    c.wocTradeTermsChecked = false;
    await c.sendWocTradeOffer('Borin');
    expect(h.state.lastCreateBody?.acceptTerms, 'unconsented send carries FALSE').toBe(false);
    // The fake answered ok despite the false flag, which against the REAL
    // server can only mean durable acceptance already existed (guardTerms
    // refuses terms_required otherwise), so learning it locally is correct.
    expect(c.wocTradeTermsAccepted, 'an ok answer implies durable acceptance').toBe(true);
    c.wocTradeTermsAccepted = false;
    // Ticked: the send carries it, the durable flag records, and the held
    // offer carries the response expiry. The first send's held offer must
    // clear first (a standing offer replaces the form).
    c.wocTradeOffer = null;
    c.wocTradeTermsChecked = true;
    await c.sendWocTradeOffer('Borin');
    expect(h.state.lastCreateBody?.acceptTerms).toBe(true);
    expect(c.wocTradeTermsAccepted, 'the consented send records durably').toBe(true);
    // Fresh cast: TS keeps the null narrowing from the assignment above and
    // would type the re-populated field as never.
    const held = (c as { wocTradeOffer: WocPendingOffer | null }).wocTradeOffer;
    expect(held?.expiresAtMs, 'the send adopts the response expiry').toBe(1_800_000_000_000);
  });

  it('a declined offer cannot be RE-ADOPTED while the row still reads pending (the retired ledger)', async () => {
    // The wocTradeFinished.add in cancelWocTradeOffer is what blocks
    // re-adoption when the next poll read races the resolve and still shows
    // the row standing; without it the declined deal reopens under the
    // seller.
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const h = fakeHooks();
    h.state.tradePartnerImpl = () =>
      Promise.resolve({ ok: true, partner: { name: 'Bree', walletVerified: true } });
    h.state.offersResult = { ok: true, offers: [offerRow({ role: 'seller', buyerName: 'Bree' })] };
    const r = rig(h.hooks);
    openTrade(r);
    await flushAsync();
    r.controller.updateTradeWindow();
    document.querySelector<HTMLElement>('#trade-window [data-woc-decline]')?.click();
    await flushAsync();
    const c = r.controller as unknown as { wocTradeOffer: WocPendingOffer | null };
    expect(c.wocTradeOffer).toBeNull();
    // The next poll still returns the row as PENDING (the racing read).
    vi.setSystemTime(1_002_500);
    r.controller.updateTradeWindow();
    await flushAsync();
    expect(c.wocTradeOffer, 'the retired id blocks re-adoption').toBeNull();
    expect(r.host.logs.filter((l) => l === t('hudChrome.trade.woc.youDeclined'))).toHaveLength(1);
    vi.useRealTimers();
  });

  it('close-time honesty covers ALL the arms: unpaid buyer, silent seller, and the exact expiry', async () => {
    // Arm 1: the buyer with an UNPAID escrowed deal.
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const awaiting = offerRow({
      status: 'accepted',
      listingId: 41,
      listingStatus: 'active',
      buyerAccepted: true,
      sellerAccepted: true,
    });
    let h = fakeHooks();
    h.state.offersResult = { ok: true, offers: [awaiting] };
    let r = rig(h.hooks);
    openTrade(r);
    await flushAsync();
    r.host.tradeInfo = null;
    r.controller.updateTradeWindow();
    await flushAsync();
    expect(r.host.logs).toContain(t('hudChrome.trade.woc.dealAwaitsPayment'));

    // Arm 2: the pending-offer buyer gets the EXACT expiry-bearing line.
    h = fakeHooks();
    h.state.offersResult = { ok: true, offers: [offerRow({ expiresAtMs: 1_900_000_000_000 })] };
    r = rig(h.hooks);
    openTrade(r);
    await flushAsync();
    r.host.tradeInfo = null;
    r.controller.updateTradeWindow();
    await flushAsync();
    expect(r.host.logs).toContain(
      t('hudChrome.trade.woc.offerStandsUntil', {
        time: formatDateTime(1_900_000_000_000, { timeStyle: 'short' }),
      }),
    );

    // Arm 3: the SELLER of a still-pending offer gets NO line (their next
    // move reopens a trade anyway, and the offer lapses on its own).
    h = fakeHooks();
    h.state.offersResult = {
      ok: true,
      offers: [offerRow({ role: 'seller', buyerName: 'Bree' })],
    };
    r = rig(h.hooks);
    openTrade(r);
    await flushAsync();
    const before = r.host.logs.length;
    r.host.tradeInfo = null;
    r.controller.updateTradeWindow();
    await flushAsync();
    expect(r.host.logs.length, 'no close-time line for the seller').toBe(before);
    vi.useRealTimers();
  });

  it('the confirm answer CARRIES onto the held offer (settlementState, behaviorally)', async () => {
    const h = fakeHooks();
    h.state.buyNowImpl = () =>
      Promise.resolve({ ok: true, settlement: { id: 5, amountCents: 100 }, quote: null });
    h.state.settlementQuoteImpl = () =>
      Promise.resolve({
        ok: true,
        quote: {
          reference: 'ref_1',
          transactionBase64: 'dHg=',
          signatureRequired: false,
          amount: null,
          seller: null,
          burn: null,
          treasury: null,
          bondCents: null,
          expiresAtMs: 9_999_999_999_999,
        },
      });
    h.state.confirmSettlementImpl = () => Promise.resolve({ ok: true, state: 'confirmed' });
    const r = rig(h.hooks);
    const c = r.controller as unknown as {
      wocTradeOffer: WocPendingOffer | null;
      payWocTradeOffer(): Promise<void>;
      signWocTradeQuote(): Promise<void>;
    };
    c.wocTradeOffer = heldOffer({
      role: 'buyer',
      phase: 'awaiting_payment',
      listingId: 41,
      buyerAccepted: true,
      sellerAccepted: true,
    });
    await c.payWocTradeOffer();
    await c.signWocTradeQuote();
    expect(c.wocTradeOffer?.settlementState, 'the answer rides the held offer').toBe('confirmed');
  });
});

describe('a lapsed staged quote never reaches the wallet', () => {
  it('sign refuses it at the click, spends it, and says why', async () => {
    const h = fakeHooks();
    let confirms = 0;
    h.state.confirmSettlementImpl = () => {
      confirms += 1;
      return Promise.resolve({ ok: true, state: 'settled' });
    };
    const r = rig(h.hooks);
    const c = r.controller as unknown as {
      wocTradeOffer: WocPendingOffer | null;
      wocTradeQuote: unknown;
      wocTradeSettlement: { offerId: number; id: number; usdCents: number } | null;
      signWocTradeQuote(): Promise<void>;
    };
    c.wocTradeOffer = heldOffer({
      role: 'buyer',
      phase: 'awaiting_payment',
      listingId: 41,
      buyerAccepted: true,
      sellerAccepted: true,
    });
    c.wocTradeSettlement = { offerId: c.wocTradeOffer.id, id: 5, usdCents: 100 };
    c.wocTradeQuote = {
      offerId: c.wocTradeOffer.id,
      totalTokens: 5,
      sellerTokens: null,
      burnTokens: null,
      treasuryTokens: null,
      usdCents: 100,
      expiresAtMs: Date.now() - 1_000,
      reference: 'dev_woc_1',
      transactionBase64: 'dHg=',
    };
    await c.signWocTradeQuote();
    expect(c.wocTradeQuote, 'the stale quote is spent, not signed').toBeNull();
    expect(h.state.calls.signAndSends, 'the wallet never opens').toEqual([]);
    expect(confirms, 'no confirm rides a refused sign').toBe(0);
    expect(r.host.logs).toContain(t('apiError.woc_market.quote_expired'));
    // The held deal is untouched: Pay re-quotes against the same settlement.
    expect(c.wocTradeOffer?.phase).toBe('awaiting_payment');
    expect(c.wocTradeSettlement?.id).toBe(5);
  });

  it('a live quote still signs (the guard reads the clock, not the field)', async () => {
    const h = fakeHooks();
    h.state.buyNowImpl = () => Promise.resolve({ ok: true, settlement: { id: 5 }, quote: null });
    h.state.settlementQuoteImpl = () =>
      Promise.resolve({
        ok: true,
        quote: {
          reference: 'dev_woc_1',
          transactionBase64: 'dHg=',
          signatureRequired: false,
          amount: null,
          seller: null,
          burn: null,
          treasury: null,
          bondCents: null,
          expiresAtMs: Date.now() + 60_000,
        },
      });
    h.state.confirmSettlementImpl = () => Promise.resolve({ ok: true, state: 'settled' });
    const r = rig(h.hooks);
    const c = r.controller as unknown as {
      wocTradeOffer: WocPendingOffer | null;
      payWocTradeOffer(): Promise<void>;
      signWocTradeQuote(): Promise<void>;
    };
    c.wocTradeOffer = heldOffer({
      role: 'buyer',
      phase: 'awaiting_payment',
      listingId: 41,
      buyerAccepted: true,
      sellerAccepted: true,
    });
    await c.payWocTradeOffer();
    await c.signWocTradeQuote();
    expect(r.host.logs).toContain(t('hudChrome.trade.woc.settled'));
  });
});

describe('the QA session closures: settlement hygiene, the claim is not a payment, one click one request', () => {
  const settled = (id = 5) => ({
    ok: true,
    settlement: { id, amountCents: 100, deadlineAtMs: 1_800_000_270_000 },
    quote: {
      reference: `ref_${id}`,
      transactionBase64: 'dHg=',
      signatureRequired: false,
      amount: { base: '100', tokens: 812.5 },
      seller: { base: '90', tokens: 731.25 },
      burn: { base: '7', tokens: 56.875 },
      treasury: { base: '3', tokens: 24.375 },
      bondCents: null,
      expiresAtMs: 9_999_999_999_999,
    },
  });
  type Ctl = {
    wocTradeOffer: WocPendingOffer | null;
    wocTradeQuote: { offerId: number; totalTokens: number | null; usdCents: number } | null;
    wocTradeSettlement: {
      offerId: number;
      id: number;
      usdCents: number;
      deadlineAtMs: number | null;
    } | null;
    wocTradeCancelPendingFor: number | null;
    wocTradeSigning: boolean;
    wocTradePaying: boolean;
    wocTradeDirectedHoldSeconds: number | null;
    payWocTradeOffer(): Promise<void>;
    signWocTradeQuote(): Promise<void>;
    cancelWocTradeOffer(action: 'decline' | 'withdraw'): Promise<void>;
    cancelWocDirectedSale(): Promise<void>;
    resolveClosedWocTrade(): void;
    updateTradeWindow(): void;
  };
  async function escrowedBuyer(h: ReturnType<typeof fakeHooks>) {
    // A REAL standing deal always has a verified partner (createOffer refuses
    // otherwise); the DOM assertions below need the arm past its block face.
    h.state.tradePartnerImpl = () =>
      Promise.resolve({ ok: true, partner: { name: 'Bree', walletVerified: true } });
    const r = rig(h.hooks);
    const c = r.controller as unknown as Ctl;
    openTrade(r);
    // Let the open's first poll (an empty read) settle BEFORE the held deal
    // is staged, or its late answer clears the offer under the test.
    await flushAsync();
    c.wocTradeOffer = heldOffer({
      role: 'buyer',
      phase: 'awaiting_payment',
      listingId: 41,
      buyerAccepted: true,
      sellerAccepted: true,
    });
    return { r, c };
  }

  it('the claim answer carries the quote: Pay stages it with its fee legs and no second round trip', async () => {
    const h = fakeHooks();
    h.state.buyNowImpl = () => Promise.resolve(settled());
    let quotes = 0;
    h.state.settlementQuoteImpl = () => {
      quotes += 1;
      return Promise.resolve({ ok: false, code: 'woc_market.disabled' });
    };
    const { r, c } = await escrowedBuyer(h);
    await c.payWocTradeOffer();
    expect(c.wocTradeQuote?.totalTokens).toBe(812.5);
    expect(c.wocTradeQuote).toMatchObject({ sellerTokens: 731.25, burnTokens: 56.875 });
    expect(quotes, "the claim's own quote is fresh; no re-quote").toBe(0);
    // The staged figures are announced (and kept in the log) for the reader
    // a live region minted mid-rebuild would miss.
    expect(r.host.logs.some((l) => l.includes(usdText(100)) && l.includes('812.5'))).toBe(true);
    // The settlement is keyed to THIS offer, with the USD it settles and its
    // own payment deadline (the claim lock, shorter than the directed hold).
    expect(c.wocTradeSettlement).toEqual({
      offerId: 7,
      id: 5,
      usdCents: 100,
      deadlineAtMs: settled().settlement.deadlineAtMs,
    });
    // ...which the pay face and the quote face render from now on.
    expect(document.querySelector('#trade-window .trade-woc-arm')?.textContent).toContain(
      t('hudChrome.trade.woc.p2pPaymentDueAt', {
        time: formatDateTime(settled().settlement.deadlineAtMs, { timeStyle: 'short' }),
      }),
    );
  });

  it('a claim that answers after the deal ended stages nothing, and can never pay the NEXT deal', async () => {
    // The T1 leak: Pay pressed, the trade ends mid-claim (partner cancelled,
    // window closed), the claim answers ok. The old code staged the quote
    // anyway, so the NEXT deal's Pay re-quoted the OLD settlement and Sign
    // paid it. The claim itself EXISTS server-side (lock + settlement), so it
    // is kept, KEYED to its offer: the same deal re-adopted a moment later
    // re-quotes it (a second claim would be refused over the buyer's own
    // lock), while a different deal never touches it.
    const h = fakeHooks();
    const gate = deferred<unknown>();
    h.state.buyNowImpl = () => gate.promise;
    const { c } = await escrowedBuyer(h);
    const inFlight = c.payWocTradeOffer();
    // The deal is gone before the claim answers.
    c.wocTradeOffer = null;
    gate.resolve(settled());
    await inFlight;
    expect(c.wocTradeQuote, 'no quote is staged for a dead deal').toBeNull();
    expect(c.wocTradeSettlement, 'the claim is kept, keyed to ITS offer').toMatchObject({
      offerId: 7,
      id: 5,
    });
    // A NEW deal starts clean: its Pay claims its own lock and the old
    // settlement is dropped, never re-quoted under the new price.
    c.wocTradeOffer = heldOffer({
      id: 8,
      role: 'buyer',
      phase: 'awaiting_payment',
      listingId: 42,
      buyerAccepted: true,
      sellerAccepted: true,
    });
    h.state.buyNowImpl = () => Promise.resolve(settled(9));
    await c.payWocTradeOffer();
    expect(h.state.calls.buyNows).toBe(2);
    expect(c.wocTradeSettlement).toMatchObject({ offerId: 8, id: 9, usdCents: 100 });
  });

  it('the same deal re-adopted after a close re-quotes the KEPT claim: no second buyNow, no own-lock refusal', async () => {
    // Pay, Not now, the window closes (partner walked away), the pair trades
    // again inside the lock window: the poll re-adopts the SAME offer id and
    // Pay must re-quote the settlement it already holds. A second claim would
    // be refused buy_now_locked over the buyer's own lock (no same-account
    // arm server-side) while the settlement lapsed into a strike.
    const h = fakeHooks();
    h.state.buyNowImpl = () => Promise.resolve(settled());
    let quotes = 0;
    h.state.settlementQuoteImpl = () => {
      quotes += 1;
      return Promise.resolve({ ok: true, quote: settled().quote });
    };
    const { r, c } = await escrowedBuyer(h);
    await c.payWocTradeOffer();
    c.wocTradeQuote = null; // Not now
    // The window closes: the offer clears, the claim stays keyed.
    r.host.tradeInfo = null;
    r.controller.updateTradeWindow();
    await flushAsync();
    expect(c.wocTradeOffer).toBeNull();
    expect(c.wocTradeSettlement).toMatchObject({ offerId: 7, id: 5 });
    // The pair trades again; the poll re-adopts the same accepted deal.
    openTrade(r);
    await flushAsync();
    c.wocTradeOffer = heldOffer({
      role: 'buyer',
      phase: 'awaiting_payment',
      listingId: 41,
      buyerAccepted: true,
      sellerAccepted: true,
    });
    await c.payWocTradeOffer();
    expect(h.state.calls.buyNows, 'one claim for the whole deal').toBe(1);
    expect(quotes, 'the held settlement is re-quoted').toBe(1);
    expect((c.wocTradeQuote as { totalTokens: number | null } | null)?.totalTokens).toBe(812.5);
  });

  it('adopting a DIFFERENT offer drops a held settlement and staged quote; Sign refuses a foreign one', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000_000);
    const h = fakeHooks();
    h.state.buyNowImpl = () => Promise.resolve(settled());
    const { r, c } = await escrowedBuyer(h);
    await c.payWocTradeOffer();
    expect(c.wocTradeSettlement?.id).toBe(5);
    // The poll now sees a different accepted deal with the same partner.
    vi.setSystemTime(10_003_000);
    h.state.offersResult = {
      ok: true,
      offers: [
        offerRow({
          id: 8,
          status: 'accepted',
          listingId: 42,
          usdCents: 500,
          buyerAccepted: true,
          sellerAccepted: true,
          listingStatus: 'active',
        }),
      ],
    };
    r.controller.updateTradeWindow();
    await flushAsync();
    expect(c.wocTradeOffer?.id).toBe(8);
    expect(c.wocTradeSettlement, 'the old settlement dies with its deal').toBeNull();
    expect(c.wocTradeQuote, 'and so does its quote').toBeNull();
    // A settlement smuggled in under another offer id never signs.
    c.wocTradeSettlement = { offerId: 7, id: 5, usdCents: 100, deadlineAtMs: null };
    c.wocTradeQuote = {
      offerId: 7,
      totalTokens: 1,
      sellerTokens: null,
      burnTokens: null,
      treasuryTokens: null,
      usdCents: 100,
      expiresAtMs: null,
      reference: 'x',
      transactionBase64: 'dHg=',
      signatureRequired: false,
    } as unknown as Ctl['wocTradeQuote'];
    let confirms = 0;
    h.state.confirmSettlementImpl = () => {
      confirms += 1;
      return Promise.resolve({ ok: true, state: 'settled' });
    };
    await c.signWocTradeQuote();
    expect(confirms).toBe(0);
    vi.useRealTimers();
  });

  it('a poll beat DURING the claim never reads as a payment confirming (only a signature holds paying)', async () => {
    const h = fakeHooks();
    const gate = deferred<unknown>();
    h.state.buyNowImpl = () => gate.promise;
    vi.useFakeTimers();
    vi.setSystemTime(10_000_000);
    const { r, c } = await escrowedBuyer(h);
    h.state.offersResult = {
      ok: true,
      offers: [
        offerRow({
          status: 'accepted',
          listingId: 41,
          listingStatus: 'active',
          buyerAccepted: true,
          sellerAccepted: true,
        }),
      ],
    };
    const inFlight = c.payWocTradeOffer();
    expect(c.wocTradePaying).toBe(true);
    expect(c.wocTradeSigning, 'nothing was signed').toBe(false);
    // The 2s poll lands mid-claim.
    vi.setSystemTime(10_003_000);
    r.controller.updateTradeWindow();
    await flushAsync();
    expect(c.wocTradeOffer?.phase, 'the claim is not a payment').toBe('awaiting_payment');
    // The claim is refused (terms_required): the face is back to Pay with the
    // consent row, never a false 'Confirming your payment' spinner.
    gate.resolve({ ok: false, code: 'woc_market.terms_required' });
    await inFlight;
    expect(c.wocTradeOffer?.phase).toBe('awaiting_payment');
    expect(document.querySelector('#trade-window [data-woc-pay]')).not.toBeNull();
    expect(document.querySelector('#trade-window .trade-woc-waiting')).toBeNull();
    vi.useRealTimers();
  });

  it('a signature out with the wallet DOES hold the paying face across a poll beat', async () => {
    const h = fakeHooks();
    h.state.buyNowImpl = () => Promise.resolve(settled());
    const gate = deferred<unknown>();
    h.state.confirmSettlementImpl = () => gate.promise;
    vi.useFakeTimers();
    vi.setSystemTime(10_000_000);
    const { r, c } = await escrowedBuyer(h);
    h.state.offersResult = {
      ok: true,
      offers: [
        offerRow({
          status: 'accepted',
          listingId: 41,
          listingStatus: 'active',
          buyerAccepted: true,
          sellerAccepted: true,
        }),
      ],
    };
    await c.payWocTradeOffer();
    const signing = c.signWocTradeQuote();
    expect(c.wocTradeSigning).toBe(true);
    vi.setSystemTime(10_003_000);
    r.controller.updateTradeWindow();
    await flushAsync();
    expect(c.wocTradeOffer?.phase).toBe('paying');
    gate.resolve({ ok: true, state: 'confirming' });
    await signing;
    expect(c.wocTradeSigning).toBe(false);
    vi.useRealTimers();
  });

  it('a wallet decline on the PAY path restores the payable face with a classified line', async () => {
    const h = fakeHooks();
    h.state.buyNowImpl = () =>
      Promise.resolve({ ...settled(), quote: { ...settled().quote, signatureRequired: true } });
    h.state.signAndSendImpl = () => Promise.reject(new Error('User rejected the request.'));
    let confirms = 0;
    h.state.confirmSettlementImpl = () => {
      confirms += 1;
      return Promise.resolve({ ok: true, state: 'settled' });
    };
    const { r, c } = await escrowedBuyer(h);
    await c.payWocTradeOffer();
    await c.signWocTradeQuote();
    expect(confirms, 'nothing was sent, nothing confirms').toBe(0);
    expect(c.wocTradeOffer?.phase).toBe('awaiting_payment');
    expect(c.wocTradeQuote, 'the declined quote is spent').toBeNull();
    expect(c.wocTradeSettlement?.id, 'the held settlement survives for the re-quote').toBe(5);
    expect(r.host.logs.join('\n')).not.toContain('User rejected the request.');
    expect(r.host.logs).toContain(t('hudChrome.walletBridge.cancelled'));
  });

  it('an UNKNOWN wallet failure while signing renders the PAYMENT-flavored generic, never the sign one', async () => {
    // The classifier's flavor only shows through on an unknown message: the
    // controller's sign sink must ask for the payment flavor ("did not complete
    // the payment"), not the confirmation-signing copy the step-up arm uses.
    const h = fakeHooks();
    h.state.buyNowImpl = () =>
      Promise.resolve({ ...settled(), quote: { ...settled().quote, signatureRequired: true } });
    h.state.signAndSendImpl = () => Promise.reject(new Error('provider had a bad day'));
    const { r, c } = await escrowedBuyer(h);
    await c.payWocTradeOffer();
    await c.signWocTradeQuote();
    const joined = r.host.logs.join('\n');
    expect(r.host.logs.at(-1)).toBe(t('hudChrome.wocMarket.signFailed'));
    expect(joined).not.toContain(t('hudChrome.wocMarket.signFailedConfirm'));
    expect(joined).not.toContain('provider had a bad day');
  });

  it('the Pay claim in flight is in the repaint signature: the pressed button repaints disabled at once', async () => {
    // Mirror of the seller's Accept-in-flight pin: the buyer's Pay flag is the
    // ONLY thing that changes between the press and the quote landing, so it
    // must invalidate the signature or the pressed button keeps reading
    // pressable through both claim round trips.
    const h = fakeHooks();
    const { r, c } = await escrowedBuyer(h);
    (c as unknown as { wocTradeOfferPolledAtMs: number }).wocTradeOfferPolledAtMs =
      Date.now() + 1_000_000;
    r.controller.updateTradeWindow();
    const before = document.querySelector<HTMLButtonElement>('#trade-window [data-woc-pay]');
    expect(before, 'the payable face renders Pay').not.toBeNull();
    expect(before?.disabled).toBe(false);
    c.wocTradePaying = true;
    r.controller.updateTradeWindow();
    const during = document.querySelector<HTMLButtonElement>('#trade-window [data-woc-pay]');
    expect(during, 'the flag flip repainted the face').not.toBeNull();
    expect(during?.disabled, 'the pressed Pay reads disabled').toBe(true);
    c.wocTradePaying = false;
    r.controller.updateTradeWindow();
    const after = document.querySelector<HTMLButtonElement>('#trade-window [data-woc-pay]');
    expect(after?.disabled, 'and pressable again once the round trip ends').toBe(false);
  });

  it('a quote failure AFTER the claim keeps the settlement: the next Pay re-quotes without a second buyNow', async () => {
    const h = fakeHooks();
    h.state.buyNowImpl = () =>
      Promise.resolve({ ...settled(), quote: { ...settled().quote, transactionBase64: null } });
    let quotes = 0;
    h.state.settlementQuoteImpl = () => {
      quotes += 1;
      return Promise.resolve(
        quotes === 1
          ? { ok: false, code: 'woc_market.quote_unavailable' }
          : { ok: true, quote: settled().quote },
      );
    };
    const { c } = await escrowedBuyer(h);
    await c.payWocTradeOffer();
    expect(c.wocTradeQuote).toBeNull();
    expect(c.wocTradeSettlement?.id).toBe(5);
    await c.payWocTradeOffer();
    expect(c.wocTradeQuote?.totalTokens).toBe(812.5);
    expect(h.state.calls.buyNows).toBe(1);
    expect(quotes).toBe(2);
  });

  it("a double tap on Decline sends ONE resolve; a raced answer reads in the trade arm's words", async () => {
    const h = fakeHooks();
    const gate = deferred<void>();
    const client = h.hooks as unknown as {
      client: { resolveOffer: (id: number, action: string) => Promise<unknown> };
    };
    let calls = 0;
    client.client.resolveOffer = async () => {
      calls += 1;
      await gate.promise;
      return { ok: false, code: 'woc_market.not_pending' };
    };
    h.state.tradePartnerImpl = () =>
      Promise.resolve({ ok: true, partner: { name: 'Bree', walletVerified: true } });
    const r = rig(h.hooks);
    const c = r.controller as unknown as Ctl;
    openTrade(r);
    await flushAsync();
    c.wocTradeOffer = heldOffer({ role: 'seller' });
    const first = c.cancelWocTradeOffer('decline');
    const second = c.cancelWocTradeOffer('decline');
    // While in flight the control renders disabled.
    expect(
      document.querySelector<HTMLButtonElement>('#trade-window [data-woc-decline]')?.disabled,
    ).toBe(true);
    gate.resolve();
    await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(r.host.logs).toContain(t('hudChrome.trade.woc.offerNotPending'));
    expect(r.host.logs.join('\n')).not.toContain(t('apiError.woc_market.not_pending'));
  });

  it('a cancel answered CANCEL-PENDING is recorded on the face until the deal moves on', async () => {
    const h = fakeHooks();
    h.state.cancelListingImpl = () => Promise.resolve({ ok: true, cancelPending: true });
    h.state.tradePartnerImpl = () =>
      Promise.resolve({ ok: true, partner: { name: 'Bree', walletVerified: true } });
    const r = rig(h.hooks);
    const c = r.controller as unknown as Ctl;
    openTrade(r);
    await flushAsync();
    c.wocTradeOffer = heldOffer({
      role: 'seller',
      phase: 'awaiting_payment',
      listingId: 41,
      buyerAccepted: true,
      sellerAccepted: true,
    });
    await c.cancelWocDirectedSale();
    expect(c.wocTradeCancelPendingFor).toBe(7);
    expect(document.querySelector('#trade-window [data-woc-cancel-sale]')).toBeNull();
    expect(document.querySelector('#trade-window .trade-woc-waiting')?.textContent).toBe(
      t('hudChrome.trade.woc.cancelPendingSeller'),
    );
    // A second press cannot happen (no control), and the mark dies with the deal.
    c.wocTradeOffer = null;
    c.resolveClosedWocTrade();
    expect(c.wocTradeCancelPendingFor).toBeNull();
  });

  it("close-time lines: the resolved verdict, the seller's held copy, and a payment mid-flight", async () => {
    const cases: [Partial<WocOfferView>, string][] = [
      // The other side declined between the last poll and the close.
      [{ status: 'declined' }, t('hudChrome.trade.woc.offerDeclined')],
      // The seller closes while their copy is escrowed for the buyer's payment.
      [
        {
          status: 'accepted',
          role: 'seller',
          buyerName: 'Bree',
          sellerName: 'Aldric',
          listingId: 41,
          listingStatus: 'active',
          buyerAccepted: true,
          sellerAccepted: true,
        },
        t('hudChrome.trade.woc.closeSellerHold'),
      ],
      // Either side closes while the payment is confirming.
      [
        {
          status: 'accepted',
          listingId: 41,
          listingStatus: 'active',
          settlementState: 'confirming',
          buyerAccepted: true,
          sellerAccepted: true,
        },
        t('hudChrome.trade.woc.closePaymentContinuesBuyer'),
      ],
      [
        {
          status: 'accepted',
          role: 'seller',
          buyerName: 'Bree',
          sellerName: 'Aldric',
          listingId: 41,
          listingStatus: 'active',
          settlementState: 'delivering',
          buyerAccepted: true,
          sellerAccepted: true,
        },
        t('hudChrome.trade.woc.closePaymentContinuesSeller'),
      ],
      // Parked under review: the parked sentence, not "still being confirmed".
      [
        {
          status: 'accepted',
          listingId: 41,
          listingStatus: 'active',
          settlementState: 'review',
          buyerAccepted: true,
          sellerAccepted: true,
        },
        t('hudChrome.trade.woc.statusReviewBuyer'),
      ],
    ];
    for (const [row, line] of cases) {
      const h = fakeHooks();
      h.state.offersResult = { ok: true, offers: [offerRow(row)] };
      const r = rig(h.hooks);
      const c = r.controller as unknown as Ctl;
      openTrade(r);
      c.wocTradeOffer = heldOffer({
        role: row.role ?? 'buyer',
        phase: row.status === 'declined' ? 'review' : 'awaiting_payment',
        listingId: row.listingId ?? null,
      });
      r.host.tradeInfo = null;
      r.controller.updateTradeWindow();
      await flushAsync();
      expect(r.host.logs, JSON.stringify(row)).toContain(line);
    }
  });

  it('a quote that answers after the deal ended stages nothing either (the second guard)', async () => {
    // The claim's own quote lacked a transaction (an older service), so the
    // re-quote round trip runs; the deal ends while it is out.
    const h = fakeHooks();
    h.state.buyNowImpl = () =>
      Promise.resolve({ ...settled(), quote: { ...settled().quote, transactionBase64: null } });
    const gate = deferred<unknown>();
    h.state.settlementQuoteImpl = () => gate.promise;
    const { c } = await escrowedBuyer(h);
    const inFlight = c.payWocTradeOffer();
    await flushAsync();
    c.wocTradeOffer = null;
    gate.resolve({ ok: true, quote: settled().quote });
    await inFlight;
    expect(c.wocTradeQuote, 'no quote staged for a dead deal').toBeNull();
    expect(c.wocTradeSettlement, 'the claim stays keyed').toMatchObject({ offerId: 7, id: 5 });
  });

  it('Sign refuses a settlement keyed to ANOTHER offer even when the quote names this one', async () => {
    const h = fakeHooks();
    let confirms = 0;
    h.state.confirmSettlementImpl = () => {
      confirms += 1;
      return Promise.resolve({ ok: true, state: 'settled' });
    };
    const { c } = await escrowedBuyer(h);
    c.wocTradeOffer = heldOffer({
      id: 8,
      role: 'buyer',
      phase: 'awaiting_payment',
      listingId: 42,
      buyerAccepted: true,
      sellerAccepted: true,
    });
    c.wocTradeSettlement = { offerId: 7, id: 5, usdCents: 100, deadlineAtMs: null };
    c.wocTradeQuote = {
      offerId: 8,
      totalTokens: 1,
      sellerTokens: null,
      burnTokens: null,
      treasuryTokens: null,
      usdCents: 100,
      expiresAtMs: null,
      reference: 'x',
      transactionBase64: 'dHg=',
      signatureRequired: false,
    } as unknown as Ctl['wocTradeQuote'];
    await c.signWocTradeQuote();
    expect(confirms).toBe(0);
  });

  it('a double tap on Cancel sale sends ONE cancel', async () => {
    const h = fakeHooks();
    const gate = deferred<unknown>();
    h.state.cancelListingImpl = () => gate.promise;
    h.state.tradePartnerImpl = () =>
      Promise.resolve({ ok: true, partner: { name: 'Bree', walletVerified: true } });
    const r = rig(h.hooks);
    const c = r.controller as unknown as Ctl;
    openTrade(r);
    await flushAsync();
    c.wocTradeOffer = heldOffer({
      role: 'seller',
      phase: 'awaiting_payment',
      listingId: 41,
      buyerAccepted: true,
      sellerAccepted: true,
    });
    const first = c.cancelWocDirectedSale();
    const second = c.cancelWocDirectedSale();
    gate.resolve({ ok: true });
    await Promise.all([first, second]);
    expect(h.state.calls.cancelListings).toEqual([41]);
  });

  it('closing the window while the signature is out never prints the strike warning', async () => {
    // The row still reads 'offered' (the signature is not in yet); the buyer
    // is mid-payment, so the close-time line says the payment continues, not
    // that the deal awaits payment on pain of a strike.
    const h = fakeHooks();
    h.state.buyNowImpl = () =>
      Promise.resolve({ ...settled(), quote: { ...settled().quote, signatureRequired: true } });
    const gate = deferred<string>();
    h.state.signAndSendImpl = () => gate.promise;
    h.state.confirmSettlementImpl = () => Promise.resolve({ ok: true, state: 'confirming' });
    h.state.offersResult = {
      ok: true,
      offers: [
        offerRow({
          status: 'accepted',
          listingId: 41,
          listingStatus: 'active',
          settlementState: 'offered',
          buyerAccepted: true,
          sellerAccepted: true,
        }),
      ],
    };
    const { r, c } = await escrowedBuyer(h);
    await c.payWocTradeOffer();
    const signing = c.signWocTradeQuote();
    expect(c.wocTradeSigning).toBe(true);
    r.host.tradeInfo = null;
    r.controller.updateTradeWindow();
    await flushAsync();
    expect(r.host.logs).toContain(t('hudChrome.trade.woc.closePaymentContinuesBuyer'));
    expect(r.host.logs).not.toContain(t('hudChrome.trade.woc.dealAwaitsPayment'));
    gate.resolve('sig');
    await signing;
  });

  it('the /status answer supplies the payment hold the commitment note names', async () => {
    const h = fakeHooks();
    h.state.statusImpl = () =>
      Promise.resolve({ ok: true, enabled: true, minPriceCents: 100, directedHoldSeconds: 600 });
    const r = rig(h.hooks);
    const c = r.controller as unknown as Ctl;
    openTrade(r);
    await flushAsync();
    expect(c.wocTradeDirectedHoldSeconds).toBe(600);
    // An older server without the field leaves the untimed note.
    const h2 = fakeHooks();
    h2.state.statusImpl = () => Promise.resolve({ ok: true, enabled: true, minPriceCents: 100 });
    const r2 = rig(h2.hooks);
    openTrade(r2);
    await flushAsync();
    expect((r2.controller as unknown as Ctl).wocTradeDirectedHoldSeconds).toBeNull();
  });
});

describe('the partner lookup is a verdict only when it ANSWERED', () => {
  interface PartnerCtl {
    wocTradePartner: { name: string; walletVerified: boolean } | null;
    wocTradePartnerResolved: boolean;
    wocTradePartnerFor: string;
    wocTradePartnerRetryAtMs: number;
  }

  it('a FAILED lookup (429, outage) leaves the arm unresolved and retries after the pause', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const h = fakeHooks();
    let lookups = 0;
    h.state.tradePartnerImpl = () => {
      lookups++;
      return Promise.resolve({ ok: false });
    };
    const r = rig(h.hooks);
    const c = r.controller as unknown as PartnerCtl;
    openTrade(r);
    await flushAsync();
    // NOT resolved: rendering the failure as "recipient has no wallet"
    // asserted a verdict the client never learned.
    expect(lookups).toBe(1);
    expect(c.wocTradePartnerResolved).toBe(false);
    expect(c.wocTradePartner).toBeNull();
    // Repaints inside the backoff window re-issue NOTHING (the lookup rides
    // the 30/min quote bucket, so hammering a refusing bucket digs deeper);
    // one millisecond before the boundary is still inside.
    r.controller.updateTradeWindow();
    await flushAsync();
    vi.setSystemTime(1_000_000 + 4_999);
    r.controller.updateTradeWindow();
    await flushAsync();
    expect(lookups).toBe(1);
    // At exactly the pause the lookup retries; a second failure RE-ARMS the
    // backoff (an unarmed retry would re-fire on every later paint, which is
    // exactly the hammering the pause exists to stop).
    vi.setSystemTime(1_000_000 + 5_000);
    r.controller.updateTradeWindow();
    await flushAsync();
    expect(lookups).toBe(2);
    vi.setSystemTime(1_000_000 + 5_000 + 4_999);
    r.controller.updateTradeWindow();
    await flushAsync();
    expect(lookups).toBe(2);
    // Past the SECOND window a now-healthy answer resolves.
    h.state.tradePartnerImpl = () => {
      lookups++;
      return Promise.resolve({ ok: true, partner: { name: 'Bree', walletVerified: true } });
    };
    vi.setSystemTime(1_000_000 + 5_000 + 5_000);
    r.controller.updateTradeWindow();
    await flushAsync();
    expect(lookups).toBe(3);
    expect(c.wocTradePartnerResolved).toBe(true);
    expect(c.wocTradePartner).toEqual({ name: 'Bree', walletVerified: true });
    vi.useRealTimers();
  });

  it('an ANSWERED no-such-character (ok with null partner) resolves as the honest no-wallet verdict', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const h = fakeHooks();
    h.state.tradePartnerImpl = () => Promise.resolve({ ok: true, partner: null });
    const r = rig(h.hooks);
    const c = r.controller as unknown as PartnerCtl;
    openTrade(r);
    await flushAsync();
    expect(c.wocTradePartnerResolved).toBe(true);
    expect(c.wocTradePartner).toBeNull();
    vi.useRealTimers();
  });

  it('closing the trade clears the retry backoff so the next trade looks up immediately', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const h = fakeHooks();
    let lookups = 0;
    h.state.tradePartnerImpl = () => {
      lookups++;
      return Promise.resolve({ ok: false });
    };
    const r = rig(h.hooks);
    const c = r.controller as unknown as PartnerCtl;
    openTrade(r);
    await flushAsync();
    expect(lookups).toBe(1);
    expect(c.wocTradePartnerRetryAtMs).toBeGreaterThan(0);
    r.host.tradeInfo = null;
    r.controller.updateTradeWindow();
    await flushAsync();
    expect(c.wocTradePartnerRetryAtMs).toBe(0);
    h.state.tradePartnerImpl = () =>
      Promise.resolve({ ok: true, partner: { name: 'Bree', walletVerified: true } });
    openTrade(r);
    await flushAsync();
    // A fresh trade is never taxed with the previous trade's backoff.
    expect(c.wocTradePartnerResolved).toBe(true);
    vi.useRealTimers();
  });
});
