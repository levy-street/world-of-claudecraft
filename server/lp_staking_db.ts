// SQL for the LP staking vault (see lp_staking.ts for the math and
// lp_staking_service.ts for the epoch model). All raw SQL for this feature
// lives here, per the server SQL-only-in-*_db.ts invariant; the service talks
// to the LpStakingDb interface so unit tests use an in-memory fake.
//
// LP_STAKING_SCHEMA is applied by db.ts ensureSchema() under the shared
// pg_advisory_xact_lock, alongside the other module schemas.
import { pool } from './db';

// BIGINT columns hold base units as decimal strings, parsed to bigint in JS.
//
// lp_positions is the server's MIRROR of the on-chain Position accounts (the
// chain is the source of truth for principal; the mirror exists so forfeits
// can be computed from the previous snapshot and reads stay off the RPC).
// lp_epochs + lp_accruals are the reward book: an epoch is reserved through
// the flow ledger FIRST (synthetic tx_sig lp_epoch:<pool>:<epoch>), then its
// accrual rows record who earned what; vesting/forfeit state lives on the
// accrual row. amount semantics per row: forfeited <= amount, paid <= amount.
export const LP_STAKING_SCHEMA = `
CREATE TABLE IF NOT EXISTS lp_positions (
  pool          TEXT NOT NULL,
  owner         TEXT NOT NULL,
  amount_base   BIGINT NOT NULL DEFAULT 0,
  locked_until  BIGINT NOT NULL DEFAULT 0,
  staked_at     BIGINT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pool, owner)
);

CREATE TABLE IF NOT EXISTS lp_epochs (
  pool          TEXT NOT NULL,
  epoch_id      BIGINT NOT NULL,
  season_id     INT NOT NULL,
  snapshot_at   BIGINT NOT NULL,
  total_weight  BIGINT NOT NULL,
  emission_base BIGINT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reserved','void')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pool, epoch_id)
);

CREATE TABLE IF NOT EXISTS lp_accruals (
  accrual_id     BIGSERIAL PRIMARY KEY,
  pool           TEXT NOT NULL,
  epoch_id       BIGINT NOT NULL,
  owner          TEXT NOT NULL,
  amount_base    BIGINT NOT NULL CHECK (amount_base > 0),
  accrued_at     BIGINT NOT NULL,
  forfeited_base BIGINT NOT NULL DEFAULT 0,
  paid_base      BIGINT NOT NULL DEFAULT 0,
  UNIQUE (pool, epoch_id, owner),
  FOREIGN KEY (pool, epoch_id) REFERENCES lp_epochs(pool, epoch_id)
);
CREATE INDEX IF NOT EXISTS lp_accruals_owner ON lp_accruals(owner);
`;

function bigintOf(v: unknown): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return BigInt(v);
  return 0n;
}

export interface LpPositionRow {
  pool: string;
  owner: string;
  amountBase: bigint;
  lockedUntil: number;
  stakedAt: number;
}

export interface LpEpochRow {
  pool: string;
  epochId: bigint;
  seasonId: number;
  snapshotAt: number;
  totalWeight: bigint;
  emissionBase: bigint;
  status: 'pending' | 'reserved' | 'void';
}

export interface LpAccrualRow {
  accrualId: number;
  pool: string;
  epochId: bigint;
  owner: string;
  amountBase: bigint;
  accruedAt: number;
  forfeitedBase: bigint;
  paidBase: bigint;
}

// The persistence seam. Implemented here (Postgres) in production and by an
// in-memory fake in tests. insertEpochWithAccruals must be atomic (one txn).
export interface LpStakingDb {
  positions(poolKey: string): Promise<LpPositionRow[]>;
  upsertPositions(rows: LpPositionRow[]): Promise<void>;
  epoch(poolKey: string, epochId: bigint): Promise<LpEpochRow | null>;
  insertEpochWithAccruals(
    epoch: Omit<LpEpochRow, 'status'>,
    accruals: Omit<LpAccrualRow, 'accrualId' | 'forfeitedBase' | 'paidBase'>[],
  ): Promise<void>;
  setEpochStatus(poolKey: string, epochId: bigint, status: 'reserved' | 'void'): Promise<void>;
  /** Accruals for one owner with an unvested/unpaid remainder, oldest first. */
  openAccrualsForOwner(poolKey: string, owner: string): Promise<LpAccrualRow[]>;
  addForfeit(accrualId: number, forfeitBase: bigint): Promise<void>;
  /** Sum over reserved epochs of accrual (amount - forfeited - paid), the outstanding book. */
  outstandingBase(poolKey: string): Promise<bigint>;
}

export class PgLpStakingDb implements LpStakingDb {
  async positions(poolKey: string): Promise<LpPositionRow[]> {
    const r = await pool.query(
      `SELECT pool, owner, amount_base::text AS amount, locked_until, staked_at
         FROM lp_positions WHERE pool = $1`,
      [poolKey],
    );
    return r.rows.map((row) => ({
      pool: row.pool as string,
      owner: row.owner as string,
      amountBase: bigintOf(row.amount),
      lockedUntil: Number(row.locked_until),
      stakedAt: Number(row.staked_at),
    }));
  }

  async upsertPositions(rows: LpPositionRow[]): Promise<void> {
    if (rows.length === 0) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        await client.query(
          `INSERT INTO lp_positions (pool, owner, amount_base, locked_until, staked_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (pool, owner) DO UPDATE
             SET amount_base = EXCLUDED.amount_base, locked_until = EXCLUDED.locked_until,
                 staked_at = EXCLUDED.staked_at, updated_at = now()`,
          [row.pool, row.owner, row.amountBase.toString(), row.lockedUntil, row.stakedAt],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async epoch(poolKey: string, epochId: bigint): Promise<LpEpochRow | null> {
    const r = await pool.query(
      `SELECT pool, epoch_id::text AS eid, season_id, snapshot_at, total_weight::text AS tw,
              emission_base::text AS eb, status
         FROM lp_epochs WHERE pool = $1 AND epoch_id = $2`,
      [poolKey, epochId.toString()],
    );
    if (r.rowCount === 0) return null;
    const row = r.rows[0];
    return {
      pool: row.pool as string,
      epochId: bigintOf(row.eid),
      seasonId: Number(row.season_id),
      snapshotAt: Number(row.snapshot_at),
      totalWeight: bigintOf(row.tw),
      emissionBase: bigintOf(row.eb),
      status: row.status as LpEpochRow['status'],
    };
  }

  async insertEpochWithAccruals(
    epoch: Omit<LpEpochRow, 'status'>,
    accruals: Omit<LpAccrualRow, 'accrualId' | 'forfeitedBase' | 'paidBase'>[],
  ): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO lp_epochs (pool, epoch_id, season_id, snapshot_at, total_weight, emission_base, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
        [
          epoch.pool,
          epoch.epochId.toString(),
          epoch.seasonId,
          epoch.snapshotAt,
          epoch.totalWeight.toString(),
          epoch.emissionBase.toString(),
        ],
      );
      for (const a of accruals) {
        await client.query(
          `INSERT INTO lp_accruals (pool, epoch_id, owner, amount_base, accrued_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [a.pool, a.epochId.toString(), a.owner, a.amountBase.toString(), a.accruedAt],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async setEpochStatus(
    poolKey: string,
    epochId: bigint,
    status: 'reserved' | 'void',
  ): Promise<void> {
    await pool.query(`UPDATE lp_epochs SET status = $3 WHERE pool = $1 AND epoch_id = $2`, [
      poolKey,
      epochId.toString(),
      status,
    ]);
  }

  async openAccrualsForOwner(poolKey: string, owner: string): Promise<LpAccrualRow[]> {
    const r = await pool.query(
      `SELECT a.accrual_id, a.pool, a.epoch_id::text AS eid, a.owner, a.amount_base::text AS ab,
              a.accrued_at, a.forfeited_base::text AS fb, a.paid_base::text AS pb
         FROM lp_accruals a
         JOIN lp_epochs e ON e.pool = a.pool AND e.epoch_id = a.epoch_id
        WHERE a.pool = $1 AND a.owner = $2 AND e.status = 'reserved'
          AND a.amount_base - a.forfeited_base - a.paid_base > 0
        ORDER BY a.epoch_id ASC`,
      [poolKey, owner],
    );
    return r.rows.map((row) => ({
      accrualId: Number(row.accrual_id),
      pool: row.pool as string,
      epochId: bigintOf(row.eid),
      owner: row.owner as string,
      amountBase: bigintOf(row.ab),
      accruedAt: Number(row.accrued_at),
      forfeitedBase: bigintOf(row.fb),
      paidBase: bigintOf(row.pb),
    }));
  }

  async addForfeit(accrualId: number, forfeitBase: bigint): Promise<void> {
    // The WHERE guard makes an over-forfeit impossible even under a racing
    // double-run: the update only applies while it keeps forfeited+paid <= amount.
    await pool.query(
      `UPDATE lp_accruals SET forfeited_base = forfeited_base + $2
        WHERE accrual_id = $1
          AND forfeited_base + paid_base + $2 <= amount_base`,
      [accrualId, forfeitBase.toString()],
    );
  }

  async outstandingBase(poolKey: string): Promise<bigint> {
    const r = await pool.query(
      `SELECT COALESCE(SUM(a.amount_base - a.forfeited_base - a.paid_base), 0)::text AS outstanding
         FROM lp_accruals a
         JOIN lp_epochs e ON e.pool = a.pool AND e.epoch_id = a.epoch_id
        WHERE a.pool = $1 AND e.status = 'reserved'`,
      [poolKey],
    );
    return bigintOf(r.rows[0]?.outstanding ?? '0');
  }
}

// Cross-process single-flight for the epoch runner: sibling realm processes
// share one DB, so only one may run an epoch cycle at a time (losers get null).
// Distinct key from the schema lock (0x574f4301), the skins burn-keeper lock
// (0x574f4302), and the buyback keeper lock (0x574f4303).
const LP_EPOCH_LOCK_KEY = 0x57_4f_43_04; // "WOC\x04"
export async function withLpEpochLock<T>(fn: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [
      LP_EPOCH_LOCK_KEY,
    ]);
    if (!res.rows[0]?.locked) return null;
    try {
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LP_EPOCH_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}
