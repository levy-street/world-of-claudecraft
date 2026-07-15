// Registry-completeness gate for the API request pipeline.
//
// The dispatcher (server/http/dispatch.ts) places the new route registry
// in FRONT of the legacy /api handleApi ladder: for a path the registry OWNS (a
// matched RouteDef) it runs the onion; for ANY OTHER /api path it delegates to
// the legacy handleApi UNCHANGED. So the dispatcher's real coverage is
//   (router-owned paths) UNION (paths the legacy handler still serves).
//
// This gate HARD-FAILS if any legacy /api ladder path (from the surface
// inventory) would be served by NEITHER the new router NOR the legacy delegate: a
// dropped route is a production 404. It stays meaningful as routes migrate,
// because each route moves from delegate-covered to router-owned and coverage is
// checked against BOTH arms, so a migration that adds a router route without
// removing the legacy arm (double-serving) or removes the legacy arm without a
// matching router route (a gap) is caught here.
//
// The coverage decision is factored into a pure isCovered() helper, and a
// negative-control block feeds it a synthetic dropped route to prove the gate is
// NON-VACUOUS (it can actually fail). The legacy-served set is re-derived
// independently from server/main.ts SOURCE (the same extraction technique as
// surface_inventory.test.ts, read as a file, never imported), which gives the
// gate teeth against a future dropped dispatch arm.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type ApiRegistry,
  apiRegistry,
  apiRoutes,
  assertNoOwnedRouteShadowing,
  createApiRegistry,
} from '../../../server/http/registry';
import { checkRequireOwnedCoverage, checkRouteCompleteness } from '../helpers';
import { DEVIATION_ID, KNOWN_DEVIATIONS } from './known_deviations';
import { DISPATCH, SURFACE_INVENTORY } from './surface_inventory';

// The minimal route shape the coverage helpers need: a method, a path, and (for a
// legacy :param route) the exact dispatcher regex whose source keys it in the
// legacy-served set. A SurfaceRoute satisfies this structurally, so the inventory
// rows pass straight through and a synthetic route (the negative control) is
// trivial to build.
interface LadderRoute {
  readonly method: string;
  readonly path: string;
  readonly match?: RegExp;
}

// -------------------------------------------------------------------------
// Coverage helpers (pure, inspectable): router-owned OR legacy-served.
// -------------------------------------------------------------------------

// Substitute each :param segment with a literal placeholder so resolve(), which
// matches CONCRETE paths, can be queried against a :param ladder pattern. A
// placeholder segment matches the router's ':param' (any non-empty segment) and
// never collides with a static segment.
function concretePath(path: string): string {
  return path
    .split('/')
    .map((segment) => (segment.startsWith(':') ? 'x' : segment))
    .join('/');
}

// True when the NEW registry owns the route (the dispatcher would run the onion).
function isRouterOwned(registry: ApiRegistry, route: LadderRoute): boolean {
  return registry.resolve(route.method, concretePath(route.path)).kind === 'matched';
}

// The key a ladder route carries in the legacy-served set: the exact dispatcher
// regex source for a :param route, else the literal path for an exact arm.
function legacyKey(route: LadderRoute): string {
  return route.match ? route.match.source : route.path;
}

// True when the legacy handler still serves the route (its key is in the set
// re-derived from main.ts source). The dispatcher delegates every non-owned /api
// path to the legacy ladder, but that only yields a real response if the arm is
// still present; a dropped arm answers 404, i.e. NOT served.
function legacyServes(route: LadderRoute, legacyServed: ReadonlySet<string>): boolean {
  return legacyServed.has(legacyKey(route));
}

// The coverage decision the gate turns on: a ladder path is covered iff the new
// router owns it OR the legacy handler still serves it. Neither means a prod 404.
function isCovered(
  route: LadderRoute,
  registry: ApiRegistry,
  legacyServed: ReadonlySet<string>,
): boolean {
  return isRouterOwned(registry, route) || legacyServes(route, legacyServed);
}

// -------------------------------------------------------------------------
// The legacy /api ladder (must-serve set) and the source-derived served set.
// -------------------------------------------------------------------------

// The swag-claim orphan is an unreachable handler with no dispatch arm today (see
// the swagClaimOrphanUnreachable known deviation), so it is intentionally NOT
// served and is excluded from the must-serve set. Referencing the deviation keeps
// the exclusion documented, not silent.
const ORPHAN_DEVIATION = KNOWN_DEVIATIONS.find(
  (d) => d.id === DEVIATION_ID.swagClaimOrphanUnreachable,
);
const EXCLUDED_PATHS = new Set<string>(ORPHAN_DEVIATION?.routes ?? []);

// Routes born AFTER the migration as registry-only RouteDefs (the new-route
// rule in server/http/CLAUDE.md: a NEW endpoint never gets an inline ladder
// arm). They are router-owned with NO legacy rollback arm by design, so the
// stays-delegate-served requirement does not apply; the loop below asserts the
// router-owned-only shape instead (the same assertion pair as the orphan).
const REGISTRY_ONLY_PATHS = new Set<string>([
  '/api/deeds/rarity',
  '/api/deeds/broadcasts',
  '/api/steam/link',
  '/api/steam/status',
]);

// Every legacy /api ladder row (dispatcher === main handleApi), minus the
// documented unreachable orphan and the registry-only routes (they are
// inventory rows, but they were never ladder arms, so the ladder-coverage and
// rollback-retention invariants do not describe them).
const legacyLadder = SURFACE_INVENTORY.filter(
  (r) =>
    r.dispatcher === DISPATCH.mainApi &&
    !EXCLUDED_PATHS.has(r.path) &&
    !REGISTRY_ONLY_PATHS.has(r.path),
);

// Read main.ts as a FILE (never import: main constructs a pg pool at load) and
// re-derive the set of /api paths the CURRENT handleApi still serves. The
// daily-rewards sub-dispatcher is scanned too: its exact-path /api arms sit in
// server/daily_rewards.ts behind main.ts's `startsWith('/api/daily-rewards')`
// prefix arm, so they are legacy-served even though main.ts never spells the
// concrete paths (same blind-spot fix as the freshness gate's
// DISPATCHER_SOURCES; extend this list for any future prefix-delegated module).
const LEGACY_SOURCE_URLS = [
  new URL('../../../server/main.ts', import.meta.url),
  new URL('../../../server/daily_rewards.ts', import.meta.url),
  new URL('../../../server/claudium.ts', import.meta.url),
] as const;

// Every `=== '<path>'` (or "<path>") comparison whose path begins with /api/. The
// quote is captured so the same quote closes it.
const EXACT_API_RE = /===\s*(['"])(\/api\/[^'"]*)\1/g;

// Every `const <name>Match = /<regex>/.exec(...)`. Group 2 is the regex source
// body (slash-escaped exactly as RegExp.source reports it); `(?:\\.|[^/\\\n])*`
// consumes escaped chars and stops at the first unescaped closing slash.
const PARAM_API_RE = /const\s+(\w*Match)\s*=\s*\/((?:\\.|[^/\\\n])*)\/[a-z]*\.exec/g;

// The regex-source prefix a main.ts /api :param route must start with.
const API_REGEX_PREFIX = '^\\/api\\/';

function deriveLegacyServed(): Set<string> {
  const text = LEGACY_SOURCE_URLS.map((url) => readFileSync(url, 'utf8')).join('\n');
  const served = new Set<string>();
  for (const m of text.matchAll(EXACT_API_RE)) served.add(m[2]);
  for (const m of text.matchAll(PARAM_API_RE)) {
    const body = m[2];
    if (body.startsWith(API_REGEX_PREFIX)) served.add(body);
  }
  return served;
}

const legacyServed = deriveLegacyServed();

describe('registry completeness: the legacy /api ladder is fully covered', () => {
  it('derives a non-empty legacy ladder and a non-empty source-served set', () => {
    // Guard against a vacuous pass: both the inventory ladder and the independent
    // source scan must actually find routes.
    expect(legacyLadder.length).toBeGreaterThan(50);
    expect(legacyServed.size).toBeGreaterThan(40);
  });

  it('covers every ladder path by the router OR the delegate (no dropped route)', () => {
    const uncovered = legacyLadder
      .filter((r) => !isCovered(r, apiRegistry, legacyServed))
      .map((r) => `${r.method} ${r.path}`);
    expect(uncovered).toEqual([]);
  });

  it('retains the legacy rollback arm for every migrated (router-owned) route', () => {
    // A migrated route is deliberately BOTH router-owned (flag 'new') and
    // legacy-served (flag 'legacy'): the migration keeps each route's legacy
    // handleApi arm as the flag-off rollback path (removed only at the ladder deletion). That
    // is not a runtime double-serve, since the dispatcher runs exactly one arm per
    // request (the API_DISPATCH flag picks) and the parity harness proves the two
    // arms are byte-identical. The real migration hazard is a rollback arm removed
    // too early (which would 404 under flag 'legacy'), so the invariant flips: every
    // router-owned ladder path MUST still be legacy-served until the legacy ladder is removed.
    const missingRollbackArm = legacyLadder
      .filter((r) => isRouterOwned(apiRegistry, r) && !legacyServes(r, legacyServed))
      .map((r) => `${r.method} ${r.path}`);
    expect(missingRollbackArm).toEqual([]);
  });
});

describe('registry completeness: migrated baseline (public reads + auth + characters + account + wallet + reports/telemetry + discord)', () => {
  // The exact routes migrated onto RouteDefs so far: the public
  // reads (GET, server/leaderboard.ts), the auth credential surface (POST,
  // server/auth_routes.ts), the owner-gated character surface
  // (server/characters.ts: the list pair, create, and the account-owned :id
  // subroutes behind requireOwnedCharacter), the account-portal surface
  // (server/account.ts: the /api/account/* family, the companion-token method trio,
  // and /api/email/unsubscribe), and the wallet / card / referral surface
  // (server/wallet.ts: the wallet-link family, GET /api/wallet, the public GET
  // /api/woc/balance, the binary POST /api/card, and GET /api/referrals). The router
  // owns each under flag 'new'; their legacy arms stay for rollback. Method-aware,
  // because a route resolves per method (a POST to a GET-only path resolves
  // methodNotAllowed, not matched), and both the companion-token path (POST create,
  // GET list, DELETE revoke) and /api/wallet/link (POST link, DELETE unlink) appear
  // more than once.
  const MIGRATED_ROUTES: readonly LadderRoute[] = [
    { method: 'GET', path: '/api/leaderboard' },
    { method: 'GET', path: '/api/arena/leaderboard' },
    { method: 'GET', path: '/api/releases' },
    { method: 'GET', path: '/api/project-stats' },
    { method: 'GET', path: '/api/status' },
    { method: 'GET', path: '/api/perf' },
    { method: 'GET', path: '/api/search' },
    { method: 'GET', path: '/api/realms' },
    { method: 'GET', path: '/api/public/characters/:name/sheet' },
    { method: 'POST', path: '/api/register' },
    { method: 'POST', path: '/api/login' },
    { method: 'POST', path: '/api/native-attestation/challenge' },
    { method: 'GET', path: '/api/me/characters' },
    { method: 'GET', path: '/api/characters' },
    { method: 'POST', path: '/api/characters' },
    { method: 'GET', path: '/api/characters/:id/standing' },
    { method: 'GET', path: '/api/characters/:id/sheet' },
    { method: 'POST', path: '/api/characters/:id/rename' },
    { method: 'POST', path: '/api/characters/:id/takeover' },
    { method: 'DELETE', path: '/api/characters/:id' },
    // The account portal (server/account.ts).
    { method: 'GET', path: '/api/account' },
    { method: 'POST', path: '/api/account/password' },
    { method: 'POST', path: '/api/account/logout' },
    { method: 'POST', path: '/api/account/email' },
    { method: 'POST', path: '/api/account/deactivate' },
    { method: 'POST', path: '/api/account/companion-token' },
    { method: 'GET', path: '/api/account/companion-token' },
    { method: 'DELETE', path: '/api/account/companion-token' },
    { method: 'POST', path: '/api/account/email/change' },
    // v0.20.0: the mandatory-email backfill (fills a missing recovery address).
    { method: 'POST', path: '/api/account/email/set-initial' },
    { method: 'GET', path: '/api/account/email/verify' },
    { method: 'POST', path: '/api/account/export' },
    { method: 'POST', path: '/api/account/marketing' },
    { method: 'POST', path: '/api/account/2fa/setup' },
    { method: 'POST', path: '/api/account/2fa/enable' },
    { method: 'POST', path: '/api/account/2fa/disable' },
    { method: 'GET', path: '/api/email/unsubscribe' },
    // The wallet / card / referral surface (server/wallet.ts).
    { method: 'POST', path: '/api/wallet/link/challenge' },
    { method: 'POST', path: '/api/wallet/link' },
    { method: 'DELETE', path: '/api/wallet/link' },
    { method: 'GET', path: '/api/wallet' },
    { method: 'GET', path: '/api/woc/balance' },
    { method: 'POST', path: '/api/card' },
    { method: 'GET', path: '/api/referrals' },
    // The reports + telemetry surface (server/reports.ts). All POST; the
    // two public beacons (perf-report, site-presence) are registered POST-only so a
    // non-POST delegates to the retained legacy arm (perf-report's 404 fall-through,
    // site-presence's handler-owned 405 { ok: false }).
    { method: 'POST', path: '/api/reports' },
    { method: 'POST', path: '/api/bug-reports' },
    { method: 'POST', path: '/api/perf-report' },
    { method: 'POST', path: '/api/site-presence' },
    // The Discord family (server/discord.ts). The OAuth start/callback
    // pair, the two first-login chooser routes, the GET/DELETE /api/discord status +
    // unlink pair, and the previously-orphaned swag claim (now reachable).
    { method: 'POST', path: '/api/auth/discord/start' },
    { method: 'GET', path: '/api/auth/discord/callback' },
    { method: 'POST', path: '/api/auth/discord/login/new' },
    { method: 'POST', path: '/api/auth/discord/login/link' },
    { method: 'POST', path: '/api/auth/discord/native/exchange' },
    { method: 'POST', path: '/api/auth/apple' },
    { method: 'POST', path: '/api/auth/apple/login/new' },
    { method: 'POST', path: '/api/auth/apple/login/link' },
    { method: 'GET', path: '/api/discord' },
    { method: 'DELETE', path: '/api/discord' },
    { method: 'POST', path: '/api/discord/swag/claim' },
    // The release-merge late-arrival families. The GitHub link family
    // (server/github.ts), the desktop-login handoff pair
    // (server/desktop_login_routes.ts, on the fused register/login budget), and
    // the daily-rewards player trio (server/daily_rewards.ts, served under the
    // ladder's startsWith prefix arm; the off-table subpath/method shapes stay
    // delegate-served until the legacy ladder is removed). The ops trio is asserted
    // in the internal-surface block below (it flips from delegate-only to registered).
    { method: 'POST', path: '/api/auth/github/start' },
    { method: 'GET', path: '/api/auth/github/callback' },
    { method: 'GET', path: '/api/github' },
    { method: 'DELETE', path: '/api/github' },
    { method: 'POST', path: '/api/desktop-login/create' },
    { method: 'POST', path: '/api/desktop-login/exchange' },
    { method: 'GET', path: '/api/daily-rewards' },
    { method: 'POST', path: '/api/daily-rewards/spin' },
    { method: 'GET', path: '/api/daily-rewards/history' },
    // The deeds family (server/deeds.ts): registry-only routes born AFTER the
    // migration, per the new-route rule (a NEW endpoint is a RouteDef module,
    // never an inline ladder arm), so they have no legacy twin to retain; the
    // REGISTRY_ONLY_PATHS branch below asserts the router-owned-only shape.
    { method: 'GET', path: '/api/deeds/rarity' },
    { method: 'GET', path: '/api/deeds/broadcasts' },
    { method: 'POST', path: '/api/deeds/broadcasts' },
    // The Steam link trio (server/steam/routes.ts): registry-only like the
    // deeds pair, env-gated dark until STEAM_ENABLED=1.
    { method: 'POST', path: '/api/steam/link' },
    { method: 'DELETE', path: '/api/steam/link' },
    { method: 'GET', path: '/api/steam/status' },
    // v0.20.0: the paginated daily leaderboard read (the ops-side sibling is
    // asserted with the internal family below).
    { method: 'GET', path: '/api/daily-rewards/leaderboard' },
    // Claudium (server-authoritative soft currency) proxy family
    // (server/claudium.ts). A brand-new /api/claudium/* prefix with NO legacy
    // ladder twin: registry-only, so every arm is asserted here. price/:rail is a
    // public enum param (publicRead), not an account-owned resource.
    { method: 'POST', path: '/api/claudium/stripe/webhook' },
    { method: 'GET', path: '/api/claudium/balance' },
    { method: 'GET', path: '/api/claudium/price/:rail' },
    { method: 'GET', path: '/api/claudium/skus' },
    { method: 'GET', path: '/api/claudium/native/rails' },
    { method: 'GET', path: '/api/claudium/native/price/:rail' },
    { method: 'GET', path: '/api/claudium/native/balance/sol/:owner' },
    { method: 'GET', path: '/api/claudium/store' },
    { method: 'GET', path: '/api/claudium/history' },
    { method: 'POST', path: '/api/claudium/purchase' },
    { method: 'POST', path: '/api/claudium/native/quote' },
    { method: 'POST', path: '/api/claudium/native/confirm' },
    { method: 'POST', path: '/api/claudium/spend' },
    // v0.20.0 third slice: the map editor surface, migrated in-merge. The custom
    // map family (server/maps_routes.ts) and the uploaded-GLB family
    // (server/user_assets_routes.ts). GET /api/assets/:file is the
    // content-addressed <sha256>.glb byte read (the handler validates the shape).
    { method: 'GET', path: '/api/maps' },
    { method: 'POST', path: '/api/maps' },
    { method: 'GET', path: '/api/maps/public' },
    { method: 'GET', path: '/api/maps/:id' },
    { method: 'PUT', path: '/api/maps/:id' },
    { method: 'DELETE', path: '/api/maps/:id' },
    { method: 'POST', path: '/api/maps/:id/fork' },
    { method: 'POST', path: '/api/maps/:id/publish' },
    { method: 'POST', path: '/api/maps/:id/unpublish' },
    { method: 'POST', path: '/api/assets' },
    { method: 'GET', path: '/api/assets/mine' },
    { method: 'GET', path: '/api/assets/:file' },
    { method: 'DELETE', path: '/api/assets/:id' },
  ];
  const MIGRATED_PATHS = MIGRATED_ROUTES.map((r) => r.path);

  it('registers exactly the migrated /api routes (one RouteDef per path)', () => {
    // Scoped to the /api family: the /admin/api surface and the /oauth
    // + /internal surfaces have their own registration assertions
    // below, each derived from its ladder.
    const registered = [...apiRoutes]
      .filter(
        (r) =>
          !r.path.startsWith('/admin/') &&
          !r.path.startsWith('/oauth/') &&
          !r.path.startsWith('/internal/'),
      )
      .map((r) => r.path)
      .sort();
    expect(registered).toEqual([...MIGRATED_PATHS].sort());
  });

  it('the router OWNS every migrated route (its method resolves to matched)', () => {
    for (const route of MIGRATED_ROUTES) {
      expect(apiRegistry.resolve(route.method, concretePath(route.path)).kind).toBe('matched');
    }
  });

  it('every migrated route is a mainApi ladder route that stays delegate-served', () => {
    // Each migrated route must also be an inventory ladder route AND retain its
    // legacy arm (rollback), so the flag can roll each one back per route.
    for (const route of MIGRATED_ROUTES) {
      // The Discord swag-claim is the one exception: it was an unreachable orphan
      // (no legacy arm ever existed), so it is registered router-owned ONLY.
      // It has no rollback arm to retain, so assert the orphan shape (router-owned,
      // NOT legacy-served) and skip the must-be-a-ladder-route requirement. Its
      // dedicated 'excludes the documented unreachable swag-claim orphan' test pins
      // the SURFACE_INVENTORY unreachable flag + the deviation.
      if (EXCLUDED_PATHS.has(route.path) || REGISTRY_ONLY_PATHS.has(route.path)) {
        expect(isRouterOwned(apiRegistry, route)).toBe(true);
        expect(legacyServes(route, legacyServed)).toBe(false);
        continue;
      }
      const row = legacyLadder.find((r) => r.path === route.path && r.method === route.method);
      expect(
        row,
        `migrated route ${route.method} ${route.path} must be a mainApi ladder route`,
      ).toBeDefined();
      if (row) {
        expect(isRouterOwned(apiRegistry, row)).toBe(true);
        expect(legacyServes(row, legacyServed)).toBe(true);
      }
    }
  });

  it('leaves every un-migrated ladder path delegate-only (not router-owned)', () => {
    const migrated = new Set(MIGRATED_PATHS);
    const wronglyOwned = legacyLadder
      .filter((r) => !migrated.has(r.path) && isRouterOwned(apiRegistry, r))
      .map((r) => `${r.method} ${r.path}`);
    expect(wronglyOwned).toEqual([]);
  });

  it('the router-owned UNION delegate-served set still covers the whole ladder', () => {
    const covered = legacyLadder.filter((r) => isCovered(r, apiRegistry, legacyServed));
    expect(covered.length).toBe(legacyLadder.length);
  });

  it('excludes the documented unreachable swag-claim orphan from the must-serve set', () => {
    expect(ORPHAN_DEVIATION).toBeDefined();
    expect(ORPHAN_DEVIATION?.routes).toContain('/api/discord/swag/claim');
    const orphanRow = SURFACE_INVENTORY.find((r) => r.path === '/api/discord/swag/claim');
    expect(orphanRow?.unreachable).toBe(true);
    expect(orphanRow?.dispatcher).toBe(DISPATCH.mainApi);
    expect(legacyLadder.some((r) => r.path === '/api/discord/swag/claim')).toBe(false);
    // The source does not serve it either, so including it in the must-serve set
    // would (correctly) fail the coverage gate; the exclusion is what keeps the
    // gate honest rather than red on a by-design orphan.
    expect(legacyServes({ method: 'POST', path: '/api/discord/swag/claim' }, legacyServed)).toBe(
      false,
    );
  });
});

describe('registry completeness: admin surface (server/admin.ts)', () => {
  // The admin ladder is the legacy handleAdminApi surface (SURFACE_INVENTORY rows
  // whose dispatcher is DISPATCH.admin). The migration moved EVERY branch onto a
  // RouteDef, restructuring the one enum-alternation route to a :action param. These
  // assertions derive the expected admin route set FROM the ladder, so a dropped or
  // added admin branch fails the gate without a hand-maintained parallel list.

  // The one enum-alternation ladder path, rewritten to the migrated :action form.
  function enumToActionParam(path: string): string {
    return path.replace('(suspend|unsuspend|ban|unban)', ':action');
  }

  // A concrete request path for a ladder pattern: :param -> a placeholder segment,
  // and the enum alternation -> its first alternative (suspend), so resolve() can be
  // queried against every admin ladder row.
  function adminConcretePath(path: string): string {
    return path
      .split('/')
      .map((seg) => {
        if (seg.startsWith(':')) return 'x';
        if (seg.startsWith('(') && seg.endsWith(')')) return seg.slice(1, -1).split('|')[0];
        return seg;
      })
      .join('/');
  }

  const adminLadder = SURFACE_INVENTORY.filter((r) => r.dispatcher === DISPATCH.admin);
  const adminLadderPaths = adminLadder.map((r) => enumToActionParam(r.path)).sort();
  const registeredAdminPaths = [...apiRoutes]
    .filter((r) => r.path.startsWith('/admin/'))
    .map((r) => r.path)
    .sort();

  it('derives a non-empty admin ladder', () => {
    expect(adminLadder.length).toBeGreaterThan(25);
  });

  it('registers exactly the admin ladder routes (enum row rewritten to :action)', () => {
    // Path-and-multiplicity match: the GET+POST /admin/api/blocked-ips pair appears
    // twice in both sets, so a dropped or duplicated admin RouteDef is caught.
    expect(registeredAdminPaths).toEqual(adminLadderPaths);
  });

  it('the router OWNS every admin ladder branch (no dropped admin route)', () => {
    const dropped = adminLadder
      .filter((r) => apiRegistry.resolve(r.method, adminConcretePath(r.path)).kind !== 'matched')
      .map((r) => `${r.method} ${r.path}`);
    expect(dropped).toEqual([]);
  });

  it('the enum route resolves each of the four actions to the same handler', () => {
    for (const action of ['suspend', 'unsuspend', 'ban', 'unban']) {
      const match = apiRegistry.resolve('POST', `/admin/api/moderation/accounts/5/${action}`);
      expect(match.kind).toBe('matched');
      if (match.kind === 'matched') {
        expect(match.route.path).toBe('/admin/api/moderation/accounts/:id/:action');
        expect(match.params).toEqual({ id: '5', action });
      }
    }
  });

  it('the literal moderation action routes win over the :action catch-all', () => {
    // The no-regex restructure only works if the specificity sort orders the literal
    // sibling routes ahead of :action; assert each resolves to its own path.
    for (const literal of [
      'reactivate',
      'chat-mute',
      'daily-rewards-ban',
      'daily-rewards-unban',
      'daily-rewards-ip-ban',
      'daily-rewards-ip-unban',
      'lift-mute',
      'note',
      'reset-strikes',
    ]) {
      const match = apiRegistry.resolve('POST', `/admin/api/moderation/accounts/5/${literal}`);
      expect(match.kind).toBe('matched');
      if (match.kind === 'matched') {
        expect(match.route.path).toBe(`/admin/api/moderation/accounts/:id/${literal}`);
      }
    }
  });

  it('the admin :param routes are operator-scoped and admin-surface (excluded from the account clause)', () => {
    // ANY param segment, not the literal ':id': a future admin route with a
    // differently-named param (':accountId', ':name') must still carry the operator
    // marker, which is what routes it into the functional 401/422 operator sweep.
    const idRoutes = [...apiRoutes].filter(
      (r) => r.path.startsWith('/admin/') && r.path.includes('/:'),
    );
    expect(idRoutes.length).toBeGreaterThanOrEqual(12);
    for (const r of idRoutes) {
      expect(r.surface, r.path).toBe('admin');
      expect(r.meta?.requireOwned?.ownerScope, r.path).toBe('operator');
      expect(r.meta?.envelope, r.path).toBe('admin');
    }
  });

  it('every admin RouteDef selects the { success, data, error } envelope', () => {
    for (const r of [...apiRoutes].filter((r) => r.path.startsWith('/admin/'))) {
      expect(r.surface, r.path).toBe('admin');
      expect(r.meta?.envelope, r.path).toBe('admin');
    }
  });
});

describe('registry completeness: oauth + internal surfaces (server/oauth.ts, server/internal.ts, server/daily_rewards.ts)', () => {
  // Both expected sets derive FROM the SURFACE_INVENTORY ladders (the admin-block
  // pattern), so a dropped or added branch reds the gate without a hand-maintained
  // parallel list. The oauth surface migrates ONLY its POST JSON rows: the two GET
  // consent/device HTML pages stay on the top-level ladder, off the route table,
  // served through the dispatcher's delegate. The internal migration moved EVERY
  // handleInternalApi row (11: restart-countdown + the 10 Discord-bot routes) and
  // at first left the separate /internal/daily-rewards/* ops family delegate-only;
  // the late-arrival pass put that family on the table too (behind the fail-closed
  // requireInternalSecretFailClosed gate), so the internal derivation now spans
  // EVERY internal row and the ops pins flip from delegate-only to registered.
  const oauthPostLadder = SURFACE_INVENTORY.filter(
    (r) => r.dispatcher === DISPATCH.oauth && r.method === 'POST',
  );
  const oauthGetLadder = SURFACE_INVENTORY.filter(
    (r) => r.dispatcher === DISPATCH.oauth && r.method === 'GET',
  );
  const OPS_FAMILY_PREFIX = '/internal/daily-rewards/';
  const internalLadder = SURFACE_INVENTORY.filter((r) => r.dispatcher === DISPATCH.internal);
  const opsFamilyRows = SURFACE_INVENTORY.filter(
    (r) => r.dispatcher === DISPATCH.internal && r.path.startsWith(OPS_FAMILY_PREFIX),
  );

  it('derives the expected non-empty ladders', () => {
    expect(oauthPostLadder.length).toBe(5);
    expect(oauthGetLadder.length).toBe(2);
    // 17 = the handleInternalApi eleven (restart-countdown + the 10 Discord-bot routes)
    // plus the six-route payout and moderation ops family below.
    expect(internalLadder.length).toBe(17);
    expect(opsFamilyRows.length).toBe(6);
  });

  it('registers exactly the oauth POST ladder routes', () => {
    const registered = [...apiRoutes]
      .filter((r) => r.path.startsWith('/oauth/'))
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(registered).toEqual(oauthPostLadder.map((r) => `${r.method} ${r.path}`).sort());
  });

  it('the router OWNS every oauth POST ladder branch', () => {
    const dropped = oauthPostLadder
      .filter((r) => apiRegistry.resolve(r.method, r.path).kind !== 'matched')
      .map((r) => `${r.method} ${r.path}`);
    expect(dropped).toEqual([]);
  });

  it('keeps the GET consent/device HTML pages OFF the route table', () => {
    // A GET to either path resolves methodNotAllowed (the POST sibling is
    // registered), which the dispatcher DELEGATES to the legacy handleOAuth
    // ladder, so the HTML pages render exactly as today.
    for (const r of oauthGetLadder) {
      expect(apiRegistry.resolve(r.method, r.path).kind, r.path).toBe('methodNotAllowed');
    }
  });

  it('registers exactly the internal ladder routes', () => {
    const registered = [...apiRoutes]
      .filter((r) => r.path.startsWith('/internal/'))
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(registered).toEqual(internalLadder.map((r) => `${r.method} ${r.path}`).sort());
  });

  it('the router OWNS every internal ladder branch', () => {
    const dropped = internalLadder
      .filter((r) => apiRegistry.resolve(r.method, r.path).kind !== 'matched')
      .map((r) => `${r.method} ${r.path}`);
    expect(dropped).toEqual([]);
  });

  it('every oauth RouteDef selects the RFC 6749 envelope', () => {
    const oauthRoutes = [...apiRoutes].filter((r) => r.path.startsWith('/oauth/'));
    expect(oauthRoutes.length).toBeGreaterThan(0);
    for (const r of oauthRoutes) {
      expect(r.surface, r.path).toBe('oauth');
      expect(r.meta?.envelope, r.path).toBe('oauth');
    }
  });

  it('every internal RouteDef selects the { success, data, error } envelope', () => {
    // The internal envelope IS the admin { success, data, error } shape;
    // EnvelopeKind is a frozen contract (server/http/types.ts) with no separate
    // 'internal' member, so the routes carry surface 'internal' + meta.envelope 'admin'.
    const internalRoutes = [...apiRoutes].filter((r) => r.path.startsWith('/internal/'));
    expect(internalRoutes.length).toBeGreaterThan(0);
    for (const r of internalRoutes) {
      expect(r.surface, r.path).toBe('internal');
      expect(r.meta?.envelope, r.path).toBe('admin');
    }
  });

  it('registers the /internal/daily-rewards ops family (flips the delegate-only pin)', () => {
    // These three rows started delegate-only (notFound); the late-arrival pass puts
    // the family on the table, so each real ops route now resolves matched. The
    // synthetic never-existing subpaths still resolve notFound and delegate to
    // the composite (handleDailyRewardInternalApi first), which keeps serving
    // every off-table shape (unknown subpath, wrong method, HEAD) until the legacy
    // ladder is removed.
    for (const r of opsFamilyRows) {
      expect(apiRegistry.resolve(r.method, r.path).kind, r.path).toBe('matched');
    }
    expect(apiRegistry.resolve('POST', '/internal/daily-rewards/run').kind).toBe('notFound');
    expect(apiRegistry.resolve('GET', '/internal/daily-rewards/status').kind).toBe('notFound');
  });
});

describe('registry completeness: the gate is non-vacuous (negative control)', () => {
  it('reports a synthetic dropped route as NOT covered', () => {
    // A path that is neither router-owned (empty registry) nor legacy-served: the
    // exact shape of a route silently dropped during a migration.
    const droppedRoute: LadderRoute = {
      method: 'GET',
      path: '/api/__dropped-route-never-served__',
    };
    expect(isRouterOwned(apiRegistry, droppedRoute)).toBe(false);
    expect(legacyServes(droppedRoute, legacyServed)).toBe(false);
    expect(isCovered(droppedRoute, apiRegistry, legacyServed)).toBe(false);

    // And the aggregate gate would FAIL for it: added to the ladder, it lands in
    // the uncovered list.
    const withDropped: LadderRoute[] = [...legacyLadder, droppedRoute];
    const uncovered = withDropped
      .filter((r) => !isCovered(r, apiRegistry, legacyServed))
      .map((r) => r.path);
    expect(uncovered).toContain('/api/__dropped-route-never-served__');
  });

  it('reports a real ladder path as covered via the legacy delegate arm', () => {
    // Positive contrast: a genuine ladder route is covered even with an empty
    // registry, through the legacy-served arm. Proves isCovered is not stuck-false.
    const served = legacyLadder.find((r) => legacyServes(r, legacyServed));
    expect(served).toBeDefined();
    if (served) expect(isCovered(served, apiRegistry, legacyServed)).toBe(true);
  });

  it('reports a route as covered via the router arm even with an empty legacy set', () => {
    // Forward-looking: once a route migrates into the registry, the router arm of
    // isCovered carries it even if the legacy arm is gone. Proves that arm is real.
    const ownedRegistry = createApiRegistry([
      { method: 'GET', path: '/api/owned/thing', surface: 'api', handler: async () => {} },
    ]);
    const ownedLadderRoute: LadderRoute = { method: 'GET', path: '/api/owned/thing' };
    expect(isRouterOwned(ownedRegistry, ownedLadderRoute)).toBe(true);
    expect(isCovered(ownedLadderRoute, ownedRegistry, new Set())).toBe(true);
  });
});

describe('registry self-consistency (vacuous now, forward-real)', () => {
  it('every registered route is complete (method, path, handler)', () => {
    expect(checkRouteCompleteness([...apiRoutes])).toEqual([]);
  });

  it('every account-owned :id route carries a requireOwned loader', () => {
    expect(checkRequireOwnedCoverage([...apiRoutes])).toEqual([]);
  });

  it('no account-owned route is shadowed by an earlier non-owned catch-all', () => {
    expect(() => assertNoOwnedRouteShadowing([...apiRoutes])).not.toThrow();
  });
});
