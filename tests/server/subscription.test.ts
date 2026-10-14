import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db', () => ({
  accountAndScopeForToken: vi.fn(),
  moderationStatusForAccount: vi.fn(),
  grantAccountWeaponSkins: vi.fn(),
  grantAccountMountSkins: vi.fn(),
  scopeAllowsMutation: vi.fn(() => true),
}));

import {
  claudiumPreAuthMutationRateLimited,
  handleClaudiumApi,
  resetClaudiumDbForTests,
  routes,
  setClaudiumDbForTests,
} from '../../server/claudium';
import { compose } from '../../server/http/compose';
import {
  PUBLIC_READ_MAX_PER_MINUTE,
  resetClaudiumMutationRateLimits,
  resetPublicReadRateLimits,
} from '../../server/ratelimit';
import { GAME_SUBSCRIPTION_PRICE } from '../../src/subscription_contract';
import { FakeRes, fakeCtx, makeReq } from './helpers';

const body = { plan: 'game_monthly', rail: 'stripe', idempotencyKey: 'subscription-intent-1234' };
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubEnv('WOC_SUBSCRIPTIONS_ENABLED', '1');
  vi.stubEnv('WOC_ECONOMY_SERVICE_URL', 'https://economy.example/internal/');
  vi.stubEnv('WOC_ECONOMY_INTERNAL_SECRET', 'test-internal-secret');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  resetClaudiumMutationRateLimits();
  resetPublicReadRateLimits();
});
afterEach(() => {
  resetClaudiumDbForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function call(action: string, input: unknown = body, accountId = 7) {
  const res = new FakeRes();
  await handleClaudiumApi(
    makeReq({
      method: action ? 'POST' : 'GET',
      url: `/api/claudium/subscription${action}`,
      body: input,
    }),
    res as never,
    accountId,
  );
  return { status: res.statusCode, body: JSON.parse(res.body) };
}
describe('game subscription account API', () => {
  it('is disabled by default and never contacts the service', async () => {
    vi.stubEnv('WOC_SUBSCRIPTIONS_ENABLED', '');
    expect((await call('')).body.available).toBe(false);
    expect((await call('/checkout')).body.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('uses the authenticated account and the fixed fiat contract for checkout and portal', async () => {
    for (const action of ['checkout', 'portal']) {
      const url =
        action === 'checkout'
          ? 'https://checkout.stripe.com/c/pay/cs_test_1'
          : 'https://billing.stripe.com/p/session/test_1';
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, url })));
      expect((await call(`/${action}`)).body).toEqual({ ok: true, url });
      const [target, options] = fetchMock.mock.calls.at(-1)!;
      expect(String(target)).toBe(`https://economy.example/internal/subscriptions/${action}`);
      expect(JSON.parse(options.body)).toEqual({
        ...body,
        accountId: 7,
        price: GAME_SUBSCRIPTION_PRICE,
      });
      expect(options.redirect).toBe('error');
    }
  });
  it.each(['woc', 'sol', 'usdc', 'claudium'])('refuses the %s payment rail', async (rail) => {
    expect((await call('/checkout', { ...body, rail })).body.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    { accountId: 8 },
    { price: 1 },
    { returnUrl: 'https://evil.test' },
    { idempotencyKey: 'short' },
    { plan: 'claudium_500' },
  ])('refuses caller authority overrides %j', async (patch) => {
    expect((await call('/checkout', { ...body, ...patch })).body.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('reads account status without exposing Stripe customer identifiers', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          plan: 'game_monthly',
          price: GAME_SUBSCRIPTION_PRICE,
          available: true,
          status: 'active',
          canCheckout: false,
          canManage: true,
          cancelAtPeriodEnd: true,
          currentPeriodEnd: 1900000000,
          customerId: 'cus_private',
        }),
      ),
    );
    const result = await call('');
    expect(String(fetchMock.mock.calls[0][0]).endsWith('/subscriptions/7')).toBe(true);
    expect(result.body).toMatchObject({
      status: 'active',
      canManage: true,
      cancelAtPeriodEnd: true,
    });
    expect(result.body).not.toHaveProperty('customerId');
  });
  it('fails closed on a service outage without automatically retrying checkout', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));
    expect((await call('/checkout')).body.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('rejects status floods before database work on both dispatch arms', async () => {
    const read = vi.fn(async () => null);
    setClaudiumDbForTests({ accountAndScopeForToken: read });
    const route = routes.find((r) => r.path === '/api/claudium/subscription')!;
    const run = compose([...route.middleware!]);
    for (let i = 0; i <= PUBLIC_READ_MAX_PER_MINUTE; i++) {
      const ctx = fakeCtx({
        url: route.path,
        headers: { authorization: `Bearer ${'a'.repeat(64)}` },
      });
      await run(ctx);
      expect((ctx.res as unknown as FakeRes).statusCode).toBe(
        i < PUBLIC_READ_MAX_PER_MINUTE ? 401 : 429,
      );
    }
    expect(read).toHaveBeenCalledTimes(PUBLIC_READ_MAX_PER_MINUTE);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      claudiumPreAuthMutationRateLimited(makeReq({ method: 'GET', url: route.path }))?.allowed,
    ).toBe(false);
  });
  it.each(['checkout', 'portal'])('requires auth before %s creates a session', async (action) => {
    setClaudiumDbForTests({ accountAndScopeForToken: vi.fn(async () => null) });
    const route = routes.find((r) => r.path === `/api/claudium/subscription/${action}`)!;
    const ctx = fakeCtx({ method: 'POST', url: route.path, body });
    await compose([
      ...route.middleware!,
      async (ctx) => {
        await route.handler(ctx);
      },
    ])(ctx);
    expect((ctx.res as unknown as FakeRes).statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
