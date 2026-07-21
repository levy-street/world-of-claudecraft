// OAuth2 persistence (SQL only). Schema is a const string appended to
// ensureSchema() in db.ts (like SOCIAL_SCHEMA); query functions take the shared
// `pool` as an argument so this module never imports db.ts — keeping db.ts ↔
// oauth_db.ts cycle-free. All tokens issued by the OAuth flow are ordinary
// scope='read' rows in auth_tokens; these tables only hold the short-lived
// authorization-code / device-code grant state.

import type { Pool } from 'pg';

export const OAUTH_SCHEMA = `
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL DEFAULT '',   -- newline-separated exact-match allowlist
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS oauth_codes (
  code TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL,
  scope TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS oauth_codes_expires ON oauth_codes(expires_at);
CREATE TABLE IF NOT EXISTS oauth_device_codes (
  device_code TEXT PRIMARY KEY,
  user_code TEXT UNIQUE NOT NULL,
  client_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  account_id INT REFERENCES accounts(id) ON DELETE CASCADE,
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oauth_device_codes_user_code ON oauth_device_codes(user_code);
`;

export interface OAuthClientRow {
  client_id: string;
  name: string;
  redirect_uris: string;
}

export async function getOAuthClient(pool: Pool, clientId: string): Promise<OAuthClientRow | null> {
  const res = await pool.query(
    'SELECT client_id, name, redirect_uris FROM oauth_clients WHERE client_id = $1',
    [clientId],
  );
  return res.rows[0] ?? null;
}

// Idempotent client upsert — used to seed first-party companion clients at boot.
export async function upsertOAuthClient(
  pool: Pool,
  clientId: string,
  name: string,
  redirectUris: string[],
): Promise<void> {
  await pool.query(
    `INSERT INTO oauth_clients (client_id, name, redirect_uris) VALUES ($1, $2, $3)
     ON CONFLICT (client_id) DO UPDATE SET name = EXCLUDED.name, redirect_uris = EXCLUDED.redirect_uris`,
    [clientId, name, redirectUris.join('\n')],
  );
}

// ── Authorization codes (auth-code + PKCE grant) ───────────────────────────

export async function createAuthCode(
  pool: Pool,
  params: {
    code: string;
    clientId: string;
    accountId: number;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    scope: string;
    ttlSeconds: number;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO oauth_codes (code, client_id, account_id, redirect_uri, code_challenge, code_challenge_method, scope, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + ($8 || ' seconds')::interval)`,
    [
      params.code,
      params.clientId,
      params.accountId,
      params.redirectUri,
      params.codeChallenge,
      params.codeChallengeMethod,
      params.scope,
      String(params.ttlSeconds),
    ],
  );
}

export interface ConsumedAuthCode {
  account_id: number;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
}

// Atomically consume an unexpired, unconsumed code (one-time use). Returns the
// row, or null if it doesn't exist / is expired / was already consumed.
export async function consumeAuthCode(pool: Pool, code: string): Promise<ConsumedAuthCode | null> {
  const res = await pool.query(
    `UPDATE oauth_codes SET consumed_at = now()
      WHERE code = $1 AND consumed_at IS NULL AND expires_at > now()
      RETURNING account_id, client_id, redirect_uri, code_challenge, code_challenge_method, scope`,
    [code],
  );
  return res.rows[0] ?? null;
}

// ── Device codes (device-code grant) ───────────────────────────────────────

export async function createDeviceCode(
  pool: Pool,
  params: {
    deviceCode: string;
    userCode: string;
    clientId: string;
    scope: string;
    ttlSeconds: number;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO oauth_device_codes (device_code, user_code, client_id, scope, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval)`,
    [params.deviceCode, params.userCode, params.clientId, params.scope, String(params.ttlSeconds)],
  );
}

export interface DeviceCodeRow {
  device_code: string;
  user_code: string;
  client_id: string;
  scope: string;
  account_id: number | null;
  approved: boolean;
  expired: boolean;
  consumed: boolean;
}

export async function getDeviceByUserCode(
  pool: Pool,
  userCode: string,
): Promise<DeviceCodeRow | null> {
  const res = await pool.query(
    `SELECT device_code, user_code, client_id, scope, account_id, approved,
            (expires_at <= now()) AS expired, (consumed_at IS NOT NULL) AS consumed
       FROM oauth_device_codes WHERE user_code = $1`,
    [userCode],
  );
  return res.rows[0] ?? null;
}

// Approve a pending device authorization, binding it to the approving account.
// Only an unexpired, unapproved row is updated. Returns true on success.
export async function approveDeviceCode(
  pool: Pool,
  userCode: string,
  accountId: number,
): Promise<boolean> {
  const res = await pool.query(
    `UPDATE oauth_device_codes SET approved = TRUE, account_id = $2
      WHERE user_code = $1 AND approved = FALSE AND expires_at > now()`,
    [userCode, accountId],
  );
  return (res.rowCount ?? 0) > 0;
}

export interface DevicePollRow {
  account_id: number | null;
  approved: boolean;
  scope: string;
  expired: boolean;
  consumed: boolean;
}

export async function getDeviceByDeviceCode(
  pool: Pool,
  deviceCode: string,
  clientId: string,
): Promise<DevicePollRow | null> {
  const res = await pool.query(
    `SELECT account_id, approved, scope,
            (expires_at <= now()) AS expired, (consumed_at IS NOT NULL) AS consumed
       FROM oauth_device_codes WHERE device_code = $1 AND client_id = $2`,
    [deviceCode, clientId],
  );
  return res.rows[0] ?? null;
}

// Atomically claim an approved device code so a poll issues exactly one token.
export async function consumeDeviceCode(
  pool: Pool,
  deviceCode: string,
): Promise<{ account_id: number; scope: string } | null> {
  const res = await pool.query(
    `UPDATE oauth_device_codes SET consumed_at = now()
      WHERE device_code = $1 AND approved = TRUE AND account_id IS NOT NULL
        AND consumed_at IS NULL AND expires_at > now()
      RETURNING account_id, scope`,
    [deviceCode],
  );
  return res.rows[0] ?? null;
}

// Prune expired grant rows (best-effort housekeeping).
export async function pruneExpiredOAuthGrants(pool: Pool): Promise<void> {
  await pool.query("DELETE FROM oauth_codes WHERE expires_at < now() - interval '1 day'");
  await pool.query("DELETE FROM oauth_device_codes WHERE expires_at < now() - interval '1 day'");
}
