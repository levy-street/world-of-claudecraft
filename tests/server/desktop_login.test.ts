// Unit coverage for the desktop-login route layer (server/desktop_login_routes.ts).
//
// This slice pins the handoff pair that moved off the inline handleApi arms in
// server/main.ts onto RouteDefs on the shared server/http/ pipeline:
//   POST /api/desktop-login/create    [desktopLoginRateGuard, activeGuard]
//   POST /api/desktop-login/exchange  [desktopLoginRateGuard]
// It is a PARITY-FIRST migration: both handlers reuse the desktop_login.ts cores
// (issueDesktopLoginCode / handleDesktopLoginExchange) unchanged, so every body is
// the legacy { error } / { code, expiresInMs } / { token, username } byte-for-byte.
// The post-auth cores themselves are covered against fixtures in tests/security.test.ts
// ('desktop login route handlers'); this file covers the ROUTE LAYER: the route table
// shape, the FUSED limiter-before-auth ordering, the full-session scope fork
// (a read-scope token can no longer mint a handoff code), the exchange chain, the
// malformed-body deviation (desktopLoginBodyValidationRemap, a 500 problem+json where
// the legacy bare-return arm would HANG), and the single-use IP binding.
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is unset;
// desktop_login_routes.ts imports it, so set a dummy URL BEFORE the imports. The pool
// never connects: the guard/handler db reads are fakes supplied via
// setDesktopLoginRoutesDbForTests, and every asserted path returns before any real
// db call (429 in the limiter, 401/403 in the guard, an in-memory code consume, or a
// stubbed touchLogin/saveToken).
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_desktop_routes';

import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountInfoRow, AccountModerationStatus } from '../../server/db';
import {
  consumeDesktopLoginCode,
  createDesktopLoginCode,
  desktopLoginCodeCountForTest,
  resetDesktopLoginCodesForTest,
} from '../../server/desktop_login';
import {
  resetDesktopLoginRoutesDbForTests,
  routes,
  setDesktopLoginRoutesDbForTests,
} from '../../server/desktop_login_routes';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Method, Middleware } from '../../server/http/types';
import { rateLimited, resetRateLimits } from '../../server/ratelimit';
import { type FakeRes, fakeCtx, makeReq } from './helpers';

// A well-formed bearer header (64 lowercase-hex, matching the guard BEARER_PATTERN).
const BEARER = `Bearer ${'a'.repeat(64)}`;
// The exact legacy prose the fused register/login/desktop-login budget answers with.
const TOO_MANY = 'too many attempts, wait a minute and try again';
// The desktop-login code TTL (5 minutes), the expiresInMs a mint returns.
const TTL_MS = 5 * 60 * 1000;

type DbOverrides = Parameters<typeof setDesktopLoginRoutesDbForTests>[0];

// ---------------------------------------------------------------------------
// Local builders (redefined per-file, mirroring tests/server/discord.test.ts).
// ---------------------------------------------------------------------------

/** A fake accountAndScopeForToken resolving to account 7 with the given scope. */
function scopeOf(scope: 'read' | 'full') {
  return async () => ({ accountId: 7, scope });
}

/** A not-locked moderation status (the AccountModerationStatus happy-path shape). */
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

/** A full AccountInfoRow for account 7 named 'tito' (only id/username are read). */
function accountRow(overrides: Partial<AccountInfoRow> = {}): AccountInfoRow {
  return {
    id: 7,
    username: 'tito',
    password_hash: 'x',
    password_set: true,
    email: null,
    created_at: '2026-01-01T00:00:00.000Z',
    deactivated_at: null,
    locale: null,
    marketing_opt_in: false,
    ...overrides,
  };
}

/** Seed the guard + handler db with a full, non-locked account 7 named 'tito'. */
function authedDb(overrides: DbOverrides = {}): void {
  setDesktopLoginRoutesDbForTests({
    accountAndScopeForToken: scopeOf('full'),
    moderationStatusForAccount: async () => modStatus(),
    accountById: async () => accountRow(),
    touchLogin: async () => {},
    saveToken: async () => {},
    ...overrides,
  });
}

/** Read status/body/raw-body/content-type/headers off the fakeCtx's FakeRes. */
function readRes(res: http.ServerResponse): {
  status: number;
  body: unknown;
  raw: string;
  contentType: string | undefined;
  headers: Record<string, unknown>;
} {
  const fake = res as unknown as FakeRes;
  const raw = fake.body;
  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : undefined;
  } catch {
    body = undefined;
  }
  return {
    status: fake.statusCode,
    body,
    raw,
    contentType: fake.headers['content-type'] as string | undefined,
    headers: fake.headers,
  };
}

/** Narrow an unknown captured body to a record for a keyed dereference. */
function bodyRecord(body: unknown): Record<string, unknown> {
  return body as Record<string, unknown>;
}

/** Grab a route by method + path (paths repeat across methods, so both are needed). */
function routeFor(method: Method, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return route;
}

/** Drive a full route chain (its real middleware + handler) under withErrors. */
async function runRoute(
  method: Method,
  path: string,
  opts: { url?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const route = routeFor(method, path);
  let reached = false;
  const terminal: Middleware = async (c) => {
    reached = true;
    await route.handler(c);
  };
  // Mirror the dispatcher (server/http/dispatch.ts): withErrors is threaded the route's
  // own envelope. Neither desktop-login route sets meta.envelope, so the surface is
  // undefined and errors default to problem+json (RFC 9457).
  const ctx = fakeCtx({ method, url: opts.url ?? path, headers: opts.headers, body: opts.body });
  const stack: Middleware[] = [
    withErrors({ surface: route.meta?.envelope }),
    ...(route.middleware ?? []),
    terminal,
  ];
  await compose(stack)(ctx);
  return { reached, ...readRes(ctx.res) };
}

/**
 * Exhaust the shared per-IP register/login/desktop-login bucket for 127.0.0.1. The cap
 * is 20/min and rateLimited reports allowed=false only OVER the cap, so 21 recorded
 * attempts leave it tripped. makeReq()'s socket is 127.0.0.1, the same IP fakeCtx assigns
 * by default, so the route's own rateLimited(ctx.req) call reads the same bucket.
 */
function drainDefaultIpBucket(): void {
  let limited = false;
  for (let i = 0; i < 21; i++) limited = !rateLimited(makeReq()).allowed;
  if (!limited) throw new Error('expected the shared per-IP bucket to be exhausted');
}

beforeEach(() => {
  resetDesktopLoginCodesForTest();
  resetDesktopLoginRoutesDbForTests();
  resetRateLimits();
});

afterEach(() => {
  resetDesktopLoginCodesForTest();
  resetDesktopLoginRoutesDbForTests();
  resetRateLimits();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Route table shape.
// ---------------------------------------------------------------------------

describe('desktop-login route table', () => {
  it('exposes exactly the create + exchange POST pair, both on the api surface', () => {
    expect(routes).toHaveLength(2);
    const create = routeFor('POST', '/api/desktop-login/create');
    const exchange = routeFor('POST', '/api/desktop-login/exchange');
    expect(create.surface).toBe('api');
    expect(exchange.surface).toBe('api');
    // Neither route overrides the surface envelope, so both default to problem+json.
    expect(create.meta?.envelope).toBeUndefined();
    expect(exchange.meta?.envelope).toBeUndefined();
  });

  it('mounts two middleware on create (limiter, then auth) and one on exchange (limiter only)', () => {
    // A coarse structural check; the ORDER itself is pinned functionally below (a drained
    // bucket + no bearer is 429 not 401), never by array length alone.
    expect(routeFor('POST', '/api/desktop-login/create').middleware).toHaveLength(2);
    expect(routeFor('POST', '/api/desktop-login/exchange').middleware).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. The fused per-IP limiter, mounted BEFORE auth (the legacy fused order). One
// shared bucket with /api/register + /api/login; the guard runs ahead of the arms.
// ---------------------------------------------------------------------------

describe('fused per-IP limiter (limiter before auth)', () => {
  it('429s create with the drained bucket and NO bearer, proving the limiter runs before auth', async () => {
    // If the auth guard ran first, a no-bearer request would 401 here. It is 429, so the
    // limiter is mounted ahead of the auth guard exactly like the legacy ladder.
    authedDb();
    drainDefaultIpBucket();
    const r = await runRoute('POST', '/api/desktop-login/create', { body: {} });
    expect(r.status).toBe(429);
    expect(r.body).toEqual({ error: TOO_MANY, code: 'auth.too_many_attempts' });
    expect(r.status).not.toBe(401);
    expect(r.contentType).toBe('application/json');
    expect(r.reached).toBe(false);
  });

  it('401s create with a FRESH bucket and no bearer, completing the before/after ordering contrast', async () => {
    authedDb();
    const r = await runRoute('POST', '/api/desktop-login/create', { body: {} });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
    expect(r.reached).toBe(false);
  });

  it('shares ONE bucket with the register/login rateLimited: a direct drain trips the route guard', async () => {
    // Exhaust the bucket via the SAME rateLimited(req) call register/login use, then issue
    // a create with a full bearer: the route's own guard reads the same shared bucket and
    // 429s before the auth guard resolves the token.
    authedDb();
    drainDefaultIpBucket();
    const r = await runRoute('POST', '/api/desktop-login/create', {
      headers: { authorization: BEARER },
      body: {},
    });
    expect(r.status).toBe(429);
    expect(r.body).toEqual({ error: TOO_MANY, code: 'auth.too_many_attempts' });
    expect(r.reached).toBe(false);
  });

  it('429s exchange once the shared bucket is drained (the limiter also fronts exchange)', async () => {
    drainDefaultIpBucket();
    const r = await runRoute('POST', '/api/desktop-login/exchange', { body: { code: 'x' } });
    expect(r.status).toBe(429);
    expect(r.body).toEqual({ error: TOO_MANY, code: 'auth.too_many_attempts' });
    expect(r.reached).toBe(false);
  });

  it('carries NO auth guard on exchange: a fresh bucket + unknown code reaches the handler (401 invalid-code, not not-authenticated)', async () => {
    // Proves exchange is unauthenticated by design: with no bearer the handler still runs
    // and answers the invalid-code 401, never the auth guard's 'not authenticated' 401.
    const r = await runRoute('POST', '/api/desktop-login/exchange', {
      body: { code: 'a'.repeat(27) },
    });
    expect(r.reached).toBe(true);
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: 'invalid or expired desktop login code' });
  });
});

// ---------------------------------------------------------------------------
// 3. The scope fork on create: a full ACTIVE session is required. The
// activeGuard (createActiveGuard) mirrors bearerActiveAccount, so a read-scope
// companion/OAuth token can no longer mint a handoff code that exchange trades for
// a full session. Every rejection short-circuits before a code is minted.
// ---------------------------------------------------------------------------

describe('create: full-session scope fork', () => {
  it('401s a missing bearer and mints no code', async () => {
    authedDb();
    const r = await runRoute('POST', '/api/desktop-login/create', { body: {} });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
    expect(r.reached).toBe(false);
    expect(desktopLoginCodeCountForTest()).toBe(0);
  });

  it('401s a well-formed but unknown/stale bearer (the resolver returns null) and mints no code', async () => {
    // The guard's account-null branch, distinct from the missing-bearer 401 above:
    // the bearer PARSES, so accountAndScopeForToken IS consulted and resolves null
    // (a revoked or stale token). This replaced the pre-18b security.test.ts case
    // 'create rejects an unknown or stale token with 401' when the core went
    // post-auth; nothing else in the tree drives the shared guard's null branch.
    const resolver = vi.fn(async () => null);
    authedDb({ accountAndScopeForToken: resolver });
    const r = await runRoute('POST', '/api/desktop-login/create', {
      headers: { authorization: BEARER },
      body: {},
    });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
    expect(r.reached).toBe(false);
    // The resolver ran exactly once: this 401 is the account-null branch, not the
    // missing-bearer short-circuit (where the resolver is never called).
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(desktopLoginCodeCountForTest()).toBe(0);
  });

  it('403s a READ-scope token { error: "this token is read-only" } and mints no code', async () => {
    // The scope escalation the fork closes: a read token used to mint a code the exchange
    // leg upgraded to a full session. The guard now rejects it before the handler.
    authedDb({ accountAndScopeForToken: scopeOf('read') });
    const r = await runRoute('POST', '/api/desktop-login/create', {
      headers: { authorization: BEARER },
      body: {},
    });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'this token is read-only', code: 'auth.forbidden' });
    expect(r.reached).toBe(false);
    expect(desktopLoginCodeCountForTest()).toBe(0);
  });

  it('403s a moderation-locked full-scope account with the status message and mints no code', async () => {
    authedDb({
      moderationStatusForAccount: async () =>
        modStatus({
          locked: true,
          message: 'this account is suspended.',
        }),
    });
    const r = await runRoute('POST', '/api/desktop-login/create', {
      headers: { authorization: BEARER },
      body: {},
    });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'this account is suspended.', code: 'moderation.suspended' });
    expect(r.reached).toBe(false);
    expect(desktopLoginCodeCountForTest()).toBe(0);
  });

  it('200s a full-scope unlocked account with { code, expiresInMs }; the code round-trips from the same IP', async () => {
    authedDb();
    const r = await runRoute('POST', '/api/desktop-login/create', {
      headers: { authorization: BEARER },
      body: {},
    });
    expect(r.status).toBe(200);
    expect(r.contentType).toBe('application/json');
    const body = bodyRecord(r.body);
    expect(body.code).toMatch(/^[A-Za-z0-9_-]{20,80}$/);
    expect(body.expiresInMs).toBe(TTL_MS);
    expect(desktopLoginCodeCountForTest()).toBe(1);
    // The mint used ctx.req (default IP 127.0.0.1); a same-IP consume resolves account 7.
    expect(consumeDesktopLoginCode(makeReq(), body.code as string)).toEqual({
      accountId: 7,
      username: 'tito',
    });
  });
});

// ---------------------------------------------------------------------------
// 4. exchange through the real chain (unauthenticated; the single-use IP-bound code
// is the credential). The valid path stubs touchLogin/saveToken so no pool is touched.
// ---------------------------------------------------------------------------

describe('exchange through the route chain', () => {
  it('200s a valid code with { token, username } and saves the 64-hex token for that account', async () => {
    const issuer = makeReq();
    const { code } = createDesktopLoginCode(issuer, { id: 5, username: 'nova' });
    const touchLogin = vi.fn(async () => {});
    const saveToken = vi.fn(async () => {});
    setDesktopLoginRoutesDbForTests({
      moderationStatusForAccount: async () => modStatus(),
      touchLogin,
      saveToken,
    });

    const r = await runRoute('POST', '/api/desktop-login/exchange', { body: { code } });
    expect(r.reached).toBe(true);
    expect(r.status).toBe(200);
    const body = bodyRecord(r.body);
    expect(body.username).toBe('nova');
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(saveToken).toHaveBeenCalledWith(body.token, 5);
    expect(touchLogin).toHaveBeenCalledTimes(1);
  });

  it('401s an invalid/unknown code and never mints a session', async () => {
    const saveToken = vi.fn(async () => {});
    setDesktopLoginRoutesDbForTests({ saveToken });
    const r = await runRoute('POST', '/api/desktop-login/exchange', {
      body: { code: 'a'.repeat(27) },
    });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: 'invalid or expired desktop login code' });
    expect(saveToken).not.toHaveBeenCalled();
  });

  it('403s a moderation-locked account after consuming the code, never minting a session', async () => {
    const issuer = makeReq();
    const { code } = createDesktopLoginCode(issuer, { id: 5, username: 'nova' });
    const saveToken = vi.fn(async () => {});
    setDesktopLoginRoutesDbForTests({
      moderationStatusForAccount: async () =>
        modStatus({
          locked: true,
          message: 'this account is suspended.',
        }),
      saveToken,
    });
    const r = await runRoute('POST', '/api/desktop-login/exchange', { body: { code } });
    expect(r.status).toBe(403);
    // The exchange leg is code-authed (no shared bearer guard), so its inline
    // moderation 403 stays legacy prose-only (both dispatch twins share
    // handleDesktopLoginExchange, so it is parity-identical); prose-only handler
    // bodies are desktop-login's adjudicated contract.
    expect(r.body).toEqual({ error: 'this account is suspended.' });
    expect(saveToken).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. The desktopLoginBodyValidationRemap deviation, new-path pins. exchange self-reads
// its body (no withBody); a malformed body rejects out of readBody into the withErrors
// boundary, surfacing a 500 problem+json with an X-Request-Id, and an unexpected throw
// out of create's db reads hits the same boundary. The legacy bare-return arms'
// counterfactual is a request HANG, so this is the flag-gated reliability gain.
// ---------------------------------------------------------------------------

describe('desktopLoginBodyValidationRemap (the withErrors boundary)', () => {
  it('serializes invalid JSON on exchange as a 500 problem+json with an X-Request-Id (never a hang)', async () => {
    // A plain Error('bad json') from readBody is not a SyntaxError/HttpError/decode-failure,
    // so toAppError maps it to the catch-all 500 internal.error, serialized problem+json for
    // the default (undefined) envelope. Suppress the onUnexpected console.error noise.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // The real request stream emits 'not-json' then ends; readBody's JSON.parse throws.
    const r = await runRoute('POST', '/api/desktop-login/exchange', { body: 'not-json' });
    expect(r.status).toBe(500);
    expect(r.contentType).toBe('application/problem+json');
    expect(bodyRecord(r.body).code).toBe('internal.error');
    expect(r.headers['x-request-id']).toBeDefined();
    errSpy.mockRestore();
  });

  it('serializes an unexpected throw on create (a rejecting db read) as a 500 problem+json, minting no code', async () => {
    // The create half of the same withErrors boundary: the guard passes, then the
    // core's accountById rejects (a Postgres error). The legacy bare-return arm's
    // counterfactual is the same HANG class documented on the deviation.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    authedDb({
      accountById: async () => {
        throw new Error('pg exploded');
      },
    });
    const r = await runRoute('POST', '/api/desktop-login/create', {
      headers: { authorization: BEARER },
      body: {},
    });
    expect(r.status).toBe(500);
    expect(r.contentType).toBe('application/problem+json');
    expect(bodyRecord(r.body).code).toBe('internal.error');
    expect(r.headers['x-request-id']).toBeDefined();
    expect(desktopLoginCodeCountForTest()).toBe(0);
    errSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 6. IP binding through the route chain. A code is bound to the minting IP; exchanging
// it from a different IP fails closed (401), and from the same IP succeeds.
// ---------------------------------------------------------------------------

describe('single-use IP binding', () => {
  it('401s a code minted for IP A but exchanged from IP B', async () => {
    // Mint against a forwarded IP A; makeReq's loopback socket is a trusted proxy, so
    // requestIp resolves the X-Forwarded-For hop.
    const issuer = makeReq({ headers: { 'x-forwarded-for': '203.0.113.1' } });
    const { code } = createDesktopLoginCode(issuer, { id: 5, username: 'nova' });
    const saveToken = vi.fn(async () => {});
    setDesktopLoginRoutesDbForTests({
      moderationStatusForAccount: async () => modStatus(),
      saveToken,
    });
    const r = await runRoute('POST', '/api/desktop-login/exchange', {
      body: { code },
      headers: { 'x-forwarded-for': '203.0.113.2' },
    });
    expect(r.reached).toBe(true);
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: 'invalid or expired desktop login code' });
    expect(saveToken).not.toHaveBeenCalled();
  });

  it('200s the same code exchanged from the minting IP (the 401 above is the IP bind, not a broken setup)', async () => {
    const issuer = makeReq({ headers: { 'x-forwarded-for': '203.0.113.1' } });
    const { code } = createDesktopLoginCode(issuer, { id: 5, username: 'nova' });
    const touchLogin = vi.fn(async () => {});
    const saveToken = vi.fn(async () => {});
    setDesktopLoginRoutesDbForTests({
      moderationStatusForAccount: async () => modStatus(),
      touchLogin,
      saveToken,
    });
    const r = await runRoute('POST', '/api/desktop-login/exchange', {
      body: { code },
      headers: { 'x-forwarded-for': '203.0.113.1' },
    });
    expect(r.status).toBe(200);
    expect(bodyRecord(r.body).username).toBe('nova');
    expect(saveToken).toHaveBeenCalledTimes(1);
  });
});
