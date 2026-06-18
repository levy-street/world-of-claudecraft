// Fetch wrapper for /me/api/*. Mirrors src/admin/api.ts so both dashboards
// share the same {success,data,error} envelope handling.

const TOKEN_KEY = 'woc_user_token';
const NAME_KEY = 'woc_user_name';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function getToken(): string | null { return localStorage.getItem(TOKEN_KEY); }
export function getUserName(): string { return localStorage.getItem(NAME_KEY) ?? ''; }
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

export interface RoleFlags { isAdmin: boolean; isModerator: boolean; }
export interface LoginData { token: string; username: string; roles: RoleFlags; }
export interface MyCharacter {
  id: number; name: string; class: string; level: number; realm: string; lifetimeXp: number;
}
export interface MeData {
  accountId: number;
  realm: string;
  roles: RoleFlags;
  moderation: { locked: boolean; message: string; chatMutedUntil: string | null };
  characters: MyCharacter[];
}

export async function userLogin(username: string, password: string): Promise<LoginData> {
  const res = await fetch('/me/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await parseEnvelope<LoginData>(res);
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(NAME_KEY, data.username);
  return data;
}

export async function getMe(): Promise<MeData> {
  const token = getToken();
  if (!token) throw new ApiError(401, 'not signed in');
  const res = await fetch('/me/api/me', { headers: { Authorization: `Bearer ${token}` } });
  return parseEnvelope<MeData>(res);
}
