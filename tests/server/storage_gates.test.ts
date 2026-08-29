// Bank Storage phase 11: the storage kind gates on the Claudium surface.
//
// Proves (1) the spend branch accepts kind 'storage' for allowlisted
// registry ids ONLY and refuses every cross-family declaration exactly as
// today; (2) BOTH dispatch arms (the registered RouteDef and the legacy
// prefix composition from server/main.ts) produce the identical body from
// the shared core; (3) a storage row survives EVERY store layer, fetch
// through proxy validator through handler filter, so a future tightening
// cannot silently drop the SKUs again; (4) the spend rate limiter is the
// same one on both arms, unwidened for storage; and (5) with no runtime
// wired the storage branch fails closed as unavailable.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_storage_gates';

import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import {
  claudiumPreAuthMutationRateLimited,
  configureClaudiumRuntime,
  handleClaudiumApi,
  routes,
  setClaudiumDbForTests,
} from '../../server/claudium';
import { compose } from '../../server/http/compose';
import {
  CLAUDIUM_SPEND_MAX_PER_MINUTE,
  resetClaudiumMutationRateLimits,
} from '../../server/ratelimit';
import { FakeRes, fakeCtx, makeReq } from './helpers';

const storagePurchase = vi.fn(async () => ({
  granted: true,
  balance: 400,
  costClaudium: 100,
  reason: null as string | null,
}));
const grantWeaponSkins = vi.fn();

function responseJson(res: FakeRes): unknown {
  return JSON.parse(res.body);
}

const spendBody = (over: Record<string, unknown> = {}) => ({
  itemId: 'strongbox_rung_01',
  kind: 'storage',
  expectedCostClaudium: 100,
  idempotencyKey: 'gate-key',
  ...over,
});

// FILE-ORDER SENSITIVE: this first test runs before any
// configureClaudiumRuntime call in this module registry, which is exactly
// the no-live-game state it pins (there is deliberately no reset API).
describe('storage spend with no runtime wired', () => {
  it('fails closed as unavailable instead of granting or throwing', async () => {
    resetClaudiumMutationRateLimits();
    const res = new FakeRes();
    await handleClaudiumApi(
      makeReq({ method: 'POST', url: '/api/claudium/spend', body: spendBody() }),
      res as never,
      7,
    );
    expect(responseJson(res)).toEqual({
      granted: false,
      balance: null,
      costClaudium: null,
      reason: 'unavailable',
    });
  });
});

describe('the storage kind gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetClaudiumMutationRateLimits();
    configureClaudiumRuntime({ grantWeaponSkins, storagePurchase });
  });

  it('forwards an allowlisted storage spend to the purchase flow verbatim', async () => {
    const res = new FakeRes();
    await handleClaudiumApi(
      makeReq({ method: 'POST', url: '/api/claudium/spend', body: spendBody() }),
      res as never,
      7,
    );
    expect(storagePurchase).toHaveBeenCalledExactlyOnceWith({
      accountId: 7,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'gate-key',
    });
    expect(responseJson(res)).toEqual({
      granted: true,
      balance: 400,
      costClaudium: 100,
      reason: null,
    });
  });

  it.each([
    // An unknown storage id, a skin id declared as storage, and a registry
    // id declared as skin: each refuses with the phase 10 vocabulary.
    { itemId: 'no_such_storage_sku', kind: 'storage' },
    { itemId: 'guildmark_arming_sword', kind: 'storage' },
    { itemId: 'strongbox_rung_01', kind: 'skin' },
    { itemId: 'strongbox_charter_complete', kind: 'cosmetic' },
    { itemId: 'strongbox_charter_complete', kind: 'item' },
  ])('$itemId declared as $kind refuses unknown_item before any flow', async (body) => {
    const res = new FakeRes();
    await handleClaudiumApi(
      makeReq({
        method: 'POST',
        url: '/api/claudium/spend',
        body: spendBody(body),
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
    expect(storagePurchase).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'zero cost', over: { expectedCostClaudium: 0 } },
    // The declared cost is persisted verbatim into an INT column: an
    // overflow-sized number must refuse, never reach the insert.
    { name: 'oversized cost', over: { expectedCostClaudium: 3_000_000_000 } },
    { name: 'cost past the cap', over: { expectedCostClaudium: 1_000_001 } },
    // The key must fit the SHARED persistence bound (200) and the safe
    // charset: an overlong key would apply and then vanish on the next
    // load, voiding the exactly-once dedupe; control characters would
    // forge log lines and can overflow the btree index tuple.
    { name: 'overlong key', over: { idempotencyKey: 'x'.repeat(201) } },
    { name: 'whitespace in key', over: { idempotencyKey: 'bad key' } },
    { name: 'newline in key', over: { idempotencyKey: 'bad\nkey' } },
  ])('refuses a malformed storage spend ($name) before any flow', async ({ over }) => {
    const res = new FakeRes();
    await handleClaudiumApi(
      makeReq({
        method: 'POST',
        url: '/api/claudium/spend',
        body: spendBody(over),
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
    expect(storagePurchase).not.toHaveBeenCalled();
  });

  it('a key exactly at the shared bound passes the gate', async () => {
    const res = new FakeRes();
    await handleClaudiumApi(
      makeReq({
        method: 'POST',
        url: '/api/claudium/spend',
        body: spendBody({ idempotencyKey: 'k'.repeat(200) }),
      }),
      res as never,
      7,
    );
    expect(storagePurchase).toHaveBeenCalledTimes(1);
    expect((responseJson(res) as { granted: boolean }).granted).toBe(true);
  });

  it('drives BOTH dispatch arms to the identical storage body and hook input', async () => {
    // Registered arm: the RouteDef's own middleware chain, then the handler.
    const accountAndScopeForToken = vi.fn(async () => ({ accountId: 7, scope: 'full' as const }));
    const moderationStatusForAccount = vi.fn(async () => ({ locked: false }) as never);
    setClaudiumDbForTests({ accountAndScopeForToken, moderationStatusForAccount });
    const route = routes.find(
      (entry) => entry.method === 'POST' && entry.path === '/api/claudium/spend',
    );
    if (!route?.middleware) throw new Error('missing spend route middleware');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/claudium/spend',
      headers: { authorization: `Bearer ${'a'.repeat(64)}` },
      body: spendBody({ idempotencyKey: 'arm-a' }),
    });
    await compose([...route.middleware])(ctx);
    await route.handler(ctx);
    const registeredBody = JSON.parse((ctx.res as unknown as FakeRes).body);

    // Legacy arm: the exact server/main.ts composition (pre-auth limiter,
    // bearer-resolved account, then the shared core with its own fused
    // limiter active because rateLimitApplied is NOT passed).
    const legacyReq = makeReq({
      method: 'POST',
      url: '/api/claudium/spend',
      body: spendBody({ idempotencyKey: 'arm-b' }),
    });
    const preAuth = claudiumPreAuthMutationRateLimited(legacyReq);
    expect(preAuth?.allowed).toBe(true);
    const legacyRes = new FakeRes();
    await handleClaudiumApi(legacyReq, legacyRes as never, 7);
    const legacyBody = responseJson(legacyRes);

    expect(registeredBody).toEqual(legacyBody);
    expect(storagePurchase).toHaveBeenCalledTimes(2);
    const calls = storagePurchase.mock.calls as unknown as [Record<string, unknown>][];
    expect({ ...calls[0][0], idempotencyKey: null }).toEqual({
      ...calls[1][0],
      idempotencyKey: null,
    });
  });

  it('reuses the one spend limiter for storage on the legacy arm (no new bucket)', async () => {
    for (let i = 0; i < CLAUDIUM_SPEND_MAX_PER_MINUTE; i++) {
      const res = new FakeRes();
      await handleClaudiumApi(
        makeReq({
          method: 'POST',
          url: '/api/claudium/spend',
          body: spendBody({ idempotencyKey: `limit-${i}` }),
        }),
        res as never,
        7,
      );
      expect(res.statusCode).toBe(200);
    }
    const limited = new FakeRes();
    await handleClaudiumApi(
      makeReq({
        method: 'POST',
        url: '/api/claudium/spend',
        body: spendBody({ idempotencyKey: 'limit-final' }),
      }),
      limited as never,
      7,
    );
    expect(limited.statusCode).toBe(429);
    expect(responseJson(limited)).toEqual({ error: 'rate_limited' });
    expect(storagePurchase).toHaveBeenCalledTimes(CLAUDIUM_SPEND_MAX_PER_MINUTE);
  });

  it('a storage row survives EVERY store layer: fetch, proxy validator, handler filter', async () => {
    vi.stubEnv('WOC_ECONOMY_SERVICE_URL', 'http://127.0.0.1:9');
    vi.stubEnv('WOC_ECONOMY_INTERNAL_SECRET', 'test-secret');
    const catalog = [
      // Survives: a known storage SKU (owned false forever by construction).
      {
        itemId: 'strongbox_charter_1',
        name: 'Strongbox Charter I',
        kind: 'storage',
        costClaudium: 500,
        owned: false,
      },
      // Survives: a known rung SKU.
      {
        itemId: 'strongbox_rung_01',
        name: 'Strongbox Rung 1',
        kind: 'storage',
        costClaudium: 100,
        owned: false,
      },
      // Dropped by the handler allowlist: the service cannot mint an id the
      // game registry does not carry.
      {
        itemId: 'strongbox_rung_99',
        name: 'Counterfeit Rung',
        kind: 'storage',
        costClaudium: 1,
        owned: false,
      },
      // Dropped by the proxy validator: an out-of-set kind.
      {
        itemId: 'strongbox_rung_02',
        name: 'Mislabeled Rung',
        kind: 'mystery',
        costClaudium: 100,
        owned: false,
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => catalog })),
    );
    try {
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
            itemId: 'strongbox_charter_1',
            name: 'Strongbox Charter I',
            kind: 'storage',
            costClaudium: 500,
            owned: false,
          },
          {
            itemId: 'strongbox_rung_01',
            name: 'Strongbox Rung 1',
            kind: 'storage',
            costClaudium: 100,
            owned: false,
          },
        ],
      });
      // No storage row feeds the weapon-skin owned mirror.
      expect(grantWeaponSkins).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it('a tampered owned:true storage row still never reaches the skin grant mirror', async () => {
    vi.stubEnv('WOC_ECONOMY_SERVICE_URL', 'http://127.0.0.1:9');
    vi.stubEnv('WOC_ECONOMY_INTERNAL_SECRET', 'test-secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          {
            itemId: 'strongbox_rung_01',
            name: 'Strongbox Rung 1',
            kind: 'storage',
            costClaudium: 100,
            owned: true,
          },
        ],
      })),
    );
    try {
      const res = new FakeRes();
      await handleClaudiumApi(
        makeReq({ method: 'GET', url: '/api/claudium/store' }),
        res as never,
        7,
      );
      expect(res.statusCode).toBe(200);
      expect(grantWeaponSkins).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
