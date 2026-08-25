// The economy-service client for the exchange (server/woc_market_proxy.ts). This
// file exists because the OTHER side of this contract lives in a different repo
// (woc-daily-payout-service, service/src/market/routes.ts), so nothing in this
// repository can catch a drift by compiling. The paths, the header and the request
// bodies are pinned here as literals against the service's documented surface.
//
// The bug this was written after: these calls used absolute '/internal/market/*'
// paths resolved against WOC_ECONOMY_SERVICE_URL, which already points inside
// '/v1/claudium/'. Every marketplace request therefore addressed
// '/v1/claudium/internal/market/...', a path the service does not serve, and the
// only symptom was the exchange quietly reporting itself unavailable forever.

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_woc_market_proxy';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDevWocMarketEconomy,
  createWocMarketEconomyProxy,
} from '../../server/woc_market_proxy';

const BASE = 'http://economy.test/v1/market/';
const SECRET = 'internal-secret';
const BUYER = '4Nd1mYQ3rTFAMFsQmM1qEBQrPYcJUyJK1XdxAxLwEjqL';
const SELLER = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let seen: Seen[] = [];
let respond: (url: string) => { status: number; body: unknown };

beforeEach(() => {
  seen = [];
  respond = () => ({ status: 200, body: {} });
  process.env.WOC_MARKET_SERVICE_URL = BASE;
  process.env.WOC_ECONOMY_INTERNAL_SECRET = SECRET;
  vi.stubGlobal('fetch', async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    );
    seen.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const { status, body } = respond(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WOC_MARKET_SERVICE_URL;
  delete process.env.WOC_ECONOMY_INTERNAL_SECRET;
});

describe('the exchange base URL is its own, not the claudium one', () => {
  it('resolves every call beneath WOC_MARKET_SERVICE_URL', async () => {
    respond = () => ({ status: 200, body: { healthy: true, tokensPerUsd: 1000, asOfMs: 1 } });
    await createWocMarketEconomyProxy().price();
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('http://economy.test/v1/market/price');
  });

  it('reads WOC_MARKET_SERVICE_URL, never WOC_ECONOMY_SERVICE_URL', async () => {
    // The claudium base ends in /v1/claudium/. If this client ever falls back to
    // it, every request lands inside the wrong prefix and the exchange silently
    // reports unavailable, which is indistinguishable from "not deployed yet".
    delete process.env.WOC_MARKET_SERVICE_URL;
    process.env.WOC_ECONOMY_SERVICE_URL = 'http://economy.test/v1/claudium/';
    const price = await createWocMarketEconomyProxy().price();
    expect(seen, 'no request may be made without the exchange base').toHaveLength(0);
    expect(price.available).toBe(false);
    expect(price.reason).toBe('service_unavailable');
    delete process.env.WOC_ECONOMY_SERVICE_URL;
  });

  it('tolerates a base with no trailing slash without eating the last segment', async () => {
    // new URL('price', '.../v1/market') would resolve to '.../v1/price'.
    process.env.WOC_MARKET_SERVICE_URL = 'http://economy.test/v1/market';
    respond = () => ({ status: 200, body: { healthy: true, tokensPerUsd: 1000, asOfMs: 1 } });
    await createWocMarketEconomyProxy().price();
    expect(seen[0].url).toBe('http://economy.test/v1/market/price');
  });
});

describe('the base URL may not carry the secret onto the open internet', () => {
  // Every call ships WOC_ECONOMY_INTERNAL_SECRET in a header, so plain HTTP
  // is allowed only to hosts that cannot be public: loopback, a single-label
  // docker service name, host.docker.internal, RFC1918 addresses, and the
  // reserved suffixes (.test keeps this suite's own base legal). Anything
  // else must be HTTPS; a refusal maps to the normal unavailable shape and
  // makes NO request.
  it.each([
    ['a public http host', 'http://economy.example.com/v1/market/'],
    ['embedded credentials', 'https://user:pw@economy.example.com/v1/market/'],
    ['a non-http scheme', 'ftp://economy.test/v1/market/'],
    ['an unparseable base', 'not a url'],
    // A public IPv6 literal is dotless, so it must not ride the single-label
    // docker-name branch; only [::1] loopback may carry the secret in the clear.
    ['a public http IPv6 host', 'http://[2001:db8::1]:8798/v1/market/'],
  ])('refuses %s without calling out', async (_label, base) => {
    process.env.WOC_MARKET_SERVICE_URL = base;
    const price = await createWocMarketEconomyProxy().price();
    expect(seen, base).toHaveLength(0);
    expect(price.available).toBe(false);
    expect(price.reason).toBe('service_unavailable');
  });

  it.each([
    ['https to a public host', 'https://economy.example.com/v1/market/'],
    ['http to loopback', 'http://127.0.0.1:8798/v1/market/'],
    ['http to a docker service name', 'http://economy:8798/v1/market/'],
    ['http to the docker host alias', 'http://host.docker.internal:8798/v1/market/'],
    ['http to an RFC1918 address', 'http://10.0.0.7:8798/v1/market/'],
    ['http to IPv6 loopback', 'http://[::1]:8798/v1/market/'],
  ])('allows %s', async (_label, base) => {
    process.env.WOC_MARKET_SERVICE_URL = base;
    respond = () => ({ status: 200, body: { healthy: true, tokensPerUsd: 1000, asOfMs: 1 } });
    await createWocMarketEconomyProxy().price();
    expect(seen, base).toHaveLength(1);
  });
});

describe('the wire contract with the service', () => {
  it('sends the shared internal secret as x-woc-economy-secret on every call', async () => {
    respond = () => ({ status: 200, body: { ok: true, amount: { base: '1', tokens: 1 } } });
    await createWocMarketEconomyProxy().estimate(100);
    expect(seen[0].headers['x-woc-economy-secret']).toBe(SECRET);
    // And never the ADMIN secret: the game must not be able to reach ops paths.
    expect(Object.keys(seen[0].headers)).not.toContain('x-woc-economy-admin-secret');
  });

  it.each([
    ['price', 'GET', 'price'],
    ['estimate', 'POST', 'estimate'],
    ['bondQuote', 'POST', 'bond-quote'],
    ['settlementQuote', 'POST', 'settlement-quote'],
    ['confirm', 'POST', 'confirm'],
    ['refundBond', 'POST', 'bond-refund'],
    ['forfeitBond', 'POST', 'bond-forfeit'],
  ])('%s calls %s %s, the path the service registers', async (method, verb, path) => {
    respond = () => ({ status: 200, body: { ok: true, healthy: true, settled: true, done: true } });
    const economy = createWocMarketEconomyProxy();
    switch (method) {
      case 'price':
        await economy.price();
        break;
      case 'estimate':
        await economy.estimate(1234);
        break;
      case 'bondQuote':
        await economy.bondQuote({
          memoRef: 'woc_bond:1',
          bidCents: 2500,
          usdCents: 125,
          buyerWallet: BUYER,
        });
        break;
      case 'settlementQuote':
        await economy.settlementQuote({
          memoRef: 'woc_settle:1',
          usdCents: 10_000,
          buyerWallet: BUYER,
          sellerWallet: SELLER,
        });
        break;
      case 'confirm':
        await economy.confirm('WMB_ref', 'sig');
        break;
      case 'refundBond':
        await economy.refundBond('WMB_ref');
        break;
      default:
        await economy.forfeitBond('WMB_ref');
    }
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe(verb);
    expect(seen[0].url).toBe(`${BASE}${path}`);
  });

  it('sends the exact body fields the service reads', async () => {
    respond = () => ({ status: 200, body: { ok: true } });
    const economy = createWocMarketEconomyProxy();
    // bidCents is what the service computes the bond FROM; usdCents stays the
    // optional echo of a stored figure. Both cross the wire verbatim.
    await economy.bondQuote({
      memoRef: 'woc_bond:7',
      bidCents: 2500,
      usdCents: 125,
      buyerWallet: BUYER,
    });
    expect(seen[0].body).toEqual({
      memoRef: 'woc_bond:7',
      bidCents: 2500,
      usdCents: 125,
      buyerWallet: BUYER,
    });

    seen = [];
    await economy.settlementQuote({
      memoRef: 'woc_settle:7',
      usdCents: 10_000,
      buyerWallet: BUYER,
      sellerWallet: SELLER,
    });
    expect(seen[0].body).toEqual({
      memoRef: 'woc_settle:7',
      usdCents: 10_000,
      buyerWallet: BUYER,
      sellerWallet: SELLER,
    });

    seen = [];
    await economy.confirm('WMB_ref', 'sig');
    expect(seen[0].body).toEqual({ reference: 'WMB_ref', signature: 'sig' });

    seen = [];
    await economy.refundBond('WMB_ref');
    expect(seen[0].body).toEqual({ reference: 'WMB_ref' });
  });

  it('parses the service quote shape into the game view verbatim', async () => {
    respond = () => ({
      status: 200,
      body: {
        ok: true,
        reference: 'WMS_abc',
        transactionBase64: 'TX',
        amount: { base: '100', tokens: 1 },
        seller: { base: '90', tokens: 0.9 },
        burn: { base: '3', tokens: 0.03 },
        treasury: { base: '7', tokens: 0.07 },
        expiresAtMs: 42,
      },
    });
    const quote = await createWocMarketEconomyProxy().settlementQuote({
      memoRef: 'woc_settle:1',
      usdCents: 10_000,
      buyerWallet: BUYER,
      sellerWallet: SELLER,
    });
    expect(quote.ok).toBe(true);
    expect(quote.reference).toBe('WMS_abc');
    expect(quote.transactionBase64).toBe('TX');
    expect(quote.seller).toEqual({ base: '90', tokens: 0.9 });
    expect(quote.burn).toEqual({ base: '3', tokens: 0.03 });
    expect(quote.treasury).toEqual({ base: '7', tokens: 0.07 });
    expect(quote.expiresAtMs).toBe(42);
  });
});

describe('graceful degradation is the contract', () => {
  it('a refusal from the service carries its reason through, never throws', async () => {
    respond = () => ({ status: 200, body: { ok: false, reason: 'operator_paused' } });
    const quote = await createWocMarketEconomyProxy().bondQuote({
      memoRef: 'woc_bond:1',
      bidCents: 2500,
      usdCents: 125,
      buyerWallet: BUYER,
    });
    expect(quote.ok).toBe(false);
    expect(quote.reason).toBe('operator_paused');
  });

  it('a bond_amount_drift refusal carries the expected bondCents to adopt', async () => {
    respond = () => ({
      status: 200,
      body: { ok: false, reason: 'bond_amount_drift', bondCents: 126 },
    });
    const quote = await createWocMarketEconomyProxy().bondQuote({
      memoRef: 'woc_bond:1',
      bidCents: 2500,
      usdCents: 125,
      buyerWallet: BUYER,
    });
    expect(quote.ok).toBe(false);
    expect(quote.reason).toBe('bond_amount_drift');
    expect(quote.bondCents).toBe(126);
  });

  it('passes a valid bondCents through the OK arm by value', async () => {
    // The production path from the live service: without this, a hard-coded
    // null in toQuote's ok branch stays green (only the refusal arm carried
    // a positive figure before).
    respond = () => ({
      status: 200,
      body: { ok: true, reference: 'WMB_x', expiresAtMs: 42, bondCents: 126 },
    });
    const quote = await createWocMarketEconomyProxy().bondQuote({
      memoRef: 'woc_bond:1',
      bidCents: 2500,
      buyerWallet: BUYER,
    });
    expect(quote.ok).toBe(true);
    expect(quote.bondCents).toBe(126);
  });

  it.each([
    ['negative', -5],
    ['zero', 0],
    ['non-integer', 12.5],
    ['string', '126'],
  ])('screens a %s bondCents to null rather than adopting it', async (_label, junk) => {
    // Per-dimension: each case trips exactly one arm of the screen.
    respond = () => ({
      status: 200,
      body: { ok: true, reference: 'WMB_x', expiresAtMs: 42, bondCents: junk },
    });
    const quote = await createWocMarketEconomyProxy().bondQuote({
      memoRef: 'woc_bond:1',
      bidCents: 2500,
      buyerWallet: BUYER,
    });
    expect(quote.ok).toBe(true);
    expect(quote.bondCents).toBeNull();
  });

  it('an HTTP error becomes an unavailable result, never an exception', async () => {
    // The game pauses trading on unavailable. A throw here would surface inside
    // request handling instead.
    respond = () => ({ status: 500, body: { error: 'internal' } });
    const economy = createWocMarketEconomyProxy();
    await expect(economy.price()).resolves.toMatchObject({ available: false, healthy: false });
    await expect(economy.estimate(100)).resolves.toMatchObject({ available: false });
    await expect(
      economy.bondQuote({
        memoRef: 'woc_bond:1',
        bidCents: 2500,
        usdCents: 125,
        buyerWallet: BUYER,
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'service_unavailable' });
    await expect(economy.refundBond('WMB_x')).resolves.toEqual({
      done: false,
      reason: null,
    });
  });

  it('an unreachable service leaves confirm PENDING, never terminally failed', async () => {
    // The single most consequential degradation: the game holds the buyer's item
    // while a confirm is pending. Reporting a terminal failure because the service
    // was briefly unreachable would strand a buyer who already paid.
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED');
    });
    const result = await createWocMarketEconomyProxy().confirm('WMS_ref', 'sig');
    expect(result).toEqual({ settled: false, pending: true, reason: 'service_unavailable' });
  });

  it('an unset secret makes no request at all', async () => {
    delete process.env.WOC_ECONOMY_INTERNAL_SECRET;
    const price = await createWocMarketEconomyProxy().price();
    expect(seen).toHaveLength(0);
    expect(price.available).toBe(false);
  });
});

describe('the price and estimate caches at the proxy (H11)', () => {
  // The proxy captures its clock at construction, so the fake Date must be
  // installed BEFORE createWocMarketEconomyProxy (the captured-clock rule).
  afterEach(() => {
    vi.useRealTimers();
  });

  const healthyBody = { healthy: true, tokensPerUsd: 100, asOfMs: 1_799_000_400_000 };

  it('a failed refresh does not blank a still-recent healthy price (stale-while-revalidate)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_820_000_000_000);
    respond = () => ({ status: 200, body: healthyBody });
    const economy = createWocMarketEconomyProxy();
    const first = await economy.price();
    expect(first.healthy).toBe(true);
    // Past the 15s TTL, inside the 30s stale-serve bound, with the service
    // now DOWN: the read serves the recent healthy value immediately instead
    // of blanking the market for a full TTL (the H11 finding).
    vi.setSystemTime(1_820_000_016_000);
    respond = () => ({ status: 500, body: {} });
    const during = await economy.price();
    expect(during.healthy).toBe(true);
    // Let the background probe settle; the healthy value still stands.
    await Promise.resolve();
    await Promise.resolve();
    const after = await economy.price();
    expect(after.healthy).toBe(true);
  });

  it('a cold failure is cached briefly, so recovery is visible in seconds, not a TTL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_820_000_000_000);
    respond = () => ({ status: 500, body: {} });
    const economy = createWocMarketEconomyProxy();
    expect((await economy.price()).available).toBe(false);
    // 3.1 seconds later the service is back. The old cache stored the failure
    // for the full 15s TTL, so this exact read used to answer unavailable
    // (and keep the market paused) for another twelve seconds.
    vi.setSystemTime(1_820_000_003_100);
    respond = () => ({ status: 200, body: healthyBody });
    const recovered = await economy.price();
    expect(recovered.available).toBe(true);
    expect(recovered.healthy).toBe(true);
  });

  it('concurrent cold price reads share ONE service call (single-flight)', async () => {
    respond = () => ({ status: 200, body: healthyBody });
    const economy = createWocMarketEconomyProxy();
    const [a, b, c] = await Promise.all([economy.price(), economy.price(), economy.price()]);
    expect(seen).toHaveLength(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('an UNAVAILABLE estimate is cached for the full TTL like a success (the documented storm guard)', async () => {
    respond = () => ({ status: 500, body: {} });
    const economy = createWocMarketEconomyProxy();
    expect((await economy.estimate(700)).available).toBe(false);
    expect((await economy.estimate(700)).available).toBe(false);
    // ONE call: re-probing per read during an outage is the storm the cache
    // exists to prevent (deliberately unlike the price read's short memo;
    // estimates degrade to a missing line, prices pause the market).
    expect(seen).toHaveLength(1);
  });

  it('concurrent estimates for one amount share ONE service call; a new amount pays its own', async () => {
    respond = () => ({
      status: 200,
      body: { ok: true, amount: { base: '1', tokens: 1 }, asOfMs: 1 },
    });
    const economy = createWocMarketEconomyProxy();
    await Promise.all([economy.estimate(700), economy.estimate(700), economy.estimate(700)]);
    expect(seen).toHaveLength(1);
    await economy.estimate(701);
    expect(seen).toHaveLength(2);
  });

  it('the shared estimate is FROZEN: an in-place edit by one consumer throws instead of corrupting', async () => {
    respond = () => ({
      status: 200,
      body: {
        ok: true,
        amount: { base: '1', tokens: 1 },
        asOfMs: 1,
        split: { sellerCents: 630, burnCents: 35, treasuryCents: 35 },
      },
    });
    const economy = createWocMarketEconomyProxy();
    const estimate = await economy.estimate(700);
    // The same object serves every caller for a TTL window (pinned above),
    // so mutation is the corruption vector; freezing turns it into the
    // mutator's own TypeError (the read-cache freezeShared discipline).
    expect(Object.isFrozen(estimate)).toBe(true);
    expect(Object.isFrozen(estimate.amount)).toBe(true);
    expect(Object.isFrozen(estimate.split)).toBe(true);
    expect(() => {
      (estimate as { usdCents: number }).usdCents = 1;
    }).toThrow(TypeError);
  });

  it('priceCacheAges() reports the memo ages for the ops readout (null before any answer)', async () => {
    respond = () => ({ status: 200, body: healthyBody });
    const economy = createWocMarketEconomyProxy();
    expect(economy.priceCacheAges?.()).toEqual({ successAgeMs: null, failureAgeMs: null });
    await economy.price();
    const afterSuccess = economy.priceCacheAges?.();
    expect(afterSuccess?.successAgeMs).toBeGreaterThanOrEqual(0);
    expect(afterSuccess?.failureAgeMs).toBeNull();
  });

  it('priceCacheAges() reports the FAILURE memo age too (the brownout number)', async () => {
    respond = () => ({ status: 502, body: {} });
    const economy = createWocMarketEconomyProxy();
    await economy.price();
    const ages = economy.priceCacheAges?.();
    expect(ages?.failureAgeMs).toBeGreaterThanOrEqual(0);
    expect(ages?.successAgeMs).toBeNull();
  });
});

describe('the estimate fee split is accepted only when it reconciles', () => {
  // This figure is shown to a seller as the money they will receive, so a split
  // that does not add up is not a rounding disagreement, it is a different sale.
  // Every rejection below must surface as "no split" and never as a wrong number.
  const withSplit = (split: unknown) => () => ({
    status: 200,
    body: { ok: true, amount: { base: '1', tokens: 1 }, asOfMs: 1, split },
  });

  it('passes a split whose legs sum to the amount', async () => {
    respond = withSplit({ sellerCents: 90, burnCents: 3, treasuryCents: 7 });
    const est = await createWocMarketEconomyProxy().estimate(100);
    expect(est.split).toEqual({ sellerCents: 90, burnCents: 3, treasuryCents: 7 });
  });

  it('reports no split when the service omits it (an older build)', async () => {
    respond = () => ({ status: 200, body: { ok: true, amount: { base: '1', tokens: 1 } } });
    const est = await createWocMarketEconomyProxy().estimate(100);
    expect(est.available).toBe(true);
    expect(est.split).toBeNull();
  });

  it('refuses a split that does not sum to the amount', async () => {
    // One cent short: the shape is perfect and the number is a lie.
    respond = withSplit({ sellerCents: 89, burnCents: 3, treasuryCents: 7 });
    expect((await createWocMarketEconomyProxy().estimate(100)).split).toBeNull();
  });

  it('refuses non-integer, negative, and missing legs', async () => {
    for (const bad of [
      { sellerCents: 90.5, burnCents: 3, treasuryCents: 6.5 },
      { sellerCents: 104, burnCents: -1, treasuryCents: -3 },
      { sellerCents: 90, burnCents: 3 },
      { sellerCents: '90', burnCents: 3, treasuryCents: 7 },
    ]) {
      respond = withSplit(bad);
      expect(
        (await createWocMarketEconomyProxy().estimate(100)).split,
        JSON.stringify(bad),
      ).toBeNull();
    }
  });

  it('reports no split when the estimate itself is unavailable', async () => {
    respond = () => ({ status: 200, body: { ok: false, reason: 'unhealthy' } });
    const est = await createWocMarketEconomyProxy().estimate(100);
    expect(est.available).toBe(false);
    expect(est.split).toBeNull();
  });
});

describe('signatureRequired is fail-safe at the proxy', () => {
  // The client skips the wallet ONLY on an explicit false; a service that
  // omits the field is NOT saying "no signature needed". Rewriting the
  // fallback as `=== true` or `!!` turns an old service into a skip-the-
  // wallet permission slip, and the confirm leg then receives a fabricated
  // signature on a real charge.
  it('an ABSENT field means the wallet signs', async () => {
    respond = () => ({
      status: 200,
      body: { ok: true, reference: 'WMB_x', expiresAtMs: 42 },
    });
    const quote = await createWocMarketEconomyProxy().bondQuote({
      memoRef: 'woc_bond:1',
      bidCents: 2500,
      buyerWallet: BUYER,
    });
    expect(quote.ok).toBe(true);
    expect(quote.signatureRequired, 'absent means TRUE, never permission to skip').toBe(true);
  });

  it('only an explicit false crosses as false', async () => {
    respond = () => ({
      status: 200,
      body: { ok: true, reference: 'WMB_x', expiresAtMs: 42, signatureRequired: false },
    });
    const quote = await createWocMarketEconomyProxy().bondQuote({
      memoRef: 'woc_bond:1',
      bidCents: 2500,
      buyerWallet: BUYER,
    });
    expect(quote.signatureRequired).toBe(false);
  });
});

describe('devSplit mirrors the service ceil-and-remainder rule at every edge', () => {
  it('legs are non-negative and sum to the amount across the floor and odd cents', async () => {
    const economy = createDevWocMarketEconomy(() => 1_000_000);
    const amounts = [...Array.from({ length: 25 }, (_, i) => i + 1), 99, 101, 2001];
    for (const cents of amounts) {
      const est = await economy.estimate(cents);
      const split = est.split;
      expect(split, `estimate(${cents}) carries a split`).not.toBeNull();
      if (!split) continue;
      expect(split.sellerCents, `sellerCents at ${cents}`).toBeGreaterThanOrEqual(0);
      expect(split.burnCents, `burnCents at ${cents}`).toBeGreaterThanOrEqual(0);
      expect(split.treasuryCents, `treasuryCents at ${cents}`).toBeGreaterThanOrEqual(0);
      expect(
        split.sellerCents + split.burnCents + split.treasuryCents,
        `legs sum exactly at ${cents}`,
      ).toBe(cents);
    }
  });

  it('rounds each fee leg UP with the seller absorbing the remainder (ceil, never floor)', async () => {
    const economy = createDevWocMarketEconomy(() => 1_000_000);
    // 2001 at 300/700 bps: burn ceil(60.03) = 61 where floor gave 60, and
    // treasury ceil(140.07) = 141 where floor gave 140. The market floor
    // (25) pins the smallest legal listing's exact legs.
    expect((await economy.estimate(2001)).split).toEqual({
      sellerCents: 1799,
      burnCents: 61,
      treasuryCents: 141,
    });
    expect((await economy.estimate(25)).split).toEqual({
      sellerCents: 22,
      burnCents: 1,
      treasuryCents: 2,
    });
  });

  it('the settlement quote legs are the SAME split the estimate showed', async () => {
    // The 09-named cent-level drift: the settlement legs once used floor
    // 90/3 while the estimate ceiled, so the panel promised one figure and
    // the quote charged another on odd amounts.
    const economy = createDevWocMarketEconomy(() => 1_000_000);
    const est = await economy.estimate(2001);
    const quote = await economy.settlementQuote({
      memoRef: 'woc_settle:1',
      usdCents: 2001,
      buyerWallet: 'buyer',
      sellerWallet: 'seller',
    });
    if (!quote.ok || !est.split) throw new Error('dev quote or split unavailable');
    // devLeg: tokens = cents * 10_000 micro-USD / the fixed dev price (1000).
    const price = 1000;
    expect(quote.seller?.tokens).toBe((est.split.sellerCents * 10_000) / price);
    expect(quote.burn?.tokens).toBe((est.split.burnCents * 10_000) / price);
    expect(quote.treasury?.tokens).toBe((est.split.treasuryCents * 10_000) / price);
  });

  it('a dev settlement quote never carries a bond figure', async () => {
    const economy = createDevWocMarketEconomy(() => 1_000_000);
    const quote = await economy.settlementQuote({
      memoRef: 'woc_settle:2',
      usdCents: 5000,
      buyerWallet: 'buyer',
      sellerWallet: 'seller',
    });
    if (!quote.ok) throw new Error('dev quote unavailable');
    expect(quote.bondCents).toBeNull();
  });
});
