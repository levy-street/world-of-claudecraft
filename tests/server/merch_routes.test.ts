// Unit coverage for the merch route layer (server/merch.ts).
//
// The merch family registers six RouteDefs the shared dispatcher serves (plus the
// legacy prefix-arm twin in server/main.ts, parity by construction through the
// shared handleMerchApi core):
//   - two public webhook relays (POST /api/merch/{stripe,printful}/webhook);
//   - the public catalog probe (GET /api/merch/products);
//   - the bearer-gated player trio (POST /api/merch/checkout,
//     POST /api/merch/checkout/native/confirm, GET /api/merch/orders), each gated
//     by the shared legacy-body activeGuard (createActiveGuard over the lazy
//     guard db).
//
// Everything downstream is the fail-closed merch_proxy: with MERCH_STORE_ENABLED
// unset every handler answers its typed unavailable/invalid body, so no fetch and
// no Postgres is ever touched here.
//
// server/db builds a pg Pool at module load and throws if DATABASE_URL is unset;
// a dummy URL is set before the module graph evaluates. The pool never connects:
// the guard reads go through setMerchDbForTests.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_merch_routes';

import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountModerationStatus } from '../../server/db';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Method, Middleware } from '../../server/http/types';
import {
  handleMerchApi,
  merchPreAuthMutationRateLimited,
  resetMerchDbForTests,
  routes,
  setMerchDbForTests,
} from '../../server/merch';
import { resetMerchProductsCacheForTests } from '../../server/merch_proxy';
import {
  MERCH_CHECKOUT_MAX_PER_MINUTE,
  MERCH_CONFIRM_MAX_PER_MINUTE,
  resetMerchMutationRateLimits,
} from '../../server/ratelimit';
import { FakeRes, fakeCtx, makeReq } from './helpers';

// A well-formed bearer header (64 lowercase-hex, matching the guard BEARER_PATTERN).
const BEARER = `Bearer ${'a'.repeat(64)}`;

const PUBLIC_PATHS: ReadonlyArray<readonly [Method, string]> = [
  ['POST', '/api/merch/stripe/webhook'],
  ['POST', '/api/merch/printful/webhook'],
  ['GET', '/api/merch/products'],
];
const PLAYER_PATHS: ReadonlyArray<readonly [Method, string]> = [
  ['POST', '/api/merch/checkout'],
  ['POST', '/api/merch/checkout/native/confirm'],
  ['GET', '/api/merch/orders'],
];
// The money mutations additionally carry the claudium-style two-tier limits.
const MONETARY_MUTATION_ROUTES = [
  { path: '/api/merch/checkout', limit: MERCH_CHECKOUT_MAX_PER_MINUTE },
  { path: '/api/merch/checkout/native/confirm', limit: MERCH_CONFIRM_MAX_PER_MINUTE },
];

const VALID_CHECKOUT_BODY = {
  rail: 'stripe',
  items: [{ variantId: 'tee-m', qty: 1 }],
  shipping: {
    name: 'Alice Example',
    address1: '1 Claudemoon Way',
    city: 'Valeholm',
    zip: '00001',
    country: 'US',
  },
  email: 'alice@example.com',
  idempotencyKey: 'idem-1',
};

/** A not-locked AccountModerationStatus (the guard bundle's real return shape). */
function modStatus(overrides: Partial<AccountModerationStatus> = {}): AccountModerationStatus {
  return {
    locked: false,
    banned: false,
    suspendedUntil: null,
    reason: '',
    message: '',
    chatMutedUntil: null,
    chatStrikes: 0,
    ...overrides,
  };
}

/** Authorize the shared guard db with a full, non-locked account (overridable). */
function authedDb(overrides: Partial<Parameters<typeof setMerchDbForTests>[0]> = {}): void {
  setMerchDbForTests({
    accountAndScopeForToken: async () => ({ accountId: 7, scope: 'full' }),
    moderationStatusForAccount: async () => modStatus(),
    ...overrides,
  });
}

/** Read status/body off the fakeCtx's FakeRes. */
function readRes(res: http.ServerResponse): { status: number; body: unknown } {
  const fake = res as unknown as FakeRes;
  let body: unknown;
  try {
    body = fake.body ? JSON.parse(fake.body) : undefined;
  } catch {
    body = undefined;
  }
  return { status: fake.statusCode, body };
}

/** Grab a route by method + path. */
function routeFor(method: Method, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return route;
}

/** Drive a full route chain (its real guard middleware + handler) under withErrors. */
async function runRoute(
  method: Method,
  path: string,
  opts: { body?: unknown; headers?: Record<string, string> } = {},
) {
  const route = routeFor(method, path);
  let reached = false;
  const terminal: Middleware = async (c) => {
    reached = true;
    await route.handler(c);
  };
  const ctx = fakeCtx({ method, url: path, headers: opts.headers, body: opts.body });
  const stack: Middleware[] = [
    withErrors({ surface: route.meta?.envelope }),
    ...(route.middleware ?? []),
    terminal,
  ];
  await compose(stack)(ctx);
  return { reached, ...readRes(ctx.res) };
}

const ENV_KEYS = [
  'MERCH_STORE_ENABLED',
  'WOC_ECONOMY_SERVICE_URL',
  'WOC_ECONOMY_INTERNAL_SECRET',
] as const;
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
  // The store env stays unset: every proxy read fails closed, so no fetch and no
  // network dependency anywhere in this suite.
  for (const key of ENV_KEYS) delete process.env[key];
  resetMerchDbForTests();
  resetMerchMutationRateLimits();
  resetMerchProductsCacheForTests();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = ORIGINAL_ENV[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  resetMerchDbForTests();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. The route table shape.
// ---------------------------------------------------------------------------

describe('merch route table', () => {
  it('registers exactly the six routes in the declared order', () => {
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /api/merch/stripe/webhook',
      'POST /api/merch/printful/webhook',
      'GET /api/merch/products',
      'POST /api/merch/checkout',
      'POST /api/merch/checkout/native/confirm',
      'GET /api/merch/orders',
    ]);
  });

  it('marks the public routes publicRead; only the products probe carries a limiter', () => {
    for (const [method, path] of PUBLIC_PATHS) {
      const r = routeFor(method, path);
      expect(r.surface, path).toBe('api');
      expect(r.meta?.publicRead, path).toBe(true);
      if (path === '/api/merch/products') {
        // Public but IP rate-limited (the /api/woc/balance shape).
        expect(r.middleware?.length, path).toBe(1);
      } else {
        expect(r.middleware, path).toBeUndefined();
      }
    }
  });

  it('mounts ONE shared activeGuard instance across the player trio', () => {
    // The mutations sandwich the guard between the two rate-limit tiers; the
    // read-only orders route carries the guard alone (claudium's exact shape).
    const guardIndex = (path: string) => (path === '/api/merch/orders' ? 0 : 1);
    const guards = new Set(
      PLAYER_PATHS.map(([m, p]) => routeFor(m, p).middleware?.[guardIndex(p)]),
    );
    expect(guards.size).toBe(1);
    expect([...guards][0]).toBeDefined();
    for (const [method, path] of PLAYER_PATHS) {
      const r = routeFor(method, path);
      expect(r.surface, path).toBe('api');
      const expectedLength = path === '/api/merch/orders' ? 1 : 3;
      expect(r.middleware?.length, path).toBe(expectedLength);
      expect(r.schema, path).toBeUndefined();
    }
  });

  it('mounts an IP limiter before auth and an account limiter after auth on every mutation', () => {
    for (const { path } of MONETARY_MUTATION_ROUTES) {
      const route = routes.find((entry) => entry.method === 'POST' && entry.path === path);
      expect(route?.middleware).toHaveLength(3);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The player routes authenticate through the REAL shared activeGuard chain.
// ---------------------------------------------------------------------------

describe('player routes: activeGuard chain', () => {
  for (const [method, path] of PLAYER_PATHS) {
    it(`${method} ${path} 401s a missing bearer, handler never called`, async () => {
      authedDb();
      const r = await runRoute(method, path);
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
      expect(r.reached).toBe(false);
    });
  }

  it('403s a read-only token', async () => {
    authedDb({ accountAndScopeForToken: async () => ({ accountId: 7, scope: 'read' }) });
    const r = await runRoute('GET', '/api/merch/orders', { headers: { authorization: BEARER } });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'this token is read-only', code: 'auth.forbidden' });
    expect(r.reached).toBe(false);
  });

  it('403s a moderation-locked account with the status message', async () => {
    authedDb({
      moderationStatusForAccount: async () =>
        modStatus({ locked: true, message: 'this account is suspended.' }),
    });
    const r = await runRoute('POST', '/api/merch/checkout', {
      headers: { authorization: BEARER },
      body: VALID_CHECKOUT_BODY,
    });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'this account is suspended.', code: 'moderation.suspended' });
    expect(r.reached).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. The money mutations are rate limited on BOTH dispatch arms (claudium twin).
// ---------------------------------------------------------------------------

describe('money mutations: two-tier rate limits', () => {
  it.each(MONETARY_MUTATION_ROUTES)(
    'limits invalid-token floods on $path before they can perform unlimited DB reads',
    async ({ path, limit }) => {
      const accountAndScopeForToken = vi.fn(async () => null);
      setMerchDbForTests({ accountAndScopeForToken });

      for (let i = 0; i < limit; i++) {
        const r = await runRoute('POST', path, { headers: { authorization: BEARER } });
        expect(r.status).toBe(401);
      }
      const route = routeFor('POST', path);
      const limited = fakeCtx({
        method: 'POST',
        url: path,
        headers: { authorization: BEARER },
      });
      await expect(compose([...(route.middleware ?? [])])(limited)).rejects.toMatchObject({
        status: 429,
      });
      expect(accountAndScopeForToken).toHaveBeenCalledTimes(limit);
    },
  );

  it.each(MONETARY_MUTATION_ROUTES)(
    'fuses authenticated $path limits across IP and account keys',
    async ({ path, limit }) => {
      const accountAndScopeForToken = vi.fn(async () => ({
        accountId: 41,
        scope: 'full' as const,
      }));
      authedDb({ accountAndScopeForToken });
      const route = routeFor('POST', path);
      const runMiddleware = compose([...(route.middleware ?? [])]);

      for (let i = 0; i < limit; i++) {
        const ctx = fakeCtx({
          method: 'POST',
          url: path,
          ip: `192.0.2.${i + 1}`,
          headers: { authorization: BEARER, 'x-forwarded-for': `192.0.2.${i + 1}` },
        });
        await runMiddleware(ctx);
        expect(ctx.account?.accountId).toBe(41);
      }

      const limited = fakeCtx({
        method: 'POST',
        url: path,
        ip: '198.51.100.1',
        headers: { authorization: BEARER, 'x-forwarded-for': '198.51.100.1' },
      });
      await expect(runMiddleware(limited)).rejects.toMatchObject({ status: 429 });
      expect(accountAndScopeForToken).toHaveBeenCalledTimes(limit + 1);
    },
  );

  it.each(MONETARY_MUTATION_ROUTES)(
    'lets the legacy pre-auth helper stop $path before bearer resolution',
    ({ path, limit }) => {
      for (let i = 0; i < limit; i++) {
        const outcome = merchPreAuthMutationRateLimited(
          makeReq({ method: 'POST', url: path, headers: { authorization: BEARER } }),
        );
        expect(outcome?.allowed).toBe(true);
      }
      const limited = merchPreAuthMutationRateLimited(
        makeReq({ method: 'POST', url: path, headers: { authorization: BEARER } }),
      );
      expect(limited?.allowed).toBe(false);
    },
  );

  it('does not pre-auth-limit the reads (no action mapped)', () => {
    expect(
      merchPreAuthMutationRateLimited(makeReq({ method: 'GET', url: '/api/merch/orders' })),
    ).toBeNull();
    expect(
      merchPreAuthMutationRateLimited(makeReq({ method: 'GET', url: '/api/merch/products' })),
    ).toBeNull();
  });

  it.each(MONETARY_MUTATION_ROUTES)(
    'applies the fused limiter inside the legacy core for $path',
    async ({ path, limit }) => {
      for (let i = 0; i < limit; i++) {
        const res = new FakeRes();
        await handleMerchApi(makeReq({ method: 'POST', url: path }), res as never, 7);
        expect(res.statusCode).not.toBe(429);
      }
      const res = new FakeRes();
      await handleMerchApi(makeReq({ method: 'POST', url: path }), res as never, 7);
      expect(res.statusCode).toBe(429);
      expect(JSON.parse(res.body ?? '')).toEqual({ error: 'rate_limited' });
    },
  );

  it('skips the fused limiter when the RouteDef chain already applied it', async () => {
    const path = '/api/merch/checkout';
    for (let i = 0; i < MERCH_CHECKOUT_MAX_PER_MINUTE * 2; i++) {
      const res = new FakeRes();
      await handleMerchApi(makeReq({ method: 'POST', url: path }), res as never, 7, {
        rateLimitApplied: true,
      });
      expect(res.statusCode).not.toBe(429);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The handlers answer typed bodies (store off = fail closed, never a throw).
// ---------------------------------------------------------------------------

describe('handlers: typed fail-closed bodies with the store off', () => {
  beforeEach(() => {
    authedDb();
  });

  it('GET /api/merch/products answers 200 { enabled:false, products:[] } logged out', async () => {
    const r = await runRoute('GET', '/api/merch/products');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ enabled: false, products: [] });
    expect(r.reached).toBe(true);
  });

  it('POST checkout with an invalid body answers 200 reason invalid_request', async () => {
    const r = await runRoute('POST', '/api/merch/checkout', {
      headers: { authorization: BEARER },
      body: { rail: 'paypal', items: [] },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: false, orderId: null, reason: 'invalid_request' });
    expect(r.reached).toBe(true);
  });

  it('POST checkout on the sol rail without a payer is invalid_request', async () => {
    const r = await runRoute('POST', '/api/merch/checkout', {
      headers: { authorization: BEARER },
      body: { ...VALID_CHECKOUT_BODY, rail: 'sol' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: false, reason: 'invalid_request' });
  });

  it('POST checkout with a valid body answers 200 reason unavailable (proxy off)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const r = await runRoute('POST', '/api/merch/checkout', {
      headers: { authorization: BEARER },
      body: VALID_CHECKOUT_BODY,
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: false, orderId: null, paid: false, reason: 'unavailable' });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('POST native/confirm with a bad body answers 200 invalid_request; valid answers unavailable', async () => {
    const bad = await runRoute('POST', '/api/merch/checkout/native/confirm', {
      headers: { authorization: BEARER },
      body: { reference: '' },
    });
    expect(bad.status).toBe(200);
    expect(bad.body).toEqual({ settled: false, orderId: null, reason: 'invalid_request' });

    const ok = await runRoute('POST', '/api/merch/checkout/native/confirm', {
      headers: { authorization: BEARER },
      body: { reference: 'ref', signature: 'sig' },
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ settled: false, orderId: null, reason: 'unavailable' });
  });

  it('GET /api/merch/orders answers 200 { orders: [] }', async () => {
    const r = await runRoute('GET', '/api/merch/orders', {
      headers: { authorization: BEARER },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ orders: [] });
  });

  it('webhooks are reachable without auth and answer 400 received:false while off', async () => {
    for (const path of ['/api/merch/stripe/webhook', '/api/merch/printful/webhook']) {
      const r = await runRoute('POST', path, { body: { id: 'evt_1' } });
      expect(r.status, path).toBe(400);
      expect(r.body, path).toEqual({ received: false });
      expect(r.reached, path).toBe(true);
    }
  });

  it('an unknown in-family subpath 404s through the shared core', async () => {
    // Drive the shared core through a checkout route ctx with a rewritten url.
    const route = routeFor('POST', '/api/merch/checkout');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/merch/refund',
      headers: { authorization: BEARER },
      body: {},
    });
    const stack: Middleware[] = [
      withErrors({ surface: route.meta?.envelope }),
      ...(route.middleware ?? []),
      async (c) => {
        await route.handler(c);
      },
    ];
    await compose(stack)(ctx);
    const r = readRes(ctx.res);
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: 'unknown endpoint' });
  });
});

// ---------------------------------------------------------------------------
// 5. Webhook relays at the route layer: header extraction, raw-body relay,
//    the flag-off rollback exception, and the body-size cap.
// ---------------------------------------------------------------------------

describe('webhook relays (route layer)', () => {
  beforeEach(() => {
    // Env pair set but the store flag deliberately OFF: the relays must still
    // work (the rollback exception), while the player surface stays fail-closed.
    process.env.WOC_ECONOMY_SERVICE_URL = 'https://economy.test';
    process.env.WOC_ECONOMY_INTERNAL_SECRET = 'shh';
  });

  it('relays the raw stripe body + signature header verbatim and maps received:true to 200', async () => {
    const fetchSpy = vi.fn(
      async (_url: URL, _init: RequestInit) =>
        new Response(JSON.stringify({ received: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const raw = '{"id":"evt_1","type":"payment_intent.succeeded"}';
    const r = await runRoute('POST', '/api/merch/stripe/webhook', {
      body: raw,
      headers: { 'stripe-signature': 't=1,v1=abc' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ received: true });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://economy.test/merch/stripe/webhook');
    const headers = init.headers as Record<string, string>;
    expect(headers['stripe-signature']).toBe('t=1,v1=abc');
    expect(headers['x-woc-economy-secret']).toBe('shh');
    expect(Buffer.from(init.body as Uint8Array).toString('utf8')).toBe(raw);
  });

  it('relays the printful signature header and maps a service 400 to 400 received:false', async () => {
    const fetchSpy = vi.fn(
      async (_url: URL, _init: RequestInit) =>
        new Response(JSON.stringify({ received: false }), { status: 400 }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const r = await runRoute('POST', '/api/merch/printful/webhook', {
      body: '{"id":2}',
      headers: { 'x-pf-webhook-signature': 'pf-sig' },
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ received: false });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://economy.test/merch/printful/webhook');
    expect((init.headers as Record<string, string>)['x-pf-webhook-signature']).toBe('pf-sig');
  });

  it('a missing signature header relays as the empty string (the service refuses it)', async () => {
    const fetchSpy = vi.fn(
      async (_url: URL, _init: RequestInit) =>
        new Response(JSON.stringify({ received: false }), { status: 400 }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const r = await runRoute('POST', '/api/merch/stripe/webhook', { body: '{}' });
    expect(r.status).toBe(400);
    const [, init] = fetchSpy.mock.calls[0];
    expect((init.headers as Record<string, string>)['stripe-signature']).toBe('');
  });

  it('caps the webhook body at 1 MiB: an oversize POST never reaches the service', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const oversize = 'x'.repeat(1024 * 1024 + 1);
    const r = await runRoute('POST', '/api/merch/stripe/webhook', {
      body: oversize,
      headers: { 'stripe-signature': 'sig' },
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. Checkout body validation boundaries (the game-side shape gate only; real
//    pricing/address validation is the service's).
// ---------------------------------------------------------------------------

describe('checkout body validation boundaries', () => {
  beforeEach(() => {
    authedDb();
  });

  const post = (body: unknown) =>
    runRoute('POST', '/api/merch/checkout', { headers: { authorization: BEARER }, body });

  it('accepts exactly MAX_CART_ITEMS lines and refuses one more', async () => {
    const line = { variantId: 'tee-m', qty: 1 };
    const at = await post({ ...VALID_CHECKOUT_BODY, items: Array(50).fill(line) });
    // Passes validation; the store is off so it lands on the typed unavailable.
    expect(at.body).toMatchObject({ ok: false, reason: 'unavailable' });
    const over = await post({ ...VALID_CHECKOUT_BODY, items: Array(51).fill(line) });
    expect(over.body).toMatchObject({ ok: false, reason: 'invalid_request' });
  });

  it('accepts qty 99 and refuses 100, 0, negatives, and non-integers', async () => {
    const qty = (q: number) => ({
      ...VALID_CHECKOUT_BODY,
      items: [{ variantId: 'tee-m', qty: q }],
    });
    expect((await post(qty(99))).body).toMatchObject({ reason: 'unavailable' });
    for (const bad of [100, 0, -1, 1.5]) {
      expect((await post(qty(bad))).body, String(bad)).toMatchObject({
        reason: 'invalid_request',
      });
    }
  });

  it('refuses an empty items list, a non-string variantId, and a malformed JSON body', async () => {
    expect((await post({ ...VALID_CHECKOUT_BODY, items: [] })).body).toMatchObject({
      reason: 'invalid_request',
    });
    expect(
      (await post({ ...VALID_CHECKOUT_BODY, items: [{ variantId: 7, qty: 1 }] })).body,
    ).toMatchObject({ reason: 'invalid_request' });
    const malformed = await runRoute('POST', '/api/merch/checkout', {
      headers: { authorization: BEARER },
      body: '{not json',
    });
    expect(malformed.body).toMatchObject({ ok: false, reason: 'invalid_request' });
  });

  it('refuses a non-string shipping field and a missing email or idempotency key', async () => {
    expect(
      (
        await post({
          ...VALID_CHECKOUT_BODY,
          shipping: { ...VALID_CHECKOUT_BODY.shipping, name: 42 },
        })
      ).body,
    ).toMatchObject({ reason: 'invalid_request' });
    expect((await post({ ...VALID_CHECKOUT_BODY, email: '' })).body).toMatchObject({
      reason: 'invalid_request',
    });
    expect((await post({ ...VALID_CHECKOUT_BODY, idempotencyKey: '' })).body).toMatchObject({
      reason: 'invalid_request',
    });
  });
});
