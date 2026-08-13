// Reliquary API surface: the public rarity read (runtime-injected cache, per-IP
// public-read budget) and its route-table shape. The deeds rarity rung
// (tests/server/deeds.test.ts) is the model this mirrors.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_reliquary_units';

import type * as http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PUBLIC_READ_MAX_PER_MINUTE,
  publicReadRateLimited,
  resetPublicReadRateLimits,
} from '../../server/ratelimit';
import {
  configureReliquaryRuntime,
  resetReliquaryRuntimeForTests,
  routes,
} from '../../server/reliquary';
import type { ReliquaryRarity } from '../../src/world_api';
import { type FakeRes, fakeCtx, makeReq } from './helpers';

const RARITY_PATH = '/api/reliquary/rarity';

/** Read a handler's response off the fakeCtx's FakeRes. */
function captured(res: http.ServerResponse): { status: number; body: unknown } {
  const fake = res as unknown as FakeRes;
  return { status: fake.statusCode, body: fake.body ? JSON.parse(fake.body) : undefined };
}

/** Grab the registered handler by its route path. */
function handlerFor(path: string, method = 'GET') {
  const route = routes.find((r) => r.path === path && r.method === method);
  if (!route) throw new Error(`no route registered for ${method} ${path}`);
  return route.handler;
}

afterEach(() => {
  resetReliquaryRuntimeForTests();
  resetPublicReadRateLimits();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Route table shape
// ---------------------------------------------------------------------------

describe('reliquary route table', () => {
  it('registers exactly the anonymous rarity read', () => {
    expect(routes).toHaveLength(1);
    const rarity = routes.find((r) => r.path === RARITY_PATH);
    expect(rarity?.method).toBe('GET');
    expect(rarity?.surface).toBe('api');
    expect(rarity?.middleware).toBeUndefined(); // anonymous; the budget guard is in-handler
  });
});

// ---------------------------------------------------------------------------
// GET /api/reliquary/rarity
// ---------------------------------------------------------------------------

describe('rarity handler', () => {
  it('serves the injected runtime payload verbatim', async () => {
    const payload: ReliquaryRarity = {
      totalEligible: 120,
      found: { cryptbone_helm: 3, 'slain:old_greyjaw': 2 },
      illuminated: { conquerors_hollow_crypt: 1 },
    };
    configureReliquaryRuntime({ reliquaryRarity: async () => payload });
    const ctx = fakeCtx({ method: 'GET', url: RARITY_PATH });
    await handlerFor(RARITY_PATH)(ctx);
    expect(captured(ctx.res)).toEqual({ status: 200, body: payload });
  });

  it('answers 429 { error } once the public-read budget is exhausted, before the runtime read', async () => {
    const rarityRead = vi.fn(
      async (): Promise<ReliquaryRarity> => ({ totalEligible: 0, found: {}, illuminated: {} }),
    );
    configureReliquaryRuntime({ reliquaryRarity: rarityRead });
    for (let i = 0; i < PUBLIC_READ_MAX_PER_MINUTE + 1; i++) {
      publicReadRateLimited(makeReq({ method: 'GET', url: RARITY_PATH }));
    }
    const ctx = fakeCtx({ method: 'GET', url: RARITY_PATH });
    await handlerFor(RARITY_PATH)(ctx);
    expect(captured(ctx.res)).toEqual({ status: 429, body: { error: 'rate limited' } });
    // The denial precedes the cache read, so a budget-exhausted caller can
    // never drive the characters walk.
    expect(rarityRead).not.toHaveBeenCalled();
  });

  it('fails loudly if a request somehow beats the boot wiring', async () => {
    const ctx = fakeCtx({ method: 'GET', url: RARITY_PATH });
    await expect(handlerFor(RARITY_PATH)(ctx)).rejects.toThrow(/configureReliquaryRuntime/);
  });
});
