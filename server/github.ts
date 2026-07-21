// GitHub OAuth link shell (DB + HTTP) for the developer badge: the IO side of the
// pure server/github_oauth.ts helpers, mirroring server/discord.ts. Linking is
// the only mode (the player is already authenticated when they link), so this is
// simpler than the Discord flow: no first-time-login chooser, no account
// provisioning, no password-keep dance on unlink.
//
// The verified GitHub login is stored in github_links; the developer-badge tier is
// derived elsewhere (server/game.ts refreshDevBadge) from that login plus the
// cached repo contributor stats. Status reads expose the linked login + its
// landed-commit count + resulting tier for the account portal.
import type http from 'node:http';
import { devTierIndexForMergedPrs } from '../src/sim/dev_tier';
import { newToken } from './auth';
import { accountAndScopeForToken, moderationStatusForAccount, pool } from './db';
import { mergedPrsForLogin } from './github_contributors';
import {
  consumeGitHubOAuthState,
  createGitHubOAuthState,
  githubForAccount,
  linkGitHubToAccount,
  unlinkGitHub,
} from './github_db';
import {
  buildAuthorizeUrl,
  buildTokenRequestBody,
  GITHUB_API_BASE,
  GITHUB_TOKEN_URL,
  type GitHubUser,
  githubProfileUrl,
  parseGitHubUser,
  parseTokenResponse,
} from './github_oauth';
import { ctxAccountId } from './http/context';
import { logger } from './http/logger';
import { type BearerActiveGuardDb, createActiveGuard } from './http/middleware/bearer_active_guard';
import type { Ctx, Middleware, Next, RouteDef } from './http/types';
import { json } from './http_util';
import { recordUsageMetric } from './provider_usage';
import { githubRateLimited } from './ratelimit';
import { publicOriginFromRequest } from './realm';

const STATE_TTL_MINUTES = 10;

export interface GitHubConfig {
  clientId: string;
  clientSecret: string;
}

/** Resolve GitHub OAuth config from env, or null when not configured (feature off). */
export function githubConfig(): GitHubConfig | null {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID ?? '';
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET ?? '';
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** Whether the GitHub link feature is configured. Read by the route table + client UI gate. */
export function githubEnabled(): boolean {
  return githubConfig() !== null;
}

function redirectUriFor(req: http.IncomingMessage): string {
  return `${publicOriginFromRequest(req)}/api/auth/github/callback`;
}

// ── OAuth start: returns the github.com authorize URL the browser navigates to ──
// POST /api/auth/github/start (link-only; the caller's account is resolved first).
export async function handleGitHubStart(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: { accountId: number },
): Promise<void> {
  recordUsageMetric('github.link.request');
  const cfg = githubConfig();
  if (!cfg) return json(res, 503, { error: 'GitHub integration is not configured' });
  const state = newToken();
  await createGitHubOAuthState(pool, {
    state,
    accountId: opts.accountId,
    ttlMinutes: STATE_TTL_MINUTES,
  });
  const url = buildAuthorizeUrl({
    clientId: cfg.clientId,
    redirectUri: redirectUriFor(req),
    state,
  });
  return json(res, 200, { url });
}

// ── OAuth callback (top-level browser redirect from github.com) ────────────────
// GET /api/auth/github/callback?code=&state=
// No Authorization header and no browser Origin (it is a github.com redirect), so
// this route is exempt from the web-login Origin guard. Renders an HTML bounce page
// that signals the opener window to refresh the link status.
export async function handleGitHubCallback(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const cfg = githubConfig();
  if (!cfg) return bouncePage(res, 503, { ok: false, error: 'not_configured' });
  // No bearer token has been resolved yet (this is a github.com redirect, not an
  // authenticated request), so key the bucket on IP alone, mirroring how the
  // Discord first-time-login chooser endpoints rate-limit their own
  // also-unauthenticated entry points (handleDiscordLoginNew/handleDiscordLoginLink).
  if (!githubRateLimited(req, 0).allowed) {
    recordUsageMetric('github.link.rate_limited');
    return bouncePage(res, 429, { ok: false, error: 'rate_limited' });
  }
  const u = new URL(req.url ?? '/', 'http://localhost');
  const code = u.searchParams.get('code') ?? '';
  const state = u.searchParams.get('state') ?? '';
  if (u.searchParams.get('error')) {
    // User clicked "Cancel" on GitHub's consent screen: not a failure to alert on.
    return bouncePage(res, 200, { ok: false, error: 'cancelled' });
  }
  if (!code || !state) {
    recordUsageMetric('github.link.failure');
    return bouncePage(res, 400, { ok: false, error: 'bad_request' });
  }

  const stateRow = await consumeGitHubOAuthState(pool, state);
  if (!stateRow) {
    recordUsageMetric('github.link.failure');
    return bouncePage(res, 400, { ok: false, error: 'expired' });
  }

  const user = await exchangeCodeForUser(code, redirectUriFor(req), state, cfg);
  if (!user) {
    recordUsageMetric('github.link.failure');
    return bouncePage(res, 502, { ok: false, error: 'github_error' });
  }

  try {
    const linked = await linkGitHubToAccount(pool, stateRow.account_id, {
      githubUserId: user.id,
      login: user.login,
    });
    if (!linked) {
      recordUsageMetric('github.link.failure');
      return bouncePage(res, 409, { ok: false, error: 'already_linked' });
    }
    return bouncePage(res, 200, { ok: true, login: user.login });
  } catch (err) {
    logger.error({ err }, 'github callback error');
    recordUsageMetric('github.link.failure');
    return bouncePage(res, 500, { ok: false, error: 'server_error' });
  }
}

// Exchange the auth code for a token, then fetch the user identity. Returns null on
// any network/parse failure (handled as github_error).
async function exchangeCodeForUser(
  code: string,
  redirectUri: string,
  state: string,
  cfg: GitHubConfig,
): Promise<GitHubUser | null> {
  const tokenJson = await fetchJsonWithTimeout(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': 'world-of-claudecraft-server',
    },
    body: buildTokenRequestBody({
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      code,
      redirectUri,
      state,
    }),
  });
  const token = parseTokenResponse(tokenJson);
  if (!token) return null;
  const userJson = await fetchJsonWithTimeout(`${GITHUB_API_BASE}/user`, {
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'world-of-claudecraft-server',
    },
  });
  return parseGitHubUser(userJson);
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 8000,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── GET /api/github (link status + resulting badge for the account portal) ──────
export async function handleGitHubStatus(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  return json(res, 200, await githubStatusPayload(accountId));
}

export async function githubStatusPayload(accountId: number): Promise<Record<string, unknown>> {
  const link = await githubForAccount(pool, accountId);
  const login = link?.github_login ?? null;
  const mergedPrs = login ? await mergedPrsForLogin(login) : 0;
  return {
    enabled: githubConfig() !== null,
    linked: link !== null,
    login,
    profileUrl: login ? githubProfileUrl(login) : null,
    mergedPrs,
    // Unlinked / non-contributing accounts are tier 0; only a linked login with
    // merged PRs climbs rungs.
    devTier: devTierIndexForMergedPrs(mergedPrs),
  };
}

// ── DELETE /api/github (unlink) ────────────────────────────────────────────────
// GitHub linking never provisions an account (the player was already logged in to
// link), so unlinking just removes the link, no password-keep dance.
export async function handleGitHubUnlink(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  await unlinkGitHub(pool, accountId);
  return json(res, 200, { unlinked: true });
}

interface BouncePayload {
  ok: boolean;
  login?: string;
  error?: string;
}

// Render an HTML page that posts the result to the opener window (the SPA listens
// for { source: 'woc-github' } to refresh link status) and closes the popup. The
// inlined JSON is escaped so a value can never break out of the <script>.
function bouncePage(res: http.ServerResponse, status: number, payload: BouncePayload): void {
  const data = JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>World of ClaudeCraft</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{background:#14100a;color:#fff6df;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}main{text-align:center;padding:24px}</style>
</head><body><main><p id="m">Connecting GitHub...</p></main><script>
(function(){
  var p = ${data};
  var msg = { source: 'woc-github', ok: p.ok, login: p.login || null, error: p.error || null };
  if (window.opener) {
    try { window.opener.postMessage(msg, location.origin); } catch (e) {}
    setTimeout(function(){ try { window.close(); } catch (e) {} location.replace('/'); }, 200);
  } else {
    location.replace('/');
  }
})();
</script></body></html>`;
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// ── Route layer ──────────────────────────────
// The four GitHub-link endpoints as RouteDefs for the shared dispatcher,
// mirroring the Discord family template (server/discord.ts):
//   POST   /api/auth/github/start      OAuth start (JSON { url }; full session)
//   GET    /api/auth/github/callback   OAuth callback (HTML bounce; NON-JSON)
//   GET    /api/github                 link status (JSON; full session)
//   DELETE /api/github                 unlink (JSON; full session)
// The legacy handleApi arms stay in main.ts as the flag-off rollback path until the
// ladder-deletion PR (next release). PARITY-FIRST: the thin handlers reuse the SAME
// handleGitHub*
// functions UNCHANGED, so every body is the legacy JSON / HTML-bounce byte-for-
// byte. The auth gate is the shared legacy-body createActiveGuard (mirrors
// bearerActiveAccount), never the problem+json requireAccount. The rate guards
// reproduce the legacy arms exactly: start's 429 records the
// github.link.rate_limited usage metric, status/unlink's plain 429 does not,
// and the callback self-limits inside handleGitHubCallback (IP-keyed).
//
// GROUND TRUTH, deliberately preserved: the legacy github family carries NO
// isIpBlocked gate anywhere (unlike Discord, whose login-mode callback can mint
// a session; github is link-only, the account is already authenticated), so
// none is added here. Adding one would be a security-posture change, a
// maintainer fork, not a silent port.
//
// The callback carries meta.envelope 'html' so even an UNEXPECTED throw
// escaping handleGitHubCallback (e.g. consumeGitHubOAuthState on a failing db)
// serializes as an HTML error, never problem+json, which would break the
// window.opener.postMessage popup contract. The unexpected-throw divergence for
// all four routes is the githubBodyValidationRemap known deviation (legacy
// counterfactual: the bare-return arms escape handleApi's outer catch and the
// request HANGS).

// The bearer + moderation reads the auth guard needs. Built LAZILY (a function,
// not a module-scope object literal) so importing this module never dereferences
// the db.ts bindings: an unrelated test that partial-mocks server/db and pulls
// this module in transitively must not throw on a missing export (the
// lazy-db-bundle rule).
function makeRealGithubDb() {
  return { accountAndScopeForToken, moderationStatusForAccount };
}
type GithubGuardDb = ReturnType<typeof makeRealGithubDb>;
let realGithubDb: GithubGuardDb | undefined;
let githubDbOverride: GithubGuardDb | undefined;
function githubDb(): BearerActiveGuardDb {
  if (githubDbOverride) return githubDbOverride;
  realGithubDb ??= makeRealGithubDb();
  return realGithubDb;
}

/** Override the guard db with a fake (test-only; merges over the real reads). */
export function setGithubDbForTests(overrides: Partial<GithubGuardDb>): void {
  realGithubDb ??= makeRealGithubDb();
  githubDbOverride = { ...realGithubDb, ...overrides };
}

/** Restore the real guard db after a setGithubDbForTests override (test-only). */
export function resetGithubDbForTests(): void {
  githubDbOverride = undefined;
}

/** Mutating + account-scoped gate for start/status/unlink (mirrors bearerActiveAccount). */
const activeGuard = createActiveGuard(() => githubDb());

/**
 * start's rate guard: the legacy arm records the github.link.rate_limited usage
 * metric on a 429 (status/unlink do not), so start gets its own guard. Runs
 * AFTER the auth guard, exactly like the legacy arm (auth first, then limit).
 */
const githubStartRateGuard: Middleware = async (ctx: Ctx, next: Next) => {
  if (!githubRateLimited(ctx.req, ctxAccountId(ctx)).allowed) {
    recordUsageMetric('github.link.rate_limited');
    json(ctx.res, 429, { error: 'rate limited' });
    return;
  }
  await next();
};

/** status/unlink's plain rate guard (no usage metric), after the auth guard. */
const githubActiveRateGuard: Middleware = async (ctx: Ctx, next: Next) => {
  if (!githubRateLimited(ctx.req, ctxAccountId(ctx)).allowed) {
    json(ctx.res, 429, { error: 'rate limited' });
    return;
  }
  await next();
};

/** POST /api/auth/github/start: OAuth start (link-only; account resolved by the guard). */
async function githubStartHandler(ctx: Ctx): Promise<void> {
  return handleGitHubStart(ctx.req, ctx.res, { accountId: ctxAccountId(ctx) });
}

/** GET /api/auth/github/callback: OAuth callback (HTML bounce; never problem+json). */
async function githubCallbackHandler(ctx: Ctx): Promise<void> {
  return handleGitHubCallback(ctx.req, ctx.res);
}

/** GET /api/github: link status + dev badge for the account portal. */
async function githubStatusHandler(ctx: Ctx): Promise<void> {
  return handleGitHubStatus(ctx.req, ctx.res, ctxAccountId(ctx));
}

/** DELETE /api/github: unlink (no password-keep dance; link-only flow). */
async function githubUnlinkHandler(ctx: Ctx): Promise<void> {
  return handleGitHubUnlink(ctx.req, ctx.res, ctxAccountId(ctx));
}

// The route table. registry.ts spreads this into apiRoutes. The callback carries
// no auth middleware (a github.com redirect has no bearer; the OAuth state row is
// the credential); the other three are [activeGuard, rate guard], matching the
// legacy order (auth resolves first, the limiter keys on ip+account).
export const routes: RouteDef[] = [
  {
    method: 'POST',
    path: '/api/auth/github/start',
    surface: 'api',
    middleware: [activeGuard, githubStartRateGuard],
    handler: githubStartHandler,
  },
  {
    method: 'GET',
    path: '/api/auth/github/callback',
    surface: 'api',
    // HTML bounce page, never problem+json: an escaping throw serializes as an
    // HTML error (dispatch.ts threads meta.envelope into withErrors -> mapError).
    meta: { envelope: 'html' },
    handler: githubCallbackHandler,
  },
  {
    method: 'GET',
    path: '/api/github',
    surface: 'api',
    middleware: [activeGuard, githubActiveRateGuard],
    handler: githubStatusHandler,
  },
  {
    method: 'DELETE',
    path: '/api/github',
    surface: 'api',
    middleware: [activeGuard, githubActiveRateGuard],
    handler: githubUnlinkHandler,
  },
];
