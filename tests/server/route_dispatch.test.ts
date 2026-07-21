// Unit tests for routeHttpRequest, the HTTP prefix-dispatch ladder exposed as a
// pure function from server/main.ts. They pin the two things a
// move-behind-a-seam can silently break: the OPTIONS-204 + CORS short-circuit
// that must run BEFORE any handler, and the prefix ladder routing each request
// to the right sub-dispatcher in the right order. The DB-backed sub-dispatchers
// imported into main.ts (handleAdminApi, handleInternalApi) are mocked to spies
// so dispatch is observable without a database or a live server; the main-local
// handleApi/serveStatic arms are exercised only via the OPTIONS short-circuit,
// which returns before reaching them.
import type * as http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/admin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/admin')>();
  return { ...actual, handleAdminApi: vi.fn() };
});
vi.mock('../../server/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/internal')>();
  return { ...actual, handleInternalApi: vi.fn() };
});
vi.mock('../../server/daily_rewards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/daily_rewards')>();
  // Default: the daily-rewards internal pre-check declines (false) so the /internal/
  // arm falls through to handleInternalApi, matching every non-daily-rewards path.
  // A test that exercises the short-circuit overrides with mockResolvedValueOnce(true).
  return { ...actual, handleDailyRewardInternalApi: vi.fn(async () => false) };
});

// The /internal/ arm dispatches inside an async IIFE (it awaits the daily-rewards
// internal pre-check before falling through to handleInternalApi), so drain the
// microtask queue before asserting the fire-and-forget dispatch landed.
const flush = () => new Promise((resolve) => setImmediate(resolve));

function fakeReq(method: string, url: string, headers: Record<string, string> = {}) {
  return { method, url, headers } as unknown as http.IncomingMessage;
}

// A minimal ServerResponse double: records writeHead codes and header writes so
// we can assert the 204 short-circuit and the CORS header position without a
// real socket.
function fakeRes() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    ended: false,
    writeHeadCodes: [] as number[],
    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
    },
    getHeader(k: string) {
      return this.headers[k.toLowerCase()];
    },
    // The top-level withSecurityHeaders wrapper defensively strips Server /
    // X-Powered-By on every routeHttpRequest call, so the double must accept it.
    removeHeader(k: string) {
      delete this.headers[k.toLowerCase()];
    },
    writeHead(code: number, h?: Record<string, string>) {
      this.writeHeadCodes.push(code);
      this.statusCode = code;
      if (h) for (const [k, v] of Object.entries(h)) this.headers[k.toLowerCase()] = v;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

let mainMod: typeof import('../../server/main') | undefined;

async function loadRoute() {
  // db.ts reads DATABASE_URL at module scope (throws if unset); a dummy URL lets
  // the bare import resolve without binding a socket or opening a connection.
  process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_phase1_test';
  const main = await import('../../server/main');
  mainMod = main;
  // These tests pin the LEGACY prefix-ladder delegation: the four sub-dispatchers
  // are observed via the mocked handleAdminApi / handleInternalApi /
  // handleDailyRewardInternalApi spies, which only fire on the legacy delegate path.
  // The production boot default is 'new', where a MATCHED migrated path
  // (/internal/restart-countdown, /internal/daily-rewards/*) runs the onion instead
  // of the delegate, so pin the mode to 'legacy' EXPLICITLY here.
  main.setApiDispatchModeForTests('legacy');
  const admin = await import('../../server/admin');
  const internal = await import('../../server/internal');
  const dailyRewards = await import('../../server/daily_rewards');
  return {
    routeHttpRequest: main.routeHttpRequest,
    handleAdminApi: vi.mocked(admin.handleAdminApi),
    handleInternalApi: vi.mocked(internal.handleInternalApi),
    handleDailyRewardInternalApi: vi.mocked(dailyRewards.handleDailyRewardInternalApi),
  };
}

// Restore the boot-default dispatch mode after each test (loadRoute pins 'legacy').
afterEach(() => {
  mainMod?.resetApiDispatchModeForTests();
});

describe('routeHttpRequest: OPTIONS-204 + CORS short-circuit', () => {
  it('short-circuits an OPTIONS /api preflight with 204 before any dispatch', async () => {
    const { routeHttpRequest, handleAdminApi, handleInternalApi } = await loadRoute();
    handleAdminApi.mockClear();
    handleInternalApi.mockClear();
    const res = fakeRes();
    routeHttpRequest(fakeReq('OPTIONS', '/api/login'), res as unknown as http.ServerResponse);
    expect(res.writeHeadCodes).toEqual([204]);
    expect(res.ended).toBe(true);
    // The preflight returns before the prefix ladder, so no sub-dispatcher runs.
    expect(handleInternalApi).not.toHaveBeenCalled();
    expect(handleAdminApi).not.toHaveBeenCalled();
  });

  it('applies wide-open public CORS and 204 to an OPTIONS on a public read path', async () => {
    const { routeHttpRequest } = await loadRoute();
    const res = fakeRes();
    routeHttpRequest(
      fakeReq('OPTIONS', '/api/public/characters/1/sheet'),
      res as unknown as http.ServerResponse,
    );
    expect(res.writeHeadCodes).toEqual([204]);
    // Public read surfaces reflect any origin ('*'), distinct from the narrow
    // realm/native allowlist maybeCors applies to the rest of /api.
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

describe('routeHttpRequest: prefix ladder dispatch order', () => {
  it('routes a non-daily-rewards /internal/ path to handleInternalApi and never 204s a non-OPTIONS request', async () => {
    const { routeHttpRequest, handleInternalApi, handleAdminApi, handleDailyRewardInternalApi } =
      await loadRoute();
    handleInternalApi.mockClear();
    handleAdminApi.mockClear();
    handleDailyRewardInternalApi.mockClear();
    const res = fakeRes();
    const req = fakeReq('POST', '/internal/restart-countdown');
    routeHttpRequest(req, res as unknown as http.ServerResponse);
    await flush();
    // The daily-rewards internal pre-check is tried first, declines for this path,
    // and the arm falls through to handleInternalApi.
    expect(handleDailyRewardInternalApi).toHaveBeenCalledTimes(1);
    expect(handleInternalApi).toHaveBeenCalledTimes(1);
    // The request object is forwarded verbatim (fire-and-forget void dispatch).
    expect(handleInternalApi.mock.calls[0][0]).toBe(req);
    expect(handleAdminApi).not.toHaveBeenCalled();
    expect(res.writeHeadCodes).not.toContain(204);
  });

  it('short-circuits an /internal/daily-rewards/ path to handleDailyRewardInternalApi (no fall-through)', async () => {
    const { routeHttpRequest, handleInternalApi, handleDailyRewardInternalApi } = await loadRoute();
    handleInternalApi.mockClear();
    handleDailyRewardInternalApi.mockClear();
    // The pre-check reports it handled the request; the arm must NOT fall through.
    handleDailyRewardInternalApi.mockResolvedValueOnce(true);
    const res = fakeRes();
    const req = fakeReq('POST', '/internal/daily-rewards/pending-payouts');
    routeHttpRequest(req, res as unknown as http.ServerResponse);
    await flush();
    expect(handleDailyRewardInternalApi).toHaveBeenCalledTimes(1);
    expect(handleDailyRewardInternalApi.mock.calls[0][0]).toBe(req);
    expect(handleInternalApi).not.toHaveBeenCalled();
  });

  it('routes /admin/api/ to handleAdminApi, distinct from the /api/ arm', async () => {
    const { routeHttpRequest, handleAdminApi, handleInternalApi } = await loadRoute();
    handleAdminApi.mockClear();
    handleInternalApi.mockClear();
    const res = fakeRes();
    const req = fakeReq('GET', '/admin/api/players');
    routeHttpRequest(req, res as unknown as http.ServerResponse);
    expect(handleAdminApi).toHaveBeenCalledTimes(1);
    expect(handleAdminApi.mock.calls[0][0]).toBe(req);
    expect(handleInternalApi).not.toHaveBeenCalled();
  });
});
