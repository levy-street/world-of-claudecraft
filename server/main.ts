import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { type WebSocket, WebSocketServer } from 'ws';
import {
  LEADERBOARD_MAX,
  LEADERBOARD_PAGE_SIZE,
  paginateDevLeaderboard,
  paginateGuildLeaderboard,
  paginateLeaderboard,
} from '../src/sim/leaderboard_page';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';
import { virtualLevel } from '../src/sim/types';
import type { GuildLeaderboardEntry, LeaderboardEntry } from '../src/world_api';
import {
  handleAccount2faDisable,
  handleAccount2faEnable,
  handleAccount2faSetup,
  handleAccountChangePassword,
  handleAccountDeactivate,
  handleAccountEmailChange,
  handleAccountEmailVerify,
  handleAccountExport,
  handleAccountLogout,
  handleAccountMarketing,
  handleAccountSetEmail,
  handleAccountSetInitialEmail,
  handleAccountWhoami,
  handleEmailUnsubscribe,
  verifyLoginTwoFactor,
} from './account';
import { handleAdminApi } from './admin';
import { currentSitePresenceUsers, recordSitePresenceSample } from './admin_db';
import {
  hashPassword,
  newToken,
  normalizeCharName,
  normalizeEmail,
  offensiveName,
  validPassword,
  validUsernameShape,
  verifyPassword,
} from './auth';
import { BUG_DESCRIPTION_MAX, BugReportRateLimitError, createBugReport } from './bug_report_db';
import { characterSheet, type SheetRank } from './character_sheet';
import { handleDailyRewardApi, handleDailyRewardInternalApi } from './daily_rewards';
import {
  accountAndScopeForToken,
  accountById,
  accountForToken,
  type CharacterRow,
  characterCountsByRealm,
  chatMuteStatusForAccount,
  closeOrphanSessions,
  createAccount,
  createCharacterCapped,
  createCompanionToken,
  deleteCharacter,
  ensureSchema,
  findAccount,
  findCharacterReportTargetByName,
  getAccountsCount,
  getCharacter,
  getCharacterById,
  guildNameForCharacter,
  isAdminAccount,
  lifetimeXpRankForCharacter,
  lifetimeXpStanding,
  listCharacters,
  listCompanionTokens,
  loadAccountCosmetics,
  moderationStatusForAccount,
  pool,
  primarySlugForAccount,
  pruneChatLogs,
  pruneClientPerfReports,
  reclaimDeactivatedName,
  referralCountForAccount,
  renameCharacter,
  revokeCompanionToken,
  saveToken,
  scopeAllowsMutation,
  searchCharacters,
  setAccountEmail,
  type TokenScope,
  topArenaRatings,
  topGuilds,
  topLifetimeXp,
  touchLogin,
} from './db';
import {
  type DesktopLoginRouteDeps,
  handleDesktopLoginCreate,
  handleDesktopLoginExchange,
} from './desktop_login';
import {
  handleDiscordCallback,
  handleDiscordLoginLink,
  handleDiscordLoginNew,
  handleDiscordStart,
  handleDiscordStatus,
  handleDiscordUnlink,
} from './discord';
import { pruneDiscordOAuthStates, pruneDiscordPendingLogins } from './discord_db';
import { emailAccountCreated } from './email';
import { GameServer } from './game';
import {
  handleGitHubCallback,
  handleGitHubStart,
  handleGitHubStatus,
  handleGitHubUnlink,
} from './github';
import { topContributors } from './github_contributors';
import { pruneGitHubOAuthStates } from './github_db';
import { isUniqueViolation, json, readBody } from './http_util';
import { handleInternalApi } from './internal';
import { isConnectionRefused } from './ip_block';
import { pruneExpiredBlockedIps } from './ip_block_db';
import {
  cleanReportReason,
  createPlayerReport,
  createSuspiciousRegistrationReport,
} from './moderation_db';
import { createNativeAttestationChallenge } from './native_attestation';
import { handleOAuth, seedOAuthClients } from './oauth';
import { pruneExpiredOAuthGrants } from './oauth_db';
import { handlePerfReport } from './perf_report';
import {
  captureReferral,
  cardUploadContentLengthTooLarge,
  handleCardRoutes,
  handleCardUpload,
} from './player_card';
import { handleAvatar, handleCharacterSitemap, handleProfilePage } from './profile_page';
import { recordUsageCacheEvent, recordUsageMetric, setUsageCacheSize } from './provider_usage';
import {
  authThrottled,
  cardUploadRateLimited,
  clearAuthFailures,
  discordRateLimited,
  githubRateLimited,
  publicReadRateLimited,
  rateLimited,
  recordAuthFailure,
  requestIp,
  wocBalanceRateLimited,
} from './ratelimit';
import { isPublicCorsPath, publicOriginFromRequest, REALM, REALM_DIRECTORY } from './realm';
import { resolveReportTarget } from './report_target';
import { handleSitePresenceHeartbeat } from './site_presence';
import { cacheControlFor, etagFor, isNotModified } from './static_cache';
import { passesTurnstile } from './turnstile';
import {
  handleWalletChallenge,
  handleWalletGet,
  handleWalletLink,
  handleWalletUnlink,
} from './wallet';
import { allowedCorsOrigin, isWebClientRequest, webLoginEnforced } from './web_login_guard';
import { handleWocBalance, parseWocBalanceQuery } from './woc_balance';
import { bufferHandshakeMessages } from './ws_buffer';

const PORT = Number(process.env.PORT ?? 8787);
const STATIC_DIR = path.join(__dirname, '..', 'dist');
// Pretty URLs that serve standalone static HTML pages.
const STATIC_PAGE_ALIASES = new Map([
  ['/links', '/links.html'],
  ['/links/', '/links.html'],
  ['/social', '/links.html'],
  ['/social/', '/links.html'],
  ['/social-media-links', '/links.html'],
  ['/social-media-links/', '/links.html'],
  ['/play', '/play.html'],
  ['/play/', '/play.html'],
  ['/privacy', '/privacy.html'],
  ['/privacy/', '/privacy.html'],
  ['/terms', '/terms.html'],
  ['/terms/', '/terms.html'],
  ['/merch', '/merch.html'],
  ['/merch/', '/merch.html'],
  ['/press', '/press.html'],
  ['/press/', '/press.html'],
  ['/data-deletion', '/data-deletion.html'],
  ['/data-deletion/', '/data-deletion.html'],
  ['/support', '/support.html'],
  ['/support/', '/support.html'],
  ['/wiki', '/guide.html'],
  ['/wiki/', '/guide.html'],
]);
// How long chat logs are kept (0 = forever); pruned at boot and daily.
const CHAT_LOG_RETENTION_DAYS = Number(process.env.CHAT_LOG_RETENTION_DAYS ?? 90);
// Client performance reports are operational telemetry, not permanent records.
// Keep enough history for tuning runs while bounding table growth.
const PERF_REPORT_RETENTION_DAYS = Number(process.env.PERF_REPORT_RETENTION_DAYS ?? 14);
const ADMIN_ONLINE_SAMPLE_MS = 60_000;
// Cloudflare Turnstile secret. When unset (local dev / tests) registration and
// login skip human verification entirely — see requireTurnstile below.
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET ?? '';
// Hard WS connection limit per IP. Soft threshold (adds bot evidence) is in game.ts.
const MAX_WS_PER_IP_HARD = Number(process.env.MAX_WS_PER_IP_HARD ?? '20');
// Each realm re-reads the blocklist on this interval so edits on another realm
// process propagate and expired blocks fall out.
const BLOCKED_IP_REFRESH_MS = 60_000;

const game = new GameServer();

function initialCharacterState(
  cls: PlayerClass,
  name: string,
  skin: number,
): import('../src/sim/sim').CharacterState {
  const sim = new Sim({ seed: 20061, playerClass: cls, playerName: name });
  sim.setPlayerSkin(sim.playerId, skin);
  const character = sim.serializeCharacter(sim.playerId);
  if (!character) throw new Error('failed to serialize initial character');
  return character;
}

// ---------------------------------------------------------------------------
// Lifetime-XP leaderboard cache (Max-Level XP Overflow, FR-4.2 / PR-3).
// Same shape as the chat-censor memoization: compute once, serve from memory,
// refresh on an interval. The query is never run per request under load — at
// most once per LEADERBOARD_TTL_MS, plus the boot warm-up below.
// ---------------------------------------------------------------------------
const LEADERBOARD_TTL_MS = 30_000;
// Cache the full exposed depth (LEADERBOARD_MAX) once per scope; the REST handler
// pages through it as an in-memory slice, so no extra query per page click.
const LEADERBOARD_SIZE = LEADERBOARD_MAX;
// One cache per scope: 'realm' for the in-game panel, 'global' for the
// cross-realm home-page board.
const leaderboardCache: Record<
  'realm' | 'global',
  { at: number; entries: LeaderboardEntry[] } | null
> = {
  realm: null,
  global: null,
};

async function refreshLeaderboard(scope: 'realm' | 'global'): Promise<LeaderboardEntry[]> {
  const rows = await topLifetimeXp(LEADERBOARD_SIZE, { global: scope === 'global' });
  const entries: LeaderboardEntry[] = rows.map((r, i) => ({
    rank: i + 1,
    name: r.name,
    cls: r.class,
    level: r.level,
    virtualLevel: virtualLevel(r.lifetimeXp),
    lifetimeXp: r.lifetimeXp,
    prestigeRank: r.prestigeRank,
    ...(scope === 'global' ? { realm: r.realm } : {}),
  }));
  leaderboardCache[scope] = { at: Date.now(), entries };
  return entries;
}

async function getLeaderboard(scope: 'realm' | 'global'): Promise<LeaderboardEntry[]> {
  const cached = leaderboardCache[scope];
  if (cached && Date.now() - cached.at < LEADERBOARD_TTL_MS) return cached.entries;
  try {
    return await refreshLeaderboard(scope);
  } catch (err) {
    console.error(`leaderboard refresh failed (${scope}):`, err);
    return cached?.entries ?? [];
  }
}

// Guild high-score board cache. Same compute-once/serve-from-memory shape as the
// player board above, one cache per scope. Guilds are ranked by summed member
// lifetime XP (topGuilds); the REST handler pages through the cached window.
const guildLeaderboardCache: Record<
  'realm' | 'global',
  { at: number; entries: GuildLeaderboardEntry[] } | null
> = {
  realm: null,
  global: null,
};

async function refreshGuildLeaderboard(
  scope: 'realm' | 'global',
): Promise<GuildLeaderboardEntry[]> {
  const rows = await topGuilds(LEADERBOARD_SIZE, { global: scope === 'global' });
  const entries: GuildLeaderboardEntry[] = rows.map((r, i) => ({
    rank: i + 1,
    name: r.name,
    memberCount: r.memberCount,
    totalLifetimeXp: r.totalLifetimeXp,
    topLevel: r.topLevel,
    ...(scope === 'global' ? { realm: r.realm } : {}),
  }));
  guildLeaderboardCache[scope] = { at: Date.now(), entries };
  return entries;
}

async function getGuildLeaderboard(scope: 'realm' | 'global'): Promise<GuildLeaderboardEntry[]> {
  const cached = guildLeaderboardCache[scope];
  if (cached && Date.now() - cached.at < LEADERBOARD_TTL_MS) return cached.entries;
  try {
    return await refreshGuildLeaderboard(scope);
  } catch (err) {
    console.error(`guild leaderboard refresh failed (${scope}):`, err);
    return cached?.entries ?? [];
  }
}

// ---------------------------------------------------------------------------
// News & Updates: GitHub Releases proxy (read-only, public).
// The home-page "News & Updates" view pulls published releases from the public
// GitHub repo. We proxy + cache server-side rather than letting the browser hit
// api.github.com directly so that: (1) the unauthenticated GitHub rate limit (60
// req/IP/hr) is shared across all players as one server IP, not burned per
// visitor; (2) an optional GITHUB_TOKEN raises that ceiling without shipping a
// secret to the client; (3) we return only the small, sanitised subset the UI
// needs. Same compute-once/serve-from-memory pattern as the leaderboard cache.
// ---------------------------------------------------------------------------
const GITHUB_REPO = process.env.GITHUB_REPO ?? 'levy-street/world-of-claudecraft';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? '';
const RELEASES_TTL_MS = 15 * 60_000; // 15 min — releases change rarely
const RELEASES_SIZE = 20;
const RELEASE_BODY_MAX = 8_000; // guard against a pathologically long body

export interface ReleaseEntry {
  id: number;
  tag: string;
  name: string;
  body: string;
  url: string;
  prerelease: boolean;
  publishedAt: string; // ISO 8601
}

let releasesCache: { at: number; entries: ReleaseEntry[] } | null = null;
setUsageCacheSize('github.releases', 0, RELEASES_SIZE);

async function refreshReleases(): Promise<ReleaseEntry[]> {
  recordUsageMetric('github.releases.fetch');
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=${RELEASES_SIZE}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'world-of-claudecraft-server',
          ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) throw new Error(`github releases ${res.status}`);
    const raw = await res.json();
    const entries: ReleaseEntry[] = (Array.isArray(raw) ? raw : [])
      .filter((r) => r && !r.draft) // skip unpublished drafts
      .map((r) => ({
        id: Number(r.id),
        tag: String(r.tag_name ?? ''),
        name: String(r.name || r.tag_name || ''),
        body: String(r.body ?? '').slice(0, RELEASE_BODY_MAX),
        url: String(r.html_url ?? ''),
        prerelease: Boolean(r.prerelease),
        publishedAt: String(r.published_at ?? r.created_at ?? ''),
      }));
    releasesCache = { at: Date.now(), entries };
    recordUsageCacheEvent('github.releases', 'store');
    setUsageCacheSize('github.releases', entries.length, RELEASES_SIZE);
    return entries;
  } catch (err) {
    recordUsageMetric('github.releases.fetch.failure');
    throw err;
  }
}

async function getReleases(): Promise<ReleaseEntry[]> {
  if (releasesCache && Date.now() - releasesCache.at < RELEASES_TTL_MS) {
    recordUsageCacheEvent('github.releases', 'hit');
    return releasesCache.entries;
  }
  recordUsageCacheEvent('github.releases', releasesCache ? 'stale' : 'miss');
  try {
    return await refreshReleases();
  } catch (err) {
    recordUsageCacheEvent('github.releases', 'failure');
    console.error('github releases refresh failed:', err);
    return releasesCache?.entries ?? [];
  }
}

function normalizeDeleteConfirmation(name: unknown): string {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

// Shape a realm rank lookup into the character-sheet's rank field.
function toSheetRank(rank: { rank: number; total: number } | null): SheetRank | null {
  return rank ? { scope: 'realm', rank: rank.rank, total: rank.total } : null;
}

// The character-list response shared by the full-session GET /api/characters and
// the read-scoped GET /api/me/characters, so both stay byte-identical.
function characterListPayload(chars: CharacterRow[]): {
  realm: string;
  characters: {
    id: number;
    name: string;
    class: PlayerClass;
    level: number;
    skin: number;
    online: boolean;
    forceRename: boolean;
    lastPlayed: string | null;
    playtimeSeconds: number;
  }[];
} {
  return {
    realm: REALM,
    characters: chars.map((c) => ({
      id: c.id,
      name: c.name,
      class: c.class,
      level: c.level,
      skin: c.state?.skin ?? 0,
      online: [...game.clients.values()].some((s) => s.characterId === c.id),
      forceRename: c.force_rename,
      lastPlayed: c.last_played ? new Date(c.last_played).toISOString() : null,
      playtimeSeconds: Number(c.playtime_seconds ?? 0),
    })),
  };
}

async function bearerAccount(req: http.IncomingMessage): Promise<number | null> {
  const auth = req.headers.authorization ?? '';
  const m = /^Bearer ([a-f0-9]{64})$/.exec(auth);
  if (!m) return null;
  return accountForToken(m[1]);
}

// Account + token scope for the bearer (or null when unauthenticated). The scope
// is what lets read-only companion/OAuth tokens be accepted on read routes and
// rejected on mutating ones.
async function bearerScopeAccount(
  req: http.IncomingMessage,
): Promise<{ accountId: number; scope: TokenScope } | null> {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization ?? '');
  if (!m) return null;
  return accountAndScopeForToken(m[1]);
}

// Raw bearer token string (or null) — needed when an account action must keep
// the caller's own session alive while revoking the rest (password change).
function bearerToken(req: http.IncomingMessage): string | null {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization ?? '');
  return m ? m[1] : null;
}

// Mutating + owner-scoped routes funnel through here. HARDENED: a read-only
// token (scope!=='full') is rejected with 403, so every existing mutating route
// (which already calls this) automatically refuses companion/OAuth read tokens —
// the single choke point that keeps read tokens harmless.
async function bearerActiveAccount(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<number | null> {
  const info = await bearerScopeAccount(req);
  if (info === null) {
    json(res, 401, { error: 'not authenticated' });
    return null;
  }
  if (!scopeAllowsMutation(info.scope)) {
    json(res, 403, { error: 'this token is read-only' });
    return null;
  }
  const status = await moderationStatusForAccount(info.accountId);
  if (status.locked) {
    json(res, 403, { error: status.message });
    return null;
  }
  return info.accountId;
}

// Read routes (the owner character sheet) accept both 'read' and 'full' tokens.
// Moderation still applies — a banned account can't read through a read token.
async function bearerReadAccount(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<number | null> {
  const info = await bearerScopeAccount(req);
  if (info === null) {
    json(res, 401, { error: 'not authenticated' });
    return null;
  }
  const status = await moderationStatusForAccount(info.accountId);
  if (status.locked) {
    json(res, 403, { error: status.message });
    return null;
  }
  return info.accountId;
}

function requestMetadata(req: http.IncomingMessage): { ip: string; userAgent: string } {
  return {
    ip: requestIp(req),
    userAgent: String(req.headers['user-agent'] ?? ''),
  };
}

// Host wiring for the desktop-login route handlers (server/desktop_login.ts):
// the real db/auth implementations here, stubs in tests.
const desktopLoginRouteDeps: DesktopLoginRouteDeps = {
  bearerToken,
  readBody,
  json,
  requestMetadata,
  accountForToken,
  accountById,
  moderationStatusForAccount,
  touchLogin,
  saveToken,
};

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.hdr': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
  '.wasm': 'application/wasm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

// The admin dashboard is reached via the admin.* subdomain (Caddy proxies it
// to this same port) or /admin for local dev. The hostname only picks which
// HTML shell is served — the admin API itself is gated by admin tokens.
function isAdminRequest(req: http.IncomingMessage): boolean {
  const host = String(req.headers.host ?? '').toLowerCase();
  const urlPath = (req.url ?? '/').split('?')[0];
  return host.startsWith('admin.') || urlPath === '/admin' || urlPath === '/admin/';
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  let urlPath = (req.url ?? '/').split('?')[0];
  // The curated Guide is the site wiki: a client-routed SPA served at /wiki with its
  // own shell, so deep paths (/wiki/classes/...) fall back to guide.html rather than the
  // game's index.html. (It previously 302'd to a standalone MediaWiki; that is retired.)
  const isGuide = urlPath === '/wiki' || urlPath.startsWith('/wiki/');
  const shell = isGuide ? 'guide.html' : isAdminRequest(req) ? 'admin.html' : 'index.html';
  // Pretty-URL aliases for standalone static pages.
  urlPath = STATIC_PAGE_ALIASES.get(urlPath) ?? urlPath;
  if (urlPath === '/' || urlPath === '/admin' || urlPath === '/admin/') urlPath = `/${shell}`;
  // normalize once and reuse for BOTH file resolution and cache policy —
  // otherwise /assets/../x would serve a mutable file with immutable caching
  urlPath = path.posix.normalize(urlPath).replace(/^([.][.][/\\])+/, '');
  const file = path.join(STATIC_DIR, urlPath);
  const stats = file.startsWith(STATIC_DIR) && fs.existsSync(file) ? fs.statSync(file) : null;
  if (!stats?.isFile()) {
    // Asset paths must 404, not SPA-fall-back: a missing .glb served as index.html
    // surfaces as a cryptic GLTFLoader parse error instead of a clear 404.
    if (path.extname(urlPath) && path.extname(urlPath) !== '.html') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    // SPA fallback
    const index = path.join(STATIC_DIR, shell);
    if (fs.existsSync(index)) {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
      fs.createReadStream(index).pipe(res);
    } else {
      res.writeHead(404);
      res.end('not found (run `npm run build` to serve the client from the game server)');
    }
    return;
  }
  const isReadMethod = req.method === 'GET' || req.method === 'HEAD';
  const etag = etagFor(stats);
  const validators = {
    'Cache-Control': cacheControlFor(urlPath),
    ETag: etag,
    'Last-Modified': stats.mtime.toUTCString(),
  };
  if (isReadMethod && isNotModified(req.headers, etag, stats.mtime)) {
    res.writeHead(304, validators);
    res.end();
    return;
  }
  res.writeHead(200, {
    ...validators,
    'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'Content-Length': stats.size,
  });
  if (req.method === 'HEAD') {
    // don't read a multi-MB asset from disk just to discard the bytes
    res.end();
    return;
  }
  fs.createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------

// Cross-realm CORS: a client served by one realm may call another realm's API
// after switching realms in the picker. The native Capacitor and Electron
// desktop shells also call the production origin from non-site origins. The
// allow-list itself lives in allowedCorsOrigin (server/web_login_guard.ts).
function maybeCors(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = allowedCorsOrigin(req.headers.origin);
  if (origin !== null) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

// Absolute public origin for building self-URLs (avatar/profile links) in JSON
// and SSR pages. Prefer the configured/realm origin; fall back to the request's
// own scheme+host so links work in local dev too. Mirrors player_card.ts.
function publicOrigin(req: http.IncomingMessage): string {
  return publicOriginFromRequest(req);
}

// Wide-open CORS for the public, unauthenticated read surfaces. These carry no
// credentials and return only the public subset, so reflecting any origin (`*`)
// is safe and lets browser-origin apps fetch them client-side.
function publicCors(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
}

// Anti-bot: when enabled, /api/login + /api/register require a same-origin browser
// request (a recognised Origin header), so only the web client can obtain a token.
const REQUIRE_WEB_LOGIN = webLoginEnforced();

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = (req.url ?? '').split('?')[0];
  try {
    if (req.method === 'POST' && url === '/api/native-attestation/challenge') {
      const body = await readBody(req);
      const action = typeof body.action === 'string' ? body.action : 'auth';
      return json(res, 200, createNativeAttestationChallenge(req, action));
    }
    if (url === '/api/site-presence') {
      return await handleSitePresenceHeartbeat(req, res);
    }
    if (
      REQUIRE_WEB_LOGIN &&
      req.method === 'POST' &&
      (url === '/api/register' || url === '/api/login') &&
      !isWebClientRequest(req)
    ) {
      return json(res, 403, { error: 'logins are only allowed from the game client' });
    }
    // The desktop-login handoff shares the same per-IP budget: exchange is
    // unauthenticated (defense in depth on top of the 160-bit single-use code)
    // and create bounds how fast one authenticated client can grow the store.
    if (
      req.method === 'POST' &&
      (url === '/api/register' ||
        url === '/api/login' ||
        url === '/api/desktop-login/create' ||
        url === '/api/desktop-login/exchange') &&
      rateLimited(req)
    ) {
      return json(res, 429, { error: 'too many attempts — wait a minute and try again' });
    }
    // Reuse the rate-limit message so a blocked client gets no signal that the
    // block exists. Login is gated separately below, after the account is known,
    // so admins can bypass; registration has no account to check.
    if (req.method === 'POST' && url === '/api/register' && game.isIpBlocked(requestIp(req))) {
      return json(res, 429, { error: 'too many attempts — wait a minute and try again' });
    }
    if (req.method === 'POST' && url === '/api/register') {
      const body = await readBody(req);
      if (!(await passesTurnstile(req, body, TURNSTILE_SECRET)))
        return json(res, 403, { error: 'verification failed, please try again' });
      if (!validUsernameShape(body.username))
        return json(res, 400, { error: 'username must be 3-24 chars (letters, digits, _)' });
      if (offensiveName(body.username)) return json(res, 400, { error: 'username is not allowed' });
      if (!validPassword(body.password))
        return json(res, 400, { error: 'password must be at least 6 chars' });
      // Email is mandatory at signup: it is the recovery address that later proves
      // account ownership on a password reset, so we capture it up front.
      const signupEmail = normalizeEmail(body.email);
      if (!signupEmail) return json(res, 400, { error: 'enter a valid email address' });
      const existing = await findAccount(body.username);
      if (existing) return json(res, 409, { error: 'username already taken' });
      let account: Awaited<ReturnType<typeof createAccount>>;
      try {
        account = await createAccount(
          body.username,
          await hashPassword(body.password),
          requestMetadata(req),
        );
      } catch (err: any) {
        // a concurrent registration can win the insert after our findAccount
        // check; the username UNIQUE index is the real guard. Surface it as a
        // 409 like the duplicate path above, not a generic 500.
        if (isUniqueViolation(err)) return json(res, 409, { error: 'username already taken' });
        throw err;
      }
      const token = newToken();
      await saveToken(token, account.id);
      // Store the mandatory signup email and send the welcome mail. Validated above,
      // so this always runs for a fresh registration.
      await setAccountEmail(account.id, signupEmail);
      emailAccountCreated({
        id: account.id,
        username: account.username,
        email: signupEmail,
        locale: null,
        marketing_opt_in: false,
      });
      void createSuspiciousRegistrationReport({
        accountId: account.id,
        username: account.username,
        ...requestMetadata(req),
      }).catch((err) => console.error('suspicious registration report failed:', err));
      // Capture the referral when this account signed up via a card link
      // (?ref=<slug>). Best-effort: never block or fail registration on it.
      void captureReferral(account.id, body.ref).catch((err) =>
        console.error('referral capture failed:', err),
      );
      // emailMissing is always false here (email is required above); sent so the
      // client can use one uniform post-auth check across register and login.
      return json(res, 200, { token, username: account.username, emailMissing: false });
    }
    if (req.method === 'POST' && url === '/api/login') {
      const body = await readBody(req);
      if (!(await passesTurnstile(req, body, TURNSTILE_SECRET)))
        return json(res, 403, { error: 'verification failed, please try again' });
      const username = typeof body.username === 'string' ? body.username : '';
      // Per-account brute-force throttle (#93). The message is identical to a
      // bad-password response so it never reveals whether the account exists.
      if (username && authThrottled(username)) {
        return json(res, 429, {
          error: 'too many failed attempts — wait a few minutes and try again',
        });
      }
      const account = username ? await findAccount(username) : null;
      if (!account || !(await verifyPassword(String(body.password ?? ''), account.password_hash))) {
        if (username) recordAuthFailure(username);
        return json(res, 401, { error: 'invalid username or password' });
      }
      const status = await moderationStatusForAccount(account.id);
      if (status.locked) return json(res, 403, { error: status.message });
      // Checked only now that the account is known, so admins (verified after the
      // password) are never locked out. This does mean a blocked IP gets 429 on a
      // correct password vs 401 on a wrong one — a small credential-validity tell
      // we accept, since moving the check before the password would lock admins out.
      if (game.isIpBlocked(requestIp(req)) && !(await isAdminAccount(account.id))) {
        return json(res, 429, { error: 'too many attempts — wait a minute and try again' });
      }
      // Second factor: if 2FA is enabled, the password alone is not enough. With
      // no code supplied we return a challenge (not a token) so the client shows
      // the code step; with a code (or recovery code) we verify it before issuing.
      if (account.totp_enabled_at) {
        const code = typeof body.code === 'string' ? body.code : '';
        const recoveryCode = typeof body.recoveryCode === 'string' ? body.recoveryCode : '';
        if (!code && !recoveryCode) {
          return json(res, 200, { twoFactorRequired: true });
        }
        if (!(await verifyLoginTwoFactor(account, code, recoveryCode))) {
          recordAuthFailure(username);
          return json(res, 401, { error: 'invalid authentication code', twoFactorRequired: true });
        }
      }
      clearAuthFailures(username); // correct password: forgive earlier typos
      await touchLogin(account.id, requestMetadata(req));
      const token = newToken();
      await saveToken(token, account.id);
      // Tell the client whether this (possibly pre-email) account still needs a
      // recovery address, so it can force the mandatory-email prompt on sign-in.
      const emailMissing = !(account.email && account.email.trim());
      return json(res, 200, { token, username: account.username, emailMissing });
    }
    if (req.method === 'POST' && url === '/api/desktop-login/create') {
      return handleDesktopLoginCreate(req, res, desktopLoginRouteDeps);
    }
    if (req.method === 'POST' && url === '/api/desktop-login/exchange') {
      return handleDesktopLoginExchange(req, res, desktopLoginRouteDeps);
    }
    // Read-scoped "my characters" list: lets a companion holding a character:read
    // token (OAuth or a pasted companion token) discover its character ids so it
    // can then call /sheet. Same body as GET /api/characters, but gated by
    // bearerReadAccount so a read token is accepted (the full-session list below
    // still uses bearerActiveAccount and stays mutation-only). Placed before the
    // generic /api routes.
    if (req.method === 'GET' && url === '/api/me/characters') {
      const accountId = await bearerReadAccount(req, res);
      if (accountId === null) return;
      return json(res, 200, characterListPayload(await listCharacters(accountId)));
    }
    if (url === '/api/characters') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      if (req.method === 'GET') {
        return json(res, 200, characterListPayload(await listCharacters(accountId)));
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        const name = normalizeCharName(body.name);
        if (name === null)
          return json(res, 400, { error: 'invalid character name (2-16 letters)' });
        if (offensiveName(name)) return json(res, 400, { error: 'character name is not allowed' });
        const validClasses = [
          'warrior',
          'paladin',
          'hunter',
          'rogue',
          'priest',
          'shaman',
          'mage',
          'warlock',
          'druid',
        ];
        if (!validClasses.includes(body.class)) return json(res, 400, { error: 'invalid class' });
        const skin = Math.max(
          0,
          Math.min(7, Math.floor(typeof body.skin === 'number' ? body.skin : 0)),
        );
        const create = () =>
          createCharacterCapped(
            accountId,
            name,
            body.class,
            10,
            initialCharacterState(body.class, name, skin),
          );
        const created = (c: NonNullable<Awaited<ReturnType<typeof createCharacterCapped>>>) =>
          json(res, 200, {
            id: c.id,
            name: c.name,
            class: c.class,
            level: c.level,
            skin: c.state?.skin ?? skin,
            forceRename: c.force_rename,
          });
        try {
          const c = await create();
          if (!c) return json(res, 400, { error: 'character limit reached' });
          return created(c);
        } catch (err: any) {
          if (!isUniqueViolation(err)) throw err;
          // The name collided. If it is held only by a deactivated ("invalid")
          // account, free it (the orphaned character is archived) and retry once;
          // otherwise it is genuinely taken. This is the self-service path that
          // replaces the hidden admin-only reactivate/force-rename recovery.
          if (!(await reclaimDeactivatedName(name)))
            return json(res, 409, { error: 'that name is taken' });
          try {
            const c = await create();
            if (!c) return json(res, 400, { error: 'character limit reached' });
            return created(c);
          } catch (err2: any) {
            if (isUniqueViolation(err2)) return json(res, 409, { error: 'that name is taken' });
            throw err2;
          }
        }
      }
    }
    // Public, unauthenticated character sheet (read-only safe subset). Resolved
    // by name, rate-limited to deter scraping, CORS-open to any origin. MUST
    // come before generic /api routes; it never touches a bearer token.
    const publicSheetMatch = /^\/api\/public\/characters\/(.+)\/sheet$/.exec(url);
    if (req.method === 'GET' && publicSheetMatch) {
      if (publicReadRateLimited(req)) return json(res, 429, { error: 'rate limited' });
      const rawName = decodeURIComponent(publicSheetMatch[1]);
      const target = await findCharacterReportTargetByName(rawName);
      if (!target) return json(res, 404, { error: 'character not found' });
      const row = await getCharacterById(target.characterId);
      if (!row) return json(res, 404, { error: 'character not found' });
      const [guild, rank] = await Promise.all([
        guildNameForCharacter(row.id),
        lifetimeXpRankForCharacter(row.id),
      ]);
      return json(
        res,
        200,
        characterSheet({
          row,
          visibility: 'public',
          realm: REALM,
          origin: publicOrigin(req),
          guild,
          rank: toSheetRank(rank),
        }),
      );
    }
    const ownerSheetMatch = /^\/api\/characters\/(\d+)\/sheet$/.exec(url);
    if (req.method === 'GET' && ownerSheetMatch) {
      const accountId = await bearerReadAccount(req, res);
      if (accountId === null) return;
      const row = await getCharacter(accountId, Number(ownerSheetMatch[1]));
      if (!row) return json(res, 404, { error: 'character not found' });
      const [guild, rank] = await Promise.all([
        guildNameForCharacter(row.id),
        lifetimeXpRankForCharacter(row.id),
      ]);
      return json(
        res,
        200,
        characterSheet({
          row,
          visibility: 'owner',
          realm: REALM,
          origin: publicOrigin(req),
          guild,
          rank: toSheetRank(rank),
        }),
      );
    }
    const delMatch = /^\/api\/characters\/(\d+)$/.exec(url);
    const renameMatch = /^\/api\/characters\/(\d+)\/rename$/.exec(url);
    const takeoverMatch = /^\/api\/characters\/(\d+)\/takeover$/.exec(url);
    const standingMatch = /^\/api\/characters\/(\d+)\/standing$/.exec(url);
    if (req.method === 'GET' && standingMatch) {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      const standing = await lifetimeXpStanding(accountId, Number(standingMatch[1]));
      if (!standing) return json(res, 404, { error: 'character not found' });
      return json(res, 200, standing);
    }
    if (req.method === 'POST' && renameMatch) {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      const body = await readBody(req);
      const name = normalizeCharName(body.name);
      if (name === null) return json(res, 400, { error: 'invalid character name (2-16 letters)' });
      if (offensiveName(name)) return json(res, 400, { error: 'character name is not allowed' });
      const characterId = Number(renameMatch[1]);
      const character = await getCharacter(accountId, characterId);
      if (!character) return json(res, 404, { error: 'character not found' });
      // A rename is a moderator-sanctioned action: the character-select UI only
      // shows the rename control when a moderator has set force_rename. The UI is
      // not a security boundary, so gate here too: a normal owner hitting this
      // route directly must not be able to rename an un-flagged character. (The
      // UPDATE in renameCharacter re-checks the flag race-free; this returns a
      // clear 403 instead of a misleading 404.)
      if (!character.force_rename) {
        return json(res, 403, { error: 'character rename is not permitted' });
      }
      // A rename mutates the DB name and clears force_rename, but a live
      // ClientSession keeps its own copy of the name (used by reports, chat and
      // /api/status). Renaming an online character desyncs that copy and — worse
      // — lets a force-renamed player already in the world clear the moderation
      // flag without ever leaving. Mirror the DELETE guard and require offline.
      if ([...game.clients.values()].some((s) => s.characterId === characterId)) {
        return json(res, 400, { error: 'character is currently online' });
      }
      try {
        const c = await renameCharacter(accountId, characterId, name);
        if (!c) {
          // The force_rename-gated UPDATE matched no row even though the pre-check
          // passed: a concurrent rename cleared the flag, or the character was just
          // deleted. Re-resolve so the status stays consistent with the pre-check
          // (403 if it still exists but is no longer flagged, 404 if truly gone)
          // instead of always answering a misleading 404.
          const still = await getCharacter(accountId, characterId);
          if (still && !still.force_rename) {
            return json(res, 403, { error: 'character rename is not permitted' });
          }
          return json(res, 404, { error: 'character not found' });
        }
        if (game.rekeyMarketSeller(characterId, character.name, c.name)) {
          await game.saveMarket();
        }
        return json(res, 200, {
          id: c.id,
          name: c.name,
          class: c.class,
          level: c.level,
          forceRename: c.force_rename,
        });
      } catch (err: any) {
        if (isUniqueViolation(err)) return json(res, 409, { error: 'that name is taken' });
        throw err;
      }
    }
    if (req.method === 'POST' && takeoverMatch) {
      // Free a character's live session so this account can re-enter on it,
      // e.g. after a crash/closed tab left a stale session, or to hand a
      // character off from another device. Ownership-gated and idempotent.
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      const characterId = Number(takeoverMatch[1]);
      const character = await getCharacter(accountId, characterId);
      if (!character) return json(res, 404, { error: 'not found' });
      const result = await game.takeOverCharacter(accountId, characterId);
      return json(res, 200, { ok: true, takenOver: result === 'taken-over' });
    }
    if (req.method === 'DELETE' && delMatch) {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      const characterId = Number(delMatch[1]);
      const body = await readBody(req);
      const character = await getCharacter(accountId, characterId);
      if (!character) return json(res, 404, { error: 'not found' });
      if ([...game.clients.values()].some((s) => s.characterId === characterId)) {
        return json(res, 400, { error: 'character is currently online' });
      }
      if (normalizeDeleteConfirmation(body.name) !== normalizeDeleteConfirmation(character.name)) {
        return json(res, 400, { error: 'type the character name to confirm deletion' });
      }
      const ok = await deleteCharacter(accountId, characterId);
      return json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'not found' });
    }
    if (req.method === 'GET' && url === '/api/realms') {
      // optionally authenticated: with a token we also return how many
      // characters the account has on each realm (for the realm-list screen)
      const accountId = await bearerAccount(req);
      const characters = accountId !== null ? await characterCountsByRealm(accountId) : {};
      return json(res, 200, { current: REALM, realms: REALM_DIRECTORY, characters });
    }
    if (req.method === 'GET' && url === '/api/search') {
      const accountId = await bearerAccount(req);
      if (accountId === null) return json(res, 401, { error: 'not authenticated' });
      const q = new URL(req.url ?? '/', 'http://localhost').searchParams.get('q') ?? '';
      const results = q.trim().length >= 1 ? await searchCharacters(q, 8) : [];
      return json(res, 200, { results });
    }
    if (req.method === 'POST' && url === '/api/reports') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      const body = await readBody(req);
      const reason = cleanReportReason(body.reason);
      if (!reason) return json(res, 400, { error: 'choose a report reason' });
      const reporterCharacterId = Number(body.reporterCharacterId);
      if (!Number.isFinite(reporterCharacterId)) {
        return json(res, 400, { error: 'invalid report target' });
      }
      const reporter = await getCharacter(accountId, reporterCharacterId);
      if (!reporter) return json(res, 404, { error: 'reporting character not found' });
      const resolved = await resolveReportTarget(body, {
        reportTargetForPid: (pid) => game.reportTargetForPid(pid),
        findCharacterReportTargetByName,
      });
      if (!resolved.ok) return json(res, resolved.status, { error: resolved.error });
      try {
        const report = await createPlayerReport({
          reporterAccountId: accountId,
          reporterCharacterId: reporter.id,
          reporterCharacterName: reporter.name,
          target: resolved.target,
          reason,
          details: body.details,
        });
        return json(res, 200, { ok: true, reportId: report.id });
      } catch (err) {
        return json(res, 400, {
          error: err instanceof Error ? err.message : 'could not submit report',
        });
      }
    }
    if (req.method === 'POST' && url === '/api/bug-reports') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      // A downscaled screenshot data URL dominates the payload; allow ~1 MB
      // (well above the 64 KB JSON default) and surface an oversize body as 413.
      let body: any;
      try {
        body = await readBody(req, 1024 * 1024);
      } catch (err) {
        if (err instanceof Error && err.message === 'body too large') {
          return json(res, 413, { error: 'bug report too large' });
        }
        return json(res, 400, { error: 'bad request' });
      }
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      if (!description) return json(res, 400, { error: 'describe the bug' });
      const characterId = Number.isFinite(Number(body.characterId))
        ? Number(body.characterId)
        : null;
      // Only trust a character name the server can verify the account owns. A
      // missing or unowned characterId resolves to no name (never the client value).
      let characterName = '';
      let resolvedCharacterId: number | null = null;
      if (characterId !== null) {
        const character = await getCharacter(accountId, characterId);
        if (character) {
          resolvedCharacterId = character.id;
          characterName = character.name;
        }
      }
      const pos = body.pos && typeof body.pos === 'object' ? body.pos : {};
      try {
        // The screenshot allowlist and meta clamp live in createBugReport so they
        // apply to every insert path, not just this route.
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
        return json(res, 200, {
          ok: true,
          reportId: report.id,
          screenshotStored: report.screenshotStored,
        });
      } catch (err) {
        if (err instanceof BugReportRateLimitError) return json(res, 429, { error: err.message });
        throw err;
      }
    }
    if (req.method === 'POST' && url === '/api/perf-report') {
      return await handlePerfReport(req, res);
    }
    if (req.method === 'GET' && url === '/api/project-stats') {
      const accountsCount = await getAccountsCount();
      return json(res, 200, {
        accounts_created: accountsCount,
        players_online: game.clients.size,
        realm: REALM,
      });
    }
    if (req.method === 'GET' && url === '/api/status') {
      return json(res, 200, {
        ok: true,
        realm: REALM,
        players_online: game.clients.size,
        names: [...game.clients.values()].map((s) => s.name),
      });
    }
    // Dev-only world-loop perf profile (per-phase tick p95/max), for the load
    // harness. Gated by ALLOW_DEV_COMMANDS so it is never exposed in production.
    if (req.method === 'GET' && url === '/api/perf' && process.env.ALLOW_DEV_COMMANDS === '1') {
      return json(res, 200, game.perfProfile());
    }
    if (req.method === 'GET' && url === '/api/arena/leaderboard') {
      // public all-time Ashen Coliseum ladder (top rated characters)
      const params = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
      const format = params.get('format') === '2v2' ? '2v2' : '1v1';
      return json(res, 200, { format, leaders: await topArenaRatings(20, format) });
    }
    if (req.method === 'GET' && url === '/api/leaderboard') {
      // lifetime-XP leaderboard (Max-Level XP Overflow), served from the
      // in-memory cache. metric is fixed to lifetimeXp. ?scope=global ranks
      // across every realm (home page); default is this process's realm (the
      // in-game panel). `url` is the path only, so the query string is parsed
      // from req.url.
      const params = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
      const scope: 'realm' | 'global' = params.get('scope') === 'global' ? 'global' : 'realm';
      // ?board=guilds ranks GUILDS by summed member lifetime XP (default 'players'
      // is the per-character board below). Same cache + paging shape; the entry
      // shape differs, so it is its own served slice.
      if (params.get('board') === 'guilds') {
        const guildEntries = await getGuildLeaderboard(scope);
        const guildPageSize = Number(params.get('pageSize')) || LEADERBOARD_PAGE_SIZE;
        const guildPage = Number(params.get('page')) || 0;
        const guildSlice = paginateGuildLeaderboard(guildEntries, guildPage, guildPageSize);
        return json(res, 200, {
          realm: REALM,
          scope,
          board: 'guilds',
          metric: 'guildLifetimeXp',
          ...guildSlice,
        });
      }
      // ?board=devs ranks open-source CONTRIBUTORS by merged pull requests, sourced
      // from the cached public GitHub PR stats. The same data for every realm,
      // so it is realm-agnostic; rate-limited per IP like the other boards via the
      // shared route limiter is unnecessary here (it reads an in-memory cache), but
      // a failing GitHub fetch already backs off inside topContributors.
      if (params.get('board') === 'devs') {
        const devEntries = await topContributors();
        const devPageSize = Number(params.get('pageSize')) || LEADERBOARD_PAGE_SIZE;
        const devPage = Number(params.get('page')) || 0;
        const devSlice = paginateDevLeaderboard(devEntries, devPage, devPageSize);
        return json(res, 200, {
          realm: REALM,
          scope,
          board: 'devs',
          metric: 'landedCommits',
          ...devSlice,
        });
      }
      const entries = await getLeaderboard(scope);
      // Legacy ?limit=N (home-page board): top N as a single page, no paging UI.
      const limitParam = params.get('limit');
      if (limitParam !== null) {
        const limit = Math.max(
          1,
          Math.min(LEADERBOARD_SIZE, Number(limitParam) || LEADERBOARD_SIZE),
        );
        const leaders = entries.slice(0, limit);
        return json(res, 200, {
          realm: REALM,
          scope,
          metric: 'lifetimeXp',
          leaders,
          page: 0,
          pageCount: 1,
          total: leaders.length,
          pageSize: limit,
        });
      }
      // Paged in-game board: ?page=N (0-based) & ?pageSize=M, clamped server-side.
      const pageSize = Number(params.get('pageSize')) || LEADERBOARD_PAGE_SIZE;
      const page = Number(params.get('page')) || 0;
      const slice = paginateLeaderboard(entries, page, pageSize);
      return json(res, 200, { realm: REALM, scope, metric: 'lifetimeXp', ...slice });
    }
    if (req.method === 'GET' && url === '/api/releases') {
      recordUsageMetric('github.releases.api');
      // public News & Updates feed, mirrored from GitHub Releases and served
      // from the in-memory cache (refreshed at most every RELEASES_TTL_MS).
      // Optional ?limit=N (1..RELEASES_SIZE).
      const params = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
      const limit = Math.max(
        1,
        Math.min(RELEASES_SIZE, Number(params.get('limit')) || RELEASES_SIZE),
      );
      const entries = await getReleases();
      return json(res, 200, { repo: GITHUB_REPO, releases: entries.slice(0, limit) });
    }
    // Account self-service portal — all bearer-auth, account-scoped. Each route
    // delegates to an exported, testable handler in server/account.ts (mirroring
    // server/wallet.ts); main.ts only resolves the bearer account first.
    if (req.method === 'GET' && url === '/api/account') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      return handleAccountWhoami(res, accountId);
    }
    if (req.method === 'POST' && url === '/api/account/password') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      // Resolve the caller's own token once so the revoke inside the handler can
      // never accidentally fall back to null (which would nuke this session too).
      const callerToken = bearerToken(req);
      if (!callerToken) return json(res, 401, { error: 'not authenticated' });
      return handleAccountChangePassword(req, res, accountId, callerToken);
    }
    if (req.method === 'POST' && url === '/api/account/logout') {
      const callerToken = bearerToken(req);
      if (!callerToken || (await accountForToken(callerToken)) === null)
        return json(res, 401, { error: 'not authenticated' });
      return handleAccountLogout(res, callerToken);
    }
    if (req.method === 'POST' && url === '/api/account/email') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      return handleAccountSetEmail(req, res, accountId);
    }
    // Set the recovery email on an account that has none yet (the mandatory-email
    // backfill the client forces on sign-in). Bearer-scoped; rejects once an
    // address already exists (that must go through the verified change flow).
    if (req.method === 'POST' && url === '/api/account/email/set-initial') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      return handleAccountSetInitialEmail(req, res, accountId);
    }
    if (req.method === 'POST' && url === '/api/account/deactivate') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      return handleAccountDeactivate(req, res, accountId, {
        anyCharacterOnline: (characterIds) =>
          [...game.clients.values()].some(
            (s) => s.characterId != null && characterIds.includes(s.characterId),
          ),
        disconnectAccount: (id, reason) => game.disconnectAccount(id, reason),
      });
    }
    // Companion read-only tokens: a 90-day scope='read' token a user can paste
    // into a companion app instead of running OAuth. Managed from a full web
    // session only (bearerActiveAccount rejects read tokens, so a read token can
    // never mint or list more — no privilege escalation).
    if (url === '/api/account/companion-token') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      if (req.method === 'POST') {
        const body = await readBody(req);
        const rawLabel = typeof body.label === 'string' ? body.label.trim().slice(0, 64) : '';
        const label = rawLabel || null;
        const token = newToken();
        const COMPANION_TOKEN_TTL_HOURS = 24 * 90;
        await createCompanionToken(token, accountId, label, COMPANION_TOKEN_TTL_HOURS);
        // The full secret is returned ONCE, on creation; it is never listed again.
        return json(res, 200, { token, label, scope: 'read', expiresInDays: 90 });
      }
      if (req.method === 'GET') {
        return json(res, 200, { tokens: await listCompanionTokens(accountId) });
      }
      if (req.method === 'DELETE') {
        const body = await readBody(req);
        const prefix = typeof body.prefix === 'string' ? body.prefix.trim().toLowerCase() : '';
        const ok = await revokeCompanionToken(accountId, prefix);
        return json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'token not found' });
      }
    }
    if (req.method === 'POST' && url === '/api/account/email/change') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      return handleAccountEmailChange(req, res, accountId);
    }
    // Email-change verification is a link click from the inbox: unauthenticated,
    // the token is the authorization. Parse the token off the query string.
    if (req.method === 'GET' && url === '/api/account/email/verify') {
      const token = new URL(req.url ?? '', 'http://localhost').searchParams.get('token') ?? '';
      return handleAccountEmailVerify(res, token);
    }
    if (req.method === 'POST' && url === '/api/account/export') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      return handleAccountExport(req, res, accountId);
    }
    if (req.method === 'POST' && url === '/api/account/marketing') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      return handleAccountMarketing(req, res, accountId);
    }
    if (req.method === 'POST' && url === '/api/account/2fa/setup') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      return handleAccount2faSetup(req, res, accountId);
    }
    if (req.method === 'POST' && url === '/api/account/2fa/enable') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      return handleAccount2faEnable(req, res, accountId);
    }
    if (req.method === 'POST' && url === '/api/account/2fa/disable') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      return handleAccount2faDisable(req, res, accountId);
    }
    // Public one-click marketing unsubscribe (link from a marketing email).
    if (req.method === 'GET' && url === '/api/email/unsubscribe') {
      const token = new URL(req.url ?? '', 'http://localhost').searchParams.get('token') ?? '';
      return handleEmailUnsubscribe(res, token);
    }
    // Non-custodial Solana wallet linking — all account-scoped.
    if (req.method === 'POST' && url === '/api/wallet/link/challenge') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      return handleWalletChallenge(req, res, accountId);
    }
    if (req.method === 'POST' && url === '/api/wallet/link') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      return handleWalletLink(req, res, accountId);
    }
    if (req.method === 'DELETE' && url === '/api/wallet/link') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      return handleWalletUnlink(req, res, accountId);
    }
    if (req.method === 'GET' && url === '/api/wallet') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      return handleWalletGet(req, res, accountId);
    }
    // Discord integration: OAuth login/link, link status, unlink. `start` returns
    // the authorize URL (the browser then navigates to Discord); `callback` is the
    // discord.com -> us redirect (no auth/Origin, so it is NOT gated by the
    // web-login guard, which is login/register-only). Mutations go through
    // bearerActiveAccount; the dedicated Discord rate-limit bucket guards them.
    if (req.method === 'POST' && url === '/api/auth/discord/start') {
      const mode =
        new URL(req.url ?? '/', 'http://localhost').searchParams.get('mode') === 'link'
          ? 'link'
          : 'login';
      let accountId: number | null = null;
      if (mode === 'link') {
        accountId = await bearerActiveAccount(req, res);
        if (accountId === null) return;
      }
      if (discordRateLimited(req, accountId ?? 0)) return json(res, 429, { error: 'rate limited' });
      return handleDiscordStart(req, res, { mode, accountId });
    }
    if (req.method === 'GET' && url === '/api/auth/discord/callback') {
      return handleDiscordCallback(req, res);
    }
    // First-time-login chooser endpoints. Unauthenticated like /callback: the
    // authorization is the single-use pending-login token (minted only after a
    // verified Discord OAuth), and the handlers carry their own Discord rate-limit
    // bucket + (for the link path) the same password/2FA/moderation checks as login.
    if (req.method === 'POST' && url === '/api/auth/discord/login/new') {
      return handleDiscordLoginNew(req, res, (ip) => game.isIpBlocked(ip));
    }
    if (req.method === 'POST' && url === '/api/auth/discord/login/link') {
      return handleDiscordLoginLink(req, res, (ip) => game.isIpBlocked(ip));
    }
    if (req.method === 'GET' && url === '/api/discord') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      if (discordRateLimited(req, accountId)) return json(res, 429, { error: 'rate limited' });
      return handleDiscordStatus(req, res, accountId);
    }
    if (req.method === 'DELETE' && url === '/api/discord') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      if (discordRateLimited(req, accountId)) return json(res, 429, { error: 'rate limited' });
      return handleDiscordUnlink(req, res, accountId);
    }
    // GitHub OAuth link (developer badge). Link-only: the start leg resolves the
    // caller's account first, so the verified GitHub identity attaches to a known
    // account. The callback carries no Origin (a github.com redirect) and is
    // exempt from the web-login Origin guard, exactly like the Discord callback.
    if (req.method === 'POST' && url === '/api/auth/github/start') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      if (githubRateLimited(req, accountId)) {
        recordUsageMetric('github.link.rate_limited');
        return json(res, 429, { error: 'rate limited' });
      }
      return handleGitHubStart(req, res, { accountId });
    }
    if (req.method === 'GET' && url === '/api/auth/github/callback') {
      return handleGitHubCallback(req, res);
    }
    if (req.method === 'GET' && url === '/api/github') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      if (githubRateLimited(req, accountId)) return json(res, 429, { error: 'rate limited' });
      return handleGitHubStatus(req, res, accountId);
    }
    if (req.method === 'DELETE' && url === '/api/github') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      if (githubRateLimited(req, accountId)) return json(res, 429, { error: 'rate limited' });
      return handleGitHubUnlink(req, res, accountId);
    }
    // $WOC balance proxy — keeps the Solana RPC endpoint (and any key in it)
    // server-side so it never ships in the client bundle. Public (on-chain
    // balances are public) but narrow + IP rate-limited + per-wallet cached.
    if (req.method === 'GET' && url === '/api/woc/balance') {
      if (wocBalanceRateLimited(req)) {
        recordUsageMetric('woc.balance.rate_limited');
        return json(res, 429, { error: 'rate limited' });
      }
      // `fresh=1` is parsed AFTER the IP rate-limit above, so it can't be used to hammer the RPC.
      const { owner, fresh } = parseWocBalanceQuery(req.url ?? '');
      return handleWocBalance(res, owner, fresh);
    }
    if (url.startsWith('/api/daily-rewards')) {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      return handleDailyRewardApi(req, res, accountId);
    }
    // Shareable player card: publish (PNG body) + referral stats for the card.
    if (req.method === 'POST' && url === '/api/card') {
      recordUsageMetric('card.publish.request');
      if (cardUploadContentLengthTooLarge(req)) {
        recordUsageMetric('card.publish.rejected');
        res.shouldKeepAlive = false;
        res.setHeader('Connection', 'close');
        return json(res, 413, { error: 'image too large' });
      }
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      if (cardUploadRateLimited(req, accountId)) {
        recordUsageMetric('card.publish.rate_limited');
        return json(res, 429, { error: 'rate limited' });
      }
      return handleCardUpload(req, res, accountId, (characterId) =>
        game.liveLevelForCharacter(characterId),
      );
    }
    if (req.method === 'GET' && url === '/api/referrals') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      const [count, slug] = await Promise.all([
        referralCountForAccount(accountId),
        primarySlugForAccount(accountId),
      ]);
      return json(res, 200, { count, slug });
    }
    json(res, 404, { error: 'unknown endpoint' });
  } catch (err: any) {
    console.error('api error:', err);
    json(res, 500, { error: 'internal error' });
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // wait for the database (it may still be starting in docker)
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch (err) {
      if (attempt >= 30) throw err;
      console.log(`waiting for postgres (attempt ${attempt})...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await ensureSchema();
  await seedOAuthClients();
  const orphans = await closeOrphanSessions();
  if (orphans > 0) console.log(`closed ${orphans} orphaned play session(s) from a previous run`);
  const pruned = await pruneChatLogs(CHAT_LOG_RETENTION_DAYS);
  if (pruned > 0)
    console.log(`pruned ${pruned} chat log row(s) older than ${CHAT_LOG_RETENTION_DAYS} days`);
  const prunedPerfReports = await pruneClientPerfReports(PERF_REPORT_RETENTION_DAYS);
  if (prunedPerfReports > 0)
    console.log(
      `pruned ${prunedPerfReports} client perf report row(s) older than ${PERF_REPORT_RETENTION_DAYS} days`,
    );
  await game.loadMarket();
  await game.loadChatFilter();
  await game.loadBlockedIps();
  void game.recordOnlineSnapshot();
  void currentSitePresenceUsers()
    .then((count) => recordSitePresenceSample(count))
    .catch((err) => console.error('site presence sample failed:', err));
  setInterval(
    () => {
      void pruneChatLogs(CHAT_LOG_RETENTION_DAYS).catch((err) =>
        console.error('chat log prune failed:', err),
      );
      void pruneClientPerfReports(PERF_REPORT_RETENTION_DAYS).catch((err) =>
        console.error('perf report prune failed:', err),
      );
      void pruneExpiredOAuthGrants(pool).catch((err) =>
        console.error('oauth grant prune failed:', err),
      );
      void pruneDiscordOAuthStates(pool).catch((err) =>
        console.error('discord oauth state prune failed:', err),
      );
      void pruneDiscordPendingLogins(pool).catch((err) =>
        console.error('discord pending login prune failed:', err),
      );
      void pruneGitHubOAuthStates(pool).catch((err) =>
        console.error('github oauth state prune failed:', err),
      );
    },
    24 * 3600 * 1000,
  ).unref();
  setInterval(() => {
    void game.recordOnlineSnapshot();
    void currentSitePresenceUsers()
      .then((count) => recordSitePresenceSample(count))
      .catch((err) => console.error('site presence sample failed:', err));
  }, ADMIN_ONLINE_SAMPLE_MS).unref();
  setInterval(() => {
    void pruneExpiredBlockedIps().catch((err) => console.error('blocked IP prune failed:', err));
    void game
      .reloadBlockedIps()
      .then(() => game.disconnectBlockedSessions('Connection to the server was lost.'))
      .catch((err) => console.error('blocked IP refresh failed:', err));
  }, BLOCKED_IP_REFRESH_MS).unref();
  // keep both leaderboard caches warm so the first viewer never waits on the
  // query and it never recomputes per request (PR-3)
  const warmLeaderboards = () => {
    void refreshLeaderboard('realm').catch((err) =>
      console.error('leaderboard refresh failed (realm):', err),
    );
    void refreshLeaderboard('global').catch((err) =>
      console.error('leaderboard refresh failed (global):', err),
    );
    void refreshGuildLeaderboard('realm').catch((err) =>
      console.error('guild leaderboard refresh failed (realm):', err),
    );
    void refreshGuildLeaderboard('global').catch((err) =>
      console.error('guild leaderboard refresh failed (global):', err),
    );
  };
  warmLeaderboards();
  setInterval(warmLeaderboards, LEADERBOARD_TTL_MS).unref();
  console.log('database ready');

  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    const path = url.split('?')[0];
    const isApi = url.startsWith('/api/') || url.startsWith('/admin/api/');
    // Public read surfaces (/api/public/..., /avatar/...) are CORS-open to any
    // origin so browser-origin companion apps can call them client-side; every
    // other /api route keeps the narrow realm/native allowlist.
    const publicCorsPath = isPublicCorsPath(path);
    if (publicCorsPath) publicCors(res);
    else if (isApi) maybeCors(req, res);
    if (req.method === 'OPTIONS' && (isApi || publicCorsPath)) {
      res.writeHead(204);
      res.end();
      return;
    }
    if (url.startsWith('/internal/')) {
      void (async () => {
        if (await handleDailyRewardInternalApi(req, res)) return;
        await handleInternalApi(req, res, game);
      })();
    } else if (url.startsWith('/admin/api/')) void handleAdminApi(req, res, game);
    else if (url.startsWith('/api/')) void handleApi(req, res);
    else if (url.startsWith('/oauth/')) void handleOAuth(req, res);
    else if (req.method === 'GET' && url.startsWith('/p/')) void handleCardRoutes(req, res);
    else if (req.method === 'GET' && path.startsWith('/avatar/')) void handleAvatar(req, res);
    else if (req.method === 'GET' && path.startsWith('/c/')) void handleProfilePage(req, res);
    else if (req.method === 'GET' && path === '/sitemap-characters.xml')
      void handleCharacterSitemap(req, res);
    else serveStatic(req, res);
  });

  // cap frame size: the largest legitimate client message is a small JSON
  // command; without this the ws default (~100 MiB) lets one socket force a
  // huge allocation + parse before any field-level validation runs
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      void onConnection(ws, req);
    });
  });

  async function authenticateWebSocket(
    ws: WebSocket,
    raw: string,
    req: http.IncomingMessage,
  ): Promise<void> {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ t: 'error', error: 'bad auth message' }));
      ws.close();
      return;
    }
    if (msg?.t !== 'auth') {
      ws.send(JSON.stringify({ t: 'error', error: 'authentication required' }));
      ws.close();
      return;
    }

    const token = typeof msg.token === 'string' ? msg.token : '';
    const characterId = Number(msg.character ?? 'NaN');
    const clientSeed = typeof msg.clientSeed === 'string' ? msg.clientSeed : '';
    const accountId = await accountForToken(token);
    if (accountId === null || !Number.isFinite(characterId)) {
      ws.send(JSON.stringify({ t: 'error', error: 'not authenticated' }));
      ws.close();
      return;
    }
    const status = await moderationStatusForAccount(accountId);
    if (status.locked) {
      ws.send(JSON.stringify({ t: 'error', error: status.message }));
      ws.close();
      return;
    }
    const character = await getCharacter(accountId, characterId);
    if (!character) {
      ws.send(JSON.stringify({ t: 'error', error: 'no such character' }));
      ws.close();
      return;
    }
    if (character.force_rename) {
      ws.send(
        JSON.stringify({
          t: 'error',
          error: 'This character must be renamed before entering the world.',
        }),
      );
      ws.close();
      return;
    }
    const chatMute = await chatMuteStatusForAccount(accountId);
    // Hard per-IP WS connection limit. The soft threshold (composite score evidence)
    // is handled inside game.join(); this guard blocks egregious bot farms before
    // they consume a session slot.
    const ip = requestMetadata(req).ip;
    const isAdmin = await isAdminAccount(accountId);
    if (
      isConnectionRefused({
        blocked: game.isIpBlocked(ip),
        isAdmin,
        ipSessions: game.countIpSessions(ip),
        hardLimit: MAX_WS_PER_IP_HARD,
      })
    ) {
      ws.close(1008, 'Too many connections from your network');
      return;
    }
    const accountCosmetics = await loadAccountCosmetics(accountId);
    const result = game.join(
      ws,
      accountId,
      character.id,
      character.name,
      character.class,
      character.state,
      character.is_gm,
      {
        ...requestMetadata(req),
        mutedUntil: status.chatMutedUntil ?? chatMute.mutedUntil,
        reason: chatMute.reason,
        chatStrikes: status.chatStrikes,
        accountCosmetics,
        isAdmin,
        clientSeed,
      },
    );
    if ('error' in result) {
      ws.send(JSON.stringify({ t: 'error', error: result.error }));
      ws.close();
      return;
    }
    const session = result;
    console.log(`+ ${character.name} (${character.class}) joined — ${game.clients.size} online`);
    ws.on('message', (data) => {
      game.handleMessage(session, String(data));
    });
    ws.on('close', () => {
      void game.leave(session, 'disconnected');
      console.log(`- ${character.name} left — ${game.clients.size} online`);
    });
    ws.on('error', () => {
      void game.leave(session, 'connection error');
    });
  }

  async function onConnection(ws: WebSocket, req: http.IncomingMessage): Promise<void> {
    const authTimer = setTimeout(() => {
      ws.send(JSON.stringify({ t: 'error', error: 'authentication timed out' }));
      ws.close();
    }, 10_000);

    // Pre-auth socket errors (e.g. a first frame over maxPayload, which ws
    // surfaces as an 'error' event) would otherwise be an unhandled exception
    // and crash the process. Tear the connection down quietly instead. The
    // post-auth game.leave handler is attached separately once joined.
    ws.on('error', () => {
      clearTimeout(authTimer);
      try {
        ws.close();
      } catch {
        /* already closing */
      }
    });

    ws.once('message', (data) => {
      clearTimeout(authTimer);
      // Buffer any frames the client sends while the async auth/join handshake
      // is still in flight, then replay them once authenticateWebSocket has
      // attached the permanent message handler. Without this the frames are
      // silently dropped (see ws_buffer.ts).
      const flush = bufferHandshakeMessages(ws);
      void authenticateWebSocket(ws, String(data), req).finally(flush);
    });
  }

  game.start();
  server.listen(PORT, () => {
    console.log(`World of ClaudeCraft server listening on http://localhost:${PORT}`);
    console.log(`  REST: /api/register /api/login /api/characters /api/status`);
    console.log(`  WS:   /ws, then first message {t:"auth",token,character}`);
  });

  const shutdown = async () => {
    console.log('shutting down: saving characters...');
    game.stop();
    await game.saveAll('shutdown');
    await game.saveMarket();
    await game.endAllPlaySessions();
    await game.chatLog.stop();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Last-resort net: one player's request must never crash the process and
  // disconnect everyone. handleMessage already guards itself, but any future
  // uncaught throw in a timer or async path would otherwise be fatal. Log and
  // keep serving — a live world staying up beats a clean crash-loop. Genuinely
  // fatal startup errors are still handled by main().catch() below.
  process.on('uncaughtException', (err) => {
    console.error('uncaughtException (kept alive):', err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('unhandledRejection (kept alive):', reason);
  });
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
