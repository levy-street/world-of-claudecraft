// Security-headers wrapper (server/http/middleware/security_headers.ts).
//
// Two layers:
//   a) UNIT: drive withSecurityHeaders directly against the FakeRes/makeReq fakes
//      and pin the whole header contract with STRING LITERALS (never a constant
//      imported from the module under test: that self-comparison proves nothing).
//   b) INTEGRATION: replay real requests through routeHttpRequest under both
//      dispatch modes and prove the headers land on every branch, that a dispatch
//      rollback drops nothing, and that the deferred headers (CSP, COEP, HSTS in a
//      non-prod env) are absent. Copies parity.test.ts's setup: a dummy
//      DATABASE_URL set BEFORE importing server/main, a bounded writableEnded
//      poller, and setApiDispatchModeForTests / resetApiDispatchModeForTests. Only
//      db-free request shapes are used (a pool-touching path hangs the poller).

import type * as http from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { withSecurityHeaders } from '../../../server/http/middleware/security_headers';
import { FakeRes, type HeaderValue, makeReq } from '../helpers';

// The full expected header values, pinned as literals in the test (NOT imported
// from the module under test, so a value drift in the module is actually caught).
const EXPECT = {
  contentTypeOptions: 'nosniff',
  referrerPolicy: 'strict-origin-when-cross-origin',
  permissionsPolicy:
    'accelerometer=(), ambient-light-sensor=(), battery=(), bluetooth=(), camera=(), ' +
    'display-capture=(), geolocation=(), gyroscope=(), hid=(), idle-detection=(), ' +
    'local-fonts=(), magnetometer=(), midi=(), payment=(), serial=(), usb=(), ' +
    'xr-spatial-tracking=(), microphone=(self)',
  crossOriginOpenerPolicy: 'same-origin',
  crossOriginResourcePolicy: 'same-origin',
  crossOriginResourcePolicyEmbed: 'cross-origin',
  strictTransportSecurity: 'max-age=31536000; includeSubDomains',
  frameOptions: 'DENY',
  cacheControl: 'no-store',
} as const;

/** Drive withSecurityHeaders over a fresh req/res and return the FakeRes. */
function run(url: string, env?: NodeJS.ProcessEnv, headers?: Record<string, string>): FakeRes {
  const req = makeReq({ url, headers });
  const res = new FakeRes();
  withSecurityHeaders(req, res as unknown as http.ServerResponse, env);
  return res;
}

describe('withSecurityHeaders (unit)', () => {
  it('sets the full unconditional header set on every request', () => {
    const res = run('/anything');
    expect(res.getHeader('X-Content-Type-Options')).toBe(EXPECT.contentTypeOptions);
    expect(res.getHeader('Referrer-Policy')).toBe(EXPECT.referrerPolicy);
    expect(res.getHeader('Permissions-Policy')).toBe(EXPECT.permissionsPolicy);
    expect(res.getHeader('Cross-Origin-Opener-Policy')).toBe(EXPECT.crossOriginOpenerPolicy);
    expect(res.getHeader('Cross-Origin-Resource-Policy')).toBe(EXPECT.crossOriginResourcePolicy);
  });

  it('allows Glitch to make the public game shell cross-origin request seen in the live embed', () => {
    const res = run('/', undefined, {
      referer: 'https://www.glitch.fun/',
      'sec-fetch-mode': 'no-cors',
      'sec-fetch-site': 'cross-site',
    });
    expect(res.getHeader('Cross-Origin-Resource-Policy')).toBe(
      EXPECT.crossOriginResourcePolicyEmbed,
    );
  });

  it('keeps API, admin, oauth, and internal paths same-origin even for Glitch requests', () => {
    for (const url of [
      '/api',
      '/api/project-stats',
      '/admin/api/overview',
      '/oauth/authorize',
      '/internal/restart-countdown',
    ]) {
      const res = run(url, undefined, { referer: 'https://www.glitch.fun/' });
      expect(res.getHeader('Cross-Origin-Resource-Policy')).toBe(EXPECT.crossOriginResourcePolicy);
    }
  });

  it('keeps direct public requests same-origin when no Glitch origin is present', () => {
    expect(run('/').getHeader('Cross-Origin-Resource-Policy')).toBe(
      EXPECT.crossOriginResourcePolicy,
    );
    expect(
      run('/', undefined, { referer: 'not a valid url' }).getHeader('Cross-Origin-Resource-Policy'),
    ).toBe(EXPECT.crossOriginResourcePolicy);
  });

  it('sets HSTS only when NODE_ENV is production', () => {
    expect(
      run('/anything', { NODE_ENV: 'production' }).getHeader('Strict-Transport-Security'),
    ).toBe(EXPECT.strictTransportSecurity);
    expect(run('/anything', {}).getHeader('Strict-Transport-Security')).toBeUndefined();
    expect(run('/anything', { NODE_ENV: 'test' }).getHeader('Strict-Transport-Security')).toBe(
      undefined,
    );
  });

  it('adds X-Frame-Options DENY + Cache-Control no-store only on /oauth/ paths', () => {
    const oauth = run('/oauth/authorize');
    expect(oauth.getHeader('X-Frame-Options')).toBe(EXPECT.frameOptions);
    expect(oauth.getHeader('Cache-Control')).toBe(EXPECT.cacheControl);

    const nonOauth = run('/api/status');
    expect(nonOauth.getHeader('X-Frame-Options')).toBeUndefined();
    expect(nonOauth.getHeader('Cache-Control')).toBeUndefined();
  });

  it('strips the /oauth/ query string before the prefix check', () => {
    // The path is computed by splitting on '?', so a query never hides the prefix.
    const res = run('/oauth/token?grant_type=authorization_code');
    expect(res.getHeader('X-Frame-Options')).toBe(EXPECT.frameOptions);
    expect(res.getHeader('Cache-Control')).toBe(EXPECT.cacheControl);
  });

  it('never sets a Content-Security-Policy or a Cross-Origin-Embedder-Policy header', () => {
    for (const url of ['/api/status', '/oauth/authorize']) {
      const res = run(url);
      expect(res.getHeader('Content-Security-Policy')).toBeUndefined();
      expect(res.getHeader('Cross-Origin-Embedder-Policy')).toBeUndefined();
    }
  });

  it('allows gameplay features from self and denies unused sensors', () => {
    const value = run('/anything').getHeader('Permissions-Policy') as string;
    // Fullscreen (mobile landscape lock) and Gamepad are in active use, so denying
    // them would break the game; they must NOT appear in the deny list.
    expect(value.includes('fullscreen')).toBe(false);
    expect(value.includes('gamepad')).toBe(false);
    // Glitch voice chat needs the microphone only from the game origin. Other
    // sensitive capabilities the game never uses remain denied.
    expect(value.includes('camera=()')).toBe(true);
    expect(value.includes('microphone=(self)')).toBe(true);
    expect(value.includes('microphone=()')).toBe(false);
    expect(value.includes('geolocation=()')).toBe(true);
  });

  it('removes Server and X-Powered-By so no framework banner leaks', () => {
    const req = makeReq({ url: '/anything' });
    const res = new FakeRes();
    res.setHeader('Server', 'some-proxy/1.0');
    res.setHeader('X-Powered-By', 'Express');
    withSecurityHeaders(req, res as unknown as http.ServerResponse);
    expect(res.getHeader('Server')).toBeUndefined();
    expect(res.getHeader('X-Powered-By')).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// INTEGRATION through the real routeHttpRequest.
// -----------------------------------------------------------------------------

// db.ts reads DATABASE_URL at module scope; a dummy URL lets the bare server/main
// import resolve. The pool is constructed but never connects: every request shape
// below returns before touching it (verified db-free by reading each handler).
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_phase21_security';

// routeHttpRequest is synchronous fire-and-forget (void apiEntry(req, res)), so a
// dispatch must poll res.writableEnded before the captured headers are readable.
const MAX_POLL_TICKS = 5000;

// The security headers whose parity across the two dispatch modes is asserted.
// Cache-Control is deliberately excluded (handlers set it, so it is not a
// wrapper-owned invariant on a non-oauth path).
const SECURITY_HEADER_NAMES = [
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'strict-transport-security',
  'x-frame-options',
] as const;

type MainModule = typeof import('../../../server/main');
let main: MainModule;
let savedNodeEnv: string | undefined;

beforeAll(async () => {
  // Pin a non-production env so HSTS is deterministically ABSENT (vitest defaults
  // NODE_ENV to 'test', but pinning removes any dependence on the runner's env).
  savedNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  main = (await import('../../../server/main')) as MainModule;
});

afterEach(() => {
  main.resetApiDispatchModeForTests();
});

afterAll(() => {
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
});

/** Drive the real routeHttpRequest under `mode` and poll until the response ends. */
async function driveRoute(
  mode: 'legacy' | 'new',
  opts: { method?: string; url: string; headers?: Record<string, string> },
): Promise<FakeRes> {
  main.setApiDispatchModeForTests(mode);
  const req = makeReq(opts);
  const res = new FakeRes();
  main.routeHttpRequest(req, res as unknown as http.ServerResponse);
  let ticks = 0;
  while (!res.writableEnded) {
    if (ticks++ > MAX_POLL_TICKS) throw new Error('response never ended');
    await new Promise((r) => setImmediate(r));
  }
  return res;
}

/**
 * Assert the full unconditional set is present with the pinned literal values,
 * and that the deferred headers (CSP, COEP) and HSTS (non-prod env) are absent.
 */
function expectCoreHeaders(res: FakeRes, opts: { crossOriginResourcePolicy?: string } = {}): void {
  const crossOriginResourcePolicy =
    opts.crossOriginResourcePolicy ?? EXPECT.crossOriginResourcePolicy;
  expect(res.getHeader('X-Content-Type-Options')).toBe(EXPECT.contentTypeOptions);
  expect(res.getHeader('Referrer-Policy')).toBe(EXPECT.referrerPolicy);
  expect(res.getHeader('Permissions-Policy')).toBe(EXPECT.permissionsPolicy);
  expect(res.getHeader('Cross-Origin-Opener-Policy')).toBe(EXPECT.crossOriginOpenerPolicy);
  expect(res.getHeader('Cross-Origin-Resource-Policy')).toBe(crossOriginResourcePolicy);
  expect(res.getHeader('Content-Security-Policy')).toBeUndefined();
  expect(res.getHeader('Cross-Origin-Embedder-Policy')).toBeUndefined();
  expect(res.getHeader('Strict-Transport-Security')).toBeUndefined();
}

function securitySubset(res: FakeRes): Record<string, HeaderValue | undefined> {
  const out: Record<string, HeaderValue | undefined> = {};
  for (const name of SECURITY_HEADER_NAMES) out[name] = res.getHeader(name);
  return out;
}

describe('routeHttpRequest security headers (integration)', () => {
  it('sets the headers on a static 404 (the serveStatic branch)', async () => {
    // A '.txt' asset path 404s synchronously with 'not found' and never touches
    // dist/ or the pool, so it is a deterministic db-free static branch.
    const res = await driveRoute('legacy', { url: '/no-such-file-xyz.txt' });
    expect(res.statusCode).toBe(404);
    expectCoreHeaders(res);
    // A non-oauth branch adds no clickjacking header.
    expect(res.getHeader('X-Frame-Options')).toBeUndefined();
  });

  it('allows the Glitch embed root probe on public static responses', async () => {
    const res = await driveRoute('legacy', {
      url: '/no-such-file-xyz.txt',
      headers: {
        referer: 'https://www.glitch.fun/',
        'sec-fetch-mode': 'no-cors',
        'sec-fetch-site': 'cross-site',
      },
    });
    expect(res.statusCode).toBe(404);
    expectCoreHeaders(res, {
      crossOriginResourcePolicy: EXPECT.crossOriginResourcePolicyEmbed,
    });
  });

  it('keeps the API branch same-origin for Glitch-originated requests', async () => {
    const res = await driveRoute('legacy', {
      url: '/api/site-presence',
      headers: { referer: 'https://www.glitch.fun/' },
    });
    expect(res.statusCode).toBe(405);
    expectCoreHeaders(res);
  });

  it('sets the headers on a legacy /api 405 error response', async () => {
    // GET /api/site-presence returns the 405 { ok: false } heartbeat contract
    // before any pool.query (the db-free path parity.test.ts uses).
    const res = await driveRoute('legacy', { url: '/api/site-presence' });
    expect(res.statusCode).toBe(405);
    expectCoreHeaders(res);
    expect(res.getHeader('X-Frame-Options')).toBeUndefined();
  });

  it('adds X-Frame-Options DENY + Cache-Control no-store on the /oauth consent page', async () => {
    // GET /oauth/authorize with no query renders the db-free htmlError 400
    // consent-precondition page. Assert on HEADERS only (the source HTML carries a
    // pre-existing em dash that must not enter this diff), so no body snapshot.
    const res = await driveRoute('legacy', { url: '/oauth/authorize' });
    expect(res.statusCode).toBe(400);
    expectCoreHeaders(res);
    expect(res.getHeader('X-Frame-Options')).toBe(EXPECT.frameOptions);
    expect(res.getHeader('Cache-Control')).toBe(EXPECT.cacheControl);
  });

  it('sets the headers on the OPTIONS-204 CORS short-circuit', async () => {
    // applyCorsAndPreflight answers OPTIONS to an /api path with a 204 before the
    // ladder; the security headers must ride on that short-circuited 204.
    const res = await driveRoute('legacy', {
      method: 'OPTIONS',
      url: '/api/anything',
      headers: { origin: 'http://localhost' },
    });
    expect(res.statusCode).toBe(204);
    expectCoreHeaders(res);
  });

  it('carries an identical, complete header set under BOTH dispatch modes (a rollback drops nothing)', async () => {
    const legacy = await driveRoute('legacy', { url: '/api/site-presence' });
    const fresh = await driveRoute('new', { url: '/api/site-presence' });
    // Complete on both.
    expectCoreHeaders(legacy);
    expectCoreHeaders(fresh);
    // Identical wrapper-owned set on both: a dispatch-flag flip changes nothing.
    expect(securitySubset(fresh)).toEqual(securitySubset(legacy));
  });
});
