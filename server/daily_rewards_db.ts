import { ELIGIBLE_ACCOUNT_SQL, pool } from './db';
import { REALM } from './realm';

// Every ranked read below embeds ELIGIBLE_ACCOUNT_SQL: banned and suspended
// accounts are delisted from the daily board (and stop inflating other
// players' ranks) the same way as every other public board. All five ranked
// reads share the predicate so the page, the total, and the self rank always
// agree on one population. These reads run per request (no board cache), so
// the SQL exclusion alone delists immediately; there is nothing to bust.
// The payout path embeds it too: finalizeDay selects winners from the same
// population the board displays, and pendingPayouts rechecks eligibility at
// pay time so a ban or suspension landing after finalization still blocks
// the transfer.

export interface DailyRewardTaskRow {
  taskId: string;
  type: string;
  title: string;
  description: string;
  points: number;
  basePoints: number;
  config: Record<string, unknown>;
  completed: boolean;
}

export interface DailyRewardScoreRow {
  accountId: number;
  username: string;
  points: number;
  rank: number;
}

export interface DailyRewardLeaderboardPageRow {
  rows: DailyRewardScoreRow[];
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
}

export interface DailyRewardSpinRow {
  outcomeKey: string;
  points: number;
  createdAt: string;
}

export interface DailyRewardPayoutRow {
  day: string;
  realm: string;
  rank: number;
  accountId: number;
  username: string;
  walletPubkey: string | null;
  points: number;
  prizePercent: number;
  prizeUsd: number;
  status: string;
  txSignature: string | null;
  paidAt: string | null;
  voidReason: string | null;
  voidedById: string | null;
  voidedByUsername: string | null;
  voidedAt: string | null;
}

export interface DailyRewardInternalPayoutRow extends DailyRewardPayoutRow {
  realm: string;
  signedTransaction: string | null;
}

export interface DailyRewardPayoutActor {
  id: string;
  username: string;
}

export type DailyRewardPayoutModerationResult =
  | { outcome: 'updated'; payout: DailyRewardInternalPayoutRow }
  | { outcome: 'not_found' }
  | { outcome: 'invalid_status'; status: string };

export type DailyRewardPayoutClaimResult =
  | { outcome: 'claimed' | 'existing'; payout: DailyRewardInternalPayoutRow }
  | { outcome: 'not_found' }
  | { outcome: 'invalid_status'; status: string };

export interface DailyRewardPayoutAttemptRow {
  status: 'prepared' | 'paid' | 'failed';
  operationId: string;
  txSignature: string;
  signedTransaction: string | null;
}

export type DailyRewardPayoutAttemptClaimResult =
  | { outcome: 'claimed' | 'existing'; attempt: DailyRewardPayoutAttemptRow }
  | { outcome: 'not_found' }
  | { outcome: 'invalid_status'; status: string };

export interface DailyRewardWinnerAnnouncement {
  day: string;
  realm: string;
  prizePoolUsd: number;
  finalizedAt: string | null;
  payouts: DailyRewardInternalPayoutRow[];
}

export interface DailyRewardDb {
  banForAccount(accountId: number): Promise<{ reason: string } | null>;
  ensureDay(day: string, prizePoolUsd: number, wocUsdPrice: number | null): Promise<void>;
  seedTasks(day: string, tasks: DailyRewardTaskSeed[]): Promise<void>;
  tasksForAccount(day: string, accountId: number): Promise<DailyRewardTaskRow[]>;
  tasksForType(day: string, type: string): Promise<DailyRewardTaskRow[]>;
  scoreForAccount(day: string, accountId: number): Promise<number>;
  onlineMinutesForAccount(day: string, accountId: number): Promise<number>;
  questTaskCompletionCount(
    day: string,
    accountId: number,
    taskId: string,
    questId: string,
  ): Promise<number>;
  rankForAccount(day: string, accountId: number): Promise<number | null>;
  leaderboard(day: string, accountId: number, limit: number): Promise<DailyRewardScoreRow[]>;
  leaderboardRowForAccount(day: string, accountId: number): Promise<DailyRewardScoreRow | null>;
  leaderboardPage(
    day: string,
    page: number,
    pageSize: number,
  ): Promise<DailyRewardLeaderboardPageRow>;
  leaderboardTotal(day: string): Promise<number>;
  spinForAccount(day: string, accountId: number): Promise<DailyRewardSpinRow | null>;
  recordSpin(day: string, accountId: number, outcomeKey: string, points: number): Promise<boolean>;
  addPoints(
    day: string,
    accountId: number,
    kind: string,
    points: number,
    idempotencyKey: string,
    meta?: Record<string, unknown>,
  ): Promise<boolean>;
  recentPayouts(limit: number): Promise<DailyRewardPayoutRow[]>;
  finalizeDay(day: string, prizePoolUsd: number, splits: readonly number[]): Promise<void>;
  pendingPayouts(limit: number, day?: string): Promise<DailyRewardInternalPayoutRow[]>;
  unannouncedWinnerDays(limit: number): Promise<DailyRewardWinnerAnnouncement[]>;
  markWinnersAnnounced(day: string): Promise<boolean>;
  markPayout(
    day: string,
    rank: number,
    status: string,
    txSignature: string | null,
    error: string | null,
  ): Promise<boolean>;
  claimPayout(
    day: string,
    rank: number,
    txSignature: string,
    signedTransaction: string | null,
  ): Promise<DailyRewardPayoutClaimResult>;
  claimPayoutResend(
    day: string,
    rank: number,
    operationId: string,
    txSignature: string,
    signedTransaction: string | null,
  ): Promise<DailyRewardPayoutAttemptClaimResult>;
  markPayoutResend(
    day: string,
    rank: number,
    operationId: string,
    status: 'paid' | 'failed',
    txSignature: string,
    error: string | null,
  ): Promise<boolean>;
  voidPayout(
    day: string,
    rank: number,
    reason: string,
    actor: DailyRewardPayoutActor,
  ): Promise<DailyRewardPayoutModerationResult>;
  restorePayout(
    day: string,
    rank: number,
    actor: DailyRewardPayoutActor,
  ): Promise<DailyRewardPayoutModerationResult>;
}

export interface DailyRewardTaskSeed {
  id: string;
  type: string;
  title: string;
  description: string;
  points: number;
  basePoints?: number;
  sortOrder: number;
  active?: boolean;
  config?: Record<string, unknown>;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function recordConfig(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function payoutRow(row: Record<string, unknown>): DailyRewardPayoutRow {
  return {
    day: String(row.day),
    realm: String(row.realm),
    rank: Number(row.rank),
    accountId: Number(row.account_id),
    username: String(row.username),
    walletPubkey: optionalString(row.wallet_pubkey),
    points: Number(row.points),
    prizePercent: Number(row.prize_percent),
    prizeUsd: Number(row.prize_usd),
    status: String(row.status),
    txSignature: optionalString(row.tx_signature),
    paidAt: dateString(row.paid_at),
    voidReason: optionalString(row.void_reason),
    voidedById: optionalString(row.voided_by_id),
    voidedByUsername: optionalString(row.voided_by_username),
    voidedAt: dateString(row.voided_at),
  };
}

function internalPayoutRow(row: Record<string, unknown>): DailyRewardInternalPayoutRow {
  return {
    ...payoutRow(row),
    realm: String(row.realm),
    signedTransaction: optionalString(row.signed_transaction),
  };
}

function dateString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return optionalString(value);
}

function scoreRow(row: Record<string, unknown>): DailyRewardScoreRow {
  return {
    accountId: Number(row.account_id),
    username: String(row.username),
    points: Number(row.points),
    rank: Number(row.rank),
  };
}

export class PgDailyRewardDb implements DailyRewardDb {
  async banForAccount(accountId: number): Promise<{ reason: string } | null> {
    const res = await pool.query(
      'SELECT reason FROM daily_reward_excluded_accounts WHERE account_id = $1 LIMIT 1',
      [accountId],
    );
    return res.rows[0] ? { reason: String(res.rows[0].reason) } : null;
  }

  async ensureDay(day: string, prizePoolUsd: number, wocUsdPrice: number | null): Promise<void> {
    await pool.query(
      `INSERT INTO daily_reward_days (day, realm, prize_pool_usd, woc_usd_price)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (day, realm) DO UPDATE
          SET prize_pool_usd = EXCLUDED.prize_pool_usd,
              woc_usd_price = COALESCE(EXCLUDED.woc_usd_price, daily_reward_days.woc_usd_price)`,
      [day, REALM, prizePoolUsd, wocUsdPrice],
    );
  }

  async seedTasks(day: string, tasks: DailyRewardTaskSeed[]): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE daily_reward_tasks
            SET active = false
          WHERE day = $1 AND realm = $2`,
        [day, REALM],
      );
      for (const task of tasks) {
        await client.query(
          `INSERT INTO daily_reward_tasks
            (day, realm, task_id, task_type, title, description, points, base_points,
             sort_order, active, config)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
           ON CONFLICT (day, realm, task_id) DO UPDATE
              SET task_type = EXCLUDED.task_type,
                  title = EXCLUDED.title,
                  description = EXCLUDED.description,
                  points = EXCLUDED.points,
                  base_points = EXCLUDED.base_points,
                  sort_order = EXCLUDED.sort_order,
                  active = EXCLUDED.active,
                  config = EXCLUDED.config`,
          [
            day,
            REALM,
            task.id,
            task.type,
            task.title,
            task.description,
            task.points,
            task.basePoints ?? task.points,
            task.sortOrder,
            task.active ?? true,
            JSON.stringify(task.config ?? {}),
          ],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async tasksForAccount(day: string, accountId: number): Promise<DailyRewardTaskRow[]> {
    const res = await pool.query(
      `SELECT t.task_id, t.task_type, t.title, t.description, t.points, t.base_points, t.config,
              (
                c.account_id IS NOT NULL
                OR EXISTS (
                  SELECT 1
                    FROM daily_reward_events e
                   WHERE e.day = t.day AND e.realm = t.realm
                     AND e.account_id = $3
                     AND e.kind = 'task'
                     AND e.meta->>'taskId' = t.task_id
                )
              ) AS completed
         FROM daily_reward_tasks t
         LEFT JOIN daily_reward_task_completions c
           ON c.day = t.day AND c.realm = t.realm
          AND c.task_id = t.task_id AND c.account_id = $3
        WHERE t.day = $1 AND t.realm = $2 AND t.active = true
        ORDER BY t.sort_order ASC, t.task_id ASC`,
      [day, REALM, accountId],
    );
    return res.rows.map((r) => ({
      taskId: String(r.task_id),
      type: String(r.task_type),
      title: String(r.title),
      description: String(r.description),
      points: Number(r.points),
      basePoints: Number(r.base_points ?? r.points),
      config: recordConfig(r.config),
      completed: r.completed === true,
    }));
  }

  async tasksForType(day: string, type: string): Promise<DailyRewardTaskRow[]> {
    const res = await pool.query(
      `SELECT task_id, task_type, title, description, points, base_points, config
         FROM daily_reward_tasks
        WHERE day = $1 AND realm = $2 AND task_type = $3 AND active = true
        ORDER BY sort_order ASC, task_id ASC`,
      [day, REALM, type],
    );
    return res.rows.map((r) => ({
      taskId: String(r.task_id),
      type: String(r.task_type),
      title: String(r.title),
      description: String(r.description),
      points: Number(r.points),
      basePoints: Number(r.base_points ?? r.points),
      config: recordConfig(r.config),
      completed: false,
    }));
  }

  async scoreForAccount(day: string, accountId: number): Promise<number> {
    const res = await pool.query(
      `SELECT points FROM daily_reward_scores
        WHERE day = $1 AND realm = $2 AND account_id = $3`,
      [day, REALM, accountId],
    );
    return Number(res.rows[0]?.points ?? 0);
  }

  async onlineMinutesForAccount(day: string, accountId: number): Promise<number> {
    const res = await pool.query(
      `SELECT COUNT(*) AS minutes
         FROM daily_reward_events
        WHERE day = $1 AND realm = $2 AND account_id = $3 AND kind = 'online'`,
      [day, REALM, accountId],
    );
    return Number(res.rows[0]?.minutes ?? 0);
  }

  async questTaskCompletionCount(
    day: string,
    accountId: number,
    taskId: string,
    questId: string,
  ): Promise<number> {
    const res = await pool.query(
      `SELECT COUNT(*) AS completions
         FROM daily_reward_events
        WHERE day = $1
          AND realm = $2
          AND account_id = $3
          AND kind = 'task'
          AND meta->>'taskId' = $4
          AND meta->>'questId' = $5`,
      [day, REALM, accountId, taskId, questId],
    );
    return Number(res.rows[0]?.completions ?? 0);
  }

  async rankForAccount(day: string, accountId: number): Promise<number | null> {
    const res = await pool.query(
      `WITH ranked AS (
         SELECT account_id,
                row_number() OVER (ORDER BY points DESC, updated_at ASC, account_id ASC) AS rank
           FROM daily_reward_scores s
          WHERE day = $1 AND realm = $2 AND points > 0
            AND EXISTS (SELECT 1 FROM accounts a
                         WHERE a.id = s.account_id AND ${ELIGIBLE_ACCOUNT_SQL})
            AND NOT EXISTS (
              SELECT 1 FROM daily_reward_excluded_accounts b WHERE b.account_id = s.account_id
            )
       )
       SELECT rank FROM ranked WHERE account_id = $3`,
      [day, REALM, accountId],
    );
    return res.rows[0] ? Number(res.rows[0].rank) : null;
  }

  async leaderboard(
    day: string,
    _accountId: number,
    limit: number,
  ): Promise<DailyRewardScoreRow[]> {
    const res = await pool.query(
      `SELECT s.account_id, a.username, s.points,
              row_number() OVER (ORDER BY s.points DESC, s.updated_at ASC, s.account_id ASC) AS rank
         FROM daily_reward_scores s
         JOIN accounts a ON a.id = s.account_id
        WHERE s.day = $1 AND s.realm = $2 AND s.points > 0
          AND ${ELIGIBLE_ACCOUNT_SQL}
          AND NOT EXISTS (SELECT 1 FROM daily_reward_excluded_accounts b WHERE b.account_id = s.account_id)
        ORDER BY s.points DESC, s.updated_at ASC, s.account_id ASC
        LIMIT $3`,
      [day, REALM, Math.max(1, Math.min(100, limit))],
    );
    return res.rows.map(scoreRow);
  }

  async leaderboardRowForAccount(
    day: string,
    accountId: number,
  ): Promise<DailyRewardScoreRow | null> {
    const res = await pool.query(
      `WITH ranked AS (
         SELECT s.account_id, a.username, s.points,
                row_number() OVER (ORDER BY s.points DESC, s.updated_at ASC, s.account_id ASC) AS rank
           FROM daily_reward_scores s
           JOIN accounts a ON a.id = s.account_id
          WHERE s.day = $1 AND s.realm = $2 AND s.points > 0
            AND ${ELIGIBLE_ACCOUNT_SQL}
            AND NOT EXISTS (SELECT 1 FROM daily_reward_excluded_accounts b WHERE b.account_id = s.account_id)
       )
       SELECT account_id, username, points, rank FROM ranked WHERE account_id = $3`,
      [day, REALM, accountId],
    );
    return res.rows[0] ? scoreRow(res.rows[0]) : null;
  }

  async leaderboardTotal(day: string): Promise<number> {
    const res = await pool.query(
      `SELECT COUNT(*) AS total
         FROM daily_reward_scores s
        WHERE day = $1 AND realm = $2 AND points > 0
          AND EXISTS (SELECT 1 FROM accounts a
                       WHERE a.id = s.account_id AND ${ELIGIBLE_ACCOUNT_SQL})
          AND NOT EXISTS (
            SELECT 1 FROM daily_reward_excluded_accounts b WHERE b.account_id = s.account_id
          )`,
      [day, REALM],
    );
    return Number(res.rows[0]?.total ?? 0);
  }

  async leaderboardPage(
    day: string,
    page: number,
    pageSize: number,
  ): Promise<DailyRewardLeaderboardPageRow> {
    const requestedPageSize = Number.isFinite(pageSize) ? Math.floor(pageSize) : 50;
    const safePageSize = Math.max(1, Math.min(100, requestedPageSize));
    const total = await this.leaderboardTotal(day);
    const pageCount = Math.max(1, Math.ceil(total / safePageSize));
    const requestedPage = Number.isFinite(page) ? Math.floor(page) : 0;
    const safePage = Math.max(0, Math.min(pageCount - 1, requestedPage));
    const res = await pool.query(
      `SELECT s.account_id, a.username, s.points,
              row_number() OVER (ORDER BY s.points DESC, s.updated_at ASC, s.account_id ASC) AS rank
         FROM daily_reward_scores s
         JOIN accounts a ON a.id = s.account_id
        WHERE s.day = $1 AND s.realm = $2 AND s.points > 0
          AND ${ELIGIBLE_ACCOUNT_SQL}
          AND NOT EXISTS (SELECT 1 FROM daily_reward_excluded_accounts b WHERE b.account_id = s.account_id)
        ORDER BY s.points DESC, s.updated_at ASC, s.account_id ASC
        OFFSET $3
        LIMIT $4`,
      [day, REALM, safePage * safePageSize, safePageSize],
    );
    return {
      rows: res.rows.map(scoreRow),
      page: safePage,
      pageSize: safePageSize,
      pageCount,
      total,
    };
  }

  async spinForAccount(day: string, accountId: number): Promise<DailyRewardSpinRow | null> {
    const res = await pool.query(
      `SELECT outcome_key, points, created_at FROM daily_reward_spins
        WHERE day = $1 AND realm = $2 AND account_id = $3`,
      [day, REALM, accountId],
    );
    const row = res.rows[0];
    return row
      ? {
          outcomeKey: String(row.outcome_key),
          points: Number(row.points),
          createdAt: row.created_at,
        }
      : null;
  }

  async recordSpin(
    day: string,
    accountId: number,
    outcomeKey: string,
    points: number,
  ): Promise<boolean> {
    const res = await pool.query(
      `INSERT INTO daily_reward_spins (day, realm, account_id, outcome_key, points)
       SELECT $1, $2, $3, $4, $5
       WHERE NOT EXISTS (SELECT 1 FROM daily_reward_excluded_accounts WHERE account_id = $3)
       ON CONFLICT (day, realm, account_id) DO NOTHING`,
      [day, REALM, accountId, outcomeKey, points],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async addPoints(
    day: string,
    accountId: number,
    kind: string,
    points: number,
    idempotencyKey: string,
    meta: Record<string, unknown> = {},
  ): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const event = await client.query(
        `INSERT INTO daily_reward_events
          (day, realm, account_id, kind, points, idempotency_key, meta)
         SELECT $1, $2, $3, $4, $5, $6, $7::jsonb
         WHERE NOT EXISTS (SELECT 1 FROM daily_reward_excluded_accounts WHERE account_id = $3)
         ON CONFLICT (day, realm, account_id, idempotency_key) DO NOTHING`,
        [day, REALM, accountId, kind, points, idempotencyKey, JSON.stringify(meta)],
      );
      if ((event.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query(
        `INSERT INTO daily_reward_scores (day, realm, account_id, points)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (day, realm, account_id) DO UPDATE
            SET points = daily_reward_scores.points + EXCLUDED.points,
                updated_at = now()`,
        [day, REALM, accountId, Math.max(0, Math.floor(points))],
      );
      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async recentPayouts(limit: number): Promise<DailyRewardPayoutRow[]> {
    const res = await pool.query(
      `SELECT p.day, p.realm, p.rank, p.account_id, p.username,
              COALESCE(p.wallet_pubkey, wl.pubkey) AS wallet_pubkey, p.points, p.prize_percent,
              p.prize_usd, p.status, p.tx_signature, p.paid_at, p.void_reason,
              p.voided_by_id, p.voided_by_username, p.voided_at
         FROM daily_reward_payouts p
         LEFT JOIN wallet_links wl ON wl.account_id = p.account_id
        WHERE p.realm = $1
        ORDER BY p.day DESC, p.rank ASC
        LIMIT $2`,
      [REALM, Math.max(1, Math.min(100, limit))],
    );
    return res.rows.map(payoutRow);
  }

  async finalizeDay(day: string, prizePoolUsd: number, splits: readonly number[]): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE daily_reward_days
            SET finalized_at = COALESCE(finalized_at, now())
          WHERE day = $1 AND realm = $2`,
        [day, REALM],
      );
      const winners = await client.query(
        `SELECT s.account_id, a.username, wl.pubkey AS wallet_pubkey, s.points,
                row_number() OVER (ORDER BY s.points DESC, s.updated_at ASC, s.account_id ASC) AS rank
           FROM daily_reward_scores s
           JOIN accounts a ON a.id = s.account_id
           LEFT JOIN wallet_links wl ON wl.account_id = s.account_id
          WHERE s.day = $1 AND s.realm = $2 AND s.points > 0
            AND ${ELIGIBLE_ACCOUNT_SQL}
            AND NOT EXISTS (SELECT 1 FROM daily_reward_excluded_accounts b WHERE b.account_id = s.account_id)
          ORDER BY s.points DESC, s.updated_at ASC, s.account_id ASC
          LIMIT 10`,
        [day, REALM],
      );
      for (const row of winners.rows) {
        const rank = Number(row.rank);
        const percent = splits[rank - 1] ?? 0;
        await client.query(
          `INSERT INTO daily_reward_payouts
            (day, realm, rank, account_id, username, wallet_pubkey, points, prize_percent, prize_usd)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (day, realm, rank) DO NOTHING`,
          [
            day,
            REALM,
            rank,
            Number(row.account_id),
            String(row.username),
            row.wallet_pubkey ?? null,
            Number(row.points),
            percent,
            Number((prizePoolUsd * percent).toFixed(2)),
          ],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async pendingPayouts(limit: number, day?: string): Promise<DailyRewardInternalPayoutRow[]> {
    const boundedLimit = Math.max(1, Math.min(100, limit));
    const dayFilter = day ? 'AND p.day = $2' : '';
    const limitPlaceholder = day ? '$3' : '$2';
    const res = await pool.query(
      `SELECT p.day, p.realm, p.rank, p.account_id, p.username,
              COALESCE(p.wallet_pubkey, wl.pubkey) AS wallet_pubkey, p.points,
              p.prize_percent, p.prize_usd, p.status, p.tx_signature, p.paid_at,
              p.signed_transaction, p.void_reason, p.voided_by_id,
              p.voided_by_username, p.voided_at
         FROM daily_reward_payouts p
         LEFT JOIN wallet_links wl ON wl.account_id = p.account_id
        WHERE p.realm = $1
          AND p.status IN ('pending', 'failed', 'processing')
          ${dayFilter}
          AND EXISTS (SELECT 1 FROM accounts a
                       WHERE a.id = p.account_id AND ${ELIGIBLE_ACCOUNT_SQL})
          AND NOT EXISTS (SELECT 1 FROM daily_reward_excluded_accounts b WHERE b.account_id = p.account_id)
        ORDER BY p.day ASC, p.rank ASC
        LIMIT ${limitPlaceholder}`,
      day ? [REALM, day, boundedLimit] : [REALM, boundedLimit],
    );
    return res.rows.map(internalPayoutRow);
  }

  async unannouncedWinnerDays(limit: number): Promise<DailyRewardWinnerAnnouncement[]> {
    const days = await pool.query(
      `SELECT d.day, d.realm, d.prize_pool_usd, d.finalized_at
         FROM daily_reward_days d
        WHERE d.realm = $1
          AND d.finalized_at IS NOT NULL
          AND d.discord_announced_at IS NULL
          AND EXISTS (
            SELECT 1
              FROM daily_reward_payouts p
             WHERE p.day = d.day AND p.realm = d.realm
          )
        ORDER BY d.day ASC
        LIMIT $2`,
      [REALM, Math.max(1, Math.min(10, limit))],
    );
    const out: DailyRewardWinnerAnnouncement[] = [];
    for (const day of days.rows) {
      const payouts = await pool.query(
        `SELECT p.day, p.realm, p.rank, p.account_id, p.username,
                COALESCE(p.wallet_pubkey, wl.pubkey) AS wallet_pubkey, p.points,
                p.prize_percent, p.prize_usd, p.status, p.tx_signature, p.paid_at,
                p.void_reason, p.voided_by_id, p.voided_by_username, p.voided_at
           FROM daily_reward_payouts p
           LEFT JOIN wallet_links wl ON wl.account_id = p.account_id
          WHERE p.day = $1 AND p.realm = $2
            AND NOT EXISTS (SELECT 1 FROM daily_reward_excluded_accounts b WHERE b.account_id = p.account_id)
          ORDER BY p.rank ASC
          LIMIT 10`,
        [String(day.day), String(day.realm)],
      );
      out.push({
        day: String(day.day),
        realm: String(day.realm),
        prizePoolUsd: Number(day.prize_pool_usd),
        finalizedAt: dateString(day.finalized_at),
        payouts: payouts.rows.map(internalPayoutRow),
      });
    }
    return out;
  }

  async markWinnersAnnounced(day: string): Promise<boolean> {
    const res = await pool.query(
      `UPDATE daily_reward_days
          SET discord_announced_at = COALESCE(discord_announced_at, now())
        WHERE day = $1 AND realm = $2 AND finalized_at IS NOT NULL`,
      [day, REALM],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async markPayout(
    day: string,
    rank: number,
    status: string,
    txSignature: string | null,
    error: string | null,
  ): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(
        `UPDATE daily_reward_payouts
            SET status = $4,
                error = $6,
                paid_at = CASE WHEN $4 = 'paid' THEN now() ELSE paid_at END,
                updated_at = now()
          WHERE day = $1 AND realm = $2 AND rank = $3
            AND (
              (status = 'processing' AND tx_signature = $5)
              OR (status IN ('pending', 'failed') AND $4 = 'failed' AND $5 IS NULL)
            )`,
        [day, REALM, rank, status, txSignature, error],
      );
      let updated = (res.rowCount ?? 0) === 1;
      if (!updated && status === 'paid' && txSignature) {
        const existing = await client.query(
          `SELECT 1
             FROM daily_reward_payouts
            WHERE day = $1 AND realm = $2 AND rank = $3
              AND status = 'paid' AND tx_signature = $4`,
          [day, REALM, rank, txSignature],
        );
        updated = (existing.rowCount ?? 0) === 1;
      }
      if ((res.rowCount ?? 0) === 1 && txSignature) {
        await client.query(
          `UPDATE daily_reward_payout_attempts
              SET status = $4, error = $5, updated_at = now()
            WHERE day = $1 AND realm = $2 AND rank = $3
              AND tx_signature = $6 AND kind = 'payout'`,
          [day, REALM, rank, status, error, txSignature],
        );
      }
      await client.query('COMMIT');
      return updated;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async claimPayout(
    day: string,
    rank: number,
    txSignature: string,
    signedTransaction: string | null,
  ): Promise<DailyRewardPayoutClaimResult> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT p.day, p.realm, p.rank, p.account_id, p.username,
                COALESCE(p.wallet_pubkey, wl.pubkey) AS wallet_pubkey, p.points,
                p.prize_percent, p.prize_usd, p.status, p.tx_signature, p.paid_at,
                p.signed_transaction, p.void_reason, p.voided_by_id,
                p.voided_by_username, p.voided_at
           FROM daily_reward_payouts p
           LEFT JOIN wallet_links wl ON wl.account_id = p.account_id
          WHERE p.day = $1 AND p.realm = $2 AND p.rank = $3
          FOR UPDATE OF p`,
        [day, REALM, rank],
      );
      const row = current.rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        await client.query('COMMIT');
        return { outcome: 'not_found' };
      }
      const status = String(row.status);
      if (status === 'processing' || status === 'paid') {
        await client.query('COMMIT');
        return { outcome: 'existing', payout: internalPayoutRow(row) };
      }
      if (status !== 'pending' && status !== 'failed') {
        await client.query('COMMIT');
        return { outcome: 'invalid_status', status };
      }
      await client.query(
        `INSERT INTO daily_reward_payout_attempts
          (day, realm, rank, kind, status, tx_signature, signed_transaction)
         VALUES ($1, $2, $3, 'payout', 'prepared', $4, $5)`,
        [day, REALM, rank, txSignature, signedTransaction],
      );
      await client.query(
        `UPDATE daily_reward_payouts
            SET status = 'processing', tx_signature = $4, signed_transaction = $5,
                error = NULL, updated_at = now()
          WHERE day = $1 AND realm = $2 AND rank = $3`,
        [day, REALM, rank, txSignature, signedTransaction],
      );
      await client.query('COMMIT');
      return {
        outcome: 'claimed',
        payout: internalPayoutRow({
          ...row,
          status: 'processing',
          tx_signature: txSignature,
          signed_transaction: signedTransaction,
        }),
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async claimPayoutResend(
    day: string,
    rank: number,
    operationId: string,
    txSignature: string,
    signedTransaction: string | null,
  ): Promise<DailyRewardPayoutAttemptClaimResult> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const payout = await client.query(
        `SELECT status
           FROM daily_reward_payouts
          WHERE day = $1 AND realm = $2 AND rank = $3
          FOR UPDATE`,
        [day, REALM, rank],
      );
      if (!payout.rows[0]) {
        await client.query('COMMIT');
        return { outcome: 'not_found' };
      }
      if (String(payout.rows[0].status) !== 'paid') {
        await client.query('COMMIT');
        return { outcome: 'invalid_status', status: String(payout.rows[0].status) };
      }
      const existing = await client.query(
        `SELECT status, operation_id, tx_signature, signed_transaction
           FROM daily_reward_payout_attempts
          WHERE day = $1 AND realm = $2 AND rank = $3
            AND kind = 'resend' AND operation_id = $4
          ORDER BY id DESC
          LIMIT 1`,
        [day, REALM, rank, operationId],
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return {
          outcome: 'existing',
          attempt: {
            status: String(existing.rows[0].status) as 'prepared' | 'paid' | 'failed',
            operationId: String(existing.rows[0].operation_id),
            txSignature: String(existing.rows[0].tx_signature),
            signedTransaction: optionalString(existing.rows[0].signed_transaction),
          },
        };
      }
      await client.query(
        `INSERT INTO daily_reward_payout_attempts
          (day, realm, rank, kind, operation_id, status, tx_signature, signed_transaction)
         VALUES ($1, $2, $3, 'resend', $4, 'prepared', $5, $6)`,
        [day, REALM, rank, operationId, txSignature, signedTransaction],
      );
      await client.query('COMMIT');
      return {
        outcome: 'claimed',
        attempt: { status: 'prepared', operationId, txSignature, signedTransaction },
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async markPayoutResend(
    day: string,
    rank: number,
    operationId: string,
    status: 'paid' | 'failed',
    txSignature: string,
    error: string | null,
  ): Promise<boolean> {
    const res = await pool.query(
      `UPDATE daily_reward_payout_attempts a
          SET status = $5, error = $7, updated_at = now()
        WHERE a.day = $1 AND a.realm = $2 AND a.rank = $3
          AND a.kind = 'resend' AND a.operation_id = $4
          AND a.status = 'prepared' AND a.tx_signature = $6
          AND EXISTS (
            SELECT 1 FROM daily_reward_payouts p
             WHERE p.day = a.day AND p.realm = a.realm AND p.rank = a.rank
               AND p.status = 'paid'
          )`,
      [day, REALM, rank, operationId, status, txSignature, error],
    );
    if ((res.rowCount ?? 0) > 0) return true;
    if (status !== 'paid') return false;
    const existing = await pool.query(
      `SELECT 1 FROM daily_reward_payout_attempts
        WHERE day = $1 AND realm = $2 AND rank = $3
          AND kind = 'resend' AND operation_id = $4
          AND status = 'paid' AND tx_signature = $5`,
      [day, REALM, rank, operationId, txSignature],
    );
    return (existing.rowCount ?? 0) > 0;
  }

  async voidPayout(
    day: string,
    rank: number,
    reason: string,
    actor: DailyRewardPayoutActor,
  ): Promise<DailyRewardPayoutModerationResult> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT p.day, p.realm, p.rank, p.account_id, p.username,
                COALESCE(p.wallet_pubkey, wl.pubkey) AS wallet_pubkey, p.points,
                p.prize_percent, p.prize_usd, p.status, p.tx_signature, p.paid_at,
                p.void_reason, p.voided_by_id, p.voided_by_username, p.voided_at
           FROM daily_reward_payouts p
           LEFT JOIN wallet_links wl ON wl.account_id = p.account_id
          WHERE p.day = $1 AND p.realm = $2 AND p.rank = $3
          FOR UPDATE OF p`,
        [day, REALM, rank],
      );
      const row = current.rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        await client.query('COMMIT');
        return { outcome: 'not_found' };
      }
      const previousStatus = String(row.status);
      if (previousStatus !== 'pending' && previousStatus !== 'failed') {
        await client.query('COMMIT');
        return { outcome: 'invalid_status', status: previousStatus };
      }
      const updated = await client.query(
        `UPDATE daily_reward_payouts
            SET status = 'voided',
                void_reason = $4,
                voided_by_id = $5,
                voided_by_username = $6,
                voided_at = now(),
                updated_at = now()
          WHERE day = $1 AND realm = $2 AND rank = $3
            AND status IN ('pending', 'failed')
        RETURNING voided_at`,
        [day, REALM, rank, reason, actor.id, actor.username],
      );
      if ((updated.rowCount ?? 0) !== 1) throw new Error('payout void transition lost its lock');
      await client.query(
        `INSERT INTO daily_reward_payout_moderation_audit
          (day, realm, rank, account_id, action, previous_status, next_status, reason,
           actor_id, actor_username)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          day,
          REALM,
          rank,
          Number(row.account_id),
          'void',
          previousStatus,
          'voided',
          reason,
          actor.id,
          actor.username,
        ],
      );
      await client.query('COMMIT');
      return {
        outcome: 'updated',
        payout: {
          ...internalPayoutRow({
            ...row,
            status: 'voided',
            void_reason: reason,
            voided_by_id: actor.id,
            voided_by_username: actor.username,
            voided_at: updated.rows[0]?.voided_at,
          }),
        },
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async restorePayout(
    day: string,
    rank: number,
    actor: DailyRewardPayoutActor,
  ): Promise<DailyRewardPayoutModerationResult> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT p.day, p.realm, p.rank, p.account_id, p.username,
                COALESCE(p.wallet_pubkey, wl.pubkey) AS wallet_pubkey, p.points,
                p.prize_percent, p.prize_usd, p.status, p.tx_signature, p.paid_at,
                p.void_reason, p.voided_by_id, p.voided_by_username, p.voided_at
           FROM daily_reward_payouts p
           LEFT JOIN wallet_links wl ON wl.account_id = p.account_id
          WHERE p.day = $1 AND p.realm = $2 AND p.rank = $3
          FOR UPDATE OF p`,
        [day, REALM, rank],
      );
      const row = current.rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        await client.query('COMMIT');
        return { outcome: 'not_found' };
      }
      const previousStatus = String(row.status);
      if (previousStatus !== 'voided') {
        await client.query('COMMIT');
        return { outcome: 'invalid_status', status: previousStatus };
      }
      const reason = optionalString(row.void_reason) ?? 'Unknown void reason';
      const updated = await client.query(
        `UPDATE daily_reward_payouts
            SET status = 'pending',
                tx_signature = NULL,
                signed_transaction = NULL,
                error = NULL,
                void_reason = NULL,
                voided_by_id = NULL,
                voided_by_username = NULL,
                voided_at = NULL,
                updated_at = now()
          WHERE day = $1 AND realm = $2 AND rank = $3
            AND status = 'voided'
        RETURNING status`,
        [day, REALM, rank],
      );
      if ((updated.rowCount ?? 0) !== 1) {
        throw new Error('payout restore transition lost its lock');
      }
      await client.query(
        `INSERT INTO daily_reward_payout_moderation_audit
          (day, realm, rank, account_id, action, previous_status, next_status, reason,
           actor_id, actor_username)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          day,
          REALM,
          rank,
          Number(row.account_id),
          'restore',
          previousStatus,
          'pending',
          reason,
          actor.id,
          actor.username,
        ],
      );
      await client.query('COMMIT');
      return {
        outcome: 'updated',
        payout: {
          ...internalPayoutRow({
            ...row,
            status: 'pending',
            tx_signature: null,
            signed_transaction: null,
            void_reason: null,
            voided_by_id: null,
            voided_by_username: null,
            voided_at: null,
          }),
        },
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
