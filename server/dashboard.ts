// User + moderator dashboard endpoints. Adds two parallel route prefixes
// alongside the existing /admin/api/*:
//
//   /me/api/*   — any logged-in account (own-data view)
//   /mod/api/*  — accounts flagged is_moderator (or is_admin, since admins
//                  are implicit moderators)
//
// All responses use the same {success,data,error} envelope as the admin API
// so src/admin/api.ts can be reused with only the path prefix swapped.

import * as http from 'node:http';
import { json, readBody } from './http_util';
import { rateLimited } from './ratelimit';
import {
  findAccount, touchLogin, saveToken, accountForToken,
  isModeratorAccount, accountRoleFlags,
  listCharacters, type CharacterRow,
  moderationStatusForAccount, chatMuteStatusForAccount,
} from './db';
import { verifyPassword, newToken } from './auth';
import { moderationQueue } from './moderation_db';
import { REALM } from './realm';

const DASH_LOGIN_MAX_PER_MINUTE = 10;

function ok(res: http.ServerResponse, data: unknown): void {
  json(res, 200, { success: true, data, error: null });
}
function fail(res: http.ServerResponse, status: number, error: string): void {
  json(res, status, { success: false, data: null, error });
}

async function bearerAccountId(req: http.IncomingMessage): Promise<number | null> {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization ?? '');
  if (!m) return null;
  return accountForToken(m[1]);
}

interface LoginBody { username?: unknown; password?: unknown; }

async function handleLogin(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requireModerator: boolean,
): Promise<void> {
  if (rateLimited(req, DASH_LOGIN_MAX_PER_MINUTE)) {
    return fail(res, 429, 'too many attempts — wait a minute and try again');
  }
  const body = (await readBody(req)) as LoginBody;
  const account = typeof body.username === 'string' ? await findAccount(body.username) : null;
  if (!account || !(await verifyPassword(String(body.password ?? ''), account.password_hash))) {
    return fail(res, 401, 'invalid username or password');
  }
  const mod = await moderationStatusForAccount(account.id);
  if (mod.locked) return fail(res, 403, mod.message);
  if (requireModerator && !(await isModeratorAccount(account.id))) {
    return fail(res, 403, 'this account does not have moderator access');
  }
  await touchLogin(account.id);
  const token = newToken();
  await saveToken(token, account.id);
  const roles = await accountRoleFlags(account.id);
  ok(res, { token, username: account.username, roles });
}

interface CharSummary {
  id: number; name: string; class: string; level: number; realm: string; lifetimeXp: number;
}

function summarizeCharacter(row: CharacterRow): CharSummary {
  const state = row.state as Record<string, unknown> | null;
  const lifetimeXp = typeof state?.lifetimeXp === 'number' ? (state.lifetimeXp as number) : 0;
  return {
    id: row.id, name: row.name, class: String(row.class),
    level: row.level, realm: REALM, lifetimeXp,
  };
}

async function handleMe(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const accountId = await bearerAccountId(req);
  if (accountId === null) return fail(res, 401, 'not authenticated');

  const [roles, mod, chatMute, chars] = await Promise.all([
    accountRoleFlags(accountId),
    moderationStatusForAccount(accountId),
    chatMuteStatusForAccount(accountId),
    listCharacters(accountId),
  ]);

  ok(res, {
    accountId, realm: REALM, roles,
    moderation: {
      locked: mod.locked, message: mod.message,
      chatMutedUntil: chatMute.mutedUntil ?? null,
    },
    characters: chars.map(summarizeCharacter),
  });
}

async function handleModQueue(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const accountId = await bearerAccountId(req);
  if (accountId === null) return fail(res, 401, 'not authenticated');
  if (!(await isModeratorAccount(accountId))) return fail(res, 403, 'moderator access required');
  // Dashboard view is read-only — without access to the game's live session
  // table we pass an empty online set; the queue still surfaces every open
  // report, mods just see the "offline" tag for everyone.
  const queue = await moderationQueue(new Set<number>());
  ok(res, queue);
}

/** Dispatch `/me/api/*` requests. */
export async function handleUserApi(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  try {
    if (req.method === 'POST' && path === '/me/api/login') return await handleLogin(req, res, false);
    if (req.method === 'GET' && path === '/me/api/me') return await handleMe(req, res);
    return fail(res, 404, 'route not found');
  } catch (err) {
    return fail(res, 500, err instanceof Error ? err.message : 'internal error');
  }
}

/** Dispatch `/mod/api/*` requests. */
export async function handleModeratorApi(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  try {
    if (req.method === 'POST' && path === '/mod/api/login') return await handleLogin(req, res, true);
    if (req.method === 'GET' && path === '/mod/api/me') return await handleMe(req, res);
    if (req.method === 'GET' && path === '/mod/api/queue') return await handleModQueue(req, res);
    return fail(res, 404, 'route not found');
  } catch (err) {
    return fail(res, 500, err instanceof Error ? err.message : 'internal error');
  }
}
