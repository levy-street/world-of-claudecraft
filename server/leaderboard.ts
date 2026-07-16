// Public-read API surface, ported onto RouteDefs.
//
// This module hosts the anonymous public GET routes the registry dispatcher
// serves when API_DISPATCH is
// 'new': the lifetime-XP leaderboard (players, the guild fork, and the legacy
// single-page limit form), the arena ladder, the GitHub releases proxy feed,
// project-stats, search, the realm directory, the public character sheet, the
// dev-only perf profile, and status. The legacy handleApi arms for these paths
// stay in main.ts as the flag-off rollback path (removed only by the ladder-deletion PR), so a
// migrated route is intentionally BOTH router-owned (flag 'new') AND legacy-served
// (flag 'legacy'); the two paths are proven byte-identical by the parity harness.
//
// Structure (the module-first split this repo wants): the SQL reads stay in db.ts
// and the main.ts caches; this module carries only pure query decoders, pure
// response builders, host-agnostic read functions that take a narrow Db interface
// (unit-tested via the FakeDb fakes), and thin Ctx handlers. The handlers write
// with the same http_util json() helper the legacy arms use, so a ported success
// or error body is byte-identical to today's; the ONLY deliberate changes are the
// two labeled knownDeviations (the /api/status name-list trim and the /api/realms
// + /api/search authz-gap-close). Runtime singletons the handlers need but cannot
// import without a cycle (the live GameServer, the in-memory leaderboard/releases
// caches, publicOrigin/toSheetRank/GITHUB_REPO) are INJECTED once at boot via
// configureLeaderboardRuntime, so `export const routes` stays a static array
// registry.ts can spread while the handlers still reach main.ts state.

import type * as http from 'node:http';
import {
  LEADERBOARD_MAX,
  LEADERBOARD_PAGE_SIZE,
  paginateDeedsLeaderboard,
  paginateDevLeaderboard,
  paginateGuildLeaderboard,
  paginateLeaderboard,
} from '../src/sim/leaderboard_page';
import type { ArenaFormat } from '../src/sim/types';
import type {
  DeedsLeaderboardEntry,
  DeedsLeaderboardSelf,
  DevLeaderboardEntry,
  GuildLeaderboardEntry,
  LeaderboardEntry,
} from '../src/world_api';
import { characterSheet, SHEET_RECENT_DEEDS, type SheetRank } from './character_sheet';
import {
  type ArenaLeaderRow,
  type CharacterRow,
  type CharacterSearchRow,
  characterCountsByRealm,
  findCharacterReportTargetByName,
  getAccountsCount,
  getCharacterById,
  guildNameForCharacter,
  lifetimeXpRankForCharacter,
  searchCharacters,
  topArenaRatings,
} from './db';
import { type RecentDeedRow, recentDeedsForCharacter } from './deeds_db';
import { requireAccount } from './http/middleware/require_account';
import type { Ctx, RouteDef } from './http/types';
import { json } from './http_util';
import type { LiveReportTarget } from './moderation_db';
import { recordUsageMetric } from './provider_usage';
import { publicReadRateLimited } from './ratelimit';
import { REALM, REALM_DIRECTORY } from './realm';
// From the config module directly (not the ./steam barrel): the barrel drags
// routes.ts and its load-time middleware construction into this module's
// graph, which partial db mocks in tests cannot serve.
import { steamEnabled } from './steam/config';

// ---------------------------------------------------------------------------
// Named constants (single source of truth for the query decoders + fixed args).
// The paged bounds live in src/sim/leaderboard_page.ts (LEADERBOARD_PAGE_SIZE,
// LEADERBOARD_MAX) and are reused here so a page/pageSize decode can never invent
// a different bound than the paginator clamps to.
// ---------------------------------------------------------------------------

// The scope/format keyword constants are module-private (used only by the decoders
// and handlers here); the limit constants below are exported because the unit tests
// import them to assert the decoders clamp to the same bound the handlers use.
/** Default leaderboard scope: this process's realm (the in-game panel). */
const LEADERBOARD_SCOPE_DEFAULT = 'realm';
/** The cross-realm scope keyword (the home-page board). */
const LEADERBOARD_SCOPE_GLOBAL = 'global';
/** The ?board value that selects the guild high-score fork. */
const LEADERBOARD_GUILD_BOARD = 'guilds';
/** The ?board value that selects the open-source contributor (developer) board. */
const LEADERBOARD_DEV_BOARD = 'devs';
/** The ?board value that selects the Renown (deeds) board. */
const LEADERBOARD_DEEDS_BOARD = 'deeds';
/** Upper bound for the legacy ?limit=N single-page board (mirrors LEADERBOARD_MAX). */
export const LEADERBOARD_LEGACY_LIMIT_MAX = LEADERBOARD_MAX;
/** How many arena ranks the public ladder returns (mirrors the legacy fixed arg). */
export const ARENA_LEADERBOARD_LIMIT = 20;
/** The ?format value that selects the 2v2 arena ladder; anything else is 1v1. */
const ARENA_FORMAT_2V2 = '2v2';
const ARENA_FORMAT_DEFAULT = '1v1';
/** Max character-search results returned per query (mirrors the legacy fixed arg). */
export const SEARCH_RESULT_LIMIT = 8;

type LeaderboardScope = 'realm' | 'global';

// ---------------------------------------------------------------------------
// Runtime injection. registry.ts spreads the static `routes` array at module
// load, before main.ts has booted the GameServer, so the handlers cannot close
// over `game`/the caches directly (that would be a cycle: main -> registry ->
// leaderboard -> main). Instead main.ts injects them once at load via
// configureLeaderboardRuntime; a request never arrives before that runs.
// ---------------------------------------------------------------------------

/** The small, sanitised GitHub release shape the /api/releases feed returns. */
export interface ReleaseEntry {
  id: number;
  tag: string;
  name: string;
  body: string;
  url: string;
  prerelease: boolean;
  publishedAt: string; // ISO 8601
}

/**
 * The main.ts-owned runtime the public-read handlers depend on but cannot import
 * without a cycle: the live online-player count and dev perf profile off the
 * GameServer, the three cache-fronted readers (unchanged: same TTL cache the
 * legacy arms use, so cache behavior is identical on both dispatch paths), the
 * releases feed's repo + display cap, and the two request-shaped helpers.
 */
export interface LeaderboardRuntime {
  /** game.clients.size, for project-stats and status. */
  playersOnline(): number;
  /** The configured realm player cap for /api/status, canonicalized to a
   *  non-negative count (0 when the cap is disabled). */
  playersCap(): number;
  /** game.perfProfile(), for the dev-gated /api/perf route. */
  perfProfile(): unknown;
  /** Cache-fronted player leaderboard read (main.ts getLeaderboard). */
  getLeaderboard(scope: LeaderboardScope): Promise<LeaderboardEntry[]>;
  /** Cache-fronted guild leaderboard read (main.ts getGuildLeaderboard). */
  getGuildLeaderboard(scope: LeaderboardScope): Promise<GuildLeaderboardEntry[]>;
  /** Cache-fronted contributor (developer) leaderboard read (main.ts topContributors). */
  getDevLeaderboard(): Promise<DevLeaderboardEntry[]>;
  /** Cache-fronted Renown (deeds) board read (main.ts getDeedsLeaderboard):
   *  the FULL pre-cap public entry list; the handler pages it. */
  getDeedsLeaderboard(): Promise<DeedsLeaderboardEntry[]>;
  /** The caller's Renown-board standing off the same cache, null when unranked. */
  deedsSelfRank(accountId: number): Promise<DeedsLeaderboardSelf | null>;
  /** Cache-fronted GitHub releases proxy read (main.ts getReleases). */
  getReleases(): Promise<ReleaseEntry[]>;
  /** The repo slug the releases feed reports (main.ts GITHUB_REPO). */
  githubRepo: string;
  /** Max releases the feed returns / the ?limit upper bound (main.ts RELEASES_SIZE). */
  releasesMaxLimit: number;
  /** Canonical public origin for a request, for the character-sheet share URLs. */
  publicOrigin(req: http.IncomingMessage): string;
  /** Map a lifetime-XP rank read to the sheet's rank shape (main.ts toSheetRank). */
  toSheetRank(rank: { rank: number; total: number } | null): SheetRank | null;
}

let runtime: LeaderboardRuntime | null = null;

/** Inject the main.ts runtime the handlers need. Called once at boot. */
export function configureLeaderboardRuntime(rt: LeaderboardRuntime): void {
  runtime = rt;
}

/** Clear the injected runtime so a unit test can install its own fake. */
export function resetLeaderboardRuntimeForTests(): void {
  runtime = null;
}

/** The injected runtime, or a loud failure if a request somehow beat boot wiring. */
function useRuntime(): LeaderboardRuntime {
  if (runtime === null) {
    throw new Error('leaderboard runtime is not configured; call configureLeaderboardRuntime');
  }
  return runtime;
}

// ---------------------------------------------------------------------------
// Query decoders (pure, named-constant-bounded). These deliberately mirror the
// legacy lenient `Number(x) || default` coercion rather than a strict 422-on-junk
// schema: the migration is parity-clean, so `?page=abc` must default (not reject)
// exactly as the legacy arm does, and the paginator (paginateRanked) already
// clamps an out-of-range page/pageSize to a valid window before any read, so a
// bad value can never reach a DB call. A single first-value read handles a
// repeated query key the way URLSearchParams.get did (first occurrence wins).
// ---------------------------------------------------------------------------

/** First value for a query key (URLSearchParams.get semantics), or undefined. */
export function firstQueryValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** ?scope=global -> 'global'; anything else (incl. absent) -> the realm default. */
export function decodeScope(raw: string | undefined): LeaderboardScope {
  return raw === LEADERBOARD_SCOPE_GLOBAL ? LEADERBOARD_SCOPE_GLOBAL : LEADERBOARD_SCOPE_DEFAULT;
}

/** ?page=N (0-based). Non-numeric/absent -> 0; the paginator clamps the range. */
export function decodePage(raw: string | undefined): number {
  return Number(raw) || 0;
}

/** ?pageSize=M. Non-numeric/absent/zero -> the default; the paginator clamps. */
export function decodePageSize(raw: string | undefined): number {
  return Number(raw) || LEADERBOARD_PAGE_SIZE;
}

/** ?limit=N for the legacy single-page board, clamped to [1, LEADERBOARD_MAX]. */
export function decodeLegacyLimit(raw: string | undefined): number {
  return Math.max(
    1,
    Math.min(LEADERBOARD_LEGACY_LIMIT_MAX, Number(raw) || LEADERBOARD_LEGACY_LIMIT_MAX),
  );
}

/** ?format=2v2 -> '2v2'; anything else (incl. absent) -> 1v1. */
export function decodeArenaFormat(raw: string | undefined): ArenaFormat {
  return raw === ARENA_FORMAT_2V2 ? ARENA_FORMAT_2V2 : ARENA_FORMAT_DEFAULT;
}

/** ?limit=N for the releases feed, clamped to [1, max]. */
export function decodeReleasesLimit(raw: string | undefined, max: number): number {
  return Math.max(1, Math.min(max, Number(raw) || max));
}

// ---------------------------------------------------------------------------
// Response builders (pure). Each returns the exact body shape the legacy arm
// emits. The standard-board {items,page,pageCount,total,pageSize} "convention B"
// envelope was DEFERRED (see docs/api-pipeline/progress.md): a src/net + src/ui
// consumer audit found every live client reads the `leaders` key, so renaming it
// would silently break them; the paged shape is preserved as-is.
// ---------------------------------------------------------------------------

/** The default paged player board body: metric + the paginated slice under `leaders`. */
export function buildStandardBoard(
  realm: string,
  scope: LeaderboardScope,
  entries: readonly LeaderboardEntry[],
  page: number,
  pageSize: number,
): unknown {
  const slice = paginateLeaderboard(entries as LeaderboardEntry[], page, pageSize);
  return { realm, scope, metric: 'lifetimeXp', ...slice };
}

/** The legacy ?limit=N single-page board body: top N as one page, no paging UI. */
export function buildLegacyLimitBoard(
  realm: string,
  scope: LeaderboardScope,
  entries: readonly LeaderboardEntry[],
  limit: number,
): unknown {
  const leaders = entries.slice(0, limit);
  return {
    realm,
    scope,
    metric: 'lifetimeXp',
    leaders,
    page: 0,
    pageCount: 1,
    total: leaders.length,
    pageSize: limit,
  };
}

/** The guild high-score board body: the guild-metric slice, its own golden case. */
export function buildGuildBoard(
  realm: string,
  scope: LeaderboardScope,
  entries: readonly GuildLeaderboardEntry[],
  page: number,
  pageSize: number,
): unknown {
  const slice = paginateGuildLeaderboard(entries as GuildLeaderboardEntry[], page, pageSize);
  return { realm, scope, board: 'guilds', metric: 'guildLifetimeXp', ...slice };
}

/**
 * The Renown (deeds) board body: its own golden case. Account-level and
 * therefore GLOBAL-ONLY (Renown counts each deed once per ACCOUNT and accounts
 * span realms, so a realm scope is not well defined): the body always carries
 * scope 'global' whatever ?scope said. `self` rides only when the route
 * resolved an authenticated caller who is on the board.
 */
export function buildDeedsBoard(
  realm: string,
  entries: readonly DeedsLeaderboardEntry[],
  page: number,
  pageSize: number,
  self: DeedsLeaderboardSelf | null,
): unknown {
  const slice = paginateDeedsLeaderboard(entries as DeedsLeaderboardEntry[], page, pageSize);
  return {
    realm,
    scope: LEADERBOARD_SCOPE_GLOBAL,
    board: 'deeds',
    metric: 'renown',
    ...slice,
    ...(self ? { self } : {}),
  };
}

/** The contributor (developer) board body: the dev-metric slice, its own golden case. */
export function buildDevBoard(
  realm: string,
  scope: LeaderboardScope,
  entries: readonly DevLeaderboardEntry[],
  page: number,
  pageSize: number,
): unknown {
  const slice = paginateDevLeaderboard(entries as DevLeaderboardEntry[], page, pageSize);
  return { realm, scope, board: 'devs', metric: 'landedCommits', ...slice };
}

// ---------------------------------------------------------------------------
// Read functions (host-agnostic; take a narrow Db interface, no ctx/req/res).
// The FakeCharactersDb / FakeLeaderboardDb (tests/server/helpers/fake_db.ts)
// satisfy the relevant subset structurally, so these are unit-tested against the
// fakes. The db-touching routes (arena, search, realms, project-stats,
// sheet) go through these; the leaderboard/guild/releases routes read through the
// injected cache-fronted runtime and the pure builders above instead.
// ---------------------------------------------------------------------------

/** DB read the arena ladder needs. */
interface ArenaReadDb {
  topArenaRatings(limit?: number, format?: ArenaFormat): Promise<ArenaLeaderRow[]>;
}

/** GET /api/arena/leaderboard body. */
export async function readArenaLeaderboard(
  db: ArenaReadDb,
  rawFormat: string | undefined,
): Promise<{ format: ArenaFormat; leaders: ArenaLeaderRow[] }> {
  const format = decodeArenaFormat(rawFormat);
  const leaders = await db.topArenaRatings(ARENA_LEADERBOARD_LIMIT, format);
  return { format, leaders };
}

/** DB read the search route needs. */
interface SearchReadDb {
  searchCharacters(prefix: string, limit?: number): Promise<CharacterSearchRow[]>;
}

/**
 * GET /api/search body: results for a non-trivial query, else empty. The query,
 * not the caller identity, drives the results, so this takes no account id (the
 * anonymous-friendly gate is the route middleware; a caller with no account still
 * gets results).
 */
export async function readSearch(
  db: SearchReadDb,
  rawQuery: string | undefined,
): Promise<{ results: CharacterSearchRow[] }> {
  const q = (rawQuery ?? '').trim();
  const results = q.length >= 1 ? await db.searchCharacters(q, SEARCH_RESULT_LIMIT) : [];
  return { results };
}

/** DB read the realms route needs. */
interface RealmsReadDb {
  characterCountsByRealm(accountId: number): Promise<Record<string, number>>;
}

/** GET /api/realms body: the directory plus per-realm counts for an authed caller. */
export async function readRealms(
  db: RealmsReadDb,
  accountId: number | null,
  realm: string,
  directory: readonly unknown[],
): Promise<{ current: string; realms: readonly unknown[]; characters: Record<string, number> }> {
  const characters = accountId !== null ? await db.characterCountsByRealm(accountId) : {};
  return { current: realm, realms: directory, characters };
}

/** DB read project-stats needs (account-scoped, so not on the character Db). */
interface ProjectStatsReadDb {
  getAccountsCount(): Promise<number>;
}

/** GET /api/project-stats body. */
export async function readProjectStats(
  db: ProjectStatsReadDb,
  playersOnline: number,
  realm: string,
): Promise<{ accounts_created: number; players_online: number; realm: string }> {
  const accountsCount = await db.getAccountsCount();
  return { accounts_created: accountsCount, players_online: playersOnline, realm };
}

/** DB reads the public character sheet needs. */
interface PublicSheetDb {
  findCharacterReportTargetByName(name: string): Promise<LiveReportTarget | null>;
  getCharacterById(characterId: number): Promise<CharacterRow | null>;
  guildNameForCharacter(characterId: number): Promise<string | null>;
  lifetimeXpRankForCharacter(characterId: number): Promise<{ rank: number; total: number } | null>;
  recentDeedsForCharacter(characterId: number, limit: number): Promise<RecentDeedRow[]>;
}

/** The non-DB inputs the public sheet needs (realm, share origin, rank shaper). */
interface PublicSheetDeps {
  realm: string;
  origin: string;
  toSheetRank(rank: { rank: number; total: number } | null): SheetRank | null;
}

/**
 * GET /api/public/characters/:name/sheet: resolve a character BY NAME (never a
 * numeric id from the request, so a NaN can never reach a DB call), returning a
 * 404 { error } for an unknown name or a 200 public sheet. The numeric id passed
 * to getCharacterById always comes from the prior name lookup.
 */
export async function readPublicSheet(
  db: PublicSheetDb,
  rawName: string,
  deps: PublicSheetDeps,
): Promise<{ status: 200 | 404; body: unknown }> {
  const target = await db.findCharacterReportTargetByName(rawName);
  if (!target) return { status: 404, body: { error: 'character not found' } };
  const row = await db.getCharacterById(target.characterId);
  if (!row) return { status: 404, body: { error: 'character not found' } };
  const [guild, rank, deedsRecent] = await Promise.all([
    db.guildNameForCharacter(row.id),
    db.lifetimeXpRankForCharacter(row.id),
    db.recentDeedsForCharacter(row.id, SHEET_RECENT_DEEDS),
  ]);
  return {
    status: 200,
    body: characterSheet({
      row,
      visibility: 'public',
      realm: deps.realm,
      origin: deps.origin,
      guild,
      rank: deps.toSheetRank(rank),
      deedsRecent,
    }),
  };
}

// The real db.ts reads, bundled once so each thin handler passes the same object
// to its read function. The read functions only touch the subset they type. The
// active bundle is a `let` behind a test-only setter so the two handlers that
// ALWAYS hit the db (arena, project-stats) can be driven with a FakeDb; production
// never calls the setter, so REAL_DB_READS is the only runtime binding.
const REAL_DB_READS = {
  topArenaRatings,
  searchCharacters,
  characterCountsByRealm,
  getAccountsCount,
  findCharacterReportTargetByName,
  getCharacterById,
  guildNameForCharacter,
  lifetimeXpRankForCharacter,
  recentDeedsForCharacter,
};
let dbReads = REAL_DB_READS;

/** Override the db reads with a fake bundle (test-only; merges over the real reads). */
export function setLeaderboardDbForTests(reads: Partial<typeof REAL_DB_READS>): void {
  dbReads = { ...REAL_DB_READS, ...reads };
}

/** Restore the real db reads after a setLeaderboardDbForTests override (test-only). */
export function resetLeaderboardDbForTests(): void {
  dbReads = REAL_DB_READS;
}

// ---------------------------------------------------------------------------
// Handlers (thin Ctx adapters). Each decodes the query, reads through the
// runtime/db, and writes the legacy-identical response with json(). Errors keep
// their legacy { error } bodies (deliberately NOT problem+json); the
// sole new stable-code path is the gap-close auth.token_invalid, thrown by
// requireAccount({ optional: true }) and mapped by withErrors.
// ---------------------------------------------------------------------------

/** GET /api/leaderboard: standard paged board, the guild fork, and the legacy limit. */
async function leaderboardHandler(ctx: Ctx): Promise<void> {
  const rt = useRuntime();
  const scope = decodeScope(firstQueryValue(ctx.query.scope));
  if (firstQueryValue(ctx.query.board) === LEADERBOARD_GUILD_BOARD) {
    const entries = await rt.getGuildLeaderboard(scope);
    const page = decodePage(firstQueryValue(ctx.query.page));
    const pageSize = decodePageSize(firstQueryValue(ctx.query.pageSize));
    json(ctx.res, 200, buildGuildBoard(REALM, scope, entries, page, pageSize));
    return;
  }
  // The developer (open-source contributor) fork, byte-identical to the legacy
  // handleApi ?board=devs arm in main.ts (added by the release/v0.18.0 merge). The
  // contributor snapshot is realm-agnostic but the body still carries scope for
  // parity. decodePage/decodePageSize match the legacy Number(...) || default decode.
  if (firstQueryValue(ctx.query.board) === LEADERBOARD_DEV_BOARD) {
    const entries = await rt.getDevLeaderboard();
    const page = decodePage(firstQueryValue(ctx.query.page));
    const pageSize = decodePageSize(firstQueryValue(ctx.query.pageSize));
    json(ctx.res, 200, buildDevBoard(REALM, scope, entries, page, pageSize));
    return;
  }
  // The Renown (deeds) board fork. GLOBAL-ONLY like the dev board is
  // realm-agnostic: the decoder stays lenient (?scope is accepted and ignored)
  // and buildDeedsBoard fixes scope 'global'. Auth is OPTIONAL and composed
  // IN-HANDLER, never as route middleware: mounting optionalReadAccount on the
  // shared route would newly 401 present-but-invalid tokens on the existing
  // boards, breaking their parity. Here an anonymous caller gets the board
  // with no self row; a present token is validated per module convention
  // (malformed -> 401 auth.token_missing, unknown -> 401 auth.token_invalid,
  // locked -> 403) and a ranked caller gets their self row. The legacy
  // main.ts arm serves the same body with the lenient legacy bearer shape
  // (the authz-gap-close divergence class).
  if (firstQueryValue(ctx.query.board) === LEADERBOARD_DEEDS_BOARD) {
    await optionalReadAccount(ctx, async () => {
      const entries = await rt.getDeedsLeaderboard();
      const page = decodePage(firstQueryValue(ctx.query.page));
      const pageSize = decodePageSize(firstQueryValue(ctx.query.pageSize));
      const self = ctx.account ? await rt.deedsSelfRank(ctx.account.accountId) : null;
      json(ctx.res, 200, buildDeedsBoard(REALM, entries, page, pageSize, self));
    });
    return;
  }
  const entries = await rt.getLeaderboard(scope);
  const limitParam = firstQueryValue(ctx.query.limit);
  if (limitParam !== undefined) {
    json(ctx.res, 200, buildLegacyLimitBoard(REALM, scope, entries, decodeLegacyLimit(limitParam)));
    return;
  }
  const page = decodePage(firstQueryValue(ctx.query.page));
  const pageSize = decodePageSize(firstQueryValue(ctx.query.pageSize));
  json(ctx.res, 200, buildStandardBoard(REALM, scope, entries, page, pageSize));
}

/** GET /api/arena/leaderboard: the public all-time Ashen Coliseum ladder. */
async function arenaLeaderboardHandler(ctx: Ctx): Promise<void> {
  json(ctx.res, 200, await readArenaLeaderboard(dbReads, firstQueryValue(ctx.query.format)));
}

/** GET /api/releases: the News & Updates feed, mirrored from GitHub, cache-served. */
async function releasesHandler(ctx: Ctx): Promise<void> {
  recordUsageMetric('github.releases.api');
  const rt = useRuntime();
  const limit = decodeReleasesLimit(firstQueryValue(ctx.query.limit), rt.releasesMaxLimit);
  const entries = await rt.getReleases();
  json(ctx.res, 200, { repo: rt.githubRepo, releases: entries.slice(0, limit) });
}

/** GET /api/project-stats: accounts created, players online, realm. */
async function projectStatsHandler(ctx: Ctx): Promise<void> {
  const rt = useRuntime();
  json(ctx.res, 200, await readProjectStats(dbReads, rt.playersOnline(), REALM));
}

/**
 * GET /api/status: the public realm + online snapshot. LABELED knownDeviation
 * (status-name-list-trim): the online player name-list the legacy arm returned is
 * dropped here, so the public endpoint exposes counts only, not who is online.
 * steam.enabled is the capability advert clients read before rendering any
 * Steam link UI (dual-arm edit: the legacy main.ts twin carries the same field).
 * players_cap is the configured realm player cap (0 when disabled), also a dual-arm
 * edit: the legacy main.ts twin carries the same field with the same semantics.
 */
async function statusHandler(ctx: Ctx): Promise<void> {
  const rt = useRuntime();
  json(ctx.res, 200, {
    ok: true,
    realm: REALM,
    players_online: rt.playersOnline(),
    players_cap: rt.playersCap(),
    steam: { enabled: steamEnabled() },
  });
}

/**
 * GET /api/perf: the dev-only world-loop perf profile for the load harness. Gated
 * by ALLOW_DEV_COMMANDS so it is never exposed in production; the env is read live
 * per request (mirroring the legacy inline gate), and when off the route answers
 * the same 404 unknown-endpoint body the legacy fallthrough emits.
 */
async function perfHandler(ctx: Ctx): Promise<void> {
  if (process.env.ALLOW_DEV_COMMANDS !== '1') {
    json(ctx.res, 404, { error: 'unknown endpoint' });
    return;
  }
  json(ctx.res, 200, useRuntime().perfProfile());
}

/**
 * GET /api/search: character name search. LABELED knownDeviation
 * (realms-search-authz-gap-close): requireAccount({ optional: true }) serves an
 * ANONYMOUS request (no Authorization header) returning results, but a request
 * that DOES present a token has it validated (an invalid token is rejected 401
 * auth.token_invalid) and moderation-gated (a banned/suspended account is rejected
 * 403), instead of being silently treated as anonymous. A missing token no longer
 * 401s: search is now anonymous-friendly. Because it is now an anonymous DB-hitting
 * read, it is rate-limited in-handler with publicReadRateLimited (the same per-IP
 * public-read budget the sheet uses) to bound anonymous name-enumeration and DB
 * load; the 429 stays the legacy { error: 'rate limited' } body shape.
 */
async function searchHandler(ctx: Ctx): Promise<void> {
  if (!publicReadRateLimited(ctx.req).allowed) {
    json(ctx.res, 429, { error: 'rate limited' });
    return;
  }
  json(ctx.res, 200, await readSearch(dbReads, firstQueryValue(ctx.query.q)));
}

/**
 * GET /api/realms: the realm directory plus, for an authenticated caller, the
 * per-realm character counts. LABELED knownDeviation
 * (realms-search-authz-gap-close): the no-token behavior (empty counts) is
 * unchanged, but a PRESENT token is now validated (invalid -> 401), closing the
 * gap where an invalid token was silently treated as anonymous.
 */
async function realmsHandler(ctx: Ctx): Promise<void> {
  const accountId = ctx.account?.accountId ?? null;
  json(ctx.res, 200, await readRealms(dbReads, accountId, REALM, REALM_DIRECTORY));
}

/**
 * GET /api/public/characters/:name/sheet: the public, unauthenticated, read-only
 * character sheet, resolved by name and rate-limited to deter scraping. The 429
 * (rate limited) and 404 (not found) bodies stay legacy-identical; the limiter is
 * called in-handler (not via the rateLimit middleware) precisely to keep its 429
 * body shape unchanged, which the parity-first rate-limit invariant requires.
 */
async function publicSheetHandler(ctx: Ctx): Promise<void> {
  if (!publicReadRateLimited(ctx.req).allowed) {
    json(ctx.res, 429, { error: 'rate limited' });
    return;
  }
  const rt = useRuntime();
  const result = await readPublicSheet(dbReads, decodeURIComponent(ctx.params.name), {
    realm: REALM,
    origin: rt.publicOrigin(ctx.req),
    toSheetRank: rt.toSheetRank,
  });
  json(ctx.res, result.status, result.body);
}

// ---------------------------------------------------------------------------
// The route table. registry.ts spreads this into apiRoutes. Under API_DISPATCH
// 'new' the registry dispatcher serves these via the onion; the legacy handleApi
// arms stay in main.ts for the flag-off rollback until the ladder-deletion PR (next release).
// ---------------------------------------------------------------------------

/** The anonymous-friendly bearer resolver both authz-gap-close routes share. */
const optionalReadAccount = requireAccount({ scope: 'read', optional: true });

export const routes: RouteDef[] = [
  { method: 'GET', path: '/api/leaderboard', surface: 'api', handler: leaderboardHandler },
  {
    method: 'GET',
    path: '/api/arena/leaderboard',
    surface: 'api',
    handler: arenaLeaderboardHandler,
  },
  { method: 'GET', path: '/api/releases', surface: 'api', handler: releasesHandler },
  { method: 'GET', path: '/api/project-stats', surface: 'api', handler: projectStatsHandler },
  { method: 'GET', path: '/api/status', surface: 'api', handler: statusHandler },
  { method: 'GET', path: '/api/perf', surface: 'api', handler: perfHandler },
  {
    method: 'GET',
    path: '/api/search',
    surface: 'api',
    middleware: [optionalReadAccount],
    handler: searchHandler,
  },
  {
    method: 'GET',
    path: '/api/realms',
    surface: 'api',
    middleware: [optionalReadAccount],
    handler: realmsHandler,
  },
  {
    method: 'GET',
    path: '/api/public/characters/:name/sheet',
    surface: 'api',
    handler: publicSheetHandler,
    // A :param route that is INTENTIONALLY public (resolved by name, no ownership
    // check), so the registry coverage helper does not flag it as missing a BOLA
    // loader.
    meta: { publicRead: true },
  },
];
