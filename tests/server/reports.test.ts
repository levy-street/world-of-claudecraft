// Unit coverage for the reports + telemetry route layer (server/reports.ts).
//
// This slice pins the two account-gated WRITE routes (POST /api/reports, POST
// /api/bug-reports) that moved off the inline handleApi ladder onto the shared
// server/http/ pipeline. The migrated handlers preserve their LEGACY { error } /
// { ok } bodies byte-for-byte (RFC 9457 is the client code-matcher), so every handler-owned
// assertion pins the exact legacy status + body; only the middleware-thrown 429
// limiter and the framework-error 500 (readBody reject / non-rate-limit throw) go
// through the withErrors boundary as application/problem+json. It exercises:
//  - the shared, legacy-body activeGuard (mirrors bearerActiveAccount: db-free
//    no-token 401, read-only 403, moderation 403), driven through the /api/reports
//    chain, plus the no-auth golden replayed byte-for-byte;
//  - the reports validation ladder (reason, reporter ownership, target resolution,
//    createPlayerReport throw handling) reproduced unchanged off the ported handler;
//  - the NEW reports.create limiter (rateLimit(REPORTS_CREATE_POLICY), the
//    newLimiterReportsCreate deviation) mounted AFTER the guard, so it counts every
//    authed attempt and the (max + 1)th throws a coded problem+json 429;
//  - the composition order (guard before limiter: an unauthenticated request 401s,
//    never the limiter's 500-without-account);
//  - the reportsBodyValidationRemap deviation (self-read readBody reject -> 500
//    application/problem+json internal.error, not the legacy 500 { error });
//  - the bug-report handler's own body-cap / bad-json / rate-limit ladder (413 / 400
//    / 429 plain json) plus its rethrow to the withErrors 500, and the
//    character-ownership gate (an unowned characterId resolves to no name).
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is unset;
// reports.ts imports it, so set a dummy URL. The pool never connects: the guard reads
// are fakes supplied via setReportsDbForTests, the runtime is a fake injected via
// configureReportsRuntime, and every db read the handlers self-drive (getCharacter,
// findCharacterReportTargetByName, createPlayerReport, createBugReport) is mocked.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_phase15_reports';

import { readFileSync } from 'node:fs';
import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BugReportRateLimitError, createBugReport } from '../../server/bug_report_db';
import {
  type AccountModerationStatus,
  findCharacterReportTargetByName,
  getCharacter,
} from '../../server/db';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Method, Middleware } from '../../server/http/types';
import { createPlayerReport } from '../../server/moderation_db';
import {
  REPORTS_CREATE_MAX_PER_MINUTE,
  resetRateLimitClock,
  resetReportsCreateRateLimits,
  setRateLimitClock,
} from '../../server/ratelimit';
import {
  configureReportsRuntime,
  type ReportsGameHooks,
  resetReportsDbForTests,
  resetReportsRuntimeForTests,
  routes,
  setReportsDbForTests,
} from '../../server/reports';
import { type FakeRes, fakeCtx, stableStringify } from './helpers';

// The report + bug handlers self-drive getCharacter / findCharacterReportTargetByName
// off db.ts directly (not through the reports.ts guard seam), so mock those two exports
// to drive the authed paths db-free. The ...actual spread keeps every other db export
// real; the guard's bearer/moderation reads come through the setReportsDbForTests seam,
// so they are unaffected by this mock.
vi.mock('../../server/db', async (importActual) => {
  const actual = await importActual<typeof import('../../server/db')>();
  return {
    ...actual,
    getCharacter: vi.fn(),
    findCharacterReportTargetByName: vi.fn(),
  };
});

// createPlayerReport is mocked (the throw branches drive the handler's catch); the pure
// cleanReportReason validator stays REAL via the ...actual spread so the reason ladder
// runs unchanged.
vi.mock('../../server/moderation_db', async (importActual) => {
  const actual = await importActual<typeof import('../../server/moderation_db')>();
  return { ...actual, createPlayerReport: vi.fn() };
});

// createBugReport is mocked (its rate-limit / rethrow branches drive the handler's
// catch); BugReportRateLimitError + BUG_DESCRIPTION_MAX stay REAL via the ...actual
// spread, so the handler's `instanceof BugReportRateLimitError` check keys on the same
// class the test throws.
vi.mock('../../server/bug_report_db', async (importActual) => {
  const actual = await importActual<typeof import('../../server/bug_report_db')>();
  return { ...actual, createBugReport: vi.fn() };
});

// A well-formed bearer header (64 lowercase-hex, matching the guard BEARER_PATTERN).
const BEARER = `Bearer ${'a'.repeat(64)}`;
// A frozen instant for the pinned limiter clock: every recorded token shares it, so all
// attempts sit inside the one 60s window and the counter is deterministic across calls.
const FIXED_NOW_MS = 1_700_000_000_000;

type DbOverrides = Parameters<typeof setReportsDbForTests>[0];

// ---------------------------------------------------------------------------
// Local builders (redefined per-file, mirroring tests/server/wallet.test.ts).
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

/** A getCharacter row stand-in (the handlers read only id + name off it). */
function charRow(id: number, name: string): Awaited<ReturnType<typeof getCharacter>> {
  return { id, name } as unknown as Awaited<ReturnType<typeof getCharacter>>;
}

/** Install a fake reports runtime (default: no live report target for any pid). */
function installRuntime(overrides: Partial<ReportsGameHooks> = {}): ReportsGameHooks {
  const rt: ReportsGameHooks = {
    reportTargetForPid: () => null,
    ...overrides,
  };
  configureReportsRuntime(rt);
  return rt;
}

/** Seed the guard db (bearer + moderation) with a full, non-locked account. */
function authedDb(overrides: DbOverrides = {}): void {
  setReportsDbForTests({
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
  return {
    status: fake.statusCode,
    body: fake.body ? JSON.parse(fake.body) : undefined,
    raw: fake.body,
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
  opts: { body?: unknown; headers?: Record<string, string> } = {},
) {
  const route = routeFor(method, path);
  let reached = false;
  const terminal: Middleware = async (c) => {
    reached = true;
    await route.handler(c);
  };
  const ctx = fakeCtx({ method, url: path, headers: opts.headers, body: opts.body });
  const stack: Middleware[] = [
    withErrors({ surface: 'problem+json' }),
    ...(route.middleware ?? []),
    terminal,
  ];
  await compose(stack)(ctx);
  return { reached, ...readRes(ctx.res) };
}

/** Load a characterization golden (status + raw body string) by its main-surface name. */
function fixture(name: string): { status: number; body: string } {
  const url = new URL(`./fixtures/main/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8'));
}

beforeEach(() => {
  installRuntime();
});

afterEach(() => {
  resetReportsDbForTests();
  resetReportsRuntimeForTests();
  resetReportsCreateRateLimits();
  resetRateLimitClock();
  vi.restoreAllMocks();
  // Clear the factory vi.fn call history (restoreAllMocks only resets vi.spyOn), so a
  // db call recorded by one test never bleeds into the next test's assertion.
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// activeGuard, driven through the full POST /api/reports chain (guard rejects
// short-circuit before the limiter and the handler).
// ---------------------------------------------------------------------------

describe('POST /api/reports activeGuard', () => {
  it('401s a missing bearer byte-for-byte to the golden, with NO db read', async () => {
    const accountAndScopeForToken = vi.fn(scopeOf('full'));
    const moderationStatusForAccount = vi.fn(async () => modStatus());
    setReportsDbForTests({ accountAndScopeForToken, moderationStatusForAccount });

    const r = await runRoute('POST', '/api/reports', { body: {} });
    const fx = fixture('reports_post_noauth_401');
    expect(r.status).toBe(fx.status);
    // The golden body canonicalizes key order (code before error); the raw emit is
    // insertion order, so canonicalize the raw the same way before the byte-compare.
    expect(stableStringify(JSON.parse(r.raw))).toBe(fx.body);
    expect(r.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
    expect(r.contentType).toBe('application/json');
    expect(r.reached).toBe(false);
    // A missing bearer 401s before any db call (the no-auth golden replays DB-free).
    expect(accountAndScopeForToken).not.toHaveBeenCalled();
    expect(moderationStatusForAccount).not.toHaveBeenCalled();
  });

  it('401s a malformed bearer (not 64-hex) DB-free, same as a missing header', async () => {
    // A present-but-malformed Authorization header fails BEARER_PATTERN, so bearerToken
    // returns null and the guard 401s WITHOUT a db lookup (the token === null branch),
    // exactly like the no-header case.
    const accountAndScopeForToken = vi.fn(scopeOf('full'));
    setReportsDbForTests({
      accountAndScopeForToken,
      moderationStatusForAccount: async () => modStatus(),
    });
    const r = await runRoute('POST', '/api/reports', {
      headers: { authorization: 'Bearer xyz' },
      body: {},
    });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
    expect(r.reached).toBe(false);
    expect(accountAndScopeForToken).not.toHaveBeenCalled();
  });

  it('403s a read-only token { error: "this token is read-only" }', async () => {
    authedDb({ accountAndScopeForToken: scopeOf('read') });
    const r = await runRoute('POST', '/api/reports', {
      headers: { authorization: BEARER },
      body: {},
    });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'this token is read-only', code: 'auth.forbidden' });
    expect(r.reached).toBe(false);
  });

  it('403s a moderation-locked account with the status message', async () => {
    authedDb({
      moderationStatusForAccount: async () =>
        modStatus({ locked: true, message: 'this account is suspended.' }),
    });
    const r = await runRoute('POST', '/api/reports', {
      headers: { authorization: BEARER },
      body: {},
    });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'this account is suspended.', code: 'moderation.suspended' });
    expect(r.reached).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The reports validation ladder, reproduced unchanged off the ported handler.
// Every request is a full-scope authed POST; the ladder rejects before / around
// the mocked getCharacter, resolveReportTarget, and createPlayerReport.
// ---------------------------------------------------------------------------

describe('POST /api/reports validation ladder', () => {
  const authedPost = (body: unknown) =>
    runRoute('POST', '/api/reports', { headers: { authorization: BEARER }, body });

  beforeEach(() => {
    authedDb();
  });

  it('400s a missing reason { error: "choose a report reason" }', async () => {
    const r = await authedPost({});
    expect(r.reached).toBe(true);
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'choose a report reason' });
  });

  it('400s a present-but-invalid reason (allowlist miss) { error: "choose a report reason" }', async () => {
    // cleanReportReason is an allowlist membership check (REPORT_REASONS.includes), not a
    // trimmer: a present string that is not an allowed reason (here whitespace) returns
    // null just like a missing reason, so the route rejects it identically. This exercises
    // the includes() === false branch that the missing-reason ({}) case above does not reach.
    const r = await authedPost({ reason: '   ' });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'choose a report reason' });
  });

  it('400s a non-finite reporterCharacterId { error: "invalid report target" }', async () => {
    const r = await authedPost({ reason: 'spam' });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'invalid report target' });
  });

  it('404s an unowned reporter { error: "reporting character not found" }', async () => {
    vi.mocked(getCharacter).mockResolvedValue(null);
    const r = await authedPost({ reason: 'spam', reporterCharacterId: 5 });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: 'reporting character not found' });
  });

  it('404s an offline targetPid { error: "that player is no longer online" }', async () => {
    vi.mocked(getCharacter).mockResolvedValue(charRow(5, 'Rep'));
    installRuntime({ reportTargetForPid: () => null });
    const r = await authedPost({ reason: 'spam', reporterCharacterId: 5, targetPid: 99 });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: 'that player is no longer online' });
  });

  it('404s a missing target name { error: "that player could not be found" }', async () => {
    vi.mocked(getCharacter).mockResolvedValue(charRow(5, 'Rep'));
    vi.mocked(findCharacterReportTargetByName).mockResolvedValue(null);
    const r = await authedPost({
      reason: 'spam',
      reporterCharacterId: 5,
      targetCharacterName: 'Ghost',
    });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: 'that player could not be found' });
  });

  it('400s no target at all { error: "invalid report target" }', async () => {
    vi.mocked(getCharacter).mockResolvedValue(charRow(5, 'Rep'));
    const r = await authedPost({ reason: 'spam', reporterCharacterId: 5 });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'invalid report target' });
  });

  it('400s a createPlayerReport Error throw with its message (cannot report yourself)', async () => {
    vi.mocked(getCharacter).mockResolvedValue(charRow(5, 'Rep'));
    installRuntime({
      reportTargetForPid: () => ({ accountId: 9, characterId: 3, characterName: 'Foe' }),
    });
    vi.mocked(createPlayerReport).mockImplementation(() => {
      throw new Error('cannot report yourself');
    });
    const r = await authedPost({ reason: 'spam', reporterCharacterId: 5, targetPid: 7 });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'cannot report yourself' });
  });

  it('400s a non-Error throw with the fallback { error: "could not submit report" }', async () => {
    vi.mocked(getCharacter).mockResolvedValue(charRow(5, 'Rep'));
    installRuntime({
      reportTargetForPid: () => ({ accountId: 9, characterId: 3, characterName: 'Foe' }),
    });
    vi.mocked(createPlayerReport).mockImplementation(() => {
      throw 'boom';
    });
    const r = await authedPost({ reason: 'spam', reporterCharacterId: 5, targetPid: 7 });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'could not submit report' });
  });

  it('200s a resolved report { ok: true, reportId }', async () => {
    vi.mocked(getCharacter).mockResolvedValue(charRow(5, 'Rep'));
    installRuntime({
      reportTargetForPid: () => ({ accountId: 9, characterId: 3, characterName: 'Foe' }),
    });
    vi.mocked(createPlayerReport).mockResolvedValue({ id: 42 });
    const r = await authedPost({ reason: 'spam', reporterCharacterId: 5, targetPid: 7 });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, reportId: 42 });
  });
});

// ---------------------------------------------------------------------------
// The NEW reports.create limiter (newLimiterReportsCreate deviation). It mounts
// AFTER activeGuard (the fused ip+account limiter reads ctx.account), so it counts
// every authed attempt: the first REPORTS_CREATE_MAX_PER_MINUTE pass the limiter and
// 400 at the handler (missing reason), and the (max + 1)th throws a coded 429.
// ---------------------------------------------------------------------------

describe('POST /api/reports rate limiter (coded 429)', () => {
  beforeEach(() => {
    // Pin the clock so every recorded token shares one window; reset the bucket so the
    // count starts at zero regardless of test order.
    setRateLimitClock(() => FIXED_NOW_MS);
    resetReportsCreateRateLimits();
    authedDb();
  });

  it('limits the (max + 1)th authed attempt with problem+json + Retry-After', async () => {
    const opts = { headers: { authorization: BEARER }, body: {} };
    for (let i = 0; i < REPORTS_CREATE_MAX_PER_MINUTE; i++) {
      const r = await runRoute('POST', '/api/reports', opts);
      expect(r.status).toBe(400); // an allowed attempt still runs the handler (missing reason)
    }
    const r = await runRoute('POST', '/api/reports', opts);
    expect(r.status).toBe(429);
    expect(r.contentType).toBe('application/problem+json');
    expect(bodyRecord(r.body).code).toBe('rate_limit.exceeded');
    expect(r.headers['retry-after']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// The reportsBodyValidationRemap deviation: reportsHandler self-reads the body with
// readBody (no withBody), so a malformed body throws inside readBody and surfaces as
// 500 application/problem+json (internal.error) through the shared withErrors
// boundary, vs the legacy outer-catch 500 { error: 'internal error' } (same 500
// STATUS, different body shape). Sibling to walletBodyValidationRemap.
// ---------------------------------------------------------------------------

describe('POST /api/reports body-read 500 remap (reportsBodyValidationRemap deviation)', () => {
  it('500s a malformed body as application/problem+json (internal.error)', async () => {
    authedDb();
    const r = await runRoute('POST', '/api/reports', {
      headers: { authorization: BEARER },
      body: '{ not valid json',
    });
    expect(r.status).toBe(500);
    expect(r.contentType).toBe('application/problem+json');
    expect(bodyRecord(r.body).code).toBe('internal.error');
  });
});

// ---------------------------------------------------------------------------
// Composition order: activeGuard mounts BEFORE the limiter. An unauthenticated request
// (even with a malformed body) 401s at the guard, never the limiter's 500-without-
// account nor a 429. If the limiter ran first it would evaluate ctxAccountId on the
// missing account and throw HttpError(500); the 401 is the proof the guard ran first.
// ---------------------------------------------------------------------------

describe('POST /api/reports composition order (guard before limiter)', () => {
  it('401s an unauthenticated malformed-body request, never 500 or 429', async () => {
    authedDb();
    const r = await runRoute('POST', '/api/reports', { body: '{ not valid json' });
    expect(r).toMatchObject({ reached: false, status: 401 });
    expect(r.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
    expect(r.status).not.toBe(500);
    expect(r.status).not.toBe(429);
  });
});

// ---------------------------------------------------------------------------
// POST /api/bug-reports: [activeGuard] only. The handler self-reads its body at a
// 1 MB cap with its OWN try/catch (413 / 400), owns its BugReportRateLimitError -> 429
// (plain json), and rethrows any other createBugReport error to the withErrors 500.
// ---------------------------------------------------------------------------

describe('POST /api/bug-reports', () => {
  const authedBug = (body: unknown) =>
    runRoute('POST', '/api/bug-reports', { headers: { authorization: BEARER }, body });

  it('401s a missing bearer at the shared activeGuard', async () => {
    const r = await runRoute('POST', '/api/bug-reports');
    expect(r).toMatchObject({ reached: false, status: 401 });
    expect(r.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
    expect(r.contentType).toBe('application/json');
  });

  it('413s an over-cap body { error: "bug report too large" }', async () => {
    authedDb();
    const r = await authedBug('x'.repeat(1024 * 1024 + 8));
    expect(r.status).toBe(413);
    expect(r.body).toEqual({ error: 'bug report too large' });
  });

  it('400s a malformed body { error: "bad request" }', async () => {
    authedDb();
    const r = await authedBug('{ not valid json');
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'bad request' });
  });

  it('400s a missing description { error: "describe the bug" }', async () => {
    authedDb();
    const r = await authedBug({});
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'describe the bug' });
  });

  it('200s a valid bug report { ok: true, reportId, screenshotStored }', async () => {
    authedDb();
    vi.mocked(createBugReport).mockResolvedValue({ id: 7, screenshotStored: false });
    const r = await authedBug({ description: 'it broke' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, reportId: 7, screenshotStored: false });
  });

  it('429s a BugReportRateLimitError as plain json (not problem+json)', async () => {
    authedDb();
    vi.mocked(createBugReport).mockImplementation(() => {
      throw new BugReportRateLimitError();
    });
    const r = await authedBug({ description: 'x' });
    expect(r.status).toBe(429);
    expect(r.body).toEqual({ error: 'too many bug reports, try again later' });
    expect(r.contentType).toBe('application/json');
  });

  it('500s (problem+json internal.error) when createBugReport throws a non-rate-limit error', async () => {
    authedDb();
    vi.mocked(createBugReport).mockImplementation(() => {
      throw new Error('db down');
    });
    const r = await authedBug({ description: 'x' });
    expect(r.status).toBe(500);
    expect(r.contentType).toBe('application/problem+json');
    expect(bodyRecord(r.body).code).toBe('internal.error');
  });

  it('trusts only a verified owned character name, else stores no name', async () => {
    authedDb();
    vi.mocked(createBugReport).mockResolvedValue({ id: 1, screenshotStored: false });

    // An owned characterId resolves to its verified id + name.
    vi.mocked(getCharacter).mockResolvedValue(charRow(5, 'Hero'));
    await authedBug({ description: 'x', characterId: 5 });
    expect(vi.mocked(createBugReport)).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: 5, characterName: 'Hero' }),
    );

    // An unowned characterId resolves to no name (never the client value).
    vi.mocked(createBugReport).mockClear();
    vi.mocked(getCharacter).mockResolvedValue(null);
    await authedBug({ description: 'x', characterId: 5 });
    expect(vi.mocked(createBugReport)).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: null, characterName: '' }),
    );
  });
});
