// Devs portal — account links (GitHub / Solana), the player's lead character,
// the cached contribution-score leaderboard. Thin queries over the shared pool.
import { pool } from './db';
import { REALM } from './realm';

export interface DevsLinks {
  username: string;
  githubUsername: string | null;
  githubVerified: boolean;
  solanaAddress: string | null;
}

export async function getDevsLinks(accountId: number): Promise<DevsLinks | null> {
  const res = await pool.query(
    'SELECT username, github_username, github_verified, solana_address FROM accounts WHERE id = $1',
    [accountId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    username: row.username,
    githubUsername: row.github_username,
    githubVerified: !!row.github_verified,
    solanaAddress: row.solana_address,
  };
}

// --- GitHub ownership: a one-time bio code, verified server-side ------------

export interface GithubChallenge {
  githubUsername: string;
  code: string;
}

// Begin (or restart) verification: claim a username + stash an unverified code.
// A username can only be VERIFIED to one account (partial unique index below),
// but two accounts may hold an unverified claim until one proves ownership.
export async function startGithubLink(accountId: number, githubUsername: string, code: string): Promise<void> {
  await pool.query(
    `UPDATE accounts SET github_username = $2, github_verify_code = $3, github_verified = FALSE WHERE id = $1`,
    [accountId, githubUsername, code],
  );
}

export async function getGithubChallenge(accountId: number): Promise<GithubChallenge | null> {
  const res = await pool.query(
    'SELECT github_username, github_verify_code FROM accounts WHERE id = $1',
    [accountId],
  );
  const row = res.rows[0];
  if (!row || !row.github_username || !row.github_verify_code) return null;
  return { githubUsername: row.github_username, code: row.github_verify_code };
}

export async function markGithubVerified(accountId: number): Promise<void> {
  await pool.query(
    'UPDATE accounts SET github_verified = TRUE, github_verify_code = NULL WHERE id = $1',
    [accountId],
  );
}

export async function unlinkGithub(accountId: number): Promise<void> {
  await pool.query(
    `UPDATE accounts SET github_username = NULL, github_verify_code = NULL, github_verified = FALSE WHERE id = $1`,
    [accountId],
  );
  await pool.query('DELETE FROM devs_contribution_score WHERE account_id = $1', [accountId]);
}

// Is this GitHub identity already verified by a DIFFERENT account? Guards against
// two players both proving the same handle (the first to verify wins it).
export async function githubVerifiedElsewhere(accountId: number, githubUsername: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM accounts WHERE id <> $1 AND github_verified = TRUE AND lower(github_username) = lower($2) LIMIT 1`,
    [accountId, githubUsername],
  );
  return res.rowCount! > 0;
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

// --- $WOC reward ledger (reserve-then-pay) ----------------------------------

export async function getClaimedBaseUnits(accountId: number): Promise<bigint> {
  const res = await pool.query('SELECT claimed_base_units FROM devs_contribution_score WHERE account_id = $1', [accountId]);
  return BigInt(res.rows[0]?.claimed_base_units ?? 0);
}

// Reserve in a short, row-locked transaction that COMMITS before any transfer:
// reads claimed FOR UPDATE, advances it to `earnedBaseUnits`, and returns the
// reserved delta. A concurrent/retried claim sees the advanced total and gets 0,
// so we can never pay twice. Errs toward under-paying (operator-reconcilable).
export async function reserveClaim(
  accountId: number,
  earnedBaseUnits: bigint,
): Promise<{ amount: bigint; priorClaimed: bigint }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      'SELECT claimed_base_units FROM devs_contribution_score WHERE account_id = $1 FOR UPDATE',
      [accountId],
    );
    const prior = BigInt(r.rows[0]?.claimed_base_units ?? 0);
    const amount = earnedBaseUnits > prior ? earnedBaseUnits - prior : BigInt(0);
    if (amount > BigInt(0)) {
      await client.query('UPDATE devs_contribution_score SET claimed_base_units = $2 WHERE account_id = $1', [
        accountId,
        (prior + amount).toString(),
      ]);
    }
    await client.query('COMMIT');
    return { amount, priorClaimed: prior };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Roll a reservation back if the on-chain transfer never landed.
export async function releaseClaim(accountId: number, priorClaimed: bigint): Promise<void> {
  await pool.query('UPDATE devs_contribution_score SET claimed_base_units = $2 WHERE account_id = $1', [
    accountId,
    priorClaimed.toString(),
  ]);
}

export async function finalizeClaim(accountId: number, signature: string): Promise<void> {
  await pool.query(
    'UPDATE devs_contribution_score SET last_claim_sig = $2, last_claim_at = now() WHERE account_id = $1',
    [accountId, signature],
  );
}
