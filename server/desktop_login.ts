import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { newToken } from './auth';
import { requestIp } from './ratelimit';

const DESKTOP_LOGIN_TTL_MS = 5 * 60 * 1000;
const DESKTOP_LOGIN_CODE_BYTES = 20;

interface DesktopLoginCode {
  accountId: number;
  username: string;
  issuedAt: number;
  ip: string;
}

const desktopLoginCodes = new Map<string, DesktopLoginCode>();

function nowMs(): number {
  return Date.now();
}

function pruneDesktopLoginCodes(): void {
  const cutoff = nowMs() - DESKTOP_LOGIN_TTL_MS;
  for (const [code, entry] of desktopLoginCodes) {
    if (entry.issuedAt < cutoff) desktopLoginCodes.delete(code);
  }
}

export function createDesktopLoginCode(
  req: IncomingMessage,
  account: { id: number; username: string },
): { code: string; expiresInMs: number } {
  pruneDesktopLoginCodes();
  const code = crypto.randomBytes(DESKTOP_LOGIN_CODE_BYTES).toString('base64url');
  desktopLoginCodes.set(code, {
    accountId: account.id,
    username: account.username,
    issuedAt: nowMs(),
    ip: requestIp(req),
  });
  return { code, expiresInMs: DESKTOP_LOGIN_TTL_MS };
}

export function consumeDesktopLoginCode(
  req: IncomingMessage,
  code: unknown,
): { accountId: number; username: string } | null {
  pruneDesktopLoginCodes();
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{20,80}$/.test(code)) return null;
  const entry = desktopLoginCodes.get(code);
  if (!entry) return null;
  desktopLoginCodes.delete(code);
  if (nowMs() - entry.issuedAt > DESKTOP_LOGIN_TTL_MS) return null;
  if (entry.ip !== requestIp(req)) return null;
  return { accountId: entry.accountId, username: entry.username };
}

export function resetDesktopLoginCodesForTest(): void {
  desktopLoginCodes.clear();
}

export function desktopLoginCodeCountForTest(): number {
  return desktopLoginCodes.size;
}

// Everything the two route handlers need from the host (main.ts wires the real
// db/auth implementations; tests inject stubs so no Postgres is required).
// Shapes are structural subsets of the real functions on purpose.
export interface DesktopLoginRouteDeps {
  bearerToken(req: IncomingMessage): string | null;
  readBody(req: IncomingMessage): Promise<Record<string, unknown>>;
  json(res: ServerResponse, status: number, body: unknown): void;
  requestMetadata(req: IncomingMessage): { ip: string; userAgent: string };
  accountForToken(token: string): Promise<number | null>;
  accountById(accountId: number): Promise<{ id: number; username: string } | null>;
  moderationStatusForAccount(accountId: number): Promise<{ locked: boolean; message: string }>;
  touchLogin(accountId: number, meta: { ip: string; userAgent: string }): Promise<void>;
  saveToken(token: string, accountId: number): Promise<void>;
}

// POST /api/desktop-login/create: a logged-in BROWSER session (the /desktop-login
// page) mints a short-lived, single-use, IP-bound handoff code for the desktop
// app. Auth and moderation gated exactly like a login.
export async function handleDesktopLoginCreate(
  req: IncomingMessage,
  res: ServerResponse,
  deps: DesktopLoginRouteDeps,
): Promise<void> {
  const token = deps.bearerToken(req);
  if (!token) return deps.json(res, 401, { error: 'not authenticated' });
  const accountId = await deps.accountForToken(token);
  if (accountId === null) return deps.json(res, 401, { error: 'not authenticated' });
  const account = await deps.accountById(accountId);
  if (account === null) return deps.json(res, 401, { error: 'not authenticated' });
  const status = await deps.moderationStatusForAccount(account.id);
  if (status.locked) return deps.json(res, 403, { error: status.message });
  return deps.json(res, 200, createDesktopLoginCode(req, account));
}

// POST /api/desktop-login/exchange: the desktop app trades the deep-linked code
// for a full session token. Unauthenticated by design; the 160-bit single-use
// IP-bound code is the credential.
export async function handleDesktopLoginExchange(
  req: IncomingMessage,
  res: ServerResponse,
  deps: DesktopLoginRouteDeps,
): Promise<void> {
  const body = await deps.readBody(req);
  const entry = consumeDesktopLoginCode(req, body.code);
  if (!entry) return deps.json(res, 401, { error: 'invalid or expired desktop login code' });
  const status = await deps.moderationStatusForAccount(entry.accountId);
  if (status.locked) return deps.json(res, 403, { error: status.message });
  await deps.touchLogin(entry.accountId, deps.requestMetadata(req));
  const token = newToken();
  await deps.saveToken(token, entry.accountId);
  return deps.json(res, 200, { token, username: entry.username });
}
