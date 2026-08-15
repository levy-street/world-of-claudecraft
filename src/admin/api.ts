// Thin fetch wrapper around the /admin/api endpoints. All responses use the
// { success, data, error } envelope.

const TOKEN_KEY = 'claudecraft_admin_token';
const NAME_KEY = 'claudecraft_admin_name';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getAdminName(): string {
  return localStorage.getItem(NAME_KEY) ?? '';
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(NAME_KEY);
}

interface Envelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

async function parseEnvelope<T>(res: Response): Promise<T> {
  let body: Envelope<T> | null = null;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(res.status, `unexpected response (${res.status})`);
  }
  if (!res.ok || !body || body.success !== true || body.data === null) {
    throw new ApiError(res.status, body?.error ?? `request failed (${res.status})`);
  }
  return body.data;
}

export interface AdminSession {
  username: string;
  roles: string[];
  permissions: string[];
}

// Returned in place of AdminSession when the account has 2FA enabled and no
// code/recoveryCode was supplied: the server never mints a token for this reply.
export interface AdminLoginChallenge {
  twoFactorRequired: true;
}

interface LoginResponse {
  token?: string;
  username?: string;
  roles?: string[];
  permissions?: string[];
  twoFactorRequired?: boolean;
}

// Mirrors src/net/online.ts login(): with 2FA off (or a correct code/recoveryCode
// already supplied), returns the session and stores the token. With 2FA on and no
// code, returns { twoFactorRequired: true } (never throws) so the caller can reveal
// the code field and re-invoke with it. A wrong code/password still throws (401),
// like a wrong password.
export async function apiLogin(
  username: string,
  password: string,
  code = '',
  recoveryCode = '',
): Promise<AdminLoginChallenge | AdminSession> {
  const res = await fetch('/admin/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, code, recoveryCode }),
  });
  const data = await parseEnvelope<LoginResponse>(res);
  if (data.twoFactorRequired && !data.token) return { twoFactorRequired: true };
  if (!data.token) throw new Error('login response missing token');
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(NAME_KEY, data.username ?? '');
  // Tolerate a pre-permissions server during a deploy window: missing arrays
  // degrade to zero permissions (the no-access screen) instead of a crash.
  return {
    username: data.username ?? '',
    roles: data.roles ?? [],
    permissions: data.permissions ?? [],
  };
}

// Boot-time hydration of the operator's identity: permissions are never
// persisted client-side, they are re-fetched each load so a role change
// applies on the next reload (and immediately server-side regardless).
export async function apiMe(): Promise<AdminSession> {
  return apiGet<AdminSession>('/admin/api/me');
}

export async function apiGet<T>(path: string): Promise<T> {
  const token = getToken();
  if (!token) throw new ApiError(401, 'not signed in');
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  return parseEnvelope<T>(res);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const token = getToken();
  if (!token) throw new ApiError(401, 'not signed in');
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return parseEnvelope<T>(res);
}
