import { pool } from './db';
import { REALM } from './realm';

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
}

export interface DailyRewardInternalPayoutRow extends DailyRewardPayoutRow {
  realm: string;
}

export interface DailyRewardWinnerAnnouncement {
  day: string;
  realm: string;
  prizePoolUsd: number;
  finalizedAt: string | null;
  payouts: DailyRewardInternalPayoutRow[];
}

export interface DailyRewardDb {
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
  pendingPayouts(limit: number): Promise<DailyRewardInternalPayoutRow[]>;
  unannouncedWinnerDays(limit: number): Promise<DailyRewardWinnerAnnouncement[]>;
  markWinnersAnnounced(day: string): Promise<boolean>;
  markPayout(
    day: string,
    rank: number,
    status: string,
    txSignature: string | null,
    error: string | null,
  ): Promise<boolean>;
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
    rank: Number(row.rank),
    accountId: Number(row.account_id),
    username: String(row.username),
    walletPubkey: optionalString(row.wallet_pubkey),
    points: Number(row.points),
    prizePercent: Number(row.prize_percent),
    prizeUsd: Number(row.prize_usd),
    status: String(row.status),
    txSignature: optionalString(row.tx_signature),
    paidAt: optionalString(row.paid_at),
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
           FROM daily_reward_scores
          WHERE day = $1 AND realm = $2 AND points > 0
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
       )
       SELECT account_id, username, points, rank FROM ranked WHERE account_id = $3`,
      [day, REALM, accountId],
    );
    return res.rows[0] ? scoreRow(res.rows[0]) : null;
  }

  async leaderboardTotal(day: string): Promise<number> {
    const res = await pool.query(
      `SELECT COUNT(*) AS total
         FROM daily_reward_scores
        WHERE day = $1 AND realm = $2 AND points > 0`,
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
       VALUES ($1, $2, $3, $4, $5)
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
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
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
      `SELECT p.day, p.rank, p.account_id, p.username,
              COALESCE(p.wallet_pubkey, wl.pubkey) AS wallet_pubkey, p.points, p.prize_percent,
              p.prize_usd, p.status, p.tx_signature, p.paid_at
         FROM daily_reward_payouts p
         LEFT JOIN wallet_links wl ON wl.account_id = p.account_id
        ORDER BY p.day DESC, p.rank ASC
        LIMIT $1`,
      [Math.max(1, Math.min(100, limit))],
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

  async pendingPayouts(limit: number): Promise<DailyRewardInternalPayoutRow[]> {
    const res = await pool.query(
      `SELECT p.day, p.realm, p.rank, p.account_id, p.username,
              COALESCE(p.wallet_pubkey, wl.pubkey) AS wallet_pubkey, p.points,
              p.prize_percent, p.prize_usd, p.status, p.tx_signature, p.paid_at
         FROM daily_reward_payouts p
         LEFT JOIN wallet_links wl ON wl.account_id = p.account_id
        WHERE p.status IN ('pending', 'failed')
        ORDER BY p.day ASC, p.rank ASC
        LIMIT $1`,
      [Math.max(1, Math.min(100, limit))],
    );
    return res.rows.map((row) => ({ ...payoutRow(row), realm: String(row.realm) }));
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
                p.prize_percent, p.prize_usd, p.status, p.tx_signature, p.paid_at
           FROM daily_reward_payouts p
           LEFT JOIN wallet_links wl ON wl.account_id = p.account_id
          WHERE p.day = $1 AND p.realm = $2
          ORDER BY p.rank ASC
          LIMIT 10`,
        [String(day.day), String(day.realm)],
      );
      out.push({
        day: String(day.day),
        realm: String(day.realm),
        prizePoolUsd: Number(day.prize_pool_usd),
        finalizedAt: dateString(day.finalized_at),
        payouts: payouts.rows.map((row) => ({ ...payoutRow(row), realm: String(row.realm) })),
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
    const res = await pool.query(
      `UPDATE daily_reward_payouts
          SET status = $4,
              tx_signature = $5,
              error = $6,
              paid_at = CASE WHEN $4 = 'paid' THEN now() ELSE paid_at END,
              updated_at = now()
        WHERE day = $1 AND realm = $2 AND rank = $3`,
      [day, REALM, rank, status, txSignature, error],
    );
    return (res.rowCount ?? 0) > 0;
  }
}
