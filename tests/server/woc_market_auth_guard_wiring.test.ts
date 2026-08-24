// The auth-guard cache's MARKETPLACE wiring, proven through the real route
// table and the real middleware chains (compose over each route's mounted
// middleware, the ownership-coverage harness shape): the cached bundle serves
// BOTH player guards (the read guard and the active guard, because the hot
// offers GET rides the active one), the test-override seam keeps absolute
// precedence over the cache, revocation busts flip the route-level answer,
// and the ADMIN surface is UNCACHED BY BEHAVIOR: with one shared underlying
// token store, a revocation refuses the admin gate on the very next request
// while the player guard still answers from its warm cache until bust or
// TTL. That contrast is the pin the 17 decision asked for: the admin arm
// provably never reads through the cache.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetAdminDbForTests, setAdminDbForTests } from '../../server/admin';
import type { AccountModerationRow, AuthTokenRow } from '../../server/auth_guard_core';
import { compose } from '../../server/http/compose';
import type { Ctx, Middleware, RouteDef } from '../../server/http/types';
import { WocAuthGuardCache } from '../../server/woc_auth_guard_cache';
import type { WocMarketService } from '../../server/woc_market';
import {
  configureWocMarketRuntime,
  resetWocMarketGuardDbForTests,
  resetWocMarketRuntimeForTests,
  routes,
  setWocMarketGuardDbForTests,
} from '../../server/woc_market_routes';
import { type FakeRes, fakeCtx } from './helpers';

const NOW = 1_820_000_000_000;
const TOKEN = 'a'.repeat(64);
const ADMIN_TOKEN = 'b'.repeat(64);

function routeFor(method: string, path: string): RouteDef {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route registered for ${method} ${path}`);
  return route;
}

/** Run a route's REAL middleware chain with a spy terminal handler (the
 *  guards and limiter are the subject; the handler body is not). */
async function runGuards(
  route: RouteDef,
  token: string,
): Promise<{ ctx: Ctx; res: FakeRes; handler: ReturnType<typeof vi.fn> }> {
  const ctx = fakeCtx({
    method: route.method,
    url: route.path,
    headers: { authorization: `Bearer ${token}` },
  });
  const handler = vi.fn(async () => {});
  await compose([...(route.middleware ?? []), handler as unknown as Middleware])(ctx);
  return { ctx, res: ctx.res as unknown as FakeRes, handler };
}

/** The shared rig: ONE token/moderation store; the CACHE reads it through
 *  counted fetchers, the ADMIN seam reads it directly (the production
 *  shape: requireAdmin resolves through adminDb(), never the cache). */
function rig() {
  let nowMs = NOW;
  const tokens = new Map<string, AuthTokenRow>();
  const accounts = new Map<number, AccountModerationRow>();
  const calls = { token: 0, moderation: 0, adminToken: 0, adminRoles: 0 };
  tokens.set(TOKEN, { accountId: 7, scope: 'full', expiresAtMs: NOW + 3600_000 });
  tokens.set(ADMIN_TOKEN, { accountId: 9, scope: 'full', expiresAtMs: NOW + 3600_000 });
  accounts.set(7, {
    banned_at: null,
    suspended_until: null,
    moderation_reason: null,
    chat_muted_until: null,
    chat_strikes: 0,
    deactivated_at: null,
    messages: null,
    window_minutes: null,
  });
  const cache = new WocAuthGuardCache(
    {
      fetchTokenRow: async (token) => {
        calls.token += 1;
        return tokens.get(token) ?? null;
      },
      fetchModerationRow: async (accountId) => {
        calls.moderation += 1;
        return accounts.get(accountId) ?? null;
      },
    },
    { now: () => nowMs },
  );
  configureWocMarketRuntime({
    service: {} as unknown as WocMarketService,
    authGuardDb: cache,
  });
  setAdminDbForTests({
    accountAndScopeForToken: async (token: string) => {
      calls.adminToken += 1;
      const row = tokens.get(token);
      if (!row || (row.scope !== 'full' && row.scope !== 'read')) return null;
      return { accountId: row.accountId, scope: row.scope as 'full' | 'read' };
    },
    adminRolesForAccount: async () => {
      calls.adminRoles += 1;
      return { username: 'ops', roles: ['superadmin'] };
    },
  });
  return {
    cache,
    tokens,
    accounts,
    calls,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

afterEach(() => {
  resetWocMarketRuntimeForTests();
  resetWocMarketGuardDbForTests();
  resetAdminDbForTests();
});

describe('the cached bundle on the player guards', () => {
  it('serves the read-guard GETs through the cache (one fetch pair, then hits)', async () => {
    const r = rig();
    const status = routeFor('GET', '/api/woc-market/status');
    const first = await runGuards(status, TOKEN);
    expect(first.handler).toHaveBeenCalledTimes(1);
    expect(first.ctx.account).toEqual({ accountId: 7, scope: 'full' });
    expect(r.calls).toMatchObject({ token: 1, moderation: 1 });
    const second = await runGuards(status, TOKEN);
    expect(second.handler).toHaveBeenCalledTimes(1);
    expect(r.calls).toMatchObject({ token: 1, moderation: 1 });
  });

  it('serves the ACTIVE guard through the same cache (the hot offers GET rides it)', async () => {
    const r = rig();
    await runGuards(routeFor('GET', '/api/woc-market/status'), TOKEN);
    const offers = await runGuards(routeFor('GET', '/api/woc-market/offers'), TOKEN);
    expect(offers.handler).toHaveBeenCalledTimes(1);
    expect(offers.ctx.account).toEqual({ accountId: 7, scope: 'full' });
    // Warm from the status poll: the active guard added NO fetches.
    expect(r.calls).toMatchObject({ token: 1, moderation: 1 });
  });

  it('flips the route answer to 401 after a revocation bust, via a fresh probe', async () => {
    const r = rig();
    const status = routeFor('GET', '/api/woc-market/status');
    await runGuards(status, TOKEN);
    r.tokens.delete(TOKEN);
    // Warm cache: the revocation is invisible until the bust (the recorded
    // TTL bound is the ceiling; same-process writers always bust).
    const stale = await runGuards(status, TOKEN);
    expect(stale.handler).toHaveBeenCalledTimes(1);
    r.cache.bustToken(TOKEN);
    const fresh = await runGuards(status, TOKEN);
    expect(fresh.handler).not.toHaveBeenCalled();
    expect(fresh.res.statusCode).toBe(401);
    expect(r.calls.token).toBe(2);
  });

  it('keeps absolute precedence for the test-override seam over the cache', async () => {
    const r = rig();
    setWocMarketGuardDbForTests({
      accountAndScopeForToken: async () => ({ accountId: 42, scope: 'full' as const }),
      moderationStatusForAccount: async () => ({
        locked: false,
        banned: false,
        suspendedUntil: null,
        reason: '',
        message: '',
        chatMutedUntil: null,
        chatStrikes: 0,
        generalChatRateLimit: null,
      }),
    });
    const { ctx, handler } = await runGuards(routeFor('GET', '/api/woc-market/status'), TOKEN);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(ctx.account?.accountId).toBe(42);
    // The cache saw NOTHING: an override rig can never be answered from a
    // cache it cannot see or bust.
    expect(r.calls).toMatchObject({ token: 0, moderation: 0 });
  });
});

describe('the admin surface stays uncached (behavioral contrast)', () => {
  it('refuses a revoked admin bearer on the VERY NEXT request while the player cache still serves', async () => {
    const r = rig();
    const adminList = routeFor('GET', '/admin/api/woc-market/listings');
    const status = routeFor('GET', '/api/woc-market/status');
    // Warm both surfaces from the one shared store.
    const adminOk = await runGuards(adminList, ADMIN_TOKEN);
    expect(adminOk.handler).toHaveBeenCalledTimes(1);
    const playerOk = await runGuards(status, TOKEN);
    expect(playerOk.handler).toHaveBeenCalledTimes(1);
    // Revoke BOTH tokens in the store, no busts.
    r.tokens.delete(ADMIN_TOKEN);
    r.tokens.delete(TOKEN);
    // The admin gate re-reads per request: refused immediately.
    const adminAfter = await runGuards(adminList, ADMIN_TOKEN);
    expect(adminAfter.handler).not.toHaveBeenCalled();
    expect(adminAfter.res.statusCode).toBe(401);
    // The player guard still answers from its warm cache (the TTL bound),
    // which is exactly what proves WHICH arm is cached and which is not.
    const playerAfter = await runGuards(status, TOKEN);
    expect(playerAfter.handler).toHaveBeenCalledTimes(1);
    // And the admin resolutions never touched the cache's fetchers, while
    // the staff-role read stays re-read per request (a dashboard revocation
    // applies to the next call: the production design, not a test artifact).
    expect(r.calls.adminToken).toBe(2);
    expect(r.calls.adminRoles).toBe(1);
    expect(r.calls.token).toBe(1);
  });
});

describe('the refusal bodies over the cached bundle', () => {
  it('emits the exact moderation 403 from a cached banned row', async () => {
    const r = rig();
    r.accounts.set(7, {
      banned_at: '2026-01-01T00:00:00Z',
      suspended_until: null,
      moderation_reason: 'rmt',
      chat_muted_until: null,
      chat_strikes: 0,
      deactivated_at: null,
      messages: null,
      window_minutes: null,
    });
    const { res, handler } = await runGuards(routeFor('GET', '/api/woc-market/status'), TOKEN);
    expect(handler).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    // The exact legacy moderation body, byte-compatible through the cached
    // arm (moderationErrorBody over the per-read computed status).
    expect(JSON.parse(res.body || '{}')).toEqual({
      error: 'This account has been banned.',
      code: 'moderation.banned',
    });
  });

  it('emits the exact read-only 403 for a cached read-scope token on the ACTIVE guard', async () => {
    const r = rig();
    r.tokens.set(TOKEN, { accountId: 7, scope: 'read', expiresAtMs: NOW + 3600_000 });
    const { res, handler } = await runGuards(routeFor('GET', '/api/woc-market/offers'), TOKEN);
    expect(handler).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body || '{}')).toEqual({
      error: 'this token is read-only',
      code: 'auth.forbidden',
    });
  });

  it('emits the exact suspension 403 (with date) from a cached suspended row', async () => {
    const r = rig();
    const until = new Date(NOW + 3600_000);
    r.accounts.set(7, {
      banned_at: null,
      suspended_until: until.toISOString(),
      moderation_reason: 'griefing',
      chat_muted_until: null,
      chat_strikes: 0,
      deactivated_at: null,
      messages: null,
      window_minutes: null,
    });
    const { res, handler } = await runGuards(routeFor('GET', '/api/woc-market/status'), TOKEN);
    expect(handler).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body || '{}')).toEqual({
      error: `This account is suspended until ${until.toUTCString()}.`,
      code: 'moderation.suspended_until',
      date: until.toISOString(),
    });
  });

  it('emits the exact deactivation 403 from a cached deactivated row', async () => {
    const r = rig();
    r.accounts.set(7, {
      banned_at: null,
      suspended_until: null,
      moderation_reason: null,
      chat_muted_until: null,
      chat_strikes: 0,
      deactivated_at: '2026-01-01T00:00:00Z',
      messages: null,
      window_minutes: null,
    });
    const { res, handler } = await runGuards(routeFor('GET', '/api/woc-market/status'), TOKEN);
    expect(handler).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body || '{}')).toEqual({
      error: 'This account has been deactivated.',
      code: 'account.deactivated',
    });
  });

  it('emits the exact 401 body for an unknown bearer through the cached bundle', async () => {
    const r = rig();
    const { res, handler } = await runGuards(
      routeFor('GET', '/api/woc-market/status'),
      'f'.repeat(64),
    );
    expect(handler).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body || '{}')).toEqual({
      error: 'not authenticated',
      code: 'auth.required',
    });
    // The refusal came from a REAL probe through the cache (no negative
    // caching): the fetch counter moved.
    expect(r.calls.token).toBe(1);
  });
});
