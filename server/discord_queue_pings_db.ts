// The queue-pop DM opt-in flag (accounts.discord_queue_pings): the SQL boundary
// behind the /api/discord/queue-pings toggle (server/discord_queue_pings.ts)
// and the game loop's opt-in read (server/discord_queue_pops.ts). Mirrors the
// deed_broadcasts pair in deeds_db.ts, with the opposite default: a DM is far
// more intrusive than a channel card, so the column defaults FALSE and a
// missing row reads as opted OUT.

import type { Pool } from 'pg';
import { pool } from './db';

/** The opt-in flag. A missing account row reads as FALSE (the column default). */
export async function getDiscordQueuePings(accountId: number): Promise<boolean> {
  const res = await pool.query('SELECT discord_queue_pings FROM accounts WHERE id = $1', [
    accountId,
  ]);
  return res.rows[0]?.discord_queue_pings === true;
}

export async function setDiscordQueuePings(accountId: number, enabled: boolean): Promise<void> {
  await pool.query('UPDATE accounts SET discord_queue_pings = $2 WHERE id = $1', [
    accountId,
    enabled,
  ]);
}

/**
 * Which of these accounts opted in AND hold a Discord link, in ONE statement.
 * The link join is what keeps an opted-in but unlinked player from arming the
 * bot's fast poll cadence for a DM that could never be sent (the outbox drain
 * drops unlinked items anyway, so the join changes nothing about delivery).
 * The pool is a parameter, like discordLinksForAccounts, so the observer's
 * production deps bind it without the test rig reaching the real pool.
 */
export async function accountsWithDiscordQueuePings(
  db: Pool,
  accountIds: readonly number[],
): Promise<number[]> {
  if (accountIds.length === 0) return [];
  const res = await db.query(
    `SELECT a.id FROM accounts a
       JOIN discord_links d ON d.account_id = a.id
      WHERE a.id = ANY($1::int[]) AND a.discord_queue_pings`,
    [[...new Set(accountIds)]],
  );
  return res.rows.map((row: { id: number }) => row.id);
}
