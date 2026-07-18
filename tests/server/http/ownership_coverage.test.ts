// Registry-wide DENY-BY-DEFAULT functional coverage gate for the BOLA
// requireOwned seam.
//
// tests/server/http/completeness.test.ts already asserts the METADATA marker:
// checkRequireOwnedCoverage([...apiRoutes]) is empty, so every account-owned :id
// route DECLARES meta.requireOwned { ownerScope: 'account' }. That is a static
// promise about the route table, not about what the route actually DOES.
//
// This file adds the functional guarantee the metadata cannot give: that every
// account-owned :id route in the registry actually MOUNTS an account-scoped owner
// loader that DENIES a non-owned / absent id with a 404 (deny-by-default), before
// the handler's success body is ever produced. It is the load-bearing BOLA
// coverage test the packet leans on: a route that carried the marker but forgot to
// mount requireOwnedCharacter would ship a cross-account read hole that the
// metadata check waves through; this sweep turns that into a red test.
//
// How it works: the account db seam is driven with a fake whose getCharacter
// ALWAYS returns null (the deny path: no owned row for the caller), the auth guard
// is satisfied with a valid full-scope bearer, and each route's real middleware
// chain is run via compose(). A route with the loader mounted answers the player-
// owned 404 and never reaches its handler; a route missing the loader would fall
// through to its 200 handler, which the negative control proves the sweep detects.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AdminRuntime,
  configureAdminRuntime,
  resetAdminDbForTests,
  resetAdminRuntimeForTests,
  setAdminDbForTests,
} from '../../../server/admin';
import {
  type CharactersRuntime,
  configureCharactersRuntime,
  resetCharactersDbForTests,
  resetCharactersRuntimeForTests,
  setCharactersDbForTests,
} from '../../../server/characters';
import { compose } from '../../../server/http/compose';
import { logger } from '../../../server/http/logger';
import { ADMIN_AUTH_REQUIRED } from '../../../server/http/middleware/require_admin';
import {
  DAILY_REWARD_SECRET_ENV,
  DAILY_REWARD_SECRET_HEADER,
  DEPLOY_SECRET_ENV,
  DEPLOY_SECRET_HEADER,
  DISCORD_SECRET_ENV,
  DISCORD_SECRET_HEADER,
} from '../../../server/http/middleware/require_internal_secret';
import { withErrors } from '../../../server/http/middleware/with_errors';
import { apiRoutes } from '../../../server/http/registry';
import type { Ctx, Middleware, RouteDef } from '../../../server/http/types';
import { json } from '../../../server/http_util';
import {
  configureInternalRuntime,
  type InternalRuntime,
  resetInternalRuntimeForTests,
} from '../../../server/internal';
import {
  resetMapsGuardDbForTests,
  resetMapsServiceForTests,
  setMapsGuardDbForTests,
  setMapsServiceForTests,
} from '../../../server/maps_routes';
import { resetRateLimits } from '../../../server/ratelimit';
import {
  resetUserAssetsGuardDbForTests,
  resetUserAssetsServiceForTests,
  setUserAssetsGuardDbForTests,
  setUserAssetsServiceForTests,
} from '../../../server/user_assets_routes';
import { fakeCtx } from '../helpers/fake_ctx';
import type { FakeRes } from '../helpers/fake_http';

// A well-formed 64-hex bearer so the character guards' BEARER_PATTERN matches and
// the (stubbed) accountAndScopeForToken lookup is reached.
const VALID_TOKEN = 'a'.repeat(64);
// The authenticated caller the auth guards resolve the bearer to.
const CALLER_ACCOUNT_ID = 7;
// A valid positive :id, so requireOwned's num({ int, min: 1 }) decode passes and
// the account-scoped loader (which then misses) is actually exercised.
const REQUESTED_ID = '5';

// An unlocked, unmoderated account: the character auth guards read only .locked
// (and .message on a lock), so this passes the moderation gate for every caller.
const NOT_LOCKED = {
  locked: false,
  banned: false,
  suspendedUntil: null,
  reason: '',
  message: '',
  chatMutedUntil: null,
  chatStrikes: 0,
};

// The account-owned :id routes the sweep covers: every registry route whose
// meta.requireOwned is account-scoped. The character :id subroutes
// (standing, sheet, rename, takeover, delete) are the only ones today.
const accountOwnedRoutes: RouteDef[] = apiRoutes.filter(
  (route) => route.meta?.requireOwned?.ownerScope === 'account',
);

// Substitute each :param segment with a concrete sample so ctx.path/url read as a
// real request path. Load-bearing for the admin sweep: requireAdmin's central
// permission gate resolves the route permission from the CONCRETE url pathname
// (admin_routes.ts patterns), so :id must be numeric and :action a real enum
// member, or the gate fail-closed-404s before the middleware under test runs.
function concretePath(path: string): string {
  return path
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment;
      return segment === ':action' ? 'suspend' : REQUESTED_ID;
    })
    .join('/');
}

// Install the denying character db seam: the bearer resolves to a full-scope
// account, the moderation gate passes, and getCharacter ALWAYS misses (the
// deny-by-default path the loader must answer with a 404). lifetimeXpStanding is
// stubbed to null too, so even if a route somehow skipped the loader its handler
// would not touch Postgres.
function installDenyingCharacterDb(): void {
  setCharactersDbForTests({
    accountAndScopeForToken: async () => ({ accountId: CALLER_ACCOUNT_ID, scope: 'full' as const }),
    moderationStatusForAccount: async () => NOT_LOCKED,
    getCharacter: async () => null,
    lifetimeXpStanding: async () => null,
  });
}

// Install the maps + user-assets deny environment: the bearer guards resolve the
// valid token to the caller, and the services' owner loaders always MISS (the
// fake getMapForViewer returns null; the fake listMine returns no rows), so every
// account-owned :id route in the two v0.20.0 families exercises its deny path.
function installDenyingMapsAndAssets(): void {
  const guardOverrides = {
    accountAndScopeForToken: async () => ({ accountId: CALLER_ACCOUNT_ID, scope: 'full' as const }),
    moderationStatusForAccount: async () => NOT_LOCKED,
  };
  setMapsGuardDbForTests(guardOverrides);
  setUserAssetsGuardDbForTests(guardOverrides);
  setMapsServiceForTests({
    getMapForViewer: async () => null,
  } as unknown as import('../../../server/maps').MapsService);
  setUserAssetsServiceForTests({
    listMine: async () => [],
  } as unknown as import('../../../server/user_assets').UserAssetsService);
}

// Install a fully stubbed runtime so a handler that DID run (the negative control,
// or a regression where the loader is missing) cannot crash on an unconfigured
// runtime. The deny sweep never reaches these; they exist so the failure mode of a
// missing loader is a clean 200, not an unrelated throw.
function installFakeRuntime(): void {
  const runtime: CharactersRuntime = {
    isCharacterOnline: vi.fn(() => false),
    takeOverCharacter: vi.fn(async () => 'not-online' as const),
    rekeyMarketSeller: vi.fn(() => false),
    saveMarket: vi.fn(async () => {}),
    rekeyMailOwner: vi.fn(() => false),
    saveMail: vi.fn(async () => {}),
    // The fresh-character state is never serialized on the deny path; a bare object
    // is enough to satisfy the type for any handler that does run (negative control).
    initialCharacterState: vi.fn(
      () => ({}) as ReturnType<CharactersRuntime['initialCharacterState']>,
    ),
    publicOrigin: vi.fn(() => 'http://localhost'),
  };
  configureCharactersRuntime(runtime);
}

// Build an AUTHED ctx for a route: valid bearer, the route's method, a concrete
// path, and params.id set to a valid numeric id (the router is bypassed, so params
// are supplied directly).
function authedCtx(route: RouteDef): Ctx {
  return fakeCtx({
    method: route.method,
    url: concretePath(route.path),
    headers: { authorization: `Bearer ${VALID_TOKEN}` },
    params: { id: REQUESTED_ID },
  });
}

/** Read the FakeRes backing a fakeCtx so we can assert on the captured result. */
function resOf(ctx: Ctx): FakeRes {
  return ctx.res as unknown as FakeRes;
}

// Run a route's full middleware chain plus a spy-wrapped handler as the terminal
// onion frame, returning the FakeRes and the handler spy. The spy proves whether
// the handler's success body was ever produced.
async function runRoute(
  route: RouteDef,
  ctx: Ctx,
): Promise<{ res: FakeRes; handler: ReturnType<typeof vi.fn> }> {
  const handler = vi.fn(async (c: Ctx) => {
    await route.handler(c);
  });
  const stack: Middleware[] = [...(route.middleware ?? []), handler as unknown as Middleware];
  await compose(stack)(ctx);
  return { res: resOf(ctx), handler };
}

describe('ownership coverage: registry-wide deny-by-default sweep', () => {
  beforeEach(() => {
    // Silence the loader's structured bola_denied line (defaultDenyLog, now through
    // the logger) so the sweep does not spam the test output with one warn per
    // denied route.
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    installDenyingCharacterDb();
    installFakeRuntime();
    installDenyingMapsAndAssets();
  });

  afterEach(() => {
    resetCharactersDbForTests();
    resetCharactersRuntimeForTests();
    resetMapsGuardDbForTests();
    resetMapsServiceForTests();
    resetUserAssetsGuardDbForTests();
    resetUserAssetsServiceForTests();
    vi.restoreAllMocks();
  });

  it('selects a non-vacuous set of account-owned :id routes (at least the five character subroutes)', () => {
    expect(accountOwnedRoutes.length).toBeGreaterThanOrEqual(5);
  });

  for (const route of accountOwnedRoutes) {
    it(`denies a non-owned id on ${route.method} ${route.path} with a 404 and never runs the handler`, async () => {
      const ctx = authedCtx(route);
      const { res, handler } = await runRoute(route, ctx);

      // The account-scoped loader missed (getCharacter returned null), so the route
      // answers the player-owned anti-enumeration 404. This can only happen if the
      // loader is actually mounted in the chain: proof of deny-by-default.
      expect(res.statusCode).toBe(404);
      // The handler-owned success body is NEVER produced: the loader short-circuits
      // (no next()), so control never reaches the terminal handler frame.
      expect(handler).not.toHaveBeenCalled();
      // The denial carries a legacy player-owned body (exact text differs per
      // route family: the character prose bodies, or the maps/assets snake_case
      // codes), never a success payload.
      expect(JSON.parse(res.body).error).toMatch(
        /^(character not found|not found|map_not_found|asset_not_found)$/,
      );
    });
  }

  it('negative control: an account-owned route MISSING the loader answers 200, so the sweep is non-vacuous', async () => {
    // A synthetic RouteDef that DECLARES account ownership (so the sweep's predicate
    // would select it) but whose middleware is only an auth-passing stub: the owner
    // loader is deliberately absent. Kept LOCAL to the test (never added to
    // apiRoutes). Under the exact same denying environment as the real routes, its
    // handler runs and writes 200, proving the sweep's 404 assertion actually
    // detects the loader's presence and would FAIL for a route that forgot to mount
    // requireOwnedCharacter.
    const authStub: Middleware = async (ctx, next) => {
      ctx.account = { accountId: CALLER_ACCOUNT_ID, scope: 'full' };
      await next();
    };
    const missingLoaderRoute: RouteDef = {
      method: 'GET',
      path: '/api/characters/:id/synthetic-no-loader',
      surface: 'api',
      middleware: [authStub],
      handler: async (ctx) => {
        json(ctx.res, 200, { ok: true });
      },
      meta: { requireOwned: { kind: 'character', ownerScope: 'account' } },
    };
    // It matches the same predicate the sweep selects on.
    expect(missingLoaderRoute.meta?.requireOwned?.ownerScope).toBe('account');

    const ctx = authedCtx(missingLoaderRoute);
    const { res, handler } = await runRoute(missingLoaderRoute, ctx);

    expect(res.statusCode).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    // A route without the loader does NOT produce the deny 404 the sweep asserts,
    // which is exactly why the sweep would go red for such a route.
    expect(res.statusCode).not.toBe(404);
  });
});

// -------------------------------------------------------------------------
// Operator-scope deny-by-default sweep.
//
// The admin migration introduced the operator surface, so the forward guard that once
// asserted "no operator route exists" is replaced by a real sweep. The operator
// :id routes (server/admin.ts) authorize NO cross-scope object (an admin has
// universal authority over every target), so unlike the account loader they emit no
// per-object 403/404 denial: the handlers keep their own legacy resource-not-found
// 404. The deny-by-default guarantee for operator routes is therefore twofold and
// this sweep proves BOTH are mounted on EVERY operator :id route:
//   1. requireAdmin: a non-admin bearer is refused with the legacy 401 admin body
//      BEFORE the handler runs (so an operator route can never serve a non-admin);
//   2. requireAdminTarget: a non-numeric :id is rejected with a 422 (admin envelope)
//      before any DB call (so a NaN id can never reach a query).
// A route that forgot either guard is caught: the negative controls prove both
// assertions are non-vacuous.
// -------------------------------------------------------------------------

// The operator-scoped :id routes the sweep covers: every registry route whose
// meta.requireOwned is operator-scoped (the admin :id family).
const operatorOwnedRoutes: RouteDef[] = apiRoutes.filter(
  (route) => route.meta?.requireOwned?.ownerScope === 'operator',
);

// A real account id the non-admin fake resolves the bearer to (is_admin = false).
const NON_ADMIN_ACCOUNT_ID = 999;

// The admin envelope validation.failed body serializeAdmin writes for a 422.
const ADMIN_VALIDATION_FAILED = { success: false, data: null, error: 'validation.failed' };

// Install the admin db seam so requireAdmin resolves the bearer to a NON-staff
// account: the token is valid, the account exists, but it carries no staff roles,
// so the gate's fail-closed staff check is the one that must refuse it.
function installNonAdminDb(): void {
  setAdminDbForTests({
    accountForToken: async () => NON_ADMIN_ACCOUNT_ID,
    adminRolesForAccount: async () => null,
  });
}

// Install the admin db seam so requireAdmin PASSES (superadmin holds every route
// permission), so the sweep can reach requireAdminTarget's :id decode with a valid
// operator identity.
function installAdminDb(): void {
  setAdminDbForTests({
    accountForToken: async () => CALLER_ACCOUNT_ID,
    adminRolesForAccount: async () => ({ username: 'op', roles: ['superadmin'] }),
  });
}

// Run a route's chain UNDER withErrors (surface 'admin'), so requireAdminTarget's
// thrown decode failure maps to the 422 admin envelope exactly as the real
// dispatcher onion does. Returns the FakeRes and the handler spy.
async function runRouteWithErrors(
  route: RouteDef,
  ctx: Ctx,
): Promise<{ res: FakeRes; handler: ReturnType<typeof vi.fn> }> {
  const handler = vi.fn(async (c: Ctx) => {
    await route.handler(c);
  });
  const stack: Middleware[] = [
    withErrors({ surface: route.meta?.envelope }),
    ...(route.middleware ?? []),
    handler as unknown as Middleware,
  ];
  await compose(stack)(ctx);
  return { res: resOf(ctx), handler };
}

describe('ownership coverage: operator-scope deny-by-default sweep', () => {
  beforeEach(() => {
    // A stubbed runtime so a handler that unexpectedly ran (a regression) fails on a
    // clean assertion, not an unconfigured-runtime throw. The sweep never reaches it
    // (the guards short-circuit), but the negative control writes 200 without it.
    configureAdminRuntime({} as AdminRuntime);
  });

  afterEach(() => {
    resetAdminDbForTests();
    resetAdminRuntimeForTests();
    vi.restoreAllMocks();
  });

  it('selects a non-vacuous set of operator-scoped :id routes (the admin :id family)', () => {
    expect(operatorOwnedRoutes.length).toBeGreaterThanOrEqual(12);
  });

  it('every operator-scoped route is admin-surface (excluded from the account-owner clause)', () => {
    // checkRequireOwnedCoverage exempts operator + admin-surface :id routes from the
    // missing-loader clause and flags an operator scope on any NON-admin surface. So
    // every operator route must be surface 'admin', or the coverage gate goes red.
    for (const route of operatorOwnedRoutes) {
      expect(route.surface, `${route.method} ${route.path}`).toBe('admin');
    }
    expect(
      apiRoutes.filter(
        (r) => r.meta?.requireOwned?.ownerScope === 'operator' && r.surface !== 'admin',
      ),
    ).toEqual([]);
  });

  for (const route of operatorOwnedRoutes) {
    it(`refuses a non-admin bearer on ${route.method} ${route.path} with a 401 and never runs the handler`, async () => {
      installNonAdminDb();
      const ctx = authedCtx(route);
      const { res, handler } = await runRouteWithErrors(route, ctx);

      // requireAdmin (mounted first) refuses the non-admin with the legacy admin 401
      // body and short-circuits, so the handler's success body is never produced.
      expect(res.statusCode).toBe(401);
      expect(handler).not.toHaveBeenCalled();
      expect(JSON.parse(res.body)).toEqual(ADMIN_AUTH_REQUIRED);
    });

    it(`rejects a non-numeric :id on ${route.method} ${route.path} with a 422 and never runs the handler`, async () => {
      installAdminDb();
      const ctx = fakeCtx({
        method: route.method,
        url: concretePath(route.path),
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        params: { id: 'not-a-number' },
      });
      const { res, handler } = await runRouteWithErrors(route, ctx);

      // requireAdminTarget decodes the :id with num({ int, min: 1 }); a non-numeric id
      // throws the decode failure, which withErrors maps to the 422 admin envelope
      // BEFORE any DB call, so the handler never runs.
      expect(res.statusCode).toBe(422);
      expect(handler).not.toHaveBeenCalled();
      expect(JSON.parse(res.body)).toEqual(ADMIN_VALIDATION_FAILED);
    });
  }

  it('negative control: an operator route MISSING requireAdmin serves a non-admin (200), so the 401 sweep is non-vacuous', async () => {
    installNonAdminDb();
    // A synthetic operator route that DECLARES operator scope (so the sweep would
    // select it) but mounts NO requireAdmin gate. Kept LOCAL to the test (never added
    // to apiRoutes). Under the same non-admin environment its handler runs and writes
    // 200, proving the sweep's 401 assertion actually detects requireAdmin's presence.
    const missingGateRoute: RouteDef = {
      method: 'GET',
      path: '/admin/api/synthetic-no-gate/:id',
      surface: 'admin',
      middleware: [],
      handler: async (ctx) => {
        json(ctx.res, 200, { success: true, data: { ok: true }, error: null });
      },
      meta: { envelope: 'admin', requireOwned: { kind: 'account', ownerScope: 'operator' } },
    };
    expect(missingGateRoute.meta?.requireOwned?.ownerScope).toBe('operator');

    const ctx = authedCtx(missingGateRoute);
    const { res, handler } = await runRouteWithErrors(missingGateRoute, ctx);

    expect(res.statusCode).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.statusCode).not.toBe(401);
  });

  it('negative control: an operator route MISSING requireAdminTarget lets a NaN :id reach the handler, so the 422 sweep is non-vacuous', async () => {
    installAdminDb();
    // A synthetic operator route with an auth-passing stub but NO requireAdminTarget:
    // a non-numeric :id is never decoded, so it reaches the handler (200) instead of a
    // 422, proving the sweep's 422 assertion detects requireAdminTarget's presence.
    const authStub: Middleware = async (ctx, next) => {
      ctx.account = { accountId: CALLER_ACCOUNT_ID, scope: 'full' };
      await next();
    };
    const missingDecodeRoute: RouteDef = {
      method: 'GET',
      path: '/admin/api/synthetic-no-decode/:id',
      surface: 'admin',
      middleware: [authStub],
      handler: async (ctx) => {
        json(ctx.res, 200, { success: true, data: { ok: true }, error: null });
      },
      meta: { envelope: 'admin', requireOwned: { kind: 'account', ownerScope: 'operator' } },
    };
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/synthetic-no-decode/not-a-number',
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      params: { id: 'not-a-number' },
    });
    const { res, handler } = await runRouteWithErrors(missingDecodeRoute, ctx);

    expect(res.statusCode).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.statusCode).not.toBe(422);
  });
});

// -------------------------------------------------------------------------
// Admin auth-mounting sweep.
//
// The operator sweep above proves the guards on the 12 :id routes; this sweep closes
// the REST of the admin surface. Every admin route except the anonymous login must
// mount requireAdmin, or an unauthenticated request would fall through to the handler
// (an accidentally ungated admin read is a public data leak). There is no metadata
// clause that can catch a forgotten gate (requireAdmin carries no meta marker), so
// this functional sweep is the only deny-by-default guarantee for the non-:id admin
// routes: it drives each route's real middleware chain with NO bearer at all and
// asserts the legacy admin 401 short-circuits before the handler.
// -------------------------------------------------------------------------

// Every registered admin-surface route; login (the one anonymous route) is exempt.
const adminSurfaceRoutes: RouteDef[] = apiRoutes.filter((route) => route.surface === 'admin');
const authedAdminRoutes: RouteDef[] = adminSurfaceRoutes.filter(
  (route) => !(route.method === 'POST' && route.path === '/admin/api/login'),
);

describe('admin auth-mounting sweep: every non-login admin route 401s an unauthenticated request', () => {
  beforeEach(() => {
    // A stubbed runtime + a passing db seam so a route that DID reach its handler (a
    // regression where requireAdmin is missing) fails the 401 assertion cleanly
    // instead of throwing on an unconfigured runtime or touching real Postgres.
    configureAdminRuntime({} as AdminRuntime);
    installAdminDb();
  });

  afterEach(() => {
    resetAdminDbForTests();
    resetAdminRuntimeForTests();
    vi.restoreAllMocks();
  });

  it('selects the full admin surface minus exactly the anonymous login', () => {
    expect(adminSurfaceRoutes.length).toBeGreaterThanOrEqual(32);
    expect(authedAdminRoutes.length).toBe(adminSurfaceRoutes.length - 1);
  });

  for (const route of authedAdminRoutes) {
    it(`refuses an unauthenticated ${route.method} ${route.path} with the legacy admin 401 before the handler`, async () => {
      // No authorization header at all: the gate must 401 db-free (bearerToken is
      // null, so accountForToken is never consulted) and short-circuit the chain.
      const ctx = fakeCtx({
        method: route.method,
        url: concretePath(route.path),
        params: { id: REQUESTED_ID, action: 'suspend' },
      });
      const { res, handler } = await runRouteWithErrors(route, ctx);

      expect(res.statusCode).toBe(401);
      expect(handler).not.toHaveBeenCalled();
      expect(JSON.parse(res.body)).toEqual(ADMIN_AUTH_REQUIRED);
    });
  }

  it('negative control: an admin route MISSING requireAdmin serves an unauthenticated request (200), so the sweep is non-vacuous', async () => {
    // A synthetic admin-surface route with NO gate at all: the unauthenticated
    // request reaches its handler and writes 200, proving the sweep's 401 assertion
    // actually detects requireAdmin's presence on every real route.
    const ungatedRoute: RouteDef = {
      method: 'GET',
      path: '/admin/api/synthetic-ungated',
      surface: 'admin',
      middleware: [],
      handler: async (ctx) => {
        json(ctx.res, 200, { success: true, data: { ok: true }, error: null });
      },
      meta: { envelope: 'admin' },
    };
    const ctx = fakeCtx({ method: 'GET', url: ungatedRoute.path });
    const { res, handler } = await runRouteWithErrors(ungatedRoute, ctx);

    expect(res.statusCode).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.statusCode).not.toBe(401);
  });
});

// -------------------------------------------------------------------------
// Internal secret-gate mounting sweep.
//
// The analogous gate-mounting sweep the admin-surface QA mandated for every future
// authed surface: requireInternalSecret carries no meta marker, so no metadata
// clause can catch a forgotten gate; only this functional sweep can. An ungated
// /internal route would serve the Discord-bot / deploy / payout ops surface to
// the open internet. It drives each route's real middleware chain twice,
// asserting the gate short-circuits with the legacy bodies BEFORE the handler:
//   1. env secret UNSET  -> the deploy/discord gates hide with the feature-off
//      404 { ...error: 'unknown endpoint' } (anti-enumeration); the late-arrival
//      daily-reward gate FAILS CLOSED with 401 { ...error: 'not authenticated' }
//      instead (daily_rewards.ts internalAuthorized semantics, no fallback);
//   2. env secret SET + a WRONG header secret -> 401 { ...error: 'not
//      authenticated' } on all three gates.
// A negative control proves the sweep detects a route that forgot the gate.
// -------------------------------------------------------------------------

// Every registered internal-surface route (all 14 are secret-gated; there is no
// anonymous internal route).
const internalSurfaceRoutes: RouteDef[] = apiRoutes.filter((route) => route.surface === 'internal');

// The legacy fail() bodies the gates write (byte-parity with server/internal.ts
// and server/daily_rewards.ts).
const INTERNAL_FEATURE_OFF = { success: false, data: null, error: 'unknown endpoint' };
const INTERNAL_NOT_AUTHENTICATED = { success: false, data: null, error: 'not authenticated' };

// A secret value for the SET case; the request presents a different value.
const RIGHT_SECRET = 'sweep-expected-secret-value';
const WRONG_SECRET = 'sweep-presented-wrong-value';

// Which (header, env var) pair a route's gate enforces, plus the body the gate
// answers when its env secret is UNSET: restart-countdown carries the deploy
// pair, the /internal/daily-rewards/* ops family the fail-closed daily-reward
// pair (401 on unset, never 404), every discord route the bot pair.
function gatePairFor(route: RouteDef): {
  header: string;
  envVar: string;
  unsetStatus: number;
  unsetBody: Record<string, unknown>;
} {
  if (route.path === '/internal/restart-countdown') {
    return {
      header: DEPLOY_SECRET_HEADER,
      envVar: DEPLOY_SECRET_ENV,
      unsetStatus: 404,
      unsetBody: INTERNAL_FEATURE_OFF,
    };
  }
  if (route.path.startsWith('/internal/daily-rewards/')) {
    return {
      header: DAILY_REWARD_SECRET_HEADER,
      envVar: DAILY_REWARD_SECRET_ENV,
      unsetStatus: 401,
      unsetBody: INTERNAL_NOT_AUTHENTICATED,
    };
  }
  return {
    header: DISCORD_SECRET_HEADER,
    envVar: DISCORD_SECRET_ENV,
    unsetStatus: 404,
    unsetBody: INTERNAL_FEATURE_OFF,
  };
}

const SWEPT_SECRET_ENVS = [DEPLOY_SECRET_ENV, DISCORD_SECRET_ENV, DAILY_REWARD_SECRET_ENV] as const;

describe('internal secret-gate mounting sweep: every /internal route is gated', () => {
  const savedSecrets = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const envVar of SWEPT_SECRET_ENVS) {
      savedSecrets.set(envVar, process.env[envVar]);
      delete process.env[envVar];
    }
    // A stubbed runtime so a handler that unexpectedly ran (a regression where the
    // gate is missing) fails on a clean assertion, not an unconfigured-runtime throw.
    configureInternalRuntime({
      startRestartCountdown: vi.fn(
        () => ({ started: true }) as ReturnType<InternalRuntime['startRestartCountdown']>,
      ),
    });
  });

  afterEach(() => {
    for (const envVar of SWEPT_SECRET_ENVS) {
      const saved = savedSecrets.get(envVar);
      if (saved === undefined) delete process.env[envVar];
      else process.env[envVar] = saved;
    }
    resetInternalRuntimeForTests();
    vi.restoreAllMocks();
  });

  it('selects the full 18-route internal surface (the handleInternalApi 12 + the 6 ops routes)', () => {
    // The ops family includes four payout-service routes and two moderation mutations.
    expect(internalSurfaceRoutes.length).toBe(18);
  });

  for (const route of internalSurfaceRoutes) {
    it(`refuses ${route.method} ${route.path} with the gate's unset-env body before the handler`, async () => {
      const gate = gatePairFor(route);
      const ctx = fakeCtx({ method: route.method, url: route.path });
      const { res, handler } = await runRouteWithErrors(route, ctx);

      expect(res.statusCode).toBe(gate.unsetStatus);
      expect(handler).not.toHaveBeenCalled();
      expect(JSON.parse(res.body)).toEqual(gate.unsetBody);
    });

    it(`refuses a wrong secret on ${route.method} ${route.path} with a 401 before the handler`, async () => {
      const gate = gatePairFor(route);
      process.env[gate.envVar] = RIGHT_SECRET;
      const ctx = fakeCtx({
        method: route.method,
        url: route.path,
        headers: { [gate.header]: WRONG_SECRET },
      });
      const { res, handler } = await runRouteWithErrors(route, ctx);

      expect(res.statusCode).toBe(401);
      expect(handler).not.toHaveBeenCalled();
      expect(JSON.parse(res.body)).toEqual(INTERNAL_NOT_AUTHENTICATED);
    });
  }

  it('negative control: an internal route MISSING the gate serves an ungated request (200), so the sweep is non-vacuous', async () => {
    // A synthetic internal-surface route with NO gate at all: with all three env
    // secrets unset and no secret header, the request reaches its handler and
    // writes 200, proving the sweep's 404/401 assertions actually detect the
    // gate's presence.
    const ungatedRoute: RouteDef = {
      method: 'GET',
      path: '/internal/synthetic-ungated',
      surface: 'internal',
      middleware: [],
      handler: async (ctx) => {
        json(ctx.res, 200, { success: true, data: { ok: true }, error: null });
      },
      meta: { envelope: 'admin' },
    };
    const ctx = fakeCtx({ method: 'GET', url: ungatedRoute.path });
    const { res, handler } = await runRouteWithErrors(ungatedRoute, ctx);

    expect(res.statusCode).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.statusCode).not.toBe(404);
    expect(res.statusCode).not.toBe(401);
  });
});

// -------------------------------------------------------------------------
// /api auth-mounting sweep.
//
// The admin-surface QA mandate applied to the /api surface: the authed routes the
// late-arrival migration registered must actually MOUNT their bearer guard
// (createActiveGuard carries no meta marker, so only a functional sweep can
// catch a forgotten gate; an ungated github/daily-rewards read would leak
// account-linked data, and an ungated desktop-login create would mint session
// handoff codes anonymously). Each route's real middleware chain is driven with
// NO Authorization header at all and must answer the legacy 401 db-free (the
// guard rejects a null bearer before consulting any resolver) without ever
// reaching the handler. desktop-login create's fused rate guard runs BEFORE the
// auth guard (the legacy order), so the limiter buckets are reset per test.
// Future authed /api surfaces extend this list with their routes.
// -------------------------------------------------------------------------

// The legacy { error } body the shared active guard writes for a missing bearer.
const API_NOT_AUTHENTICATED = { error: 'not authenticated', code: 'auth.required' };

// The (method, path) pairs of the late-arrival authed /api routes, extended with
// the v0.20.0 release-merge arrivals (the account email backfill + the
// paginated daily leaderboard, both behind the shared active guard).
const AUTHED_18B_ROUTES: ReadonlyArray<{ method: string; path: string }> = [
  { method: 'POST', path: '/api/auth/github/start' },
  { method: 'GET', path: '/api/github' },
  { method: 'DELETE', path: '/api/github' },
  { method: 'POST', path: '/api/desktop-login/create' },
  { method: 'GET', path: '/api/daily-rewards' },
  { method: 'POST', path: '/api/daily-rewards/spin' },
  { method: 'GET', path: '/api/daily-rewards/history' },
  { method: 'GET', path: '/api/daily-rewards/leaderboard' },
  { method: 'POST', path: '/api/account/email/set-initial' },
  // v0.20.0 third slice: the authed map editor routes (the two owner reads are
  // behind the shared read guard; every mutation behind the shared active
  // guard). GET /api/maps/:id is optional-auth (public read) and the two public
  // reads (maps/public, assets/:file) are anonymous, so none of those belong
  // here.
  { method: 'GET', path: '/api/maps' },
  { method: 'POST', path: '/api/maps' },
  { method: 'PUT', path: '/api/maps/:id' },
  { method: 'DELETE', path: '/api/maps/:id' },
  { method: 'POST', path: '/api/maps/:id/fork' },
  { method: 'POST', path: '/api/maps/:id/publish' },
  { method: 'POST', path: '/api/maps/:id/unpublish' },
  { method: 'POST', path: '/api/assets' },
  { method: 'GET', path: '/api/assets/mine' },
  { method: 'DELETE', path: '/api/assets/:id' },
];

const authed18bRoutes: RouteDef[] = AUTHED_18B_ROUTES.map((spec) => {
  const route = apiRoutes.find((r) => r.method === spec.method && r.path === spec.path);
  if (!route) throw new Error(`authed route missing from registry: ${spec.method} ${spec.path}`);
  return route;
});

describe('/api auth-mounting sweep: every authed late-arrival route 401s an unauthenticated request', () => {
  beforeEach(() => {
    // The desktop-login create chain consumes the fused register/login budget
    // before auth; a clean bucket per test keeps the sweep order-independent.
    resetRateLimits();
  });

  afterEach(() => {
    resetRateLimits();
  });

  it('selects all nineteen authed routes from the registry', () => {
    expect(authed18bRoutes.length).toBe(19);
  });

  for (const route of authed18bRoutes) {
    it(`refuses an unauthenticated ${route.method} ${route.path} with the legacy 401 before the handler`, async () => {
      const ctx = fakeCtx({ method: route.method, url: route.path });
      const { res, handler } = await runRoute(route, ctx);

      expect(res.statusCode).toBe(401);
      expect(handler).not.toHaveBeenCalled();
      expect(JSON.parse(res.body)).toEqual(API_NOT_AUTHENTICATED);
    });
  }

  it('negative control: an /api route MISSING the guard serves an unauthenticated request (200), so the sweep is non-vacuous', async () => {
    const ungatedRoute: RouteDef = {
      method: 'GET',
      path: '/api/synthetic-ungated',
      surface: 'api',
      middleware: [],
      handler: async (ctx) => {
        json(ctx.res, 200, { ok: true });
      },
    };
    const ctx = fakeCtx({ method: 'GET', url: ungatedRoute.path });
    const { res, handler } = await runRoute(ungatedRoute, ctx);

    expect(res.statusCode).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.statusCode).not.toBe(401);
  });
});
