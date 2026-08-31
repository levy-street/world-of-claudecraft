import { timingSafeEqual } from 'node:crypto';
import type * as http from 'node:http';
import { specialRoleByKey } from '../src/sim/discord_roles';
import { DISCORD_REWARD_GRANTS, discordStatusIndexForPoints } from '../src/sim/discord_tier';
import { dailyRewardService } from './daily_rewards';
import { pool } from './db';
import { discordFlexForAccount, discordFlexForAccounts, setDiscordPresenceCache } from './discord';
import { drainActivity, type QueuedActivity, requeueActivity } from './discord_activity';
import {
  DISCORD_BOT_BREAKER_STATES,
  type DiscordBotBreakerState,
  type DiscordBotCountersSnapshot,
  setDiscordBotCounters,
} from './discord_bot_counters';
import {
  accountForDiscord,
  type DiscordMemberMetaRecord,
  type DiscordOutboxLinkRow,
  discordIdsWithGuildFlair,
  discordLinksForAccounts,
  grantRewardPoints,
  loadRewardState,
  setDiscordGuildMember,
  setDiscordMemberMetaBulk,
} from './discord_db';
import {
  drainLinkChanges,
  type QueuedLinkChange,
  requeueLinkChanges,
} from './discord_link_changes';
import { drainRelay, type QueuedRelay, requeueRelay } from './discord_relay';
import type { GameServer } from './game';
import {
  DASHBOARD_SECRET_ENV,
  DASHBOARD_SECRET_HEADER,
  DEPLOY_SECRET_ENV,
  DEPLOY_SECRET_HEADER,
  DISCORD_SECRET_ENV,
  DISCORD_SECRET_HEADER,
  requireInternalSecret,
} from './http/middleware/require_internal_secret';
import type { Ctx, RouteDef, RouteHandler, RouteMeta } from './http/types';
import { json, readBody } from './http_util';
import type { WocMarketService, WocStuckCustodyReadout } from './woc_market';

function ok(res: http.ServerResponse, data: unknown): void {
  json(res, 200, { success: true, data, error: null });
}

function fail(res: http.ServerResponse, status: number, error: string, data: unknown = null): void {
  json(res, status, { success: false, data, error });
}

function secretsMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export async function handleInternalApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  game: GameServer,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname === '/internal/restart-countdown') {
    if (req.method !== 'POST') return fail(res, 404, 'unknown endpoint');
    const expected = process.env.RESTART_COUNTDOWN_SECRET ?? '';
    if (!expected) return fail(res, 404, 'unknown endpoint');
    const actual = String(req.headers['x-woc-deploy-secret'] ?? '');
    if (!secretsMatch(actual, expected)) return fail(res, 401, 'not authenticated');
    const status = game.startRestartCountdown();
    if (!status.started) return fail(res, 409, 'restart countdown already active', status);
    return ok(res, status);
  }

  if (url.pathname.startsWith('/internal/discord/')) {
    return handleDiscordInternal(req, res, url);
  }

  return fail(res, 404, 'unknown endpoint');
}

/**
 * Secret-gated operator READS for the internal dashboard.
 *
 * These exist because listings and p2p trades live only in this process's
 * database: the economy service owns quotes and settings, and nothing else can
 * see a listing. The dashboard reaches them the way it already reaches the
 * payout and economy services, with a shared secret injected server-side, so no
 * privileged user credential is stored merely to read an ops table.
 *
 * Reads plus exactly ONE write, the parked-review settlement ruling. Every
 * OTHER mutation an operator could want lives on the role-gated /admin/api
 * surface with its own audit trail, and moving one here would move it out
 * from under that. The ruling is the deliberate exception: its workflow is
 * inseparable from the stuck readout the dashboard renders (verify the row
 * on chain, then rule it), and the game admin SPA has no market surface at
 * all. What compensates for the shared secret carrying no actor: the
 * dashboard side gates the control on its settlement-management role and
 * sends the acting username in the body's note (echoed into the audit log
 * line here), the service's kill switch freezes the arm with the other
 * operator writes, and the ruling rides the realm-scoped transition CAS.
 */
const LISTING_STATUSES = [
  'active',
  'ending',
  'settling',
  'closed',
  'sold',
  'cancelled',
  'all',
] as const;
const OFFER_STATUSES = ['pending', 'accepted', 'declined', 'withdrawn', 'expired', 'all'] as const;

const OPS_DAY_MS = 24 * 60 * 60 * 1000;

/** An unrecognised value falls back to the default rather than refusing: an ops
 *  read answering 400 on a typo is less useful than one showing the default. */
function readEnum<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

/** A query-string integer with a default. Distinct from clampInt below, which
 *  clamps an already-decoded value and has no notion of an absent parameter. */
function intParam(raw: string | null, fallback: number, min: number, max: number): number {
  // ABSENT is checked before Number(), not after. Number(null) and Number('')
  // are both 0, and 0 is finite, so a "not a number, use the default" guard
  // never fires for a missing parameter: the window silently collapsed to
  // fromMs=toMs=0 and every read came back empty.
  if (raw === null || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

/** The window, defaulting to the last 30 days. Both ends are clamped so a
 *  malformed or hostile range cannot turn an ops read into a full scan with an
 *  unbounded sort. */
function readRange(query: Ctx['query']): { fromMs: number; toMs: number } {
  const now = Date.now();
  const toMs = intParam(param(query, 'toMs'), now, 0, now + OPS_DAY_MS);
  const fromMs = intParam(param(query, 'fromMs'), toMs - 30 * OPS_DAY_MS, 0, toMs);
  return { fromMs, toMs };
}

/** ctx.query, not a re-parse of ctx.req.url: the dispatcher already parsed the
 *  request, and re-deriving it here read an empty search string, so every filter
 *  silently fell back to its default. A repeated key arrives as an array, and
 *  the first value is the one that counts. */
function param(query: Ctx['query'], key: string): string | null {
  const raw = query[key];
  if (raw === undefined) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function opsQuery(ctx: Ctx): { query: Ctx['query']; page: number; pageSize: number } {
  return {
    query: ctx.query,
    page: intParam(param(ctx.query, 'page'), 0, 0, 10_000),
    pageSize: intParam(param(ctx.query, 'pageSize'), 50, 1, 200),
  };
}

async function opsListingsHandler(ctx: Ctx): Promise<void> {
  const service = wocMarketOps;
  // An unwired market is a 404, matching how an unset secret reads: the
  // dashboard learns the surface is unavailable, not that it guessed wrong.
  if (!service) return fail(ctx.res, 404, 'unknown endpoint');
  const { query, page, pageSize } = opsQuery(ctx);
  const status = readEnum(param(query, 'status'), LISTING_STATUSES, 'active');
  ok(ctx.res, await service.opsListings({ status, ...readRange(query), page, pageSize }));
}

async function opsP2pTradesHandler(ctx: Ctx): Promise<void> {
  const service = wocMarketOps;
  if (!service) return fail(ctx.res, 404, 'unknown endpoint');
  const { query, page, pageSize } = opsQuery(ctx);
  const status = readEnum(param(query, 'status'), OFFER_STATUSES, 'all');
  ok(ctx.res, await service.opsP2pTrades({ status, ...readRange(query), page, pageSize }));
}

async function opsStuckHandler(ctx: Ctx): Promise<void> {
  const read = wocMarketStuckRead;
  // An unwired monitor is a 404, matching how an unset secret reads.
  if (!read) return fail(ctx.res, 404, 'unknown endpoint');
  // Deliberately parameter-free: every caller gets the same bounded readout,
  // which is what lets the monitor's cached read serve all of them.
  ok(ctx.res, await read());
}

async function opsResolveSettlementHandler(ctx: Ctx): Promise<void> {
  const service = wocMarketOps;
  // An unwired market is a 404, matching the sibling reads above.
  if (!service) return fail(ctx.res, 404, 'unknown endpoint');
  // Digits-only, then range: Number() alone also accepts hex, exponent and
  // whitespace-padded forms, which an operator pasting from a log must not
  // discover the hard way on a money path.
  const rawId = ctx.params.id ?? '';
  if (!/^\d+$/.test(rawId)) return fail(ctx.res, 400, 'invalid settlement id');
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return fail(ctx.res, 400, 'invalid settlement id');
  }
  // A malformed or over-cap body is its own refusal, never disguised as a
  // verdict complaint.
  let body: Record<string, unknown>;
  try {
    body = (await readBody(ctx.req)) as Record<string, unknown>;
  } catch {
    return fail(ctx.res, 400, 'invalid JSON body');
  }
  const verdict = body.verdict;
  if (verdict !== 'paid' && verdict !== 'unpaid') {
    return fail(ctx.res, 400, "verdict must be 'paid' or 'unpaid'");
  }
  // Optional attribution (the dashboard sends who clicked; a ticket id or the
  // verified signature may ride along): bounded and flattened for the log.
  const note =
    typeof body.note === 'string' ? body.note.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  const out = await service.adminResolveReviewSettlement(id, verdict);
  if (!out.ok) {
    // The kill switch freezes this write (the service's own gate); the CAS
    // answers are operator truths, not errors in the request. A live row
    // outside review carries its actual state so the operator can tell a
    // lost race from a mistyped id onto a settlement in another phase.
    if (out.reason === 'disabled') return fail(ctx.res, 409, 'market disabled');
    if ('state' in out) {
      return fail(ctx.res, 409, 'settlement is not in review', { state: out.state });
    }
    return fail(ctx.res, 404, 'settlement not found');
  }
  // Dev-channel breadcrumb (no player surface): the ruling is the one manual
  // state transition in the market, so this line plus the row's fail_reason
  // provenance and updated_at are the durable audit trail.
  console.log(
    `[woc_market] review settlement ${id} resolved ${verdict} -> ${out.to}${note ? ` (${note})` : ''}`,
  );
  ok(ctx.res, { resolved: verdict, state: out.to });
}

// Secret-gated server<->bot channel. The Discord bot (a separate process) reads
// flex/role data and pushes presence + reward grants here. A bot token is NOT a
// user bearer, so these never touch the user-auth path; they authenticate with a
// shared DISCORD_BOT_SECRET and are still defensively validated.
async function handleDiscordInternal(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): Promise<void> {
  const expected = process.env.DISCORD_BOT_SECRET ?? '';
  if (!expected) return fail(res, 404, 'unknown endpoint'); // feature off
  const actual = String(req.headers['x-woc-discord-secret'] ?? '');
  if (!secretsMatch(actual, expected)) return fail(res, 401, 'not authenticated');

  // GET /internal/discord/flex?discord_user_id=... -> top character + status.
  if (req.method === 'GET' && url.pathname === '/internal/discord/flex') {
    const discordUserId = url.searchParams.get('discord_user_id') ?? '';
    const accountId = await accountForDiscord(pool, discordUserId);
    if (accountId === null) return ok(res, { linked: false });
    return ok(res, { linked: true, ...(await discordFlexForAccount(accountId)) });
  }

  // GET /internal/discord/roles?discord_user_id=... -> status tier for role sync.
  if (req.method === 'GET' && url.pathname === '/internal/discord/roles') {
    const discordUserId = url.searchParams.get('discord_user_id') ?? '';
    const accountId = await accountForDiscord(pool, discordUserId);
    if (accountId === null) return ok(res, { linked: false, statusTier: 0, points: 0 });
    const reward = await loadRewardState(pool, accountId);
    return ok(res, {
      linked: true,
      statusTier: discordStatusIndexForPoints(reward.lifetimePoints),
      points: reward.points,
      lifetimePoints: reward.lifetimePoints,
    });
  }

  // POST /internal/discord/presence -> cache who is online / in the voice room.
  if (req.method === 'POST' && url.pathname === '/internal/discord/presence') {
    const body = await readBody(req).catch(() => ({}) as Record<string, unknown>);
    const onlineCount = clampInt(body.onlineCount, 0, 1_000_000);
    const memberTotal = clampInt(body.memberTotal, 0, 100_000_000);
    const voiceChannelName =
      typeof body.voiceChannelName === 'string' ? body.voiceChannelName.slice(0, 80) : null;
    const voice = Array.isArray(body.voice)
      ? body.voice.slice(0, 50).map((m: unknown) => sanitizeVoiceMember(m))
      : [];
    setDiscordPresenceCache({ onlineCount, memberTotal, voiceChannelName, voice });
    // The bot's own rate-limit/breaker counters ride the same push. Absent (an
    // older bot) leaves the counters cache alone; present, it never affects the
    // presence fields above or the response.
    const botCounters = sanitizeBotCounters(body.counters);
    if (botCounters) setDiscordBotCounters(botCounters, Date.now());
    return ok(res, { received: true });
  }

  // POST /internal/discord/grant -> award reward points (booster, daily active...).
  if (req.method === 'POST' && url.pathname === '/internal/discord/grant') {
    const body = await readBody(req).catch(() => ({}) as Record<string, unknown>);
    const discordUserId = typeof body.discord_user_id === 'string' ? body.discord_user_id : '';
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 64) : '';
    const points = clampInt(body.points, -100_000, 100_000);
    const dedupeKey = typeof body.dedupeKey === 'string' ? body.dedupeKey.slice(0, 128) : null;
    if (!reason || points === 0) return fail(res, 400, 'reason and non-zero points required');
    const accountId = await accountForDiscord(pool, discordUserId);
    if (accountId === null) return fail(res, 404, 'discord id not linked');
    const state = await grantRewardPoints(pool, accountId, points, reason, dedupeKey);
    return ok(res, {
      points: state.points,
      lifetimePoints: state.lifetimePoints,
      statusTier: discordStatusIndexForPoints(state.lifetimePoints),
    });
  }

  // POST /internal/discord/member -> sync guild membership + grant the member reward.
  if (req.method === 'POST' && url.pathname === '/internal/discord/member') {
    const body = await readBody(req).catch(() => ({}) as Record<string, unknown>);
    const discordUserId = typeof body.discord_user_id === 'string' ? body.discord_user_id : '';
    const guildMember = body.guildMember === true;
    const accountId = await accountForDiscord(pool, discordUserId);
    if (accountId === null) return fail(res, 404, 'discord id not linked');
    await setDiscordGuildMember(pool, accountId, guildMember);
    if (guildMember) {
      const g = DISCORD_REWARD_GRANTS.guildMember;
      await grantRewardPoints(pool, accountId, g.points, g.reason, `${g.reason}:${accountId}`);
    }
    return ok(res, { updated: true });
  }

  // The per-endpoint GET pickups this ladder used to serve (relay, activity,
  // daily-rewards-winners) were RETIRED with their RouteDef twins once the bot
  // moved to the single GET /internal/discord/outbox poll (#2791): both arms
  // answer the terminal 404 below, in both dispatch modes.

  if (req.method === 'POST' && url.pathname === '/internal/discord/daily-rewards-winners/mark') {
    const result = await dailyRewardService.markDiscordWinnersAnnounced(
      await readBody(req).catch(() => ({})),
    );
    if ('error' in result) return fail(res, result.status, result.error);
    return ok(res, result);
  }

  // POST /internal/discord/members-meta -> the bot pushes guild join dates + top
  // staff/special role for members; we store it on the matching linked accounts.
  // One multi-row upsert for the whole push (applyMemberMetaPush), shared with
  // the RouteDef arm so the two can never diverge.
  if (req.method === 'POST' && url.pathname === '/internal/discord/members-meta') {
    const body = await readBody(req).catch(() => ({}) as Record<string, unknown>);
    return ok(res, await applyMemberMetaPush(body));
  }

  // GET /internal/discord/flaired-ids -> the discord ids whose stored link still
  // carries guild membership or a special-role key. The bot diffs this against a
  // COMPLETE live roster to clear flair for members who left while it was offline
  // (clears go back through the member + members-meta endpoints, so this stays a
  // pure read and a truncated request body can never mass-clear anything).
  if (req.method === 'GET' && url.pathname === '/internal/discord/flaired-ids') {
    return ok(res, { ids: await discordIdsWithGuildFlair(pool) });
  }

  return fail(res, 404, 'unknown endpoint');
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
  return Math.max(min, Math.min(max, n));
}

// How many members one members-meta push may carry, and how many Discord ids one
// flex-batch request may ask about. Both are ARRAY caps applied before any
// per-entry validation, so an over-cap request keeps its first N entries rather
// than being refused. The real ceiling on either request is readBody's 64 KiB
// body cap (server/http_util.ts DEFAULT_JSON_BODY_MAX_BYTES), which binds first
// for full member records; flex-batch carries bare id strings, so 1000 of them is
// roughly 23 KiB and the array cap is what binds there.
const MEMBERS_META_CAP = 1000;
const FLEX_BATCH_CAP = 1000;

/**
 * Validate a list of Discord user ids from a request body: cap the array, slice
 * each id to the stored column width, drop anything that is not a non-empty
 * string, and drop repeats. Mirrors the members-meta member-list validation so
 * the two endpoints cannot drift on what they accept.
 */
function sanitizeDiscordIdList(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const raw of value.slice(0, cap)) {
    const id = typeof raw === 'string' ? raw.slice(0, 32) : '';
    if (id) seen.add(id);
  }
  return [...seen];
}

/**
 * Validate a members-meta request body into the records the bulk upsert takes.
 * Every clamp is the one the per-member loop applied before it: the 1000-entry
 * array cap, the 32-char id slice, the 64-char name slice, the finite-number
 * joinedAtMs check, and the known-special-role-key check that clears anything
 * else. Repeats collapse keeping the LAST occurrence, which is the row state the
 * old sequential loop left behind.
 */
function parseMemberMetaRecords(body: Record<string, unknown>): DiscordMemberMetaRecord[] {
  const members = Array.isArray(body.members) ? body.members.slice(0, MEMBERS_META_CAP) : [];
  const byId = new Map<string, DiscordMemberMetaRecord>();
  for (const m of members) {
    const o = m && typeof m === 'object' ? (m as Record<string, unknown>) : {};
    const id = typeof o.discord_user_id === 'string' ? o.discord_user_id.slice(0, 32) : '';
    if (!id) continue;
    const nickname = typeof o.name === 'string' ? o.name.slice(0, 64) : null;
    const joinedAtMs =
      typeof o.joinedAtMs === 'number' && Number.isFinite(o.joinedAtMs) ? o.joinedAtMs : null;
    // Only accept a known special-role key; anything else clears the role.
    const roleKey = typeof o.role === 'string' && specialRoleByKey(o.role) ? o.role : null;
    byId.set(id, { discordUserId: id, nickname, joinedAtMs, roleKey });
  }
  return [...byId.values()];
}

/** The members-meta answer: what was accepted, and what actually happened to it. */
interface MemberMetaPushResult {
  /**
   * Records ACCEPTED for application (validated, in-cap, de-duplicated). It keeps
   * counting records READ rather than rows written, which is deliberate: the
   * bot's client (bot/server_client.ts pushMembersMeta) treats `updated === 0` on
   * a non-empty push as a hard refusal and aborts the whole sweep, so narrowing
   * this to "rows we wrote" would make a post-restart full re-push (where nothing
   * changed) and any all-unlinked batch read as a total failure. The over-cap
   * silent drop that guard was written for still answers 0 here.
   *
   * One honest difference from the old loop, which incremented once per entry: a
   * push carrying the SAME id twice now counts it once, because duplicates
   * collapse before the count. The stored result is unchanged (the old loop's
   * later write won, and de-duplication keeps the last occurrence).
   */
  updated: number;
  /** Of those, the rows whose stored values really changed. */
  changed: number;
  /** Of those, the rows that existed and already matched (nothing written). */
  skipped: number;
  /**
   * The accepted ids with NO discord_links row, so nothing could be applied. A
   * count would not be enough: the pusher has to know WHICH ids to leave dirty so
   * their meta is re-sent once they link. Bounded by the same array cap the
   * request carries.
   *
   * `updated === changed + skipped + unapplied.length` holds absent a concurrent
   * writer on the same rows. Under READ COMMITTED the classification and the
   * UPDATE share one snapshot, but the UPDATE re-checks its predicate against the
   * newest committed row version, so a row another transaction moved in between
   * can fall out of both counts. Reporting the real numbers is worth more than an
   * identity made true by deriving one of them from the others.
   */
  unapplied: string[];
}

/**
 * The whole members-meta behavior, shared by BOTH dispatch arms so the RouteDef
 * handler and the frozen legacy ladder branch cannot answer differently: they
 * call this one function rather than each reproducing the logic (the dual-edit
 * rule for a migrated route, server/http/CLAUDE.md).
 */
async function applyMemberMetaPush(body: Record<string, unknown>): Promise<MemberMetaPushResult> {
  const records = parseMemberMetaRecords(body);
  const applied = await setDiscordMemberMetaBulk(pool, records);
  return { updated: records.length, ...applied };
}

/**
 * POST /internal/discord/flex-batch -> the flex payload for many Discord ids in
 * one request. The bot's sweep asked the per-id GET /internal/discord/flex once
 * per online Discord user, and each of those cost up to four uncached queries;
 * this answers the whole set with one batched read.
 *
 * RouteDef-ONLY by design: a route born after the pipeline migration never gets a
 * legacy handleDiscordInternal arm (server/http/CLAUDE.md), so there is nothing
 * to keep in lockstep here.
 *
 * Ids with no link row are ABSENT from `members` rather than carrying a
 * fabricated payload, which is the batch equivalent of the per-id route's
 * { linked: false }. Callers key on discord_user_id, never on position.
 *
 * `requested` echoes how many ids actually survived validation, and it is not
 * decoration. Absence-means-unlinked is this endpoint's whole contract, and
 * readBody rejects an over-cap or malformed body into an empty object, so without
 * the echo a DROPPED request and a genuine "none of these are linked" answer are
 * the same 200 { members: [] }. A caller that later strips flair for the ids
 * missing from a response would mass-clear on a truncated request. Comparing
 * `requested` against the number of DISTINCT in-cap id strings it sent tells the
 * caller which one it got. DISTINCT is load-bearing in that sentence: the count
 * is taken AFTER the cap, the non-string drop and the de-duplication, so a caller
 * that sent repeats and compared against its raw array length would read a
 * perfectly delivered response as a truncated one. The bot's sweep holds its ids
 * in a Set, so this cannot arise from the real client; the rule is written down
 * for whoever wires the Phase 6 consumer. (The sibling members-meta has the same
 * hazard and its own signal for it: an over-cap body answers updated 0, which its
 * client already treats as a refusal.)
 */
export const flexBatchHandler: RouteHandler = async (ctx) => {
  const body = await readBody(ctx.req).catch(() => ({}) as Record<string, unknown>);
  const ids = sanitizeDiscordIdList(body.discord_user_ids, FLEX_BATCH_CAP);
  return ok(ctx.res, { requested: ids.length, members: await discordFlexForAccounts(ids) });
};

// How many winner days one outbox drain carries: ONE, the ask the winners
// service itself now fixes (DAILY_REWARD_WINNER_DAY_LIMIT, server/daily_rewards.ts).
// The D11 retirement (#2791) removed the standalone winners GET whose limit
// param was the one wider ask, so discordWinnerAnnouncements takes no limit and
// a backlog drains across successive polls, one announce-and-mark per poll.

// How many link changes one outbox drain carries. Tied to FLEX_BATCH_CAP: a page
// larger than the bot's flex-batch cap is more than it can act on in one cycle
// anyway, since acting on a link change means asking flex-batch about it. It also
// bounds the two things a single poll can cost: the serialization spike of the
// response, and the number of items at risk when a poll fails (they are requeued,
// so the risk is retry latency, not loss). A backlog pages out across successive
// polls; the feed's own cap and eviction preference bound what waits. The value
// is FLEX_BATCH_CAP's 1000, written as its own literal rather than derived: the
// relationship is a ceiling ("never more than the bot can act on"), not an
// identity, so a future change to either one should be a deliberate decision.
export const OUTBOX_LINK_CHANGE_PAGE = 1000;

/**
 * GET /internal/discord/outbox -> everything the bot has to pick up, in ONE poll.
 *
 * The bot used to poll four endpoints on their own timers (relay, activity,
 * daily-rewards-winners, and a full re-read of every online member to notice
 * flex changes). This answers all of them together, so the bot's steady-state
 * cost is one request per interval rather than four plus a sweep. Those three
 * per-endpoint GET pickups are now RETIRED from both dispatch arms (#2791):
 * this poll is the only pickup surface.
 *
 * RouteDef-ONLY by design, like flex-batch: a route born after the pipeline
 * migration never gets a legacy handleDiscordInternal arm (server/http/CLAUDE.md),
 * so there is nothing to keep in lockstep here.
 *
 * ORDER OF WORK, and it is deliberate:
 *  1. Read the winner days FIRST, before anything is drained. It depends on
 *     nothing the drains produce, and it is the most failure-prone await here (a
 *     database read behind a TTL cache). Precisely: a COLD or just-busted winners
 *     cache whose refresh fails refuses the poll before a single queued item is
 *     consumed, while a WARM cache stale-serves through a refresh failure
 *     (createCachedRead's deliberate resilience). Stale-serve is safe here: it
 *     can only re-serve an UNMARKED day, which the retry contract below already
 *     delivers at-least-once, and a marked day can never be stale-served because
 *     markDiscordWinnersAnnounced busts the cache on success.
 *  2. Drain the three in-memory feeds. They are pure array splices, so a poll
 *     that finds nothing queued costs zero further Postgres round trips.
 *  3. Collect the account ids every drained item mentions. An EMPTY set issues no
 *     identity query at all.
 *  4. Otherwise resolve the whole union with ONE discordLinksForAccounts call.
 *     The per-item discordForAccount lookup the retired relay GET ran once per
 *     item never appears here: that N+1 is what invariant D1 forbids on this
 *     path.
 *
 * RETRY CONTRACT (Phase 6's retry logic is written against this):
 *  - `winners` is an IDEMPOTENT READ. It stays unannounced until the bot calls
 *    the mark endpoint, so it is delivered at-least-once across retries and a
 *    repeated poll simply re-reads the same days.
 *  - The three in-memory streams are PRESERVED ON ERROR and CONSUMED ON SUCCESS.
 *    Everything from the identity read to the response build runs inside a try
 *    whose catch requeues all three drains at the front of their queues, in
 *    order, before rethrowing. So a failed poll answers 500 with nothing lost and
 *    the next poll carries the same items; a 200 is the only outcome that
 *    consumes them, which is exactly what makes a bot-side retry safe.
 *  - A 200 response is therefore the ONLY acknowledgement. A bot that drops a
 *    successful response on the floor loses those items to its own next full
 *    resync, not to this endpoint.
 *
 * The envelope field order is relay, activity, winners, linkChanges, and each
 * stream keeps its queue's FIFO order. The relay and activity streams keep the
 * item shapes their retired per-endpoint GETs served (invariant D11, now this
 * poll's own contract with the bot); the winners stream dropped the fields
 * announcing never used when the standalone GET's byte-parity pin retired with
 * it (#2791); linkChanges was born here.
 */
export const outboxHandler: RouteHandler = async (ctx) => {
  const winners = await dailyRewardService.discordWinnerAnnouncements();
  // The drains live INSIDE the try so the requeue guarantee is enforced by
  // structure rather than by the accident that a splice cannot throw: anything
  // that fails after the first item leaves a queue puts every drained item back.
  let relayItems: QueuedRelay[] = [];
  let activityItems: QueuedActivity[] = [];
  let linkChangeItems: QueuedLinkChange[] = [];
  try {
    relayItems = drainRelay();
    activityItems = drainActivity();
    linkChangeItems = drainLinkChanges(OUTBOX_LINK_CHANGE_PAGE);
    const accountIds = new Set<number>();
    for (const it of relayItems) accountIds.add(it.accountId);
    for (const it of activityItems) {
      for (const accountId of it.accountIds) accountIds.add(accountId);
    }
    for (const it of linkChangeItems) accountIds.add(it.accountId);
    const links = accountIds.size === 0 ? [] : await discordLinksForAccounts(pool, [...accountIds]);
    const linkByAccount = new Map<number, DiscordOutboxLinkRow>(
      links.map((row) => [row.account_id, row]),
    );

    const relay = relayItems.map((it) => {
      const link = linkByAccount.get(it.accountId);
      return {
        ...it,
        discordUserId: link?.discord_user_id ?? null,
        discordUsername: link?.discord_username ?? null,
        discordAvatar: link?.discord_avatar ?? null,
      };
    });

    const activity: unknown[] = [];
    for (const it of activityItems) {
      const participants = it.accountIds.map((accountId, i) => {
        const link = linkByAccount.get(accountId);
        return {
          name: it.names[i] ?? '',
          discordUserId: link?.discord_user_id ?? null,
          discordAvatar: link?.discord_avatar ?? null,
        };
      });
      if (!participants.some((p) => p.discordUserId)) continue; // nobody linked
      const { accountIds: _a, names: _n, ...rest } = it;
      activity.push({ ...rest, participants });
    }

    const linkChanges: unknown[] = [];
    for (const it of linkChangeItems) {
      const link = linkByAccount.get(it.accountId);
      // The carried id wins over the stored row: an 'unlink' item's discord_links
      // row is already gone by the time this drains, so the id it carried at
      // enqueue is the only way to tell the bot WHICH member to stop flairing.
      const discordUserId = it.discordId ?? link?.discord_user_id ?? null;
      // Neither source knows a Discord id, so this account is not linked and the
      // bot has nothing to push for it. The points feed enqueues for unlinked
      // accounts too (playtime grants reach every player), which is exactly the
      // noise this drop exists to filter.
      if (discordUserId === null) continue;
      // The name and avatar may only describe the id being EMITTED. When an
      // account repoints to a new Discord identity, the item carries the OLD id
      // and the stored row already holds the NEW one, so decorating from the row
      // would hand the bot user X's id wearing user Y's handle and avatar. The
      // bot re-reads the account anyway; a null here is a missing decoration,
      // where a mismatched one is a wrong claim about who someone is.
      const identity = link?.discord_user_id === discordUserId ? link : undefined;
      linkChanges.push({
        accountId: it.accountId,
        kinds: it.kinds,
        discordUserId,
        discordUsername: identity?.discord_username ?? null,
        discordAvatar: identity?.discord_avatar ?? null,
      });
    }

    return ok(ctx.res, {
      relay: { items: relay },
      activity: { items: activity },
      winners,
      linkChanges: { items: linkChanges },
    });
  } catch (err) {
    // The queues are the bot's only copy of these items, so a failed response
    // build must not be what deletes them. Order within each stream is restored
    // (front-inserted, original order); the bot gets a 500 and retries.
    requeueRelay(relayItems);
    requeueActivity(activityItems);
    requeueLinkChanges(linkChangeItems);
    throw err;
  }
};

/**
 * Cap for every bot counter field. Cumulative-since-bot-start values are the ones
 * that can actually grow, and a billion requests is far past anything a real bot
 * process reaches before it restarts, so the cap only ever binds on a nonsense
 * push. Clamping (rather than rejecting) keeps one bad field from discarding the
 * rest of an otherwise good push.
 */
const BOT_COUNTER_MAX = 1_000_000_000;

/**
 * Validate the OPTIONAL bot `counters` block on a presence push into the fixed
 * cache shape: every numeric field clamped, the scope record rebuilt from exactly
 * the four known scopes, the breaker state taken from its allowlist. The result is
 * always a FRESH object, never a spread of the request body, so an unknown field
 * cannot ride into the cache and (via the exporter) become a Prometheus series.
 *
 * Returns null when the body carries no counters object at all, which is what an
 * older bot sends: the arm then leaves the counters cache untouched and it ages
 * out on its own rather than reading as a bot reporting all zeroes.
 */
function sanitizeBotCounters(value: unknown): DiscordBotCountersSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const scopes =
    o.rateLimitedByScope &&
    typeof o.rateLimitedByScope === 'object' &&
    !Array.isArray(o.rateLimitedByScope)
      ? (o.rateLimitedByScope as Record<string, unknown>)
      : {};
  const count = (v: unknown): number => clampInt(v, 0, BOT_COUNTER_MAX);
  return {
    requests: count(o.requests),
    rateLimited: count(o.rateLimited),
    rateLimitedByScope: {
      user: count(scopes.user),
      global: count(scopes.global),
      shared: count(scopes.shared),
      unknown: count(scopes.unknown),
    },
    globalPauses: count(o.globalPauses),
    banPauses: count(o.banPauses),
    breakerState: botBreakerState(o.breakerState),
    breakerOpens: count(o.breakerOpens),
    queueDepth: count(o.queueDepth),
    trackedBuckets: count(o.trackedBuckets),
    trackedRoutes: count(o.trackedRoutes),
    activeQueues: count(o.activeQueues),
    forbiddenEntries: count(o.forbiddenEntries),
    forbiddenBlocks: count(o.forbiddenBlocks),
    breakerBlocks: count(o.breakerBlocks),
    queueFullBlocks: count(o.queueFullBlocks),
  };
}

/**
 * The pushed breaker state if it is one of the three known ones, else null. Null
 * renders as NO claim (all three one-hot series 0), the same shape staleness
 * takes: a corrupted state field must never render an affirmative "closed" for a
 * breaker that may in fact be open.
 */
function botBreakerState(value: unknown): DiscordBotBreakerState | null {
  return DISCORD_BOT_BREAKER_STATES.find((state) => state === value) ?? null;
}

function sanitizeVoiceMember(m: unknown): {
  id: string;
  name: string;
  speaking: boolean;
  selfMute: boolean;
} {
  const o = m && typeof m === 'object' ? (m as Record<string, unknown>) : {};
  return {
    id: typeof o.id === 'string' ? o.id.slice(0, 32) : '',
    name: typeof o.name === 'string' ? o.name.slice(0, 48) : '',
    speaking: o.speaking === true,
    selfMute: o.selfMute === true,
  };
}

// ── Route table ────────────────────────────
// Every live handleInternalApi endpoint as a RouteDef for the shared dispatcher,
// plus flex-batch and outbox, which are RouteDef-ONLY (born after the migration,
// so they have no legacy ladder arm by design and nothing below to keep in
// lockstep): the deploy-gated restart-countdown plus the Discord-bot-gated
// routes (flaired-ids was added after the migration on BOTH arms per the
// dual-edit rule). The three per-endpoint GET pickups the outbox replaced
// (relay, activity, daily-rewards-winners) were RETIRED from BOTH arms in the
// same change (#2791), so both dispatch modes answer their legacy terminal 404.
// PARITY-FIRST: each thin handler REPRODUCES its frozen
// legacy branch above byte-for-byte (same imported data cores, same clamps and
// truncations, same ok()/fail() envelope bodies), and the secret gates move to
// the requireInternalSecret middleware, which writes the SAME legacy bodies
// (feature-off 404 'unknown endpoint', mismatch 401 'not authenticated'). The
// legacy handleInternalApi ladder stays intact as the flag-off rollback path
// (and as the dispatcher's delegate for unknown paths, wrong methods, and
// HEAD, which therefore keep the legacy 404 'unknown endpoint' behavior: the
// wrong-method restart-countdown stays 404, never the table router's 405).
//
// The separate /internal/daily-rewards/* ops family (handleDailyRewardInternalApi,
// server/daily_rewards.ts) was never part of this ladder and stays entirely on
// the delegate, unchanged.
//
// The one divergence is an UNEXPECTED handler/DB throw
// (internalBodyValidationRemap, tests/server/http/known_deviations.ts): the
// legacy ladder has NO outer catch (a throw becomes an unhandled rejection in
// main.ts's fire-and-forget arm and the request hangs), while the new path's
// withErrors serializes it through the admin-shape serializer as 500
// { success: false, data: null, error: 'internal.error' }. The internal
// envelope IS the admin { success, data, error } shape, so the routes carry
// meta.envelope 'admin' (EnvelopeKind is a frozen server/http/types.ts contract
// with no separate 'internal' member; serializeAdmin already emits this exact shape).

// The game-loop side effect the restart-countdown handler needs, injected at
// boot by main.ts (configureInternalRuntime(game)) so this module never
// imports the live GameServer instance.
export type InternalRuntime = Pick<GameServer, 'startRestartCountdown'>;

let internalRuntime: InternalRuntime | null = null;

export function configureInternalRuntime(runtime: InternalRuntime): void {
  internalRuntime = runtime;
}

/** Clear the injected runtime so a unit test can install its own fake. */
export function resetInternalRuntimeForTests(): void {
  internalRuntime = null;
  wocMarketOps = null;
  wocMarketStuckRead = null;
}

/**
 * The market's operator surface, injected at boot like the runtime above:
 * the two ops reads plus the parked-review resolution arm (the one operator
 * WRITE this surface carries; it rides the service's own kill-switch gate).
 *
 * Injected rather than imported: reaching woc_market_routes from here drags
 * admin.ts and account.ts in behind it, and this module is loaded by tests that
 * mock server/db down to a bare pool token. A type-only import costs nothing at
 * runtime and keeps that graph flat.
 */
type WocMarketOps = Pick<
  WocMarketService,
  'opsListings' | 'opsP2pTrades' | 'adminResolveReviewSettlement'
>;

let wocMarketOps: WocMarketOps | null = null;

export function configureInternalWocMarketOps(ops: WocMarketOps): void {
  wocMarketOps = ops;
}

/** The stuck-custody readout behind GET /internal/woc-market/stuck, injected
 *  as a thunk over the monitor's CACHED read (server/woc_market_monitor.ts):
 *  this surface must never learn about the db or grow a per-request query. */
let wocMarketStuckRead: (() => Promise<WocStuckCustodyReadout>) | null = null;

export function configureInternalWocMarketStuckRead(
  read: () => Promise<WocStuckCustodyReadout>,
): void {
  wocMarketStuckRead = read;
}

/** The injected runtime, or a loud failure if a request somehow beat boot wiring. */
function useInternalRuntime(): InternalRuntime {
  if (internalRuntime === null) {
    throw new Error('internal runtime is not configured; call configureInternalRuntime');
  }
  return internalRuntime;
}

const INTERNAL_META: RouteMeta = { envelope: 'admin' };

// One gate instance per (header, env var) pair, shared across the routes that
// carry it, mirroring the two legacy gate blocks exactly.
const deployGate = requireInternalSecret({
  header: DEPLOY_SECRET_HEADER,
  envVar: DEPLOY_SECRET_ENV,
});
/** The dashboard's own gate: its own secret and header, so revoking the
 *  dashboard's access never touches the Discord bot's. */
const dashboardGate = requireInternalSecret({
  header: DASHBOARD_SECRET_HEADER,
  envVar: DASHBOARD_SECRET_ENV,
});

const discordGate = requireInternalSecret({
  header: DISCORD_SECRET_HEADER,
  envVar: DISCORD_SECRET_ENV,
});

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/internal/woc-market/listings',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [dashboardGate],
    handler: opsListingsHandler,
  },
  {
    method: 'GET',
    path: '/internal/woc-market/p2p-trades',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [dashboardGate],
    handler: opsP2pTradesHandler,
  },
  {
    // Operator semantics per class: unbookedClaims / stuckDelivering /
    // undisposedListings follow the parked-delivery runbook (never delete a
    // claim row; confirm what the buyer holds before hand-delivering).
    // reviewSettlements are over-aged 'confirming' rows the sweep parked
    // (fail_reason confirming_overdue): verify the payment reference on chain
    // with the service release tooling, then drive the resolution through
    // POST /internal/woc-market/settlements/:id/resolve below, review ->
    // confirmed (paid: delivery resumes) or review -> failed (unpaid: the
    // overdue default pass takes over). Hand SQL stays FORBIDDEN (it
    // bypasses the transition CAS the resolve route rides). stuckBonds are
    // paid-but-undecided bid bonds past the same bound: still polled, no
    // automatic void (the money may have landed); verify the signature by
    // hand and resolve through the same tooling.
    method: 'GET',
    path: '/internal/woc-market/stuck',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [dashboardGate],
    handler: opsStuckHandler,
  },
  {
    // The parked-review operator arm (the runbook's pre-enable gate): rules a
    // settlement the sweep parked in 'review' as paid or unpaid, through the
    // same transition CAS every other state move rides. Dashboard-secret
    // gated beside the stuck readout it acts on; the service's kill switch
    // freezes it with the other operator writes.
    method: 'POST',
    path: '/internal/woc-market/settlements/:id/resolve',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [dashboardGate],
    handler: opsResolveSettlementHandler,
  },
  {
    method: 'POST',
    path: '/internal/restart-countdown',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [deployGate],
    handler: async (ctx) => {
      const status = useInternalRuntime().startRestartCountdown();
      if (!status.started) {
        return fail(ctx.res, 409, 'restart countdown already active', status);
      }
      return ok(ctx.res, status);
    },
  },
  {
    method: 'GET',
    path: '/internal/discord/flex',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [discordGate],
    handler: async (ctx) => {
      const discordUserId = ctx.url.searchParams.get('discord_user_id') ?? '';
      const accountId = await accountForDiscord(pool, discordUserId);
      if (accountId === null) return ok(ctx.res, { linked: false });
      return ok(ctx.res, { linked: true, ...(await discordFlexForAccount(accountId)) });
    },
  },
  {
    method: 'GET',
    path: '/internal/discord/roles',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [discordGate],
    handler: async (ctx) => {
      const discordUserId = ctx.url.searchParams.get('discord_user_id') ?? '';
      const accountId = await accountForDiscord(pool, discordUserId);
      if (accountId === null) return ok(ctx.res, { linked: false, statusTier: 0, points: 0 });
      const reward = await loadRewardState(pool, accountId);
      return ok(ctx.res, {
        linked: true,
        statusTier: discordStatusIndexForPoints(reward.lifetimePoints),
        points: reward.points,
        lifetimePoints: reward.lifetimePoints,
      });
    },
  },
  {
    method: 'POST',
    path: '/internal/discord/presence',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [discordGate],
    handler: async (ctx) => {
      const body = await readBody(ctx.req).catch(() => ({}) as Record<string, unknown>);
      const onlineCount = clampInt(body.onlineCount, 0, 1_000_000);
      const memberTotal = clampInt(body.memberTotal, 0, 100_000_000);
      const voiceChannelName =
        typeof body.voiceChannelName === 'string' ? body.voiceChannelName.slice(0, 80) : null;
      const voice = Array.isArray(body.voice)
        ? body.voice.slice(0, 50).map((m: unknown) => sanitizeVoiceMember(m))
        : [];
      setDiscordPresenceCache({ onlineCount, memberTotal, voiceChannelName, voice });
      // The bot's own rate-limit/breaker counters ride the same push. Absent (an
      // older bot) leaves the counters cache alone; present, it never affects the
      // presence fields above or the response.
      const botCounters = sanitizeBotCounters(body.counters);
      if (botCounters) setDiscordBotCounters(botCounters, Date.now());
      return ok(ctx.res, { received: true });
    },
  },
  {
    method: 'POST',
    path: '/internal/discord/grant',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [discordGate],
    handler: async (ctx) => {
      const body = await readBody(ctx.req).catch(() => ({}) as Record<string, unknown>);
      const discordUserId = typeof body.discord_user_id === 'string' ? body.discord_user_id : '';
      const reason = typeof body.reason === 'string' ? body.reason.slice(0, 64) : '';
      const points = clampInt(body.points, -100_000, 100_000);
      const dedupeKey = typeof body.dedupeKey === 'string' ? body.dedupeKey.slice(0, 128) : null;
      if (!reason || points === 0) {
        return fail(ctx.res, 400, 'reason and non-zero points required');
      }
      const accountId = await accountForDiscord(pool, discordUserId);
      if (accountId === null) return fail(ctx.res, 404, 'discord id not linked');
      const state = await grantRewardPoints(pool, accountId, points, reason, dedupeKey);
      return ok(ctx.res, {
        points: state.points,
        lifetimePoints: state.lifetimePoints,
        statusTier: discordStatusIndexForPoints(state.lifetimePoints),
      });
    },
  },
  {
    method: 'POST',
    path: '/internal/discord/member',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [discordGate],
    handler: async (ctx) => {
      const body = await readBody(ctx.req).catch(() => ({}) as Record<string, unknown>);
      const discordUserId = typeof body.discord_user_id === 'string' ? body.discord_user_id : '';
      const guildMember = body.guildMember === true;
      const accountId = await accountForDiscord(pool, discordUserId);
      if (accountId === null) return fail(ctx.res, 404, 'discord id not linked');
      await setDiscordGuildMember(pool, accountId, guildMember);
      if (guildMember) {
        const g = DISCORD_REWARD_GRANTS.guildMember;
        await grantRewardPoints(pool, accountId, g.points, g.reason, `${g.reason}:${accountId}`);
      }
      return ok(ctx.res, { updated: true });
    },
  },
  {
    method: 'POST',
    path: '/internal/discord/daily-rewards-winners/mark',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [discordGate],
    handler: async (ctx) => {
      const result = await dailyRewardService.markDiscordWinnersAnnounced(
        await readBody(ctx.req).catch(() => ({})),
      );
      if ('error' in result) return fail(ctx.res, result.status, result.error);
      return ok(ctx.res, result);
    },
  },
  {
    method: 'POST',
    path: '/internal/discord/members-meta',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [discordGate],
    handler: async (ctx) => {
      const body = await readBody(ctx.req).catch(() => ({}) as Record<string, unknown>);
      return ok(ctx.res, await applyMemberMetaPush(body));
    },
  },
  {
    method: 'POST',
    path: '/internal/discord/flex-batch',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [discordGate],
    handler: flexBatchHandler,
  },
  {
    method: 'GET',
    path: '/internal/discord/outbox',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [discordGate],
    handler: outboxHandler,
  },
  {
    method: 'GET',
    path: '/internal/discord/flaired-ids',
    surface: 'internal',
    meta: INTERNAL_META,
    middleware: [discordGate],
    handler: async (ctx) => {
      return ok(ctx.res, { ids: await discordIdsWithGuildFlair(pool) });
    },
  },
];
