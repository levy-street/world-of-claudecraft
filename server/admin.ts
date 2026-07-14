import type * as http from 'node:http';
import {
  accountDetail,
  associationsForIp,
  classDistribution,
  clientPerfRaw,
  clientPerfSummary,
  levelDistribution,
  listAccounts,
  listCharacters,
  listModerationActions,
  listSharedIps,
  onlineHistory,
  overviewCounts,
  registrationsByDay,
  sessionsByDay,
} from './admin_db';
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
import { getBugReportScreenshot, listBugReports } from './bug_report_db';
import {
  addFilterWord,
  chatModeratedAccounts,
  chatModerationForAccount,
  getFilterConfig,
  listFilterWords,
  removeFilterWord,
  resetChatStrikes,
  updateFilterConfig,
  type WordTier,
} from './chat_filter_db';
import {
  accountById,
  accountForToken,
  accountMailTarget,
  findAccount,
  isAdminAccount,
  loadAccountFlair,
  pool,
  revokeTokensExcept,
  saveToken,
  setAccountDeactivated,
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
  moderationQueue,
  moderationReportsForAccount,
  muteAccountChat,
  recordPasswordReset,
  setAccountAiFlag,
  setAccountStreamerFlair,
  setDailyRewardsBan,
  setDailyRewardsIpBan,
} from './moderation_db';
import { providerUsageSnapshot } from './provider_usage';
import { rateLimited } from './ratelimit';
import {
  adminRolesForAccount,
  listStaff,
  roleChangeHistory,
  setAccountAdminRoles,
} from './staff_db';
import { PgUserAssetsDb } from './user_assets_db';

// Admin API: everything under /admin/api/*. Auth is a bearer token whose
// account has at least one staff role (accounts.admin_roles; is_admin stays
// the derived "is staff" flag): the admin.* hostname is routing, not security.
// Authorization is per route: every route is declared with a permission in
// admin_routes.ts and gated centrally in handleAdminApi before any handler
// runs, so a route absent from that table can never execute.

const ADMIN_LOGIN_MAX_PER_MINUTE = 10;
const MAX_PAGE_LIMIT = 200;
const DEFAULT_PAGE_LIMIT = 25;
const ACTIVITY_WINDOW_DAYS = 30;
const ANTIBOT_CONFIG_NOTE_MAX = 500;

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
  const accountId = await accountForToken(m[1]);
  if (accountId === null) return null;
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
  const account = typeof body.username === 'string' ? await findAccount(body.username) : null;
  if (!account || !(await verifyPassword(String(body.password ?? ''), account.password_hash))) {
    return fail(res, 401, 'invalid username or password');
  }
  const staff = await adminRolesForAccount(account.id);
  if (staff === null) {
    return fail(res, 403, 'this account does not have admin access');
  }
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
      try {
        await setAccountDeactivated(targetAccountId, false);
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
      const reset = await resetChatStrikes(id);
      if (reset) game.resetChatStrikesLive(id);
      return reset ? ok(res, { ok: true }) : fail(res, 404, 'account not found');
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
      try {
        const ip = await addBlockedIp({
          ip: body.ip,
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
    // byte GET and reject re-uploads of the same hash).
    const mapUnpublishMatch = /^\/admin\/api\/maps\/(\d+)\/unpublish$/.exec(path);
    if (req.method === 'POST' && mapUnpublishMatch) {
      const done = await adminMapsDb().setStatus(Number(mapUnpublishMatch[1]), null, 'private');
      return done ? ok(res, { ok: true }) : fail(res, 404, 'map_not_found');
    }
    const assetBlockMatch = /^\/admin\/api\/user-assets\/(\d+)\/(block|unblock)$/.exec(path);
    if (req.method === 'POST' && assetBlockMatch) {
      const status = assetBlockMatch[2] === 'block' ? 'blocked' : 'active';
      const done = await adminUserAssetsDb().setStatus(Number(assetBlockMatch[1]), status);
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
      const counts = await overviewCounts();
      const serverStats = game.adminStats();
      return ok(res, {
        ...counts,
        peakOnlineToday: Math.max(counts.peakOnlineToday, serverStats.online),
        peakOnlineAllTime: Math.max(counts.peakOnlineAllTime, serverStats.online),
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
      return ok(res, await listAccounts(search, page, limit));
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
      const ip = cleanIp(url.searchParams.get('ip'));
      if (!ip) return fail(res, 400, 'a valid IP address is required');
      const { page, limit } = parsePageParams(url.searchParams);
      const associations = await associationsForIp(ip, page, limit);
      const onlineAccountIds = game.liveAccountIds();
      return ok(res, {
        ...associations,
        accounts: associations.accounts.map((account) => ({
          ...account,
          online: onlineAccountIds.has(account.accountId),
        })),
        blocked: game.isIpBlocked(ip),
      });
    }
    if (path === '/admin/api/moderation/queue') {
      return ok(res, { rows: await moderationQueue(game.liveAccountIds()) });
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
//    adminIdentity(req) EXACTLY (v0.22.0 staff roles): bearer -> accountForToken ->
//    staff_db.adminRolesForAccount (fail closed; no roles means not staff), a
//    uniform 401 { ...error: 'admin authentication required' } on any failure, then
//    the CENTRAL AUTHORIZATION gate: the route's declared permission resolves from
//    ADMIN_ROUTE_PERMISSIONS (server/admin_routes.ts) against the concrete request
//    path, fail-closed (unmapped -> 404 'unknown admin endpoint' / 405; missing
//    permission -> 403), mirroring the legacy handleAdminApi preamble byte-for-byte.
//    NO read-only-scope 403 and NO moderation gate (legacy admin auth applies
//    neither). Mounted on every route except login (anonymous by design).
//    requireAdmin runs BEFORE the :id / :action decode, so an unauthenticated
//    malformed request 401s exactly as legacy did (auth precedes route/method).
//
//  - The admin.login limiter stays the legacy in-handler rateLimited(req,
//    ADMIN_LOGIN_MAX_PER_MINUTE), NOT the new coded POLICIES table (rate_limit.ts):
//    its own per-minute ceiling, isolated from the account/IP policy set, keeping the
//    429 body byte-identical. Its own isolated limiter STORE is the two-tier limiter
//    end-state; parity-first keeps the legacy shared-store call in-handler.
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
    classDistribution,
    clientPerfRaw,
    clientPerfSummary,
    levelDistribution,
    listAccounts,
    listCharacters,
    listModerationActions,
    listSharedIps,
    onlineHistory,
    overviewCounts,
    registrationsByDay,
    sessionsByDay,
    listBugReports,
    getBugReportScreenshot,
    listFilterWords,
    addFilterWord,
    removeFilterWord,
    getFilterConfig,
    updateFilterConfig,
    chatModerationForAccount,
    chatModeratedAccounts,
    resetChatStrikes,
    cleanIp,
    listBlockedIps,
    addBlockedIp,
    removeBlockedIp,
    addAccountNote,
    forceCharacterRename,
    ignoreReport,
    liftAccountChatMute,
    moderateAccount,
    moderationQueue,
    moderationReportsForAccount,
    muteAccountChat,
    accountForToken,
    accountMailTarget,
    findAccount,
    // Target-account staff check (the "admin accounts cannot be suspended / banned /
    // chat muted" guards); the CALLER gate resolves roles via adminRolesForAccount.
    isAdminAccount,
    saveToken,
    setAccountDeactivated,
    touchLogin,
    newToken,
    verifyPassword,
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

// The admin-auth gate reads its two db functions (accountForToken,
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

/** POST /admin/api/login: anonymous, its own in-handler rateLimited limiter. */
async function loginHandler(ctx: Ctx): Promise<void> {
  if (!adminDb().rateLimited(ctx.req, ADMIN_LOGIN_MAX_PER_MINUTE).allowed) {
    return fail(ctx.res, 429, 'too many attempts, wait a minute and try again');
  }
  const body = await readBody(ctx.req);
  const account =
    typeof body.username === 'string' ? await adminDb().findAccount(body.username) : null;
  if (
    !account ||
    !(await adminDb().verifyPassword(String(body.password ?? ''), account.password_hash))
  ) {
    return fail(ctx.res, 401, 'invalid username or password');
  }
  const staff = await adminDb().adminRolesForAccount(account.id);
  if (staff === null) {
    return fail(ctx.res, 403, 'this account does not have admin access');
  }
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

/** GET /admin/api/accounts: paged account search (search clamped to 64 chars). */
async function accountsHandler(ctx: Ctx): Promise<void> {
  const { page, limit } = parsePageParams(ctx.url.searchParams);
  const search = (ctx.url.searchParams.get('search') ?? '').slice(0, 64);
  ok(ctx.res, await adminDb().listAccounts(search, page, limit));
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

/** GET /admin/api/ip-associations: accounts tied to one IP, with live online flags. */
async function ipAssociationsHandler(ctx: Ctx): Promise<void> {
  const rt = useAdminRuntime();
  const ip = adminDb().cleanIp(ctx.url.searchParams.get('ip'));
  if (!ip) return fail(ctx.res, 400, 'a valid IP address is required');
  const { page, limit } = parsePageParams(ctx.url.searchParams);
  const associations = await adminDb().associationsForIp(ip, page, limit);
  const onlineAccountIds = rt.liveAccountIds();
  ok(ctx.res, {
    ...associations,
    accounts: associations.accounts.map((account) => ({
      ...account,
      online: onlineAccountIds.has(account.accountId),
    })),
    blocked: rt.isIpBlocked(ip),
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
  try {
    const ip = await adminDb().addBlockedIp({
      ip: body.ip,
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
  try {
    await adminDb().setAccountDeactivated(adminTargetId(ctx), false);
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
  const reset = await adminDb().resetChatStrikes(id);
  if (reset) rt.resetChatStrikesLive(id);
  return reset ? ok(ctx.res, { ok: true }) : fail(ctx.res, 404, 'account not found');
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

/** GET /admin/api/bug-reports/:id/screenshot: one report's screenshot on demand. */
async function bugScreenshotHandler(ctx: Ctx): Promise<void> {
  ok(ctx.res, { screenshot: await adminDb().getBugReportScreenshot(adminTargetId(ctx)) });
}

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

/** POST /admin/api/maps/:id/unpublish: force a published map back to private. */
async function adminMapUnpublishHandler(ctx: Ctx): Promise<void> {
  const done = await adminMapsDb().setStatus(adminTargetId(ctx), null, 'private');
  return done ? ok(ctx.res, { ok: true }) : fail(ctx.res, 404, 'map_not_found');
}

/** POST /admin/api/user-assets/:id/(block|unblock): flip an upload's moderation flag. */
function adminAssetStatusHandler(status: 'blocked' | 'active') {
  return async (ctx: Ctx): Promise<void> => {
    const done = await adminUserAssetsDb().setStatus(adminTargetId(ctx), status);
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
    path: '/admin/api/bug-reports/:id/screenshot',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('bugReport')],
    meta: adminTargetMeta('bugReport'),
    handler: bugScreenshotHandler,
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
