// Devs portal — account links (GitHub / Solana), the player's lead character,
// the cached contribution-score leaderboard. Thin queries over the shared pool.
import { pool } from './db';
import { REALM } from './realm';

export interface DevsLinks {
  username: string;
  githubUsername: string | null;
  solanaAddress: string | null;
}

export async function getDevsLinks(accountId: number): Promise<DevsLinks | null> {
  const res = await pool.query(
    'SELECT username, github_username, solana_address FROM accounts WHERE id = $1',
    [accountId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { username: row.username, githubUsername: row.github_username, solanaAddress: row.solana_address };
}

export async function setGithubUsername(accountId: number, githubUsername: string | null): Promise<void> {
  await pool.query('UPDATE accounts SET github_username = $2 WHERE id = $1', [accountId, githubUsername]);
}

export async function setSolanaAddress(accountId: number, address: string | null): Promise<void> {
  await pool.query('UPDATE accounts SET solana_address = $2 WHERE id = $1', [accountId, address]);
}

export interface LeadCharacter {
  name: string;
  class: string;
  level: number;
  lifetimeXp: number;
}

// The player's highest-level character on the current realm — the "main" the
// Devs portal shows their contributions powering up.
export async function leadCharacter(accountId: number): Promise<LeadCharacter | null> {
  const res = await pool.query(
    `SELECT name, class, level, COALESCE((state->>'lifetimeXp')::bigint, 0) AS lifetime_xp
       FROM characters
      WHERE account_id = $1 AND realm = $2
      ORDER BY level DESC, lifetime_xp DESC
      LIMIT 1`,
    [accountId, REALM],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { name: row.name, class: row.class, level: row.level, lifetimeXp: Number(row.lifetime_xp) };
}

export async function upsertContributionScore(
  accountId: number,
  githubUsername: string,
  points: number,
  level: number,
  prsMerged: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO devs_contribution_score (account_id, github_username, points, level, prs_merged, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (account_id) DO UPDATE
       SET github_username = EXCLUDED.github_username,
           points = EXCLUDED.points,
           level = EXCLUDED.level,
           prs_merged = EXCLUDED.prs_merged,
           updated_at = now()`,
    [accountId, githubUsername, points, level, prsMerged],
  );
}

export interface LeaderboardRow {
  githubUsername: string;
  username: string;
  points: number;
  level: number;
  prsMerged: number;
}

export async function contributionLeaderboard(limit = 25): Promise<LeaderboardRow[]> {
  const res = await pool.query(
    `SELECT s.github_username, a.username, s.points, s.level, s.prs_merged
       FROM devs_contribution_score s
       JOIN accounts a ON a.id = s.account_id
      ORDER BY s.points DESC, s.updated_at ASC
      LIMIT $1`,
    [limit],
  );
  return res.rows.map((r) => ({
    githubUsername: r.github_username,
    username: r.username,
    points: r.points,
    level: r.level,
    prsMerged: r.prs_merged,
  }));
}
