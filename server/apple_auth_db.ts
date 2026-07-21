import type { Pool } from 'pg';
import { isUniqueViolation } from './http_util';

export const APPLE_AUTH_SCHEMA = `
CREATE TABLE IF NOT EXISTS apple_auth_links (
  account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  apple_subject TEXT NOT NULL UNIQUE,
  email TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS apple_pending_logins (
  token TEXT PRIMARY KEY,
  apple_subject TEXT NOT NULL,
  apple_email TEXT,
  apple_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  display_name TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS apple_pending_logins_expires ON apple_pending_logins(expires_at);
`;

export interface ApplePendingLoginRow {
  token: string;
  apple_subject: string;
  apple_email: string | null;
  apple_email_verified: boolean;
  display_name: string | null;
}

export async function createApplePendingLogin(
  pool: Pool,
  params: {
    token: string;
    subject: string;
    email: string | null;
    emailVerified: boolean;
    displayName: string | null;
    ttlMinutes: number;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO apple_pending_logins
       (token, apple_subject, apple_email, apple_email_verified, display_name, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' minutes')::interval)`,
    [
      params.token,
      params.subject,
      params.email,
      params.emailVerified,
      params.displayName,
      String(params.ttlMinutes),
    ],
  );
}

export async function peekApplePendingLogin(
  pool: Pool,
  token: string,
): Promise<ApplePendingLoginRow | null> {
  const result = await pool.query(
    `SELECT token, apple_subject, apple_email, apple_email_verified, display_name
       FROM apple_pending_logins WHERE token = $1 AND expires_at > now()`,
    [token],
  );
  return result.rows[0] ?? null;
}

export async function consumeApplePendingLogin(
  pool: Pool,
  token: string,
): Promise<ApplePendingLoginRow | null> {
  const result = await pool.query(
    `DELETE FROM apple_pending_logins
      WHERE token = $1 AND expires_at > now()
      RETURNING token, apple_subject, apple_email, apple_email_verified, display_name`,
    [token],
  );
  return result.rows[0] ?? null;
}

export async function pruneApplePendingLogins(pool: Pool): Promise<void> {
  await pool.query('DELETE FROM apple_pending_logins WHERE expires_at <= now()');
}

export async function accountForApple(pool: Pool, subject: string): Promise<number | null> {
  const result = await pool.query(
    'SELECT account_id FROM apple_auth_links WHERE apple_subject = $1',
    [subject],
  );
  return result.rows[0]?.account_id ?? null;
}

export async function deleteUnusedAppleProvision(pool: Pool, accountId: number): Promise<void> {
  await pool.query(
    `DELETE FROM accounts a
      WHERE a.id = $1 AND a.password_set = FALSE
        AND NOT EXISTS (SELECT 1 FROM auth_tokens t WHERE t.account_id = a.id)
        AND NOT EXISTS (SELECT 1 FROM characters c WHERE c.account_id = a.id)
        AND NOT EXISTS (SELECT 1 FROM apple_auth_links l WHERE l.account_id = a.id)`,
    [accountId],
  );
}

export async function linkAppleAccount(
  pool: Pool,
  accountId: number,
  subject: string,
  email: string | null,
): Promise<boolean> {
  try {
    await pool.query(
      `INSERT INTO apple_auth_links (account_id, apple_subject, email)
       VALUES ($1, $2, $3)`,
      [accountId, subject, email],
    );
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}
