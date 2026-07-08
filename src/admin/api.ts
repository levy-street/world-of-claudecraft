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

export async function apiLogin(username: string, password: string): Promise<AdminSession> {
  const res = await fetch('/admin/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await parseEnvelope<{ token: string } & AdminSession>(res);
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(NAME_KEY, data.username);
  // Tolerate a pre-permissions server during a deploy window: missing arrays
  // degrade to zero permissions (the no-access screen) instead of a crash.
  return { username: data.username, roles: data.roles ?? [], permissions: data.permissions ?? [] };
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
