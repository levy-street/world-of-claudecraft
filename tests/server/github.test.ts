// Unit coverage for the GitHub route layer (server/github.ts).
//
// This slice pins the four GitHub-link endpoints that moved off the inline
// handleApi ladder in server/main.ts onto the shared server/http/ pipeline. It is
// a PARITY-FIRST migration: every migrated route reuses the SAME handleGitHub*
// function unchanged, so each response is the legacy { error } / { url } /
// { unlinked } / HTML-bounce body byte-for-byte (RFC 9457 is the client code-matcher). The auth
// gate is the shared legacy-body activeGuard (NOT problem+json requireAccount),
// the rate limit stays legacy prose { error: 'rate limited' }, and the callback
// stays HTML (never application/problem+json). The deeper handler branches (state
// exchange, link/unlink SQL, the failure metrics) are covered by
// tests/github_server.test.ts against the same shared handlers; this file pins the
// ROUTE-LAYER contract:
//  - the route table shape + wiring via apiRegistry.resolve;
//  - the shared activeGuard on start/status/unlink (401 db-free, read-only 403,
//    moderation 403);
//  - the two rate guards (start's 429 records github.link.rate_limited,
//    status/unlink's plain 429 does not), mounted BEHIND the auth guard;
//  - the happy-path thin-handler delegation (status payload, unlink { unlinked });
//  - the meta.envelope 'html' contract (an escaping throw serializes as HTML on
//    the callback, as problem+json on the JSON routes) and the unconfigured 503
//    HTML bounce.
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is
// unset; github.ts imports it, so set a dummy URL and mock pg (the pool never
// connects). The guard reads are fakes via setGithubDbForTests; the two happy
// paths drive the real handler against the mocked pg (an empty github_links read
// for status, the DELETE for unlink).
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_github_routes';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// pg mock (mirrors tests/github_server.test.ts): stub the Pool so pool.query is a
// spy the two happy-path handlers drive with no live DB. Hoisted above the
// server/github import so db.ts loads against the mock.
const dbMock = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5433/wocc_github_routes';
  const query = vi.fn();
  const client = { query, release: vi.fn() };
  return { query, connect: vi.fn(() => Promise.resolve(client)) };
});
vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    return { query: dbMock.query, connect: dbMock.connect };
  }),
}));

import type * as http from 'node:http';
import type { AccountModerationStatus } from '../../server/db';
import { resetGithubDbForTests, routes, setGithubDbForTests } from '../../server/github';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import { apiRegistry } from '../../server/http/registry';
import type { Method, Middleware, RouteHandler } from '../../server/http/types';
import { providerUsageSnapshot, resetProviderUsageForTests } from '../../server/provider_usage';
import {
  GITHUB_MAX_PER_MINUTE,
  githubRateLimited,
  resetGithubRateLimits,
  resetRateLimitClock,
  setRateLimitClock,
} from '../../server/ratelimit';
import { type FakeRes, fakeCtx, makeReq } from './helpers';

// A well-formed bearer header (64 lowercase-hex, matching the guard BEARER_PATTERN).
const BEARER = `Bearer ${'a'.repeat(64)}`;
// A frozen instant for the pinned limiter clock: every recorded attempt shares it,
// so the whole GITHUB_MAX_PER_MINUTE drain sits inside the one 60s window.
const FIXED_NOW_MS = 1_700_000_000_000;

// The GITHUB_OAUTH_* env keys githubConfig() reads. Deleted per-test so the
// feature resolves "not configured" by default, then restored in afterEach so
// this suite never leaks config into another test file's process.env.
const GITHUB_ENV_KEYS = ['GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET'] as const;
const SAVED_GITHUB_ENV = new Map<string, string | undefined>(
  GITHUB_ENV_KEYS.map((key) => [key, process.env[key]]),
);

type DbOverrides = Parameters<typeof setGithubDbForTests>[0];

// The three account-scoped routes, each gated by [activeGuard, rate guard].
const MUTATING_ROUTES: ReadonlyArray<readonly [Method, string]> = [
  ['POST', '/api/auth/github/start'],
  ['GET', '/api/github'],
  ['DELETE', '/api/github'],
];

// linkRow drives the mocked github_links read for the status happy path.
let linkRow: Array<Record<string, unknown>> = [];

// Route the mocked pg query by normalized SQL. Only the two happy-path reads (the
// github_links status SELECT and the unlink DELETE) are exercised here; every
// other statement returns an empty result.
function defaultRouter(sql: string) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (s.includes('DELETE FROM github_links WHERE account_id')) return { rows: [], rowCount: 0 };
  if (s.includes('FROM github_links WHERE account_id'))
    return { rows: linkRow, rowCount: linkRow.length };
  return { rows: [], rowCount: 0 };
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

/** A fake accountAndScopeForToken resolving to account 7 with the given scope. */
function scopeOf(scope: 'read' | 'full') {
  return async () => ({ accountId: 7, scope });
}

/** Seed the guard db (bearer + moderation) with a full, non-locked account. */
function authedDb(overrides: DbOverrides = {}): void {
  setGithubDbForTests({
    accountAndScopeForToken: scopeOf('full'),
    moderationStatusForAccount: async () => modStatus(),
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
  // The HTML bounce responses are not JSON; parse defensively so a text/html body
  // leaves `body` undefined (assert on `raw`) instead of throwing.
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

/**
 * Drive a full route chain (its real middleware + handler, or an override handler)
 * under withErrors. Mirrors the dispatcher (server/http/dispatch.ts): withErrors is
 * threaded the route's own envelope, so the callback's 'html' surface serializes an
 * escaping throw as HTML and every other (undefined) route defaults to problem+json.
 */
async function runRoute(
  method: Method,
  path: string,
  opts: {
    url?: string;
    body?: unknown;
    headers?: Record<string, string>;
    handler?: RouteHandler;
  } = {},
) {
  const route = routeFor(method, path);
  const handler = opts.handler ?? route.handler;
  let reached = false;
  const terminal: Middleware = async (c) => {
    reached = true;
    await handler(c);
  };
  const ctx = fakeCtx({ method, url: opts.url ?? path, headers: opts.headers, body: opts.body });
  const stack: Middleware[] = [
    withErrors({ surface: route.meta?.envelope }),
    ...(route.middleware ?? []),
    terminal,
  ];
  await compose(stack)(ctx);
  return { reached, ...readRes(ctx.res) };
}

/** Pre-drain the shared GitHub bucket for (ip 127.0.0.1, account 7) to its cap. */
function drainGithubBucket(): void {
  // recordSlidingWindowAttempt returns true only OVER the cap, so GITHUB_MAX_PER_MINUTE
  // recorded attempts leave the bucket exactly full: the next attempt (the route's own
  // githubRateLimited call) is the one that trips. makeReq()'s socket is 127.0.0.1, the
  // same IP fakeCtx assigns, and account 7 matches scopeOf('full').
  for (let i = 0; i < GITHUB_MAX_PER_MINUTE; i++) githubRateLimited(makeReq(), 7);
}

/** The github.link.rate_limited usage metric count in the 24h window. */
function rateLimitedMetricCount(): number {
  const metric = providerUsageSnapshot().metrics.find((m) => m.key === 'github.link.rate_limited');
  return metric ? metric.counts.h24 : -1;
}

beforeEach(() => {
  // Delete both GITHUB_OAUTH_* keys so githubConfig() resolves null by default; the
  // originals are restored in afterEach so this suite never leaks config.
  for (const key of GITHUB_ENV_KEYS) delete process.env[key];
  // Pin the clock so the bucket drain sits inside one 60s window, and start each test
  // from an empty bucket + real guard db + clean usage metrics.
  setRateLimitClock(() => FIXED_NOW_MS);
  resetGithubRateLimits();
  resetGithubDbForTests();
  resetProviderUsageForTests();
  linkRow = [];
  dbMock.query.mockReset();
  dbMock.query.mockImplementation((sql: string) => Promise.resolve(defaultRouter(sql)));
});

afterEach(() => {
  resetGithubRateLimits();
  resetRateLimitClock();
  resetGithubDbForTests();
  resetProviderUsageForTests();
  for (const key of GITHUB_ENV_KEYS) {
    const saved = SAVED_GITHUB_ENV.get(key);
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. The route table shape (the RouteDefs registry.ts spreads into apiRoutes).
// ---------------------------------------------------------------------------

describe('GitHub route table shape', () => {
  it('registers exactly the four GitHub-link routes, all on the api surface', () => {
    expect(routes).toHaveLength(4);
    const keys = routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(keys).toEqual(
      [
        'DELETE /api/github',
        'GET /api/auth/github/callback',
        'GET /api/github',
        'POST /api/auth/github/start',
      ].sort(),
    );
    for (const r of routes) expect(r.surface).toBe('api');
  });

  it('marks the callback meta.envelope html and mounts NO auth/rate middleware on it', () => {
    const callback = routeFor('GET', '/api/auth/github/callback');
    expect(callback.meta?.envelope).toBe('html');
    // A github.com redirect carries no bearer and no browser Origin, so the callback
    // is exempt from the guard; the OAuth state row is its only credential.
    expect(callback.middleware).toBeUndefined();
  });

  it('mounts two middleware (auth then rate guard) on start/status/unlink, no html envelope', () => {
    for (const [method, path] of MUTATING_ROUTES) {
      const route = routeFor(method, path);
      // Two middleware, auth BEFORE the limiter (the legacy arm order); the functional
      // proof that auth runs first is the drained-bucket 401 test below.
      expect(route.middleware).toHaveLength(2);
      expect(route.meta?.envelope).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Route wiring, via apiRegistry.resolve (the registry the dispatcher queries).
// ---------------------------------------------------------------------------

describe('GitHub route wiring (apiRegistry.resolve)', () => {
  const ALL_ROUTES: ReadonlyArray<readonly [Method, string]> = [
    ['POST', '/api/auth/github/start'],
    ['GET', '/api/auth/github/callback'],
    ['GET', '/api/github'],
    ['DELETE', '/api/github'],
  ];

  for (const [method, path] of ALL_ROUTES) {
    it(`resolves ${method} ${path} to a matched RouteDef`, () => {
      expect(apiRegistry.resolve(method, path).kind).toBe('matched');
    });
  }

  it('resolves a wrong method (PUT /api/github) to methodNotAllowed with GET + DELETE in the Allow set', () => {
    const result = apiRegistry.resolve('PUT', '/api/github');
    expect(result.kind).toBe('methodNotAllowed');
    if (result.kind === 'methodNotAllowed') {
      // The router advertises the two real methods registered for the path (GET +
      // DELETE) plus the synthesized HEAD (from GET) and OPTIONS.
      expect(result.allow).toContain('GET');
      expect(result.allow).toContain('DELETE');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The shared, legacy-body activeGuard on the mutating routes. Each rejection
// short-circuits before the handler (and, for all three, before the rate guard).
// ---------------------------------------------------------------------------

describe('activeGuard on the mutating GitHub routes', () => {
  for (const [method, path] of MUTATING_ROUTES) {
    it(`${method} ${path} 401s a missing bearer DB-free (guard runs before any db read)`, async () => {
      const accountAndScopeForToken = vi.fn(scopeOf('full'));
      const moderationStatusForAccount = vi.fn(async () => modStatus());
      setGithubDbForTests({ accountAndScopeForToken, moderationStatusForAccount });

      const r = await runRoute(method, path);
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
      expect(r.contentType).toBe('application/json');
      expect(r.reached).toBe(false);
      // A missing bearer 401s before any db call (the token === null branch).
      expect(accountAndScopeForToken).not.toHaveBeenCalled();
      expect(moderationStatusForAccount).not.toHaveBeenCalled();
    });
  }

  it('403s a read-only token { error: "this token is read-only" } on GET /api/github', async () => {
    authedDb({ accountAndScopeForToken: scopeOf('read') });
    const r = await runRoute('GET', '/api/github', { headers: { authorization: BEARER } });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'this token is read-only', code: 'auth.forbidden' });
    expect(r.reached).toBe(false);
  });

  it('403s a moderation-locked account with the status message on DELETE /api/github', async () => {
    authedDb({
      moderationStatusForAccount: async () =>
        modStatus({ locked: true, message: 'this account is suspended.' }),
    });
    const r = await runRoute('DELETE', '/api/github', { headers: { authorization: BEARER } });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'this account is suspended.', code: 'moderation.suspended' });
    expect(r.reached).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. The two rate guards, mounted AFTER activeGuard. start records the
// github.link.rate_limited usage metric on its 429; status/unlink do not. An
// unauthenticated request 401s (the guard) before the limiter is ever reached.
// ---------------------------------------------------------------------------

describe('GitHub rate guards (mounted behind the auth guard)', () => {
  beforeEach(() => {
    authedDb();
  });

  it('429s an authed start once the bucket is drained AND records the github.link.rate_limited metric', async () => {
    drainGithubBucket();
    const r = await runRoute('POST', '/api/auth/github/start', {
      headers: { authorization: BEARER },
      body: {},
    });
    expect(r.status).toBe(429);
    expect(r.body).toEqual({ error: 'rate limited' });
    expect(r.contentType).toBe('application/json');
    // The guard short-circuits before handleGitHubStart (which mints OAuth state).
    expect(r.reached).toBe(false);
    // start's guard alone records the usage metric on the 429 (the drain calls, plain
    // githubRateLimited invocations, do not record it).
    expect(rateLimitedMetricCount()).toBe(1);
  });

  for (const [method, path] of [
    ['GET', '/api/github'],
    ['DELETE', '/api/github'],
  ] as const) {
    it(`429s an authed ${method} ${path} once drained WITHOUT recording the metric`, async () => {
      drainGithubBucket();
      const r = await runRoute(method, path, { headers: { authorization: BEARER } });
      expect(r.status).toBe(429);
      expect(r.body).toEqual({ error: 'rate limited' });
      expect(r.contentType).toBe('application/json');
      expect(r.reached).toBe(false);
      // status/unlink carry the plain rate guard: no usage metric on the 429.
      expect(rateLimitedMetricCount()).toBe(0);
    });
  }

  it('keeps the limiter BEHIND the auth guard: an unauthenticated read 401s even with the bucket drained', async () => {
    // Drain the bucket, then issue a no-bearer read: activeGuard rejects first, so the
    // response is 401 (not 429). If the limiter ran before the guard it would 429 here.
    drainGithubBucket();
    const r = await runRoute('GET', '/api/github');
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
    expect(r.status).not.toBe(429);
    expect(r.reached).toBe(false);
  });

  it('trips on the IP key alone: an ip-only drain (account 0) 429s the next authed read', async () => {
    // Drain only the IP bucket (accountId 0 skips the account bucket), then issue an
    // authed read as account 7 from the same IP: the guard's githubRateLimited must
    // trip on the full IP bucket even though account 7's bucket is fresh.
    for (let i = 0; i < GITHUB_MAX_PER_MINUTE; i++) githubRateLimited(makeReq(), 0);
    const r = await runRoute('GET', '/api/github', { headers: { authorization: BEARER } });
    expect(r.status).toBe(429);
    expect(r.body).toEqual({ error: 'rate limited' });
    expect(r.reached).toBe(false);
  });

  it('trips on the ACCOUNT key alone: an account drain from another IP 429s a fresh-IP authed read', async () => {
    // Drain account 7's bucket from a foreign IP (via X-Forwarded-For; makeReq's
    // loopback socket is a trusted proxy, so requestIp resolves the forwarded hop),
    // then issue an authed read from the default 127.0.0.1: the guard must trip on the
    // full ACCOUNT bucket even though 127.0.0.1's IP bucket is fresh.
    for (let i = 0; i < GITHUB_MAX_PER_MINUTE; i++) {
      githubRateLimited(makeReq({ headers: { 'x-forwarded-for': '203.0.113.9' } }), 7);
    }
    const r = await runRoute('GET', '/api/github', { headers: { authorization: BEARER } });
    expect(r.status).toBe(429);
    expect(r.body).toEqual({ error: 'rate limited' });
    expect(r.reached).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Happy-path thin-handler delegation. The RouteDef reuses the SAME
// handleGitHubStatus/Unlink functions unchanged, so the bodies are byte-for-byte
// the legacy payloads. Driven against the mocked pg.
// ---------------------------------------------------------------------------

describe('happy-path thin-handler delegation', () => {
  it('GET /api/github answers 200 with the status payload for an unlinked account', async () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = 'client123';
    process.env.GITHUB_OAUTH_CLIENT_SECRET = 'secret456';
    authedDb();
    linkRow = []; // no github_links row -> unlinked, so no mergedPrs fetch is made
    const r = await runRoute('GET', '/api/github', { headers: { authorization: BEARER } });
    expect(r.reached).toBe(true);
    expect(r.status).toBe(200);
    expect(r.contentType).toBe('application/json');
    expect(r.body).toEqual({
      enabled: true,
      linked: false,
      login: null,
      profileUrl: null,
      mergedPrs: 0,
      devTier: 0,
    });
  });

  it('DELETE /api/github answers 200 { unlinked: true } and runs the unlink DELETE', async () => {
    authedDb();
    const r = await runRoute('DELETE', '/api/github', { headers: { authorization: BEARER } });
    expect(r.reached).toBe(true);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ unlinked: true });
    expect(
      dbMock.query.mock.calls.some((c) => String(c[0]).includes('DELETE FROM github_links')),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. The error-envelope contract (the githubBodyValidationRemap deviation). An
// UNEXPECTED throw escaping a handler serializes per the route's envelope: HTML on
// the callback (so window.opener.postMessage is never handed problem+json),
// problem+json on the JSON routes.
// ---------------------------------------------------------------------------

describe('error-envelope contract', () => {
  it('serializes an escaping throw on the callback as a 500 HTML error, never problem+json', async () => {
    // The most load-bearing half of the contract: because the callback RouteDef
    // carries meta.envelope 'html', withErrors routes an escaping throw through
    // serializeHtml. If the envelope were ever dropped this would become 500
    // problem+json and fail, so this pins the html surface on the error path.
    const r = await runRoute('GET', '/api/auth/github/callback', {
      handler: async () => {
        throw new Error('boom');
      },
    });
    expect(r.status).toBe(500);
    expect(r.contentType).toContain('text/html');
    expect(r.contentType).not.toContain('application/problem+json');
  });

  it('serializes an escaping throw on GET /api/github as a 500 problem+json with an X-Request-Id header', async () => {
    authedDb();
    const r = await runRoute('GET', '/api/github', {
      headers: { authorization: BEARER },
      handler: async () => {
        throw new Error('boom');
      },
    });
    expect(r.status).toBe(500);
    expect(r.contentType).toBe('application/problem+json');
    expect(bodyRecord(r.body).code).toBe('internal.error');
    expect(r.headers['x-request-id']).toBe('test-req-1');
  });
});

// ---------------------------------------------------------------------------
// 7. The unconfigured-feature callback (feature off). githubConfig() null makes
// handleGitHubCallback answer the 503 HTML bounce before any rate check or db read,
// and no bearer is required (the callback carries no auth guard).
// ---------------------------------------------------------------------------

describe('unconfigured feature (503, feature off)', () => {
  it('answers a 503 HTML bounce (not_configured) on the callback through the route chain, never a bearer 401', async () => {
    const r = await runRoute('GET', '/api/auth/github/callback', {
      url: '/api/auth/github/callback?code=abc&state=s',
    });
    expect(r.status).toBe(503);
    expect(r.contentType).toContain('text/html');
    expect(r.contentType).not.toContain('application/problem+json');
    expect(r.raw).toContain('not_configured');
    expect(r.status).not.toBe(401);
  });

  it('answers 503 { error: "GitHub integration is not configured" } on an authed start through the route chain', async () => {
    // githubConfig() resolves null (the suite unsets both GITHUB_OAUTH_* keys), so
    // handleGitHubStart answers its own handler-owned JSON 503 after the auth and
    // rate guards pass, before minting any OAuth state. Same body as the legacy arm.
    authedDb();
    const r = await runRoute('POST', '/api/auth/github/start', {
      headers: { authorization: BEARER },
      body: {},
    });
    expect(r.reached).toBe(true);
    expect(r.status).toBe(503);
    expect(r.contentType).toBe('application/json');
    expect(r.body).toEqual({ error: 'GitHub integration is not configured' });
  });
});
