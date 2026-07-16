// Characterization goldens for the admin, oauth, and internal HTTP dispatchers
// (Agent C). Every case drives a REAL request through
// routeHttpRequest (server/main.ts) and freezes the response (status, headers,
// body) the server emits TODAY into a golden fixture. These are characterization
// snapshots, not assertions of desired behavior: they record the contract that
// exists so the pipeline re-architecture can prove byte-for-byte parity.
//
// Scope (Agent C): /admin/api/*, /oauth/*, /internal/* ONLY. The /api/* main
// surface is Agent B's; the surface-inventory ledger is Agent A's.
//
// What is captured: only the DETERMINISTIC contract paths that return BEFORE the
// database. The test DATABASE_URL points at a non-existent Postgres, so any
// handler arm that reaches pool.query throws; a throw becomes either a poller
// timeout (internal, which has no try/catch) or a generic 500 (admin/oauth,
// which wrap their bodies in try/catch). Neither is the route contract, so those
// db-backed success paths are deferred (see the header comment block at the
// bottom of this file for the full deferral ledger).
//
// Determinism: the captured bodies here carry no dynamic fields (auth-denied
// envelopes, RFC 6749 error objects, a static consent-error HTML page), so the
// default harness normalizer is a pass-through for them. The token-bearing oauth
// SUCCESS paths (device_authorization, authorize, the token endpoint) are
// deferred because their snake_case dynamic fields are unmasked and the device
// HTML page embeds a pre-existing em dash; see the deferral ledger.

import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Dispatch, goldenMaster, makeReq } from '../helpers/index';
import { goldenContentTypeMismatch } from './content_type_consistency';

// db.ts reads DATABASE_URL at module scope (throws if unset); a dummy URL lets
// the bare server/main import resolve. The pool is constructed but never
// connects, so every contract path captured here returns before touching it.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_phase3_aoi';

// routeHttpRequest is synchronous fire-and-forget (void handleX(req, res)), so we
// poll res.writableEnded before reading the captured response.
const MAX_TICKS = 5000;

async function loadDispatch(): Promise<Dispatch> {
  const main = await import('../../../server/main');
  return async (req, res) => {
    main.routeHttpRequest(req, res);
    let ticks = 0;
    while (!(res as unknown as { writableEnded: boolean }).writableEnded) {
      if (ticks++ > MAX_TICKS) throw new Error('response never ended');
      await new Promise((r) => setImmediate(r));
    }
  };
}

// Fixture-path roots, one per dispatcher (no scattered path literals).
const FIXTURE_SUBDIR = {
  admin: 'admin',
  oauth: 'oauth',
  internal: 'internal',
} as const;

function fixture(subdir: string, name: string): string {
  return join(__dirname, '..', 'fixtures', subdir, `${name}.json`);
}

// One golden per case, plus the content-type consistency cross-check (the captured
// golden's content-type must match its route's classified class). Replaces the
// repeated goldenMaster + expect boilerplate at every call site below.
async function characterize(
  subdir: string,
  name: string,
  req: ReturnType<typeof makeReq>,
): Promise<void> {
  const fixturePath = fixture(subdir, name);
  const r = await goldenMaster({ dispatch, req, fixturePath });
  expect(r.status, r.status === 'mismatch' ? `${name}\n${r.actual}` : name).not.toBe('mismatch');
  const ctMismatch = goldenContentTypeMismatch(req.method ?? 'GET', req.url ?? '', fixturePath);
  expect(ctMismatch, ctMismatch ?? name).toBeNull();
}

// The two shared-secret gate env vars (named so the secret-gate contract is not
// a wall of inline literals). The matching request headers (x-woc-deploy-secret,
// x-woc-discord-secret) are deliberately OMITTED from every request below: the
// not-authenticated contract is exactly the absent-header path.
const SECRET_ENV = {
  restartCountdown: 'RESTART_COUNTDOWN_SECRET',
  discordBot: 'DISCORD_BOT_SECRET',
  dailyReward: 'WOC_DAILY_REWARD_SERVICE_SECRET',
} as const;
// The daily-reward gate's request header (presented only by the two gate-pass
// cases below; every reject case omits it, like the other two gates).
const DAILY_REWARD_HEADER = 'x-woc-daily-reward-secret';
// A non-empty value to turn a secret-gated feature ON without presenting the
// matching request secret, so the gate answers 401 (not 404 feature-off). The
// value never reaches the wire, so its content is irrelevant.
const GATE_ENABLED_VALUE = 'phase3-characterization-secret';

let dispatch: Dispatch;
let main: typeof import('../../../server/main');
beforeAll(async () => {
  main = await import('../../../server/main');
  // These goldens characterize the LEGACY admin/oauth/internal ladders. The boot
  // default flipped to 'new', so pin the dispatch mode to 'legacy'
  // EXPLICITLY: the captured contracts are the legacy delegate shapes, and pinning
  // the mode keeps this the legacy characterization it has always been, immune to
  // the default flip.
  main.setApiDispatchModeForTests('legacy');
  dispatch = await loadDispatch();
});

// Run `fn` with `key` temporarily forced to `value` (or deleted when undefined),
// restoring the prior value afterward. The internal gate paths read process.env
// at request time and return synchronously before any await, so a set-run-restore
// around one awaited goldenMaster call is race-free.
async function withEnv(
  key: string,
  value: string | undefined,
  fn: () => Promise<void>,
): Promise<void> {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

// -----------------------------------------------------------------------------
// admin handleAdminApi (/admin/api/*): envelope { success, data, error }
// -----------------------------------------------------------------------------
describe('characterization: admin handleAdminApi', () => {
  // POST /admin/api/login with a body that carries no username: handleLogin
  // short-circuits at the validation branch (typeof body.username !== 'string')
  // and answers 401 BEFORE findAccount touches the db. This is the deterministic
  // auth-denied contract; the 403 "no admin access" path needs a real account
  // lookup (db) and is deferred.
  it('POST /admin/api/login (empty body) -> 401 invalid credentials, before db', async () => {
    await characterize(
      FIXTURE_SUBDIR.admin,
      'login_empty_body_401',
      makeReq({ method: 'POST', url: '/admin/api/login', body: {} }),
    );
  });

  // The admin auth gate (adminAccountId) runs BEFORE any route match and returns
  // null for a missing/invalid bearer without a db call, so every non-login admin
  // route answers the same 401 envelope when unauthenticated. We freeze the gate
  // contract across a representative spread of the GET read surface.
  for (const path of ['/admin/api/overview', '/admin/api/online', '/admin/api/accounts']) {
    const name = `${path.split('/').pop()}_no_auth_401`;
    it(`GET ${path} (no bearer) -> 401 admin authentication required`, async () => {
      await characterize(FIXTURE_SUBDIR.admin, name, makeReq({ method: 'GET', url: path }));
    });
  }

  // A non-GET real admin route with no bearer: the auth gate precedes the method
  // and route match, so a write route is gated identically to the reads.
  it('POST /admin/api/blocked-ips (no bearer) -> 401 (auth precedes method/route)', async () => {
    await characterize(
      FIXTURE_SUBDIR.admin,
      'blocked_ips_post_no_auth_401',
      makeReq({ method: 'POST', url: '/admin/api/blocked-ips', body: {} }),
    );
  });

  // An unmatched admin path with no bearer answers 401, NOT the 404
  // "unknown admin endpoint" fallthrough: the auth gate runs before routing, so
  // the 404 is unreachable without admin auth. We characterize what actually
  // happens (the 401) and document the ordering here.
  it('GET /admin/api/<unknown> (no bearer) -> 401 (auth precedes the 404 fallthrough)', async () => {
    await characterize(
      FIXTURE_SUBDIR.admin,
      'unknown_endpoint_no_auth_401',
      makeReq({ method: 'GET', url: '/admin/api/this-endpoint-does-not-exist' }),
    );
  });
});

// -----------------------------------------------------------------------------
// oauth handleOAuth (/oauth/*): POST arms emit RFC 6749 { error, ... };
// GET pages emit text/html.
// -----------------------------------------------------------------------------
describe('characterization: oauth handleOAuth', () => {
  // GET /oauth/authorize with no client_id: clientId is falsy, so getOAuthClient
  // is never called and renderAuthorize answers a 400 htmlError consent page
  // BEFORE the db. The page is fully static (no dynamic fields, no em dash).
  it('GET /oauth/authorize (no client_id) -> 400 html "Unknown application"', async () => {
    await characterize(
      FIXTURE_SUBDIR.oauth,
      'authorize_get_no_client_400_html',
      makeReq({ method: 'GET', url: '/oauth/authorize' }),
    );
  });

  // POST /oauth/token with an unsupported grant_type: tokenEndpoint dispatches on
  // grant_type and returns 400 unsupported_grant_type before any db lookup.
  it('POST /oauth/token (unsupported grant_type) -> 400 unsupported_grant_type', async () => {
    await characterize(
      FIXTURE_SUBDIR.oauth,
      'token_unsupported_grant_400',
      makeReq({
        method: 'POST',
        url: '/oauth/token',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
      }),
    );
  });

  // POST /oauth/revoke with no token: revokeEndpoint skips revokeReadToken (the
  // only db call) for an empty token and always answers 200 { ok: true }
  // (RFC 7009 section 2.2). Deterministic, before db.
  it('POST /oauth/revoke (no token) -> 200 { ok: true }, db skipped', async () => {
    await characterize(
      FIXTURE_SUBDIR.oauth,
      'revoke_no_token_200',
      makeReq({ method: 'POST', url: '/oauth/revoke' }),
    );
  });

  // POST /oauth/device_authorization with no client_id: the client lookup is
  // guarded by a truthy clientId, so an empty client_id answers 400 invalid_client
  // before the db. (The SUCCESS path mints snake_case device_code/user_code/
  // verification_uri fields that are dynamic and unmasked, so it is deferred.)
  it('POST /oauth/device_authorization (no client_id) -> 400 invalid_client', async () => {
    await characterize(
      FIXTURE_SUBDIR.oauth,
      'device_authorization_no_client_400',
      makeReq({ method: 'POST', url: '/oauth/device_authorization' }),
    );
  });

  // POST /oauth/authorize with no session: fullSessionAccount returns null for a
  // missing/invalid bearer (the regex fails before any db call), so the consent
  // approval answers 401 access_denied. (The SUCCESS path embeds a dynamic auth
  // code + state in a redirect query string, so it is deferred.)
  it('POST /oauth/authorize (no session) -> 401 access_denied', async () => {
    await characterize(
      FIXTURE_SUBDIR.oauth,
      'authorize_post_no_session_401',
      makeReq({ method: 'POST', url: '/oauth/authorize' }),
    );
  });

  // POST /oauth/device with no session: approveDevice answers 401 access_denied
  // before the db, same gate as approveAuthorize.
  it('POST /oauth/device (no session) -> 401 access_denied', async () => {
    await characterize(
      FIXTURE_SUBDIR.oauth,
      'device_post_no_session_401',
      makeReq({ method: 'POST', url: '/oauth/device' }),
    );
  });

  // An unknown /oauth path falls through every arm to the 404 not_found tail.
  it('GET /oauth/<unknown> -> 404 not_found', async () => {
    await characterize(
      FIXTURE_SUBDIR.oauth,
      'unknown_404',
      makeReq({ method: 'GET', url: '/oauth/no-such-endpoint' }),
    );
  });
});

// -----------------------------------------------------------------------------
// internal handleInternalApi (/internal/*): envelope { success, data, error },
// TWO shared-secret gates. handleInternalApi has NO try/catch, so a gate-PASS
// path that reaches the pool-less db THROWS and the poller times out. We capture
// ONLY the gate-CONTRACT paths (feature-off 404, not-authenticated 401, method
// 404, unknown 404), every one of which returns before the db.
// -----------------------------------------------------------------------------
describe('characterization: internal handleInternalApi', () => {
  // RESTART_COUNTDOWN_SECRET unset -> the restart-countdown feature is off and the
  // route answers 404 unknown endpoint (forced unset for determinism).
  it('POST /internal/restart-countdown (secret unset) -> 404 unknown endpoint', async () => {
    await withEnv(SECRET_ENV.restartCountdown, undefined, async () => {
      await characterize(
        FIXTURE_SUBDIR.internal,
        'restart_countdown_secret_unset_404',
        makeReq({ method: 'POST', url: '/internal/restart-countdown' }),
      );
    });
  });

  // The method check (non-POST -> 404) runs before the secret read, so a GET
  // answers 404 regardless of the env. Captured with the secret unset.
  it('GET /internal/restart-countdown (non-POST) -> 404 unknown endpoint', async () => {
    await withEnv(SECRET_ENV.restartCountdown, undefined, async () => {
      await characterize(
        FIXTURE_SUBDIR.internal,
        'restart_countdown_get_404',
        makeReq({ method: 'GET', url: '/internal/restart-countdown' }),
      );
    });
  });

  // RESTART_COUNTDOWN_SECRET set but the x-woc-deploy-secret request header is
  // absent: the timing-safe compare fails and the route answers 401 not
  // authenticated, before startRestartCountdown / the db.
  it('POST /internal/restart-countdown (secret set, no header) -> 401 not authenticated', async () => {
    await withEnv(SECRET_ENV.restartCountdown, GATE_ENABLED_VALUE, async () => {
      await characterize(
        FIXTURE_SUBDIR.internal,
        'restart_countdown_wrong_secret_401',
        makeReq({ method: 'POST', url: '/internal/restart-countdown' }),
      );
    });
  });

  // The ten /internal/discord/* routes and the method each is documented under.
  // The DISCORD_BOT_SECRET gate in handleDiscordInternal runs BEFORE any route or
  // method branch, so the 401 (and the 404 feature-off) contract is identical for
  // all ten; we capture each route so the security gate is documented per route.
  // (The two daily-rewards-winners routes postdate the original characterization
  // capture; their goldens were backfilled under the same shared-gate rationale.)
  const DISCORD_ROUTES = [
    { method: 'GET', path: '/internal/discord/flex', name: 'discord_flex' },
    { method: 'GET', path: '/internal/discord/roles', name: 'discord_roles' },
    { method: 'POST', path: '/internal/discord/presence', name: 'discord_presence' },
    { method: 'POST', path: '/internal/discord/grant', name: 'discord_grant' },
    { method: 'POST', path: '/internal/discord/member', name: 'discord_member' },
    { method: 'GET', path: '/internal/discord/relay', name: 'discord_relay' },
    { method: 'GET', path: '/internal/discord/activity', name: 'discord_activity' },
    { method: 'POST', path: '/internal/discord/members-meta', name: 'discord_members_meta' },
    {
      method: 'GET',
      path: '/internal/discord/daily-rewards-winners',
      name: 'discord_daily_rewards_winners',
    },
    {
      method: 'POST',
      path: '/internal/discord/daily-rewards-winners/mark',
      name: 'discord_daily_rewards_winners_mark',
    },
  ] as const;

  // Feature-off gate, captured PER ROUTE: with DISCORD_BOT_SECRET unset, the whole
  // /internal/discord/* surface answers 404 unknown endpoint at the shared gate.
  // Looping all ten (mirroring the 401 loop below) freezes each route's feature-off
  // baseline, so a later change that moves any one off the shared gate is caught.
  for (const route of DISCORD_ROUTES) {
    it(`${route.method} ${route.path} (bot secret unset) -> 404 unknown endpoint`, async () => {
      await withEnv(SECRET_ENV.discordBot, undefined, async () => {
        await characterize(
          FIXTURE_SUBDIR.internal,
          `${route.name}_secret_unset_404`,
          makeReq({ method: route.method, url: route.path }),
        );
      });
    });
  }

  // 401 not-authenticated gate for each of the ten routes: DISCORD_BOT_SECRET
  // set, the x-woc-discord-secret request header absent. The gate precedes the db.
  for (const route of DISCORD_ROUTES) {
    it(`${route.method} ${route.path} (bot secret set, no header) -> 401 not authenticated`, async () => {
      await withEnv(SECRET_ENV.discordBot, GATE_ENABLED_VALUE, async () => {
        await characterize(
          FIXTURE_SUBDIR.internal,
          `${route.name}_no_secret_401`,
          makeReq({ method: route.method, url: route.path }),
        );
      });
    });
  }

  // An unknown /internal path (neither restart-countdown nor /internal/discord/)
  // falls through to the 404 unknown endpoint tail, independent of either secret.
  it('GET /internal/<unknown> -> 404 unknown endpoint', async () => {
    await characterize(
      FIXTURE_SUBDIR.internal,
      'unknown_endpoint_404',
      makeReq({ method: 'GET', url: '/internal/no-such-op' }),
    );
  });
});

// -----------------------------------------------------------------------------
// internal handleDailyRewardInternalApi (/internal/daily-rewards/*): the
// late-arrival backfill (the family arrived with the v0.19.0 merge, after
// the original characterization capture, so its legacy contract is frozen here
// write-if-absent before the default flipped to 'new'). The x-woc-daily-reward-secret gate FAILS
// CLOSED, unlike the two gates above: an unset env secret answers 401 not
// authenticated (never the feature-off 404), and there is no
// RESTART_COUNTDOWN_SECRET fallback. The gate spans the whole prefix BEFORE
// path/method resolution.
// -----------------------------------------------------------------------------
describe('characterization: internal handleDailyRewardInternalApi (late-arrival backfill)', () => {
  const OPS_ROUTES = [
    { path: '/internal/daily-rewards/pending-payouts', name: 'daily_rewards_pending_payouts' },
    { path: '/internal/daily-rewards/payout-history', name: 'daily_rewards_payout_history' },
    { path: '/internal/daily-rewards/mark-payout', name: 'daily_rewards_mark_payout' },
    { path: '/internal/daily-rewards/void-payout', name: 'daily_rewards_void_payout' },
    { path: '/internal/daily-rewards/restore-payout', name: 'daily_rewards_restore_payout' },
  ] as const;

  // Fail-closed gate, captured PER ROUTE: with the env secret UNSET the family
  // answers 401 not authenticated (the deploy/discord gates would say 404 here).
  for (const route of OPS_ROUTES) {
    it(`POST ${route.path} (secret unset) -> fail-closed 401 not authenticated`, async () => {
      await withEnv(SECRET_ENV.dailyReward, undefined, async () => {
        await characterize(
          FIXTURE_SUBDIR.internal,
          `${route.name}_secret_unset_401`,
          makeReq({ method: 'POST', url: route.path }),
        );
      });
    });
  }

  // 401 with the env secret SET and the request header absent (same body as the
  // unset case: the fail-closed gate is 401 on both reject paths).
  for (const route of OPS_ROUTES) {
    it(`POST ${route.path} (secret set, no header) -> 401 not authenticated`, async () => {
      await withEnv(SECRET_ENV.dailyReward, GATE_ENABLED_VALUE, async () => {
        await characterize(
          FIXTURE_SUBDIR.internal,
          `${route.name}_no_secret_401`,
          makeReq({ method: 'POST', url: route.path }),
        );
      });
    });
  }

  // Two GATE-PASS contract points that stay db-free:
  // a wrong method resolves inside the family (gate first, then no branch
  // matches) to the in-family 404 unknown endpoint, never a 405;
  it('GET /internal/daily-rewards/pending-payouts (correct secret) -> in-family 404 unknown endpoint', async () => {
    await withEnv(SECRET_ENV.dailyReward, GATE_ENABLED_VALUE, async () => {
      await characterize(
        FIXTURE_SUBDIR.internal,
        'daily_rewards_pending_payouts_get_404',
        makeReq({
          method: 'GET',
          url: '/internal/daily-rewards/pending-payouts',
          headers: { [DAILY_REWARD_HEADER]: GATE_ENABLED_VALUE },
        }),
      );
    });
  });

  // and mark-payout validates its payout target BEFORE the first query, so the
  // empty-body 400 freezes the handler's validation prose through the real gate.
  it('POST /internal/daily-rewards/mark-payout (correct secret, empty body) -> 400 invalid payout target', async () => {
    await withEnv(SECRET_ENV.dailyReward, GATE_ENABLED_VALUE, async () => {
      await characterize(
        FIXTURE_SUBDIR.internal,
        'daily_rewards_mark_payout_empty_400',
        makeReq({
          method: 'POST',
          url: '/internal/daily-rewards/mark-payout',
          headers: { [DAILY_REWARD_HEADER]: GATE_ENABLED_VALUE },
          body: {},
        }),
      );
    });
  });
});

// Every withEnv call restores its own var in a finally, so nothing leaks between
// cases; afterAll only restores the dispatch mode this file pinned to 'legacy'.
afterAll(() => {
  main.resetApiDispatchModeForTests();
});

// -----------------------------------------------------------------------------
// DEFERRAL LEDGER (paths NOT captured here, and why) -- surfaced, not applied:
//
//  - GET /oauth/device (200 text/html, renderDevicePage): originally deferred
//    because the SOURCE HTML embedded an em dash (server/oauth.ts renderDevicePage
//    inline script) that the verbatim HTML normalizer would have carried into a
//    .json fixture, violating the repo copy rule. That source line has since been
//    fixed ("Device approved. You can return to your device."), so the golden is
//    now capturable; it remains uncaptured, a deliberate scope call left to the
//    ladder-deletion PR's corpus decisions.
//  - POST /oauth/device_authorization SUCCESS: snake_case device_code / user_code
//    / verification_uri / verification_uri_complete are dynamic and UNMASKED by
//    the key-name normalizer; non-deterministic until a normalizer
//    enhancement masks them. Deferred.
//  - POST /oauth/authorize SUCCESS ({ redirect }): the redirect embeds a dynamic
//    auth code + state in a query string, unmasked. Deferred.
//  - POST /oauth/token SUCCESS (authorization_code / device_code grants): mints an
//    access_token via the db and returns dynamic token fields; db-backed and
//    token-dynamic. Deferred.
//  - POST /admin/api/login 403 ("no admin access") and the authenticated admin
//    GET reads (overview/online/accounts/...): all require a real account/admin
//    lookup against the db; pool-less here. Deferred (needs a mocked db).
//  - Every /internal secret-PASS path (correct x-woc-deploy-secret /
//    x-woc-discord-secret): reaches the pool-less db and (no try/catch) hangs the
//    poller. Never captured; the gate-contract paths above are the safe surface.
// -----------------------------------------------------------------------------
