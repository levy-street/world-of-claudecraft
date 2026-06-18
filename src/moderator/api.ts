// Fetch wrapper for /mod/api/*. Same envelope + Bearer flow as the admin
// and user APIs, scoped to moderator-gated routes.

const TOKEN_KEY = 'woc_mod_token';
const NAME_KEY = 'woc_mod_name';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function getToken(): string | null { return localStorage.getItem(TOKEN_KEY); }
export function getModName(): string { return localStorage.getItem(NAME_KEY) ?? ''; }
export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(NAME_KEY);
}

interface Envelope<T> { success: boolean; data: T | null; error: string | null; }

async function parseEnvelope<T>(res: Response): Promise<T> {
  let body: Envelope<T> | null = null;
  try { body = await res.json(); } catch {
    throw new ApiError(res.status, `unexpected response (${res.status})`);
  }
  if (!res.ok || !body || body.success !== true || body.data === null) {
    throw new ApiError(res.status, body?.error ?? `request failed (${res.status})`);
  }
  return body.data;
}

export interface ModRoleFlags { isAdmin: boolean; isModerator: boolean; }
export interface ModLoginData { token: string; username: string; roles: ModRoleFlags; }
export interface ModMeData {
  accountId: number;
  realm: string;
  roles: ModRoleFlags;
  moderation: { locked: boolean; message: string; chatMutedUntil: string | null };
  characters: { id: number; name: string; class: string; level: number; realm: string; lifetimeXp: number }[];
}
export interface ModQueueRow {
  accountId: number;
  username: string | null;
  characterName: string | null;
  characterClass: string | null;
  characterLevel: number | null;
  online: boolean;
  openReports: number;
  lastReportAt: string | null;
  banned: boolean;
  suspendedUntil: string | null;
  moderationReason: string | null;
  chatMutedUntil: string | null;
  chatStrikes: number;
}

export async function modLogin(username: string, password: string): Promise<ModLoginData> {
  const res = await fetch('/mod/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await parseEnvelope<ModLoginData>(res);
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(NAME_KEY, data.username);
  return data;
}

async function authedGet<T>(path: string): Promise<T> {
  const token = getToken();
  if (!token) throw new ApiError(401, 'not signed in');
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  return parseEnvelope<T>(res);
}

export const getModMe = () => authedGet<ModMeData>('/mod/api/me');
export const getModQueue = () => authedGet<ModQueueRow[]>('/mod/api/queue');
