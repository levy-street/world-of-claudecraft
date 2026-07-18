process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_welcome';

import type * as http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { compose } from '../../server/http/compose';
import {
  resetWelcomeClockForTests,
  resetWelcomeDbForTests,
  routes,
  setWelcomeClockForTests,
  setWelcomeDbForTests,
} from '../../server/welcome';
import { fakeCtx } from './helpers';

interface FakeResShape {
  statusCode: number;
  body: string;
}

function captured(res: http.ServerResponse): { status: number; body: unknown } {
  const fake = res as unknown as FakeResShape;
  return { status: fake.statusCode, body: fake.body ? JSON.parse(fake.body) : undefined };
}

// Full AccountModerationStatus fixtures for the guard's moderation gate.
function okStatus() {
  return {
    locked: false,
    banned: false,
    suspendedUntil: null,
    reason: '',
    message: '',
    chatMutedUntil: null,
    chatStrikes: 0,
  };
}
function bannedStatus() {
  return {
    locked: true,
    banned: true,
    suspendedUntil: null,
    reason: 'banned',
    message: 'This account has been banned.',
    chatMutedUntil: null,
    chatStrikes: 0,
  };
}

const VALID_BEARER = `Bearer ${'a'.repeat(64)}`;

function runRoute(ctx: Parameters<(typeof routes)[0]['handler']>[0]): Promise<void> {
  const route = routes[0];
  return compose([...(route.middleware ?? [])])(ctx, async () => {
    await route.handler(ctx);
  });
}

afterEach(() => {
  resetWelcomeDbForTests();
  resetWelcomeClockForTests();
  delete process.env.ARMORY_PROMO_ENABLED;
});

describe('GET /api/welcome/flags', () => {
  it('serves armoryPromoEnabled=false by default for an authenticated caller', async () => {
    setWelcomeDbForTests({
      accountAndScopeForToken: async () => ({ accountId: 1, scope: 'full' }),
      moderationStatusForAccount: async () => okStatus(),
    });
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/welcome/flags',
      headers: { authorization: VALID_BEARER },
    });
    await runRoute(ctx);
    expect(captured(ctx.res)).toEqual({ status: 200, body: { armoryPromoEnabled: false } });
  });

  it('serves armoryPromoEnabled=true when the env flag is set', async () => {
    process.env.ARMORY_PROMO_ENABLED = '1';
    setWelcomeDbForTests({
      accountAndScopeForToken: async () => ({ accountId: 1, scope: 'full' }),
      moderationStatusForAccount: async () => okStatus(),
    });
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/welcome/flags',
      headers: { authorization: VALID_BEARER },
    });
    await runRoute(ctx);
    expect(captured(ctx.res)).toEqual({ status: 200, body: { armoryPromoEnabled: true } });
  });

  it('caches the flag read across the cache window', async () => {
    let now = 0;
    setWelcomeClockForTests(() => now);
    setWelcomeDbForTests({
      accountAndScopeForToken: async () => ({ accountId: 1, scope: 'full' }),
      moderationStatusForAccount: async () => okStatus(),
    });
    const ctx1 = fakeCtx({
      method: 'GET',
      url: '/api/welcome/flags',
      headers: { authorization: VALID_BEARER },
    });
    await runRoute(ctx1);
    expect(captured(ctx1.res).body).toEqual({ armoryPromoEnabled: false });

    // Flip the env flag mid-window: a cached read should NOT observe it yet.
    process.env.ARMORY_PROMO_ENABLED = '1';
    now = 5_000;
    const ctx2 = fakeCtx({
      method: 'GET',
      url: '/api/welcome/flags',
      headers: { authorization: VALID_BEARER },
    });
    await runRoute(ctx2);
    expect(captured(ctx2.res).body).toEqual({ armoryPromoEnabled: false });

    // Past the cache window, the fresh env value is picked up.
    now = 31_000;
    const ctx3 = fakeCtx({
      method: 'GET',
      url: '/api/welcome/flags',
      headers: { authorization: VALID_BEARER },
    });
    await runRoute(ctx3);
    expect(captured(ctx3.res).body).toEqual({ armoryPromoEnabled: true });
  });

  it('401s without a bearer token', async () => {
    const ctx = fakeCtx({ method: 'GET', url: '/api/welcome/flags' });
    await runRoute(ctx);
    expect(captured(ctx.res).status).toBe(401);
  });

  it('403s a banned account (moderation gate)', async () => {
    setWelcomeDbForTests({
      accountAndScopeForToken: async () => ({ accountId: 1, scope: 'full' }),
      moderationStatusForAccount: async () => bannedStatus(),
    });
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/welcome/flags',
      headers: { authorization: VALID_BEARER },
    });
    await runRoute(ctx);
    expect(captured(ctx.res).status).toBe(403);
  });
});
