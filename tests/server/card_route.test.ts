// Unit coverage for the binary player-card upload route (server/wallet.ts).
//
// POST /api/card carries a THREE-middleware chain that must run in a load-bearing
// order: [cardContentLengthGuard, activeGuard, rateLimit(CARD_UPLOAD_POLICY)]. This
// file pins that order by BEHAVIOR (never by array length, per the auth-migration lesson):
//  - step 1: an oversize declared Content-Length is rejected 413 with Connection: close
//    by the FIRST guard, BEFORE any bearer is checked and BEFORE the body is read;
//  - step 2: a normal Content-Length with no bearer falls through to activeGuard, the
//    SECOND middleware, which 401s (so content-length precedes auth);
//  - step 3: the fused ip+account limiter is the THIRD middleware, mounted AFTER
//    activeGuard (it needs ctx.account), and emits the coded problem+json 429.
// It also pins that the card handler / pre-auth guard write plain application/json
// { error } bodies (json() directly), NOT RFC 9457 problem+json (correcting a planning-doc
// claim): only the middleware-thrown 429 is problem+json.
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is unset;
// wallet.ts imports it, so set a dummy URL. The pool never connects: the guard's db
// reads are a fake supplied via setWalletDbForTests, and the card level lookup is a
// fake injected via configureWalletRuntime.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_phase14_card_units';

import { readFileSync } from 'node:fs';
import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountModerationStatus } from '../../server/db';
import { compose } from '../../server/http/compose';
import { withSecurityHeaders } from '../../server/http/middleware/security_headers';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Method, Middleware } from '../../server/http/types';
import { handleCardUpload } from '../../server/player_card';
import {
  CARD_UPLOAD_MAX_PER_MINUTE,
  resetCardUploadRateLimits,
  resetRateLimitClock,
  setRateLimitClock,
} from '../../server/ratelimit';
import {
  configureWalletRuntime,
  resetWalletDbForTests,
  resetWalletRuntimeForTests,
  routes,
  setWalletDbForTests,
} from '../../server/wallet';
import { type FakeRes, fakeCtx } from './helpers';

// Wrap handleCardUpload in a mock whose DEFAULT delegates to the real implementation (so the
// pre-auth 413, no-auth 401, character-id-required 400, and drain-to-429 tests below keep the
// unchanged handler behavior), while the success + not-found tests override it once to isolate
// the ROUTE chain. cardUploadContentLengthTooLarge stays real via ...actual, so the pre-auth
// byte-cap guard is unaffected.
vi.mock('../../server/player_card', async (importActual) => {
  const actual = await importActual<typeof import('../../server/player_card')>();
  return {
    ...actual,
    handleCardUpload: vi.fn(actual.handleCardUpload),
  };
});

// A well-formed bearer header (64 lowercase-hex, matching wallet.ts BEARER_PATTERN).
const BEARER = `Bearer ${'a'.repeat(64)}`;

// A declared Content-Length far above MAX_CARD_BYTES (4 MiB); cardUploadContentLengthTooLarge
// reads this header and short-circuits the pre-auth 413.
const OVERSIZE_CONTENT_LENGTH = '999999999';

// ---------------------------------------------------------------------------
// Local builders (redefined per-file, mirroring tests/server/account.test.ts).
// ---------------------------------------------------------------------------

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

/** A fake accountAndScopeForToken resolving to account 7 with the given scope. */
function scopeOf(scope: 'read' | 'full') {
  return async () => ({ accountId: 7, scope });
}

/** Read status/body/raw-body/content-type and the captured headers off the FakeRes. */
function readRes(res: http.ServerResponse): {
  status: number;
  body: unknown;
  raw: string;
  contentType: string | undefined;
  headers: Record<string, string | number | string[]>;
} {
  const fake = res as unknown as FakeRes;
  return {
    status: fake.statusCode,
    body: fake.body ? JSON.parse(fake.body) : undefined,
    raw: fake.body,
    contentType: fake.headers['content-type'] as string | undefined,
    headers: fake.headers,
  };
}

/** Grab a route by method + path (paths repeat across methods, so both are needed). */
function routeFor(method: Method, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return route;
}

/** Load a characterization golden (status + raw body + headers) by its main-surface name. */
function fixture(name: string): {
  status: number;
  body: string;
  headers: Record<string, string | number>;
} {
  const url = new URL(`./fixtures/main/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8'));
}

/**
 * Drive the POST /api/card chain. UNLIKE the template runRoute, this injects NO default
 * Authorization header: the pre-auth tests must arrive with no bearer so the content-length
 * guard is proven to fire (413) BEFORE activeGuard (401). The stack is built by hand exactly
 * as runOnion would compose it for this route (withErrors, the problem+json boundary, then
 * the route's own middleware, then a terminal that runs the handler and records whether the
 * chain reached it), and the caller opts into a bearer via `headers` when it wants one.
 */
async function runCard(opts: { headers?: Record<string, string>; url?: string } = {}) {
  const route = routeFor('POST', '/api/card');
  let reached = false;
  const terminal: Middleware = async (c) => {
    reached = true;
    await route.handler(c);
  };
  const ctx = fakeCtx({
    method: 'POST',
    url: opts.url ?? '/api/card',
    headers: opts.headers,
  });
  // Mirror the real serving path: routeHttpRequest applies the top-level
  // security headers BEFORE any dispatch, so the byte-identical golden (re-pinned
  // through routeHttpRequest) carries them on every response, this 413 included.
  withSecurityHeaders(ctx.req, ctx.res);
  const stack: Middleware[] = [
    withErrors({ surface: 'problem+json' }),
    ...(route.middleware ?? []),
    terminal,
  ];
  await compose(stack)(ctx);
  return { reached, ...readRes(ctx.res) };
}

beforeEach(() => {
  // The card level lookup the handler needs (the 400 'character id required' path returns
  // before it is touched, but install it anyway so no test can leak an unconfigured runtime).
  configureWalletRuntime({ liveLevelForCharacter: () => null });
  // The activeGuard db reads: a full-session token for account 7, not moderation-locked.
  setWalletDbForTests({
    accountAndScopeForToken: scopeOf('full'),
    moderationStatusForAccount: async () => modStatus(),
  });
  // Pin the limiter clock so the sliding window is deterministic (never Date.now).
  setRateLimitClock(() => 1_000_000);
  resetCardUploadRateLimits();
});

afterEach(() => {
  resetWalletDbForTests();
  resetWalletRuntimeForTests();
  resetCardUploadRateLimits();
  resetRateLimitClock();
});

// ---------------------------------------------------------------------------
// Content-Type gate wiring pin: the REAL card RouteDef declares its binary request body.
// ---------------------------------------------------------------------------

describe('content-type gate exemption wiring', () => {
  it("declares meta.requestBody 'binary' on the real POST /api/card RouteDef", () => {
    // The Content-Type 415 gate exempts by MATCHED-RouteDef metadata,
    // so this literal is the ONLY thing standing between an enforce-mode flip
    // (API_CONTENT_TYPE_ENFORCE=1) and a 415 on every image/png card upload.
    // Dropping it would break no other test until that flip; this pin makes the
    // regression fail now.
    const route = routeFor('POST', '/api/card');
    expect(route.meta?.requestBody).toBe('binary');
  });
});

// ---------------------------------------------------------------------------
// Functional order proof, step 1: the content-length guard is the FIRST middleware.
// ---------------------------------------------------------------------------

describe('pre-auth content-length 413 (byte-identical to the golden)', () => {
  it('413s an oversize content-length with NO auth, matching card_too_large_413.json byte-for-byte', async () => {
    const r = await runCard({ headers: { 'content-length': OVERSIZE_CONTENT_LENGTH } });
    // Byte-for-byte: status 413, body {"error":"image too large"}, and exactly the route's
    // three headers { connection: 'close', content-length: 27, content-type: application/json }
    // plus the top-level security-header set the golden now carries.
    const golden = fixture('card_too_large_413');
    expect({ status: r.status, body: r.raw, headers: r.headers }).toEqual(golden);
    // The terminal (the handler) is never reached: the guard short-circuits with no next().
    expect(r.reached).toBe(false);
  });

  it('fires BEFORE auth (413 with no bearer, never 401) and answers application/json', async () => {
    const r = await runCard({ headers: { 'content-length': OVERSIZE_CONTENT_LENGTH } });
    expect(r.status).toBe(413);
    expect(r.body).toEqual({ error: 'image too large' });
    // The card guard writes json() directly: a plain application/json { error } body, NOT the
    // RFC 9457 problem+json the limiter 429 uses (correcting the planning-doc mis-statement).
    expect(r.contentType).toBe('application/json');
    // Connection: close tells the socket to stop streaming a huge upload rather than keep-alive.
    expect(r.headers.connection).toBe('close');
  });
});

// ---------------------------------------------------------------------------
// Functional order proof, step 2: a normal content-length falls through to activeGuard,
// the SECOND middleware, which 401s a missing bearer (so content-length precedes auth).
// ---------------------------------------------------------------------------

describe('content-length gate precedes auth (401 after a normal content-length)', () => {
  it('401s not-authenticated for a normal content-length with no bearer', async () => {
    const r = await runCard({ headers: { 'content-length': '100' } });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
    expect(r.contentType).toBe('application/json');
    expect(r.reached).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The card handler's own db-free 400 (missing ?character) is plain application/json, proving
// the handler writes json() directly (it is NOT wrapped as RFC 9457 problem+json).
// ---------------------------------------------------------------------------

describe('character-id-required 400 (JSON, not problem+json)', () => {
  it('400s character-id-required as application/json for an authed upload with no ?character', async () => {
    const r = await runCard({ headers: { authorization: BEARER } });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'character id is required' });
    expect(r.contentType).toBe('application/json');
    // The chain passed content-length + auth + the limiter and reached the handler, which
    // self-read its query, found no character, and short-circuited db-free.
    expect(r.reached).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Functional order proof, step 3: the fused ip+account CARD_UPLOAD_POLICY limiter is the
// THIRD middleware, mounted AFTER activeGuard (it reads ctx.account). It is the
// rateLimitedBodyToCode known deviation: a coded problem+json 429, not a legacy { error }.
// ---------------------------------------------------------------------------

describe('coded 429 (rateLimitedBodyToCode deviation)', () => {
  it('emits a problem+json 429 rate_limit.exceeded on the attempt past the per-minute cap', async () => {
    // Drain the bucket with CARD_UPLOAD_MAX_PER_MINUTE authed uploads WITHOUT a ?character
    // query: each is a db-free 400 that still records a limiter token (same IP + account).
    for (let i = 0; i < CARD_UPLOAD_MAX_PER_MINUTE; i++) {
      const r = await runCard({ headers: { authorization: BEARER } });
      expect(r.status).toBe(400); // under the cap: reaches the handler, character-id-required
    }
    // The next upload trips the fused limiter, which throws HttpError(429) and surfaces as
    // problem+json through withErrors, NOT the handler's plain json().
    const limited = await runCard({ headers: { authorization: BEARER } });
    expect(limited.status).toBe(429);
    expect(limited.contentType).toBe('application/problem+json');
    expect((limited.body as Record<string, unknown>).code).toBe('rate_limit.exceeded');
  });
});

// ---------------------------------------------------------------------------
// Success + not-found bodies pass through the migrated chain as plain application/json,
// pinning the migration's headline correction (the card response is JSON, NOT withRawBody/binary)
// on the 200 and 404 paths. handleCardUpload itself (unchanged, covered directly in
// tests/player_card_server.test.ts) is stubbed here so the assertion isolates the ROUTE: the
// [cardContentLengthGuard, activeGuard, rateLimit] chain admits an authed request, threads the
// guard account + the injected level lookup into the handler, and forwards its JSON body
// verbatim (never re-wrapped as RFC 9457 problem+json by withErrors).
// ---------------------------------------------------------------------------

describe('card success + not-found bodies pass through as JSON (migrated chain)', () => {
  it('200 application/json { url, ref } for an authed upload (JSON, not binary)', async () => {
    vi.mocked(handleCardUpload).mockClear();
    vi.mocked(handleCardUpload).mockImplementationOnce(async (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ url: '/p/abc', ref: 'abc' }));
    });
    const r = await runCard({ headers: { authorization: BEARER }, url: '/api/card?character=1' });
    expect(r.reached).toBe(true);
    expect(r.status).toBe(200);
    expect(r.contentType).toBe('application/json');
    expect(r.body).toEqual({ url: '/p/abc', ref: 'abc' });
    // The chain threaded the guard account (7) and the injected level lookup into the handler.
    expect(vi.mocked(handleCardUpload)).toHaveBeenCalledTimes(1);
    const [, , accountId, levelFn] = vi.mocked(handleCardUpload).mock.calls[0];
    expect(accountId).toBe(7);
    expect(typeof levelFn).toBe('function');
  });

  it('404 application/json { error: "character not found" } passes through unwrapped', async () => {
    vi.mocked(handleCardUpload).mockClear();
    vi.mocked(handleCardUpload).mockImplementationOnce(async (_req, res) => {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'character not found' }));
    });
    const r = await runCard({ headers: { authorization: BEARER }, url: '/api/card?character=1' });
    expect(r.reached).toBe(true);
    expect(r.status).toBe(404);
    expect(r.contentType).toBe('application/json');
    // The 404 is the handler's plain json(), NOT re-wrapped as problem+json by withErrors.
    expect(r.body).toEqual({ error: 'character not found' });
  });
});
