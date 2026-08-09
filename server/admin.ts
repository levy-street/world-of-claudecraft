import type * as http from 'node:http';
import { verifyLoginTwoFactor } from './account';
import { parseAdminAccountSort } from './admin_accounts_sort';
import {
  ACTIVITY_WINDOW_DAYS,
  classDistribution,
  levelDistribution,
  registrationsByDay,
  sessionsByDay,
} from './admin_activity_cache';
import {
  accountDetail,
  associationsForIp,
  characterProfessionsRow,
  clientPerfRaw,
  clientPerfSummary,
  dailyRewardPointEvents,
  listAccounts,
  listCharacters,
  listModerationActions,
  listSharedIps,
  onlineHistory,
} from './admin_db';
import type { AdminGuildBankView } from './admin_guild_bank_view';
import {
  ADMIN_GUILD_REASON_MAX,
  type AdminGuildRenameError,
  adminGuildDetail,
  listAdminGuildHistory,
  listAdminGuilds,
  recordAdminGuildBankPurge,
  renameAdminGuild,
} from './admin_guilds_db';
import {
  AdminGuildListBusyError,
  type AdminGuildListRequest,
  readAdminGuildList,
} from './admin_guilds_read';
import { parseAdminGuildSort } from './admin_guilds_sort';
import { cleanIpAssociationLookup } from './admin_ip_association';
import { readOverviewCounts } from './admin_overview_cache';
import {
  type AdminPermission,
  ASSIGNABLE_ADMIN_ROLES,
  permissionsForRoles,
  SUPERADMIN_ROLE,
  sanitizeRoles,
} from './admin_permissions';
import { adminPathKnown, permissionForAdminRoute } from './admin_routes';
import {
  listAntibotConfigHistory,
  loadAntibotConfig,
  saveAntibotConfigChange,
} from './antibot_config_db';
import {
  hashPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  newToken,
  verifyPassword,
} from './auth';
import {
  type BugReportResolution,
  getBugReportScreenshot,
  listBugReports,
  resolveBugReport,
} from './bug_report_db';
import {
  characterProfessionsSheetFromRow,
  restoreItemBodyError,
  restoreSlotBodyError,
} from './character_professions';
import {
  addFilterWord,
  chatModeratedAccounts,
  chatModerationForAccount,
  getFilterConfig,
  listFilterWords,
  removeFilterWord,
  updateFilterConfig,
  type WordTier,
} from './chat_filter_db';
import { cleanContentModerationReason } from './content_moderation_db';
import { currentDailyRewardDay } from './daily_rewards';
import {
  accountAndScopeForToken,
  accountById,
  accountMailTarget,
  findAccount,
  isAdminAccount,
  loadAccountFlair,
  pool,
  revokeTokensExcept,
  saveToken,
  touchLogin,
  updatePasswordHash,
} from './db';
import { emailSecurityIncident } from './email';
import type { GameServer } from './game';
import { ctxAccountId } from './http/context';
import { logger } from './http/logger';
import {
  ADMIN_META,
  type AdminAuthDb,
  adminIdentityOf,
  adminTargetId,
  adminTargetMeta,
  createRequireAdmin,
  requireAdminTarget,
} from './http/middleware/require_admin';
import { enum_ } from './http/schema';
import type { Ctx, RouteDef } from './http/types';
import { json, readBody } from './http_util';
import { addBlockedIp, cleanIp, listBlockedIps, removeBlockedIp } from './ip_block_db';
import { PgMapsDb } from './maps_db';
import {
  addAccountNote,
  forceCharacterRename,
  ignoreReport,
  liftAccountChatMute,
  moderateAccount,
  moderationReportsForAccount,
  muteAccountChat,
  reactivateAccountAudited,
  recordPasswordReset,
  recordProfessionsRestore,
  resetChatStrikesAudited,
  setAccountAiFlag,
  setAccountStreamerFlair,
  setDailyRewardsBan,
  setDailyRewardsIpBan,
} from './moderation_db';
import { readModerationQueue } from './moderation_queue_cache';
import { providerUsageSnapshot } from './provider_usage';
import { authThrottled, clearAuthFailures, rateLimited, recordAuthFailure } from './ratelimit';
import { REALM } from './realm';
import {
  adminRolesForAccount,
  listStaff,
  roleChangeHistory,
  setAccountAdminRoles,
} from './staff_db';
import {
  type UnstuckHotspotRow as DbUnstuckHotspotRow,
  type UnstuckReportPage as DbUnstuckReportPage,
  type UnstuckReportRow as DbUnstuckReportRow,
  listUnstuckHotspots as listUnstuckHotspotsDb,
  listUnstuckReports as listUnstuckReportsDb,
  UNSTUCK_HOTSPOT_MAX_LIMIT,
  UNSTUCK_REPORT_MAX_DAYS,
  UNSTUCK_REPORT_MAX_LIMIT,
} from './unstuck_db';
import { PgUserAssetsDb } from './user_assets_db';

// Admin API: everything under /admin/api/*. Auth is an exact full-scope bearer
// token whose account has at least one staff role (accounts.admin_roles;
// is_admin stays the derived "is staff" flag): the admin.* hostname is routing,
// not security.
// Authorization is per route: every route is declared with a permission in
// admin_routes.ts and gated centrally in handleAdminApi before any handler
// runs, so a route absent from that table can never execute.

const ADMIN_LOGIN_MAX_PER_MINUTE = 10;
// Per-account brute-force throttle, mirroring server/auth_routes.ts loginHandler
// (#93): the per-IP ceiling above cannot stop a distributed attacker who spreads
// guesses for one admin username across many source IPs, so admin login also gates
// on authThrottled/recordAuthFailure/clearAuthFailures (server/ratelimit.ts), keyed
// by username exactly like the player /api/login guard. The message matches a
// bad-password response so it never reveals whether the account exists.
const ADMIN_LOGIN_TOO_MANY_FAILED_ATTEMPTS =
  'too many failed attempts, wait a few minutes and try again';
// Second factor, mirroring server/auth_routes.ts loginHandler exactly: an account
// with TOTP enabled (account.totp_enabled_at) must supply a live code or a recovery
// code before a token is minted. Without one, the response is a 200 CHALLENGE (never
// a token), so the client shows the code step; with a wrong one it is a 401 that also
// counts against the same per-account throttle as a bad password.
const ADMIN_LOGIN_INVALID_TWO_FACTOR_CODE = 'invalid authentication code';
const MAX_PAGE_LIMIT = 200;
const DEFAULT_PAGE_LIMIT = 25;
const ANTIBOT_CONFIG_NOTE_MAX = 500;
const UNSTUCK_DEFAULT_DAYS = 30;
const UNSTUCK_DEFAULT_LIMIT = 50;

const IP_BLOCK_KICK_MESSAGE = 'Connection to the server was lost.';

// Account-flair validation messages. Named constants so the two dispatch twins (the
// legacy handleAdminApi arm and the RouteDef handler) can never drift, and so the
// dashboard has a stable string to map onto its own i18n key. `invalid streamer
// link` is raised by moderation_db.setAccountStreamerFlair and surfaces through the
// same err.message path every other admin write uses.
const AI_FLAG_REQUIRED = 'ai must be a boolean';
const STREAMER_FLAG_REQUIRED = 'streamer must be a boolean';
const STREAMER_LINKS_REQUIRED = 'a links object is required';
const ACCOUNT_FLAIR_FAILED = 'failed to update account flair';
const DAILY_REWARD_EVENT_DAY_REQUIRED = 'a valid daily rewards date is required';
// The guild bank dormant-slot purge refusals. Shared by both dispatch arms so
// the strings stay byte-identical, and mirrored into the dashboard's
// ADMIN_ERROR_KEYS matcher (src/admin/i18n.ts) like every other operator error.
const GUILD_BANK_SLOT_REQUIRED = 'a slot index is required';
const GUILD_BANK_ITEM_REQUIRED = 'the item id in that slot is required';
const GUILD_BANK_REASON_REQUIRED = 'a moderation reason is required (500 chars max)';
const GUILD_BANK_NOT_LOADED = 'that guild has no loaded bank';
const GUILD_BANK_NO_CARRIER = 'no member of that guild is online to persist the change';
const GUILD_BANK_SLOT_NOT_DORMANT = 'that slot is not a stuck item';
const GUILD_BANK_SAVE_FAILED = 'the change could not be saved and was rolled back';
// The guild-delete window. Deliberately NOT the save_failed line: nothing was
// attempted, so nothing was saved and nothing was rolled back, and the
// instruction is the opposite one (the bank is going away with the guild, so
// there is nothing to retry).
const GUILD_BANK_DELETING = 'that guild is being deleted, so its bank is closed';
const GUILD_BANK_PURGE_REFUSED = 'the guild bank change was refused';

function guildRenameFailure(error: AdminGuildRenameError): { status: number; message: string } {
  switch (error) {
    case 'not_found':
      return { status: 404, message: 'guild not found' };
    case 'name_taken':
      return { status: 409, message: 'guild name is already taken' };
    case 'same_name':
      return { status: 400, message: 'guild name must change' };
    case 'invalid_reason':
      return { status: 400, message: 'a moderation reason is required (500 chars max)' };
    case 'member_limit_exceeded':
      return { status: 409, message: 'guild member limit exceeded' };
    case 'invalid_name':
      return { status: 400, message: 'guild name must be 3-24 letters with single spaces' };
  }
}

/** The guild bank operator READ, resolved ONCE for both dispatch arms (the
 *  dual-edit rule), exactly like the purge below it.
 *
 *  It exists because the purge is unusable without it: that call names a slot
 *  INDEX and the itemId at it, and until this landed an operator had to dig
 *  both out of `guild_banks` with SQL. Reads the live book through the same
 *  ungated snapshot the purge mutates through, so the listing an operator acts
 *  on and the refusal they may get back cannot disagree.
 *
 *  A missing book reuses the purge's own 404 line rather than minting a second
 *  one: it is the same fact ("that guild has no loaded bank"), and the dashboard
 *  already localizes it (error.guildBankNotLoaded). */
function guildBankStateOutcome(
  rt: Pick<AdminRuntime, 'adminGuildBankState'>,
  guildId: number,
):
  | { ok: true; body: { guildId: number } & AdminGuildBankView }
  | { ok: false; status: number; message: string } {
  const state = rt.adminGuildBankState(guildId);
  if (!state) return { ok: false, status: 404, message: GUILD_BANK_NOT_LOADED };
  return { ok: true, body: { guildId, ...state } };
}

/** The guild bank dormant-slot purge, resolved ONCE for both dispatch arms so
 *  the legacy ladder and the RouteDef handler can never drift (the dual-edit
 *  rule). Shape validation, the game call, the audited moderation row, and the
 *  outcome-to-response mapping all live here; each arm only reads the body,
 *  supplies the acting operator, and writes the envelope.
 *
 *  Three operator inputs, all required: the slot INDEX, the itemId that index
 *  is believed to hold (a confirmation token, because a purge shifts every
 *  higher index down by one), and a moderation REASON, held to the same bar as
 *  the strictly less destructive guild rename beside it. */
async function purgeGuildBankSlotOutcome(
  rt: Pick<AdminRuntime, 'adminPurgeGuildBankSlot'>,
  guildId: number,
  actorAccountId: number,
  body: { slot?: unknown; itemId?: unknown; reason?: unknown },
): Promise<
  | {
      ok: true;
      body: {
        guildId: number;
        slotIndex: number;
        itemId: string;
        count: number;
        audited: boolean;
      };
    }
  | { ok: false; status: number; message: string }
> {
  const rawSlot = body.slot;
  if (typeof rawSlot !== 'number' || !Number.isInteger(rawSlot) || rawSlot < 0) {
    return { ok: false, status: 400, message: GUILD_BANK_SLOT_REQUIRED };
  }
  const expectItemId = typeof body.itemId === 'string' ? body.itemId.trim() : '';
  if (!expectItemId) return { ok: false, status: 400, message: GUILD_BANK_ITEM_REQUIRED };
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason || reason.length > ADMIN_GUILD_REASON_MAX) {
    return { ok: false, status: 400, message: GUILD_BANK_REASON_REQUIRED };
  }
  const result = await rt.adminPurgeGuildBankSlot(guildId, rawSlot, expectItemId, actorAccountId);
  if (!result.ok) {
    switch (result.reason) {
      case 'no_book':
        return { ok: false, status: 404, message: GUILD_BANK_NOT_LOADED };
      case 'no_carrier':
        return { ok: false, status: 409, message: GUILD_BANK_NO_CARRIER };
      case 'not_dormant':
        return { ok: false, status: 400, message: GUILD_BANK_SLOT_NOT_DORMANT };
      case 'save_failed':
        return { ok: false, status: 503, message: GUILD_BANK_SAVE_FAILED };
      case 'delete_in_flight':
        // 409, not 503: this is a state conflict with a delete that is already
        // in flight, not a transient failure the operator should retry into.
        return { ok: false, status: 409, message: GUILD_BANK_DELETING };
    }
    // Fail closed: a refusal reason added later must never fall through into
    // the success return below (which would read `removed` off a refusal).
    return { ok: false, status: 500, message: GUILD_BANK_PURGE_REFUSED };
  }
  // The audited moderation row (the rename precedent): who, why, and when, on
  // the same history surface an operator already reads. Written AFTER the
  // removal proved durable, so a reverted purge is never logged as done. A
  // failed insert cannot un-remove the item, so it is reported, not thrown:
  // the ledger row is already the machine-readable evidence.
  let audited = true;
  try {
    await adminDb().recordAdminGuildBankPurge({
      guildId,
      reason,
      adminAccountId: actorAccountId,
      itemId: result.removed.itemId,
      count: result.removed.count,
      slotIndex: rawSlot,
    });
  } catch (err) {
    audited = false;
    console.error(`guild bank purge audit row failed for guild ${guildId}:`, err);
  }
  return {
    ok: true,
    body: {
      guildId,
      slotIndex: rawSlot,
      itemId: result.removed.itemId,
      count: result.removed.count,
      audited,
    },
  };
}

async function dailyRewardEventDay(value: string | null): Promise<string | null> {
  if (value === null) return currentDailyRewardDay();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function boundedPositiveParam(raw: string | null, fallback: number, max: number): number {
  const value = Number(raw ?? fallback);
  return Number.isFinite(value) ? Math.min(max, Math.max(1, Math.floor(value))) : fallback;
}

function unstuckQuery(params: URLSearchParams): {
  days: number;
  limit: number;
  beforeId?: number;
} {
  const days = boundedPositiveParam(
    params.get('days'),
    UNSTUCK_DEFAULT_DAYS,
    UNSTUCK_REPORT_MAX_DAYS,
  );
  const limit = boundedPositiveParam(
    params.get('limit'),
    UNSTUCK_DEFAULT_LIMIT,
    UNSTUCK_REPORT_MAX_LIMIT,
  );
  const rawBeforeId = Number(params.get('beforeId'));
  return {
    days,
    limit,
    ...(Number.isSafeInteger(rawBeforeId) && rawBeforeId > 0 ? { beforeId: rawBeforeId } : {}),
  };
}

function adminUnstuckReport(row: DbUnstuckReportRow): unknown {
  const destination =
    row.destinationRawX === null ||
    row.destinationRawY === null ||
    row.destinationRawZ === null ||
    row.destinationLocalX === null ||
    row.destinationLocalZ === null
      ? null
      : {
          x: row.destinationRawX,
          y: row.destinationRawY,
          z: row.destinationRawZ,
          localX: row.destinationLocalX,
          localY: row.destinationLocalY,
          localZ: row.destinationLocalZ,
        };
  return {
    id: row.id,
    characterId: row.characterId,
    characterName: row.characterName,
    area: {
      kind: row.areaKind,
      id: row.areaId,
      instanceId: row.instanceId,
      slot: row.instanceSlot,
    },
    origin: {
      x: row.originRawX,
      y: row.originRawY,
      z: row.originRawZ,
      localX: row.originLocalX,
      localY: row.originLocalY,
      localZ: row.originLocalZ,
    },
    destination,
    outcome: row.outcome,
    reason: row.reason,
    invokedAt: row.invokedAt,
    resolvedAt: row.resolvedAt,
  };
}

function adminUnstuckHotspot(row: DbUnstuckHotspotRow): unknown {
  return {
    area: { kind: row.areaKind, id: row.areaId, instanceId: null, slot: null },
    bucket: { x: row.bucketLocalX, y: row.bucketLocalY, z: row.bucketLocalZ },
    count: row.reportCount,
    completed: row.completedCount,
    cancelled: row.cancelledCount,
    failed: row.failedCount,
    lastUsedAt: row.lastResolvedAt,
  };
}

function adminUnstuckPayload(
  page: DbUnstuckReportPage,
  hotspots: DbUnstuckHotspotRow[],
  query: { days: number; limit: number },
): unknown {
  return {
    reports: page.rows.map(adminUnstuckReport),
    hotspots: hotspots.map(adminUnstuckHotspot),
    days: query.days,
    limit: query.limit,
    hasMore: page.hasMore,
    nextBeforeId: page.nextBeforeId,
  };
}

/**
 * Decode the request's `links` bag, three-valued:
 *  - an object: the bag REPLACES the stored links (an explicit `{}` clears them);
 *  - `undefined` (key absent): LEAVE the stored links alone. The dashboard's three
 *    streamer actions (mark / unmark / save links) all send the full bag, but a caller
 *    that sends only the flag must never wipe an account's links by omission, and
 *    unmarking a streamer deliberately keeps them (wireStreamerLinks is what stops
 *    them shipping, so stored-but-not-shipped is the correct state);
 *  - `null`: malformed (an array or a scalar), which the handler turns into a 400.
 */
function streamerLinksBody(value: unknown): Record<string, unknown> | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

// Map editor moderation reads/writes go straight to the db layer (like the
// other *_db imports here); the player-facing rules stay in maps.ts. LAZY
// memoized accessors (the liveGame()/activeConfig() shape) rather than
// module-scope construction, so a partial vi.mock of './db' that omits `pool`
// cannot hand the backends undefined at import time, and a test can override
// them via the setters below (the file's lazy AdminDb doctrine).
let adminMapsDbInstance: PgMapsDb | null = null;
function adminMapsDb(): PgMapsDb {
  adminMapsDbInstance ??= new PgMapsDb(pool);
  return adminMapsDbInstance;
}
let adminUserAssetsDbInstance: PgUserAssetsDb | null = null;
function adminUserAssetsDb(): PgUserAssetsDb {
  adminUserAssetsDbInstance ??= new PgUserAssetsDb(pool);
  return adminUserAssetsDbInstance;
}

/** Override the map editor moderation backends with fakes (test-only). */
export function setAdminMapsDbForTests(maps: PgMapsDb, userAssets: PgUserAssetsDb): void {
  adminMapsDbInstance = maps;
  adminUserAssetsDbInstance = userAssets;
}

/** Restore the real Postgres map editor moderation backends (test-only). */
export function resetAdminMapsDbForTests(): void {
  adminMapsDbInstance = null;
  adminUserAssetsDbInstance = null;
}

let antibotConfigSaveTail: Promise<void> = Promise.resolve();

function ok(res: http.ServerResponse, data: unknown): void {
  json(res, 200, { success: true, data, error: null });
}

function fail(res: http.ServerResponse, status: number, error: string): void {
  json(res, status, { success: false, data: null, error });
}

async function sendAdminGuildList(
  res: http.ServerResponse,
  request: AdminGuildListRequest,
  load: () => Promise<unknown>,
): Promise<void> {
  try {
    ok(res, await readAdminGuildList(request, load));
  } catch (err) {
    if (err instanceof AdminGuildListBusyError) {
      return fail(res, 503, 'guild list busy, try again');
    }
    throw err;
  }
}

export interface PageParams {
  page: number;
  limit: number;
}

export function parsePageParams(params: URLSearchParams): PageParams {
  const rawPage = Number(params.get('page') ?? '1');
  const rawLimit = Number(params.get('limit') ?? String(DEFAULT_PAGE_LIMIT));
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : 1;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(MAX_PAGE_LIMIT, Math.max(1, Math.floor(rawLimit)))
    : DEFAULT_PAGE_LIMIT;
  return { page, limit };
}

function cleanTier(value: unknown): WordTier | null {
  return value === 'soft' || value === 'hard' ? value : null;
}

type SharedIpSort = 'accounts' | 'last_seen';
type SharedIpSortDirection = 'asc' | 'desc';
type ModerationHistoryTab = 'all' | 'mine' | 'notes';

function sharedIpSortParams(params: URLSearchParams): {
  sort: SharedIpSort;
  dir: SharedIpSortDirection;
} {
  return {
    sort: params.get('sort') === 'last_seen' ? 'last_seen' : 'accounts',
    dir: params.get('dir') === 'asc' ? 'asc' : 'desc',
  };
}

function sortSharedIpRows<T extends { ip: string; accountCount: number; lastSeenAt: string }>(
  rows: readonly T[],
  sort: SharedIpSort,
  dir: SharedIpSortDirection,
): T[] {
  const multiplier = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const primary =
      sort === 'last_seen'
        ? a.lastSeenAt.localeCompare(b.lastSeenAt)
        : a.accountCount - b.accountCount;
    const secondary =
      sort === 'last_seen'
        ? b.accountCount - a.accountCount
        : b.lastSeenAt.localeCompare(a.lastSeenAt);
    return primary * multiplier || secondary || a.ip.localeCompare(b.ip);
  });
}

function moderationHistoryTab(params: URLSearchParams): ModerationHistoryTab {
  const tab = params.get('tab');
  return tab === 'mine' || tab === 'notes' ? tab : 'all';
}

function getBlockedIpsForAccount(
  blocker: { isIpBlocked(ip: string): boolean },
  detail: { lastLoginIp: string | null; recentSessions: { ip: string | null }[] },
): string[] {
  const ips = new Set<string>();
  if (detail.lastLoginIp) ips.add(detail.lastLoginIp);
  for (const s of detail.recentSessions) if (s.ip) ips.add(s.ip);
  return [...ips].filter((ip) => blocker.isIpBlocked(ip));
}

interface AdminIdentity {
  accountId: number;
  username: string;
  roles: string[];
  permissions: ReadonlySet<AdminPermission>;
}

// Roles are re-read on every request, so a dashboard revocation applies to the
// next call (a revoked operator's next request 401s: no roles means not staff).
async function adminIdentity(req: http.IncomingMessage): Promise<AdminIdentity | null> {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization ?? '');
  if (!m) return null;
  const account = await accountAndScopeForToken(m[1]);
  if (account === null || account.scope !== 'full') return null;
  const accountId = account.accountId;
  const staff = await adminRolesForAccount(accountId);
  if (staff === null) return null;
  return {
    accountId,
    username: staff.username,
    roles: staff.roles,
    permissions: permissionsForRoles(staff.roles),
  };
}

async function handleLogin(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!rateLimited(req, ADMIN_LOGIN_MAX_PER_MINUTE).allowed) {
    return fail(res, 429, 'too many attempts, wait a minute and try again');
  }
  const body = await readBody(req);
  const username = typeof body.username === 'string' ? body.username : '';
  if (username && !authThrottled(username).allowed) {
    return fail(res, 429, ADMIN_LOGIN_TOO_MANY_FAILED_ATTEMPTS);
  }
  const account = username ? await findAccount(username) : null;
  if (!account || !(await verifyPassword(String(body.password ?? ''), account.password_hash))) {
    if (username) recordAuthFailure(username);
    return fail(res, 401, 'invalid username or password');
  }
  const staff = await adminRolesForAccount(account.id);
  if (staff === null) {
    return fail(res, 403, 'this account does not have admin access');
  }
  if (account.totp_enabled_at) {
    const code = typeof body.code === 'string' ? body.code : '';
    const recoveryCode = typeof body.recoveryCode === 'string' ? body.recoveryCode : '';
    if (!code && !recoveryCode) {
      return ok(res, { twoFactorRequired: true });
    }
    if (!(await verifyLoginTwoFactor(account, code, recoveryCode))) {
      recordAuthFailure(username);
      return fail(res, 401, ADMIN_LOGIN_INVALID_TWO_FACTOR_CODE);
    }
  }
  clearAuthFailures(username);
  await touchLogin(account.id);
  const token = newToken();
  await saveToken(token, account.id);
  ok(res, {
    token,
    username: account.username,
    roles: staff.roles,
    permissions: [...permissionsForRoles(staff.roles)],
  });
}

// Bot-detector config: the body's override document is validated and applied
// LIVE by the detector; validation or persistence failure re-applies the previous
// effective document. The current override set and its before/after audit row are
// committed atomically, then the saved overrides are replayed at the next boot.
async function handleAntibotConfigSave(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  game: GameServer,
  adminId: number,
): Promise<void> {
  const body = await readBody(req);
  const overrides = body.overrides;
  if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) {
    return fail(res, 400, 'an overrides object is required');
  }
  const note =
    typeof body.note === 'string' ? body.note.trim().slice(0, ANTIBOT_CONFIG_NOTE_MAX) : '';
  return serializeAntibotConfigSave(async () => {
    const previousEffective = effectiveAntibotOverrides(game);
    const result = game.applyAntibotConfig(overrides as Record<string, unknown>);
    if (result.errors.length > 0) {
      game.applyAntibotConfig(previousEffective);
      return fail(res, 400, result.errors.join('; '));
    }
    const effective = effectiveAntibotOverrides(game);
    try {
      const saved = await saveAntibotConfigChange(effective, adminId, note);
      ok(res, { fields: game.antibotConfigFields(), updatedAt: saved.updatedAt });
    } catch (err) {
      game.applyAntibotConfig(previousEffective);
      throw err;
    }
  });
}

function serializeAntibotConfigSave(run: () => Promise<void>): Promise<void> {
  const pending = antibotConfigSaveTail.then(run, run);
  antibotConfigSaveTail = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

// Typed as the Pick so the migrated antibot save handler can pass the injected
// AdminRuntime; the legacy caller's full GameServer is assignable to it.
function effectiveAntibotOverrides(
  game: Pick<GameServer, 'antibotConfigFields'>,
): Record<string, unknown> {
  const effective: Record<string, unknown> = {};
  for (const field of game.antibotConfigFields()) {
    if (!configValueEquals(field.value, field.defaultValue)) effective[field.id] = field.value;
  }
  return effective;
}

function configValueEquals(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((entry) => b.includes(entry));
  }
  return a === b;
}

export async function handleAdminApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  game: GameServer,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  try {
    if (req.method === 'POST' && path === '/admin/api/login') {
      return await handleLogin(req, res);
    }

    const identity = await adminIdentity(req);
    if (identity === null) return fail(res, 401, 'admin authentication required');
    const accountId = identity.accountId;

    // Central authorization gate: resolve the route's declared permission
    // before any handler runs. Fail closed on unmapped routes.
    if (req.method !== 'GET' && req.method !== 'POST') {
      return fail(res, 405, 'method not allowed');
    }
    const routePermission = permissionForAdminRoute(req.method, path);
    if (routePermission === null) {
      return adminPathKnown(path)
        ? fail(res, 405, 'method not allowed')
        : fail(res, 404, 'unknown admin endpoint');
    }
    if (routePermission !== 'any' && !identity.permissions.has(routePermission)) {
      return fail(res, 403, 'you do not have permission to do this');
    }

    if (req.method === 'GET' && path === '/admin/api/me') {
      return ok(res, {
        username: identity.username,
        roles: identity.roles,
        permissions: [...identity.permissions],
      });
    }

    // Staff role management. superadmin is out of the dashboard's reach in
    // both directions (grant and revoke): it moves only via the grant script
    // or SQL, so a compromised dashboard session cannot mint one. Own-account
    // edits are refused so an operator cannot lock themselves out silently.
    if (req.method === 'GET' && path === '/admin/api/staff') {
      return ok(res, { rows: await listStaff(), assignableRoles: [...ASSIGNABLE_ADMIN_ROLES] });
    }
    if (req.method === 'GET' && path === '/admin/api/staff/history') {
      return ok(res, { rows: await roleChangeHistory(50) });
    }
    if (req.method === 'POST' && path === '/admin/api/staff/roles') {
      const body = await readBody(req);
      const roles = sanitizeRoles(body.roles);
      if (roles === null) return fail(res, 400, 'unknown role');
      if (roles.includes(SUPERADMIN_ROLE)) {
        return fail(res, 400, 'superadmin roles are managed via the grant script');
      }
      const target = typeof body.username === 'string' ? await findAccount(body.username) : null;
      if (!target) return fail(res, 404, 'account not found');
      if (target.id === accountId) {
        return fail(res, 400, 'you cannot change your own roles');
      }
      const currentStaff = await adminRolesForAccount(target.id);
      if (currentStaff?.roles.includes(SUPERADMIN_ROLE)) {
        return fail(res, 400, 'superadmin roles are managed via the grant script');
      }
      const change = await setAccountAdminRoles({
        accountId: target.id,
        roles,
        actorAccountId: accountId,
      });
      if (!change) return fail(res, 404, 'account not found');
      // In-game permissions are snapshotted at WS join, so force the account's
      // live sessions to reconnect: a revoked moderator loses in-game commands
      // immediately instead of at their next voluntary relog.
      if (change.before.join(',') !== change.after.join(',')) {
        game.disconnectAccount(target.id, IP_BLOCK_KICK_MESSAGE);
      }
      return ok(res, { ok: true, username: target.username, roles: change.after });
    }

    const actionMatch =
      /^\/admin\/api\/moderation\/accounts\/(\d+)\/(suspend|unsuspend|ban|unban)$/.exec(path);
    if (req.method === 'POST' && actionMatch) {
      const targetAccountId = Number(actionMatch[1]);
      const action = actionMatch[2] as 'suspend' | 'unsuspend' | 'ban' | 'unban';
      if ((action === 'suspend' || action === 'ban') && (await isAdminAccount(targetAccountId))) {
        return fail(res, 400, 'admin accounts cannot be suspended or banned');
      }
      const body = await readBody(req);
      try {
        await moderateAccount({
          accountId: targetAccountId,
          adminAccountId: accountId,
          action,
          reason: body.reason,
          expiresAt: body.expiresAt,
        });
        if (action === 'suspend' || action === 'ban') {
          const statusText =
            action === 'ban' ? 'This account has been banned.' : 'This account is suspended.';
          // Every device is signed out here too, mirroring the reset-password arm
          // above: revoke all tokens then disconnect the live socket (revocation
          // alone leaves an already-open connection intact). Otherwise a token
          // issued before the sanction stays valid in auth_tokens and regains
          // access with no re-authentication once the sanction is lifted or expires.
          await revokeTokensExcept(targetAccountId, null);
          game.disconnectAccount(targetAccountId, statusText);
          // Notify the affected account of the moderation action. Best-effort and
          // fully isolated: a mail-target lookup or send failure must never turn a
          // successful moderation action into an error response.
          void accountMailTarget(targetAccountId)
            .then((target) => {
              if (!target) return;
              const reasonText =
                typeof body.reason === 'string' && body.reason.trim()
                  ? body.reason.trim()
                  : 'not specified';
              const until =
                action === 'ban'
                  ? 'permanent'
                  : typeof body.expiresAt === 'string' && body.expiresAt
                    ? body.expiresAt
                    : 'until reviewed';
              emailSecurityIncident(target, action, reasonText, until);
            })
            .catch((err) => logger.error({ err }, 'security-incident email failed'));
        }
        return ok(res, { ok: true });
      } catch (err) {
        return fail(res, 400, err instanceof Error ? err.message : 'moderation action failed');
      }
    }
    // Reverse a player's self-service deactivation (admin-only).
    const reactivateMatch = /^\/admin\/api\/moderation\/accounts\/(\d+)\/reactivate$/.exec(path);
    if (req.method === 'POST' && reactivateMatch) {
      const targetAccountId = Number(reactivateMatch[1]);
      const body = await readBody(req);
      try {
        await reactivateAccountAudited({
          accountId: targetAccountId,
          adminAccountId: accountId,
          reason: body.reason,
        });
        return ok(res, { ok: true });
      } catch (err) {
        return fail(res, 400, err instanceof Error ? err.message : 'reactivation failed');
      }
    }
    const chatMuteMatch = /^\/admin\/api\/moderation\/accounts\/(\d+)\/chat-mute$/.exec(path);
    if (req.method === 'POST' && chatMuteMatch) {
      const targetAccountId = Number(chatMuteMatch[1]);
      if (await isAdminAccount(targetAccountId)) {
        return fail(res, 400, 'admin accounts cannot be chat muted');
      }
      const body = await readBody(req);
      try {
        await muteAccountChat({
          accountId: targetAccountId,
          adminAccountId: accountId,
          reason: body.reason,
          expiresAt: body.expiresAt,
        });
        game.muteAccountChat(
          targetAccountId,
          String(body.expiresAt ?? ''),
          String(body.reason ?? ''),
        );
        return ok(res, { ok: true });
      } catch (err) {
        return fail(res, 400, err instanceof Error ? err.message : 'chat mute failed');
      }
    }
    const dailyRewardsBanMatch =
      /^\/admin\/api\/moderation\/accounts\/(\d+)\/daily-rewards-(ban|unban)$/.exec(path);
    if (req.method === 'POST' && dailyRewardsBanMatch) {
      const body = await readBody(req);
      try {
        await setDailyRewardsBan({
          accountId: Number(dailyRewardsBanMatch[1]),
          adminAccountId: accountId,
          banned: dailyRewardsBanMatch[2] === 'ban',
          reason: body.reason,
          durationHours: body.durationHours,
        });
        return ok(res, { ok: true });
      } catch (err) {
        return fail(
          res,
          400,
          err instanceof Error ? err.message : 'daily rewards moderation failed',
        );
      }
    }
    const dailyRewardsIpBanMatch =
      /^\/admin\/api\/moderation\/accounts\/(\d+)\/daily-rewards-ip-(ban|unban)$/.exec(path);
    if (req.method === 'POST' && dailyRewardsIpBanMatch) {
      const body = await readBody(req);
      try {
        await setDailyRewardsIpBan({
          accountId: Number(dailyRewardsIpBanMatch[1]),
          adminAccountId: accountId,
          ip: body.ip,
          banned: dailyRewardsIpBanMatch[2] === 'ban',
          reason: body.reason,
        });
        return ok(res, { ok: true });
      } catch (err) {
        return fail(
          res,
          400,
          err instanceof Error ? err.message : 'daily rewards IP moderation failed',
        );
      }
    }
    const ignoreMatch = /^\/admin\/api\/moderation\/reports\/(\d+)\/ignore$/.exec(path);
    if (req.method === 'POST' && ignoreMatch) {
      const body = await readBody(req);
      const ignored = await ignoreReport(Number(ignoreMatch[1]), accountId, body.note);
      return ignored ? ok(res, { ok: true }) : fail(res, 404, 'open report not found');
    }
    const bugReportResolveMatch = /^\/admin\/api\/bug-reports\/(\d+)\/(resolve|dismiss)$/.exec(
      path,
    );
    if (req.method === 'POST' && bugReportResolveMatch) {
      const body = await readBody(req);
      const status: BugReportResolution =
        bugReportResolveMatch[2] === 'resolve' ? 'resolved' : 'dismissed';
      const resolved = await resolveBugReport(
        Number(bugReportResolveMatch[1]),
        accountId,
        status,
        body.note,
      );
      return resolved ? ok(res, { ok: true }) : fail(res, 404, 'open bug report not found');
    }
    const forceRenameMatch = /^\/admin\/api\/moderation\/characters\/(\d+)\/force-rename$/.exec(
      path,
    );
    if (req.method === 'POST' && forceRenameMatch) {
      const body = await readBody(req);
      try {
        const result = await forceCharacterRename({
          characterId: Number(forceRenameMatch[1]),
          adminAccountId: accountId,
          reason: body.reason,
        });
        game.disconnectAccount(
          result.accountId,
          'A moderator requires one of your characters to be renamed.',
        );
        return ok(res, { ok: true });
      } catch (err) {
        return fail(res, 400, err instanceof Error ? err.message : 'force rename failed');
      }
    }

    // R35 GM restores (professions tooling): validate, require online HERE,
    // audit row, then the sync live mint (the RouteDef twin's exact order).
    const restoreItemMatch = /^\/admin\/api\/moderation\/characters\/(\d+)\/restore-item$/.exec(
      path,
    );
    if (req.method === 'POST' && restoreItemMatch) {
      const id = Number(restoreItemMatch[1]);
      const body = await readBody(req);
      const bodyError = restoreItemBodyError(body);
      if (bodyError) return fail(res, 400, bodyError);
      const itemId = String(body.itemId);
      const count = Number(body.count);
      try {
        if (!game.adminCharacterOnline(id)) {
          return fail(res, 400, 'character is not online on this realm');
        }
        await recordProfessionsRestore({
          characterId: id,
          adminAccountId: accountId,
          action: 'restore_item',
          detail: `${itemId} x${count}`,
          reason: body.reason,
        });
        const result = game.adminRestoreItem(id, itemId, count);
        // Defensive twin of the pre-audit body check; reachable only if the
        // runtime and validator ever disagree about ITEMS.
        if (result === 'invalid_item') return fail(res, 400, 'unknown item id');
        if (result !== 'ok') {
          return fail(res, 400, 'character went offline before the restore landed');
        }
        return ok(res, { ok: true });
      } catch (err) {
        return fail(res, 400, err instanceof Error ? err.message : 'item restore failed');
      }
    }
    const restoreSlotMatch = /^\/admin\/api\/moderation\/characters\/(\d+)\/restore-slot$/.exec(
      path,
    );
    if (req.method === 'POST' && restoreSlotMatch) {
      const id = Number(restoreSlotMatch[1]);
      const body = await readBody(req);
      const bodyError = restoreSlotBodyError(body);
      if (bodyError) return fail(res, 400, bodyError);
      const professionId = String(body.professionId);
      const effectId = String(body.effectId);
      try {
        if (!game.adminCharacterOnline(id)) {
          return fail(res, 400, 'character is not online on this realm');
        }
        await recordProfessionsRestore({
          characterId: id,
          adminAccountId: accountId,
          action: 'restore_slot',
          detail: `${professionId}/${effectId}`,
          reason: body.reason,
        });
        const result = game.adminRestoreToolEffectSlot(id, professionId, effectId);
        if (result === 'no_tool') {
          return fail(res, 400, 'the character owns no tool for that profession');
        }
        // A restore is for a row that is GONE: an overwrite would destroy the
        // live row's provenance, confirm mode, and ratcheted ceiling.
        if (result === 'already_slotted') {
          return fail(res, 400, 'that profession already has a slotted effect');
        }
        if (result === 'invalid_request') {
          return fail(res, 400, 'that effect cannot be slotted on that profession');
        }
        if (result !== 'ok') {
          return fail(res, 400, 'character went offline before the restore landed');
        }
        return ok(res, { ok: true });
      } catch (err) {
        return fail(res, 400, err instanceof Error ? err.message : 'slot restore failed');
      }
    }

    // Chat filter: lift mute / reset strikes for an account.
    const liftMuteMatch = /^\/admin\/api\/moderation\/accounts\/(\d+)\/lift-mute$/.exec(path);
    if (req.method === 'POST' && liftMuteMatch) {
      const id = Number(liftMuteMatch[1]);
      const body = await readBody(req);
      try {
        await liftAccountChatMute({
          accountId: id,
          adminAccountId: accountId,
          reason: body.reason,
        });
        game.liftChatMuteLive(id);
        return ok(res, { ok: true });
      } catch (err) {
        return fail(res, 400, err instanceof Error ? err.message : 'chat unmute failed');
      }
    }
    // Append a free-form moderator note to the account's audit log. Non-punitive:
    // no account-state change, no disconnection, no report resolution.
    const noteMatch = /^\/admin\/api\/moderation\/accounts\/(\d+)\/note$/.exec(path);
    if (req.method === 'POST' && noteMatch) {
      const id = Number(noteMatch[1]);
      const body = await readBody(req);
      try {
        await addAccountNote({ accountId: id, adminAccountId: accountId, note: body.reason });
        return ok(res, { ok: true });
      } catch (err) {
        return fail(res, 400, err instanceof Error ? err.message : 'failed to add note');
      }
    }
    const resetStrikesMatch = /^\/admin\/api\/moderation\/accounts\/(\d+)\/reset-strikes$/.exec(
      path,
    );
    if (req.method === 'POST' && resetStrikesMatch) {
      const id = Number(resetStrikesMatch[1]);
      const body = await readBody(req);
      try {
        const reset = await resetChatStrikesAudited({
          accountId: id,
          adminAccountId: accountId,
          reason: body.reason,
        });
        if (reset) game.resetChatStrikesLive(id);
        return reset ? ok(res, { ok: true }) : fail(res, 404, 'account not found');
      } catch (err) {
        return fail(res, 400, err instanceof Error ? err.message : 'chat strikes reset failed');
      }
    }

    // Set a new password on any account (admin-initiated credential reset). The
    // audit row is written first (no live effect without its record), then every
    // device is signed out: all tokens revoked plus a live WS disconnect, since
    // token revocation alone leaves an already-open socket connected.
    const resetPasswordMatch = /^\/admin\/api\/accounts\/(\d+)\/reset-password$/.exec(path);
    if (req.method === 'POST' && resetPasswordMatch) {
      const targetAccountId = Number(resetPasswordMatch[1]);
      if ((await isAdminAccount(targetAccountId)) && !identity.roles.includes(SUPERADMIN_ROLE)) {
        return fail(res, 400, 'only a superadmin can reset a staff password');
      }
      const body = await readBody(req);
      const password = body.password;
      if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
        return fail(res, 400, `password must be at least ${MIN_PASSWORD_LENGTH} chars`);
      }
      if (password.length > MAX_PASSWORD_LENGTH) {
        return fail(res, 400, `password must be at most ${MAX_PASSWORD_LENGTH} chars`);
      }
      if (!(await accountById(targetAccountId))) {
        return fail(res, 404, 'account not found');
      }
      try {
        await recordPasswordReset({
          accountId: targetAccountId,
          adminAccountId: accountId,
          reason: body.reason,
        });
        await updatePasswordHash(targetAccountId, await hashPassword(password));
        await revokeTokensExcept(targetAccountId, null);
        game.disconnectAccount(targetAccountId, IP_BLOCK_KICK_MESSAGE);
        return ok(res, { ok: true });
      } catch (err) {
        return fail(res, 400, err instanceof Error ? err.message : 'password reset failed');
      }
    }

    // Account flair: the AI-operated mark and an official streamer's links. Both
    // are cosmetic and non-punitive, so (unlike suspend/ban/chat-mute) there is
    // deliberately NO isAdminAccount guard: marking a staff account as a streamer
    // is a legitimate edit (a developer who streams), and no reason is required.
    // The write is still audited, and the live push lands the change on a connected
    // player with no reconnect (the identity diff re-broadcasts it).
    const aiFlagMatch = /^\/admin\/api\/accounts\/(\d+)\/ai$/.exec(path);
    if (req.method === 'POST' && aiFlagMatch) {
      const targetAccountId = Number(aiFlagMatch[1]);
      const body = await readBody(req);
      if (typeof body.ai !== 'boolean') return fail(res, 400, AI_FLAG_REQUIRED);
      try {
        await setAccountAiFlag({
          accountId: targetAccountId,
          adminAccountId: accountId,
          ai: body.ai,
          reason: body.reason,
        });
        game.applyAccountFlairLive(targetAccountId, await loadAccountFlair(targetAccountId));
        return ok(res, { ok: true });
      } catch (err) {
        return fail(res, 400, err instanceof Error ? err.message : ACCOUNT_FLAIR_FAILED);
      }
    }
    const streamerFlairMatch = /^\/admin\/api\/accounts\/(\d+)\/streamer$/.exec(path);
    if (req.method === 'POST' && streamerFlairMatch) {
      const targetAccountId = Number(streamerFlairMatch[1]);
      const body = await readBody(req);
      if (typeof body.streamer !== 'boolean') return fail(res, 400, STREAMER_FLAG_REQUIRED);
      const links = streamerLinksBody(body.links);
      if (links === null) return fail(res, 400, STREAMER_LINKS_REQUIRED);
      try {
        await setAccountStreamerFlair({
          accountId: targetAccountId,
          adminAccountId: accountId,
          streamer: body.streamer,
          links,
          reason: body.reason,
        });
        game.applyAccountFlairLive(targetAccountId, await loadAccountFlair(targetAccountId));
        return ok(res, { ok: true });
      } catch (err) {
        return fail(res, 400, err instanceof Error ? err.message : ACCOUNT_FLAIR_FAILED);
      }
    }

    const guildRenameMatch = /^\/admin\/api\/guilds\/(\d+)\/rename$/.exec(path);
    if (req.method === 'POST' && guildRenameMatch) {
      const body = await readBody(req);
      const renamed = await renameAdminGuild(
        Number(guildRenameMatch[1]),
        typeof body.name === 'string' ? body.name : '',
        typeof body.reason === 'string' ? body.reason : '',
        accountId,
      );
      if ('error' in renamed) {
        const failure = guildRenameFailure(renamed.error);
        return fail(res, failure.status, failure.message);
      }
      game.social.guildRenamed(
        renamed.result.guildId,
        renamed.result.oldName,
        renamed.result.newName,
        renamed.result.memberCharacterIds,
      );
      bustAdminGuildBoardCaches();
      return ok(res, {
        id: renamed.result.guildId,
        name: renamed.result.newName,
      });
    }

    // The guild bank dormant-slot escape hatch: remove ONE permanently
    // unwithdrawable copy so the guild can empty its bank and disband. The
    // removal runs through the same observed book-mutation path every other
    // guild bank op uses (ledger row op 'admin_purge' + the fenced escrow
    // save); the sim refuses anything that is not actually dormant.
    const guildBankPurgeMatch = /^\/admin\/api\/guilds\/(\d+)\/bank\/purge-slot$/.exec(path);
    if (req.method === 'POST' && guildBankPurgeMatch) {
      const body = await readBody(req);
      // Number() on a digit string can still yield 0 or a past-2^53 id here
      // where the RouteDef arm's requireAdminTarget('guild') loader 422s. That
      // is the adminIdParamDecode deviation class, and this path is ledgered
      // for it by name (tests/server/http/known_deviations.ts): it is the first
      // /admin/api/guilds/* entry, so it was NOT covered by the family the
      // other :id admin routes sit in. Both arms REFUSE such an id without
      // touching the live book: adminPurgeGuildBankSlot rejects a non-positive
      // or non-integer guild id up front. Only the status differs.
      const outcome = await purgeGuildBankSlotOutcome(
        game,
        Number(guildBankPurgeMatch[1]),
        accountId,
        body,
      );
      return outcome.ok ? ok(res, outcome.body) : fail(res, outcome.status, outcome.message);
    }

    // Chat filter: word list + escalation config management. Every edit reloads
    // the live filter and pushes the new soft list to connected clients.
    if (req.method === 'POST' && path === '/admin/api/chat-filter/words') {
      const body = await readBody(req);
      const tier = cleanTier(body.tier);
      if (!tier) return fail(res, 400, 'tier must be "soft" or "hard"');
      const added = await addFilterWord(body.word, tier);
      if (!added) return fail(res, 400, 'word is empty after normalization');
      await game.reloadChatFilter();
      return ok(res, { ok: true });
    }
    const wordDeleteMatch = /^\/admin\/api\/chat-filter\/words\/(\d+)\/delete$/.exec(path);
    if (req.method === 'POST' && wordDeleteMatch) {
      const removed = await removeFilterWord(Number(wordDeleteMatch[1]));
      if (removed) await game.reloadChatFilter();
      return removed ? ok(res, { ok: true }) : fail(res, 404, 'word not found');
    }
    if (req.method === 'POST' && path === '/admin/api/chat-filter/config') {
      const body = await readBody(req);
      const config = await updateFilterConfig({
        warningsBeforeMute: body.warningsBeforeMute,
        muteLadderSeconds: body.muteLadderSeconds,
      });
      await game.reloadChatFilter();
      return ok(res, config);
    }

    if (req.method === 'POST' && path === '/admin/api/blocked-ips') {
      const body = await readBody(req);
      const cleanedIp = cleanIp(body.ip);
      if (!cleanedIp) return fail(res, 400, 'a valid IP address is required');
      try {
        const ip = await addBlockedIp({
          ip: cleanedIp,
          reason: body.reason,
          createdByAccountId: accountId,
          expiresAt: body.expiresAt,
        });
        if (!ip) return fail(res, 400, 'a valid IP address is required');
        await game.reloadBlockedIps();
        game.disconnectByIp(ip, IP_BLOCK_KICK_MESSAGE);
        return ok(res, { ok: true });
      } catch (err) {
        return fail(res, 400, err instanceof Error ? err.message : 'failed to block IP');
      }
    }
    if (req.method === 'POST' && path === '/admin/api/blocked-ips/delete') {
      const body = await readBody(req);
      if (!cleanIp(body.ip)) return fail(res, 400, 'a valid IP address is required');
      const removed = await removeBlockedIp(body.ip, accountId);
      if (removed) await game.reloadBlockedIps();
      return removed ? ok(res, { ok: true }) : fail(res, 404, 'IP not found');
    }

    // Map editor moderation: force a published map back to private, and
    // block/unblock an uploaded GLB asset (blocked assets 404 on the public
    // byte GET and reject re-uploads of the same hash). Both write a
    // content_moderation_actions audit row (content_moderation_db.ts).
    const mapUnpublishMatch = /^\/admin\/api\/maps\/(\d+)\/unpublish$/.exec(path);
    if (req.method === 'POST' && mapUnpublishMatch) {
      const body = await readBody(req);
      const done = await adminMapsDb().adminUnpublish(Number(mapUnpublishMatch[1]), {
        adminAccountId: accountId,
        reason: cleanContentModerationReason(body.reason),
      });
      return done ? ok(res, { ok: true }) : fail(res, 404, 'map_not_found');
    }
    const assetBlockMatch = /^\/admin\/api\/user-assets\/(\d+)\/(block|unblock)$/.exec(path);
    if (req.method === 'POST' && assetBlockMatch) {
      const status = assetBlockMatch[2] === 'block' ? 'blocked' : 'active';
      const body = await readBody(req);
      const done = await adminUserAssetsDb().adminSetStatus(Number(assetBlockMatch[1]), status, {
        adminAccountId: accountId,
        reason: cleanContentModerationReason(body.reason),
      });
      return done ? ok(res, { ok: true }) : fail(res, 404, 'asset_not_found');
    }

    if (req.method === 'POST' && path === '/admin/api/antibot-config') {
      return await handleAntibotConfigSave(req, res, game, accountId);
    }

    // Trigger an on-demand server tick-loop profiling capture. The detailed
    // sub-phase timing runs only for the requested window, then freezes a result
    // read back via GET /admin/api/perf/tick.
    if (req.method === 'POST' && path === '/admin/api/perf/tick/capture') {
      const body = await readBody(req);
      const raw = body.durationMs;
      const durationMs = typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
      return ok(res, game.startPerfCapture(durationMs));
    }

    if (req.method !== 'GET') return fail(res, 405, 'method not allowed');

    // Current capture status + the last frozen result.
    if (path === '/admin/api/perf/tick') {
      return ok(res, game.perfCaptureStatus());
    }

    if (path === '/admin/api/blocked-ips') {
      return ok(res, { rows: await listBlockedIps() });
    }

    if (path === '/admin/api/chat-filter') {
      const [soft, hard, config, accounts] = await Promise.all([
        listFilterWords('soft'),
        listFilterWords('hard'),
        getFilterConfig(),
        chatModeratedAccounts(),
      ]);
      return ok(res, { soft, hard, config, accounts });
    }

    if (path === '/admin/api/overview') {
      const counts = await readOverviewCounts();
      const serverStats = game.adminStats();
      return ok(res, {
        ...counts,
        peakOnlineToday: Math.max(counts.peakOnlineToday, serverStats.online),
        peakOnlineAllTime: Math.max(counts.peakOnlineAllTime, serverStats.online),
        playersCap: adminPlayersCap(),
        server: {
          ...serverStats,
          peakOnline: Math.max(
            serverStats.peakOnline,
            counts.peakOnlineAllTime,
            serverStats.online,
          ),
        },
      });
    }

    // Provider usage (request counts + cache stats) is its own permission
    // (ops_usage.read), held only by admin/superadmin, so it lives on a
    // dedicated route rather than riding inside the analytics.read overview.
    if (path === '/admin/api/provider-usage') {
      return ok(res, { usage: providerUsageSnapshot() });
    }
    if (path === '/admin/api/online') {
      return ok(res, { players: game.liveSessions() });
    }
    if (path === '/admin/api/antibot-config') {
      const stored = await loadAntibotConfig();
      return ok(res, { fields: game.antibotConfigFields(), updatedAt: stored.updatedAt });
    }
    if (path === '/admin/api/antibot-config/history') {
      return ok(res, { entries: await listAntibotConfigHistory() });
    }
    if (path === '/admin/api/suspicious-players') {
      return ok(res, { players: game.suspiciousPlayers() });
    }
    if (path === '/admin/api/detection-calibration') {
      return ok(res, game.detectionCalibration());
    }
    if (path === '/admin/api/online-history') {
      return ok(res, await onlineHistory(url.searchParams.get('range') ?? '30d'));
    }
    if (path === '/admin/api/activity') {
      const [registrations, sessions, classes, levels] = await Promise.all([
        registrationsByDay(ACTIVITY_WINDOW_DAYS),
        sessionsByDay(ACTIVITY_WINDOW_DAYS),
        classDistribution(),
        levelDistribution(),
      ]);
      return ok(res, { days: ACTIVITY_WINDOW_DAYS, registrations, sessions, classes, levels });
    }
    if (path === '/admin/api/perf/summary') {
      const hours = Number(url.searchParams.get('hours') ?? '24');
      return ok(res, await clientPerfSummary(hours));
    }
    if (path === '/admin/api/perf/raw') {
      const hours = Number(url.searchParams.get('hours') ?? '24');
      const limit = Number(url.searchParams.get('limit') ?? '100');
      const beforeIdParam = url.searchParams.get('beforeId');
      const beforeId = beforeIdParam === null ? undefined : Number(beforeIdParam);
      const rows = await clientPerfRaw(hours, limit, beforeId);
      return ok(res, {
        rows,
        nextBeforeId: rows.length > 0 ? rows[rows.length - 1].id : null,
        hasMore:
          rows.length >=
          Math.min(1000, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 100))),
      });
    }
    if (path === '/admin/api/accounts') {
      const { page, limit } = parsePageParams(url.searchParams);
      const search = (url.searchParams.get('search') ?? '').slice(0, 64);
      const { sort, dir } = parseAdminAccountSort(url.searchParams);
      return ok(res, await listAccounts(search, page, limit, sort, dir));
    }
    if (path === '/admin/api/guilds') {
      const { page, limit } = parsePageParams(url.searchParams);
      const search = url.searchParams.get('search') ?? '';
      const { sort, dir } = parseAdminGuildSort(url.searchParams);
      return await sendAdminGuildList(res, { search, page, limit, sort, dir }, () =>
        listAdminGuilds(search, page, limit, sort, dir),
      );
    }
    const guildHistoryMatch = /^\/admin\/api\/guilds\/(\d+)\/history$/.exec(path);
    if (guildHistoryMatch) {
      const rows = await listAdminGuildHistory(Number(guildHistoryMatch[1]));
      return rows === null ? fail(res, 404, 'guild not found') : ok(res, { rows });
    }
    // The guild bank operator READ: the live book (treasury, capacity, and the
    // slot list with its dormant flags) the dormant-slot purge is unusable
    // without. Same shared outcome helper as the RouteDef arm; the degenerate
    // digit-string :id class diverges here exactly as it does on the purge
    // beside it (both ledgered in tests/server/http/known_deviations.ts):
    // adminGuildBankState refuses a non-positive or non-integer guild id
    // itself, so this arm 404s where the RouteDef arm 422s and NEITHER reads a
    // live book.
    const guildBankStateMatch = /^\/admin\/api\/guilds\/(\d+)\/bank$/.exec(path);
    if (guildBankStateMatch) {
      const outcome = guildBankStateOutcome(game, Number(guildBankStateMatch[1]));
      return outcome.ok ? ok(res, outcome.body) : fail(res, outcome.status, outcome.message);
    }
    const guildDetailMatch = /^\/admin\/api\/guilds\/(\d+)$/.exec(path);
    if (guildDetailMatch) {
      const detail = await adminGuildDetail(Number(guildDetailMatch[1]));
      if (!detail) return fail(res, 404, 'guild not found');
      const onlineIds = game.liveCharacterIds();
      return ok(res, {
        guild: detail.guild,
        members: detail.members.map((member) => ({
          ...member,
          online: onlineIds.has(member.characterId),
        })),
      });
    }
    if (path === '/admin/api/shared-ips') {
      const { page, limit } = parsePageParams(url.searchParams);
      const { sort, dir } = sharedIpSortParams(url.searchParams);
      if (url.searchParams.get('online') === '1') {
        const rows = sortSharedIpRows(game.liveSharedIps(), sort, dir);
        const offset = (page - 1) * limit;
        return ok(res, {
          rows: rows.slice(offset, offset + limit).map((row) => ({
            ...row,
            blocked: game.isIpBlocked(row.ip),
          })),
          total: rows.length,
          page,
          limit,
        });
      }
      const sharedIps = await listSharedIps(page, limit, sort, dir);
      return ok(res, {
        ...sharedIps,
        rows: sharedIps.rows.map((row) => ({
          ...row,
          blocked: game.isIpBlocked(row.ip),
        })),
      });
    }
    if (path === '/admin/api/ip-associations') {
      const ip = cleanIpAssociationLookup(url.searchParams.get('ip'));
      if (!ip) return fail(res, 400, 'a valid IP address is required');
      const { page, limit } = parsePageParams(url.searchParams);
      const associations = await associationsForIp(ip, page, limit);
      const onlineAccountIds = game.liveAccountIds();
      const blockableIp = cleanIp(ip);
      return ok(res, {
        ...associations,
        accounts: associations.accounts.map((account) => ({
          ...account,
          online: onlineAccountIds.has(account.accountId),
        })),
        blocked: blockableIp ? game.isIpBlocked(blockableIp) : false,
        blockable: Boolean(blockableIp),
      });
    }
    if (path === '/admin/api/moderation/queue') {
      return ok(res, { rows: await readModerationQueue(game.liveAccountIds()) });
    }
    if (path === '/admin/api/moderation/history') {
      const { page, limit } = parsePageParams(url.searchParams);
      return ok(
        res,
        await listModerationActions(moderationHistoryTab(url.searchParams), accountId, page, limit),
      );
    }
    if (path === '/admin/api/bug-reports') {
      const { page, limit } = parsePageParams(url.searchParams);
      const { rows, total } = await listBugReports(limit, (page - 1) * limit);
      return ok(res, { rows, total, page, limit });
    }
    if (path === '/admin/api/unstuck-reports') {
      const query = unstuckQuery(url.searchParams);
      const [page, hotspots] = await Promise.all([
        listUnstuckReportsDb(pool, { realm: REALM, ...query }),
        query.beforeId === undefined
          ? listUnstuckHotspotsDb(pool, {
              realm: REALM,
              days: query.days,
              limit: UNSTUCK_HOTSPOT_MAX_LIMIT,
            })
          : Promise.resolve<DbUnstuckHotspotRow[]>([]),
      ]);
      return ok(res, adminUnstuckPayload(page, hotspots, query));
    }
    const bugScreenshotMatch = /^\/admin\/api\/bug-reports\/(\d+)\/screenshot$/.exec(path);
    if (bugScreenshotMatch) {
      // The list query omits the (potentially large) screenshot; fetch it per report.
      return ok(res, { screenshot: await getBugReportScreenshot(Number(bugScreenshotMatch[1])) });
    }
    const moderationAccountMatch = /^\/admin\/api\/moderation\/accounts\/(\d+)$/.exec(path);
    if (moderationAccountMatch) {
      const id = Number(moderationAccountMatch[1]);
      const [detail, reports, chat] = await Promise.all([
        accountDetail(id),
        moderationReportsForAccount(id),
        chatModerationForAccount(id),
      ]);
      if (!detail) return fail(res, 404, 'account not found');
      return ok(res, {
        account: {
          ...detail,
          online: game.liveAccountIds().has(id),
        },
        reports,
        chat,
        blockedIps: getBlockedIpsForAccount(game, detail),
      });
    }
    const dailyRewardEventsMatch = /^\/admin\/api\/accounts\/(\d+)\/daily-rewards-events$/.exec(
      path,
    );
    if (dailyRewardEventsMatch) {
      const day = await dailyRewardEventDay(url.searchParams.get('day'));
      if (!day) return fail(res, 400, DAILY_REWARD_EVENT_DAY_REQUIRED);
      const limit = Number(url.searchParams.get('limit') ?? '100');
      return ok(res, await dailyRewardPointEvents(Number(dailyRewardEventsMatch[1]), day, limit));
    }
    const detailMatch = /^\/admin\/api\/accounts\/(\d+)$/.exec(path);
    if (detailMatch) {
      const id = Number(detailMatch[1]);
      const detail = await accountDetail(id);
      if (!detail) return fail(res, 404, 'account not found');
      return ok(res, {
        ...detail,
        online: game.liveAccountIds().has(id),
      });
    }
    if (path === '/admin/api/characters') {
      const { page, limit } = parsePageParams(url.searchParams);
      const search = url.searchParams.get('search') ?? '';
      const sort = url.searchParams.get('sort') ?? 'level';
      const dir = url.searchParams.get('dir') === 'asc' ? 'asc' : 'desc';
      return ok(res, await listCharacters(search, sort, dir, page, limit));
    }
    // R35 professions inspector (the RouteDef twin's exact shape: live
    // serializeCharacter snapshot when online, stored blob otherwise). The
    // explicit GET check matches every sibling branch in this ladder: the
    // central ADMIN_ROUTE_PERMISSIONS gate already refuses other methods, but
    // this branch must not silently start serving one the day someone adds a
    // POST permission for the path.
    const characterProfessionsMatch = /^\/admin\/api\/characters\/(\d+)\/professions$/.exec(path);
    if (req.method === 'GET' && characterProfessionsMatch) {
      const id = Number(characterProfessionsMatch[1]);
      // Live snapshot FIRST (the RouteDef twin's exact shape): a live read
      // discards the blob, so the query skips fetching it.
      const liveState = game.adminCharacterState(id);
      const row = await characterProfessionsRow(id, liveState === null);
      if (!row) return fail(res, 404, 'character not found');
      return ok(res, characterProfessionsSheetFromRow(row, liveState));
    }
    if (path === '/admin/api/maps') {
      const { page, limit } = parsePageParams(url.searchParams);
      const { rows, total } = await adminMapsDb().listAdmin(limit, (page - 1) * limit);
      return ok(res, { rows, total, page, limit });
    }
    if (path === '/admin/api/user-assets') {
      const { page, limit } = parsePageParams(url.searchParams);
      const { rows, total } = await adminUserAssetsDb().listAdmin(limit, (page - 1) * limit);
      return ok(res, { rows, total, page, limit });
    }

    fail(res, 404, 'unknown admin endpoint');
  } catch (err) {
    logger.error({ err }, 'admin api error');
    fail(res, 500, 'internal error');
  }
}

// ===========================================================================
// Route layer, ported onto RouteDefs.
//
// The ~30 handleAdminApi branches move off the inline if-ladder above onto the
// shared server/http/ pipeline the registry dispatcher serves under API_DISPATCH
// 'new' (server/main.ts routes /admin/api through its own flag-gated dispatcher
// whose delegate is the legacy handleAdminApi, kept as the flag-off rollback path
// until the ladder-deletion PR, next release). This follows the server/discord.ts +
// server/reports.ts template:
//
//  - PARITY-FIRST bodies + envelope. Every migrated handler reproduces its legacy
//    branch's logic and writes the SAME { success, data, error } admin envelope
//    (ok/fail) byte-for-byte. The envelope is FROZEN (a contract test pins the
//    success / error / data:{ ok:true } variants); it is NOT problem+json. Each
//    RouteDef carries surface 'admin' + meta.envelope 'admin' so an UNEXPECTED throw
//    also serializes through the withErrors boundary as the admin envelope
//    (serializeAdmin: { success:false, data:null, error: code }) rather than
//    problem+json. That 500 body differs from the legacy outer-catch 500
//    { ...error: 'internal error' } only in the error string (the code 'internal.error'
//    vs the prose 'internal error'): same status + shape, recorded as the
//    adminBodyValidationRemap deviation (harness-invisible; no fixture drives an
//    internal throw). The happy + guard paths never reach withErrors.
//
//  - AUTH is the legacy-body admin gate (createRequireAdmin), mirroring
//    adminIdentity(req) EXACTLY (v0.22.0 staff roles): bearer -> scoped token
//    resolver (full required) -> staff_db.adminRolesForAccount (fail closed), a
//    uniform 401 { ...error: 'admin authentication required' } on any failure, then
//    the CENTRAL AUTHORIZATION gate: the route's declared permission resolves from
//    ADMIN_ROUTE_PERMISSIONS (server/admin_routes.ts) against the concrete request
//    path, fail-closed (unmapped -> 404 'unknown admin endpoint' / 405; missing
//    permission -> 403), mirroring the legacy handleAdminApi preamble byte-for-byte.
//    Read-scope tokens receive the same uniform 401 as every other invalid admin
//    credential. No moderation gate applies. Mounted on every route except login.
//    requireAdmin runs BEFORE the :id / :action decode, so an unauthenticated
//    malformed request 401s exactly as legacy did (auth precedes route/method).
//
//  - The admin.login limiter stays the legacy in-handler rateLimited(req,
//    ADMIN_LOGIN_MAX_PER_MINUTE), NOT the new coded POLICIES table (rate_limit.ts):
//    its own per-minute ceiling, isolated from the account/IP policy set, keeping the
//    429 body byte-identical. Its own isolated limiter STORE is the two-tier limiter
//    end-state; parity-first keeps the legacy shared-store call in-handler. Both login
//    arms ALSO gate on the shared per-account authThrottled/recordAuthFailure/
//    clearAuthFailures throttle (server/ratelimit.ts), the same username-keyed guard
//    server/auth_routes.ts uses for the player login: the per-IP ceiling alone cannot
//    stop a distributed attacker who never repeats a source IP against one account.
//
//  - The enum-segment route restructures. The legacy regex route
//    /moderation/accounts/:id/(suspend|unsuspend|ban|unban) violates the table
//    router's no-regex-routing guard, so it becomes /moderation/accounts/:id/:action with a
//    schema-validated enum action. Since v0.22.0 an action outside the four is
//    404d fail-closed by the central permission gate BEFORE the decode, identically
//    on both arms (the adminEnumInvalid422 deviation is superseded; the 422 enum
//    decode remains as an unreachable defensive backstop). The literal
//    sibling routes (reactivate / chat-mute / lift-mute / note / reset-strikes) sort
//    most-specific-first ahead of :action, so each still matches its own path.
//
//  - The :id routes carry an OPERATOR-scoped admin loader (requireAdminTarget), which
//    decodes the :id (a NON-NUMERIC id is 404d fail-closed by the central gate before
//    the decode on both arms; a degenerate DIGIT-STRING id, '0'/'00'/past-2^53, still
//    422s here where legacy runs the handler, the narrowed adminIdParamDecode
//    deviation) and marks the route ownerScope 'operator', EXCLUDED
//    from the account-owner deny-by-default coverage clause. The operator scope grants
//    universal authority (an admin moderates any account), so the loader authorizes no
//    cross-scope object and emits no per-object 403/404; the handlers keep their own
//    legacy resource-not-found 404 ('account not found') byte-for-byte (see
//    require_admin.ts for the parity-first operator-denial note).
//
//  - RUNTIME injection. The game-session side effects (disconnect, chat-mute-live,
//    filter/IP reload, live reads) are main.ts-local singletons, injected once at boot
//    via configureAdminRuntime so `export const routes` stays a static array
//    registry.ts spreads (avoiding a main -> registry -> admin -> main cycle). The DB
//    reads/writes are bundled behind setAdminDbForTests for pool-less unit tests.
// ===========================================================================

/**
 * The main.ts game-session methods the admin routes need (boot-injected). It is a
 * subset of GameServer, so main.ts passes the live `game` directly; admin.ts can
 * only reach these methods, and the exact GameServer signatures flow through Pick.
 */
export type AdminRuntime = Pick<
  GameServer,
  | 'adminStats'
  | 'liveSessions'
  | 'suspiciousPlayers'
  | 'detectionCalibration'
  | 'isIpBlocked'
  | 'liveSharedIps'
  | 'liveAccountIds'
  | 'liveCharacterIds'
  | 'disconnectAccount'
  | 'muteAccountChat'
  | 'liftChatMuteLive'
  | 'resetChatStrikesLive'
  // Push an operator's account-flair edit onto the account's live session, so the
  // AI mark / streamer links change without a reconnect.
  | 'applyAccountFlairLive'
  | 'reloadChatFilter'
  | 'reloadBlockedIps'
  | 'disconnectByIp'
  | 'antibotConfigFields'
  | 'applyAntibotConfig'
  | 'startPerfCapture'
  | 'perfCaptureStatus'
  // The guild bank dormant-slot escape hatch (guildbank.purge). A live-sim
  // mutation, so it rides the runtime Pick like every other game-session hook,
  // beside the live-book READ (moderation.read) an operator discovers the slot
  // index and its item id with.
  | 'adminGuildBankState'
  | 'adminPurgeGuildBankSlot'
  // R35 GM professions tooling: a live character-state snapshot for the
  // inspector, and the two audited restores (item mint, slot re-mint).
  | 'adminCharacterState'
  | 'adminCharacterOnline'
  | 'adminRestoreItem'
  | 'adminRestoreToolEffectSlot'
  | 'social'
>;

let runtime: AdminRuntime | null = null;

/** Inject the main.ts game-session hooks the admin routes need (boot). */
export function configureAdminRuntime(rt: AdminRuntime): void {
  runtime = rt;
}

/** Clear the injected runtime so a unit test can install its own fake. */
export function resetAdminRuntimeForTests(): void {
  runtime = null;
}

/** The injected runtime, or a loud failure if a request somehow beat boot wiring. */
function useAdminRuntime(): AdminRuntime {
  if (runtime === null) {
    throw new Error('admin runtime is not configured; call configureAdminRuntime');
  }
  return runtime;
}

// The realm player cap for the overview. It rides its OWN tiny seam, NOT AdminRuntime:
// AdminRuntime is a Pick<GameServer> and main.ts injects the live GameServer by value,
// but the cap is canonicalPlayersCap() (a main.ts module function, not a GameServer
// method), so it cannot flow through the Pick. Both overview arms read this one accessor
// so the field stays byte-identical across the legacy and RouteDef dispatch paths (the
// dual-arm rule). Unlike useAdminRuntime, an unconfigured read returns 0 rather than
// throwing: 0 is the same "cap disabled" sentinel canonicalPlayersCap emits, so a wiring
// gap degrades one cosmetic StatCard to 0 instead of failing the whole overview response.
let playersCapSource: (() => number) | null = null;

/** Inject the realm player-cap source (canonicalPlayersCap) at boot. */
export function configureAdminPlayersCap(fn: () => number): void {
  playersCapSource = fn;
}

/** Clear the injected cap source so a unit test can install its own. */
export function resetAdminPlayersCapForTests(): void {
  playersCapSource = null;
}

/** The realm player cap for the overview, or 0 when unconfigured (cap disabled). */
function adminPlayersCap(): number {
  return playersCapSource ? playersCapSource() : 0;
}

let adminGuildBoardCacheBustSource: (() => void) | null = null;

/** Inject the leaderboard cache invalidation hook used after a committed rename. */
export function configureAdminGuildBoardCacheBust(fn: () => void): void {
  adminGuildBoardCacheBustSource = fn;
}

/** Clear the leaderboard cache invalidation hook for unit tests. */
export function resetAdminGuildBoardCacheBustForTests(): void {
  adminGuildBoardCacheBustSource = null;
}

function bustAdminGuildBoardCaches(): void {
  adminGuildBoardCacheBustSource?.();
}

// The DB reads/writes (plus the login-path auth + rate-limit primitives) the admin
// route layer needs, bundled behind a test-only setter so they can be driven with a
// fake and no Postgres; production never calls the setter. The same functions the
// legacy handleAdminApi ladder calls directly, so both dispatch paths are identical.
//
// The bundle is built LAZILY (makeRealAdminDb is a function, not a module-load object
// literal): a legacy-only unit test that partial-mocks an admin *_db module (e.g.
// tests/admin.test.ts mocks moderation_db without addAccountNote) never calls the new
// handlers or setAdminDbForTests, so the missing binding is never dereferenced. An
// eager literal would touch every binding at module load and break that partial mock.
function makeRealAdminDb() {
  return {
    accountDetail,
    associationsForIp,
    characterProfessionsRow,
    // Cache-backed (the shared admin activity bundle; both dispatch arms read
    // it): a setAdminDbForTests override still replaces these members outright,
    // which bypasses the cache and keeps existing fakes exact.
    classDistribution,
    clientPerfRaw,
    clientPerfSummary,
    dailyRewardPointEvents,
    levelDistribution,
    listAccounts,
    listCharacters,
    listAdminGuilds,
    adminGuildDetail,
    listAdminGuildHistory,
    renameAdminGuild,
    recordAdminGuildBankPurge,
    listModerationActions,
    listSharedIps,
    onlineHistory,
    // Cache-backed (the shared admin overview memo; both dispatch arms read it):
    // a setAdminDbForTests override still replaces this member outright, which
    // bypasses the cache and keeps existing fakes exact.
    overviewCounts: readOverviewCounts,
    registrationsByDay,
    sessionsByDay,
    listBugReports,
    getBugReportScreenshot,
    resolveBugReport,
    listUnstuckReports: (options: Parameters<typeof listUnstuckReportsDb>[1]) =>
      listUnstuckReportsDb(pool, options),
    listUnstuckHotspots: (options: Parameters<typeof listUnstuckHotspotsDb>[1]) =>
      listUnstuckHotspotsDb(pool, options),
    listFilterWords,
    addFilterWord,
    removeFilterWord,
    getFilterConfig,
    updateFilterConfig,
    chatModerationForAccount,
    chatModeratedAccounts,
    resetChatStrikesAudited,
    cleanIp,
    listBlockedIps,
    addBlockedIp,
    removeBlockedIp,
    addAccountNote,
    forceCharacterRename,
    ignoreReport,
    liftAccountChatMute,
    moderateAccount,
    // Cache-backed (the shared moderation queue memo; both dispatch arms read
    // it and it is bust-wired by moderation_db.ts's setOnModerationQueueChanged
    // hook): a setAdminDbForTests override still replaces this member outright.
    moderationQueue: readModerationQueue,
    moderationReportsForAccount,
    muteAccountChat,
    accountAndScopeForToken,
    accountMailTarget,
    findAccount,
    // Target-account staff check (the "admin accounts cannot be suspended / banned /
    // chat muted" guards); the CALLER gate resolves roles via adminRolesForAccount.
    isAdminAccount,
    saveToken,
    reactivateAccountAudited,
    recordProfessionsRestore,
    touchLogin,
    newToken,
    verifyPassword,
    // Login second factor: an account with TOTP enabled must supply a live code or
    // a recovery code before a token is minted (mirrors server/auth_routes.ts).
    verifyLoginTwoFactor,
    // Admin-initiated password reset: existence check, credential write, sign out
    // every device, and its moderation-history audit row.
    accountById,
    hashPassword,
    updatePasswordHash,
    revokeTokensExcept,
    recordPasswordReset,
    setDailyRewardsBan,
    setDailyRewardsIpBan,
    // Account flair: the two audited writes plus the read-back the live push sends
    // (the DB row, never the request body, is the source of truth for what ships).
    setAccountAiFlag,
    setAccountStreamerFlair,
    loadAccountFlair,
    emailSecurityIncident,
    providerUsageSnapshot,
    rateLimited,
    // Per-account failed-login throttle (mirrors server/auth_routes.ts loginHandler).
    authThrottled,
    recordAuthFailure,
    clearAuthFailures,
    // Staff-role reads/writes (accounts.admin_roles + the audit trail).
    adminRolesForAccount,
    listStaff,
    roleChangeHistory,
    setAccountAdminRoles,
    // Bot-detector runtime-config persistence (per-realm JSONB + audit history).
    loadAntibotConfig,
    listAntibotConfigHistory,
    saveAntibotConfigChange,
  };
}

type AdminDb = ReturnType<typeof makeRealAdminDb>;

// The real bundle, memoized on first use (never at module load). A test override
// merges over it; both stay lazy so the module imports cleanly under a partial mock.
let realAdminDb: AdminDb | undefined;
let adminDbOverride: AdminDb | undefined;

/** The active admin db: a setAdminDbForTests override if present, else the real bundle. */
function adminDb(): AdminDb {
  if (adminDbOverride) return adminDbOverride;
  realAdminDb ??= makeRealAdminDb();
  return realAdminDb;
}

/** Override the admin db with a fake (test-only; merges over the real reads/writes). */
export function setAdminDbForTests(overrides: Partial<AdminDb>): void {
  realAdminDb ??= makeRealAdminDb();
  adminDbOverride = { ...realAdminDb, ...overrides };
}

/** Restore the real admin db after a setAdminDbForTests override (test-only). */
export function resetAdminDbForTests(): void {
  adminDbOverride = undefined;
}

// The admin-auth gate reads its two db functions (accountAndScopeForToken and
// adminRolesForAccount) off the active bundle, so a setAdminDbForTests fake drives
// it too. AdminDb is a superset of AdminAuthDb, so the getter is assignable.
const requireAdmin = createRequireAdmin((): AdminAuthDb => adminDb());

/**
 * The four moderation actions the enum route accepts. The central permission gate
 * 404s a fifth action before the decode (its table keys the literal alternation),
 * so the 422 arm below is an unreachable defensive backstop.
 */
const MODERATION_ACTION_SCHEMA = enum_(['suspend', 'unsuspend', 'ban', 'unban'] as const);

// ---------------------------------------------------------------------------
// Thin Ctx handlers. Each reproduces its legacy handleAdminApi branch, calling
// adminDb().* (injectable) and useAdminRuntime().* (the game side effects) so every
// ported body is byte-identical.
// ---------------------------------------------------------------------------

/**
 * POST /admin/api/login: anonymous, its own in-handler rateLimited limiter PLUS the
 * per-account failed-login throttle (mirrors server/auth_routes.ts loginHandler),
 * so a distributed attack spread across many source IPs cannot bypass a lockout by
 * never repeating an IP. Also mirrors loginHandler's second-factor gate: a staff
 * account with TOTP enabled must supply a live code or a recovery code before a
 * token is minted, so 2FA is never bypassable for the highest-privilege surface.
 */
async function loginHandler(ctx: Ctx): Promise<void> {
  if (!adminDb().rateLimited(ctx.req, ADMIN_LOGIN_MAX_PER_MINUTE).allowed) {
    return fail(ctx.res, 429, 'too many attempts, wait a minute and try again');
  }
  const body = await readBody(ctx.req);
  const username = typeof body.username === 'string' ? body.username : '';
  if (username && !adminDb().authThrottled(username).allowed) {
    return fail(ctx.res, 429, ADMIN_LOGIN_TOO_MANY_FAILED_ATTEMPTS);
  }
  const account = username ? await adminDb().findAccount(username) : null;
  if (
    !account ||
    !(await adminDb().verifyPassword(String(body.password ?? ''), account.password_hash))
  ) {
    if (username) adminDb().recordAuthFailure(username);
    return fail(ctx.res, 401, 'invalid username or password');
  }
  const staff = await adminDb().adminRolesForAccount(account.id);
  if (staff === null) {
    return fail(ctx.res, 403, 'this account does not have admin access');
  }
  if (account.totp_enabled_at) {
    const code = typeof body.code === 'string' ? body.code : '';
    const recoveryCode = typeof body.recoveryCode === 'string' ? body.recoveryCode : '';
    if (!code && !recoveryCode) {
      return ok(ctx.res, { twoFactorRequired: true });
    }
    if (!(await adminDb().verifyLoginTwoFactor(account, code, recoveryCode))) {
      adminDb().recordAuthFailure(username);
      return fail(ctx.res, 401, ADMIN_LOGIN_INVALID_TWO_FACTOR_CODE);
    }
  }
  adminDb().clearAuthFailures(username);
  await adminDb().touchLogin(account.id);
  const token = adminDb().newToken();
  await adminDb().saveToken(token, account.id);
  ok(ctx.res, {
    token,
    username: account.username,
    roles: staff.roles,
    permissions: [...permissionsForRoles(staff.roles)],
  });
}

/** GET /admin/api/overview: headline counts merged with live server stats. */
async function overviewHandler(ctx: Ctx): Promise<void> {
  const rt = useAdminRuntime();
  const counts = await adminDb().overviewCounts();
  const serverStats = rt.adminStats();
  ok(ctx.res, {
    ...counts,
    peakOnlineToday: Math.max(counts.peakOnlineToday, serverStats.online),
    peakOnlineAllTime: Math.max(counts.peakOnlineAllTime, serverStats.online),
    playersCap: adminPlayersCap(),
    server: {
      ...serverStats,
      peakOnline: Math.max(serverStats.peakOnline, counts.peakOnlineAllTime, serverStats.online),
    },
  });
}

/** GET /admin/api/me: the caller's own staff identity (any staff role). */
async function meHandler(ctx: Ctx): Promise<void> {
  const identity = adminIdentityOf(ctx);
  ok(ctx.res, {
    username: identity.username,
    roles: identity.roles,
    permissions: [...identity.permissions],
  });
}

/**
 * GET /admin/api/provider-usage: request counts + cache stats. Its own permission
 * (ops_usage.read), held only by admin/superadmin, so it lives on a dedicated
 * route rather than riding inside the analytics.read overview.
 */
async function providerUsageHandler(ctx: Ctx): Promise<void> {
  ok(ctx.res, { usage: adminDb().providerUsageSnapshot() });
}

// Staff role management. superadmin is out of the dashboard's reach in both
// directions (grant and revoke): it moves only via the grant script or SQL, so a
// compromised dashboard session cannot mint one. Own-account edits are refused so
// an operator cannot lock themselves out silently.

/** GET /admin/api/staff: every staff account plus the dashboard-grantable roles. */
async function staffListHandler(ctx: Ctx): Promise<void> {
  ok(ctx.res, {
    rows: await adminDb().listStaff(),
    assignableRoles: [...ASSIGNABLE_ADMIN_ROLES],
  });
}

/** GET /admin/api/staff/history: the most recent role-change audit rows. */
async function staffHistoryHandler(ctx: Ctx): Promise<void> {
  ok(ctx.res, { rows: await adminDb().roleChangeHistory(50) });
}

/** POST /admin/api/staff/roles: replace a target account's dashboard-grantable roles. */
async function staffRolesHandler(ctx: Ctx): Promise<void> {
  const body = await readBody(ctx.req);
  const roles = sanitizeRoles(body.roles);
  if (roles === null) return fail(ctx.res, 400, 'unknown role');
  if (roles.includes(SUPERADMIN_ROLE)) {
    return fail(ctx.res, 400, 'superadmin roles are managed via the grant script');
  }
  const target =
    typeof body.username === 'string' ? await adminDb().findAccount(body.username) : null;
  if (!target) return fail(ctx.res, 404, 'account not found');
  const accountId = adminIdentityOf(ctx).accountId;
  if (target.id === accountId) {
    return fail(ctx.res, 400, 'you cannot change your own roles');
  }
  const currentStaff = await adminDb().adminRolesForAccount(target.id);
  if (currentStaff?.roles.includes(SUPERADMIN_ROLE)) {
    return fail(ctx.res, 400, 'superadmin roles are managed via the grant script');
  }
  const change = await adminDb().setAccountAdminRoles({
    accountId: target.id,
    roles,
    actorAccountId: accountId,
  });
  if (!change) return fail(ctx.res, 404, 'account not found');
  // In-game permissions are snapshotted at WS join, so force the account's
  // live sessions to reconnect: a revoked moderator loses in-game commands
  // immediately instead of at their next voluntary relog.
  if (change.before.join(',') !== change.after.join(',')) {
    useAdminRuntime().disconnectAccount(target.id, IP_BLOCK_KICK_MESSAGE);
  }
  ok(ctx.res, { ok: true, username: target.username, roles: change.after });
}

/** GET /admin/api/antibot-config: the detector's tunable fields + last-saved stamp. */
async function antibotConfigGetHandler(ctx: Ctx): Promise<void> {
  const stored = await adminDb().loadAntibotConfig();
  ok(ctx.res, { fields: useAdminRuntime().antibotConfigFields(), updatedAt: stored.updatedAt });
}

/** GET /admin/api/antibot-config/history: the append-only override audit trail. */
async function antibotConfigHistoryHandler(ctx: Ctx): Promise<void> {
  ok(ctx.res, { entries: await adminDb().listAntibotConfigHistory() });
}

/**
 * POST /admin/api/antibot-config: validate-apply-persist, mirroring the legacy
 * handleAntibotConfigSave byte-for-byte (shared serializer tail, so saves from
 * both dispatch arms serialize through the one in-flight chain; validation or
 * persistence failure re-applies the previous effective document).
 */
async function antibotConfigSaveHandler(ctx: Ctx): Promise<void> {
  const rt = useAdminRuntime();
  const body = await readBody(ctx.req);
  const overrides = body.overrides;
  if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) {
    return fail(ctx.res, 400, 'an overrides object is required');
  }
  const note =
    typeof body.note === 'string' ? body.note.trim().slice(0, ANTIBOT_CONFIG_NOTE_MAX) : '';
  return serializeAntibotConfigSave(async () => {
    const previousEffective = effectiveAntibotOverrides(rt);
    const result = rt.applyAntibotConfig(overrides as Record<string, unknown>);
    if (result.errors.length > 0) {
      rt.applyAntibotConfig(previousEffective);
      return fail(ctx.res, 400, result.errors.join('; '));
    }
    const effective = effectiveAntibotOverrides(rt);
    try {
      const saved = await adminDb().saveAntibotConfigChange(
        effective,
        adminIdentityOf(ctx).accountId,
        note,
      );
      ok(ctx.res, { fields: rt.antibotConfigFields(), updatedAt: saved.updatedAt });
    } catch (err) {
      rt.applyAntibotConfig(previousEffective);
      throw err;
    }
  });
}

/** GET /admin/api/online: live player rows. */
async function onlineHandler(ctx: Ctx): Promise<void> {
  ok(ctx.res, { players: useAdminRuntime().liveSessions() });
}

/** GET /admin/api/suspicious-players: bot-detector flags. */
async function suspiciousPlayersHandler(ctx: Ctx): Promise<void> {
  ok(ctx.res, { players: useAdminRuntime().suspiciousPlayers() });
}

/** GET /admin/api/detection-calibration: bot-detector calibration histograms. */
async function detectionCalibrationHandler(ctx: Ctx): Promise<void> {
  ok(ctx.res, useAdminRuntime().detectionCalibration());
}

/** GET /admin/api/online-history: bucketed online + site-user history. */
async function onlineHistoryHandler(ctx: Ctx): Promise<void> {
  ok(ctx.res, await adminDb().onlineHistory(ctx.url.searchParams.get('range') ?? '30d'));
}

/** GET /admin/api/activity: registrations + sessions + class/level distributions. */
async function activityHandler(ctx: Ctx): Promise<void> {
  const [registrations, sessions, classes, levels] = await Promise.all([
    adminDb().registrationsByDay(ACTIVITY_WINDOW_DAYS),
    adminDb().sessionsByDay(ACTIVITY_WINDOW_DAYS),
    adminDb().classDistribution(),
    adminDb().levelDistribution(),
  ]);
  ok(ctx.res, { days: ACTIVITY_WINDOW_DAYS, registrations, sessions, classes, levels });
}

/** GET /admin/api/perf/summary: aggregated client-perf percentiles. */
async function perfSummaryHandler(ctx: Ctx): Promise<void> {
  const hours = Number(ctx.url.searchParams.get('hours') ?? '24');
  ok(ctx.res, await adminDb().clientPerfSummary(hours));
}

/** GET /admin/api/perf/raw: keyset-paged raw perf rows (hasMore math preserved). */
async function perfRawHandler(ctx: Ctx): Promise<void> {
  const hours = Number(ctx.url.searchParams.get('hours') ?? '24');
  const limit = Number(ctx.url.searchParams.get('limit') ?? '100');
  const beforeIdParam = ctx.url.searchParams.get('beforeId');
  const beforeId = beforeIdParam === null ? undefined : Number(beforeIdParam);
  const rows = await adminDb().clientPerfRaw(hours, limit, beforeId);
  ok(ctx.res, {
    rows,
    nextBeforeId: rows.length > 0 ? rows[rows.length - 1].id : null,
    hasMore:
      rows.length >= Math.min(1000, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 100))),
  });
}

/** GET /admin/api/perf/tick: server tick-loop capture status + last frozen result. */
async function perfTickHandler(ctx: Ctx): Promise<void> {
  ok(ctx.res, useAdminRuntime().perfCaptureStatus());
}

/**
 * POST /admin/api/perf/tick/capture: start an on-demand tick-loop profiling capture.
 * Mirrors the legacy handleAdminApi arm: a non-numeric/NaN durationMs falls back to
 * the default; the window is clamped server-side in startPerfCapture.
 */
async function perfTickCaptureHandler(ctx: Ctx): Promise<void> {
  const body = await readBody(ctx.req);
  const raw = body.durationMs;
  const durationMs = typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
  ok(ctx.res, useAdminRuntime().startPerfCapture(durationMs));
}

/** GET /admin/api/accounts: paged, sortable account search (search clamped to 64 chars). */
async function accountsHandler(ctx: Ctx): Promise<void> {
  const { page, limit } = parsePageParams(ctx.url.searchParams);
  const search = (ctx.url.searchParams.get('search') ?? '').slice(0, 64);
  const { sort, dir } = parseAdminAccountSort(ctx.url.searchParams);
  ok(ctx.res, await adminDb().listAccounts(search, page, limit, sort, dir));
}

/** GET /admin/api/guilds: current-realm guild search with bounded pagination. */
async function guildsHandler(ctx: Ctx): Promise<void> {
  const { page, limit } = parsePageParams(ctx.url.searchParams);
  const search = ctx.url.searchParams.get('search') ?? '';
  const { sort, dir } = parseAdminGuildSort(ctx.url.searchParams);
  await sendAdminGuildList(ctx.res, { search, page, limit, sort, dir }, () =>
    adminDb().listAdminGuilds(search, page, limit, sort, dir),
  );
}

/** GET /admin/api/guilds/:id: minimal roster with a cheap live online merge. */
async function guildDetailHandler(ctx: Ctx): Promise<void> {
  const detail = await adminDb().adminGuildDetail(adminTargetId(ctx));
  if (!detail) return fail(ctx.res, 404, 'guild not found');
  const onlineIds = useAdminRuntime().liveCharacterIds();
  ok(ctx.res, {
    guild: detail.guild,
    members: detail.members.map((member) => ({
      ...member,
      online: onlineIds.has(member.characterId),
    })),
  });
}

/** GET /admin/api/guilds/:id/history: retained moderation rename audit. */
async function guildHistoryHandler(ctx: Ctx): Promise<void> {
  const rows = await adminDb().listAdminGuildHistory(adminTargetId(ctx));
  if (rows === null) return fail(ctx.res, 404, 'guild not found');
  ok(ctx.res, { rows });
}

/** POST /admin/api/guilds/:id/rename: atomic rename, audit, then bounded live push. */
async function guildRenameHandler(ctx: Ctx): Promise<void> {
  const body = await readBody(ctx.req);
  const renamed = await adminDb().renameAdminGuild(
    adminTargetId(ctx),
    typeof body.name === 'string' ? body.name : '',
    typeof body.reason === 'string' ? body.reason : '',
    ctxAccountId(ctx),
  );
  if ('error' in renamed) {
    const failure = guildRenameFailure(renamed.error);
    return fail(ctx.res, failure.status, failure.message);
  }
  useAdminRuntime().social.guildRenamed(
    renamed.result.guildId,
    renamed.result.oldName,
    renamed.result.newName,
    renamed.result.memberCharacterIds,
  );
  bustAdminGuildBoardCaches();
  ok(ctx.res, { id: renamed.result.guildId, name: renamed.result.newName });
}

/** GET /admin/api/guilds/:id/bank: the live book behind the escape hatch (see
 *  guildBankStateOutcome for the shared body, and
 *  server/admin_guild_bank_view.ts for what the payload deliberately omits). */
function guildBankStateHandler(ctx: Ctx): void {
  const outcome = guildBankStateOutcome(useAdminRuntime(), adminTargetId(ctx));
  if (!outcome.ok) {
    fail(ctx.res, outcome.status, outcome.message);
    return;
  }
  ok(ctx.res, outcome.body);
}

/** POST /admin/api/guilds/:id/bank/purge-slot: the dormant guild bank slot
 *  escape hatch (see purgeGuildBankSlotOutcome for the shared body). */
async function guildBankPurgeSlotHandler(ctx: Ctx): Promise<void> {
  const body = await readBody(ctx.req);
  const outcome = await purgeGuildBankSlotOutcome(
    useAdminRuntime(),
    adminTargetId(ctx),
    ctxAccountId(ctx),
    body,
  );
  if (!outcome.ok) return fail(ctx.res, outcome.status, outcome.message);
  ok(ctx.res, outcome.body);
}

/** GET /admin/api/shared-ips: paged shared IPs; the online=1 branch reads live. */
async function sharedIpsHandler(ctx: Ctx): Promise<void> {
  const rt = useAdminRuntime();
  const { page, limit } = parsePageParams(ctx.url.searchParams);
  const { sort, dir } = sharedIpSortParams(ctx.url.searchParams);
  if (ctx.url.searchParams.get('online') === '1') {
    const rows = sortSharedIpRows(rt.liveSharedIps(), sort, dir);
    const offset = (page - 1) * limit;
    ok(ctx.res, {
      rows: rows.slice(offset, offset + limit).map((row) => ({
        ...row,
        blocked: rt.isIpBlocked(row.ip),
      })),
      total: rows.length,
      page,
      limit,
    });
    return;
  }
  const sharedIps = await adminDb().listSharedIps(page, limit, sort, dir);
  ok(ctx.res, {
    ...sharedIps,
    rows: sharedIps.rows.map((row) => ({ ...row, blocked: rt.isIpBlocked(row.ip) })),
  });
}

/** GET /admin/api/ip-associations: accounts tied to one stored IP marker, with live flags. */
async function ipAssociationsHandler(ctx: Ctx): Promise<void> {
  const rt = useAdminRuntime();
  const ip = cleanIpAssociationLookup(ctx.url.searchParams.get('ip'));
  if (!ip) return fail(ctx.res, 400, 'a valid IP address is required');
  const { page, limit } = parsePageParams(ctx.url.searchParams);
  const associations = await adminDb().associationsForIp(ip, page, limit);
  const onlineAccountIds = rt.liveAccountIds();
  const blockableIp = adminDb().cleanIp(ip);
  ok(ctx.res, {
    ...associations,
    accounts: associations.accounts.map((account) => ({
      ...account,
      online: onlineAccountIds.has(account.accountId),
    })),
    blocked: blockableIp ? rt.isIpBlocked(blockableIp) : false,
    blockable: Boolean(blockableIp),
  });
}

/** GET /admin/api/blocked-ips: the block list. */
async function blockedIpsGetHandler(ctx: Ctx): Promise<void> {
  ok(ctx.res, { rows: await adminDb().listBlockedIps() });
}

/** POST /admin/api/blocked-ips: add a block, reload the live list, kick the IP. */
async function blockedIpsPostHandler(ctx: Ctx): Promise<void> {
  const rt = useAdminRuntime();
  const body = await readBody(ctx.req);
  const cleanedIp = adminDb().cleanIp(body.ip);
  if (!cleanedIp) return fail(ctx.res, 400, 'a valid IP address is required');
  try {
    const ip = await adminDb().addBlockedIp({
      ip: cleanedIp,
      reason: body.reason,
      createdByAccountId: ctxAccountId(ctx),
      expiresAt: body.expiresAt,
    });
    if (!ip) return fail(ctx.res, 400, 'a valid IP address is required');
    await rt.reloadBlockedIps();
    rt.disconnectByIp(ip, IP_BLOCK_KICK_MESSAGE);
    return ok(ctx.res, { ok: true });
  } catch (err) {
    return fail(ctx.res, 400, err instanceof Error ? err.message : 'failed to block IP');
  }
}

/** POST /admin/api/blocked-ips/delete: remove a block, reload the live list. */
async function blockedIpsDeleteHandler(ctx: Ctx): Promise<void> {
  const rt = useAdminRuntime();
  const body = await readBody(ctx.req);
  if (!adminDb().cleanIp(body.ip)) return fail(ctx.res, 400, 'a valid IP address is required');
  const removed = await adminDb().removeBlockedIp(body.ip, ctxAccountId(ctx));
  if (removed) await rt.reloadBlockedIps();
  return removed ? ok(ctx.res, { ok: true }) : fail(ctx.res, 404, 'IP not found');
}

/** POST /admin/api/moderation/accounts/:id/:action: the schema-validated sanction. */
async function moderateActionHandler(ctx: Ctx): Promise<void> {
  const rt = useAdminRuntime();
  const targetAccountId = adminTargetId(ctx);
  const actionDecoded = MODERATION_ACTION_SCHEMA.decode(ctx.params.action, '/action');
  // A raw { ok:false, issues } maps to 422 validation.failed. Unreachable in
  // production (the central permission gate 404s a fifth action pre-decode); kept
  // as the defensive backstop the superseded adminEnumInvalid422 entry documents.
  if (!actionDecoded.ok) throw actionDecoded;
  const action = actionDecoded.value;
  if (
    (action === 'suspend' || action === 'ban') &&
    (await adminDb().isAdminAccount(targetAccountId))
  ) {
    return fail(ctx.res, 400, 'admin accounts cannot be suspended or banned');
  }
  const body = await readBody(ctx.req);
  try {
    await adminDb().moderateAccount({
      accountId: targetAccountId,
      adminAccountId: ctxAccountId(ctx),
      action,
      reason: body.reason,
      expiresAt: body.expiresAt,
    });
    if (action === 'suspend' || action === 'ban') {
      const statusText =
        action === 'ban' ? 'This account has been banned.' : 'This account is suspended.';
      // Every device is signed out here too, mirroring resetPasswordHandler: revoke
      // all tokens then disconnect the live socket (revocation alone leaves an
      // already-open connection intact). Otherwise a token issued before the
      // sanction stays valid in auth_tokens and regains access with no
      // re-authentication the moment the sanction is lifted or expires.
      await adminDb().revokeTokensExcept(targetAccountId, null);
      rt.disconnectAccount(targetAccountId, statusText);
      // Notify the affected account of the moderation action. Best-effort and fully
      // isolated: a mail-target lookup or send failure must never turn a successful
      // moderation action into an error response.
      void adminDb()
        .accountMailTarget(targetAccountId)
        .then((target) => {
          if (!target) return;
          const reasonText =
            typeof body.reason === 'string' && body.reason.trim()
              ? body.reason.trim()
              : 'not specified';
          const until =
            action === 'ban'
              ? 'permanent'
              : typeof body.expiresAt === 'string' && body.expiresAt
                ? body.expiresAt
                : 'until reviewed';
          adminDb().emailSecurityIncident(target, action, reasonText, until);
        })
        .catch((err) => logger.error({ err }, 'security-incident email failed'));
    }
    return ok(ctx.res, { ok: true });
  } catch (err) {
    return fail(ctx.res, 400, err instanceof Error ? err.message : 'moderation action failed');
  }
}

/** POST /admin/api/moderation/accounts/:id/reactivate: reverse a self-deactivation. */
async function reactivateHandler(ctx: Ctx): Promise<void> {
  const id = adminTargetId(ctx);
  const body = await readBody(ctx.req);
  try {
    await adminDb().reactivateAccountAudited({
      accountId: id,
      adminAccountId: ctxAccountId(ctx),
      reason: body.reason,
    });
    return ok(ctx.res, { ok: true });
  } catch (err) {
    return fail(ctx.res, 400, err instanceof Error ? err.message : 'reactivation failed');
  }
}

/** POST /admin/api/moderation/accounts/:id/chat-mute: timed chat mute + live push. */
async function chatMuteHandler(ctx: Ctx): Promise<void> {
  const rt = useAdminRuntime();
  const targetAccountId = adminTargetId(ctx);
  if (await adminDb().isAdminAccount(targetAccountId)) {
    return fail(ctx.res, 400, 'admin accounts cannot be chat muted');
  }
  const body = await readBody(ctx.req);
  try {
    await adminDb().muteAccountChat({
      accountId: targetAccountId,
      adminAccountId: ctxAccountId(ctx),
      reason: body.reason,
      expiresAt: body.expiresAt,
    });
    rt.muteAccountChat(targetAccountId, String(body.expiresAt ?? ''), String(body.reason ?? ''));
    return ok(ctx.res, { ok: true });
  } catch (err) {
    return fail(ctx.res, 400, err instanceof Error ? err.message : 'chat mute failed');
  }
}

/** POST daily-rewards-ban/unban: change reward eligibility with an audited reason. */
async function dailyRewardsBanHandler(ctx: Ctx): Promise<void> {
  const banned = ctx.path.endsWith('/daily-rewards-ban');
  const body = await readBody(ctx.req);
  try {
    await adminDb().setDailyRewardsBan({
      accountId: adminTargetId(ctx),
      adminAccountId: ctxAccountId(ctx),
      banned,
      reason: body.reason,
      durationHours: body.durationHours,
    });
    return ok(ctx.res, { ok: true });
  } catch (err) {
    return fail(
      ctx.res,
      400,
      err instanceof Error ? err.message : 'daily rewards moderation failed',
    );
  }
}

async function dailyRewardsIpBanHandler(ctx: Ctx): Promise<void> {
  const banned = ctx.path.endsWith('/daily-rewards-ip-ban');
  const body = await readBody(ctx.req);
  try {
    await adminDb().setDailyRewardsIpBan({
      accountId: adminTargetId(ctx),
      adminAccountId: ctxAccountId(ctx),
      ip: body.ip,
      banned,
      reason: body.reason,
    });
    return ok(ctx.res, { ok: true });
  } catch (err) {
    return fail(
      ctx.res,
      400,
      err instanceof Error ? err.message : 'daily rewards IP moderation failed',
    );
  }
}

/** POST /admin/api/moderation/reports/:id/ignore: resolve one open report. */
async function ignoreReportHandler(ctx: Ctx): Promise<void> {
  const body = await readBody(ctx.req);
  const ignored = await adminDb().ignoreReport(adminTargetId(ctx), ctxAccountId(ctx), body.note);
  return ignored ? ok(ctx.res, { ok: true }) : fail(ctx.res, 404, 'open report not found');
}

/** POST /admin/api/moderation/characters/:id/force-rename: flag + kick the owner. */
async function forceRenameHandler(ctx: Ctx): Promise<void> {
  const rt = useAdminRuntime();
  const body = await readBody(ctx.req);
  try {
    const result = await adminDb().forceCharacterRename({
      characterId: adminTargetId(ctx),
      adminAccountId: ctxAccountId(ctx),
      reason: body.reason,
    });
    rt.disconnectAccount(
      result.accountId,
      'A moderator requires one of your characters to be renamed.',
    );
    return ok(ctx.res, { ok: true });
  } catch (err) {
    return fail(ctx.res, 400, err instanceof Error ? err.message : 'force rename failed');
  }
}

/** POST /admin/api/moderation/accounts/:id/lift-mute: clear a chat mute + live push. */
async function liftMuteHandler(ctx: Ctx): Promise<void> {
  const rt = useAdminRuntime();
  const id = adminTargetId(ctx);
  const body = await readBody(ctx.req);
  try {
    await adminDb().liftAccountChatMute({
      accountId: id,
      adminAccountId: ctxAccountId(ctx),
      reason: body.reason,
    });
    rt.liftChatMuteLive(id);
    return ok(ctx.res, { ok: true });
  } catch (err) {
    return fail(ctx.res, 400, err instanceof Error ? err.message : 'chat unmute failed');
  }
}

/** POST /admin/api/moderation/accounts/:id/note: append a non-punitive audit note. */
async function noteHandler(ctx: Ctx): Promise<void> {
  const id = adminTargetId(ctx);
  const body = await readBody(ctx.req);
  try {
    await adminDb().addAccountNote({
      accountId: id,
      adminAccountId: ctxAccountId(ctx),
      note: body.reason,
    });
    return ok(ctx.res, { ok: true });
  } catch (err) {
    return fail(ctx.res, 400, err instanceof Error ? err.message : 'failed to add note');
  }
}

/** POST /admin/api/moderation/accounts/:id/reset-strikes: zero strikes + live push. */
async function resetStrikesHandler(ctx: Ctx): Promise<void> {
  const rt = useAdminRuntime();
  const id = adminTargetId(ctx);
  const body = await readBody(ctx.req);
  try {
    const reset = await adminDb().resetChatStrikesAudited({
      accountId: id,
      adminAccountId: ctxAccountId(ctx),
      reason: body.reason,
    });
    if (reset) rt.resetChatStrikesLive(id);
    return reset ? ok(ctx.res, { ok: true }) : fail(ctx.res, 404, 'account not found');
  } catch (err) {
    return fail(ctx.res, 400, err instanceof Error ? err.message : 'chat strikes reset failed');
  }
}

/** GET /admin/api/moderation/queue: accounts with open reports. */
async function moderationQueueHandler(ctx: Ctx): Promise<void> {
  ok(ctx.res, { rows: await adminDb().moderationQueue(useAdminRuntime().liveAccountIds()) });
}

/** GET /admin/api/moderation/history: latest audit actions, optionally scoped to caller. */
async function moderationHistoryHandler(ctx: Ctx): Promise<void> {
  const { page, limit } = parsePageParams(ctx.url.searchParams);
  ok(
    ctx.res,
    await adminDb().listModerationActions(
      moderationHistoryTab(ctx.url.searchParams),
      ctxAccountId(ctx),
      page,
      limit,
    ),
  );
}

/** GET /admin/api/moderation/accounts/:id: full moderation detail for one account. */
async function moderationAccountDetailHandler(ctx: Ctx): Promise<void> {
  const rt = useAdminRuntime();
  const id = adminTargetId(ctx);
  const [detail, reports, chat] = await Promise.all([
    adminDb().accountDetail(id),
    adminDb().moderationReportsForAccount(id),
    adminDb().chatModerationForAccount(id),
  ]);
  if (!detail) return fail(ctx.res, 404, 'account not found');
  ok(ctx.res, {
    account: { ...detail, online: rt.liveAccountIds().has(id) },
    reports,
    chat,
    blockedIps: getBlockedIpsForAccount(rt, detail),
  });
}

/** GET /admin/api/accounts/:id: one account's detail with a live online flag. */
async function accountDetailHandler(ctx: Ctx): Promise<void> {
  const rt = useAdminRuntime();
  const id = adminTargetId(ctx);
  const detail = await adminDb().accountDetail(id);
  if (!detail) return fail(ctx.res, 404, 'account not found');
  ok(ctx.res, { ...detail, online: rt.liveAccountIds().has(id) });
}

/** GET /admin/api/characters/:id/professions: the R35 professions inspector.
 *  A live character reads a fresh serializeCharacter snapshot (the stored
 *  blob lags the 30s autosave); an offline one reads the stored blob, whose
 *  updatedAt tells the operator which clock the node timers anchor to. */
async function characterProfessionsHandler(ctx: Ctx): Promise<void> {
  const rt = useAdminRuntime();
  const id = adminTargetId(ctx);
  // Live snapshot FIRST: when one exists the stored blob is discarded, so
  // the query skips detoasting the widest column in the schema for nothing.
  const liveState = rt.adminCharacterState(id);
  const row = await adminDb().characterProfessionsRow(id, liveState === null);
  if (!row) return fail(ctx.res, 404, 'character not found');
  ok(ctx.res, characterProfessionsSheetFromRow(row, liveState));
}

/** POST /admin/api/moderation/characters/:id/restore-item: the R35 GM item
 *  restore. Order is deliberate: validate (no audit row for an impossible
 *  grant), require the character online HERE, write the audit row, then the
 *  sync live mint, so a grant can never exist unaudited; the rare
 *  leave-between-audit-and-mint race surfaces as an explicit 400 and the
 *  audit row honestly records the attempt. */
async function restoreItemHandler(ctx: Ctx): Promise<void> {
  const rt = useAdminRuntime();
  const id = adminTargetId(ctx);
  const body = await readBody(ctx.req);
  const bodyError = restoreItemBodyError(body);
  if (bodyError) return fail(ctx.res, 400, bodyError);
  const itemId = String(body.itemId);
  const count = Number(body.count);
  try {
    if (!rt.adminCharacterOnline(id)) {
      return fail(ctx.res, 400, 'character is not online on this realm');
    }
    await adminDb().recordProfessionsRestore({
      characterId: id,
      adminAccountId: ctxAccountId(ctx),
      action: 'restore_item',
      detail: `${itemId} x${count}`,
      reason: body.reason,
    });
    const result = rt.adminRestoreItem(id, itemId, count);
    // Defensive twin of the pre-audit body check; reachable only if the
    // runtime and validator ever disagree about ITEMS.
    if (result === 'invalid_item') return fail(ctx.res, 400, 'unknown item id');
    if (result !== 'ok') {
      return fail(ctx.res, 400, 'character went offline before the restore landed');
    }
    return ok(ctx.res, { ok: true });
  } catch (err) {
    return fail(ctx.res, 400, err instanceof Error ? err.message : 'item restore failed');
  }
}

/** POST /admin/api/moderation/characters/:id/restore-slot: the R35 GM
 *  tool-effect slot re-mint, same ordering contract as restore-item; the
 *  sim action refuses no_tool (charges are sized by the best owned tool,
 *  so the tool must be restored first). */
async function restoreSlotHandler(ctx: Ctx): Promise<void> {
  const rt = useAdminRuntime();
  const id = adminTargetId(ctx);
  const body = await readBody(ctx.req);
  const bodyError = restoreSlotBodyError(body);
  if (bodyError) return fail(ctx.res, 400, bodyError);
  const professionId = String(body.professionId);
  const effectId = String(body.effectId);
  try {
    if (!rt.adminCharacterOnline(id)) {
      return fail(ctx.res, 400, 'character is not online on this realm');
    }
    await adminDb().recordProfessionsRestore({
      characterId: id,
      adminAccountId: ctxAccountId(ctx),
      action: 'restore_slot',
      detail: `${professionId}/${effectId}`,
      reason: body.reason,
    });
    const result = rt.adminRestoreToolEffectSlot(id, professionId, effectId);
    if (result === 'no_tool') {
      return fail(ctx.res, 400, 'the character owns no tool for that profession');
    }
    // A restore is for a row that is GONE: an overwrite would destroy the
    // live row's provenance, confirm mode, and ratcheted ceiling.
    if (result === 'already_slotted') {
      return fail(ctx.res, 400, 'that profession already has a slotted effect');
    }
    // Defense-in-depth only since the phase 18 close: restoreSlotBodyError
    // now runs the same pure pair-validity policy BEFORE the audit write, so
    // this arm is reachable only if the validator and the sim action ever
    // disagree (a content change landing between the two checks).
    if (result === 'invalid_request') {
      return fail(ctx.res, 400, 'that effect cannot be slotted on that profession');
    }
    if (result !== 'ok') {
      return fail(ctx.res, 400, 'character went offline before the restore landed');
    }
    return ok(ctx.res, { ok: true });
  } catch (err) {
    return fail(ctx.res, 400, err instanceof Error ? err.message : 'slot restore failed');
  }
}

/** GET /admin/api/accounts/:id/daily-rewards-events: bounded point-award ledger. */
async function dailyRewardPointEventsHandler(ctx: Ctx): Promise<void> {
  const day = await dailyRewardEventDay(ctx.url.searchParams.get('day'));
  if (!day) return fail(ctx.res, 400, DAILY_REWARD_EVENT_DAY_REQUIRED);
  const limit = Number(ctx.url.searchParams.get('limit') ?? '100');
  ok(ctx.res, await adminDb().dailyRewardPointEvents(adminTargetId(ctx), day, limit));
}

/**
 * POST /admin/api/accounts/:id/reset-password: set a new password on any account.
 * Audit row first (no live effect without its record), then the credential write,
 * then every device is signed out: all tokens revoked plus a live WS disconnect
 * (token revocation alone leaves an already-open socket connected). A staff
 * target is refused unless the actor is a superadmin, mirroring the
 * isAdminAccount guard on suspend/ban/chat-mute.
 */
async function resetPasswordHandler(ctx: Ctx): Promise<void> {
  const rt = useAdminRuntime();
  const targetAccountId = adminTargetId(ctx);
  if (
    (await adminDb().isAdminAccount(targetAccountId)) &&
    !adminIdentityOf(ctx).roles.includes(SUPERADMIN_ROLE)
  ) {
    return fail(ctx.res, 400, 'only a superadmin can reset a staff password');
  }
  const body = await readBody(ctx.req);
  const password = body.password;
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return fail(ctx.res, 400, `password must be at least ${MIN_PASSWORD_LENGTH} chars`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return fail(ctx.res, 400, `password must be at most ${MAX_PASSWORD_LENGTH} chars`);
  }
  if (!(await adminDb().accountById(targetAccountId))) {
    return fail(ctx.res, 404, 'account not found');
  }
  try {
    await adminDb().recordPasswordReset({
      accountId: targetAccountId,
      adminAccountId: ctxAccountId(ctx),
      reason: body.reason,
    });
    await adminDb().updatePasswordHash(targetAccountId, await adminDb().hashPassword(password));
    await adminDb().revokeTokensExcept(targetAccountId, null);
    rt.disconnectAccount(targetAccountId, IP_BLOCK_KICK_MESSAGE);
    return ok(ctx.res, { ok: true });
  } catch (err) {
    return fail(ctx.res, 400, err instanceof Error ? err.message : 'password reset failed');
  }
}

/**
 * POST /admin/api/accounts/:id/ai: mark the account as AI-operated (or clear it).
 * Cosmetic and non-punitive: no reason is required and, unlike suspend/ban/chat-mute,
 * there is NO isAdminAccount guard (a staff account can legitimately carry flair).
 * The audited write lands first, then the freshly-read flair is pushed to any live
 * session so a connected player sees it without reconnecting.
 */
async function accountAiFlagHandler(ctx: Ctx): Promise<void> {
  const rt = useAdminRuntime();
  const targetAccountId = adminTargetId(ctx);
  const body = await readBody(ctx.req);
  if (typeof body.ai !== 'boolean') return fail(ctx.res, 400, AI_FLAG_REQUIRED);
  try {
    await adminDb().setAccountAiFlag({
      accountId: targetAccountId,
      adminAccountId: ctxAccountId(ctx),
      ai: body.ai,
      reason: body.reason,
    });
    rt.applyAccountFlairLive(targetAccountId, await adminDb().loadAccountFlair(targetAccountId));
    return ok(ctx.res, { ok: true });
  } catch (err) {
    return fail(ctx.res, 400, err instanceof Error ? err.message : ACCOUNT_FLAIR_FAILED);
  }
}

/**
 * POST /admin/api/accounts/:id/streamer: set the streamer flag + platform links.
 * Every link is validated by normalizeStreamerLink inside the db write (https only,
 * that platform's own hosts, no credentials): a hostile value throws before any row
 * changes, so a rejected link never reaches the database, let alone a client.
 */
async function accountStreamerFlairHandler(ctx: Ctx): Promise<void> {
  const rt = useAdminRuntime();
  const targetAccountId = adminTargetId(ctx);
  const body = await readBody(ctx.req);
  if (typeof body.streamer !== 'boolean') return fail(ctx.res, 400, STREAMER_FLAG_REQUIRED);
  const links = streamerLinksBody(body.links);
  if (links === null) return fail(ctx.res, 400, STREAMER_LINKS_REQUIRED);
  try {
    await adminDb().setAccountStreamerFlair({
      accountId: targetAccountId,
      adminAccountId: ctxAccountId(ctx),
      streamer: body.streamer,
      links,
      reason: body.reason,
    });
    rt.applyAccountFlairLive(targetAccountId, await adminDb().loadAccountFlair(targetAccountId));
    return ok(ctx.res, { ok: true });
  } catch (err) {
    return fail(ctx.res, 400, err instanceof Error ? err.message : ACCOUNT_FLAIR_FAILED);
  }
}

/** GET /admin/api/chat-filter: word lists + escalation config + moderated accounts. */
async function chatFilterGetHandler(ctx: Ctx): Promise<void> {
  const [soft, hard, config, accounts] = await Promise.all([
    adminDb().listFilterWords('soft'),
    adminDb().listFilterWords('hard'),
    adminDb().getFilterConfig(),
    adminDb().chatModeratedAccounts(),
  ]);
  ok(ctx.res, { soft, hard, config, accounts });
}

/** POST /admin/api/chat-filter/words: add a filter word + reload the live filter. */
async function chatFilterWordsHandler(ctx: Ctx): Promise<void> {
  const body = await readBody(ctx.req);
  const tier = cleanTier(body.tier);
  if (!tier) return fail(ctx.res, 400, 'tier must be "soft" or "hard"');
  const added = await adminDb().addFilterWord(body.word, tier);
  if (!added) return fail(ctx.res, 400, 'word is empty after normalization');
  await useAdminRuntime().reloadChatFilter();
  return ok(ctx.res, { ok: true });
}

/** POST /admin/api/chat-filter/words/:id/delete: remove a filter word + reload. */
async function chatFilterWordDeleteHandler(ctx: Ctx): Promise<void> {
  const removed = await adminDb().removeFilterWord(adminTargetId(ctx));
  if (removed) await useAdminRuntime().reloadChatFilter();
  return removed ? ok(ctx.res, { ok: true }) : fail(ctx.res, 404, 'word not found');
}

/** POST /admin/api/chat-filter/config: update the escalation config + reload. */
async function chatFilterConfigHandler(ctx: Ctx): Promise<void> {
  const body = await readBody(ctx.req);
  const config = await adminDb().updateFilterConfig({
    warningsBeforeMute: body.warningsBeforeMute,
    muteLadderSeconds: body.muteLadderSeconds,
  });
  await useAdminRuntime().reloadChatFilter();
  return ok(ctx.res, config);
}

/** GET /admin/api/bug-reports: paged bug reports (screenshot omitted from the list). */
async function bugReportsHandler(ctx: Ctx): Promise<void> {
  const { page, limit } = parsePageParams(ctx.url.searchParams);
  const { rows, total } = await adminDb().listBugReports(limit, (page - 1) * limit);
  ok(ctx.res, { rows, total, page, limit });
}

/** GET /admin/api/unstuck-reports: bounded reports plus content-local hotspots. */
async function unstuckReportsHandler(ctx: Ctx): Promise<void> {
  const query = unstuckQuery(ctx.url.searchParams);
  const [page, hotspots] = await Promise.all([
    adminDb().listUnstuckReports({ realm: REALM, ...query }),
    query.beforeId === undefined
      ? adminDb().listUnstuckHotspots({
          realm: REALM,
          days: query.days,
          limit: UNSTUCK_HOTSPOT_MAX_LIMIT,
        })
      : Promise.resolve<DbUnstuckHotspotRow[]>([]),
  ]);
  ok(ctx.res, adminUnstuckPayload(page, hotspots, query));
}

/** GET /admin/api/bug-reports/:id/screenshot: one report's screenshot on demand. */
async function bugScreenshotHandler(ctx: Ctx): Promise<void> {
  ok(ctx.res, { screenshot: await adminDb().getBugReportScreenshot(adminTargetId(ctx)) });
}

/** POST /admin/api/bug-reports/:id/(resolve|dismiss): close an open bug report, audited. */
function bugReportResolveHandler(status: BugReportResolution) {
  return async (ctx: Ctx): Promise<void> => {
    const body = await readBody(ctx.req);
    const resolved = await adminDb().resolveBugReport(
      adminTargetId(ctx),
      ctxAccountId(ctx),
      status,
      body.note,
    );
    return resolved ? ok(ctx.res, { ok: true }) : fail(ctx.res, 404, 'open bug report not found');
  };
}
const bugReportResolveHandlerResolved = bugReportResolveHandler('resolved');
const bugReportResolveHandlerDismissed = bugReportResolveHandler('dismissed');

/** GET /admin/api/characters: paged, sortable character search. */
async function charactersHandler(ctx: Ctx): Promise<void> {
  const { page, limit } = parsePageParams(ctx.url.searchParams);
  const search = ctx.url.searchParams.get('search') ?? '';
  const sort = ctx.url.searchParams.get('sort') ?? 'level';
  const dir = ctx.url.searchParams.get('dir') === 'asc' ? 'asc' : 'desc';
  ok(ctx.res, await adminDb().listCharacters(search, sort, dir, page, limit));
}

// Map editor moderation (v0.20.0 release merge, migrated in-merge). Each handler
// mirrors its legacy handleAdminApi arm byte-for-byte over the same module-scope
// db singletons (adminMapsDb / adminUserAssetsDb).

/** GET /admin/api/maps: the paginated all-maps moderation list. */
async function adminMapsListHandler(ctx: Ctx): Promise<void> {
  const { page, limit } = parsePageParams(ctx.url.searchParams);
  const { rows, total } = await adminMapsDb().listAdmin(limit, (page - 1) * limit);
  ok(ctx.res, { rows, total, page, limit });
}

/** GET /admin/api/user-assets: the paginated uploaded-GLB moderation list. */
async function adminUserAssetsListHandler(ctx: Ctx): Promise<void> {
  const { page, limit } = parsePageParams(ctx.url.searchParams);
  const { rows, total } = await adminUserAssetsDb().listAdmin(limit, (page - 1) * limit);
  ok(ctx.res, { rows, total, page, limit });
}

/** POST /admin/api/maps/:id/unpublish: force a published map back to private, audited. */
async function adminMapUnpublishHandler(ctx: Ctx): Promise<void> {
  const body = await readBody(ctx.req);
  const done = await adminMapsDb().adminUnpublish(adminTargetId(ctx), {
    adminAccountId: adminIdentityOf(ctx).accountId,
    reason: cleanContentModerationReason(body.reason),
  });
  return done ? ok(ctx.res, { ok: true }) : fail(ctx.res, 404, 'map_not_found');
}

/** POST /admin/api/user-assets/:id/(block|unblock): flip an upload's moderation flag, audited. */
function adminAssetStatusHandler(status: 'blocked' | 'active') {
  return async (ctx: Ctx): Promise<void> => {
    const body = await readBody(ctx.req);
    const done = await adminUserAssetsDb().adminSetStatus(adminTargetId(ctx), status, {
      adminAccountId: adminIdentityOf(ctx).accountId,
      reason: cleanContentModerationReason(body.reason),
    });
    return done ? ok(ctx.res, { ok: true }) : fail(ctx.res, 404, 'asset_not_found');
  };
}
const adminAssetBlockHandler = adminAssetStatusHandler('blocked');
const adminAssetUnblockHandler = adminAssetStatusHandler('active');

// ---------------------------------------------------------------------------
// The route table. registry.ts spreads this into apiRoutes. login is anonymous
// (no requireAdmin, its own in-handler limiter); every other route carries
// requireAdmin, and each :id route also carries requireAdminTarget (operator-scope
// loader). All registered so an unsupported method / unknown path delegates to the
// legacy handleAdminApi ladder (the dispatcher delegates notFound / methodNotAllowed
// until the ladder-deletion PR, next release).
// ---------------------------------------------------------------------------

export const routes: RouteDef[] = [
  {
    method: 'POST',
    path: '/admin/api/login',
    surface: 'admin',
    meta: ADMIN_META,
    handler: loginHandler,
  },

  // Reads (17a).
  {
    method: 'GET',
    path: '/admin/api/me',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: meHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/overview',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: overviewHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/provider-usage',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: providerUsageHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/online',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: onlineHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/suspicious-players',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: suspiciousPlayersHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/detection-calibration',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: detectionCalibrationHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/online-history',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: onlineHistoryHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/activity',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: activityHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/perf/summary',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: perfSummaryHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/perf/raw',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: perfRawHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/perf/tick',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: perfTickHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/perf/tick/capture',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: perfTickCaptureHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/accounts',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: accountsHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/guilds',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: guildsHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/guilds/:id',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('guild')],
    meta: adminTargetMeta('guild'),
    handler: guildDetailHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/guilds/:id/history',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('guild')],
    meta: adminTargetMeta('guild'),
    handler: guildHistoryHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/guilds/:id/rename',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('guild')],
    meta: adminTargetMeta('guild'),
    handler: guildRenameHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/guilds/:id/bank',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('guild')],
    meta: adminTargetMeta('guild'),
    handler: guildBankStateHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/guilds/:id/bank/purge-slot',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('guild')],
    meta: adminTargetMeta('guild'),
    handler: guildBankPurgeSlotHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/shared-ips',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: sharedIpsHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/ip-associations',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: ipAssociationsHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/blocked-ips',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: blockedIpsGetHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/accounts/:id',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('account')],
    meta: adminTargetMeta('account'),
    handler: accountDetailHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/characters/:id/professions',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('character')],
    meta: adminTargetMeta('character'),
    handler: characterProfessionsHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/moderation/characters/:id/restore-item',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('character')],
    meta: adminTargetMeta('character'),
    handler: restoreItemHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/moderation/characters/:id/restore-slot',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('character')],
    meta: adminTargetMeta('character'),
    handler: restoreSlotHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/accounts/:id/daily-rewards-events',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('account')],
    meta: adminTargetMeta('account'),
    handler: dailyRewardPointEventsHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/accounts/:id/reset-password',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('account')],
    meta: adminTargetMeta('account'),
    handler: resetPasswordHandler,
  },

  // Account flair: the AI-operated mark and an official streamer's platform links.
  {
    method: 'POST',
    path: '/admin/api/accounts/:id/ai',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('account')],
    meta: adminTargetMeta('account'),
    handler: accountAiFlagHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/accounts/:id/streamer',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('account')],
    meta: adminTargetMeta('account'),
    handler: accountStreamerFlairHandler,
  },

  // Staff-role management (release v0.22.0 fine-grained permissions).
  {
    method: 'GET',
    path: '/admin/api/staff',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: staffListHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/staff/history',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: staffHistoryHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/staff/roles',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: staffRolesHandler,
  },

  // Bot-detector runtime config (release v0.22.0 #1433).
  {
    method: 'GET',
    path: '/admin/api/antibot-config',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: antibotConfigGetHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/antibot-config/history',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: antibotConfigHistoryHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/antibot-config',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: antibotConfigSaveHandler,
  },

  // IP block writes (17a).
  {
    method: 'POST',
    path: '/admin/api/blocked-ips',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: blockedIpsPostHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/blocked-ips/delete',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: blockedIpsDeleteHandler,
  },

  // Moderation (17b). The enum :action route sorts most-specific-LAST behind the
  // literal sibling action routes, so each resolves to its own handler.
  {
    method: 'POST',
    path: '/admin/api/moderation/accounts/:id/reactivate',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('account')],
    meta: adminTargetMeta('account'),
    handler: reactivateHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/moderation/accounts/:id/chat-mute',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('account')],
    meta: adminTargetMeta('account'),
    handler: chatMuteHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/moderation/accounts/:id/daily-rewards-ban',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('account')],
    meta: adminTargetMeta('account'),
    handler: dailyRewardsBanHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/moderation/accounts/:id/daily-rewards-unban',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('account')],
    meta: adminTargetMeta('account'),
    handler: dailyRewardsBanHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/moderation/accounts/:id/daily-rewards-ip-ban',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('account')],
    meta: adminTargetMeta('account'),
    handler: dailyRewardsIpBanHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/moderation/accounts/:id/daily-rewards-ip-unban',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('account')],
    meta: adminTargetMeta('account'),
    handler: dailyRewardsIpBanHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/moderation/accounts/:id/lift-mute',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('account')],
    meta: adminTargetMeta('account'),
    handler: liftMuteHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/moderation/accounts/:id/note',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('account')],
    meta: adminTargetMeta('account'),
    handler: noteHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/moderation/accounts/:id/reset-strikes',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('account')],
    meta: adminTargetMeta('account'),
    handler: resetStrikesHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/moderation/accounts/:id/:action',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('account')],
    meta: adminTargetMeta('account'),
    handler: moderateActionHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/moderation/reports/:id/ignore',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('report')],
    meta: adminTargetMeta('report'),
    handler: ignoreReportHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/moderation/characters/:id/force-rename',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('character')],
    meta: adminTargetMeta('character'),
    handler: forceRenameHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/moderation/queue',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: moderationQueueHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/moderation/history',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: moderationHistoryHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/moderation/accounts/:id',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('account')],
    meta: adminTargetMeta('account'),
    handler: moderationAccountDetailHandler,
  },

  // Chat filter (17b).
  {
    method: 'GET',
    path: '/admin/api/chat-filter',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: chatFilterGetHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/chat-filter/words',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: chatFilterWordsHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/chat-filter/words/:id/delete',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('word')],
    meta: adminTargetMeta('word'),
    handler: chatFilterWordDeleteHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/chat-filter/config',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: chatFilterConfigHandler,
  },

  // Bug reports + characters (17b).
  {
    method: 'GET',
    path: '/admin/api/bug-reports',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: bugReportsHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/unstuck-reports',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: unstuckReportsHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/bug-reports/:id/screenshot',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('bugReport')],
    meta: adminTargetMeta('bugReport'),
    handler: bugScreenshotHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/bug-reports/:id/resolve',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('bugReport')],
    meta: adminTargetMeta('bugReport'),
    handler: bugReportResolveHandlerResolved,
  },
  {
    method: 'POST',
    path: '/admin/api/bug-reports/:id/dismiss',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('bugReport')],
    meta: adminTargetMeta('bugReport'),
    handler: bugReportResolveHandlerDismissed,
  },
  {
    method: 'GET',
    path: '/admin/api/characters',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: charactersHandler,
  },

  // Map editor moderation (v0.20.0 release merge, migrated in-merge). The
  // (block|unblock) legacy regex group becomes two literal-suffix :id routes
  // (the publish/unpublish shape), so no enum decode and no 422 surface.
  {
    method: 'GET',
    path: '/admin/api/maps',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: adminMapsListHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/user-assets',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: adminUserAssetsListHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/maps/:id/unpublish',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('map')],
    meta: adminTargetMeta('map'),
    handler: adminMapUnpublishHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/user-assets/:id/block',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('user_asset')],
    meta: adminTargetMeta('user_asset'),
    handler: adminAssetBlockHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/user-assets/:id/unblock',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('user_asset')],
    meta: adminTargetMeta('user_asset'),
    handler: adminAssetUnblockHandler,
  },
];
