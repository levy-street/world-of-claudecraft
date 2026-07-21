// Unit coverage for the PUBLIC TELEMETRY beacons on the migrated
// server/reports.ts: POST /api/perf-report and POST /api/site-presence.
//
// Both beacons are PUBLIC (no auth guard, no middleware at all): they self-read
// their body inside handlePerfReport / handleSitePresenceHeartbeat and own their
// legacy { ok } / { ok: false, error } bodies byte-for-byte (RFC 9457 is the client code-matcher).
// So every happy / validation assertion pins the exact legacy status + body, and
// the ONLY framework-error divergence is the 500 SHAPE: an over-cap readBody reject
// the handler does NOT catch surfaces through the shared withErrors boundary as 500
// application/problem+json (internal.error), the reportsBodyValidationRemap known
// deviation. The reports.ts + bug-reports account-gated writes are covered by a
// sibling file; this one owns only the two public beacons.
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is unset;
// reports.ts (via perf_report.ts) imports it, so set a dummy URL. The pool never
// connects: insertClientPerfReport / recordSitePresence are vi.fn fakes, and the
// happy-path requests carry no bearer so perf-report's accountForToken / getCharacter
// reads are never reached.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_phase15_telemetry';

import type * as http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordSitePresence } from '../../server/admin_db';
import { insertClientPerfReport } from '../../server/db';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import { apiRegistry } from '../../server/http/registry';
import type { Method, Middleware } from '../../server/http/types';
import { routes } from '../../server/reports';
import { type FakeRes, fakeCtx } from './helpers';

// perf-report self-reads its body and, for an authed caller only, reads
// accountForToken / getCharacter; our happy-path requests carry no bearer, so only
// insertClientPerfReport is reached. Replace it with a fake; the ...actual spread
// keeps every other db export real.
vi.mock('../../server/db', async (importActual) => {
  const actual = await importActual<typeof import('../../server/db')>();
  return {
    ...actual,
    insertClientPerfReport: vi.fn(async () => {}),
  };
});

// site-presence self-reads its body and writes via recordSitePresence; replace it
// with a fake so the happy path stays db-free.
vi.mock('../../server/admin_db', async (importActual) => {
  const actual = await importActual<typeof import('../../server/admin_db')>();
  return {
    ...actual,
    recordSitePresence: vi.fn(async () => {}),
  };
});

// ---------------------------------------------------------------------------
// Local helpers, copied verbatim from tests/server/wallet.test.ts.
// ---------------------------------------------------------------------------

/** Read status/body/raw-body/content-type off the fakeCtx's FakeRes. */
function readRes(res: http.ServerResponse): {
  status: number;
  body: unknown;
  raw: string;
  contentType: string | undefined;
} {
  const fake = res as unknown as FakeRes;
  return {
    status: fake.statusCode,
    body: fake.body ? JSON.parse(fake.body) : undefined,
    raw: fake.body,
    contentType: fake.headers['content-type'] as string | undefined,
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

// clearAllMocks resets the fakes' call history between tests (restoreAllMocks alone
// does not clear a module-factory vi.fn's recorded calls here, so counts would
// accumulate); restoreAllMocks then restores any spies.
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// POST /api/site-presence (public heartbeat; handler owns its 405/400/200).
// ---------------------------------------------------------------------------

describe('POST /api/site-presence (public site-presence beacon)', () => {
  it('200 { ok: true } for a valid visitor id, recording presence once', async () => {
    const r = await runRoute('POST', '/api/site-presence', {
      body: { visitorId: 'a'.repeat(16), page: 'home' },
    });
    expect(r.reached).toBe(true);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(r.contentType).toBe('application/json');
    expect(vi.mocked(recordSitePresence)).toHaveBeenCalledTimes(1);
  });

  it('400 { ok: false, error: "invalid visitor id" } for a bad visitor id, no write', async () => {
    const r = await runRoute('POST', '/api/site-presence', {
      body: { visitorId: 'short' },
    });
    expect(r.reached).toBe(true);
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ ok: false, error: 'invalid visitor id' });
    expect(r.contentType).toBe('application/json');
    expect(vi.mocked(recordSitePresence)).not.toHaveBeenCalled();
  });

  it('GET resolves methodNotAllowed (the route is registered POST-only)', () => {
    // The shared dispatcher DELEGATES a methodNotAllowed resolve to the retained
    // legacy ladder, whose URL-only arm keeps the handler-owned 405
    // { ok: false, error: 'method not allowed' } (pinned byte-identical old-vs-new
    // in tests/server/http/parity.test.ts); so the router never synthesizes a
    // generic 405 for this path while the legacy arm stands.
    expect(apiRegistry.resolve('GET', '/api/site-presence').kind).toBe('methodNotAllowed');
  });

  it('is public and not web-login-gated (no middleware; 200s with no bearer)', async () => {
    // The route carries no auth or web-login guard, so it is reachable independent of
    // REQUIRE_WEB_LOGIN. The web-login prologue is a main.ts concern OUTSIDE the RouteDef
    // (webLoginEnforced / isWebClientRequest, exercised in tests/web_login_guard.test.ts)
    // and only ever gated register / login, so this no-middleware assertion is the correct
    // route-level proof that the prologue cannot start gating site-presence under the router.
    expect(routeFor('POST', '/api/site-presence').middleware).toBeUndefined();
    const r = await runRoute('POST', '/api/site-presence', {
      body: { visitorId: 'b'.repeat(16), page: 'home' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
  });

  it('over-cap body is 500 problem+json (reportsBodyValidationRemap deviation)', async () => {
    // A >1024-byte raw string trips readBody's 1024 cap ('body too large'), which
    // handleSitePresenceHeartbeat does NOT catch; the throw propagates past the
    // handler to withErrors, which serializes the coded internal.error as
    // application/problem+json (vs the legacy outer-catch 500 { error: 'internal
    // error' }: same 500 STATUS, different body shape).
    const r = await runRoute('POST', '/api/site-presence', { body: 'x'.repeat(2048) });
    expect(r.status).toBe(500);
    expect(r.contentType).toBe('application/problem+json');
    expect(bodyRecord(r.body).code).toBe('internal.error');
  });
});

// ---------------------------------------------------------------------------
// POST /api/perf-report (public perf beacon; 200-on-throttle, never a 429).
// ---------------------------------------------------------------------------

describe('POST /api/perf-report (public perf beacon)', () => {
  it('200 { ok: true } for a fresh session, inserting one report', async () => {
    // A unique sessionId per perf-report test so the per-session insert throttle in
    // perf_report.ts (module-global) does not swallow a later insert to 200-no-store.
    const r = await runRoute('POST', '/api/perf-report', { body: { sessionId: 's-happy' } });
    expect(r.reached).toBe(true);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(r.contentType).toBe('application/json');
    expect(vi.mocked(insertClientPerfReport)).toHaveBeenCalledTimes(1);
  });

  it('GET resolves methodNotAllowed (the route is registered POST-only)', () => {
    // Do NOT assert 405 here: GET /api/perf-report is 404 in the legacy ladder (the
    // dispatch arm gates on POST, so a GET falls through to the 404 unknown-endpoint
    // arm; handlePerfReport's internal 405 { ok: false } branch is unreachable
    // through the dispatcher). The dispatcher delegating methodNotAllowed to legacy
    // preserves that 404 on both flags; the perfReportSitePresence405OkFalse +
    // perfReport200NotThrottle deviations cover it.
    expect(apiRegistry.resolve('GET', '/api/perf-report').kind).toBe('methodNotAllowed');
  });

  it('is public (no auth middleware)', () => {
    expect(routeFor('POST', '/api/perf-report').middleware).toBeUndefined();
  });

  it('swallows a repeat beacon with a 200 (throttle never 429s), inserting once', async () => {
    // Two POSTs with the SAME sessionId: the first stores (200 { ok: true }, one
    // insert); the second, inside the per-session throttle window, is swallowed by
    // shouldStorePerfReport to a 200 { ok: true } with NO second insert. This proves
    // the beacon is swallowed with a 200 (never a 429/error) on the throttle path,
    // delegated unchanged from handlePerfReport (whose full throttle behavior is
    // unit-tested in tests/perf_report.test.ts and pinned by the perfReport200NotThrottle
    // known deviation).
    const first = await runRoute('POST', '/api/perf-report', { body: { sessionId: 's-dup' } });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true });
    const second = await runRoute('POST', '/api/perf-report', { body: { sessionId: 's-dup' } });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ ok: true });
    expect(vi.mocked(insertClientPerfReport)).toHaveBeenCalledTimes(1);
  });
});
