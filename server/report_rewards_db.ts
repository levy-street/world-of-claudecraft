// Permanent pair ledger: keep forever to prevent repeat ban notifications.
// Mail custody rows carry the durable parcel until the recipient partition bakes it.
import { runWithStatementTimeout } from './db';
import { REALM } from './realm';

export const REPORT_REWARDS_SCHEMA = `
CREATE TABLE IF NOT EXISTS report_rewards (
  -- Keep forever: this pair ledger prevents repeated ban notifications.
  id BIGSERIAL PRIMARY KEY,
  reporter_account_id INTEGER NOT NULL,
  reported_account_id INTEGER NOT NULL,
  character_id INTEGER NOT NULL,
  realm TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  booked_at TIMESTAMPTZ,
  notified_at TIMESTAMPTZ,
  retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (reporter_account_id, reported_account_id)
);
CREATE INDEX IF NOT EXISTS report_rewards_due ON report_rewards (realm, retry_at, id)
  WHERE booked_at IS NULL;
CREATE INDEX IF NOT EXISTS report_rewards_notice ON report_rewards (reporter_account_id, id)
  WHERE notified_at IS NULL;
`;

type Query = (text: string, values: unknown[]) => Promise<unknown>;

/** Set-based and inside the ban transaction. No parcel is visible for a failed ban. */
export async function createReportRewardsIn(query: Query, accountId: number): Promise<void> {
  await query(
    `WITH reporters AS (
       SELECT DISTINCT ON (r.reporter_account_id)
         r.reporter_account_id, c.id AS preferred_character_id
       FROM player_reports r
       LEFT JOIN characters c ON c.id = r.reporter_character_id
         AND c.account_id = r.reporter_account_id
       WHERE r.reported_account_id = $1 AND r.reporter_account_id IS NOT NULL
         AND r.reporter_account_id <> $1 AND r.status IN ('open', 'actioned')
       ORDER BY r.reporter_account_id, (c.id IS NOT NULL) DESC, r.id
     ), recipients AS (
       SELECT r.reporter_account_id, c.id, c.realm, c.name
       FROM reporters r JOIN LATERAL (
         SELECT id, realm, name FROM characters
         WHERE account_id = r.reporter_account_id
         ORDER BY (id = r.preferred_character_id) DESC NULLS LAST, id LIMIT 1
       ) c ON true
     ) INSERT INTO report_rewards
         (reporter_account_id, reported_account_id, character_id, realm, recipient_name)
       SELECT reporter_account_id, $1, id, realm, name FROM recipients
       ON CONFLICT (reporter_account_id, reported_account_id) DO NOTHING`,
    [accountId],
  );
}

export interface ReportReward {
  id: number;
  accountId: number;
  characterId: number;
  name: string;
}
export const REPORT_REWARD_BATCH = 100;
export const REPORT_REWARD_TIMEOUT_MS = 2000;

/** Commit the one-way delivery claim before touching live mail. On an ambiguous
 * write, the caller leaves the durable overlay for boot replay instead of minting. */
export async function claimReportRewardDelivery(id: number): Promise<boolean> {
  const result = await runWithStatementTimeout(REPORT_REWARD_TIMEOUT_MS, (query) =>
    query(
      `WITH claim AS (
       UPDATE report_rewards SET booked_at = now()
       WHERE id = $1 AND realm = $2 AND booked_at IS NULL
         AND EXISTS (SELECT 1 FROM characters c
           WHERE c.id = report_rewards.character_id AND c.account_id = report_rewards.reporter_account_id)
       RETURNING id, realm, character_id, recipient_name
     ) INSERT INTO mail_custody_parcels
       (custody_ref, realm, recipient_key, recipient_name, letter, items, copper)
       SELECT 'report_reward:' || id, realm, character_id::text, recipient_name,
         'report_reward', '[]'::jsonb, 0 FROM claim RETURNING custody_ref`,
      [id, REALM],
    ),
  );
  return (result.rowCount ?? 0) === 1;
}

export async function dueReportRewards(): Promise<ReportReward[]> {
  const result = await runWithStatementTimeout(REPORT_REWARD_TIMEOUT_MS, (query) =>
    query(
      `WITH due AS (
         SELECT * FROM report_rewards
         WHERE realm = $1 AND booked_at IS NULL AND retry_at <= now()
         ORDER BY retry_at, id LIMIT $2
       ), resolved AS (
         SELECT r.id, c.id AS character_id, c.realm, c.name
         FROM due r LEFT JOIN LATERAL (
           SELECT id, realm, name FROM characters WHERE account_id = r.reporter_account_id
           ORDER BY (id = r.character_id) DESC, id LIMIT 1
         ) c ON true
       ), updated AS (
         UPDATE report_rewards r SET character_id = COALESCE(c.character_id, r.character_id),
           realm = COALESCE(c.realm, r.realm), recipient_name = COALESCE(c.name, r.recipient_name),
           retry_at = now() + interval '60 seconds'
         FROM resolved c WHERE r.id = c.id AND r.booked_at IS NULL
         RETURNING r.id, r.reporter_account_id, r.character_id, r.recipient_name, r.realm,
           c.character_id AS resolved_character_id
       ) SELECT * FROM updated WHERE realm = $1 AND resolved_character_id IS NOT NULL`,
      [REALM, REPORT_REWARD_BATCH],
    ),
  );
  return result.rows.map((r) => ({
    id: Number(r.id),
    accountId: Number(r.reporter_account_id),
    characterId: Number(r.character_id),
    name: String(r.recipient_name),
  }));
}

export async function retryReportRewardBatch(refused: number[]): Promise<void> {
  if (refused.length === 0) return;
  await runWithStatementTimeout(REPORT_REWARD_TIMEOUT_MS, (query) =>
    query(
      `UPDATE report_rewards SET retry_at = now() + interval '60 seconds'
     WHERE realm = $1 AND booked_at IS NULL AND id = ANY($2::bigint[])`,
      [REALM, refused],
    ),
  );
}

export async function pendingReportRewardNotices(
  accountIds: number[],
): Promise<{ id: number; accountId: number }[]> {
  if (accountIds.length === 0) return [];
  const result = await runWithStatementTimeout(REPORT_REWARD_TIMEOUT_MS, (query) =>
    query(
      `SELECT id, reporter_account_id FROM report_rewards
       WHERE notified_at IS NULL AND reporter_account_id = ANY($1::int[])
       ORDER BY reporter_account_id, id LIMIT $2`,
      [accountIds, REPORT_REWARD_BATCH],
    ),
  );
  return result.rows.map((r) => ({ id: Number(r.id), accountId: Number(r.reporter_account_id) }));
}

export async function confirmReportRewardNotices(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await runWithStatementTimeout(REPORT_REWARD_TIMEOUT_MS, (query) =>
    query(
      `UPDATE report_rewards SET notified_at = now()
     WHERE id = ANY($1::bigint[]) AND notified_at IS NULL`,
      [ids],
    ),
  );
}
