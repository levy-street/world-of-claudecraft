// Persistence seam for the daily-engagement loop. Following the SocialService /
// SocialDb split (server/CLAUDE.md): the service logic in engagement_service.ts
// talks only to this EngagementDb interface, so it is exercised in tests against
// a real in-memory implementation rather than a mock of the logic under test.
// The Postgres-backed implementation lives in db.ts (alongside the rest of the
// SQL); ENGAGEMENT_SCHEMA below is the canonical DDL it runs at boot, realm-aware
// and replay-guarded the same way the existing woc_payments / play_sessions
// tables are.
//
// Money amounts are lamports (bigint here; BIGINT in SQL). Pack contents persist
// as JSONB.
import type { Pool } from 'pg';

export type SpinStatus = 'pending' | 'settled' | 'failed';

export interface DailyCommitRow {
  utcDay: number;
  /** Public commitment sha256(seed) published before any spins. */
  commitHash: string;
  /** The secret seed (hex); revealed only after the day closes. */
  seedHex: string;
  revealed: boolean;
}

export interface SpinRow {
  id: number;
  accountId: number;
  utcDay: number;
  dayNonce: number;
  clientSeed: string;
  prizeKey: string;
  lamports: bigint;
  status: SpinStatus;
  settleSig: string | null;
}

export interface StreakRow {
  lastDay: number | null;
  streak: number;
}

export interface PackOpeningInput {
  accountId: number;
  packId: string;
  txSig: string;
  contents: unknown;
}

export interface EngagementDb {
  // ----- daily provably-fair commit -----
  getDailyCommit(utcDay: number): Promise<DailyCommitRow | null>;
  putDailyCommit(row: DailyCommitRow): Promise<void>;
  revealDailySeed(utcDay: number): Promise<void>;

  // ----- spins (one per account per UTC day) -----
  getSpinForDay(accountId: number, utcDay: number): Promise<SpinRow | null>;
  insertSpin(row: Omit<SpinRow, 'id' | 'status' | 'settleSig'>): Promise<SpinRow>;
  getSpin(id: number): Promise<SpinRow | null>;
  markSpinSettled(id: number, settleSig: string): Promise<void>;
  markSpinFailed(id: number): Promise<void>;

  // ----- daily streak -----
  getStreak(accountId: number): Promise<StreakRow>;
  setStreak(accountId: number, row: StreakRow): Promise<void>;

  // ----- packs -----
  /** Whether a burn signature was already consumed (woc_payments replay guard). */
  hasPaymentSig(txSig: string): Promise<boolean>;
  getPity(accountId: number, packId: string): Promise<number>;
  setPity(accountId: number, packId: string, opens: number): Promise<void>;
  recordPackOpening(input: PackOpeningInput): Promise<number>;
}

/**
 * Canonical DDL for the engagement tables. Run by db.ts at boot inside the same
 * advisory-lock'd schema setup as the rest of the schema. `${realmDefault}` is
 * the realm SQL default the caller injects (matching player_cards etc.); spins,
 * streaks, pity, and openings are realm-scoped, the daily commit is global per
 * UTC day, and uniqueness mirrors the one-spin-per-day and burn-replay invariants
 * enforced in code.
 */
export function engagementSchema(realmDefault: string): string {
  return `
CREATE TABLE IF NOT EXISTS spin_daily_commits (
  utc_day BIGINT PRIMARY KEY,
  commit_hash TEXT NOT NULL,
  seed_hex TEXT NOT NULL,
  revealed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS spins (
  id BIGSERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  realm TEXT NOT NULL DEFAULT '${realmDefault}',
  utc_day BIGINT NOT NULL,
  day_nonce INT NOT NULL DEFAULT 1,
  client_seed TEXT NOT NULL DEFAULT '',
  prize_key TEXT NOT NULL,
  lamports BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  settle_sig TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS spins_account_day ON spins(account_id, realm, utc_day);
CREATE INDEX IF NOT EXISTS spins_status ON spins(status) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS daily_activity (
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  realm TEXT NOT NULL DEFAULT '${realmDefault}',
  last_day BIGINT,
  streak INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, realm)
);
CREATE TABLE IF NOT EXISTS pack_pity (
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  realm TEXT NOT NULL DEFAULT '${realmDefault}',
  pack_id TEXT NOT NULL,
  opens_since_pity INT NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, realm, pack_id)
);
CREATE TABLE IF NOT EXISTS pack_openings (
  id BIGSERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  realm TEXT NOT NULL DEFAULT '${realmDefault}',
  pack_id TEXT NOT NULL,
  tx_sig TEXT NOT NULL UNIQUE,
  contents JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pack_openings_account ON pack_openings(account_id, created_at DESC);
`;
}

interface SpinRowSql {
  id: string;
  account_id: number;
  utc_day: string;
  day_nonce: number;
  client_seed: string;
  prize_key: string;
  lamports: string;
  status: SpinStatus;
  settle_sig: string | null;
}

function mapSpin(r: SpinRowSql): SpinRow {
  return {
    id: Number(r.id),
    accountId: r.account_id,
    utcDay: Number(r.utc_day),
    dayNonce: r.day_nonce,
    clientSeed: r.client_seed,
    prizeKey: r.prize_key,
    lamports: BigInt(r.lamports),
    status: r.status,
    settleSig: r.settle_sig,
  };
}

/**
 * Postgres-backed EngagementDb. SQL lives here (a *_db.ts module, per
 * server/CLAUDE.md). The process REALM is threaded in at construction and scopes
 * every realm-bound query, so the EngagementDb interface stays realm-free (one
 * process serves one realm). Pool is injected so db.ts owns the single shared
 * pool. BIGINT columns come back as strings from node-pg and are parsed at the
 * boundary; lamports bind as decimal strings so no precision is lost.
 */
export class PgEngagementDb implements EngagementDb {
  constructor(
    private readonly pool: Pool,
    private readonly realm: string,
  ) {}

  async getDailyCommit(utcDay: number): Promise<DailyCommitRow | null> {
    const { rows } = await this.pool.query(
      'SELECT utc_day, commit_hash, seed_hex, revealed FROM spin_daily_commits WHERE utc_day = $1',
      [utcDay],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return { utcDay: Number(r.utc_day), commitHash: r.commit_hash, seedHex: r.seed_hex, revealed: r.revealed };
  }

  async putDailyCommit(row: DailyCommitRow): Promise<void> {
    // The commitment is fixed once per day: if a row already exists, keep it
    // (two concurrent boots must not publish different commits for the same day).
    await this.pool.query(
      `INSERT INTO spin_daily_commits (utc_day, commit_hash, seed_hex, revealed)
       VALUES ($1, $2, $3, $4) ON CONFLICT (utc_day) DO NOTHING`,
      [row.utcDay, row.commitHash, row.seedHex, row.revealed],
    );
  }

  async revealDailySeed(utcDay: number): Promise<void> {
    await this.pool.query('UPDATE spin_daily_commits SET revealed = true WHERE utc_day = $1', [utcDay]);
  }

  async getSpinForDay(accountId: number, utcDay: number): Promise<SpinRow | null> {
    const { rows } = await this.pool.query(
      `SELECT id, account_id, utc_day, day_nonce, client_seed, prize_key, lamports, status, settle_sig
       FROM spins WHERE account_id = $1 AND realm = $2 AND utc_day = $3`,
      [accountId, this.realm, utcDay],
    );
    return rows.length ? mapSpin(rows[0]) : null;
  }

  async insertSpin(row: Omit<SpinRow, 'id' | 'status' | 'settleSig'>): Promise<SpinRow> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO spins (account_id, realm, utc_day, day_nonce, client_seed, prize_key, lamports)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, account_id, utc_day, day_nonce, client_seed, prize_key, lamports, status, settle_sig`,
        [row.accountId, this.realm, row.utcDay, row.dayNonce, row.clientSeed, row.prizeKey, row.lamports.toString()],
      );
      return mapSpin(rows[0]);
    } catch (e) {
      // The (account_id, realm, utc_day) unique index is the authoritative
      // one-spin-per-day guard under a concurrent claim race; surface it as the
      // same domain signal the in-memory db uses (mirrors the 23505 handling the
      // rest of the server does for unique names).
      if (isUniqueViolation(e)) throw new Error('unique_violation: spins_account_day');
      throw e;
    }
  }

  async getSpin(id: number): Promise<SpinRow | null> {
    const { rows } = await this.pool.query(
      `SELECT id, account_id, utc_day, day_nonce, client_seed, prize_key, lamports, status, settle_sig
       FROM spins WHERE id = $1 AND realm = $2`,
      [id, this.realm],
    );
    return rows.length ? mapSpin(rows[0]) : null;
  }

  async markSpinSettled(id: number, settleSig: string): Promise<void> {
    await this.pool.query(
      `UPDATE spins SET status = 'settled', settle_sig = $2 WHERE id = $1 AND realm = $3`,
      [id, settleSig, this.realm],
    );
  }

  async markSpinFailed(id: number): Promise<void> {
    await this.pool.query(`UPDATE spins SET status = 'failed' WHERE id = $1 AND realm = $2`, [id, this.realm]);
  }

  async getStreak(accountId: number): Promise<StreakRow> {
    const { rows } = await this.pool.query(
      'SELECT last_day, streak FROM daily_activity WHERE account_id = $1 AND realm = $2',
      [accountId, this.realm],
    );
    if (rows.length === 0) return { lastDay: null, streak: 0 };
    return { lastDay: rows[0].last_day === null ? null : Number(rows[0].last_day), streak: rows[0].streak };
  }

  async setStreak(accountId: number, row: StreakRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO daily_activity (account_id, realm, last_day, streak)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, realm) DO UPDATE SET last_day = EXCLUDED.last_day, streak = EXCLUDED.streak, updated_at = now()`,
      [accountId, this.realm, row.lastDay, row.streak],
    );
  }

  async hasPaymentSig(txSig: string): Promise<boolean> {
    const { rows } = await this.pool.query('SELECT 1 FROM pack_openings WHERE tx_sig = $1 LIMIT 1', [txSig]);
    return rows.length > 0;
  }

  async getPity(accountId: number, packId: string): Promise<number> {
    const { rows } = await this.pool.query(
      'SELECT opens_since_pity FROM pack_pity WHERE account_id = $1 AND realm = $2 AND pack_id = $3',
      [accountId, this.realm, packId],
    );
    return rows.length ? rows[0].opens_since_pity : 0;
  }

  async setPity(accountId: number, packId: string, opens: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO pack_pity (account_id, realm, pack_id, opens_since_pity)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, realm, pack_id) DO UPDATE SET opens_since_pity = EXCLUDED.opens_since_pity`,
      [accountId, this.realm, packId, opens],
    );
  }

  async recordPackOpening(input: PackOpeningInput): Promise<number> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO pack_openings (account_id, realm, pack_id, tx_sig, contents)
         VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`,
        [input.accountId, this.realm, input.packId, input.txSig, JSON.stringify(input.contents)],
      );
      return Number(rows[0].id);
    } catch (e) {
      if (isUniqueViolation(e)) throw new Error('unique_violation: pack_openings.tx_sig');
      throw e;
    }
  }
}

/** True for a Postgres unique-constraint violation (SQLSTATE 23505). */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}
