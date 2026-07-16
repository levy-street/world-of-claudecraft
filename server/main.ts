import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { WebSocketServer } from 'ws';
import { DEEDS } from '../src/sim/content/deeds';
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
import type {
  DeedsLeaderboardEntry,
  DeedsLeaderboardSelf,
  GuildLeaderboardEntry,
  LeaderboardEntry,
} from '../src/world_api';
import {
  configureAccountRuntime,
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
  handleAccountPasswordForgot,
  handleAccountPasswordReset,
  handleAccountSetEmail,
  handleAccountSetInitialEmail,
  handleAccountWhoami,
  handleEmailUnsubscribe,
  verifyLoginTwoFactor,
} from './account';
import { configureAdminRuntime, handleAdminApi } from './admin';
import { currentSitePresenceUsers, recordSitePresenceSample } from './admin_db';
import { permissionsForRoles } from './admin_permissions';
import { loadAntibotConfig } from './antibot_config_db';
import {
  configureAppleAuthRuntime,
  handleAppleLogin,
  handleAppleLoginLink,
  handleAppleLoginNew,
} from './apple_auth';
import { pruneApplePendingLogins } from './apple_auth_db';
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
import { configureAuthRuntime } from './auth_routes';
import { computeBankBonus } from './bank_entitlements';
import { bankLedgerIdle } from './bank_ledger';
import { BUG_DESCRIPTION_MAX, BugReportRateLimitError, createBugReport } from './bug_report_db';
import { characterSheet, SHEET_RECENT_DEEDS, type SheetRank } from './character_sheet';
import { configureCharactersRuntime } from './characters';
import {
  claudiumPreAuthMutationRateLimited,
  configureClaudiumRuntime,
  handleClaudiumApi,
  handleClaudiumStripeWebhook,
} from './claudium';
import { handleDailyRewardApi, handleDailyRewardInternalApi } from './daily_rewards';
import {
  accountAndScopeForToken,
  accountById,
  accountForToken,
  acquireCharacterLease,
  bankBonusFactsForAccount,
  type CharacterRow,
  characterCountsByRealm,
  charactersForDeedsBoard,
  chatMuteStatusForAccount,
  closeOrphanSessions,
  createAccount,
  createCharacterCapped,
  createCompanionToken,
  deedsBoardRanked,
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
  releaseAllCharacterLeases,
  releaseCharacterLease,
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
import { configureDeedsRuntime } from './deeds';
import {
  buildDeedsBoardEntries,
  DEEDS_BOARD_ENTRY_FLOOR,
  deedsBoardSelf,
  type RankedDeedsAccount,
} from './deeds_board';
import {
  DEEDS_BOARD_DEMAND_TTL_MS,
  singleFlight,
  warmDeedsBoardIfDemanded,
} from './deeds_board_warm';
import { deedRarityCounts, recentDeedsForCharacter } from './deeds_db';
import { deedRecordsIdle, publicRarityPayload } from './deeds_records';
import {
  type DesktopLoginRouteDeps,
  handleDesktopLoginExchange,
  issueDesktopLoginCode,
} from './desktop_login';
import {
  configureDiscordRuntime,
  handleDiscordCallback,
  handleDiscordLoginLink,
  handleDiscordLoginNew,
  handleDiscordStart,
  handleDiscordStatus,
  handleDiscordUnlink,
  handleNativeDiscordExchange,
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
import { configureGithubContributorsRuntime, topContributors } from './github_contributors';
import { pruneGitHubOAuthStates } from './github_db';
import { createAccessLogSink } from './http/access_log';
import { setAttackSignalSink } from './http/attack_signals';
import { registerBusinessMetrics } from './http/business_metrics';
import { handleClientError } from './http/client_error';
import { type Config, DEFAULT_DISPATCH, type DispatchMode, loadConfig } from './http/config';
import {
  type ApiDelegate,
  type ApiDispatcher,
  createApiDispatcher,
  selectApiEntry,
} from './http/dispatch';
import { type GameStateSource, registerGameStateMetrics } from './http/game_metrics';
import { setGameMetricsCounters } from './http/game_signals';
import {
  handleLivez,
  handleMetricsGate,
  handleReadyz,
  markDraining,
  registerLivenessSource,
} from './http/health';
import { type Logger, logger } from './http/logger';
import { createHttpMetrics } from './http/metrics';
import { teeMetricSink } from './http/middleware/metric_sink';
import { withSecurityHeaders } from './http/middleware/security_headers';
import { apiRegistry } from './http/registry';
import { applyServerTimeouts, MAX_HEADER_SIZE_BYTES } from './http/server_timeouts';
import {
  contentLengthExceeds,
  isUniqueViolation,
  json,
  moderationErrorBody,
  readBody,
} from './http_util';
import { configureInternalRuntime, handleInternalApi } from './internal';
import { isConnectionRefused } from './ip_block';
import { pruneExpiredBlockedIps } from './ip_block_db';
import { buildDeedsBoard, configureLeaderboardRuntime, type ReleaseEntry } from './leaderboard';
import { MAX_MAP_SAVE_BYTES } from './maps';
import {
  mapDeleteCore,
  mapForkCore,
  mapGetCore,
  mapSaveCore,
  mapSetPublishedCore,
  mapsCreateCore,
  mapsListMineCore,
  mapsPublicListCore,
} from './maps_routes';
import { metaEventSourceUrl, metaRequestUserData, trackAccountCreated } from './meta_capi';
import {
  cleanReportReason,
  createPlayerReport,
  createSuspiciousRegistrationReport,
  setOnAccountModerated,
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
  assetUploadRateLimited,
  authThrottled,
  cardUploadRateLimited,
  clearAuthFailures,
  discordRateLimited,
  githubRateLimited,
  mapMutationRateLimited,
  publicReadRateLimited,
  rateLimited,
  recordAuthFailure,
  requestIp,
  setRateLimitTier2Store,
  wocBalanceRateLimited,
} from './ratelimit';
import { createPgRateLimitStore } from './ratelimit_db';
import { isPublicCorsPath, publicOriginFromRequest, REALM, REALM_DIRECTORY } from './realm';
import { resolveReportTarget } from './report_target';
import { BUG_REPORT_MAX_BODY_BYTES, configureReportsRuntime } from './reports';
import { resolveSfxOverlayFile } from './sfx_overlay';
import { handleSitePresenceHeartbeat } from './site_presence';
import { adminRolesForAccount } from './staff_db';
import {
  cacheControlFor,
  etagFor,
  isNotModified,
  isPublicSfxPath,
  requestedSfxBlobHash,
  requestedSfxVersion,
  sfxBlobIntegrityMatches,
} from './static_cache';
import { readStaticSfxSnapshot, type StaticSfxSnapshot } from './static_sfx';
import { stopSteamMirror } from './steam/mirror';
import { passesTurnstile } from './turnstile';
import { MAX_ASSET_BYTES } from './user_assets';
import {
  assetBytesCore,
  assetDeleteCore,
  assetsListMineCore,
  assetUploadCore,
} from './user_assets_routes';
import {
  configureWalletRuntime,
  handleWalletChallenge,
  handleWalletGet,
  handleWalletLink,
  handleWalletUnlink,
} from './wallet';
import { allowedCorsOrigin, isWebClientRequest } from './web_login_guard';
import { handleWocBalance, parseWocBalanceQuery } from './woc_balance';
import { createWsAuth } from './ws_auth';
import { bufferHandshakeMessages } from './ws_buffer';

// The one validated boot Config, loaded ONCE and memoized. Boot-consumed values
// (port, retention, dispatch, ws cap) thread directly off the local `config` in
// startServer, which primes this accessor as its first step. Request-time consumers
// (handleApi, the releases feed, the leaderboard runtime, the /metrics gate) read
// activeConfig() so a bare import of this module reads no env and calls loadConfig
// nowhere: the read resolves lazily at first call and sees the same values the old
// module-scope process.env consts saw. loadConfig runs at most once per process
// (fail fast on a garbage env). resetActiveConfigForTests mirrors the existing
// setApiDispatchModeForTests seam so a test can re-load after mutating process.env.
let activeConfigCache: Config | null = null;
function activeConfig(): Config {
  if (activeConfigCache === null) activeConfigCache = loadConfig(process.env);
  return activeConfigCache;
}

/** Test-only: drop the memoized Config so the next activeConfig() re-reads process.env. */
export function resetActiveConfigForTests(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('resetActiveConfigForTests must not be called in production');
  }
  activeConfigCache = null;
}

// The realm player cap advertised on /api/status, canonicalized for the wire: a
// configured 0 or negative (the cap disabled) is normalized to 0 so the field is
// always a non-negative count. Both /api/status arms (the legacy handleApi twin
// below and the migrated statusHandler via the injected leaderboard runtime) read
// it here, so the players_cap field stays byte-identical across the two arms.
function canonicalPlayersCap(): number {
  return Math.max(0, activeConfig().maxPlayersPerRealm);
}

const STATIC_DIR = path.join(__dirname, '..', 'dist');
const SFX_PACK_DIR = process.env.SFX_PACK_DIR?.trim()
  ? path.resolve(process.env.SFX_PACK_DIR.trim())
  : null;
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
  ['/editor', '/editor.html'],
  ['/editor/', '/editor.html'],
]);
// Chat-log and perf-report retention days (0 = forever) plus the Turnstile secret
// and the hard per-IP WS cap now live on the boot Config (see activeConfig above):
// startServer reads config.chatLogRetentionDays / .perfReportRetentionDays /
// .maxWsPerIpHard, and handleApi reads activeConfig().turnstileSecret.
const ADMIN_ONLINE_SAMPLE_MS = 60_000;
// Each realm re-reads the blocklist on this interval so edits on another realm
// process propagate and expired blocks fall out.
const BLOCKED_IP_REFRESH_MS = 60_000;
// The hard WS frame cap: the largest legitimate client message is a small JSON
// command, so 16 KiB is generous. NEVER widen it (server/CLAUDE.md invariant):
// without a tight cap the ws default (~100 MiB) lets one socket force a huge
// allocation + parse before any field-level validation runs, so one socket could
// OOM the process or stall the 20 Hz loop.
const WS_MAX_PAYLOAD_BYTES = 16 * 1024;
// Boot DB-readiness retry: Postgres may still be starting under docker, so poll
// SELECT 1 up to DB_BOOT_MAX_ATTEMPTS times, DB_BOOT_RETRY_MS apart, before giving
// up (~1 minute total at 30 attempts x 2s).
const DB_BOOT_MAX_ATTEMPTS = 30; // attempts (count)
const DB_BOOT_RETRY_MS = 2_000;
// Low-frequency background prune (OAuth grants/states, chat logs, perf reports)
// runs once a day.
const DAILY_PRUNE_INTERVAL_MS = 24 * 3600 * 1000;

// The live GameServer, constructed on FIRST TOUCH via liveGame() (the
// activeConfig() memoization pattern). Production takes that first touch inside
// startServer(); nothing else touches the game until then (routes, timers, and
// the WS server are all wired later inside startServer(), and every module-scope
// configure*Runtime closure defers its liveGame() read to request time). The
// parity/characterization harnesses import this module and drive routeHttpRequest
// WITHOUT running startServer(), so their first request constructs the world
// lazily instead of at module load.
let gameInstance: GameServer | null = null;
function liveGame(): GameServer {
  gameInstance ??= new GameServer();
  return gameInstance;
}

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
// refresh on an interval. The query is never run per request under load, at
// most once per LEADERBOARD_TTL_MS, plus the boot warm-up below.
// ---------------------------------------------------------------------------
const LEADERBOARD_TTL_MS = 30_000;
// Cache the full exposed depth (LEADERBOARD_MAX) once per scope; the REST handler
// pages through it as an in-memory slice, so no extra query per page click.
const LEADERBOARD_SIZE = LEADERBOARD_MAX;
// Monotonic generation counter for every player-derived board cache. A refresh
// captures it before its first await and installs its result only if it is still
// unchanged when the read returns; bustBoardCaches (the moderation hook) bumps
// it. This closes a lost-bust race: a ban landing while a refresh is in flight
// would otherwise be overwritten by that refresh's pre-ban snapshot for up to
// one TTL cycle. The in-flight caller still gets the computed snapshot; the cache
// is left null so the NEXT read triggers a fresh refresh whose SQL delists the
// account via ELIGIBLE_ACCOUNT_SQL.
let boardEpoch = 0;
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
  const epoch = boardEpoch;
  const rows = await topLifetimeXp(LEADERBOARD_SIZE, { global: scope === 'global' });
  const entries: LeaderboardEntry[] = rows.map((r, i) => ({
    rank: i + 1,
    name: r.name,
    cls: r.class,
    level: r.level,
    virtualLevel: virtualLevel(r.lifetimeXp),
    lifetimeXp: r.lifetimeXp,
    prestigeRank: r.prestigeRank,
    // a deed id (never display text); the client localizes via deed_i18n
    title: r.activeTitle,
    ...(scope === 'global' ? { realm: r.realm } : {}),
  }));
  // Skip the install if a moderation bust landed mid-refresh (see boardEpoch).
  if (boardEpoch === epoch) leaderboardCache[scope] = { at: Date.now(), entries };
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
  const epoch = boardEpoch;
  const rows = await topGuilds(LEADERBOARD_SIZE, { global: scope === 'global' });
  const entries: GuildLeaderboardEntry[] = rows.map((r, i) => ({
    rank: i + 1,
    name: r.name,
    memberCount: r.memberCount,
    totalLifetimeXp: r.totalLifetimeXp,
    topLevel: r.topLevel,
    ...(scope === 'global' ? { realm: r.realm } : {}),
  }));
  // Skip the install if a moderation bust landed mid-refresh (see boardEpoch).
  if (boardEpoch === epoch) guildLeaderboardCache[scope] = { at: Date.now(), entries };
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

// Renown (deeds) board cache. Same compute-once/serve-from-memory shape as
// the boards above, but ONE entry, not one per scope: the board is
// account-level and accounts span realms, so it is GLOBAL-ONLY by design.
// `entries` is the public, display-character-faced list (paged by the route;
// NEVER carries an account id); `ranked` keeps the accountId-keyed ranking
// INTERNALLY for the self-rank read, and totalRanked is the pre-cap total the
// percentile uses.
interface DeedsBoardCache {
  at: number;
  entries: DeedsLeaderboardEntry[];
  ranked: RankedDeedsAccount[];
  totalRanked: number;
}
let deedsBoardCache: DeedsBoardCache | null = null;
// Wall-clock ms of the last actual deeds-board request in THIS process, 0 before
// the first. Stamped on the shared read path (ensureDeedsBoard) and read by the
// warm loop's demand gate so the full-table board read only runs while someone is
// viewing (see deeds_board_warm.ts). Per-process like the board caches: peer
// realm processes gate their own warm loops off their own local demand.
let deedsBoardLastRequestAt = 0;

async function refreshDeedsBoard(): Promise<DeedsBoardCache> {
  const epoch = boardEpoch;
  // Renown values are content-owned (never in SQL), so hand the whole content
  // table to the SQL roll-up as two parallel arrays plus the floor. deedsBoardRanked
  // aggregates IN Postgres and returns only the ranked accounts, 1:1 with the
  // former computeDeedsBoard(rows).ranked shape.
  const deedIds = Object.keys(DEEDS);
  const renowns = deedIds.map((id) => DEEDS[id].renown);
  const board = await deedsBoardRanked(deedIds, renowns, DEEDS_BOARD_ENTRY_FLOOR);
  if (board.unknownDeedIds.length > 0) {
    // Rows for removed/renamed content are skipped, never scored; surface the
    // ids so a content rename is noticed instead of silently shrinking scores.
    console.error('deeds board: skipping unknown deed ids:', board.unknownDeedIds.join(', '));
  }
  // buildDeedsBoardEntries faces each ranked account with its display
  // character and SKIPS an account whose character vanished mid-refresh
  // (deleted between the row read and this fill; the rows cascade away by the
  // next refresh), never minting a blank row.
  const entries = buildDeedsBoardEntries(
    board.ranked,
    await charactersForDeedsBoard(board.ranked.map((a) => a.displayCharacterId)),
  );
  const cache: DeedsBoardCache = {
    at: Date.now(),
    entries,
    ranked: board.ranked,
    totalRanked: board.totalRanked,
  };
  // Skip the install if a moderation bust landed mid-refresh (see boardEpoch);
  // the in-flight caller still gets this snapshot, the next read self-corrects.
  if (boardEpoch === epoch) deedsBoardCache = cache;
  return cache;
}

// Single-flight on the board refresh, covering BOTH read paths: the inline
// read (ensureDeedsBoard) and the demand-warm loop. The board read is the one
// full-table roll-up here, so callers racing a cold or just-expired cache (a
// login-page storm on a fresh process, or a warm tick landing on an inline
// request, since the warm interval equals the cache TTL) must share ONE
// refresh: concurrent flights would multiply the most expensive query the
// process has, and the slower flight would overwrite a newer snapshot with a
// fresher timestamp.
const refreshDeedsBoardShared = singleFlight(refreshDeedsBoard);

// Freshness gate shared by the two board reads below: serve the cache inside
// the TTL, else refresh, else stale-serve (or null before the first success).
async function ensureDeedsBoard(): Promise<DeedsBoardCache | null> {
  // Mark demand on every board read (fresh-cache hit included): this is the one
  // chokepoint both dispatch arms funnel through, and it is never on the warm
  // path, so the stamp measures real viewer demand and nothing else. It keeps the
  // warm loop refreshing the board for DEEDS_BOARD_DEMAND_TTL_MS after the last
  // request; a cold or stale request still refreshes inline just below.
  deedsBoardLastRequestAt = Date.now();
  if (deedsBoardCache && Date.now() - deedsBoardCache.at < LEADERBOARD_TTL_MS) {
    return deedsBoardCache;
  }
  try {
    return await refreshDeedsBoardShared();
  } catch (err) {
    console.error('deeds board refresh failed:', err);
    return deedsBoardCache;
  }
}

async function getDeedsLeaderboard(): Promise<DeedsLeaderboardEntry[]> {
  return (await ensureDeedsBoard())?.entries ?? [];
}

async function deedsSelfRank(accountId: number): Promise<DeedsLeaderboardSelf | null> {
  const cache = await ensureDeedsBoard();
  return cache ? deedsBoardSelf(cache.ranked, accountId) : null;
}

// Moderation delisting in THIS process is immediate, never TTL-bound: null
// EVERY cached board scope after a successful moderateAccount of any action
// kind, so a ban delists and an unban relists on the next read here. In the
// process-per-realm fleet, PEER realm processes keep their own caches and
// converge within one LEADERBOARD_TTL_MS (the boards' pre-existing staleness
// ceiling); the SQL exclusion makes their next refresh correct. Arena is
// served uncached by design, and the daily-rewards board reads run per
// request (the SQL exclusion in daily_rewards_db.ts is the whole mechanism),
// so both are already exact fleet-wide with no cache to bust here. Bumping
// boardEpoch as well as nulling the caches closes the lost-bust race: a refresh
// already in flight when this fires will decline to install its pre-ban snapshot
// (see boardEpoch), so a ban cannot be masked for up to a TTL cycle.
function bustBoardCaches(): void {
  boardEpoch++;
  leaderboardCache.realm = null;
  leaderboardCache.global = null;
  guildLeaderboardCache.realm = null;
  guildLeaderboardCache.global = null;
  deedsBoardCache = null;
}
setOnAccountModerated(bustBoardCaches);

// Deed rarity cache. Same compute-once/serve-from-memory shape as the boards
// above, one entry (the aggregate is global/cross-realm by design). 5 minutes:
// rarity moves slowly and the refresh scans character_deeds, so the 30 s board
// TTL is tighter than this read needs. Stale-on-error like the boards; with
// nothing cached yet a failed refresh serves the empty aggregate (the endpoint
// stays 200 and clients simply render no rarity lines).
const DEEDS_RARITY_TTL_MS = 5 * 60_000;
let deedsRarityCache: {
  at: number;
  payload: import('../src/world_api').DeedsRarity;
} | null = null;

async function getDeedsRarity(): Promise<import('../src/world_api').DeedsRarity> {
  if (deedsRarityCache && Date.now() - deedsRarityCache.at < DEEDS_RARITY_TTL_MS) {
    return deedsRarityCache.payload;
  }
  try {
    // publicRarityPayload strips hidden deeds at refresh time: this cache
    // feeds an anonymous endpoint, and a hidden deed's existence must not be
    // enumerable the moment somebody earns it.
    const payload = publicRarityPayload(await deedRarityCounts());
    deedsRarityCache = { at: Date.now(), payload };
    return payload;
  } catch (err) {
    console.error('deeds rarity refresh failed:', err);
    return deedsRarityCache?.payload ?? { totalEligible: 0, earned: {} };
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
// The repo slug + optional token live on the boot Config (activeConfig().githubRepo /
// .githubToken); read at request time so this module reads no env at import.
const RELEASES_TTL_MS = 15 * 60_000; // 15 min, releases change rarely
const RELEASES_SIZE = 20; // releases fetched + cached per refresh (count)
const RELEASE_BODY_MAX = 8_000; // bytes; guard against a pathologically long body

// ReleaseEntry is defined in server/leaderboard.ts (the module that owns the
// public /api/releases route) and imported above; the fetch + cache stay here.

let releasesCache: { at: number; entries: ReleaseEntry[] } | null = null;
setUsageCacheSize('github.releases', 0, RELEASES_SIZE);

async function refreshReleases(): Promise<ReleaseEntry[]> {
  recordUsageMetric('github.releases.fetch');
  try {
    const { githubRepo, githubToken } = activeConfig();
    const res = await fetch(
      `https://api.github.com/repos/${githubRepo}/releases?per_page=${RELEASES_SIZE}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'world-of-claudecraft-server',
          ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
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
    skinCatalog: 'class' | 'mech';
    mainhandItemId: string | null;
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
      online: [...liveGame().clients.values()].some((s) => s.characterId === c.id),
      forceRename: c.force_rename,
      lastPlayed: c.last_played ? new Date(c.last_played).toISOString() : null,
      playtimeSeconds: Number(c.playtime_seconds ?? 0),
      // Real appearance for the char-select 3D preview (the client renders the
      // Combat Mech cosmetic body and the equipped mainhand, matching the world).
      skinCatalog: c.state?.skinCatalog === 'mech' ? 'mech' : 'class',
      mainhandItemId: c.state?.equipment?.mainhand ?? null,
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

// Raw bearer token string (or null), needed when an account action must keep
// the caller's own session alive while revoking the rest (password change).
function bearerToken(req: http.IncomingMessage): string | null {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization ?? '');
  return m ? m[1] : null;
}

// Mutating + owner-scoped routes funnel through here. HARDENED: a read-only
// token (scope!=='full') is rejected with 403, so every existing mutating route
// (which already calls this) automatically refuses companion/OAuth read tokens,
// the single choke point that keeps read tokens harmless.
async function bearerActiveAccount(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<number | null> {
  const info = await bearerScopeAccount(req);
  if (info === null) {
    json(res, 401, { error: 'not authenticated', code: 'auth.required' });
    return null;
  }
  if (!scopeAllowsMutation(info.scope)) {
    json(res, 403, { error: 'this token is read-only', code: 'auth.forbidden' });
    return null;
  }
  const status = await moderationStatusForAccount(info.accountId);
  if (status.locked) {
    json(res, 403, moderationErrorBody(status));
    return null;
  }
  return info.accountId;
}

// Read routes (the owner character sheet) accept both 'read' and 'full' tokens.
// Moderation still applies, a banned account can't read through a read token.
async function bearerReadAccount(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<number | null> {
  const info = await bearerScopeAccount(req);
  if (info === null) {
    json(res, 401, { error: 'not authenticated', code: 'auth.required' });
    return null;
  }
  const status = await moderationStatusForAccount(info.accountId);
  if (status.locked) {
    json(res, 403, moderationErrorBody(status));
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
// the real db/auth implementations here, stubs in tests. The create leg's
// bearer resolution moved OUT of the handler and into the arm below
// (bearerActiveAccount, the desktop-login create scope fix), so the deps carry only the
// post-auth reads.
const desktopLoginRouteDeps: DesktopLoginRouteDeps = {
  readBody,
  json,
  requestMetadata,
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
  '.mp3': 'audio/mpeg',
};
// The admin dashboard is reached via the admin.* subdomain (Caddy proxies it
// to this same port) or /admin for local dev. The hostname only picks which
// HTML shell is served, the admin API itself is gated by admin tokens.
function isAdminRequest(req: http.IncomingMessage): boolean {
  const host = String(req.headers.host ?? '').toLowerCase();
  const urlPath = (req.url ?? '/').split('?')[0];
  return host.startsWith('admin.') || urlPath === '/admin' || urlPath === '/admin/';
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  let requestUrl: URL;
  try {
    requestUrl = new URL(req.url ?? '/', 'http://static.local');
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('invalid request target');
    return;
  }
  let urlPath = requestUrl.pathname;
  // The curated Guide is the site wiki: a client-routed SPA served at /wiki with its
  // own shell, so deep paths (/wiki/classes/...) fall back to guide.html rather than the
  // game's index.html. (It previously 302'd to a standalone MediaWiki; that is retired.)
  const isGuide = urlPath === '/wiki' || urlPath.startsWith('/wiki/');
  const shell = isGuide ? 'guide.html' : isAdminRequest(req) ? 'admin.html' : 'index.html';
  // Pretty-URL aliases for standalone static pages.
  urlPath = STATIC_PAGE_ALIASES.get(urlPath) ?? urlPath;
  if (urlPath === '/' || urlPath === '/admin' || urlPath === '/admin/') urlPath = `/${shell}`;
  // normalize once and reuse for BOTH file resolution and cache policy,
  // otherwise /assets/../x would serve a mutable file with immutable caching
  urlPath = path.posix.normalize(urlPath).replace(/^([.][.][/\\])+/, '');
  const overlayFile = resolveSfxOverlayFile(SFX_PACK_DIR, urlPath);
  const file = overlayFile ?? path.join(STATIC_DIR, urlPath);
  const cachePath = `${urlPath}${requestUrl.search}`;
  const requestedVersion = requestedSfxVersion(cachePath);
  const requestedBlobHash = requestedSfxBlobHash(cachePath);
  const needsVerifiedSfx = requestedVersion !== null || requestedBlobHash !== null;
  let verifiedSfx: StaticSfxSnapshot | null = null;
  let stats: fs.Stats | null = null;
  if (overlayFile !== null || file.startsWith(STATIC_DIR)) {
    try {
      if (needsVerifiedSfx) {
        verifiedSfx = readStaticSfxSnapshot(file);
        stats = verifiedSfx.stats;
      } else {
        // statSync is already the existence check. Keeping it inside this catch
        // closes the former existsSync-to-statSync disappearance race.
        stats = fs.statSync(file);
      }
    } catch {
      if (needsVerifiedSfx) {
        res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        res.end('SFX asset changed during integrity verification');
        return;
      }
      stats = null;
    }
  }
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
  const actualSfxHash = verifiedSfx?.hash;
  if (!sfxBlobIntegrityMatches(cachePath, actualSfxHash)) {
    res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    res.end('content-addressed SFX blob failed integrity verification');
    return;
  }
  const validators = {
    'Cache-Control': cacheControlFor(cachePath, actualSfxHash),
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
    'Content-Length': verifiedSfx?.bytes.length ?? stats.size,
  });
  if (req.method === 'HEAD') {
    // Versioned SFX was already snapshotted for integrity, but HEAD sends no body.
    res.end();
    return;
  }
  if (verifiedSfx !== null) {
    res.end(verifiedSfx.bytes);
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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
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
// Resolved once on the boot Config (activeConfig().requireWebLogin), which mirrors
// web_login_guard.ts webLoginEnforced, replacing the former module-scope const.

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
      activeConfig().requireWebLogin &&
      req.method === 'POST' &&
      (url === '/api/register' ||
        url === '/api/login' ||
        url === '/api/account/password/forgot' ||
        url === '/api/account/password/reset') &&
      !isWebClientRequest(req)
    ) {
      return json(res, 403, {
        error: 'logins are only allowed from the game client',
        code: 'auth.web_login_only',
      });
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
      !rateLimited(req).allowed
    ) {
      return json(res, 429, {
        error: 'too many attempts, wait a minute and try again',
        code: 'auth.too_many_attempts',
      });
    }
    // Reuse the rate-limit message so a blocked client gets no signal that the
    // block exists. Login is gated separately below, after the account is known,
    // so admins can bypass; registration has no account to check.
    if (
      req.method === 'POST' &&
      url === '/api/register' &&
      liveGame().isIpBlocked(requestIp(req))
    ) {
      return json(res, 429, {
        error: 'too many attempts, wait a minute and try again',
        code: 'auth.too_many_attempts',
      });
    }
    if (req.method === 'POST' && url === '/api/register') {
      const body = await readBody(req);
      const meta = requestMetadata(req);
      if (!(await passesTurnstile(req, body, activeConfig().turnstileSecret)))
        return json(res, 403, {
          error: 'verification failed, please try again',
          code: 'auth.verification_failed',
        });
      if (!validUsernameShape(body.username))
        return json(res, 400, {
          error: 'username must be 3-24 chars (letters, digits, _)',
          code: 'account.username_invalid',
        });
      if (offensiveName(body.username))
        return json(res, 400, {
          error: 'username is not allowed',
          code: 'account.username_not_allowed',
        });
      if (!validPassword(body.password))
        return json(res, 400, {
          error: 'password must be at least 6 chars',
          code: 'account.password_too_short',
        });
      // Email is mandatory at signup: it is the recovery address that later proves
      // account ownership on a password reset, so we capture it up front.
      const signupEmail = normalizeEmail(body.email);
      if (!signupEmail)
        return json(res, 400, {
          error: 'enter a valid email address',
          code: 'email.invalid',
        });
      const existing = await findAccount(body.username);
      if (existing)
        return json(res, 409, { error: 'username already taken', code: 'account.username_taken' });
      let account: Awaited<ReturnType<typeof createAccount>>;
      try {
        account = await createAccount(body.username, await hashPassword(body.password), meta);
      } catch (err: any) {
        // a concurrent registration can win the insert after our findAccount
        // check; the username UNIQUE index is the real guard. Surface it as a
        // 409 like the duplicate path above, not a generic 500.
        if (isUniqueViolation(err))
          return json(res, 409, {
            error: 'username already taken',
            code: 'account.username_taken',
          });
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
      void trackAccountCreated(
        account.id,
        {
          email: signupEmail,
          ...metaRequestUserData(req, meta),
        },
        metaEventSourceUrl(req),
      );
      void createSuspiciousRegistrationReport({
        accountId: account.id,
        username: account.username,
        ...meta,
      }).catch((err) => logger.error({ err }, 'suspicious registration report failed'));
      // Capture the referral when this account signed up via a card link
      // (?ref=<slug>). Best-effort: never block or fail registration on it.
      void captureReferral(account.id, body.ref).catch((err) =>
        logger.error({ err }, 'referral capture failed'),
      );
      // emailMissing is always false here (email is required above); sent so the
      // client can use one uniform post-auth check across register and login.
      return json(res, 200, {
        token,
        username: account.username,
        accountId: account.id,
        emailMissing: false,
      });
    }
    if (req.method === 'POST' && url === '/api/login') {
      const body = await readBody(req);
      if (!(await passesTurnstile(req, body, activeConfig().turnstileSecret)))
        return json(res, 403, {
          error: 'verification failed, please try again',
          code: 'auth.verification_failed',
        });
      const username = typeof body.username === 'string' ? body.username : '';
      // Per-account brute-force throttle (#93). The message is identical to a
      // bad-password response so it never reveals whether the account exists.
      if (username && !authThrottled(username).allowed) {
        return json(res, 429, {
          error: 'too many failed attempts, wait a few minutes and try again',
          code: 'auth.too_many_failed_attempts',
        });
      }
      const account = username ? await findAccount(username) : null;
      if (!account || !(await verifyPassword(String(body.password ?? ''), account.password_hash))) {
        if (username) recordAuthFailure(username);
        return json(res, 401, {
          error: 'invalid username or password',
          code: 'auth.invalid_credentials',
        });
      }
      const status = await moderationStatusForAccount(account.id);
      if (status.locked) return json(res, 403, moderationErrorBody(status));
      // Checked only now that the account is known, so admins (verified after the
      // password) are never locked out. This does mean a blocked IP gets 429 on a
      // correct password vs 401 on a wrong one, a small credential-validity tell
      // we accept, since moving the check before the password would lock admins out.
      if (liveGame().isIpBlocked(requestIp(req)) && !(await isAdminAccount(account.id))) {
        return json(res, 429, {
          error: 'too many attempts, wait a minute and try again',
          code: 'auth.too_many_attempts',
        });
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
          return json(res, 401, {
            error: 'invalid authentication code',
            code: 'two_factor.code_invalid',
            twoFactorRequired: true,
          });
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
      // Desktop-login create scope fix: the handoff code mints a FULL session
      // via exchange, so create requires a full active session too
      // (bearerActiveAccount: read and companion tokens answer 403 'this token
      // is read-only'), where the pre-fix handler resolved the scope-blind
      // accountForToken. Mirrored on
      // the RouteDef twin (server/desktop_login_routes.ts); the
      // desktopLoginCreateFullScope known deviation records the change.
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      return issueDesktopLoginCode(req, res, desktopLoginRouteDeps, accountId);
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
          return json(res, 400, {
            error: 'invalid character name (2-16 letters)',
            code: 'character.name_invalid',
          });
        if (offensiveName(name))
          return json(res, 400, {
            error: 'character name is not allowed',
            code: 'character.name_not_allowed',
          });
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
        if (!validClasses.includes(body.class))
          return json(res, 400, { error: 'invalid class', code: 'character.invalid_class' });
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
          if (!c)
            return json(res, 400, {
              error: 'character limit reached',
              code: 'character.limit_reached',
            });
          return created(c);
        } catch (err: any) {
          if (!isUniqueViolation(err)) throw err;
          // The name collided. If it is held only by a deactivated ("invalid")
          // account, free it (the orphaned character is archived) and retry once;
          // otherwise it is genuinely taken. This is the self-service path that
          // replaces the hidden admin-only reactivate/force-rename recovery.
          if (!(await reclaimDeactivatedName(name)))
            return json(res, 409, { error: 'that name is taken', code: 'character.name_taken' });
          try {
            const c = await create();
            if (!c)
              return json(res, 400, {
                error: 'character limit reached',
                code: 'character.limit_reached',
              });
            return created(c);
          } catch (err2: any) {
            if (isUniqueViolation(err2))
              return json(res, 409, { error: 'that name is taken', code: 'character.name_taken' });
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
      if (!publicReadRateLimited(req).allowed) return json(res, 429, { error: 'rate limited' });
      const rawName = decodeURIComponent(publicSheetMatch[1]);
      const target = await findCharacterReportTargetByName(rawName);
      if (!target)
        return json(res, 404, { error: 'character not found', code: 'character.not_found' });
      const row = await getCharacterById(target.characterId);
      if (!row)
        return json(res, 404, { error: 'character not found', code: 'character.not_found' });
      const [guild, rank, deedsRecent] = await Promise.all([
        guildNameForCharacter(row.id),
        lifetimeXpRankForCharacter(row.id),
        recentDeedsForCharacter(row.id, SHEET_RECENT_DEEDS),
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
          deedsRecent,
        }),
      );
    }
    const ownerSheetMatch = /^\/api\/characters\/(\d+)\/sheet$/.exec(url);
    if (req.method === 'GET' && ownerSheetMatch) {
      const accountId = await bearerReadAccount(req, res);
      if (accountId === null) return;
      const row = await getCharacter(accountId, Number(ownerSheetMatch[1]));
      if (!row)
        return json(res, 404, { error: 'character not found', code: 'character.not_found' });
      const [guild, rank, deedsRecent] = await Promise.all([
        guildNameForCharacter(row.id),
        lifetimeXpRankForCharacter(row.id),
        recentDeedsForCharacter(row.id, SHEET_RECENT_DEEDS),
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
          deedsRecent,
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
      if (!standing)
        return json(res, 404, { error: 'character not found', code: 'character.not_found' });
      return json(res, 200, standing);
    }
    if (req.method === 'POST' && renameMatch) {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      const body = await readBody(req);
      const name = normalizeCharName(body.name);
      if (name === null)
        return json(res, 400, {
          error: 'invalid character name (2-16 letters)',
          code: 'character.name_invalid',
        });
      if (offensiveName(name))
        return json(res, 400, {
          error: 'character name is not allowed',
          code: 'character.name_not_allowed',
        });
      const characterId = Number(renameMatch[1]);
      const character = await getCharacter(accountId, characterId);
      if (!character)
        return json(res, 404, { error: 'character not found', code: 'character.not_found' });
      // A rename is a moderator-sanctioned action: the character-select UI only
      // shows the rename control when a moderator has set force_rename. The UI is
      // not a security boundary, so gate here too: a normal owner hitting this
      // route directly must not be able to rename an un-flagged character. (The
      // UPDATE in renameCharacter re-checks the flag race-free; this returns a
      // clear 403 instead of a misleading 404.)
      if (!character.force_rename) {
        return json(res, 403, {
          error: 'character rename is not permitted',
          code: 'character.rename_not_permitted',
        });
      }
      // A rename mutates the DB name and clears force_rename, but a live
      // ClientSession keeps its own copy of the name (used by reports, chat and
      // /api/status). Renaming an online character desyncs that copy and, worse
      // lets a force-renamed player already in the world clear the moderation
      // flag without ever leaving. Mirror the DELETE guard and require offline.
      if ([...liveGame().clients.values()].some((s) => s.characterId === characterId)) {
        return json(res, 400, { error: 'character is currently online', code: 'character.online' });
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
            return json(res, 403, {
              error: 'character rename is not permitted',
              code: 'character.rename_not_permitted',
            });
          }
          return json(res, 404, { error: 'character not found', code: 'character.not_found' });
        }
        if (liveGame().rekeyMarketSeller(characterId, character.name, c.name)) {
          await liveGame().saveMarket();
        }
        if (liveGame().rekeyMailOwner(characterId, character.name, c.name)) {
          await liveGame().saveMail();
        }
        return json(res, 200, {
          id: c.id,
          name: c.name,
          class: c.class,
          level: c.level,
          forceRename: c.force_rename,
        });
      } catch (err: any) {
        if (isUniqueViolation(err))
          return json(res, 409, { error: 'that name is taken', code: 'character.name_taken' });
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
      if (!character) return json(res, 404, { error: 'not found', code: 'character.not_found' });
      const result = await liveGame().takeOverCharacter(accountId, characterId);
      return json(res, 200, { ok: true, takenOver: result === 'taken-over' });
    }
    if (req.method === 'DELETE' && delMatch) {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      const characterId = Number(delMatch[1]);
      const body = await readBody(req);
      const character = await getCharacter(accountId, characterId);
      if (!character) return json(res, 404, { error: 'not found', code: 'character.not_found' });
      if ([...liveGame().clients.values()].some((s) => s.characterId === characterId)) {
        return json(res, 400, { error: 'character is currently online', code: 'character.online' });
      }
      if (normalizeDeleteConfirmation(body.name) !== normalizeDeleteConfirmation(character.name)) {
        return json(res, 400, {
          error: 'type the character name to confirm deletion',
          code: 'character.delete_confirm',
        });
      }
      const ok = await deleteCharacter(accountId, characterId);
      return json(
        res,
        ok ? 200 : 404,
        ok ? { ok: true } : { error: 'not found', code: 'character.not_found' },
      );
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
        reportTargetForPid: (pid) => liveGame().reportTargetForPid(pid),
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
      // A downscaled screenshot data URL dominates the payload; allow the roomier
      // BUG_REPORT_MAX_BODY_BYTES (1 MiB, well above the 64 KB JSON default, owned by
      // server/reports.ts) and surface an oversize body as 413.
      let body: any;
      try {
        body = await readBody(req, BUG_REPORT_MAX_BODY_BYTES);
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
        players_online: liveGame().clients.size,
        realm: REALM,
      });
    }
    if (req.method === 'GET' && url === '/api/status') {
      // steam.enabled is the capability advert clients read before rendering any
      // Steam link UI. HARDCODED false on the legacy ladder: the Steam surface
      // exists only as RouteDefs (server/steam/routes.ts), which the legacy arm
      // never serves, so every /api/steam/* 404s here. Advertising the capability
      // on an arm that then 404s it would strand a client into a dead link flow.
      // Under the default 'new' dispatch the migrated statusHandler
      // (server/leaderboard.ts) reads the real steamEnabled(), where the routes
      // are live. This is a deliberate divergence from the new arm under
      // STEAM_ENABLED=1 (pinned in tests/server/http/parity.test.ts).
      return json(res, 200, {
        ok: true,
        realm: REALM,
        players_online: liveGame().clients.size,
        // The configured realm player cap so the client realm list can display
        // honestly; 0 means the cap is disabled. Dual-arm edit: the migrated
        // statusHandler (server/leaderboard.ts) carries the same players_cap field.
        players_cap: canonicalPlayersCap(),
        names: [...liveGame().clients.values()].map((s) => s.name),
        steam: { enabled: false },
      });
    }
    // Dev-only world-loop perf profile (per-phase tick p95/max), for the load
    // harness. Gated by ALLOW_DEV_COMMANDS so it is never exposed in production.
    if (req.method === 'GET' && url === '/api/perf' && process.env.ALLOW_DEV_COMMANDS === '1') {
      return json(res, 200, liveGame().perfProfile());
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
      // ?board=deeds is the Renown board: ACCOUNTS ranked by lifetime deed
      // Renown, character-faced. GLOBAL-ONLY by design (accounts span realms),
      // so ?scope is accepted and ignored and the body always carries scope
      // 'global' (buildDeedsBoard fixes it). The bearer is resolved LENIENTLY
      // here, the legacy arms' shape (cf. the realms arm): a missing, invalid,
      // or locked token serves the board anonymously with no self row, while
      // the router-owned arm validates a present token (the labeled
      // authz-gap-close divergence class); anonymous and valid-token responses
      // are byte-identical on both dispatch paths via the shared builder.
      if (params.get('board') === 'deeds') {
        const deedsEntries = await getDeedsLeaderboard();
        const deedsPageSize = Number(params.get('pageSize')) || LEADERBOARD_PAGE_SIZE;
        const deedsPage = Number(params.get('page')) || 0;
        const bearer = await bearerScopeAccount(req).catch(() => null);
        const self = bearer ? await deedsSelfRank(bearer.accountId) : null;
        return json(res, 200, buildDeedsBoard(REALM, deedsEntries, deedsPage, deedsPageSize, self));
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
      return json(res, 200, { repo: activeConfig().githubRepo, releases: entries.slice(0, limit) });
    }
    // Account self-service portal, all bearer-auth, account-scoped. Each route
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
      if (!callerToken)
        return json(res, 401, { error: 'not authenticated', code: 'auth.required' });
      return handleAccountChangePassword(req, res, accountId, callerToken);
    }
    // Password reset is for users who are locked out, so both routes are
    // unauthenticated (rate-limited + web-login guarded above, and each handler is
    // written to never reveal whether an account exists).
    if (req.method === 'POST' && url === '/api/account/password/forgot') {
      return handleAccountPasswordForgot(req, res);
    }
    if (req.method === 'POST' && url === '/api/account/password/reset') {
      return handleAccountPasswordReset(req, res);
    }
    if (req.method === 'POST' && url === '/api/account/logout') {
      const callerToken = bearerToken(req);
      if (!callerToken || (await accountForToken(callerToken)) === null)
        return json(res, 401, { error: 'not authenticated', code: 'auth.required' });
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
          [...liveGame().clients.values()].some(
            (s) => s.characterId != null && characterIds.includes(s.characterId),
          ),
        disconnectAccount: (id, reason) => liveGame().disconnectAccount(id, reason),
      });
    }
    // Companion read-only tokens: a 90-day scope='read' token a user can paste
    // into a companion app instead of running OAuth. Managed from a full web
    // session only (bearerActiveAccount rejects read tokens, so a read token can
    // never mint or list more, no privilege escalation).
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
    // Non-custodial Solana wallet linking, all account-scoped.
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
    if (req.method === 'POST' && url === '/api/auth/apple') {
      return handleAppleLogin(req, res, await readBody(req));
    }
    if (req.method === 'POST' && url === '/api/auth/apple/login/new') {
      return handleAppleLoginNew(req, res, await readBody(req), (ip) => liveGame().isIpBlocked(ip));
    }
    if (req.method === 'POST' && url === '/api/auth/apple/login/link') {
      return handleAppleLoginLink(req, res, await readBody(req));
    }
    // Discord integration: OAuth login/link, link status, unlink. `start` returns
    // the authorize URL (the browser then navigates to Discord); `callback` is the
    // discord.com -> us redirect (no auth/Origin, so it is NOT gated by the
    // web-login guard, which is login/register-only). Mutations go through
    // bearerActiveAccount; the dedicated Discord rate-limit bucket guards them.
    if (req.method === 'POST' && url === '/api/auth/discord/start') {
      const discordStartUrl = new URL(req.url ?? '/', 'http://localhost');
      const mode = discordStartUrl.searchParams.get('mode') === 'link' ? 'link' : 'login';
      const native = discordStartUrl.searchParams.get('native') === '1';
      const nativeChallenge = discordStartUrl.searchParams.get('challenge') ?? undefined;
      let accountId: number | null = null;
      if (mode === 'link') {
        accountId = await bearerActiveAccount(req, res);
        if (accountId === null) return;
      }
      if (!discordRateLimited(req, accountId ?? 0).allowed)
        return json(res, 429, { error: 'rate limited' });
      const body = native ? await readBody(req) : {};
      return handleDiscordStart(req, res, {
        mode,
        accountId,
        native,
        nativeChallenge,
        nativeAttestation: body.nativeAttestation,
      });
    }
    if (req.method === 'GET' && url === '/api/auth/discord/callback') {
      return handleDiscordCallback(req, res, (ip) => liveGame().isIpBlocked(ip));
    }
    // First-time-login chooser endpoints. Unauthenticated like /callback: the
    // authorization is the single-use pending-login token (minted only after a
    // verified Discord OAuth), and the handlers carry their own Discord rate-limit
    // bucket + (for the link path) the same password/2FA/moderation checks as login.
    if (req.method === 'POST' && url === '/api/auth/discord/login/new') {
      return handleDiscordLoginNew(req, res, (ip) => liveGame().isIpBlocked(ip));
    }
    if (req.method === 'POST' && url === '/api/auth/discord/login/link') {
      return handleDiscordLoginLink(req, res, (ip) => liveGame().isIpBlocked(ip));
    }
    if (req.method === 'POST' && url === '/api/auth/discord/native/exchange') {
      return handleNativeDiscordExchange(req, res);
    }
    if (req.method === 'GET' && url === '/api/discord') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      if (!discordRateLimited(req, accountId).allowed)
        return json(res, 429, { error: 'rate limited' });
      return handleDiscordStatus(req, res, accountId);
    }
    if (req.method === 'DELETE' && url === '/api/discord') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      if (!discordRateLimited(req, accountId).allowed)
        return json(res, 429, { error: 'rate limited' });
      return handleDiscordUnlink(req, res, accountId);
    }
    // GitHub OAuth link (developer badge). Link-only: the start leg resolves the
    // caller's account first, so the verified GitHub identity attaches to a known
    // account. The callback carries no Origin (a github.com redirect) and is
    // exempt from the web-login Origin guard, exactly like the Discord callback.
    if (req.method === 'POST' && url === '/api/auth/github/start') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      if (!githubRateLimited(req, accountId).allowed) {
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
      if (!githubRateLimited(req, accountId).allowed)
        return json(res, 429, { error: 'rate limited' });
      return handleGitHubStatus(req, res, accountId);
    }
    if (req.method === 'DELETE' && url === '/api/github') {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      if (!githubRateLimited(req, accountId).allowed)
        return json(res, 429, { error: 'rate limited' });
      return handleGitHubUnlink(req, res, accountId);
    }
    // $WOC balance proxy, keeps the Solana RPC endpoint (and any key in it)
    // server-side so it never ships in the client bundle. Public (on-chain
    // balances are public) but narrow + IP rate-limited + per-wallet cached.
    if (req.method === 'GET' && url === '/api/woc/balance') {
      if (!wocBalanceRateLimited(req).allowed) {
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
    if (req.method === 'POST' && url === '/api/claudium/stripe/webhook') {
      return handleClaudiumStripeWebhook(req, res);
    }
    if (url.startsWith('/api/claudium')) {
      const preAuthLimit = claudiumPreAuthMutationRateLimited(req);
      if (preAuthLimit && !preAuthLimit.allowed) {
        return json(res, 429, { error: 'rate_limited' });
      }
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      return handleClaudiumApi(req, res, accountId);
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
      if (!cardUploadRateLimited(req, accountId).allowed) {
        recordUsageMetric('card.publish.rate_limited');
        return json(res, 429, { error: 'rate limited' });
      }
      return handleCardUpload(req, res, accountId, (characterId) =>
        liveGame().liveLevelForCharacter(characterId),
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
    // -----------------------------------------------------------------------
    // Map editor: saved custom maps + uploaded GLB assets. The lane BODIES live
    // in server/maps_routes.ts / server/user_assets_routes.ts as shared cores
    // BOTH dispatch arms call (the migrated RouteDefs mount the equivalent
    // guards), so the two paths cannot drift. These legacy arms keep only the
    // guard order: Content-Length precheck BEFORE auth on the save/upload lanes
    // (413 + Connection: close, the /api/card treatment), then the bearer
    // resolver, then the fused ip+account limiter.
    // -----------------------------------------------------------------------
    if (url === '/api/maps' && (req.method === 'GET' || req.method === 'POST')) {
      if (req.method === 'GET') {
        const accountId = await bearerReadAccount(req, res);
        if (accountId === null) return;
        return mapsListMineCore(res, accountId);
      }
      if (contentLengthExceeds(req, MAX_MAP_SAVE_BYTES)) {
        res.shouldKeepAlive = false;
        res.setHeader('Connection', 'close');
        return json(res, 413, { error: 'map_too_large' });
      }
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      if (!mapMutationRateLimited(req, accountId).allowed)
        return json(res, 429, { error: 'rate_limited' });
      return mapsCreateCore(req, res, accountId);
    }
    if (req.method === 'GET' && url === '/api/maps/public') {
      if (!publicReadRateLimited(req).allowed) return json(res, 429, { error: 'rate_limited' });
      return mapsPublicListCore(req, res);
    }
    const mapIdMatch = /^\/api\/maps\/(\d+)$/.exec(url);
    if (req.method === 'GET' && mapIdMatch) {
      // Owner or public. Auth is optional; anonymous readers share the public
      // read throttle like the public character sheet.
      const accountId = await bearerAccount(req);
      if (accountId === null && !publicReadRateLimited(req).allowed) {
        return json(res, 429, { error: 'rate_limited' });
      }
      return mapGetCore(res, accountId, Number(mapIdMatch[1]));
    }
    if (req.method === 'PUT' && mapIdMatch) {
      if (contentLengthExceeds(req, MAX_MAP_SAVE_BYTES)) {
        res.shouldKeepAlive = false;
        res.setHeader('Connection', 'close');
        return json(res, 413, { error: 'map_too_large' });
      }
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      if (!mapMutationRateLimited(req, accountId).allowed)
        return json(res, 429, { error: 'rate_limited' });
      return mapSaveCore(req, res, accountId, Number(mapIdMatch[1]));
    }
    if (req.method === 'DELETE' && mapIdMatch) {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      if (!mapMutationRateLimited(req, accountId).allowed)
        return json(res, 429, { error: 'rate_limited' });
      return mapDeleteCore(res, accountId, Number(mapIdMatch[1]));
    }
    const mapForkMatch = /^\/api\/maps\/(\d+)\/fork$/.exec(url);
    if (req.method === 'POST' && mapForkMatch) {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      if (!mapMutationRateLimited(req, accountId).allowed)
        return json(res, 429, { error: 'rate_limited' });
      return mapForkCore(req, res, accountId, Number(mapForkMatch[1]));
    }
    const mapPublishMatch = /^\/api\/maps\/(\d+)\/(publish|unpublish)$/.exec(url);
    if (req.method === 'POST' && mapPublishMatch) {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      if (!mapMutationRateLimited(req, accountId).allowed)
        return json(res, 429, { error: 'rate_limited' });
      return mapSetPublishedCore(
        res,
        accountId,
        Number(mapPublishMatch[1]),
        mapPublishMatch[2] === 'publish',
      );
    }
    if (req.method === 'POST' && url === '/api/assets') {
      if (contentLengthExceeds(req, MAX_ASSET_BYTES)) {
        res.shouldKeepAlive = false;
        res.setHeader('Connection', 'close');
        return json(res, 413, { error: 'asset_too_large' });
      }
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      if (!assetUploadRateLimited(req, accountId).allowed) {
        return json(res, 429, { error: 'rate_limited' });
      }
      return assetUploadCore(req, res, accountId);
    }
    if (req.method === 'GET' && url === '/api/assets/mine') {
      const accountId = await bearerReadAccount(req, res);
      if (accountId === null) return;
      return assetsListMineCore(res, accountId);
    }
    const assetGlbMatch = /^\/api\/assets\/([a-f0-9]{64})\.glb$/.exec(url);
    if (req.method === 'GET' && assetGlbMatch) {
      if (!publicReadRateLimited(req).allowed) return json(res, 429, { error: 'rate_limited' });
      return assetBytesCore(res, assetGlbMatch[1]);
    }
    const assetIdMatch = /^\/api\/assets\/(\d+)$/.exec(url);
    if (req.method === 'DELETE' && assetIdMatch) {
      const accountId = await bearerActiveAccount(req, res);
      if (accountId === null) return;
      return assetDeleteCore(res, accountId, Number(assetIdMatch[1]));
    }
    json(res, 404, { error: 'unknown endpoint' });
  } catch (err: any) {
    logger.error({ err }, 'api error');
    json(res, 500, { error: 'internal error' });
  }
}

// ---------------------------------------------------------------------------
// HTTP route dispatch
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The /api dispatch seam
// ---------------------------------------------------------------------------

// Inject the main.ts runtime the ported public-read handlers (server/leaderboard.ts)
// need but cannot import without a cycle: the live online count + dev perf profile
// off the GameServer, the three cache-fronted readers (unchanged: the same TTL
// caches the legacy arms use), the releases feed's repo + cap, and the two
// request-shaped helpers. Done at module load, before any request, so the static
// `routes` array registry.ts already spread in can serve.
configureLeaderboardRuntime({
  playersOnline: () => liveGame().clients.size,
  playersCap: canonicalPlayersCap,
  perfProfile: () => liveGame().perfProfile(),
  getLeaderboard,
  getGuildLeaderboard,
  getDevLeaderboard: () => topContributors(),
  getDeedsLeaderboard,
  deedsSelfRank,
  getReleases,
  // A getter, not a value: configureLeaderboardRuntime runs at module load (before
  // startServer primes the config), but leaderboard.ts reads rt.githubRepo only at
  // request time, so deferring the read via a getter keeps activeConfig() off the
  // module-load path while still single-sourcing the repo slug through the Config.
  get githubRepo() {
    return activeConfig().githubRepo;
  },
  releasesMaxLimit: RELEASES_SIZE,
  publicOrigin,
  toSheetRank,
});

// Inject the main.ts runtime the deeds handlers (server/deeds.ts) need but
// cannot import without a cycle: the cache-fronted global rarity read. Done at
// module load, before any request, mirroring configureLeaderboardRuntime above.
configureDeedsRuntime({
  deedsRarity: getDeedsRarity,
});

// Inject the main.ts runtime the ported auth handlers (server/auth_routes.ts) need
// but cannot import without a cycle: the live IP-block gate off the GameServer, the
// one Turnstile / native-attestation decision, and the request-metadata stamp. Done
// at module load, before any request, mirroring configureLeaderboardRuntime above.
configureAuthRuntime({
  isIpBlocked: (ip) => liveGame().isIpBlocked(ip),
  // Bind the secret here so the migrated register/login arm runs the exact same
  // bot gate (incl. the native-attestation and desktop-origin branches) as the
  // legacy handleApi arm above.
  passesTurnstile: (req, body) => passesTurnstile(req, body, activeConfig().turnstileSecret),
  requestMetadata,
});
configureAppleAuthRuntime({
  isIpBlocked: (ip) => liveGame().isIpBlocked(ip),
});

// Inject the main.ts runtime the ported character handlers (server/characters.ts) need
// but cannot import without a cycle: the live online-session check off the GameServer,
// takeOverCharacter, the market rekey/save after a rename, initialCharacterState, and the
// public share origin. Done at module load, before any request, mirroring the two calls
// above. The legacy handleApi character arms stay intact as the flag-off rollback path.
configureCharactersRuntime({
  isCharacterOnline: (characterId) =>
    [...liveGame().clients.values()].some((s) => s.characterId === characterId),
  takeOverCharacter: (accountId, characterId) =>
    liveGame().takeOverCharacter(accountId, characterId),
  rekeyMarketSeller: (characterId, oldName, newName) =>
    liveGame().rekeyMarketSeller(characterId, oldName, newName),
  saveMarket: () => liveGame().saveMarket(),
  rekeyMailOwner: (characterId, oldName, newName) =>
    liveGame().rekeyMailOwner(characterId, oldName, newName),
  saveMail: () => liveGame().saveMail(),
  initialCharacterState,
  publicOrigin,
});

// Inject the main.ts game-session hooks the ported account handlers
// (server/account.ts) need but cannot import without a cycle: the live
// character-online check and the post-deactivation disconnect off the GameServer.
// These are the exact AccountGameHooks the legacy /api/account/deactivate arm
// built inline; the legacy account arms stay intact as the flag-off rollback path.
configureAccountRuntime({
  anyCharacterOnline: (characterIds) =>
    [...liveGame().clients.values()].some(
      (s) => s.characterId != null && characterIds.includes(s.characterId),
    ),
  disconnectAccount: (id, reason) => liveGame().disconnectAccount(id, reason),
});

// Inject the one main.ts-local singleton the ported wallet handlers
// (server/wallet.ts) need but cannot import without a cycle: the live
// authoritative Sim level the /api/card publish reads for an online character.
// This is the exact (characterId) => game.liveLevelForCharacter(characterId) the
// legacy /api/card arm passed to handleCardUpload; the legacy wallet/card/referral
// arms stay intact as the flag-off rollback path.
configureWalletRuntime({
  liveLevelForCharacter: (characterId) => liveGame().liveLevelForCharacter(characterId),
});

// Inject the one main.ts-local singleton the ported report handler
// (server/reports.ts) needs but cannot import without a cycle: the live report
// target for an online player id. This is the exact (pid) =>
// game.reportTargetForPid(pid) the legacy /api/reports arm passed to
// resolveReportTarget; the legacy reports/bug-report/perf-report/site-presence arms
// stay intact as the flag-off rollback path.
configureReportsRuntime({
  reportTargetForPid: (pid) => liveGame().reportTargetForPid(pid),
});

// Inject the two main.ts-local game-session hooks the ported Discord routes
// (server/discord.ts) need but cannot import without a cycle: the moderation
// IP-block check (applied on start + callback to close the PR #1044/#1075 review
// gap) and the live mech-chroma grant for a cosmetic swag claim. The legacy
// handleApi Discord arms stay intact as the flag-off rollback path.
configureDiscordRuntime({
  isIpBlocked: (ip) => liveGame().isIpBlocked(ip),
  grantCosmetic: (accountId, chromaId) => liveGame().grantMechChromaToAccount(accountId, chromaId),
});

// Claudium routes mirror weapon-skin purchases into account cosmetics live (the
// same deferred liveGame() closure pattern as the Discord hooks above).
configureClaudiumRuntime({
  grantWeaponSkins: (accountId, skinIds) =>
    liveGame().grantWeaponSkinsToAccount(accountId, skinIds),
});

// configureAdminRuntime(game) and configureInternalRuntime(game) pass the live
// GameServer BY VALUE (AdminRuntime / InternalRuntime are Picks of GameServer, so
// the live game satisfies them directly). Since construction is deferred off
// module load (liveGame()'s first touch happens in startServer()), those two
// injections happen in startServer() right after that first touch, unlike the
// closure-based configure* calls above, which defer every liveGame() read to
// request time and stay at module scope.

// The RED /metrics exporter: ONE prom-client registry with the default
// process/runtime metrics attached, paired with the structured access-log sink
// into ONE composite tee. Every migrated route records through this composite, so
// each request both increments the Prometheus counter/histogram and emits one
// structured access line; the route :param TEMPLATE bounds the metric cardinality
// and disambiguates the four surfaces, which is why all four dispatchers below
// share this single registry and access-log stream. Built BEFORE the tier-2 store
// wiring so every emission path below shares this one exporter instance.
const httpMetrics = createHttpMetrics({ defaultMetrics: true });
const httpMetricSink = teeMetricSink(createAccessLogSink(logger), httpMetrics.sink);

// Install the four attack-signal counters (source-spec 4.9: rate_limit_hits_total,
// auth_failures_total, bola_denied_total, pg_limiter_writes_total) process-wide.
// Their emission sites (the rate_limit middleware, the ratelimit.ts auth-failure
// choke point, the requireOwned deny path, the tier-2 pg store) read this slot at
// emission time, so all of them land on the single /metrics registry above.
setAttackSignalSink(httpMetrics.attackSignals);

// Wire the pg-backed GLOBAL tier-2 rate-limit store (server/ratelimit_db.ts) into
// the two-tier resolver (server/http/middleware/rate_limit.ts). Unconditional: the
// authoritative server always has Postgres, and RATELIMIT_SCHEMA is created by
// ensureSchema during boot (before listen), so the rate_limits table exists by the
// time any request records a tier-2 hit. This only registers the store reference;
// it opens no connection here (createPgRateLimitStore just wraps the shared pool),
// so a bare import of main stays inert. Tier-2 fails open, so a pg outage degrades
// to tier-1-only limiting rather than failing requests. The store counts each pg
// upsert on pg_limiter_writes_total via the attack-signal slot above; the request
// itself still lands in the access log with its final status.
setRateLimitTier2Store(createPgRateLimitStore({ pool }));

// The in-house dispatcher that fronts the legacy handleApi ladder via a per-path
// delegate. Built once; a path the registry owns runs the onion, every
// un-migrated path delegates to handleApi UNCHANGED.
const apiDispatcher = createApiDispatcher({
  registry: apiRegistry,
  delegate: handleApi,
  metricSink: httpMetricSink,
});

// The bound /api entry for the current dispatch mode, recomputed only when the
// mode changes (boot + tests), never per request. It starts at the config default
// dispatch (DEFAULT_DISPATCH, 'new' today) so importing this module (e.g. in a
// test) never depends on the environment; startServer reads the real API_DISPATCH
// flag via loadConfig once at boot. The production default is 'new';
// API_DISPATCH=legacy is the one-flag rollback to the retained legacy ladder.
let apiEntry: ApiDispatcher = selectApiEntry(DEFAULT_DISPATCH, apiDispatcher, handleApi);

// The /admin/api surface gets its OWN flag-gated dispatcher over the SAME registry
// (admin paths are a disjoint '/admin' first segment, so they never collide with the
// /api family) whose DELEGATE is the legacy handleAdminApi ladder (bound to the live
// game). Under API_DISPATCH 'new' a matched admin RouteDef runs the onion; every
// unmatched admin path (an unknown endpoint, a wrong method, a HEAD) delegates to
// handleAdminApi UNCHANGED, so behavior stays byte-identical until the ladder-deletion
// PR (next release) removes it.
const adminLegacy: ApiDelegate = (req, res) => handleAdminApi(req, res, liveGame());
const adminApiDispatcher = createApiDispatcher({
  registry: apiRegistry,
  delegate: adminLegacy,
  metricSink: httpMetricSink,
});
let adminApiEntry: ApiDispatcher = selectApiEntry(
  DEFAULT_DISPATCH,
  adminApiDispatcher,
  adminLegacy,
);

// The /oauth surface's flag-gated dispatcher, over the SAME registry
// (oauth paths are a disjoint '/oauth' first segment). The delegate is the legacy
// handleOAuth ladder UNCHANGED, so the GET consent/device HTML pages (off the route
// table), HEAD, unknown /oauth paths, and wrong-method requests all keep their
// legacy behavior byte-identically until the ladder-deletion PR (next release).
const oauthLegacy: ApiDelegate = (req, res) => handleOAuth(req, res);
const oauthApiDispatcher = createApiDispatcher({
  registry: apiRegistry,
  delegate: oauthLegacy,
  metricSink: httpMetricSink,
});
let oauthApiEntry: ApiDispatcher = selectApiEntry(
  DEFAULT_DISPATCH,
  oauthApiDispatcher,
  oauthLegacy,
);

// The /internal surface's flag-gated dispatcher. The delegate is the EXACT
// legacy composite from the pre-migration ladder arm: the daily-rewards ops
// family (/internal/daily-rewards/*, never part of handleInternalApi) is tried
// first and short-circuits when handled; everything else falls to the legacy
// handleInternalApi ladder UNCHANGED (unknown endpoints, wrong methods, HEAD, and
// the flag-off rollback path).
const internalLegacy: ApiDelegate = async (req, res) => {
  if (await handleDailyRewardInternalApi(req, res)) return;
  await handleInternalApi(req, res, liveGame());
};
const internalApiDispatcher = createApiDispatcher({
  registry: apiRegistry,
  delegate: internalLegacy,
  metricSink: httpMetricSink,
});
let internalApiEntry: ApiDispatcher = selectApiEntry(
  DEFAULT_DISPATCH,
  internalApiDispatcher,
  internalLegacy,
);

function setApiDispatchMode(mode: DispatchMode): void {
  apiEntry = selectApiEntry(mode, apiDispatcher, handleApi);
  adminApiEntry = selectApiEntry(mode, adminApiDispatcher, adminLegacy);
  oauthApiEntry = selectApiEntry(mode, oauthApiDispatcher, oauthLegacy);
  internalApiEntry = selectApiEntry(mode, internalApiDispatcher, internalLegacy);
}

/**
 * Emit the one-line boot record of the active API dispatch path, plus a stderr
 * ALERT when the un-hardened legacy ladder is serving in production. The production
 * default is now 'new', so a 'legacy' prod boot means someone set
 * API_DISPATCH=legacy to roll back, a deliberate choice worth flagging loudly.
 * Logger-injected and exported so a test asserts the ALERT fires ONLY for legacy +
 * production. Dev-channel English (no t()); the fields are static, never
 * request-derived (logger_call_hygiene safe).
 */
export function logApiDispatchSelection(
  log: Pick<Logger, 'info' | 'warn'>,
  dispatch: DispatchMode,
  nodeEnv: string | undefined,
): void {
  log.info({ dispatch }, 'api dispatch mode selected');
  if (dispatch === 'legacy' && nodeEnv === 'production') {
    log.warn(
      { dispatch },
      'ALERT: serving the un-hardened legacy API ladder in production (API_DISPATCH=legacy)',
    );
  }
}

// Test-only override so the parity harness can drive routeHttpRequest under both
// flag values in-process. The flag is boot-time only in production (API_DISPATCH),
// so this throws there, mirroring ratelimit.setRateLimitClock.
export function setApiDispatchModeForTests(mode: DispatchMode): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('setApiDispatchModeForTests must not be called in production');
  }
  setApiDispatchMode(mode);
}

/**
 * Restore the BOOT DEFAULT /api dispatch after a test (DEFAULT_DISPATCH, now 'new'),
 * matching the module-init state of the four flag-gated entries. A mode-dependent
 * test sets its mode explicitly (setApiDispatchModeForTests) and this returns to the
 * imported default, so nothing leaks a stale mode across tests.
 */
export function resetApiDispatchModeForTests(): void {
  setApiDispatchMode(DEFAULT_DISPATCH);
}

// Single top-level source of truth for CORS + the OPTIONS-204 preflight, applied
// BEFORE the prefix ladder so the legacy handlers AND the new /api dispatcher
// inherit identical CORS from ONE place (a rollback can never drop preflight, and
// the delegated and onion paths can never diverge on CORS). It applies the exact
// CORS the ladder always did: the wide-open '*' for public read paths, the narrow
// realm/native allowlist for other /api + /admin/api. Returns true when the
// request was a fully-handled OPTIONS preflight, so the caller returns.
function applyCorsAndPreflight(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  isApi: boolean,
  publicCorsPath: boolean,
  publicSfxPath: boolean,
): boolean {
  if (publicCorsPath || publicSfxPath) publicCors(res);
  else if (isApi) maybeCors(req, res);
  if (req.method === 'OPTIONS' && (isApi || publicCorsPath || publicSfxPath)) {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

// The createServer prefix-dispatch ladder, lifted to module scope as an
// importable pure function. Every symbol it touches (liveGame(), the imported
// route handlers, the CORS + dispatch helpers) is module-level, so it moves cleanly.
// The exact prefix order, the url-vs-path arm asymmetry, the CORS + OPTIONS-204
// short-circuit position, and every fire-and-forget `void` are preserved 1:1; the
// only change from the pre-dispatcher ladder is the /api, /admin/api, /oauth, and
// /internal arms route through apiEntry / adminApiEntry / oauthApiEntry /
// internalApiEntry (all four
// flag-gated dispatchers) instead of calling handleApi / handleAdminApi / handleOAuth
// / the daily-rewards+handleInternalApi composite directly; each dispatcher delegates
// its own unmatched paths to the same legacy handler, so behavior is byte-identical
// until the ladder-deletion PR (next release).
export function routeHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  // Top-level so both dispatch arms and every prefix (and the OPTIONS-204
  // short-circuit) carry the headers; a flag rollback cannot drop them.
  withSecurityHeaders(req, res);
  const url = req.url ?? '';
  const path = url.split('?')[0];
  const isApi = url.startsWith('/api/') || url.startsWith('/admin/api/');
  // Public read surfaces (/api/public/..., /avatar/...) are CORS-open to any
  // origin so browser-origin companion apps can call them client-side; every
  // other /api route keeps the narrow realm/native allowlist.
  const publicCorsPath = isPublicCorsPath(path);
  const publicSfxPath = isPublicSfxPath(url);
  if (applyCorsAndPreflight(req, res, isApi, publicCorsPath, publicSfxPath)) return;
  // Operational health + metrics endpoints, ahead of the /internal/ arm so they
  // answer even while the rest of the surface drains. GET-only exact matches on
  // the query-stripped path (mirroring the /sitemap-characters.xml arm below);
  // other methods fall through to serveStatic. They inherit the top-level
  // security headers set above and carry their own Cache-Control: no-store.
  if (req.method === 'GET' && path === '/livez') handleLivez(res);
  else if (req.method === 'GET' && path === '/readyz') handleReadyz(res);
  // /metrics is bearer-gated by config.metricsToken: feature-off 404 when unset,
  // 401 on a missing/wrong bearer, exposition only on a match (see handleMetricsGate).
  // /livez and /readyz stay open above.
  else if (req.method === 'GET' && path === '/metrics')
    void handleMetricsGate(req, res, httpMetrics, activeConfig().metricsToken);
  else if (url.startsWith('/internal/')) {
    // The flag-gated internal dispatcher; its delegate is the exact pre-migration
    // composite (daily-rewards ops tried first, then handleInternalApi), so the
    // 'legacy' mode and every unmatched path stay byte-identical.
    void internalApiEntry(req, res);
  } else if (url.startsWith('/admin/api/')) void adminApiEntry(req, res);
  else if (url.startsWith('/api/')) void apiEntry(req, res);
  else if (url.startsWith('/oauth/')) void oauthApiEntry(req, res);
  else if (req.method === 'GET' && url.startsWith('/p/')) void handleCardRoutes(req, res);
  else if (req.method === 'GET' && path.startsWith('/avatar/')) void handleAvatar(req, res);
  else if (req.method === 'GET' && path.startsWith('/c/')) void handleProfilePage(req, res);
  else if (req.method === 'GET' && path === '/sitemap-characters.xml')
    void handleCharacterSitemap(req, res);
  else serveStatic(req, res);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

export async function startServer(): Promise<http.Server> {
  // Load + validate the whole environment ONCE, before anything else (before the
  // 30x2s DB retry loop), so a garbage flag or a missing required value fails fast
  // with a clear message rather than after a minute of connection retries. This
  // primes activeConfig() for the request path (a request-time read returns this
  // same memoized Config).
  const config = activeConfig();
  // Point the contributor-stats reader at the one boot Config, replacing its former
  // duplicate GITHUB_REPO/GITHUB_TOKEN module reads (configure<Domain>Runtime).
  configureGithubContributorsRuntime({
    githubRepo: config.githubRepo,
    githubToken: config.githubToken,
  });

  // wait for the database (it may still be starting in docker)
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch (err) {
      if (attempt >= DB_BOOT_MAX_ATTEMPTS) throw err;
      console.log(`waiting for postgres (attempt ${attempt})...`);
      await new Promise((r) => setTimeout(r, DB_BOOT_RETRY_MS));
    }
  }
  await ensureSchema();
  await seedOAuthClients();
  const game = liveGame();
  // Inject the game-session methods the ported admin routes (server/admin.ts) call
  // for their live reads + side effects (adminStats/liveSessions/disconnectAccount/
  // muteAccountChat/reloadChatFilter/reloadBlockedIps/disconnectByIp/...), and the
  // one game-loop side effect the ported /internal restart-countdown route calls
  // (InternalRuntime is Pick<GameServer, 'startRestartCountdown'>). Both take the
  // live game BY VALUE, so they must run after the first touch above; the legacy
  // handleAdminApi / handleInternalApi ladders stay intact as the flag-off rollback
  // paths (and are the corresponding dispatchers' delegates).
  configureAdminRuntime(game);
  configureInternalRuntime(game);
  // Bot detector: replay this realm's saved config overrides onto the fresh
  // detector. Boot applies what it can; a stale entry (schema drift after a
  // deploy) is skipped and logged, never allowed to drop the whole document.
  const storedAntibotConfig = await loadAntibotConfig();
  const antibotOverrides =
    typeof storedAntibotConfig.data === 'object' && storedAntibotConfig.data !== null
      ? (storedAntibotConfig.data as Record<string, unknown>)
      : {};
  for (const error of game.applyAntibotConfig(antibotOverrides).errors) {
    console.warn(`bot-detector config override skipped: ${error}`);
  }
  const orphans = await closeOrphanSessions();
  if (orphans > 0) console.log(`closed ${orphans} orphaned play session(s) from a previous run`);
  const pruned = await pruneChatLogs(config.chatLogRetentionDays);
  if (pruned > 0)
    console.log(`pruned ${pruned} chat log row(s) older than ${config.chatLogRetentionDays} days`);
  const prunedPerfReports = await pruneClientPerfReports(config.perfReportRetentionDays);
  if (prunedPerfReports > 0)
    console.log(
      `pruned ${prunedPerfReports} client perf report row(s) older than ${config.perfReportRetentionDays} days`,
    );
  await pruneApplePendingLogins(pool);
  await game.loadMarket();
  await game.loadMail();
  await game.loadChatFilter();
  await game.loadBlockedIps();
  void game.recordOnlineSnapshot();
  void currentSitePresenceUsers()
    .then((count) => recordSitePresenceSample(count))
    .catch((err) => console.error('site presence sample failed:', err));
  setInterval(() => {
    void pruneChatLogs(config.chatLogRetentionDays).catch((err) =>
      console.error('chat log prune failed:', err),
    );
    void pruneClientPerfReports(config.perfReportRetentionDays).catch((err) =>
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
    void pruneApplePendingLogins(pool).catch((err) =>
      console.error('apple pending login prune failed:', err),
    );
    void pruneGitHubOAuthStates(pool).catch((err) =>
      console.error('github oauth state prune failed:', err),
    );
  }, DAILY_PRUNE_INTERVAL_MS).unref();
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
    // Demand-gated: the Renown board is a full-table roll-up, so keep it warm
    // only while it is actually being viewed (a request within
    // DEEDS_BOARD_DEMAND_TTL_MS). An idle board pays nothing here; a cold or stale
    // request still refreshes inline on its own read path (ensureDeedsBoard), then
    // this loop keeps it fresh until demand lapses again.
    warmDeedsBoardIfDemanded(
      () => {
        void refreshDeedsBoardShared().catch((err) =>
          console.error('deeds board refresh failed:', err),
        );
      },
      deedsBoardLastRequestAt,
      Date.now(),
      DEEDS_BOARD_DEMAND_TTL_MS,
    );
  };
  warmLeaderboards();
  setInterval(warmLeaderboards, LEADERBOARD_TTL_MS).unref();
  console.log('database ready');

  // Select the /api dispatch path from the single API_DISPATCH flag on the one boot
  // Config loaded above (never a scattered process.env read). The default is 'new';
  // API_DISPATCH=legacy is the one-flag rollback to the retained legacy ladder.
  setApiDispatchMode(config.dispatch);
  logApiDispatchSelection(logger, config.dispatch, process.env.NODE_ENV);

  // maxHeaderSize is read-only after construction so it rides createServer here;
  // the three mutable timeouts are set by applyServerTimeouts. Every value equals
  // Node's own default (server/http/server_timeouts.ts), so the effective behavior
  // is byte-equal to the prior implicit defaults; naming + pinning them is the
  // whole change.
  const server = http.createServer({ maxHeaderSize: MAX_HEADER_SIZE_BYTES }, routeHttpRequest);
  applyServerTimeouts(server);
  server.on('clientError', handleClientError);

  // cap frame size: the largest legitimate client message is a small JSON
  // command; without this the ws default (~100 MiB) lets one socket force a
  // huge allocation + parse before any field-level validation runs
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD_BYTES });
  const wsAuth = createWsAuth({
    game,
    accountForToken,
    moderationStatusForAccount,
    getCharacter,
    chatMuteStatusForAccount,
    adminRolesForAccount,
    permissionsForRoles,
    metaRequestUserData,
    metaEventSourceUrl,
    loadAccountCosmetics,
    isConnectionRefused,
    bufferHandshakeMessages,
    requestMetadata,
    maxWsPerIpHard: config.maxWsPerIpHard,
    maxPlayersPerRealm: config.maxPlayersPerRealm,
    acquireCharacterLease,
    releaseCharacterLease,
    bankBonusForAccount: async (id) => computeBankBonus(await bankBonusFactsForAccount(id)),
  });
  wsAuth.attachUpgrade(server, wss);

  // Register the game-state gauges + throughput counters on the SAME registry the
  // RED exporter built at module scope, then install the counter sink process-wide
  // (mirrors setAttackSignalSink). Wired here, after `game` and `wss` exist, so the
  // gauges read live state at scrape time; ws_connections is the raw open-socket
  // count (joined or not), distinct from players_online (joined sessions).
  const gameStateSource: GameStateSource = {
    playersOnline: () => game.clients.size,
    accountsOnline: () => game.liveAccountIds().size,
    wsConnections: () => wss.clients.size,
    simEntities: () => game.sim.entities.size,
    simTickHz: () => game.simTickHz(),
    tickPhaseMillis: () => game.tickPhaseMillis(),
    lastTickAt: () => game.lastTickAt(),
    loopStartedAt: () => game.loopStartedAt(),
  };
  setGameMetricsCounters(registerGameStateMetrics(httpMetrics.registry, gameStateSource));
  // Hand the same live source to /livez, so a wedged loop answers 503 from outside
  // the process. Registered HERE rather than read from the route arm: the /livez arm
  // must never touch liveGame() (a health probe constructing a GameServer is the bug
  // tests/server/game_boot_order.test.ts pins against).
  registerLivenessSource(gameStateSource);

  // Business gauges run one bounded, timeout-protected fact query every 15 minutes.
  // Scrapes publish only the cached snapshot and never query Postgres. Client FPS
  // stays available in the admin tooling but is intentionally not polled for the
  // business dashboard.
  const businessMetrics = registerBusinessMetrics(httpMetrics.registry);
  businessMetrics.start();

  game.start();
  server.listen(config.port, () => {
    console.log(`World of ClaudeCraft server listening on http://localhost:${config.port}`);
    console.log(`  REST: /api/register /api/login /api/characters /api/status`);
    console.log(`  WS:   /ws, then first message {t:"auth",token,character}`);
  });

  const shutdown = async () => {
    // Flip readiness to draining FIRST so /readyz answers 503 and a load balancer
    // sheds new traffic before we stop the loop and persist (in-flight requests and
    // /livez keep working through the drain).
    markDraining();
    console.log('shutting down: saving characters...');
    // Stop the app-aggregate metric collectors so no refresh query races the pool
    // close below (their intervals are unref()'d, but an in-flight tick could still
    // fire before pool.end()).
    await businessMetrics.stop();
    game.stop();
    await game.saveAll('shutdown');
    await game.saveMarket();
    await game.saveMail();
    await game.endAllPlaySessions();
    // Drain any bank_ledger writes still queued on the FIFO tail BEFORE the lease
    // sweep: once the leases drop, a replacement process can load the same character
    // and write new ledger rows, and rows still queued here would flush after them
    // with higher insertion ids, inverting the id order the offline audit replays by
    // (false negative_net / purchased_regression alarms). A clean restart loses no
    // audit rows this way (a crash still can; the audit tolerates that as a
    // transient mismatch). Rejections log inside the writer, so the drain never
    // throws.
    await bankLedgerIdle();
    // Drain the character_deeds FIFO too: saveAll above already persisted every
    // blob, and an insert still queued here would be rejected by pool.end() and
    // go missing until that character's next login (the join reconcile is the
    // only heal). Rejections log inside the writer, so the drain never throws.
    await deedRecordsIdle();
    // Stop and drain the Steam mirror's in-memory push FIFO too (right after the
    // deeds records it observes): an unlock still queued here would be lost on
    // pool.end(), and the next reconcile (on link or on login) is its only
    // replay. stopSteamMirror flips the shutdown flag and races the drain tail
    // against a 5s deadline, so a stuck upstream cannot hang the shutdown;
    // failures are swallowed inside the worker, so this never throws. A no-op
    // when the mirror is dark.
    await stopSteamMirror(5000);
    // Drop every character load lease this process holds so a clean restart can
    // reload its characters immediately instead of waiting out the lease TTL.
    // Runs before pool.end(); a failure here must not abort the shutdown, so log
    // and continue to close the pool.
    await releaseAllCharacterLeases().catch((err) =>
      console.error('lease release-all failed:', err),
    );
    await game.chatLog.stop();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Last-resort net: one player's request must never crash the process and
  // disconnect everyone. handleMessage already guards itself, but any future
  // uncaught throw in a timer or async path would otherwise be fatal. Log and
  // keep serving: a live world staying up beats a clean crash-loop. Genuinely
  // fatal startup errors are still handled by the entrypoint guard's
  // startServer().catch() below.
  process.on('uncaughtException', (err) => {
    console.error('uncaughtException (kept alive):', err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('unhandledRejection (kept alive):', reason);
  });

  return server;
}

// Boot only when this module is the process entrypoint, never on a bare import.
// The server always runs as the esbuild CJS bundle (npm run server / npm run
// realms, then node dist-server/server.cjs), where require.main === module marks
// the entry. esbuild leaves import.meta empty under the cjs output format, so the
// CJS entry check is the one that fires in the bundle; a Vitest import() of this
// module matches neither a defined require nor require.main === module, so the
// bare import stays inert (no socket bound, no DB connection).
if (typeof require !== 'undefined' && require.main === module) {
  startServer().catch((err) => {
    console.error('fatal:', err);
    process.exit(1);
  });
}
