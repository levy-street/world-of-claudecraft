// The world quest block's persistence (src/sim/world_quest_block.ts): the two
// audited operator writes and the join-time read. The account row is the one
// source of truth (accounts.world_quests_blocked_at, NULL = not blocked); the
// sim flag is a per-session copy the game server stamps from it.
//
// Each write and its moderation-history row commit in ONE transaction, and a
// refused write rolls back before the audit insert, so history never records a
// block or lift that did not happen.

import { pool } from './db';
import { cleanText, recordModerationAction } from './moderation_db';
import { WorldQuestBlockRefused } from './world_quest_block_api';

// Mirrors moderation_db's ACTION_REASON_MAX: the audit reason column's ceiling.
const WORLD_QUEST_BLOCK_REASON_MAX = 500;

/** Block an account from world quests. Refuses an account already blocked. */
export async function setAccountWorldQuestBlock(input: {
  accountId: number;
  adminAccountId: number;
  reason: unknown;
}): Promise<void> {
  const reason = cleanText(input.reason, WORLD_QUEST_BLOCK_REASON_MAX);
  if (!reason) throw new WorldQuestBlockRefused('reason_required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Row lock first, so a concurrent block cannot pass the same NULL check and
    // write a second audit row for one decision.
    const current = await client.query<{ blocked: boolean }>(
      `SELECT world_quests_blocked_at IS NOT NULL AS blocked
         FROM accounts WHERE id = $1 FOR UPDATE`,
      [input.accountId],
    );
    const row = current.rows[0];
    if (!row) throw new WorldQuestBlockRefused('no_account');
    if (row.blocked) throw new WorldQuestBlockRefused('already_blocked');
    await client.query(
      `UPDATE accounts
          SET world_quests_blocked_at = now(), world_quests_block_reason = $2
        WHERE id = $1`,
      [input.accountId, reason],
    );
    await recordModerationAction(client, 'world_quests_block', {
      accountId: input.accountId,
      adminAccountId: input.adminAccountId,
      reason,
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Lift a world quest block. Refuses an account that is not blocked, so a
 *  double-click cannot write an audit row claiming a second lift. */
export async function liftAccountWorldQuestBlock(input: {
  accountId: number;
  adminAccountId: number;
  reason: unknown;
}): Promise<void> {
  const reason = cleanText(input.reason, WORLD_QUEST_BLOCK_REASON_MAX);
  if (!reason) throw new WorldQuestBlockRefused('reason_required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE accounts
          SET world_quests_blocked_at = NULL, world_quests_block_reason = NULL
        WHERE id = $1 AND world_quests_blocked_at IS NOT NULL`,
      [input.accountId],
    );
    if ((updated.rowCount ?? 0) === 0) throw new WorldQuestBlockRefused('not_blocked');
    await recordModerationAction(client, 'world_quests_unblock', {
      accountId: input.accountId,
      adminAccountId: input.adminAccountId,
      reason,
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Whether the account is blocked from world quests. Read once at world join. */
export async function accountWorldQuestsBlocked(accountId: number): Promise<boolean> {
  const res = await pool.query<{ blocked: boolean }>(
    'SELECT world_quests_blocked_at IS NOT NULL AS blocked FROM accounts WHERE id = $1',
    [accountId],
  );
  return res.rows[0]?.blocked === true;
}
