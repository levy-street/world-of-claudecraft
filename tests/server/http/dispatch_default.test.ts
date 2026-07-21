// The dispatch-default flip:
// the new in-house pipeline is now the PRODUCTION default, with API_DISPATCH=legacy
// the one-flag rollback to the retained legacy ladder. This proves BOTH directions
// on ALL FOUR flag-gated entries (api, admin, oauth, internal), db-free.
//
// TWO decisive layers:
//   1. CONFIG (pure loadConfig): the default resolves to 'new' (the flip); an unset
//      or empty API_DISPATCH is that default; 'legacy' is one flag away; a garbage
//      value throws (no silent default).
//   2. ROUTING through the REAL routeHttpRequest under both modes:
//      - /api has a db-free VISIBLE new-vs-legacy discriminator (the public-read
//        realmsSearchAuthzGapClose + statusNameListTrim deviations): GET /api/search
//        with no bearer is 200 { results: [] } on the NEW pipeline vs 401 on the
//        legacy ladder, and GET /api/status trims names[] on the NEW pipeline. So the
//        /api entry is pinned end-to-end under the boot default (proving the default
//        IS 'new') and under an explicit 'legacy' rollback.
//      - admin / oauth / internal are PARITY-CLEAN for every db-free contract path
//        (a migrated route is byte-identical old-vs-new by design, proven by
//        tests/server/http/parity.test.ts), so NO response difference can tell the
//        onion from the legacy delegate. Their legacy delegates ARE importable
//        modules, so the discriminator is a SPY on the delegate: under the new
//        default a matched migrated path runs the onion (the legacy delegate is NOT
//        called); under 'legacy' the same path reaches the legacy delegate (it IS
//        called); and an unmatched path delegates under both. (handleApi is defined
//        INSIDE server/main.ts, not an importable module, so /api cannot use the spy
//        and uses the visible discriminator above instead.)
//
// Reset the mode in afterEach so test order cannot leak a mode.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../../server/http/config';
import { captureResponse, type Dispatch, makeReq } from '../helpers';

// The importable legacy delegates for admin / oauth / internal, wrapped as SPIES
// that still delegate to the REAL implementation, so the 'legacy' pass produces the
// real db-free contract while the spy records that the delegate ran. handleApi lives
// inside main.ts (not a separate module), so /api cannot be mocked this way and uses
// the visible discriminator instead. The `...actual` spread keeps each module's
// `routes` export real, so the onion path (under 'new') is UNaffected by the mock.
vi.mock('../../../server/admin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../server/admin')>();
  return { ...actual, handleAdminApi: vi.fn(actual.handleAdminApi) };
});
vi.mock('../../../server/oauth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../server/oauth')>();
  return { ...actual, handleOAuth: vi.fn(actual.handleOAuth) };
});
vi.mock('../../../server/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../server/internal')>();
  return { ...actual, handleInternalApi: vi.fn(actual.handleInternalApi) };
});
vi.mock('../../../server/daily_rewards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../server/daily_rewards')>();
  return {
    ...actual,
    handleDailyRewardInternalApi: vi.fn(actual.handleDailyRewardInternalApi),
  };
});

// db.ts reads DATABASE_URL at module scope (throws if unset); a dummy pool-less URL
// lets the bare import resolve. Every probe below returns before touching Postgres.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_phase25_dispatch_default';

// The one required Config field; every other field takes its default.
const MIN_ENV: NodeJS.ProcessEnv = { DATABASE_URL: 'postgres://x' };

// routeHttpRequest is synchronous fire-and-forget, so a dispatch polls writableEnded.
const MAX_POLL_TICKS = 5000;
// The two secret-gate env vars that must be UNSET for the internal restart-countdown
// route to answer its feature-off 404 (matching parity.test.ts's feature-off case).
const RESTART_SECRET_ENV = 'RESTART_COUNTDOWN_SECRET';
const DISCORD_SECRET_ENV = 'DISCORD_BOT_SECRET';

type MainModule = typeof import('../../../server/main');
let main: MainModule;
let handleAdminApi: ReturnType<typeof vi.fn>;
let handleOAuth: ReturnType<typeof vi.fn>;
let handleInternalApi: ReturnType<typeof vi.fn>;
let handleDailyRewardInternalApi: ReturnType<typeof vi.fn>;

// A Dispatch over the REAL routeHttpRequest, polling res.writableEnded (mirrors
// parity.test.ts's makeModedDispatch). The MODE is set by the caller beforehand.
const drive: Dispatch = async (req, res) => {
  main.routeHttpRequest(req, res);
  let ticks = 0;
  while (!(res as unknown as { writableEnded: boolean }).writableEnded) {
    if (ticks++ > MAX_POLL_TICKS) throw new Error('response never ended');
    await new Promise((r) => setImmediate(r));
  }
};

// Run `fn` with both internal secret env vars UNSET (restored after), so the
// restart-countdown gate deterministically answers the feature-off 404.
async function withInternalSecretsUnset<T>(fn: () => Promise<T>): Promise<T> {
  const savedRestart = process.env[RESTART_SECRET_ENV];
  const savedDiscord = process.env[DISCORD_SECRET_ENV];
  delete process.env[RESTART_SECRET_ENV];
  delete process.env[DISCORD_SECRET_ENV];
  try {
    return await fn();
  } finally {
    if (savedRestart === undefined) delete process.env[RESTART_SECRET_ENV];
    else process.env[RESTART_SECRET_ENV] = savedRestart;
    if (savedDiscord === undefined) delete process.env[DISCORD_SECRET_ENV];
    else process.env[DISCORD_SECRET_ENV] = savedDiscord;
  }
}

beforeAll(async () => {
  main = (await import('../../../server/main')) as MainModule;
  const admin = await import('../../../server/admin');
  const oauth = await import('../../../server/oauth');
  const internal = await import('../../../server/internal');
  const daily = await import('../../../server/daily_rewards');
  handleAdminApi = vi.mocked(admin.handleAdminApi);
  handleOAuth = vi.mocked(oauth.handleOAuth);
  handleInternalApi = vi.mocked(internal.handleInternalApi);
  handleDailyRewardInternalApi = vi.mocked(daily.handleDailyRewardInternalApi);
});

afterEach(() => {
  main.resetApiDispatchModeForTests();
  handleAdminApi.mockClear();
  handleOAuth.mockClear();
  handleInternalApi.mockClear();
  handleDailyRewardInternalApi.mockClear();
});

// ---------------------------------------------------------------------------
// Layer 1: the config default IS the flip.
// ---------------------------------------------------------------------------

describe('dispatch default: loadConfig', () => {
  it('defaults an unset API_DISPATCH to the new pipeline', () => {
    // The literal, never DEFAULT_DISPATCH compared to itself: pin 'new'.
    expect(loadConfig({ ...MIN_ENV }).dispatch).toBe('new');
  });

  it('treats an empty API_DISPATCH as unset (the new default)', () => {
    expect(loadConfig({ ...MIN_ENV, API_DISPATCH: '' }).dispatch).toBe('new');
  });

  it('keeps API_DISPATCH=legacy as the one-flag rollback', () => {
    expect(loadConfig({ ...MIN_ENV, API_DISPATCH: 'legacy' }).dispatch).toBe('legacy');
    expect(loadConfig({ ...MIN_ENV, API_DISPATCH: 'new' }).dispatch).toBe('new');
  });

  it('throws on a garbage API_DISPATCH (no silent default in either direction)', () => {
    expect(() => loadConfig({ ...MIN_ENV, API_DISPATCH: 'bogus' })).toThrow(/API_DISPATCH/);
  });
});

// ---------------------------------------------------------------------------
// Layer 2a: the /api entry, VISIBLE discriminator (search + status deviations).
// ---------------------------------------------------------------------------

describe('dispatch default: the /api entry (visible discriminator)', () => {
  it('serves GET /api/search through the NEW pipeline under the boot default (200 empty results)', async () => {
    main.resetApiDispatchModeForTests(); // the boot default, now 'new'
    const cap = await captureResponse(drive, makeReq({ method: 'GET', url: '/api/search' }));
    expect(cap.status).toBe(200);
    expect(JSON.parse(cap.body as string)).toEqual({ results: [] });
  });

  it('serves GET /api/search through the LEGACY ladder under API_DISPATCH=legacy (401)', async () => {
    main.setApiDispatchModeForTests('legacy');
    const cap = await captureResponse(drive, makeReq({ method: 'GET', url: '/api/search' }));
    expect(cap.status).toBe(401);
    // The legacy bearerAccount arm writes the bare { error } (no stable code), unlike
    // the migrated auth guard; both shapes are pinned to lock the visible difference.
    expect(JSON.parse(cap.body as string)).toEqual({ error: 'not authenticated' });
  });

  it('trims names[] from GET /api/status on the NEW default but keeps it on the legacy rollback', async () => {
    main.resetApiDispatchModeForTests();
    const newCap = await captureResponse(drive, makeReq({ method: 'GET', url: '/api/status' }));
    expect(newCap.status).toBe(200);
    expect(Object.keys(JSON.parse(newCap.body as string))).not.toContain('names');

    main.setApiDispatchModeForTests('legacy');
    const legacyCap = await captureResponse(drive, makeReq({ method: 'GET', url: '/api/status' }));
    expect(legacyCap.status).toBe(200);
    expect(Object.keys(JSON.parse(legacyCap.body as string))).toContain('names');
  });
});

// ---------------------------------------------------------------------------
// Layer 2b: admin / oauth / internal entries flip together (legacy-delegate SPY).
// Each surface: matched path under 'new' runs the onion (delegate NOT called);
// under 'legacy' reaches the legacy delegate (called); an unmatched path delegates
// under both. The db-free status is pinned too, so the probe is proven to short
// -circuit pre-Postgres on the onion path.
// ---------------------------------------------------------------------------

describe('dispatch default: the /admin/api entry', () => {
  const matched = () => makeReq({ method: 'GET', url: '/admin/api/overview' });

  it('runs a matched admin route through the onion under the new default (handleAdminApi NOT called)', async () => {
    main.resetApiDispatchModeForTests();
    const cap = await captureResponse(drive, matched());
    expect(cap.status).toBe(401); // requireAdmin, db-free
    expect(handleAdminApi).not.toHaveBeenCalled();
  });

  it('reaches handleAdminApi (the legacy delegate) under API_DISPATCH=legacy', async () => {
    main.setApiDispatchModeForTests('legacy');
    const cap = await captureResponse(drive, matched());
    expect(cap.status).toBe(401);
    expect(handleAdminApi).toHaveBeenCalledTimes(1);
  });

  it('delegates an unmatched admin path to handleAdminApi even under the new default', async () => {
    main.resetApiDispatchModeForTests();
    await captureResponse(
      drive,
      makeReq({ method: 'GET', url: '/admin/api/this-endpoint-does-not-exist' }),
    );
    expect(handleAdminApi).toHaveBeenCalledTimes(1);
  });
});

describe('dispatch default: the /oauth entry', () => {
  const matched = () => makeReq({ method: 'POST', url: '/oauth/token', body: {} });

  it('runs a matched oauth route through the onion under the new default (handleOAuth NOT called)', async () => {
    main.resetApiDispatchModeForTests();
    const cap = await captureResponse(drive, matched());
    expect(cap.status).toBe(400); // unsupported_grant_type, db-free
    expect(handleOAuth).not.toHaveBeenCalled();
  });

  it('reaches handleOAuth (the legacy delegate) under API_DISPATCH=legacy', async () => {
    main.setApiDispatchModeForTests('legacy');
    const cap = await captureResponse(drive, matched());
    expect(cap.status).toBe(400);
    expect(handleOAuth).toHaveBeenCalledTimes(1);
  });

  it('delegates an unmatched oauth path to handleOAuth even under the new default', async () => {
    main.resetApiDispatchModeForTests();
    await captureResponse(
      drive,
      makeReq({ method: 'GET', url: '/oauth/this-endpoint-does-not-exist' }),
    );
    expect(handleOAuth).toHaveBeenCalledTimes(1);
  });
});

describe('dispatch default: the /internal entry (the daily-rewards + handleInternalApi composite)', () => {
  const matched = () => makeReq({ method: 'POST', url: '/internal/restart-countdown', body: {} });

  it('runs a matched internal route through the onion under the new default (composite NOT called)', async () => {
    await withInternalSecretsUnset(async () => {
      main.resetApiDispatchModeForTests();
      const cap = await captureResponse(drive, matched());
      expect(cap.status).toBe(404); // feature-off gate, db-free
      expect(handleInternalApi).not.toHaveBeenCalled();
      expect(handleDailyRewardInternalApi).not.toHaveBeenCalled();
    });
  });

  it('reaches the legacy composite (handleInternalApi) under API_DISPATCH=legacy', async () => {
    await withInternalSecretsUnset(async () => {
      main.setApiDispatchModeForTests('legacy');
      const cap = await captureResponse(drive, matched());
      expect(cap.status).toBe(404);
      // The composite tries handleDailyRewardInternalApi first (declines for a
      // non-daily-rewards path), then handleInternalApi answers the feature-off 404.
      expect(handleDailyRewardInternalApi).toHaveBeenCalledTimes(1);
      expect(handleInternalApi).toHaveBeenCalledTimes(1);
    });
  });

  it('delegates an unmatched internal path to the legacy composite even under the new default', async () => {
    await withInternalSecretsUnset(async () => {
      main.resetApiDispatchModeForTests();
      await captureResponse(
        drive,
        makeReq({ method: 'GET', url: '/internal/this-endpoint-does-not-exist' }),
      );
      expect(handleInternalApi).toHaveBeenCalledTimes(1);
    });
  });
});
