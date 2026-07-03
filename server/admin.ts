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
  listSharedIps,
  onlineHistory,
  overviewCounts,
  registrationsByDay,
  sessionsByDay,
} from './admin_db';
import { newToken, verifyPassword } from './auth';
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
  accountForToken,
  accountMailTarget,
  findAccount,
  isAdminAccount,
  saveToken,
  setAccountDeactivated,
  touchLogin,
} from './db';
import { emailSecurityIncident } from './email';
import type { GameServer } from './game';
import { json, readBody } from './http_util';
import { addBlockedIp, cleanIp, listBlockedIps, removeBlockedIp } from './ip_block_db';
import {
  addAccountNote,
  forceCharacterRename,
  ignoreReport,
  liftAccountChatMute,
  moderateAccount,
  moderationQueue,
  moderationReportsForAccount,
  muteAccountChat,
} from './moderation_db';
import { providerUsageSnapshot } from './provider_usage';
import { rateLimited } from './ratelimit';

// Admin API: everything under /admin/api/*. Auth is a bearer token whose
// account has is_admin = TRUE — the admin.* hostname is routing, not security.

const ADMIN_LOGIN_MAX_PER_MINUTE = 10;
const MAX_PAGE_LIMIT = 200;
const DEFAULT_PAGE_LIMIT = 25;
const ACTIVITY_WINDOW_DAYS = 30;

const IP_BLOCK_KICK_MESSAGE = 'Connection to the server was lost.';

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

function getBlockedIpsForAccount(
  game: GameServer,
  detail: { lastLoginIp: string | null; recentSessions: { ip: string | null }[] },
): string[] {
  const ips = new Set<string>();
  if (detail.lastLoginIp) ips.add(detail.lastLoginIp);
  for (const s of detail.recentSessions) if (s.ip) ips.add(s.ip);
  return [...ips].filter((ip) => game.isIpBlocked(ip));
}

async function adminAccountId(req: http.IncomingMessage): Promise<number | null> {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization ?? '');
  if (!m) return null;
  const accountId = await accountForToken(m[1]);
  if (accountId === null) return null;
  return (await isAdminAccount(accountId)) ? accountId : null;
}

async function handleLogin(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (rateLimited(req, ADMIN_LOGIN_MAX_PER_MINUTE)) {
    return fail(res, 429, 'too many attempts, wait a minute and try again');
  }
  const body = await readBody(req);
  const account = typeof body.username === 'string' ? await findAccount(body.username) : null;
  if (!account || !(await verifyPassword(String(body.password ?? ''), account.password_hash))) {
    return fail(res, 401, 'invalid username or password');
  }
  if (!(await isAdminAccount(account.id))) {
    return fail(res, 403, 'this account does not have admin access');
  }
  await touchLogin(account.id);
  const token = newToken();
  await saveToken(token, account.id);
  ok(res, { token, username: account.username });
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

    const accountId = await adminAccountId(req);
    if (accountId === null) return fail(res, 401, 'admin authentication required');

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
            .catch((err) => console.error('security-incident email failed:', err));
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

    if (req.method !== 'GET') return fail(res, 405, 'method not allowed');

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
        usage: providerUsageSnapshot(),
      });
    }
    if (path === '/admin/api/online') {
      return ok(res, { players: game.liveSessions() });
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

    fail(res, 404, 'unknown admin endpoint');
  } catch (err) {
    console.error('admin api error:', err);
    fail(res, 500, 'internal error');
  }
}
