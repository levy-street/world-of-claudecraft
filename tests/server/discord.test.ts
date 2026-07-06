// Unit coverage for the Discord route layer (server/discord.ts).
//
// This slice pins the seven Discord endpoints that moved off the inline handleApi
// ladder in server/main.ts onto the shared server/http/ pipeline. It is a
// PARITY-FIRST migration: every migrated handler reuses the SAME handleDiscord*
// function unchanged, so each response is the legacy { error } / { ok } / { url } /
// HTML-bounce body byte-for-byte (RFC 9457 is the client code-matcher). The rate limit
// stays legacy prose { error: 'rate limited' } (NOT coded problem+json), the auth is the shared
// legacy-body activeGuard (NOT problem+json requireAccount), and the callback stays
// HTML (never application/problem+json). It exercises:
//  - the route wiring, via apiRegistry.resolve: each (method, path) is matched, a
//    wrong method on /api/discord is methodNotAllowed with the Allow set, the
//    previously-orphaned swag claim is now reachable, and the callback RouteDef
//    carries meta.envelope 'html';
//  - the shared, legacy-body activeGuard on the mutating legs (GET/DELETE /api/discord,
//    POST /api/discord/swag/claim): db-free no-token 401, read-only 403, moderation 403;
//  - the discordActiveRateGuard on status/unlink: legacy-prose 429 once the bucket is
//    exhausted, mounted BEHIND the auth guard (an unauthenticated request 401s, never
//    the limiter);
//  - start's isIpBlocked gate (opaque 429, BOTH modes), its discordConfig-null 503,
//    the link-mode inline resolveActiveAccount (401 / read-only 403 / moderation 403,
//    resolved BEFORE the IP gate), the no-pre-check single count (the legacy
//    double-count is gone), and the 503-over-429 ordering the deviation documents;
//  - the chooser routes (login/new + login/link) through the migrated chain: the
//    blocked-IP and drained-bucket 429s, both db-free (deeper branches live in
//    tests/discord_server.test.ts against the same shared handlers);
//  - the discordRateLimited ip+account dual keying (each key trips alone);
//  - the callback HTML contract: an isIpBlocked bounce (server_error) and an
//    unconfigured bounce (not_configured), both text/html, never problem+json;
//  - the swag claim reachability (its in-handler self-limit fires before any DB);
//  - the useRuntime() null guard (a request that beats boot wiring 500s).
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is unset;
// discord.ts imports it, so set a dummy URL. The pool never connects: the guard reads
// are fakes supplied via setDiscordDbForTests, the game-session hooks are a fake
// injected via configureDiscordRuntime, and every asserted path returns BEFORE any
// handler DB read (start/callback answer from a null discordConfig or an opaque gate,
// status/unlink 429 or 401 before the handler, swag 429 in its own self-limit).
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_phase16_discord';

import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountModerationStatus } from '../../server/db';
import {
  configureDiscordRuntime,
  type DiscordGameHooks,
  resetDiscordDbForTests,
  resetDiscordRuntimeForTests,
  routes,
  setDiscordDbForTests,
} from '../../server/discord';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import { apiRegistry } from '../../server/http/registry';
import type { Method, Middleware } from '../../server/http/types';
import {
  DISCORD_MAX_PER_MINUTE,
  discordRateLimited,
  resetDiscordRateLimits,
  resetRateLimitClock,
  setRateLimitClock,
} from '../../server/ratelimit';
import { type FakeRes, fakeCtx, makeReq } from './helpers';

// A well-formed bearer header (64 lowercase-hex, matching the guard BEARER_PATTERN).
const BEARER = `Bearer ${'a'.repeat(64)}`;
// A frozen instant for the pinned limiter clock: every recorded attempt shares it, so
// the whole DISCORD_MAX_PER_MINUTE-attempt drain sits inside the one 60s window and
// the counter is deterministic across calls.
const FIXED_NOW_MS = 1_700_000_000_000;
// The DISCORD_* env keys discordConfig() reads. Deleted per-test so discordConfig()
// resolves null by default (the harness never sets them), then restored so this suite
// never leaks Discord config into another test file's process.env.
const DISCORD_ENV_KEYS = [
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_GUILD_ID',
  'DISCORD_GUILD_INVITE',
  'DISCORD_BOT_TOKEN',
] as const;
// The pristine DISCORD_* values, snapshotted once at import (before any beforeEach
// deletes them) so afterEach restores exactly what the harness started with.
const SAVED_DISCORD_ENV = new Map<string, string | undefined>(
  DISCORD_ENV_KEYS.map((key) => [key, process.env[key]]),
);

type DbOverrides = Parameters<typeof setDiscordDbForTests>[0];

// The three account-scoped mutating routes, each gated by the shared activeGuard.
const MUTATING_ROUTES: ReadonlyArray<readonly [Method, string]> = [
  ['GET', '/api/discord'],
  ['DELETE', '/api/discord'],
  ['POST', '/api/discord/swag/claim'],
];

// ---------------------------------------------------------------------------
// Local builders (redefined per-file, mirroring tests/server/reports.test.ts).
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

/** Seed the guard db (bearer + moderation) with a full, non-locked account. */
function authedDb(overrides: DbOverrides = {}): void {
  setDiscordDbForTests({
    accountAndScopeForToken: scopeOf('full'),
    moderationStatusForAccount: async () => modStatus(),
    ...overrides,
  });
}

/** Install a fake game-session runtime (default: IP never blocked, cosmetic no-op). */
function installRuntime(overrides: Partial<DiscordGameHooks> = {}): DiscordGameHooks {
  const rt: DiscordGameHooks = {
    isIpBlocked: () => false,
    grantCosmetic: () => {},
    ...overrides,
  };
  configureDiscordRuntime(rt);
  return rt;
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
  // Mirror the dispatcher (server/http/dispatch.ts): withErrors is threaded the
  // route's own envelope, so the callback's 'html' surface serializes an escaping
  // throw as HTML and every other (undefined) route defaults to problem+json.
  const ctx = fakeCtx({ method, url: opts.url ?? path, headers: opts.headers, body: opts.body });
  const stack: Middleware[] = [
    withErrors({ surface: route.meta?.envelope }),
    ...(route.middleware ?? []),
    terminal,
  ];
  await compose(stack)(ctx);
  return { reached, ...readRes(ctx.res) };
}

/** Pre-drain the shared Discord bucket for (ip 127.0.0.1, account 7) to its cap. */
function drainDiscordBucket(): void {
  // recordSlidingWindowAttempt returns true only OVER the cap, so DISCORD_MAX_PER_MINUTE
  // recorded attempts leave the bucket exactly full: the next attempt (the route's own
  // discordRateLimited call) is the one that trips. makeReq()'s socket is 127.0.0.1, the
  // same IP fakeCtx assigns, and account 7 matches scopeOf('full').
  for (let i = 0; i < DISCORD_MAX_PER_MINUTE; i++) {
    discordRateLimited(makeReq(), 7);
  }
}

beforeEach(() => {
  // Delete every DISCORD_* env key so discordConfig() resolves null by default; the
  // originals are restored in afterEach so this suite never leaks Discord config.
  for (const key of DISCORD_ENV_KEYS) delete process.env[key];
  // Pin the clock so the bucket drain sits inside one 60s window, and start each test
  // from an empty bucket + real guard db.
  setRateLimitClock(() => FIXED_NOW_MS);
  resetDiscordRateLimits();
  resetDiscordDbForTests();
});

afterEach(() => {
  resetDiscordRateLimits();
  resetRateLimitClock();
  resetDiscordDbForTests();
  resetDiscordRuntimeForTests();
  for (const key of DISCORD_ENV_KEYS) {
    const saved = SAVED_DISCORD_ENV.get(key);
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
  // Clear the factory vi.fn call history (restoreAllMocks only resets vi.spyOn), so a
  // db call recorded by one test never bleeds into the next test's assertion.
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Route wiring, via apiRegistry.resolve (the registry the dispatcher queries).
// ---------------------------------------------------------------------------

describe('Discord route wiring (apiRegistry.resolve)', () => {
  const ALL_ROUTES: ReadonlyArray<readonly [Method, string]> = [
    ['POST', '/api/auth/discord/start'],
    ['GET', '/api/auth/discord/callback'],
    ['POST', '/api/auth/discord/login/new'],
    ['POST', '/api/auth/discord/login/link'],
    ['GET', '/api/discord'],
    ['DELETE', '/api/discord'],
    ['POST', '/api/discord/swag/claim'],
  ];

  for (const [method, path] of ALL_ROUTES) {
    it(`resolves ${method} ${path} to a matched RouteDef`, () => {
      expect(apiRegistry.resolve(method, path).kind).toBe('matched');
    });
  }

  it('resolves a wrong method (PUT /api/discord) to methodNotAllowed with GET + DELETE in the Allow set', () => {
    const result = apiRegistry.resolve('PUT', '/api/discord');
    expect(result.kind).toBe('methodNotAllowed');
    if (result.kind === 'methodNotAllowed') {
      // The router advertises the two real methods registered for the path (GET +
      // DELETE) plus the synthesized HEAD (from GET) and OPTIONS.
      expect(result.allow).toContain('GET');
      expect(result.allow).toContain('DELETE');
    }
  });

  it('resolves POST /api/discord/swag/claim to matched (the orphaned handler is now reachable)', () => {
    // The swag claim had no dispatch arm before the Discord-family migration (an
    // unreachable orphan); a matched resolve proves it is now served by the router.
    expect(apiRegistry.resolve('POST', '/api/discord/swag/claim').kind).toBe('matched');
  });

  it('marks the callback RouteDef meta.envelope html (errors serialize as HTML, never problem+json)', () => {
    // The contract the migration requires: an unexpected throw escaping the callback
    // is serialized as an HTML error (dispatch.ts threads meta.envelope into withErrors),
    // never application/problem+json, which would break window.opener.postMessage.
    expect(routeFor('GET', '/api/auth/discord/callback').meta?.envelope).toBe('html');
  });
});

// ---------------------------------------------------------------------------
// 2. The shared, legacy-body activeGuard on the mutating routes. Each rejection
// short-circuits before the handler (and, for status/unlink, before the limiter).
// ---------------------------------------------------------------------------

describe('activeGuard on the mutating Discord routes', () => {
  for (const [method, path] of MUTATING_ROUTES) {
    it(`${method} ${path} 401s a missing bearer DB-free (guard runs before any db read)`, async () => {
      const accountAndScopeForToken = vi.fn(scopeOf('full'));
      const moderationStatusForAccount = vi.fn(async () => modStatus());
      setDiscordDbForTests({ accountAndScopeForToken, moderationStatusForAccount });

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

  it('403s a read-only token { error: "this token is read-only" } on GET /api/discord', async () => {
    authedDb({ accountAndScopeForToken: scopeOf('read') });
    const r = await runRoute('GET', '/api/discord', { headers: { authorization: BEARER } });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'this token is read-only', code: 'auth.forbidden' });
    expect(r.reached).toBe(false);
  });

  it('403s a moderation-locked account with the status message on DELETE /api/discord', async () => {
    authedDb({
      moderationStatusForAccount: async () =>
        modStatus({ locked: true, message: 'this account is suspended.' }),
    });
    const r = await runRoute('DELETE', '/api/discord', { headers: { authorization: BEARER } });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'this account is suspended.', code: 'moderation.suspended' });
    expect(r.reached).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. The discordActiveRateGuard on status + unlink. It carries the legacy prose 429
// { error: 'rate limited' } (NOT coded problem+json) and is mounted AFTER activeGuard,
// so it counts every authed attempt and an unauthenticated request never reaches it.
// The handler (which would hit the real pool) is never entered on the 429/401 paths.
// ---------------------------------------------------------------------------

describe('discordActiveRateGuard on status + unlink', () => {
  beforeEach(() => {
    authedDb();
  });

  it('429s an authed status read once the bucket is exhausted (legacy prose, not problem+json)', async () => {
    drainDiscordBucket();
    const r = await runRoute('GET', '/api/discord', { headers: { authorization: BEARER } });
    expect(r.status).toBe(429);
    expect(r.body).toEqual({ error: 'rate limited' });
    expect(r.contentType).toBe('application/json');
    expect(r.contentType).not.toBe('application/problem+json');
    // The guard short-circuits before handleDiscordStatus (which reads the real pool).
    expect(r.reached).toBe(false);
  });

  it('429s an authed unlink once the bucket is exhausted', async () => {
    drainDiscordBucket();
    const r = await runRoute('DELETE', '/api/discord', { headers: { authorization: BEARER } });
    expect(r.status).toBe(429);
    expect(r.body).toEqual({ error: 'rate limited' });
    expect(r.reached).toBe(false);
  });

  it('keeps the limiter BEHIND the auth guard: an unauthenticated read 401s even with the bucket drained', async () => {
    // Drain the bucket, then issue a no-bearer read: activeGuard rejects first, so the
    // response is 401 (not 429). If the limiter ran before the guard it would 429 here.
    drainDiscordBucket();
    const r = await runRoute('GET', '/api/discord');
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
    expect(r.status).not.toBe(429);
    expect(r.reached).toBe(false);
  });

  it('trips on the IP key alone: an ip-only drain (account 0) 429s the next authed read', async () => {
    // Drain only the IP bucket (accountId 0 skips the account bucket), then issue an
    // authed read as account 7 from the same IP: the guard's discordRateLimited must
    // trip on the full IP bucket even though account 7's bucket is fresh. A keying
    // regression that dropped the IP key would answer 200 here (well, reach the
    // handler); the drained-bucket tests above cannot see it because they fill BOTH keys.
    for (let i = 0; i < DISCORD_MAX_PER_MINUTE; i++) discordRateLimited(makeReq(), 0);
    const r = await runRoute('GET', '/api/discord', { headers: { authorization: BEARER } });
    expect(r.status).toBe(429);
    expect(r.body).toEqual({ error: 'rate limited' });
    expect(r.reached).toBe(false);
  });

  it('trips on the ACCOUNT key alone: an account drain from another IP 429s a fresh-IP authed read', async () => {
    // Drain account 7's bucket from a foreign IP (via X-Forwarded-For; makeReq's
    // loopback socket is a trusted proxy, so requestIp resolves the forwarded hop),
    // then issue an authed read from the default 127.0.0.1: the guard must trip on the
    // full ACCOUNT bucket even though 127.0.0.1's IP bucket is fresh. A keying
    // regression that dropped the account key (letting one account rotate IPs past the
    // limiter) would reach the handler here.
    for (let i = 0; i < DISCORD_MAX_PER_MINUTE; i++) {
      discordRateLimited(makeReq({ headers: { 'x-forwarded-for': '203.0.113.9' } }), 7);
    }
    const r = await runRoute('GET', '/api/discord', { headers: { authorization: BEARER } });
    expect(r.status).toBe(429);
    expect(r.body).toEqual({ error: 'rate limited' });
    expect(r.reached).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. POST /api/auth/discord/start (no route middleware; the handler resolves the
// account inline only in link mode, then checks isIpBlocked, then handleDiscordStart).
// ---------------------------------------------------------------------------

describe('POST /api/auth/discord/start', () => {
  it('429s a login-mode start when the IP is blocked (opaque rate limited), never touching the db', async () => {
    installRuntime({ isIpBlocked: () => true, grantCosmetic: vi.fn() });
    const r = await runRoute('POST', '/api/auth/discord/start', { body: {} });
    expect(r.status).toBe(429);
    expect(r.body).toEqual({ error: 'rate limited' });
    expect(r.contentType).toBe('application/json');
    // The opaque 429 is written before handleDiscordStart (which mints OAuth state in
    // the db), so the block stays db-free and invisible.
  });

  it('503s a login-mode start when Discord is unconfigured (discordConfig null, db-free)', async () => {
    installRuntime({ isIpBlocked: () => false });
    // beforeEach deleted DISCORD_CLIENT_ID/SECRET, so discordConfig() is null and
    // handleDiscordStart answers 503 before createDiscordOAuthState.
    const r = await runRoute('POST', '/api/auth/discord/start', { body: {} });
    expect(r.status).toBe(503);
    expect(r.body).toEqual({
      error: 'Discord integration is not configured',
      code: 'discord.not_configured',
    });
    expect(r.contentType).toBe('application/json');
  });

  it('401s a link-mode start with no bearer, from the inline resolveActiveAccount', async () => {
    installRuntime();
    // ?mode=link makes discordStartHandler resolve the caller first; with no bearer the
    // inline resolveActiveAccount writes the legacy 401 and returns before isIpBlocked.
    const r = await runRoute('POST', '/api/auth/discord/start', {
      url: '/api/auth/discord/start?mode=link',
      body: {},
    });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
    expect(r.contentType).toBe('application/json');
  });

  it('403s a link-mode start with a read-only token (the inline resolver mirrors the guard)', async () => {
    installRuntime();
    authedDb({ accountAndScopeForToken: scopeOf('read') });
    const r = await runRoute('POST', '/api/auth/discord/start', {
      url: '/api/auth/discord/start?mode=link',
      headers: { authorization: BEARER },
      body: {},
    });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'this token is read-only', code: 'auth.forbidden' });
  });

  it('403s a link-mode start for a moderation-locked account with the status message', async () => {
    installRuntime();
    authedDb({
      moderationStatusForAccount: async () =>
        modStatus({ locked: true, message: 'this account is suspended.' }),
    });
    const r = await runRoute('POST', '/api/auth/discord/start', {
      url: '/api/auth/discord/start?mode=link',
      headers: { authorization: BEARER },
      body: {},
    });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'this account is suspended.', code: 'moderation.suspended' });
  });

  it('resolves the link-mode bearer BEFORE the IP gate: no bearer + blocked IP is 401, never 429', async () => {
    // The link-mode ordering contract: resolveActiveAccount runs first, so a blocked
    // IP learns nothing new from an unauthenticated link start (same 401 as anyone).
    installRuntime({ isIpBlocked: () => true });
    const r = await runRoute('POST', '/api/auth/discord/start', {
      url: '/api/auth/discord/start?mode=link',
      body: {},
    });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
  });

  it('429s an authed link-mode start when the IP is blocked (the gate covers BOTH modes)', async () => {
    installRuntime({ isIpBlocked: () => true });
    authedDb();
    const r = await runRoute('POST', '/api/auth/discord/start', {
      url: '/api/auth/discord/start?mode=link',
      headers: { authorization: BEARER },
      body: {},
    });
    expect(r.status).toBe(429);
    expect(r.body).toEqual({ error: 'rate limited' });
  });

  it('records NO limiter attempt on the new path before the handler (the legacy pre-check double-count is gone)', async () => {
    // The legacy handleApi arm pre-checks discordRateLimited AND handleDiscordStart
    // self-checks (a double count per request). The RouteDef deliberately does not
    // pre-check, so an unconfigured start (503 BEFORE the handler's own self-check)
    // records nothing: after 20 such requests the bucket must still be empty. On the
    // legacy arm these 20 pre-checks would have tripped the 15-cap long before this.
    installRuntime();
    for (let i = 0; i < 20; i++) {
      const r = await runRoute('POST', '/api/auth/discord/start', { body: {} });
      expect(r.status).toBe(503);
    }
    // A fresh check records attempt #1 of DISCORD_MAX_PER_MINUTE: allowed proves empty.
    expect(discordRateLimited(makeReq(), 7).allowed).toBe(true);
  });

  it('answers 503 (config) over 429 (drained bucket) on the new path: the rate check is deferred into the handler', async () => {
    // The documented newLimiterDiscord side effect, pinned: unconfigured AND drained,
    // the new path answers the handler's config-null 503 where the legacy pre-check
    // would answer 429 first. Applies to both modes (the deviation ledger notes it).
    installRuntime();
    drainDiscordBucket();
    const r = await runRoute('POST', '/api/auth/discord/start', { body: {} });
    expect(r.status).toBe(503);
    expect(r.body).toEqual({
      error: 'Discord integration is not configured',
      code: 'discord.not_configured',
    });
    expect(r.status).not.toBe(429);
  });
});

// ---------------------------------------------------------------------------
// 4b. The chooser routes (POST login/new + login/link) through the migrated chain.
// Both handlers self-limit then check the injected isIpBlocked BEFORE reading the
// body, so both branches are deterministic and db-free; they pin the RouteDef glue
// (the useRuntime().isIpBlocked hand-off) that the resolve-matched wiring loop alone
// cannot see. The deeper token/password branches live in tests/discord_server.test.ts
// against the same shared handlers (mocked pg).
// ---------------------------------------------------------------------------

describe('POST /api/auth/discord/login/new + login/link (migrated chain)', () => {
  const CHOOSER_ROUTES = ['/api/auth/discord/login/new', '/api/auth/discord/login/link'] as const;

  for (const path of CHOOSER_ROUTES) {
    it(`429s ${path} when the IP is blocked (the RouteDef threads the runtime hook), db-free`, async () => {
      installRuntime({ isIpBlocked: () => true });
      const r = await runRoute('POST', path, { body: {} });
      expect(r.status).toBe(429);
      expect(r.body).toEqual({ error: 'rate limited' });
      expect(r.contentType).toBe('application/json');
    });

    it(`429s ${path} once the shared discord bucket is drained (self-limit before the body read)`, async () => {
      installRuntime();
      drainDiscordBucket();
      const r = await runRoute('POST', path, { body: {} });
      expect(r.status).toBe(429);
      expect(r.body).toEqual({ error: 'rate limited' });
    });
  }
});

// ---------------------------------------------------------------------------
// 5. GET /api/auth/discord/callback (meta.envelope html). Its responses are the
// self-written HTML bouncePage, never application/problem+json.
// ---------------------------------------------------------------------------

describe('GET /api/auth/discord/callback (HTML contract)', () => {
  it('403s an HTML bounce (server_error) when the IP is blocked, never problem+json', async () => {
    installRuntime({ isIpBlocked: () => true });
    const r = await runRoute('GET', '/api/auth/discord/callback');
    expect(r.status).toBe(403);
    expect(r.contentType).toContain('text/html');
    expect(r.contentType).not.toContain('application/problem+json');
    expect(r.raw).toContain('server_error');
  });

  it('503s an HTML bounce (not_configured) when Discord is unconfigured, never problem+json', async () => {
    installRuntime({ isIpBlocked: () => false });
    // discordConfig() null -> handleDiscordCallback answers the HTML bouncePage 503
    // { ok: false, mode: 'login', error: 'not_configured' }, still text/html.
    const r = await runRoute('GET', '/api/auth/discord/callback');
    expect(r.status).toBe(503);
    expect(r.contentType).toContain('text/html');
    expect(r.contentType).not.toContain('application/problem+json');
    expect(r.raw).toContain('not_configured');
  });

  it('serializes an ESCAPING throw as a 500 HTML error, never problem+json (the envelope contract on the error path)', async () => {
    // The most load-bearing half of the contract: an UNEXPECTED throw escaping the
    // callback handler (a Postgres error outside handleDiscordCallback's own try/catch,
    // stood in for here by isIpBlocked throwing) must still serialize as HTML, not
    // application/problem+json (which would break window.opener.postMessage). Because the
    // real RouteDef carries meta.envelope 'html', withErrors routes the throw through
    // serializeHtml. If the envelope were ever dropped this would become 500 problem+json
    // and fail, so this pins the html surface end-to-end on the error path.
    installRuntime({
      isIpBlocked: () => {
        throw new Error('boom');
      },
    });
    const r = await runRoute('GET', '/api/auth/discord/callback');
    expect(r.status).toBe(500);
    expect(r.contentType).toContain('text/html');
    expect(r.contentType).not.toContain('application/problem+json');
  });
});

// ---------------------------------------------------------------------------
// 6. POST /api/discord/swag/claim ([activeGuard] only; handleSwagClaim self-limits).
// Reachability is proven by the resolve-matched (1) + the no-auth 401 (2); this
// drives the FULL chain to its in-handler self-limit, which fires before any db read.
// ---------------------------------------------------------------------------

describe('POST /api/discord/swag/claim reachability', () => {
  it('runs handleSwagClaim past the guard, hitting its in-handler self-limit (429) before the db', async () => {
    authedDb();
    installRuntime();
    drainDiscordBucket();
    const r = await runRoute('POST', '/api/discord/swag/claim', {
      headers: { authorization: BEARER },
      body: { swagId: 'anything' },
    });
    // reached === true proves activeGuard passed and the handler ran; handleSwagClaim's
    // own discordRateLimited check trips (the bucket is drained) and writes the legacy
    // 429 before discordForAccount (the first pool read), so the whole chain is db-free.
    expect(r.reached).toBe(true);
    expect(r.status).toBe(429);
    expect(r.body).toEqual({ error: 'rate limited' });
    expect(r.contentType).toBe('application/json');
  });
});

// ---------------------------------------------------------------------------
// 7. The useRuntime() null guard: a request that beats boot wiring throws, surfacing
// through withErrors as a 500 (problem+json internal.error for the un-enveloped start).
// ---------------------------------------------------------------------------

describe('runtime not configured', () => {
  it('500s a login-mode start when the runtime is not configured (useRuntime throws)', async () => {
    resetDiscordRuntimeForTests();
    // login-mode start reaches useRuntime().isIpBlocked with no runtime installed, so
    // useRuntime() throws; withErrors maps the generic error to a 500 problem+json.
    const r = await runRoute('POST', '/api/auth/discord/start', { body: {} });
    expect(r.status).toBe(500);
    expect(r.contentType).toBe('application/problem+json');
    expect(bodyRecord(r.body).code).toBe('internal.error');
  });
});
