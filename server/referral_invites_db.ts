import { randomBytes } from 'node:crypto';
import { pool } from './db';

// One immutable invitation per account, retained for the account's lifetime.
// Tokens reveal no login name, character identity, or sequential account ID.
export const REFERRAL_INVITES_SCHEMA = `
CREATE TABLE IF NOT EXISTS referral_invites (
  account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  token VARCHAR(32) NOT NULL UNIQUE CHECK (token ~ '^[a-f0-9]{32}$')
);
`;

export async function getOrCreateReferralInvite(accountId: number): Promise<string> {
  const existing = await pool.query('SELECT token FROM referral_invites WHERE account_id = $1', [
    accountId,
  ]);
  if (existing.rows[0]) return existing.rows[0].token;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const inserted = await pool.query(
        `INSERT INTO referral_invites (account_id, token) VALUES ($1, $2)
         ON CONFLICT (account_id) DO NOTHING RETURNING token`,
        [accountId, randomBytes(16).toString('hex')],
      );
      if (inserted.rows[0]) return inserted.rows[0].token;
      const winner = await pool.query('SELECT token FROM referral_invites WHERE account_id = $1', [
        accountId,
      ]);
      if (winner.rows[0]) return winner.rows[0].token;
      throw new Error('Referral invitation account disappeared');
    } catch (error) {
      if ((error as { code?: string }).code !== '23505' || attempt === 2) throw error;
    }
  }
  throw new Error('Unable to allocate referral invitation');
}

export async function referralInviteOwner(
  token: string,
): Promise<{ accountId: number; name: string } | null> {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const result = await pool.query(
    `SELECT i.account_id, COALESCE(c.name, '') AS name FROM referral_invites i
     LEFT JOIN LATERAL (SELECT name FROM characters WHERE account_id = i.account_id ORDER BY id LIMIT 1) c ON true
     WHERE i.token = $1`,
    [token],
  );
  return result.rows[0]
    ? { accountId: Number(result.rows[0].account_id), name: result.rows[0].name }
    : null;
}
