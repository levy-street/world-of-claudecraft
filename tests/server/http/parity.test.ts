// Old-vs-new /api dispatch parity.
//
// This harness proves the new in-house /api dispatcher is byte-for-byte identical
// to today. It replays a corpus of /api requests through routeHttpRequest under
// BOTH dispatch modes in-process (the API_DISPATCH flag forced to 'legacy' then
// to 'new' via the test-only setter) and diffs status + normalized body +
// contracted headers with the shared runParity driver.
//
// The parity contract as routes migrate: an un-migrated /api path still delegates
// to the legacy handleApi ladder UNCHANGED, so old and new resolve through the
// exact same handler and are byte-identical. A migrated route is byte-identical
// too UNLESS it carries a labeled known deviation. The public-reads migration was
// the first and landed two deviations: the /api/status name-list trim and the
// /api/realms + /api/search authz-gap-close. So the raw old-vs-new divergence list
// is no longer empty; the known-deviations filter removes exactly those, and any
// residual divergence is a real parity break.
//
// Determinism rules this file obeys (mirrors characterization.test.ts):
//   - It replays ONLY the db-free CONTRACT requests characterization.test.ts uses
//     for the MAIN /api surface (requests that return BEFORE any pool.query). The
//     pool-less test DATABASE_URL makes any db-touching arm either hang the poller
//     or return a pool-500 artifact, neither of which is the route contract, so
//     those db-dependent success paths are deliberately excluded (see SKIP notes
//     at the bottom).
//   - runParity resets every limiter bucket + the ratelimit clock + auth-failure
//     bucket before EACH dispatcher pass, so a limiter tripped on the old pass can
//     never bleed into the new pass and falsely register as a divergence. The
//     named-assertion captures below reuse the same per-pass isolation.
//   - The GitHub releases proxy does a network fetch; it is pinned deterministic
//     by stubbing global fetch to reject (the real graceful-degradation contract:
//     an unreachable GitHub yields an empty feed), exactly as characterization does.
//   - The /api/perf dev gate is forced OFF (ALLOW_DEV_COMMANDS='0') so GET /api/perf
//     deterministically falls through to the 404 unknown-endpoint arm on both passes.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DISCORD_MAX_PER_MINUTE,
  discordRateLimited,
  resetAuthFailures,
  resetCardUploadRateLimits,
  resetCharacterMutationRateLimits,
  resetDiscordRateLimits,
  resetPublicReadRateLimits,
  resetRateLimitClock,
  resetRateLimits,
  resetReportsCreateRateLimits,
  resetWalletLinkRateLimits,
  resetWocBalanceRateLimits,
} from '../../../server/ratelimit';
import { NATIVE_APP_ORIGINS } from '../../../server/web_login_guard';
import {
  captureResponse,
  type Dispatch,
  makeReq,
  normalizeResponse,
  type ParityFixture,
  type ParityReport,
  runParity,
  stableStringify,
} from '../helpers';
import { KNOWN_DEVIATIONS } from './known_deviations';

// db.ts reads DATABASE_URL at module scope (throws if unset); a dummy URL lets the
// bare server/main import resolve. The pool is constructed but never connects, so
// every contract request replayed here returns before touching it.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_phase9_parity';

// routeHttpRequest is synchronous fire-and-forget (void apiEntry(req, res)), so a
// dispatch must poll res.writableEnded before the captured triple is readable.
const MAX_POLL_TICKS = 5000;
// The /api/perf dev gate reads process.env.ALLOW_DEV_COMMANDS per request.
const DEV_COMMANDS_ENV = 'ALLOW_DEV_COMMANDS';
// Content-Length header sentinel: far above the player-card byte cap, so the
// pre-auth 413 fires before any db read.
const HEADER_CONTENT_LENGTH = 'content-length';
const OVERSIZE_CONTENT_LENGTH = '999999999';
const DISCORD_ENV_KEYS = [
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_GUILD_ID',
] as const;

function clearDiscordConfigEnv(): void {
  for (const key of DISCORD_ENV_KEYS) delete process.env[key];
}
// A CORS Origin the server reflects: a genuine member of the native-app allowlist,
// which maybeCors reflects regardless of the REALMS env (REALM_ORIGINS is empty in
// tests). Read from the source set so a change to the allowlist keeps the test honest.
const REFLECTED_ORIGIN = [...NATIVE_APP_ORIGINS][0];
// A public-cors path: isPublicCorsPath('/api/public/...') is true, so
// applyCorsAndPreflight applies the wide-open '*'. No /api/public/* handler exists,
// so the request also exercises the db-free 404 unknown-endpoint fallthrough.
const PUBLIC_CORS_PATH = '/api/public/does-not-exist';
// A representative non-public /api route, used for the reflected-origin and the
// preflight CORS assertions.
const REPRESENTATIVE_API_PATH = '/api/characters';

// A single request spec: the source of both a ParityFixture (name + factory) and
// the fixture-name -> request-path map used to match against KNOWN_DEVIATIONS.
interface ApiRequestSpec {
  name: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

// The db-free MAIN /api contract corpus. Each entry mirrors a specific it-block in
// tests/server/http/characterization.test.ts (the fixture name matches the golden
// name there), with the four dedicated CORS/preflight cases added on top. Error
// paths and the 404-vs-405 fallthroughs are included in full (weighted heaviest by
// the diff), since those are where a future migration is most likely to drift.
const API_REQUEST_CORPUS: readonly ApiRequestSpec[] = [
  // --- preflight + dispatcher fallthrough (characterization block 1) ---------
  { name: 'options_login_204', method: 'OPTIONS', url: '/api/login' },
  { name: 'site_presence_get_405', method: 'GET', url: '/api/site-presence' },
  { name: 'unknown_endpoint_404', method: 'GET', url: '/api/this-route-does-not-exist' },
  // GET /api/perf with the dev gate off (forced in beforeAll) is a 404.
  { name: 'perf_devgate_off_404', method: 'GET', url: '/api/perf' },

  // --- public read contracts, no db / empty cache (characterization block 2) --
  { name: 'status_get', method: 'GET', url: '/api/status' },
  { name: 'realms_get_noauth', method: 'GET', url: '/api/realms' },
  {
    name: 'native_attestation_challenge_post',
    method: 'POST',
    url: '/api/native-attestation/challenge',
    body: {},
  },

  // --- GitHub releases proxy, network stubbed to empty (characterization block 3)
  { name: 'releases_get_empty', method: 'GET', url: '/api/releases' },

  // --- leaderboard payload shapes, empty cache (characterization block 4) ------
  { name: 'leaderboard_default', method: 'GET', url: '/api/leaderboard' },
  { name: 'leaderboard_guilds', method: 'GET', url: '/api/leaderboard?board=guilds' },
  // ?board=devs (open-source contributor board, added by the release/v0.18.0 merge):
  // fetch is disabled in this harness so topContributors yields an empty snapshot on
  // BOTH passes, proving the migrated leaderboardHandler devs fork is byte-identical
  // to the legacy handleApi arm.
  { name: 'leaderboard_devs', method: 'GET', url: '/api/leaderboard?board=devs' },
  { name: 'leaderboard_scope_global', method: 'GET', url: '/api/leaderboard?scope=global' },
  { name: 'leaderboard_scope_realm', method: 'GET', url: '/api/leaderboard?scope=realm' },
  { name: 'leaderboard_limit5', method: 'GET', url: '/api/leaderboard?limit=5' },
  // HEAD parity: the table router synthesizes HEAD from GET, but the dispatcher
  // delegates a HEAD match to the legacy ladder (which 404s HEAD) so HEAD stays
  // byte-identical old-vs-new while the legacy arms are retained (serving HEAD as
  // GET is deferred to the ladder deletion). This pins it: a HEAD to a migrated
  // GET route must 404 on BOTH paths, with no divergence and no known-deviation.
  { name: 'leaderboard_head_404', method: 'HEAD', url: '/api/leaderboard' },

  // --- binary request class, player card (characterization block 5) -----------
  {
    name: 'card_too_large_413',
    method: 'POST',
    url: '/api/card',
    headers: { [HEADER_CONTENT_LENGTH]: OVERSIZE_CONTENT_LENGTH },
  },

  // --- email link endpoints, public, no token = no db (characterization block 6)
  { name: 'email_unsubscribe_no_token', method: 'GET', url: '/api/email/unsubscribe' },
  { name: 'email_verify_no_token_400', method: 'GET', url: '/api/account/email/verify' },

  // --- wrong-method fallthrough, planned 405 baseline (characterization block 7)
  { name: 'register_get_wrong_method_404', method: 'GET', url: '/api/register' },
  {
    name: 'me_characters_post_wrong_method_404',
    method: 'POST',
    url: '/api/me/characters',
    body: {},
  },

  // --- Discord contract paths, unconfigured / no auth (characterization block 8)
  {
    name: 'discord_start_unconfigured_503',
    method: 'POST',
    url: '/api/auth/discord/start',
    body: {},
  },
  { name: 'discord_status_get_noauth_401', method: 'GET', url: '/api/discord' },
  { name: 'discord_unlink_delete_noauth_401', method: 'DELETE', url: '/api/discord' },
  {
    name: 'discord_callback_error_bounce',
    method: 'GET',
    url: '/api/auth/discord/callback?code=x&state=y',
  },

  // --- bearer-auth denial contracts, no Authorization (characterization block 9)
  { name: 'characters_get_noauth_401', method: 'GET', url: '/api/characters' },
  { name: 'me_characters_get_noauth_401', method: 'GET', url: '/api/me/characters' },
  { name: 'account_get_noauth_401', method: 'GET', url: '/api/account' },
  { name: 'account_logout_post_noauth_401', method: 'POST', url: '/api/account/logout', body: {} },
  { name: 'wallet_get_noauth_401', method: 'GET', url: '/api/wallet' },
  { name: 'referrals_get_noauth_401', method: 'GET', url: '/api/referrals' },
  { name: 'reports_post_noauth_401', method: 'POST', url: '/api/reports', body: {} },
  // The public-reads authz-gap-close: /api/search is now anonymous-friendly, so a no-token
  // request serves 200 { results: [] } (empty query) instead of the legacy 401.
  // The query is intentionally dropped so the served path stays db-free (a
  // non-empty ?q would reach searchCharacters); old 401 vs new 200 is the
  // realmsSearchAuthzGapClose deviation the filter below expects.
  { name: 'search_get_noauth', method: 'GET', url: '/api/search' },
  { name: 'owner_sheet_get_noauth_401', method: 'GET', url: '/api/characters/1/sheet' },
  { name: 'standing_get_noauth_401', method: 'GET', url: '/api/characters/1/standing' },

  // --- register + login validation, empty body, pre-db (characterization block 10)
  { name: 'register_post_empty_400', method: 'POST', url: '/api/register', body: {} },
  { name: 'login_post_empty_401', method: 'POST', url: '/api/login', body: {} },

  // --- dedicated CORS / preflight cases (added on top of the characterization set)
  // A GET to a non-public /api route WITH a reflected Origin: exercises maybeCors's
  // reflected Access-Control-Allow-Origin + Vary on a real response body.
  {
    name: 'cors_reflected_origin_get',
    method: 'GET',
    url: '/api/status',
    headers: { origin: REFLECTED_ORIGIN },
  },
  // A GET to a public-cors path: exercises the wide-open '*' plus the 404 fallthrough.
  { name: 'cors_public_wildcard_get', method: 'GET', url: PUBLIC_CORS_PATH },
  // OPTIONS preflight WITH Origin + Access-Control-Request-Method for an /api path:
  // the 204 short-circuit plus the reflected CORS header set.
  {
    name: 'cors_preflight_api_204',
    method: 'OPTIONS',
    url: REPRESENTATIVE_API_PATH,
    headers: { origin: REFLECTED_ORIGIN, 'access-control-request-method': 'GET' },
  },
  // OPTIONS preflight for a public-cors path: the 204 short-circuit plus the '*' set.
  {
    name: 'cors_preflight_public_204',
    method: 'OPTIONS',
    url: PUBLIC_CORS_PATH,
    headers: { origin: REFLECTED_ORIGIN, 'access-control-request-method': 'GET' },
  },
];

// Fixture name -> request path (query stripped), for matching a divergence against
// KNOWN_DEVIATIONS.routes (which are path strings).
const PATH_FOR_FIXTURE = new Map(
  API_REQUEST_CORPUS.map((spec) => [spec.name, spec.url.split('?')[0]]),
);

function specToFixture(spec: ApiRequestSpec): ParityFixture {
  return {
    name: spec.name,
    req: () =>
      makeReq({ method: spec.method, url: spec.url, headers: spec.headers, body: spec.body }),
  };
}

// One request path matches a KNOWN_DEVIATIONS route pattern, treating a ':param'
// segment (e.g. /api/characters/:id/sheet) as a wildcard.
function pathMatchesRoute(actualPath: string, routePattern: string): boolean {
  const actual = actualPath.split('/');
  const pattern = routePattern.split('/');
  if (actual.length !== pattern.length) return false;
  return pattern.every((seg, i) => seg.startsWith(':') || seg === actual[i]);
}

function isKnownDeviationPath(path: string): boolean {
  return KNOWN_DEVIATIONS.some((d) => d.routes.some((route) => pathMatchesRoute(path, route)));
}

// Reset all limiter state + the ratelimit clock, mirroring runParity's per-pass
// isolation so the named-assertion captures below start from clean state too.
function isolate(): void {
  resetRateLimits();
  resetCardUploadRateLimits();
  resetWalletLinkRateLimits();
  resetDiscordRateLimits();
  resetWocBalanceRateLimits();
  resetPublicReadRateLimits();
  // Keep in lockstep with isolatePass: the per-account character-mutation
  // buckets are separate, so a create/rename/delete/takeover 429 on one pass must not
  // bleed into the next (harmless today, since no captureBothModes case mutates).
  resetCharacterMutationRateLimits();
  // The reports.create limiter bucket, likewise (the reports re-pin 401s at
  // activeGuard before the limiter, so this is lockstep hygiene, not load-bearing).
  resetReportsCreateRateLimits();
  resetAuthFailures();
  resetRateLimitClock();
}

type MainModule = typeof import('../../../server/main');

// A Dispatch that BAKES IN the /api dispatch mode: it flips the flag (legacy vs
// new) via the test-only setter, drives the real routeHttpRequest, then polls
// res.writableEnded (routeHttpRequest is synchronous fire-and-forget).
function makeModedDispatch(main: MainModule, mode: 'legacy' | 'new'): Dispatch {
  return async (req, res) => {
    main.setApiDispatchModeForTests(mode);
    main.routeHttpRequest(req, res);
    let ticks = 0;
    while (!(res as unknown as { writableEnded: boolean }).writableEnded) {
      if (ticks++ > MAX_POLL_TICKS) throw new Error('response never ended');
      await new Promise((r) => setImmediate(r));
    }
  };
}

let oldDispatch: Dispatch;
let newDispatch: Dispatch;
let report: ParityReport;
let savedDevCommands: string | undefined;
let savedDiscordEnv: Partial<Record<(typeof DISCORD_ENV_KEYS)[number], string | undefined>>;

// Capture one fixture request through BOTH modes, each preceded by a full limiter
// reset, and return the two normalized responses for a focused named assertion.
async function captureBothModes(reqFactory: () => ReturnType<typeof makeReq>): Promise<{
  oldCap: ReturnType<typeof normalizeResponse>;
  newCap: ReturnType<typeof normalizeResponse>;
}> {
  isolate();
  const oldCap = normalizeResponse(await captureResponse(oldDispatch, reqFactory()));
  isolate();
  const newCap = normalizeResponse(await captureResponse(newDispatch, reqFactory()));
  return { oldCap, newCap };
}

// Run one captureBothModes under a pinned env (set before both passes, restored
// after), so per-request env reads (the internal secret gates, the github
// feature config) are identical on the old and new pass.
async function captureWithEnv(
  env: Record<string, string | undefined>,
  reqFactory: () => ReturnType<typeof makeReq>,
): Promise<Awaited<ReturnType<typeof captureBothModes>>> {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await captureBothModes(reqFactory);
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

beforeAll(async () => {
  // Force the /api/perf dev gate off so GET /api/perf is a deterministic 404.
  savedDevCommands = process.env[DEV_COMMANDS_ENV];
  process.env[DEV_COMMANDS_ENV] = '0';
  savedDiscordEnv = {};
  for (const key of DISCORD_ENV_KEYS) {
    savedDiscordEnv[key] = process.env[key];
  }
  clearDiscordConfigEnv();
  // Pin the GitHub releases proxy deterministic (unreachable GitHub -> empty feed).
  vi.stubGlobal('fetch', () => Promise.reject(new Error('network disabled for parity harness')));

  const main = (await import('../../../server/main')) as MainModule;
  // server/db.ts loads .env during the main import, so clear again after import.
  clearDiscordConfigEnv();
  oldDispatch = makeModedDispatch(main, 'legacy');
  newDispatch = makeModedDispatch(main, 'new');

  const fixtures = API_REQUEST_CORPUS.map(specToFixture);
  report = await runParity({ oldDispatch, newDispatch, fixtures });
});

afterAll(async () => {
  const main = (await import('../../../server/main')) as MainModule;
  main.resetApiDispatchModeForTests();
  vi.unstubAllGlobals();
  if (savedDevCommands === undefined) delete process.env[DEV_COMMANDS_ENV];
  else process.env[DEV_COMMANDS_ENV] = savedDevCommands;
  for (const key of DISCORD_ENV_KEYS) {
    const value = savedDiscordEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('/api dispatch parity (legacy flag vs new flag)', () => {
  it('has zero UNEXPECTED divergences across the whole corpus (after the known-deviations filter)', () => {
    // Real routes are migrated onto the new dispatcher. For an un-migrated or a
    // parity-clean migrated route old-vs-new is byte-identical; the only permitted
    // divergences are the labeled known deviations (the /api/status name-list trim
    // and the /api/realms + /api/search authz-gap-close). A divergence on any other
    // route is a real parity break.
    const unexpected = report.divergences.filter(
      (d) => !isKnownDeviationPath(PATH_FOR_FIXTURE.get(d.fixture) ?? ''),
    );
    expect(unexpected, stableStringify(unexpected, 2)).toEqual([]);
  });

  it('the labeled deviations actually fire (the harness is not silently passing)', () => {
    // Positive control: the /api/status trim and the /api/search authz-gap-close
    // must each produce a raw old-vs-new divergence in the corpus, so the filtered
    // assertion above is meaningfully green rather than green because nothing ran.
    // (/api/realms does not appear here: its no-token body is unchanged; only a
    // present-invalid token, which this db-free corpus does not exercise, differs.)
    const deviatingPaths = new Set(
      report.divergences.map((d) => PATH_FOR_FIXTURE.get(d.fixture) ?? ''),
    );
    expect(deviatingPaths.has('/api/status'), stableStringify(report.divergences, 2)).toBe(true);
    expect(deviatingPaths.has('/api/search'), stableStringify(report.divergences, 2)).toBe(true);
    // Every raw divergence is a registered known-deviation path (no stray break).
    for (const path of deviatingPaths) {
      expect(isKnownDeviationPath(path), `unexpected divergence on ${path}`).toBe(true);
    }
  });

  // The wrong-method 405 { ok: false } heartbeat contract. NOTE on the request:
  // the perf-report/site-presence 405 { ok: false } shape is the shared
  // perfReportSitePresence405OkFalse deviation over BOTH /api/perf-report and
  // /api/site-presence. The db-free representative is GET /api/site-presence: it is
  // the exact request characterization uses for site_presence_get_405 and reaches
  // handleSitePresenceHeartbeat, which returns 405 before any db. (A non-POST
  // /api/perf-report instead falls through to the 404 unknown-endpoint arm in
  // main.ts, and a POST /api/perf-report reaches the db, so neither is a db-free
  // 405 contract path.)
  it('the 405 { ok: false } heartbeat contract is identical old-vs-new and is a 405', async () => {
    const { oldCap, newCap } = await captureBothModes(() =>
      makeReq({ method: 'GET', url: '/api/site-presence' }),
    );
    expect(oldCap.status).toBe(405);
    expect(newCap.status).toBe(oldCap.status);
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('GET /api/perf-report is identical old-vs-new and is a 404 (re-pins the masked /api/perf-report)', async () => {
    // Companion to the site-presence 405 re-pin above. /api/perf-report is listed in three
    // known deviations (perfReport200NotThrottle, perfReportSitePresence405OkFalse, and
    // reportsBodyValidationRemap), so the aggregate path-scoped filter marks the WHOLE
    // /api/perf-report path as a known deviation. A non-POST /api/perf-report is NOT the
    // handler's dead 405 { ok: false } branch: it resolves methodNotAllowed and the new
    // dispatcher delegates it to the legacy ladder, whose dispatch arm gates on POST, so a
    // GET falls through to the 404 unknown-endpoint arm (db-free) exactly as the legacy path
    // does. This dedicated assertion pins that 404 byte-identical on both flags, which the
    // masking would otherwise hide (mirrors the site-presence 405 + reports 401 re-pins).
    const { oldCap, newCap } = await captureBothModes(() =>
      makeReq({ method: 'GET', url: '/api/perf-report' }),
    );
    expect(oldCap.status).toBe(404);
    expect(newCap.status).toBe(oldCap.status);
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('GET /api/characters with no auth is identical old-vs-new and is a 401', async () => {
    const { oldCap, newCap } = await captureBothModes(() =>
      makeReq({ method: 'GET', url: '/api/characters' }),
    );
    expect(oldCap.status).toBe(401);
    expect(newCap.status).toBe(oldCap.status);
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('POST /api/reports with no auth is identical old-vs-new and is a 401 (re-pins the masked /api/reports)', async () => {
    // The migration registers POST /api/reports behind the shared legacy-body activeGuard
    // and lists /api/reports in the newLimiterReportsCreate + reportsBodyValidationRemap
    // deviations, which mark the whole path as a known deviation in the aggregate
    // filter. The reports_post_noauth_401 corpus request never reaches the limiter or
    // the body read (activeGuard 401s first, db-free), so it must stay byte-identical
    // old-vs-new; this dedicated assertion re-pins that identity the path-scoped filter
    // would otherwise mask (mirrors the card no-auth 401 re-pin). A no-bearer POST 401s
    // at activeGuard with { error: 'not authenticated' }, byte-identical on both paths.
    const { oldCap, newCap } = await captureBothModes(() =>
      makeReq({ method: 'POST', url: '/api/reports', body: {} }),
    );
    expect(oldCap.status).toBe(401);
    expect(newCap.status).toBe(oldCap.status);
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('the card pre-auth 413 + Connection: close is identical old-vs-new (re-pins the masked /api/card)', async () => {
    // The migration registers POST /api/card and lists it in the rateLimitedBodyToCode
    // deviation (its 429 body becomes a code), which marks the whole /api/card path
    // as a known deviation in the aggregate filter. The card_too_large_413 corpus
    // request never hits the limiter (it 413s pre-auth on Content-Length), so it must
    // stay byte-identical old-vs-new; this dedicated assertion re-pins that identity
    // the path-scoped filter would otherwise mask (mirrors the characters no-auth
    // re-pin above). The oversize Content-Length trips cardContentLengthGuard on the
    // new path exactly as the legacy pre-auth check does: 413 { error: 'image too
    // large' } with Connection: close, before auth and before any body read.
    const { oldCap, newCap } = await captureBothModes(() =>
      makeReq({
        method: 'POST',
        url: '/api/card',
        headers: { [HEADER_CONTENT_LENGTH]: OVERSIZE_CONTENT_LENGTH },
      }),
    );
    expect(oldCap.status).toBe(413);
    expect(newCap.status).toBe(oldCap.status);
    expect(oldCap.headers.connection).toBe('close');
    expect(newCap.headers.connection).toBe('close');
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  // The v0.20.0 map editor family is path-masked by its two deviation entries
  // (mapsAssetsRateLimitedBodyToCode / mapsAssetsIdParamDecode), so its
  // byte-identical db-free contracts are re-pinned here with dedicated
  // assertions, mirroring the /api/card re-pin above.

  it('the map-save pre-auth 413 + Connection: close is identical old-vs-new (re-pins the masked POST /api/maps)', async () => {
    const { oldCap, newCap } = await captureBothModes(() =>
      makeReq({
        method: 'POST',
        url: '/api/maps',
        headers: { [HEADER_CONTENT_LENGTH]: OVERSIZE_CONTENT_LENGTH },
      }),
    );
    expect(oldCap.status).toBe(413);
    expect(JSON.parse(String(oldCap.body)).error).toBe('map_too_large');
    expect(oldCap.headers.connection).toBe('close');
    expect(newCap.headers.connection).toBe('close');
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('the asset-upload pre-auth 413 + Connection: close is identical old-vs-new (re-pins the masked POST /api/assets)', async () => {
    const { oldCap, newCap } = await captureBothModes(() =>
      makeReq({
        method: 'POST',
        url: '/api/assets',
        headers: { [HEADER_CONTENT_LENGTH]: OVERSIZE_CONTENT_LENGTH },
      }),
    );
    expect(oldCap.status).toBe(413);
    expect(JSON.parse(String(oldCap.body)).error).toBe('asset_too_large');
    expect(oldCap.headers.connection).toBe('close');
    expect(newCap.headers.connection).toBe('close');
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('the owner maps list refuses no-auth with the identical db-free 401 old-vs-new', async () => {
    const { oldCap, newCap } = await captureBothModes(() =>
      makeReq({ method: 'GET', url: '/api/maps' }),
    );
    expect(oldCap.status).toBe(401);
    expect(newCap.status).toBe(oldCap.status);
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('an unauthenticated map save 401s identically old-vs-new (guard order: 413 precheck passed, 401 before the limiter)', async () => {
    const { oldCap, newCap } = await captureBothModes(() =>
      makeReq({ method: 'PUT', url: '/api/maps/5', body: {} }),
    );
    expect(oldCap.status).toBe(401);
    expect(newCap.status).toBe(oldCap.status);
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('a non-numeric map :id answers the ladder terminal 404 identically old-vs-new', async () => {
    // Legacy: mapIdMatch (\d+) rejects "abc" and the ladder falls to its terminal
    // 404. New: the registry owns GET /api/maps/:id, and the handler validates the
    // shape in-handler, answering the same body byte-for-byte (the parity-clean arm
    // the mapsAssetsIdParamDecode entry documents).
    const { oldCap, newCap } = await captureBothModes(() =>
      makeReq({ method: 'GET', url: '/api/maps/abc' }),
    );
    expect(oldCap.status).toBe(404);
    expect(JSON.parse(String(oldCap.body)).error).toBe('unknown endpoint');
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('a non-sha asset :file answers the ladder terminal 404 identically old-vs-new', async () => {
    const { oldCap, newCap } = await captureBothModes(() =>
      makeReq({ method: 'GET', url: '/api/assets/not-a-sha.glb' }),
    );
    expect(oldCap.status).toBe(404);
    expect(JSON.parse(String(oldCap.body)).error).toBe('unknown endpoint');
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('the card no-auth 401 is identical old-vs-new (completes the masked /api/card re-pin)', async () => {
    // The card 413 re-pin above covers the pre-auth short-circuit, but adding /api/card to the
    // rateLimitedBodyToCode deviation masks EVERY /api/card divergence in the aggregate filter.
    // A normal-size card POST with no bearer passes cardContentLengthGuard and 401s at
    // activeGuard (the same shared guard as the wallet routes), byte-identical on both paths.
    // This dedicated assertion re-pins that 401 so the masking cannot hide an auth-shape break.
    const { oldCap, newCap } = await captureBothModes(() =>
      makeReq({ method: 'POST', url: '/api/card' }),
    );
    expect(oldCap.status).toBe(401);
    expect(newCap.status).toBe(oldCap.status);
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  // ---- Discord re-pins ------------------------------------------
  // The newLimiterDiscord deviation lists /api/auth/discord/start,
  // /api/auth/discord/callback and /api/discord, so the aggregate path-scoped filter
  // masks EVERY divergence on those paths. The four discord corpus fixtures never hit
  // the limiter / isIpBlocked / a DB read (start + callback answer from a null
  // discordConfig; status + unlink 401 at the guard DB-free), so each must stay
  // byte-identical old-vs-new; these dedicated captureBothModes assertions re-pin that
  // identity the masking would otherwise hide (mirrors the reports/card re-pins).

  it('POST /api/auth/discord/start unconfigured is identical old-vs-new and is a 503 (re-pins masked /start)', async () => {
    // No DISCORD_CLIENT_ID in the harness env, so discordConfig() is null and
    // handleDiscordStart answers 503 { error: 'Discord integration is not configured' }
    // before the rate-limit; the new-path isIpBlocked gate passes (the harness IP is
    // not blocked), so both flags land the identical 503.
    const { oldCap, newCap } = await captureBothModes(() =>
      makeReq({ method: 'POST', url: '/api/auth/discord/start', body: {} }),
    );
    expect(oldCap.status).toBe(503);
    expect(newCap.status).toBe(oldCap.status);
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('GET /api/auth/discord/callback unconfigured is identical old-vs-new HTML bounce (re-pins masked /callback)', async () => {
    // discordConfig() null -> handleDiscordCallback answers the HTML bouncePage 503
    // { ok: false, mode: 'login', error: 'not_configured' } (never problem+json). The
    // new path passes the isIpBlocked gate first, so the bounce is byte-identical.
    const { oldCap, newCap } = await captureBothModes(() =>
      makeReq({ method: 'GET', url: '/api/auth/discord/callback' }),
    );
    expect(oldCap.status).toBe(503);
    expect(oldCap.headers['content-type']).toContain('text/html');
    expect(newCap.headers['content-type']).toContain('text/html');
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('GET /api/discord with no auth is identical old-vs-new and is a 401 (re-pins masked /api/discord)', async () => {
    // A no-bearer status read 401s at the shared activeGuard (DB-free) with
    // { error: 'not authenticated' }, byte-identical on both flags.
    const { oldCap, newCap } = await captureBothModes(() =>
      makeReq({ method: 'GET', url: '/api/discord' }),
    );
    expect(oldCap.status).toBe(401);
    expect(newCap.status).toBe(oldCap.status);
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('DELETE /api/discord with no auth is identical old-vs-new and is a 401 (completes the masked /api/discord re-pin)', async () => {
    // The unlink arm shares the same guard; a no-bearer DELETE 401s DB-free, so the
    // masking cannot hide an auth-shape break on either method of /api/discord.
    const { oldCap, newCap } = await captureBothModes(() =>
      makeReq({ method: 'DELETE', url: '/api/discord' }),
    );
    expect(oldCap.status).toBe(401);
    expect(newCap.status).toBe(oldCap.status);
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  // The two chooser routes (login/new + login/link) are ALSO masked by
  // newLimiterDiscord but have no corpus fixture (every non-429 branch reads the db:
  // the pending-login token lookup is the first thing after the body). Their one
  // deterministic, db-free branch is the shared handler self-limit (checked BEFORE
  // the body read on both the legacy arm and the RouteDef), so each is re-pinned by
  // draining the discord bucket before each pass and proving the 429 byte-identical.
  for (const chooserPath of ['/api/auth/discord/login/new', '/api/auth/discord/login/link']) {
    it(`POST ${chooserPath} with a drained bucket is identical old-vs-new and is a 429 (re-pins masked chooser route)`, async () => {
      const drainedCapture = async (dispatch: Dispatch) => {
        isolate();
        // handleDiscordLoginNew/Link self-limit with discordRateLimited(req, 0): the
        // ip bucket (127.0.0.1, same source as the fixture request) fills to the cap,
        // so the replayed request below is the over-cap attempt on BOTH modes.
        for (let i = 0; i < DISCORD_MAX_PER_MINUTE; i++) {
          discordRateLimited(makeReq({ method: 'POST', url: chooserPath }), 0);
        }
        return normalizeResponse(
          await captureResponse(dispatch, makeReq({ method: 'POST', url: chooserPath, body: {} })),
        );
      };
      const oldCap = await drainedCapture(oldDispatch);
      const newCap = await drainedCapture(newDispatch);
      expect(oldCap.status).toBe(429);
      expect(newCap.status).toBe(oldCap.status);
      expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
    });
  }

  it('CORS + OPTIONS preflight is byte-identical old-vs-new for an /api route and a public-cors path', async () => {
    // Representative /api route: maybeCors reflects the Origin, the 204 short-circuit
    // returns before the ladder.
    const apiPreflight = await captureBothModes(() =>
      makeReq({
        method: 'OPTIONS',
        url: REPRESENTATIVE_API_PATH,
        headers: { origin: REFLECTED_ORIGIN, 'access-control-request-method': 'GET' },
      }),
    );
    expect(apiPreflight.oldCap.status).toBe(204);
    expect(stableStringify(apiPreflight.newCap)).toBe(stableStringify(apiPreflight.oldCap));
    expect(apiPreflight.oldCap.headers['access-control-allow-origin']).toBe(REFLECTED_ORIGIN);
    expect(apiPreflight.oldCap.headers['access-control-allow-methods']).toBe(
      'GET, POST, PUT, DELETE, OPTIONS',
    );
    expect(apiPreflight.oldCap.headers['access-control-allow-headers']).toBe(
      'Authorization, Content-Type',
    );
    expect(apiPreflight.oldCap.headers.vary).toBe('Origin');

    // Public-cors path: the wide-open '*' set, the 204 short-circuit.
    const publicPreflight = await captureBothModes(() =>
      makeReq({
        method: 'OPTIONS',
        url: PUBLIC_CORS_PATH,
        headers: { origin: REFLECTED_ORIGIN, 'access-control-request-method': 'GET' },
      }),
    );
    expect(publicPreflight.oldCap.status).toBe(204);
    expect(stableStringify(publicPreflight.newCap)).toBe(stableStringify(publicPreflight.oldCap));
    expect(publicPreflight.oldCap.headers['access-control-allow-origin']).toBe('*');
    expect(publicPreflight.oldCap.headers['access-control-allow-methods']).toBe('GET, OPTIONS');
    expect(publicPreflight.oldCap.headers.vary).toBe('Origin');
  });
});

// -----------------------------------------------------------------------------
// /admin/api dual-path parity. The admin surface runs through its OWN
// flag-gated dispatcher (main.ts adminApiEntry) whose delegate is the legacy
// handleAdminApi, so makeModedDispatch (which flips the shared API_DISPATCH flag)
// drives the admin surface old-vs-new too. The admin authenticated reads/writes need
// Postgres (pool-less here), so this pins the DB-FREE deterministic admin contract
// paths: every one 401s at the admin gate (auth precedes route/method) OR answers the
// anonymous login's db-free 401, byte-identical on both flags. The two AUTH-GATED
// divergences the migration introduces (adminEnumInvalid422, adminIdParamDecode) are
// invisible here (an unauthenticated request 401s before the action/id decode on both
// paths); they are documented in known_deviations.ts and pinned with fakes in
// tests/server/admin.test.ts.
// -----------------------------------------------------------------------------

describe('/admin/api dispatch parity (legacy flag vs new flag)', () => {
  // Every non-login admin route answers the same db-free 401 to a missing bearer:
  // legacy adminAccountId gates before route match; the new path's requireAdmin gates
  // before the handler (and a notFound/methodNotAllowed/enum path delegates to the
  // legacy ladder, which gates identically). A representative spread across a read, an
  // ip-block write, the restructured enum route (valid AND invalid action), a wrong
  // method, a HEAD (the inherited HEAD-parity rule: a head:true match DELEGATES to the
  // legacy ladder, which gates auth before method, on the admin dispatcher too), and an
  // unknown endpoint.
  const NOAUTH_ADMIN_REQUESTS: ReadonlyArray<{
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD';
    url: string;
    label: string;
  }> = [
    { method: 'GET', url: '/admin/api/overview', label: 'a migrated read' },
    { method: 'POST', url: '/admin/api/blocked-ips', label: 'an ip-block write' },
    {
      method: 'POST',
      url: '/admin/api/moderation/accounts/5/suspend',
      label: 'the enum :action route (valid action)',
    },
    {
      method: 'POST',
      url: '/admin/api/moderation/accounts/5/frobnicate',
      label: 'the enum :action route (invalid action, auth-gated so no 422 leaks)',
    },
    {
      method: 'GET',
      url: '/admin/api/accounts/abc',
      label: 'a :id route with a non-numeric id (auth-gated so no 422 leaks)',
    },
    // Release v0.22.0 arrivals: the staff-identity reads/writes and the
    // bot-detector runtime-config family, all bearer-gated like every other
    // authed admin route (auth precedes the permission gate on both arms).
    { method: 'GET', url: '/admin/api/me', label: 'the staff self-identity read' },
    { method: 'GET', url: '/admin/api/staff', label: 'the staff list read' },
    { method: 'GET', url: '/admin/api/staff/history', label: 'the role-change audit read' },
    { method: 'POST', url: '/admin/api/staff/roles', label: 'the staff role write' },
    { method: 'GET', url: '/admin/api/provider-usage', label: 'the provider-usage read' },
    { method: 'GET', url: '/admin/api/antibot-config', label: 'the antibot-config read' },
    {
      method: 'GET',
      url: '/admin/api/antibot-config/history',
      label: 'the antibot-config audit read',
    },
    { method: 'POST', url: '/admin/api/antibot-config', label: 'the antibot-config write' },
    { method: 'PUT', url: '/admin/api/overview', label: 'a wrong method (delegates to legacy)' },
    {
      method: 'HEAD',
      url: '/admin/api/overview',
      label: 'a HEAD to a migrated GET (head match delegates to legacy; auth precedes method)',
    },
    {
      method: 'GET',
      url: '/admin/api/this-endpoint-does-not-exist',
      label: 'an unknown endpoint (auth precedes the 404 fallthrough)',
    },
  ];

  for (const { method, url, label } of NOAUTH_ADMIN_REQUESTS) {
    it(`${method} ${url} with no auth is identical old-vs-new and is a 401 (${label})`, async () => {
      const { oldCap, newCap } = await captureBothModes(() => makeReq({ method, url }));
      expect(oldCap.status).toBe(401);
      expect(newCap.status).toBe(oldCap.status);
      expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
    });
  }

  it('POST /admin/api/login with an empty body is identical old-vs-new and is a db-free 401', async () => {
    // login is anonymous (no admin gate); an empty body has no username string, so both
    // handleLogin and loginHandler answer 401 { ...error: 'invalid username or password' }
    // before findAccount (db-free), with a fresh rate-limit bucket (isolate resets it).
    const { oldCap, newCap } = await captureBothModes(() =>
      makeReq({ method: 'POST', url: '/admin/api/login', body: {} }),
    );
    expect(oldCap.status).toBe(401);
    expect(newCap.status).toBe(oldCap.status);
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });
});

// -----------------------------------------------------------------------------
// /oauth dual-path parity. The oauth surface runs through its OWN
// flag-gated dispatcher (main.ts oauthApiEntry) whose delegate is the legacy
// handleOAuth, so makeModedDispatch drives the oauth surface old-vs-new too. Only
// the 5 POST JSON routes are registered; the GET consent/device HTML pages, HEAD,
// wrong methods, and unknown paths all resolve off the table and DELEGATE, which
// these pins prove stays byte-identical. Every case is db-free: the handlers
// answer before any pool.query (an absent bearer fails fullSessionAccount's regex,
// an empty client_id short-circuits the client lookup, an empty grant_type answers
// before any code lookup, an empty revoke token skips the delete). The
// oauthBodyValidationRemap deviation (an unexpected throw's 500 body) is invisible
// here (a real throw needs a DB failure); it is pinned with fakes in
// tests/server/oauth.test.ts.
// -----------------------------------------------------------------------------

describe('/oauth dispatch parity (legacy flag vs new flag)', () => {
  const OAUTH_JSON_CASES: ReadonlyArray<{
    label: string;
    method: 'POST' | 'DELETE' | 'HEAD' | 'GET';
    url: string;
    body?: unknown;
    status: number;
  }> = [
    {
      label: 'token with an empty body answers 400 unsupported_grant_type',
      method: 'POST',
      url: '/oauth/token',
      body: {},
      status: 400,
    },
    {
      label: 'token grant=authorization_code without code/verifier answers 400 invalid_request',
      method: 'POST',
      url: '/oauth/token',
      body: { grant_type: 'authorization_code' },
      status: 400,
    },
    {
      label: 'authorize consent POST without a web session answers 401 access_denied',
      method: 'POST',
      url: '/oauth/authorize',
      body: {},
      status: 401,
    },
    {
      label: 'device approve POST without a web session answers 401 access_denied',
      method: 'POST',
      url: '/oauth/device',
      body: {},
      status: 401,
    },
    {
      label: 'revoke without a token is the RFC 7009 always-200 { ok: true }',
      method: 'POST',
      url: '/oauth/revoke',
      body: {},
      status: 200,
    },
    {
      label: 'device_authorization without a client_id answers 400 invalid_client',
      method: 'POST',
      url: '/oauth/device_authorization',
      body: {},
      status: 400,
    },
    {
      label: 'a wrong method on a migrated path delegates to the legacy 404 not_found',
      method: 'DELETE',
      url: '/oauth/token',
      status: 404,
    },
    {
      label: 'a HEAD to a migrated POST path delegates to the legacy 404 (no HEAD synthesis)',
      method: 'HEAD',
      url: '/oauth/authorize',
      status: 404,
    },
    {
      label: 'an unknown /oauth path delegates to the legacy 404 not_found',
      method: 'GET',
      url: '/oauth/this-endpoint-does-not-exist',
      status: 404,
    },
  ];

  for (const { label, method, url, body, status } of OAUTH_JSON_CASES) {
    it(`${method} ${url}: ${label}, identical old-vs-new`, async () => {
      const { oldCap, newCap } = await captureBothModes(() => makeReq({ method, url, body }));
      expect(oldCap.status).toBe(status);
      expect(newCap.status).toBe(oldCap.status);
      expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
    });
  }

  it('GET /oauth/authorize stays an HTML page served off the route table (delegated), identical old-vs-new', async () => {
    // No client_id, so renderAuthorize answers its db-free 400 htmlError page. The
    // registry resolves GET /oauth/authorize methodNotAllowed (only POST is
    // registered) and the dispatcher DELEGATES to the legacy handleOAuth ladder,
    // which renders the exact same HTML: the consent page never enters the table.
    const { oldCap, newCap } = await captureBothModes(() =>
      makeReq({ method: 'GET', url: '/oauth/authorize' }),
    );
    expect(oldCap.status).toBe(400);
    expect(oldCap.headers['content-type']).toContain('text/html');
    expect(newCap.headers['content-type']).toContain('text/html');
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('GET /oauth/device stays the HTML device page served off the route table (delegated), identical old-vs-new', async () => {
    const { oldCap, newCap } = await captureBothModes(() =>
      makeReq({ method: 'GET', url: '/oauth/device' }),
    );
    expect(oldCap.status).toBe(200);
    expect(oldCap.headers['content-type']).toContain('text/html');
    expect(newCap.headers['content-type']).toContain('text/html');
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });
});

// -----------------------------------------------------------------------------
// /internal dual-path parity. The internal surface runs through its OWN
// flag-gated dispatcher (main.ts internalApiEntry) whose delegate is the EXACT
// pre-migration composite (the /internal/daily-rewards/* ops family tried first,
// then handleInternalApi), so makeModedDispatch drives the internal surface
// old-vs-new too. The secret gates read their env var PER REQUEST, so each case
// pins its env inside the test and restores it; captureBothModes runs both passes
// under the same env. The presence and members-meta 200s are REAL authed passes
// through the migrated gate + handler (both are db-free: presence writes only the
// in-memory cache, an empty members list never touches Postgres). The authed
// restart-countdown 200/409 is NOT driven here (it would start a real countdown on
// the singleton GameServer); it is pinned with a fake runtime in
// tests/server/internal.test.ts, as is the internalBodyValidationRemap 500.
// -----------------------------------------------------------------------------

describe('/internal dispatch parity (legacy flag vs new flag)', () => {
  const DEPLOY_ENV = 'RESTART_COUNTDOWN_SECRET';
  const DISCORD_ENV = 'DISCORD_BOT_SECRET';
  const DEPLOY_HEADER = 'x-woc-deploy-secret';
  const DISCORD_HEADER = 'x-woc-discord-secret';
  const PARITY_SECRET = 'parity-internal-secret';

  it('POST /internal/restart-countdown with the env secret unset is the feature-off 404, identical old-vs-new', async () => {
    const { oldCap, newCap } = await captureWithEnv(
      { [DEPLOY_ENV]: undefined, [DISCORD_ENV]: undefined },
      () => makeReq({ method: 'POST', url: '/internal/restart-countdown', body: {} }),
    );
    expect(oldCap.status).toBe(404);
    expect(newCap.status).toBe(oldCap.status);
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('POST /internal/restart-countdown with a wrong secret is a 401, identical old-vs-new', async () => {
    const { oldCap, newCap } = await captureWithEnv({ [DEPLOY_ENV]: PARITY_SECRET }, () =>
      makeReq({
        method: 'POST',
        url: '/internal/restart-countdown',
        headers: { [DEPLOY_HEADER]: 'wrong-secret' },
        body: {},
      }),
    );
    expect(oldCap.status).toBe(401);
    expect(newCap.status).toBe(oldCap.status);
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('GET /internal/restart-countdown with the CORRECT secret stays the wrong-method 404 (never a 405), identical old-vs-new', async () => {
    // Legacy checks the method FIRST (a non-POST answers 404 'unknown endpoint'
    // before the gate); the new path resolves methodNotAllowed and DELEGATES to that
    // same legacy arm. The correct secret proves the 404 is method-driven, not
    // gate-driven, and that the table router's default 405 never surfaces.
    const { oldCap, newCap } = await captureWithEnv({ [DEPLOY_ENV]: PARITY_SECRET }, () =>
      makeReq({
        method: 'GET',
        url: '/internal/restart-countdown',
        headers: { [DEPLOY_HEADER]: PARITY_SECRET },
      }),
    );
    expect(oldCap.status).toBe(404);
    expect(newCap.status).toBe(oldCap.status);
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('GET /internal/discord/flex with the env secret unset is the feature-off 404, identical old-vs-new', async () => {
    const { oldCap, newCap } = await captureWithEnv({ [DISCORD_ENV]: undefined }, () =>
      makeReq({ method: 'GET', url: '/internal/discord/flex' }),
    );
    expect(oldCap.status).toBe(404);
    expect(newCap.status).toBe(oldCap.status);
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('GET /internal/discord/flex with a wrong secret is a 401, identical old-vs-new', async () => {
    const { oldCap, newCap } = await captureWithEnv({ [DISCORD_ENV]: PARITY_SECRET }, () =>
      makeReq({
        method: 'GET',
        url: '/internal/discord/flex',
        headers: { [DISCORD_HEADER]: 'wrong-secret' },
      }),
    );
    expect(oldCap.status).toBe(401);
    expect(newCap.status).toBe(oldCap.status);
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('POST /internal/discord/presence with the correct secret is an authed 200 through the migrated chain, identical old-vs-new', async () => {
    // A REAL gate-pass + handler run on both flags, db-free: an empty body clamps to
    // zero counts and the handler writes only the in-memory presence cache.
    const { oldCap, newCap } = await captureWithEnv({ [DISCORD_ENV]: PARITY_SECRET }, () =>
      makeReq({
        method: 'POST',
        url: '/internal/discord/presence',
        headers: { [DISCORD_HEADER]: PARITY_SECRET },
        body: {},
      }),
    );
    expect(oldCap.status).toBe(200);
    expect(JSON.parse(oldCap.body as string)).toEqual({
      success: true,
      data: { received: true },
      error: null,
    });
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('POST /internal/discord/members-meta with the correct secret and no members is an authed 200 { updated: 0 }, identical old-vs-new', async () => {
    const { oldCap, newCap } = await captureWithEnv({ [DISCORD_ENV]: PARITY_SECRET }, () =>
      makeReq({
        method: 'POST',
        url: '/internal/discord/members-meta',
        headers: { [DISCORD_HEADER]: PARITY_SECRET },
        body: {},
      }),
    );
    expect(oldCap.status).toBe(200);
    expect(JSON.parse(oldCap.body as string)).toEqual({
      success: true,
      data: { updated: 0 },
      error: null,
    });
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('an unknown /internal/discord subpath with the correct secret delegates to the legacy gate-then-404, identical old-vs-new', async () => {
    // Off the route table entirely: the dispatcher delegates, the legacy gate
    // passes, and the ladder's terminal arm answers 404 'unknown endpoint'.
    const { oldCap, newCap } = await captureWithEnv({ [DISCORD_ENV]: PARITY_SECRET }, () =>
      makeReq({
        method: 'GET',
        url: '/internal/discord/this-endpoint-does-not-exist',
        headers: { [DISCORD_HEADER]: PARITY_SECRET },
      }),
    );
    expect(oldCap.status).toBe(404);
    expect(newCap.status).toBe(oldCap.status);
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('a HEAD to a migrated internal GET delegates to the legacy gate (feature-off 404), identical old-vs-new', async () => {
    // The router synthesizes HEAD from GET (head: true), and the dispatcher
    // delegates a head match to the legacy ladder, where the unset env answers the
    // feature-off 404 exactly as a GET would (Node suppresses the HEAD body).
    const { oldCap, newCap } = await captureWithEnv({ [DISCORD_ENV]: undefined }, () =>
      makeReq({ method: 'HEAD', url: '/internal/discord/flex' }),
    );
    expect(oldCap.status).toBe(404);
    expect(newCap.status).toBe(oldCap.status);
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('a daily-rewards ops path is answered by the FIRST composite arm (its own gate 401, never the ladder 404), identical old-vs-new', async () => {
    // The /internal/daily-rewards/* ops family must be tried BEFORE handleInternalApi:
    // its own x-woc-daily-reward-secret gate fails CLOSED (401 'not authenticated'
    // when its env secret is unset), whereas the ladder would answer its terminal
    // 404 'unknown endpoint' for this path. If the composite ordering ever flipped,
    // this pin catches it on the LEGACY pass. Since the late-arrival migration the
    // route is ALSO on the table: under 'new' the matched RouteDef's fail-closed
    // requireInternalSecretFailClosed gate answers the SAME 401 byte-for-byte, so
    // the pin now proves gate-parity under 'new' AND composite ordering under
    // 'legacy'; db-free (both gates reject before any query).
    const { oldCap, newCap } = await captureWithEnv(
      { WOC_DAILY_REWARD_SERVICE_SECRET: undefined },
      () => makeReq({ method: 'POST', url: '/internal/daily-rewards/pending-payouts', body: {} }),
    );
    expect(oldCap.status).toBe(401);
    expect(JSON.parse(oldCap.body as string)).toEqual({
      success: false,
      data: null,
      error: 'not authenticated',
    });
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('an /internal path outside both families falls through the whole composite to 404, identical old-vs-new', async () => {
    // Not daily-rewards (the ops family returns false), not a registered route: the
    // new path delegates to the composite, which lands handleInternalApi's terminal
    // 404 'unknown endpoint' with no gate involved, byte-identical.
    const { oldCap, newCap } = await captureWithEnv(
      { [DEPLOY_ENV]: undefined, [DISCORD_ENV]: undefined },
      () => makeReq({ method: 'GET', url: '/internal/this-endpoint-does-not-exist' }),
    );
    expect(oldCap.status).toBe(404);
    expect(newCap.status).toBe(oldCap.status);
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });
});

// -----------------------------------------------------------------------------
// The release-merge late-arrival families (github, desktop-login,
// daily-rewards), dual-path pins. Every route below carries a late-arrival known
// deviation (the *BodyValidationRemap hang-counterfactual class), which MASKS
// its whole path in the corpus-wide known-deviations filter above, so these
// dedicated captureBothModes assertions re-pin the db-free contract points
// byte-identical old-vs-new (the reports/discord re-pin rule; the head-parity
// gotcha). All cases are db-free: the no-auth 401s reject a missing bearer
// before any resolver, the github callback answers its unconfigured 503 before
// any state read, the exchange 401 is an in-process Map miss, and the ops
// mark-payout 400 validates before its first query.
// -----------------------------------------------------------------------------

describe('/api + /internal late-arrival dispatch parity (legacy flag vs new flag)', () => {
  const GITHUB_ID_ENV = 'GITHUB_OAUTH_CLIENT_ID';
  const GITHUB_SECRET_ENV = 'GITHUB_OAUTH_CLIENT_SECRET';
  const DAILY_ENV = 'WOC_DAILY_REWARD_SERVICE_SECRET';
  const DAILY_HEADER = 'x-woc-daily-reward-secret';
  const PARITY_SECRET = 'parity-daily-reward-secret';

  // The no-auth 401 pins: both paths reject a missing bearer db-free with the
  // legacy { error: 'not authenticated' } body (legacy arm: bearerActiveAccount;
  // new path: the shared createActiveGuard), including the desktop-login create
  // arm's full-scope fix, which is identical on BOTH paths by design.
  const NOAUTH_18B_REQUESTS: ReadonlyArray<{ method: string; url: string; body?: unknown }> = [
    { method: 'POST', url: '/api/auth/github/start', body: {} },
    { method: 'GET', url: '/api/github' },
    { method: 'DELETE', url: '/api/github' },
    { method: 'POST', url: '/api/desktop-login/create', body: {} },
    { method: 'GET', url: '/api/daily-rewards' },
    { method: 'GET', url: '/api/daily-rewards/leaderboard' },
    { method: 'POST', url: '/api/daily-rewards/spin', body: {} },
    { method: 'GET', url: '/api/daily-rewards/history' },
    // The v0.20.0 account arrival rides the same masked family (the
    // accountBodyValidationRemap deviation), so its db-free 401 is re-pinned here.
    { method: 'POST', url: '/api/account/email/set-initial', body: {} },
    // The prefix-arm oddities stay delegate-served: an unknown subpath and the
    // no-slash sibling resolve unmatched, delegate to the ladder's startsWith
    // arm, and 401 before the in-family 404, byte-identical.
    { method: 'GET', url: '/api/daily-rewards/unknown-subpath' },
    { method: 'GET', url: '/api/daily-rewardsx' },
  ];

  for (const { method, url, body } of NOAUTH_18B_REQUESTS) {
    it(`${method} ${url} with no auth is identical old-vs-new and is a 401`, async () => {
      const { oldCap, newCap } = await captureBothModes(() => makeReq({ method, url, body }));
      expect(oldCap.status).toBe(401);
      expect(JSON.parse(oldCap.body as string)).toEqual({
        error: 'not authenticated',
        code: 'auth.required',
      });
      expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
    });
  }

  it('DELETE /api/daily-rewards (wrong method on a registered path) delegates to the prefix arm (auth 401, never a 405), identical old-vs-new', async () => {
    // The registry resolves methodNotAllowed (only GET is registered) and the
    // dispatcher DELEGATES to the legacy startsWith prefix arm, which is method-
    // agnostic: auth first (401 db-free with no bearer), so the table router's
    // 405 never surfaces while the ladder is retained.
    const { oldCap, newCap } = await captureBothModes(() =>
      makeReq({ method: 'DELETE', url: '/api/daily-rewards' }),
    );
    expect(oldCap.status).toBe(401);
    expect(JSON.parse(oldCap.body as string)).toEqual({
      error: 'not authenticated',
      code: 'auth.required',
    });
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('HEAD /api/daily-rewards delegates to the legacy ladder (auth 401, no HEAD-as-GET), identical old-vs-new', async () => {
    // The router synthesizes HEAD from the registered GET, and the dispatcher
    // delegates a head match to the legacy ladder (the standing HEAD rule), where
    // the prefix arm's bearerActiveAccount answers 401 with the body suppressed.
    const { oldCap, newCap } = await captureBothModes(() =>
      makeReq({ method: 'HEAD', url: '/api/daily-rewards' }),
    );
    expect(oldCap.status).toBe(401);
    expect(newCap.status).toBe(oldCap.status);
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('GET /api/auth/github/callback with the feature unconfigured is the 503 HTML bounce, identical old-vs-new', async () => {
    // No GITHUB_OAUTH_CLIENT_ID/SECRET, so handleGitHubCallback answers the
    // not_configured bounce page before its rate limit or any state read. The
    // RouteDef carries meta.envelope 'html'; the normal-path response here is the
    // handler's own bouncePage on both passes, byte-identical HTML.
    const { oldCap, newCap } = await captureWithEnv(
      { [GITHUB_ID_ENV]: undefined, [GITHUB_SECRET_ENV]: undefined },
      () => makeReq({ method: 'GET', url: '/api/auth/github/callback?code=x&state=y' }),
    );
    expect(oldCap.status).toBe(503);
    expect(oldCap.headers['content-type']).toContain('text/html');
    expect(newCap.headers['content-type']).toContain('text/html');
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('POST /api/auth/github/callback (wrong method on the migrated html page) delegates to the ladder 404, identical old-vs-new', async () => {
    // Only GET is registered for the callback, so the registry resolves
    // methodNotAllowed and the dispatcher DELEGATES; the exact-path ladder arm
    // gates on GET, so a POST falls through to the terminal 404, byte-identical.
    // At the ladder deletion this shape flips to the table 405 (the
    // systemic planned405BeforeAuth framing; named in the state.md ladder-deletion
    // carve-out at the late-arrival QA gate).
    const { oldCap, newCap } = await captureBothModes(() =>
      makeReq({ method: 'POST', url: '/api/auth/github/callback', body: {} }),
    );
    expect(oldCap.status).toBe(404);
    expect(JSON.parse(oldCap.body as string)).toEqual({ error: 'unknown endpoint' });
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('POST /api/desktop-login/exchange with an invalid code is a db-free 401, identical old-vs-new', async () => {
    // consumeDesktopLoginCode rejects the malformed code shape against the
    // in-process Map (no db); both paths answer the legacy 401 prose the client
    // matcher keys on (errors.api.desktopCodeInvalid).
    const { oldCap, newCap } = await captureBothModes(() =>
      makeReq({ method: 'POST', url: '/api/desktop-login/exchange', body: { code: 'nope' } }),
    );
    expect(oldCap.status).toBe(401);
    expect(JSON.parse(oldCap.body as string)).toEqual({
      error: 'invalid or expired desktop login code',
    });
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('the fused register/login/desktop-login per-IP budget is ONE bucket, limiter before auth, identical old-vs-new', async () => {
    // Drain the shared default rateLimited(req) bucket with /api/login posts
    // (db-free 401s: empty username never reaches findAccount), then hit
    // desktop-login exchange: it must answer the fused 429 WITHOUT touching the
    // code store, proving the three paths share one budget and the limiter runs
    // before auth. 25 drains overshoot the 20/min default so the pin cannot go
    // stale on an off-by-one.
    const FUSED_DRAIN_REQUESTS = 25;
    async function drainThenExchange(
      dispatch: typeof oldDispatch,
    ): Promise<ReturnType<typeof normalizeResponse>> {
      isolate();
      for (let i = 0; i < FUSED_DRAIN_REQUESTS; i++) {
        await captureResponse(dispatch, makeReq({ method: 'POST', url: '/api/login', body: {} }));
      }
      return normalizeResponse(
        await captureResponse(
          dispatch,
          makeReq({ method: 'POST', url: '/api/desktop-login/exchange', body: { code: 'x' } }),
        ),
      );
    }
    const oldCap = await drainThenExchange(oldDispatch);
    const newCap = await drainThenExchange(newDispatch);
    expect(oldCap.status).toBe(429);
    expect(JSON.parse(oldCap.body as string)).toEqual({
      error: 'too many attempts, wait a minute and try again',
      code: 'auth.too_many_attempts',
    });
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('POST /internal/daily-rewards/pending-payouts with a wrong secret is the fail-closed 401, identical old-vs-new', async () => {
    const { oldCap, newCap } = await captureWithEnv({ [DAILY_ENV]: PARITY_SECRET }, () =>
      makeReq({
        method: 'POST',
        url: '/internal/daily-rewards/pending-payouts',
        headers: { [DAILY_HEADER]: 'wrong-secret' },
        body: {},
      }),
    );
    expect(oldCap.status).toBe(401);
    expect(JSON.parse(oldCap.body as string)).toEqual({
      success: false,
      data: null,
      error: 'not authenticated',
    });
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('POST /internal/daily-rewards/payout-history with a wrong secret is the fail-closed 401, identical old-vs-new', async () => {
    // Its own re-pin (the dailyRewardsOpsBodyValidationRemap deviation masks this
    // path in the corpus filter too): the wrong-secret 401 is the route's only
    // db-free branch, byte-identical through the RouteDef gate ('new') and the
    // composite's in-handler gate ('legacy').
    const { oldCap, newCap } = await captureWithEnv({ [DAILY_ENV]: PARITY_SECRET }, () =>
      makeReq({
        method: 'POST',
        url: '/internal/daily-rewards/payout-history',
        headers: { [DAILY_HEADER]: 'wrong-secret' },
        body: {},
      }),
    );
    expect(oldCap.status).toBe(401);
    expect(JSON.parse(oldCap.body as string)).toEqual({
      success: false,
      data: null,
      error: 'not authenticated',
    });
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('POST /internal/daily-rewards/leaderboard with a wrong secret is the fail-closed 401, identical old-vs-new', async () => {
    // The v0.20.0 ops arrival: same masked family, same re-pin as its siblings.
    // The wrong-secret 401 is the route's only db-free branch, byte-identical
    // through the RouteDef gate ('new') and the composite's in-handler gate
    // ('legacy').
    const { oldCap, newCap } = await captureWithEnv({ [DAILY_ENV]: PARITY_SECRET }, () =>
      makeReq({
        method: 'POST',
        url: '/internal/daily-rewards/leaderboard',
        headers: { [DAILY_HEADER]: 'wrong-secret' },
        body: {},
      }),
    );
    expect(oldCap.status).toBe(401);
    expect(JSON.parse(oldCap.body as string)).toEqual({
      success: false,
      data: null,
      error: 'not authenticated',
    });
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('GET /internal/daily-rewards/pending-payouts with the CORRECT secret stays the in-family 404 (never a 405), identical old-vs-new', async () => {
    // Wrong method: the registry resolves methodNotAllowed (only POST is
    // registered) and DELEGATES to the composite, whose first arm gates then
    // answers the in-family 404 'unknown endpoint', exactly as legacy.
    const { oldCap, newCap } = await captureWithEnv({ [DAILY_ENV]: PARITY_SECRET }, () =>
      makeReq({
        method: 'GET',
        url: '/internal/daily-rewards/pending-payouts',
        headers: { [DAILY_HEADER]: PARITY_SECRET },
      }),
    );
    expect(oldCap.status).toBe(404);
    expect(JSON.parse(oldCap.body as string)).toEqual({
      success: false,
      data: null,
      error: 'unknown endpoint',
    });
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('POST /internal/daily-rewards/mark-payout with the correct secret and an empty body is a db-free 400 through the migrated chain, identical old-vs-new', async () => {
    // A REAL gate-pass + handler run on both flags: markPayout validates the
    // payout target before its first query, so the 400 'invalid payout target'
    // admin-envelope body is db-free and proves the registered route serves the
    // same core as the composite arm.
    const { oldCap, newCap } = await captureWithEnv({ [DAILY_ENV]: PARITY_SECRET }, () =>
      makeReq({
        method: 'POST',
        url: '/internal/daily-rewards/mark-payout',
        headers: { [DAILY_HEADER]: PARITY_SECRET },
        body: {},
      }),
    );
    expect(oldCap.status).toBe(400);
    expect(JSON.parse(oldCap.body as string)).toEqual({
      success: false,
      data: null,
      error: 'invalid payout target',
    });
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });

  it('an unknown /internal/daily-rewards subpath with the correct secret delegates to the gate-then-404, identical old-vs-new', async () => {
    // Off the route table: the dispatcher delegates, the composite's first arm
    // gates (pass) and answers the in-family 404, byte-identical. The family-wide
    // pre-path gate is a ladder-deletion handoff (see dailyRewardsOpsBodyValidationRemap).
    const { oldCap, newCap } = await captureWithEnv({ [DAILY_ENV]: PARITY_SECRET }, () =>
      makeReq({
        method: 'POST',
        url: '/internal/daily-rewards/this-endpoint-does-not-exist',
        headers: { [DAILY_HEADER]: PARITY_SECRET },
        body: {},
      }),
    );
    expect(oldCap.status).toBe(404);
    expect(newCap.status).toBe(oldCap.status);
    expect(stableStringify(newCap)).toBe(stableStringify(oldCap));
  });
});

// -----------------------------------------------------------------------------
// SKIPPED requests (present in characterization.test.ts or on the surface, but not
// replayed here) and why:
//   - GET /api/project-stats, GET /api/arena/leaderboard, GET /api/woc/balance,
//     GET /api/email/unsubscribe?token=<non-empty>, GET /api/search WITH a bearer,
//     and every populated leaderboard/character/account success body: all reach
//     pool.query against the pool-less test db (hang or pool-500), so they are not
//     db-free contract paths. Deferred exactly as characterization defers them.
//   - GET /api/auth/discord/callback SUCCESS bounce: embeds a live session token in
//     inlined HTML the normalizer returns verbatim (non-deterministic + a privacy
//     flag); only the error bounce is replayed.
//   - The /admin/api authenticated reads/writes: they reach pool.query against the
//     pool-less test db. The admin surface runs through its own flag-gated
//     dispatcher, so the DB-FREE admin contract paths ARE replayed old-vs-new in the
//     '/admin/api dispatch parity' block above (the 401 gate + the login db-free 401);
//     only the authed bodies are deferred, exactly as characterization defers them.
//   - The /oauth/* and /internal/* db-touching success paths (a real token exchange,
//     a consent approval, the discord flex/roles/grant/member/relay/activity/winners
//     reads and writes, the authed restart-countdown): all reach pool.query or the
//     singleton GameServer. Both surfaces run through their own
//     flag-gated dispatchers, so the DB-FREE contract paths ARE replayed old-vs-new
//     in the '/oauth dispatch parity' and '/internal dispatch parity' blocks above
//     (including two real gate-pass 200s: presence and members-meta); only the
//     db-touching bodies are deferred, exactly as characterization defers them, and
//     pinned with fakes in tests/server/oauth.test.ts + tests/server/internal.test.ts.
//   - The late-arrival authed success bodies (an authed github start/status/unlink, a
//     desktop-login create 200 mint, the daily-rewards status/spin/history 200s, the
//     ops pending-payouts/payout-history 200s): all resolve a bearer or read payouts
//     against the pool-less db. The db-free contract points ARE replayed old-vs-new
//     in the late-arrival block above (incl. one real ops gate-pass through the
//     migrated chain: the mark-payout 400); the success bodies are pinned with fakes
//     in tests/server/{github,desktop_login,daily_rewards_routes}.test.ts.
// -----------------------------------------------------------------------------
