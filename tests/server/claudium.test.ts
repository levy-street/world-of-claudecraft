process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_claudium_routes';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db', () => ({
  accountAndScopeForToken: vi.fn(),
  grantAccountWeaponSkins: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  moderationStatusForAccount: vi.fn(),
  scopeAllowsMutation: vi.fn(() => true),
}));

vi.mock('../../server/claudium_proxy', async (importActual) => {
  const actual = await importActual<typeof import('../../server/claudium_proxy')>();
  return {
    ...actual,
    claudiumSpend: vi.fn(),
    claudiumStore: vi.fn(),
  };
});

import {
  claudiumPreAuthMutationRateLimited,
  configureClaudiumRuntime,
  handleClaudiumApi,
  resetClaudiumDbForTests,
  routes,
  setClaudiumDbForTests,
} from '../../server/claudium';
import { claudiumSpend, claudiumStore, claudiumStripeWebhook } from '../../server/claudium_proxy';
import { compose } from '../../server/http/compose';
import {
  CLAUDIUM_CONFIRM_MAX_PER_MINUTE,
  CLAUDIUM_PURCHASE_MAX_PER_MINUTE,
  CLAUDIUM_QUOTE_MAX_PER_MINUTE,
  CLAUDIUM_SPEND_MAX_PER_MINUTE,
  resetClaudiumMutationRateLimits,
} from '../../server/ratelimit';
import { FakeRes, fakeCtx, makeReq } from './helpers';

const spendMock = vi.mocked(claudiumSpend);
const storeMock = vi.mocked(claudiumStore);
const grantWeaponSkins = vi.fn();

const MONETARY_MUTATION_ROUTES = [
  {
    path: '/api/claudium/purchase',
    limit: CLAUDIUM_PURCHASE_MAX_PER_MINUTE,
  },
  {
    path: '/api/claudium/native/quote',
    limit: CLAUDIUM_QUOTE_MAX_PER_MINUTE,
  },
  {
    path: '/api/claudium/native/confirm',
    limit: CLAUDIUM_CONFIRM_MAX_PER_MINUTE,
  },
  {
    path: '/api/claudium/spend',
    limit: CLAUDIUM_SPEND_MAX_PER_MINUTE,
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  resetClaudiumMutationRateLimits();
  configureClaudiumRuntime({ grantWeaponSkins });
});

afterEach(() => {
  resetClaudiumDbForTests();
  resetClaudiumMutationRateLimits();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function responseJson(res: FakeRes): unknown {
  return JSON.parse(res.body);
}

describe('Claudium spend entitlement mirroring', () => {
  it('does not advertise the legacy SOL price route that the service does not expose', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = new FakeRes();

    await handleClaudiumApi(
      makeReq({ method: 'GET', url: '/api/claudium/price/sol' }),
      res as never,
      7,
    );

    expect(responseJson(res)).toEqual({
      rail: '',
      usdPerClaudium: null,
      wocBaseUnitsPerClaudium: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mounts an IP limiter before auth and an account limiter after auth on every mutation', () => {
    for (const { path } of MONETARY_MUTATION_ROUTES) {
      const route = routes.find((entry) => entry.method === 'POST' && entry.path === path);
      expect(route?.middleware).toHaveLength(3);
    }
  });

  it.each(
    MONETARY_MUTATION_ROUTES,
  )('limits invalid-token floods on $path before they can perform unlimited DB reads', async ({
    path,
    limit,
  }) => {
    const accountAndScopeForToken = vi.fn(async () => null);
    setClaudiumDbForTests({ accountAndScopeForToken });
    const route = routes.find((entry) => entry.method === 'POST' && entry.path === path);
    if (!route?.middleware) throw new Error(`missing mutation middleware for ${path}`);
    const runMiddleware = compose([...route.middleware]);

    for (let i = 0; i < limit; i++) {
      const ctx = fakeCtx({
        method: 'POST',
        url: path,
        headers: { authorization: `Bearer ${'a'.repeat(64)}` },
      });
      await runMiddleware(ctx);
      expect((ctx.res as unknown as FakeRes).statusCode).toBe(401);
    }

    const limited = fakeCtx({
      method: 'POST',
      url: path,
      headers: { authorization: `Bearer ${'a'.repeat(64)}` },
    });
    await expect(runMiddleware(limited)).rejects.toMatchObject({ status: 429 });
    expect(accountAndScopeForToken).toHaveBeenCalledTimes(limit);
  });

  it.each(
    MONETARY_MUTATION_ROUTES,
  )('fuses authenticated $path limits across IP and account keys', async ({ path, limit }) => {
    const accountAndScopeForToken = vi.fn(async () => ({ accountId: 41, scope: 'full' as const }));
    const moderationStatusForAccount = vi.fn(async () => ({ locked: false }) as never);
    setClaudiumDbForTests({ accountAndScopeForToken, moderationStatusForAccount });
    const route = routes.find((entry) => entry.method === 'POST' && entry.path === path);
    if (!route?.middleware) throw new Error(`missing mutation middleware for ${path}`);
    const runMiddleware = compose([...route.middleware]);

    for (let i = 0; i < limit; i++) {
      const ctx = fakeCtx({
        method: 'POST',
        url: path,
        ip: `192.0.2.${i + 1}`,
        headers: {
          authorization: `Bearer ${'b'.repeat(64)}`,
          'x-forwarded-for': `192.0.2.${i + 1}`,
        },
      });
      await runMiddleware(ctx);
      expect(ctx.account?.accountId).toBe(41);
    }

    const limited = fakeCtx({
      method: 'POST',
      url: path,
      ip: '198.51.100.1',
      headers: {
        authorization: `Bearer ${'b'.repeat(64)}`,
        'x-forwarded-for': '198.51.100.1',
      },
    });
    await expect(runMiddleware(limited)).rejects.toMatchObject({ status: 429 });
    expect(accountAndScopeForToken).toHaveBeenCalledTimes(limit + 1);
  });

  it.each(
    MONETARY_MUTATION_ROUTES,
  )('lets the legacy pre-auth helper stop $path before bearer resolution', async ({
    path,
    limit,
  }) => {
    const resolveBearer = vi.fn(async () => undefined);
    const attempt = async (): Promise<boolean> => {
      const outcome = claudiumPreAuthMutationRateLimited(
        makeReq({
          method: 'POST',
          url: path,
          headers: { authorization: `Bearer ${'a'.repeat(64)}` },
        }),
      );
      if (outcome && !outcome.allowed) return false;
      await resolveBearer();
      return true;
    };

    for (let i = 0; i < limit; i++) expect(await attempt()).toBe(true);
    expect(await attempt()).toBe(false);
    expect(resolveBearer).toHaveBeenCalledTimes(limit);
  });

  it('filters retired catalog rows and unknown skins out of the game storefront', async () => {
    storeMock.mockResolvedValue({
      available: true,
      items: [
        {
          itemId: 'guildmark_arming_sword',
          name: 'Guildmark Arming Sword',
          kind: 'skin',
          costClaudium: 200,
          owned: false,
        },
        {
          itemId: 'retired_placeholder_hat',
          name: 'Retired Placeholder Hat',
          kind: 'cosmetic',
          costClaudium: 10,
          owned: false,
        },
        {
          itemId: 'unknown_weapon_skin',
          name: 'Unknown Weapon Skin',
          kind: 'skin',
          costClaudium: 10,
          owned: false,
        },
        {
          itemId: '__proto__',
          name: 'Prototype Pollution Skin',
          kind: 'skin',
          costClaudium: 10,
          owned: false,
        },
      ],
    });
    const res = new FakeRes();

    await handleClaudiumApi(
      makeReq({ method: 'GET', url: '/api/claudium/store' }),
      res as never,
      7,
    );

    expect(responseJson(res)).toEqual({
      available: true,
      items: [
        {
          itemId: 'guildmark_arming_sword',
          name: 'Guildmark Arming Sword',
          kind: 'skin',
          costClaudium: 200,
          owned: false,
        },
      ],
    });
  });

  it.each([
    { itemId: 'guildmark_arming_sword', kind: 'item' },
    { itemId: 'retired_placeholder_hat', kind: 'skin' },
    { itemId: '__proto__', kind: 'skin' },
  ])('rejects unsupported store spend $itemId/$kind before debiting Claudium', async (body) => {
    const res = new FakeRes();

    await handleClaudiumApi(
      makeReq({
        method: 'POST',
        url: '/api/claudium/spend',
        body: { ...body, expectedCostClaudium: 200, idempotencyKey: 'unsupported-key' },
      }),
      res as never,
      7,
    );

    expect(responseJson(res)).toEqual({
      granted: false,
      balance: null,
      costClaudium: null,
      reason: 'unknown_item',
    });
    expect(spendMock).not.toHaveBeenCalled();
  });

  it('rejects a string expected cost before calling the monetary service', async () => {
    const res = new FakeRes();

    await handleClaudiumApi(
      makeReq({
        method: 'POST',
        url: '/api/claudium/spend',
        body: {
          itemId: 'guildmark_arming_sword',
          kind: 'skin',
          expectedCostClaudium: '200',
          idempotencyKey: 'string-cost-key',
        },
      }),
      res as never,
      7,
    );

    expect(responseJson(res)).toEqual({
      granted: false,
      balance: null,
      costClaudium: null,
      reason: 'invalid_request',
    });
    expect(spendMock).not.toHaveBeenCalled();
  });

  it('does not mirror a caller item until the authoritative store owns that exact skin', async () => {
    spendMock.mockResolvedValue({
      // The in-memory companion backend historically reported a reused key as
      // granted:true, while Postgres reported granted:false. The game must be safe
      // against either representation.
      granted: true,
      balance: 0,
      costClaudium: 200,
      reason: 'already_granted',
    });
    storeMock.mockResolvedValue({
      available: true,
      items: [
        {
          itemId: 'guildmark_arming_sword',
          name: 'Guildmark Arming Sword',
          kind: 'skin',
          costClaudium: 200,
          owned: true,
        },
        {
          itemId: 'solheim_sword',
          name: 'Solheim, Last Light of the Dawn',
          kind: 'skin',
          costClaudium: 5000,
          owned: false,
        },
      ],
    });

    const req = makeReq({
      method: 'POST',
      url: '/api/claudium/spend',
      body: {
        itemId: 'solheim_sword',
        kind: 'skin',
        expectedCostClaudium: 200,
        idempotencyKey: 'reused-key',
      },
    });
    const res = new FakeRes();

    await handleClaudiumApi(req, res as never, 7);

    expect(spendMock).toHaveBeenCalledWith({
      accountId: 7,
      itemId: 'solheim_sword',
      kind: 'skin',
      expectedCostClaudium: 200,
      idempotencyKey: 'reused-key',
    });
    expect(storeMock).toHaveBeenCalledWith(7);
    expect(grantWeaponSkins).not.toHaveBeenCalled();
  });

  it('mirrors a skin only after the authoritative store confirms that item is owned', async () => {
    spendMock.mockResolvedValue({
      granted: true,
      balance: 300,
      costClaudium: 200,
      reason: null,
    });
    storeMock.mockResolvedValue({
      available: true,
      items: [
        {
          itemId: 'guildmark_arming_sword',
          name: 'Guildmark Arming Sword',
          kind: 'skin',
          costClaudium: 200,
          owned: true,
        },
      ],
    });

    const req = makeReq({
      method: 'POST',
      url: '/api/claudium/spend',
      body: {
        itemId: 'guildmark_arming_sword',
        kind: 'skin',
        expectedCostClaudium: 200,
        idempotencyKey: 'fresh-key',
      },
    });
    const res = new FakeRes();

    await handleClaudiumApi(req, res as never, 7);

    expect(spendMock).toHaveBeenCalledWith({
      accountId: 7,
      itemId: 'guildmark_arming_sword',
      kind: 'skin',
      expectedCostClaudium: 200,
      idempotencyKey: 'fresh-key',
    });
    expect(storeMock).toHaveBeenCalledWith(7);
    expect(grantWeaponSkins).toHaveBeenCalledWith(7, ['guildmark_arming_sword']);
  });
});

describe('Claudium economy-service transport contract', () => {
  it('marks typed HTTP 200 read fallbacks unavailable when the economy service is off', async () => {
    vi.stubEnv('WOC_ECONOMY_SERVICE_URL', '');
    vi.stubEnv('WOC_ECONOMY_INTERNAL_SECRET', '');
    const cases = [
      {
        url: '/api/claudium/balance',
        expected: { available: false, balance: null },
      },
      {
        url: '/api/claudium/skus',
        expected: { available: false, skus: [] },
      },
      {
        url: '/api/claudium/native/rails',
        expected: { available: false, rails: { sol: false, woc: false } },
      },
    ];

    for (const { url, expected } of cases) {
      const res = new FakeRes();
      await handleClaudiumApi(makeReq({ method: 'GET', url }), res as never, 7);
      expect(responseJson(res)).toEqual(expected);
    }
  });

  it('marks typed read responses available only after authoritative service data loads', async () => {
    vi.stubEnv('WOC_ECONOMY_SERVICE_URL', 'https://economy.example/v1/claudium/');
    vi.stubEnv('WOC_ECONOMY_INTERNAL_SECRET', 'test-secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/balance/7')) {
          return new Response(JSON.stringify({ balance: 250 }), { status: 200 });
        }
        if (url.endsWith('/skus')) {
          return new Response(JSON.stringify([{ sku: 'claudium_500', usd: 4.99, claudium: 500 }]), {
            status: 200,
          });
        }
        if (url.endsWith('/native/rails')) {
          return new Response(JSON.stringify({ rails: { sol: true, woc: true } }), {
            status: 200,
          });
        }
        return new Response(null, { status: 404 });
      }),
    );
    const cases = [
      {
        url: '/api/claudium/balance',
        expected: { available: true, balance: 250 },
      },
      {
        url: '/api/claudium/skus',
        expected: {
          available: true,
          skus: [{ sku: 'claudium_500', usd: 4.99, claudium: 500 }],
        },
      },
      {
        url: '/api/claudium/native/rails',
        expected: { available: true, rails: { sol: true, woc: true } },
      },
    ];

    for (const { url, expected } of cases) {
      const res = new FakeRes();
      await handleClaudiumApi(makeReq({ method: 'GET', url }), res as never, 7);
      expect(responseJson(res)).toEqual(expected);
    }
  });

  it('forwards Stripe webhook bytes and signature without reserializing them', async () => {
    vi.stubEnv('WOC_ECONOMY_SERVICE_URL', 'https://economy.example/v1/claudium/');
    vi.stubEnv('WOC_ECONOMY_INTERNAL_SECRET', 'test-secret');
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ received: true }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const rawBody = Buffer.from('{\n  "type": "checkout.session.completed"\n}\n');

    await expect(claudiumStripeWebhook(rawBody, 't=123,v1=signature')).resolves.toEqual({
      received: true,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toMatchObject({ 'stripe-signature': 't=123,v1=signature' });
    expect(Buffer.from(request.body as Uint8Array).equals(rawBody)).toBe(true);
  });

  it('keeps accountId numeric in purchase JSON bodies', async () => {
    vi.stubEnv('WOC_ECONOMY_SERVICE_URL', 'https://economy.example/v1/claudium/');
    vi.stubEnv('WOC_ECONOMY_INTERNAL_SECRET', 'test-secret');
    let sent: unknown;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        sent = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            purchaseId: 'purchase-1',
            rail: 'stripe',
            claudium: 500,
            stripe: { clientSecret: 'secret', publishableKey: 'pk_test' },
          }),
          { status: 200 },
        );
      }),
    );
    const res = new FakeRes();

    await handleClaudiumApi(
      makeReq({
        method: 'POST',
        url: '/api/claudium/purchase',
        body: { rail: 'stripe', sku: 'claudium_500', idempotencyKey: 'purchase-key' },
      }),
      res as never,
      7,
      { rateLimitApplied: true },
    );

    expect(sent).toMatchObject({ accountId: 7 });
    expect(typeof (sent as { accountId: unknown }).accountId).toBe('number');
  });

  it.each([
    { stripe: undefined, label: 'missing intent' },
    { stripe: { clientSecret: '', publishableKey: 'pk_test' }, label: 'empty client secret' },
    { stripe: { clientSecret: 'secret', publishableKey: '' }, label: 'empty publishable key' },
  ])('fails closed on a malformed 2xx Stripe success: $label', async ({ stripe }) => {
    vi.stubEnv('WOC_ECONOMY_SERVICE_URL', 'https://economy.example/v1/claudium/');
    vi.stubEnv('WOC_ECONOMY_INTERNAL_SECRET', 'test-secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              purchaseId: 'purchase-1',
              rail: 'stripe',
              claudium: 500,
              stripe,
            }),
            { status: 200 },
          ),
      ),
    );
    const res = new FakeRes();

    await handleClaudiumApi(
      makeReq({
        method: 'POST',
        url: '/api/claudium/purchase',
        body: { rail: 'stripe', sku: 'claudium_500', idempotencyKey: 'purchase-key' },
      }),
      res as never,
      7,
      { rateLimitApplied: true },
    );

    expect(responseJson(res)).toEqual({
      ok: false,
      purchaseId: null,
      rail: null,
      claudium: null,
      stripe: null,
      woc: null,
      reason: 'unavailable',
    });
  });

  it('preserves authoritative 2xx purchase refusals as ok:false', async () => {
    vi.stubEnv('WOC_ECONOMY_SERVICE_URL', 'https://economy.example/v1/claudium/');
    vi.stubEnv('WOC_ECONOMY_INTERNAL_SECRET', 'test-secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ reason: 'rail_disabled' }), { status: 200 })),
    );
    const res = new FakeRes();

    await handleClaudiumApi(
      makeReq({
        method: 'POST',
        url: '/api/claudium/purchase',
        body: { rail: 'stripe', sku: 'claudium_500', idempotencyKey: 'purchase-key' },
      }),
      res as never,
      7,
      { rateLimitApplied: true },
    );

    expect(responseJson(res)).toEqual({
      ok: false,
      purchaseId: null,
      rail: null,
      claudium: null,
      stripe: null,
      woc: null,
      reason: 'rail_disabled',
    });
  });

  it('keeps the legacy purchase endpoint Stripe-only', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = new FakeRes();

    await handleClaudiumApi(
      makeReq({
        method: 'POST',
        url: '/api/claudium/purchase',
        body: { rail: 'woc', sku: 'claudium_500', idempotencyKey: 'purchase-key' },
      }),
      res as never,
      7,
      { rateLimitApplied: true },
    );

    expect(responseJson(res)).toEqual({
      ok: false,
      purchaseId: null,
      rail: null,
      claudium: null,
      stripe: null,
      woc: null,
      reason: 'invalid_request',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops partial purchase fields while preserving an authoritative refusal reason', async () => {
    vi.stubEnv('WOC_ECONOMY_SERVICE_URL', 'https://economy.example/v1/claudium/');
    vi.stubEnv('WOC_ECONOMY_INTERNAL_SECRET', 'test-secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              purchaseId: '',
              rail: 'stripe',
              claudium: 500,
              stripe: { clientSecret: 'must-not-escape', publishableKey: 'pk_test' },
              reason: 'unknown_sku',
            }),
            { status: 200 },
          ),
      ),
    );
    const res = new FakeRes();

    await handleClaudiumApi(
      makeReq({
        method: 'POST',
        url: '/api/claudium/purchase',
        body: { rail: 'stripe', sku: 'retired_sku', idempotencyKey: 'purchase-key' },
      }),
      res as never,
      7,
      { rateLimitApplied: true },
    );

    expect(responseJson(res)).toEqual({
      ok: false,
      purchaseId: null,
      rail: null,
      claudium: null,
      stripe: null,
      woc: null,
      reason: 'unknown_sku',
    });
  });

  it('preserves authoritative native-quote refusals as ok:false', async () => {
    vi.stubEnv('WOC_ECONOMY_SERVICE_URL', 'https://economy.example/v1/claudium/');
    vi.stubEnv('WOC_ECONOMY_INTERNAL_SECRET', 'test-secret');
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ reason: 'rail_disabled' }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = new FakeRes();

    await handleClaudiumApi(
      makeReq({
        method: 'POST',
        url: '/api/claudium/native/quote',
        body: { rail: 'sol', sku: 'claudium_500', payer: 'payer-address' },
      }),
      res as never,
      7,
      { rateLimitApplied: true },
    );

    expect(responseJson(res)).toEqual({
      ok: false,
      reference: null,
      rail: null,
      claudium: null,
      amountBase: null,
      destination: null,
      mint: null,
      memo: null,
      quoteExpiryMs: null,
      transactionBase64: null,
      split: null,
      reason: 'rail_disabled',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      rail: 'sol',
      sku: 'claudium_500',
      payer: 'payer-address',
      fulfillment: { kind: 'credit', accountId: 7 },
    });
  });

  it('binds native confirmation to the authenticated account', async () => {
    vi.stubEnv('WOC_ECONOMY_SERVICE_URL', 'https://economy.example/v1/claudium/');
    vi.stubEnv('WOC_ECONOMY_INTERNAL_SECRET', 'test-secret');
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({ settled: false, reason: 'account_mismatch', fulfillment: null }),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = new FakeRes();

    await handleClaudiumApi(
      makeReq({
        method: 'POST',
        url: '/api/claudium/native/confirm',
        body: { reference: 'payment-reference', signature: 'payment-signature' },
      }),
      res as never,
      7,
      { rateLimitApplied: true },
    );

    expect(responseJson(res)).toEqual({
      settled: false,
      balance: null,
      reason: 'account_mismatch',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      accountId: 7,
      reference: 'payment-reference',
      signature: 'payment-signature',
    });
  });

  it('prices bonus packs by service SKU instead of treating credited Claudium as USD cents', async () => {
    vi.stubEnv('WOC_ECONOMY_SERVICE_URL', 'https://economy.example/v1/claudium/');
    vi.stubEnv('WOC_ECONOMY_INTERNAL_SECRET', 'test-secret');
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify({ rail: 'sol', claudium: 13_000, amountBase: '9999000' }), {
          status: 200,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = new FakeRes();

    await handleClaudiumApi(
      makeReq({
        method: 'GET',
        url: '/api/claudium/native/price/sol?sku=claudium_13000',
      }),
      res as never,
      7,
    );

    expect(responseJson(res)).toEqual({
      rail: 'sol',
      claudium: 13_000,
      amountBase: '9999000',
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://economy.example/v1/claudium/native/price/sol?sku=claudium_13000',
    );
  });

  it('maps history responses to the economy SDK ledger-entry shape', async () => {
    vi.stubEnv('WOC_ECONOMY_SERVICE_URL', 'https://economy.example/v1/claudium/');
    vi.stubEnv('WOC_ECONOMY_INTERNAL_SECRET', 'test-secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              {
                entryId: 'entry-1',
                accountId: 7,
                delta: -200,
                reason: 'spend',
                ref: 'guildmark_arming_sword',
                atMs: 1234,
              },
              {
                entryId: 'wrong-account-entry',
                accountId: 8,
                delta: 5000,
                reason: 'purchase_stripe',
                ref: 'other-account-purchase',
                atMs: 1235,
              },
              { id: 'legacy-row', kind: 'spend', claudium: -200, atMs: 1233 },
            ]),
            { status: 200 },
          ),
      ),
    );
    const res = new FakeRes();

    await handleClaudiumApi(
      makeReq({ method: 'GET', url: '/api/claudium/history' }),
      res as never,
      7,
    );

    expect(responseJson(res)).toEqual({
      entries: [
        {
          entryId: 'entry-1',
          accountId: 7,
          delta: -200,
          reason: 'spend',
          ref: 'guildmark_arming_sword',
          atMs: 1234,
        },
      ],
    });
  });
});
