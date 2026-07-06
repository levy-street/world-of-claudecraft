// Reports + telemetry route layer, ported onto RouteDefs.
//
// The four leftover write/telemetry endpoints move off the inline handleApi
// ladder in server/main.ts onto the shared server/http/ pipeline the registry
// dispatcher serves under API_DISPATCH 'new':
//   POST /api/reports        player report submission (account-gated write)
//   POST /api/bug-reports     in-game bug report capture (account-gated write)
//   POST /api/perf-report     client perf beacon (public telemetry)
//   POST /api/site-presence   site-presence heartbeat (public telemetry)
// The legacy handleApi arms stay in main.ts as the flag-off rollback path until the
// ladder-deletion PR (next release). This follows the server/wallet.ts +
// server/account.ts template:
//
//  - PARITY-FIRST bodies. The migrated handlers write the SAME legacy { error }
//    and { ok } bodies byte-for-byte (deliberately NOT problem+json; the client
//    prose-matcher in src/main.ts userFacingApiError, plus the hud.ts / options
//    window report/bug matchers, key on the exact legacy prose). So the
//    auth gate is the shared legacy-body createActiveGuard (mirrors
//    bearerActiveAccount: full-session, read-only 403, moderation 403), NOT the
//    problem+json requireAccount middleware (which would change the 401/403 shape
//    and break the reports_post_noauth_401 golden + the live client matcher).
//
//  - SELF-READ bodies. The report + bug handlers self-read their body (reports via
//    readBody at the default cap; bug reports via readBody at a 1 MB cap with the
//    same try/catch that answers 413 { error: 'bug report too large' } / 400
//    { error: 'bad request' }), and the two telemetry handlers self-read inside
//    handlePerfReport / handleSitePresenceHeartbeat, so NO withBody middleware is
//    composed (it would double-consume the stream). The ONLY framework-error
//    divergence is the 500 body SHAPE: an unexpected throw (a readBody reject on an
//    over-cap/malformed body, or a non-rate-limit createBugReport throw) surfaces
//    through the withErrors boundary as 500 application/problem+json
//    (internal.error) instead of the legacy outer-catch 500 { error: 'internal
//    error' }. Same 500 STATUS, different body; recorded as the
//    reportsBodyValidationRemap known deviation, leak-free.
//
//  - NEW reports.create limiter. POST /api/reports had no dedicated limiter (only
//    the full session + the per-target 12h duplicate window). A coarse per-account
//    limiter is added as a rateLimit(REPORTS_CREATE_POLICY) middleware mounted
//    AFTER activeGuard (the fused ip+account limiter reads ctx.account), throwing a
//    coded 429 rate_limit.exceeded. It is the newLimiterReportsCreate known
//    deviation (a 429 where none was); the code already exists (no catalog append).
//    Bug reports keep their EXISTING handler-level BugReportRateLimitError -> 429
//    { error: 'too many bug reports, try again later' } (createBugReport self-limits
//    at BUG_REPORT_RATE_LIMIT = 5/hour); that is NOT re-implemented here.
//
//  - TELEMETRY 405 ownership + 200-on-throttle preserved. perf-report and
//    site-presence are registered POST-only. A non-POST request resolves
//    methodNotAllowed and the registry dispatcher DELEGATES it to the legacy ladder
//    (retained for rollback), so GET /api/site-presence keeps its handler-owned 405
//    { ok: false, error: 'method not allowed' } and GET /api/perf-report keeps its
//    legacy 404 fall-through (its dispatch arm gates on POST, so its internal 405
//    { ok: false } branch is unreachable through the dispatcher, exactly as today).
//    The router never synthesizes a generic 405 for these while the legacy arms
//    stand. perf-report's 200-on-throttle (rateLimitedPerfReport /
//    shouldStorePerfReport both answer 200, never 429) stays inside handlePerfReport
//    unchanged. site-presence stays reachable independent of REQUIRE_WEB_LOGIN (it
//    carries no auth guard and the web-login prologue only ever gated register /
//    login). Neither telemetry route requires auth.
//
//  - RUNTIME injection. The report handler needs game.reportTargetForPid (a
//    main.ts-local singleton) to resolve a live-target report; it is injected once
//    at boot via configureReportsRuntime, so `export const routes` stays a static
//    array registry.ts can spread. The guard's db reads (accountAndScopeForToken,
//    moderationStatusForAccount) are bundled behind setReportsDbForTests; every
//    other domain function (getCharacter, findCharacterReportTargetByName,
//    createPlayerReport, createBugReport) keeps its direct db import, driven in
//    unit tests via vi.mock.

import { BUG_DESCRIPTION_MAX, BugReportRateLimitError, createBugReport } from './bug_report_db';
import {
  accountAndScopeForToken,
  findCharacterReportTargetByName,
  getCharacter,
  moderationStatusForAccount,
} from './db';
import { ctxAccountId } from './http/context';
import { type BearerActiveGuardDb, createActiveGuard } from './http/middleware/bearer_active_guard';
import { REPORTS_CREATE_POLICY, rateLimit } from './http/middleware/rate_limit';
import type { Ctx, RouteDef } from './http/types';
import { json, readBody } from './http_util';
import { cleanReportReason, createPlayerReport, type LiveReportTarget } from './moderation_db';
import { handlePerfReport } from './perf_report';
import { REALM } from './realm';
import { resolveReportTarget } from './report_target';
import { handleSitePresenceHeartbeat } from './site_presence';

// A downscaled screenshot data URL dominates a bug-report payload, so it gets a
// roomier cap (1 MiB) than the 64 KB JSON default (matching the legacy
// /api/bug-reports arm). Owned here as the single source of truth: server/main.ts
// imports it for the legacy arm's readBody cap so the two can never drift.
export const BUG_REPORT_MAX_BODY_BYTES = 1024 * 1024;

// ---------------------------------------------------------------------------
// Runtime injection. registry.ts spreads the static `routes` array at module load,
// before main.ts has booted the GameServer, so the report handler cannot close over
// `game` directly (that would be a cycle: main -> registry -> reports -> main).
// main.ts injects the live report-target lookup once at boot via
// configureReportsRuntime; a request never arrives before that runs. It is the exact
// (pid) => game.reportTargetForPid(pid) the legacy /api/reports arm passed to
// resolveReportTarget.
// ---------------------------------------------------------------------------

/** The main.ts game-session hook the report handler needs (the live report target). */
export interface ReportsGameHooks {
  /** The live report target for an online player id, or null when it is offline. */
  reportTargetForPid(pid: number): LiveReportTarget | null;
}

let runtime: ReportsGameHooks | null = null;

/** Inject the main.ts game-session hook the report handler needs (boot). */
export function configureReportsRuntime(rt: ReportsGameHooks): void {
  runtime = rt;
}

/** Clear the injected runtime so a unit test can install its own fake. */
export function resetReportsRuntimeForTests(): void {
  runtime = null;
}

/** The injected runtime, or a loud failure if a request somehow beat boot wiring. */
function useRuntime(): ReportsGameHooks {
  if (runtime === null) {
    throw new Error('reports runtime is not configured; call configureReportsRuntime');
  }
  return runtime;
}

// ---------------------------------------------------------------------------
// Db seam + bearer guard. The guard's bearer + moderation reads are bundled once
// behind a test-only setter so the guard can be driven with a fake and no Postgres;
// production never calls the setter. The guard itself is the shared, legacy-body
// createActiveGuard (mirrors bearerActiveAccount), reading the LIVE bundle each
// request via the () => reportsDb getter, so setReportsDbForTests takes effect.
// ---------------------------------------------------------------------------

const REAL_REPORTS_DB = { accountAndScopeForToken, moderationStatusForAccount };
let reportsDb: BearerActiveGuardDb = REAL_REPORTS_DB;

/** Override the reports guard db with a fake (test-only; merges over the real reads). */
export function setReportsDbForTests(overrides: Partial<typeof REAL_REPORTS_DB>): void {
  reportsDb = { ...REAL_REPORTS_DB, ...overrides };
}

/** Restore the real reports guard db after a setReportsDbForTests override (test-only). */
export function resetReportsDbForTests(): void {
  reportsDb = REAL_REPORTS_DB;
}

/** Mutating + account-scoped gate (mirrors server/main.ts bearerActiveAccount). */
const activeGuard = createActiveGuard(() => reportsDb);

// ---------------------------------------------------------------------------
// Thin Ctx handlers. Each resolves the account from the Ctx (activeGuard set it),
// self-reads its body, and reproduces the legacy validation ladder + bodies exactly.
// ---------------------------------------------------------------------------

/** POST /api/reports: submit a player report (account-gated, rate-limited by middleware). */
async function reportsHandler(ctx: Ctx): Promise<void> {
  const accountId = ctxAccountId(ctx);
  const body = (await readBody(ctx.req)) as Record<string, unknown>;
  const reason = cleanReportReason(body.reason);
  if (!reason) return json(ctx.res, 400, { error: 'choose a report reason' });
  const reporterCharacterId = Number(body.reporterCharacterId);
  if (!Number.isFinite(reporterCharacterId)) {
    return json(ctx.res, 400, { error: 'invalid report target' });
  }
  const reporter = await getCharacter(accountId, reporterCharacterId);
  if (!reporter) return json(ctx.res, 404, { error: 'reporting character not found' });
  const resolved = await resolveReportTarget(body, {
    reportTargetForPid: (pid) => useRuntime().reportTargetForPid(pid),
    findCharacterReportTargetByName,
  });
  if (!resolved.ok) return json(ctx.res, resolved.status, { error: resolved.error });
  try {
    const report = await createPlayerReport({
      reporterAccountId: accountId,
      reporterCharacterId: reporter.id,
      reporterCharacterName: reporter.name,
      target: resolved.target,
      reason,
      details: body.details,
    });
    return json(ctx.res, 200, { ok: true, reportId: report.id });
  } catch (err) {
    return json(ctx.res, 400, {
      error: err instanceof Error ? err.message : 'could not submit report',
    });
  }
}

/** POST /api/bug-reports: capture a bug report (account-gated; self-limits at the data layer). */
async function bugReportsHandler(ctx: Ctx): Promise<void> {
  const accountId = ctxAccountId(ctx);
  let body: Record<string, unknown>;
  try {
    body = (await readBody(ctx.req, BUG_REPORT_MAX_BODY_BYTES)) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof Error && err.message === 'body too large') {
      return json(ctx.res, 413, { error: 'bug report too large' });
    }
    return json(ctx.res, 400, { error: 'bad request' });
  }
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!description) return json(ctx.res, 400, { error: 'describe the bug' });
  const characterId = Number.isFinite(Number(body.characterId)) ? Number(body.characterId) : null;
  // Only trust a character name the server can verify the account owns. A missing
  // or unowned characterId resolves to no name (never the client value).
  let characterName = '';
  let resolvedCharacterId: number | null = null;
  if (characterId !== null) {
    const character = await getCharacter(accountId, characterId);
    if (character) {
      resolvedCharacterId = character.id;
      characterName = character.name;
    }
  }
  const pos = (body.pos && typeof body.pos === 'object' ? body.pos : {}) as Record<string, unknown>;
  try {
    // The screenshot allowlist and meta clamp live in createBugReport so they apply
    // to every insert path, not just this route.
    const report = await createBugReport({
      accountId,
      characterId: resolvedCharacterId,
      characterName,
      realm: REALM,
      pos: { x: Number(pos.x), y: Number(pos.y), z: Number(pos.z) },
      description: description.slice(0, BUG_DESCRIPTION_MAX),
      screenshot: typeof body.screenshot === 'string' ? body.screenshot : null,
      meta: body.meta,
    });
    return json(ctx.res, 200, {
      ok: true,
      reportId: report.id,
      screenshotStored: report.screenshotStored,
    });
  } catch (err) {
    if (err instanceof BugReportRateLimitError) return json(ctx.res, 429, { error: err.message });
    throw err;
  }
}

/** POST /api/perf-report: client perf beacon (public; self-reads, self-limits, 200-on-throttle). */
async function perfReportHandler(ctx: Ctx): Promise<void> {
  return handlePerfReport(ctx.req, ctx.res);
}

/** POST /api/site-presence: site-presence heartbeat (public; self-reads, owns its 405/400/200). */
async function sitePresenceHandler(ctx: Ctx): Promise<void> {
  return handleSitePresenceHeartbeat(ctx.req, ctx.res);
}

// ---------------------------------------------------------------------------
// The route table. registry.ts spreads this into apiRoutes. The two account-gated
// writes carry [activeGuard] (reports additionally rateLimit(REPORTS_CREATE_POLICY)
// AFTER the guard, the fused ip+account limiter needing ctx.account); the two public
// telemetry beacons carry no middleware (no auth, self-read bodies, handler-owned
// 405/200). registered POST-only so a non-POST delegates to the legacy ladder,
// preserving perf-report's 404 fall-through and site-presence's handler-owned 405.
// ---------------------------------------------------------------------------

export const routes: RouteDef[] = [
  {
    method: 'POST',
    path: '/api/reports',
    surface: 'api',
    middleware: [activeGuard, rateLimit(REPORTS_CREATE_POLICY)],
    handler: reportsHandler,
  },
  {
    method: 'POST',
    path: '/api/bug-reports',
    surface: 'api',
    middleware: [activeGuard],
    handler: bugReportsHandler,
  },
  {
    method: 'POST',
    path: '/api/perf-report',
    surface: 'api',
    handler: perfReportHandler,
  },
  {
    method: 'POST',
    path: '/api/site-presence',
    surface: 'api',
    handler: sitePresenceHandler,
  },
];
