// GitHub identity link + OAuth state persistence for the developer badge. The
// DDL is appended to ensureSchema() in db.ts (like DISCORD_SCHEMA / OAUTH_SCHEMA);
// every query lives here so the logic modules carry no raw SQL.
//
// Two tables:
//   1. github_links        - the durable 1:1 account <-> GitHub identity mirror.
//   2. github_oauth_states - single-use, short-lived OAuth `state` rows (CSRF +
//                            replay guard). Linking is the only mode (the player
//                            is already authenticated), so the row only needs to
//                            carry which account to attach the verified identity to.
import type { Pool } from 'pg';
import { isUniqueViolation } from './http_util';

export const GITHUB_SCHEMA = `
-- One GitHub identity per account (account_id PK) and one account per GitHub user
-- (github_user_id UNIQUE). ON DELETE CASCADE so deleting an account drops the
-- link. github_user_id is the numeric GitHub id (stable across renames); the login
-- rides alongside for display + the contributor-stats lookup. Ownership is proven
-- by an OAuth code exchange (see github_oauth_states).
CREATE TABLE IF NOT EXISTS github_links (
  account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  github_user_id TEXT NOT NULL UNIQUE,
  github_login TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Single-use, short-lived OAuth state rows. Consuming a state row deletes it
-- (replay + CSRF protection). account_id is the already-authenticated account the
-- verified GitHub identity will be linked to.
CREATE TABLE IF NOT EXISTS github_oauth_states (
  state TEXT PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS github_oauth_states_expires ON github_oauth_states(expires_at);
`;

// ── GitHub identity link (mirrors discord_links / wallet_links) ────────────────

export interface GitHubLinkRow {
  account_id: number;
  github_user_id: string;
  github_login: string | null;
  linked_at: Date | string;
}

export async function githubForAccount(
  pool: Pool,
  accountId: number,
): Promise<GitHubLinkRow | null> {
  const res = await pool.query(
    `SELECT account_id, github_user_id, github_login, linked_at
       FROM github_links WHERE account_id = $1`,
    [accountId],
  );
  return res.rows[0] ?? null;
}

export async function accountForGithub(pool: Pool, githubUserId: string): Promise<number | null> {
  const res = await pool.query('SELECT account_id FROM github_links WHERE github_user_id = $1', [
    githubUserId,
  ]);
  return res.rows[0]?.account_id ?? null;
}

/**
 * Link a GitHub identity to an account. One GitHub per account (account_id PK) and
 * one account per GitHub (github_user_id UNIQUE). Returns false when the GitHub id
 * is already owned by a DIFFERENT account so the caller can 409.
 */
export async function linkGitHubToAccount(
  pool: Pool,
  accountId: number,
  info: { githubUserId: string; login: string },
): Promise<boolean> {
  const owner = await accountForGithub(pool, info.githubUserId);
  if (owner !== null && owner !== accountId) return false;
  try {
    await pool.query(
      `INSERT INTO github_links (account_id, github_user_id, github_login)
       VALUES ($1, $2, $3)
       ON CONFLICT (account_id) DO UPDATE SET
         github_user_id = EXCLUDED.github_user_id,
         github_login = EXCLUDED.github_login,
         linked_at = now()`,
      [accountId, info.githubUserId, info.login],
    );
  } catch (err) {
    // TOCTOU: another account claimed this github_user_id between the check and the
    // upsert. github_user_id is UNIQUE (not the ON CONFLICT target), so the race
    // surfaces as 23505 -> treat as "already owned" (409), not a 500.
    if (isUniqueViolation(err)) return false;
    throw err;
  }
  return true;
}

export async function unlinkGitHub(pool: Pool, accountId: number): Promise<void> {
  await pool.query('DELETE FROM github_links WHERE account_id = $1', [accountId]);
}

// ── OAuth state (mirrors discord_oauth_states) ─────────────────────────────────

export interface GitHubOAuthStateRow {
  state: string;
  account_id: number;
}

export async function createGitHubOAuthState(
  pool: Pool,
  params: { state: string; accountId: number; ttlMinutes: number },
): Promise<void> {
  await pool.query(
    `INSERT INTO github_oauth_states (state, account_id, expires_at)
     VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
    [params.state, params.accountId, String(params.ttlMinutes)],
  );
}

/** Atomically consume an unexpired state row (single use). Null if missing/expired. */
export async function consumeGitHubOAuthState(
  pool: Pool,
  state: string,
): Promise<GitHubOAuthStateRow | null> {
  const res = await pool.query(
    `DELETE FROM github_oauth_states
      WHERE state = $1 AND expires_at > now()
      RETURNING state, account_id`,
    [state],
  );
  return res.rows[0] ?? null;
}

export async function pruneGitHubOAuthStates(pool: Pool): Promise<void> {
  await pool.query('DELETE FROM github_oauth_states WHERE expires_at <= now()');
}
