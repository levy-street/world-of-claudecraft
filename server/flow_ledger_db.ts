// SQL for the $WOC GameFi flow ledger (see flow_ledger.ts for the model + the
// buy>sell invariant). All raw SQL for this feature lives here, per the
// server SQL-only-in-*_db.ts invariant; logic talks to the FlowLedgerDb
// interface so unit tests use an in-memory fake.
//
// FLOW_LEDGER_SCHEMA is applied by db.ts ensureSchema() under the shared
// pg_advisory_xact_lock, alongside the other module schemas.
import { pool } from './db';
import {
  emissionDecision,
  type EmitResult,
  type FlowEntryInput,
  type FlowLedgerDb,
  type InflowResult,
} from './flow_ledger';

// BIGINT columns hold base units as decimal strings (a season's cumulative
// volume can exceed Number.MAX_SAFE_INTEGER), parsed to bigint in JS.
export const FLOW_LEDGER_SCHEMA = `
CREATE TABLE IF NOT EXISTS woc_seasons (
  season_id  INT PRIMARY KEY,
  label      TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','finalized')),
  opened_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS woc_flow_ledger (
  entry_id    BIGSERIAL PRIMARY KEY,
  season_id   INT NOT NULL REFERENCES woc_seasons(season_id),
  source      TEXT NOT NULL,
  direction   TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount_base BIGINT NOT NULL CHECK (amount_base > 0),
  tx_sig      TEXT UNIQUE,
  recipient   TEXT,
  memo        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS woc_flow_ledger_season_dir ON woc_flow_ledger(season_id, direction);

CREATE TABLE IF NOT EXISTS woc_reward_pools (
  season_id   INT NOT NULL REFERENCES woc_seasons(season_id),
  kind        TEXT NOT NULL,
  funded_base BIGINT NOT NULL DEFAULT 0,
  paid_base   BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (season_id, kind)
);

CREATE TABLE IF NOT EXISTS woc_payouts (
  payout_id     BIGSERIAL PRIMARY KEY,
  season_id     INT NOT NULL REFERENCES woc_seasons(season_id),
  recipient     TEXT NOT NULL,
  amount_base   BIGINT NOT NULL CHECK (amount_base > 0),
  tx_sig        TEXT UNIQUE,
  flow_entry_id BIGINT REFERENCES woc_flow_ledger(entry_id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS woc_payouts_season ON woc_payouts(season_id);
`;

function bigintOf(v: unknown): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return BigInt(v);
  return 0n;
}

// Postgres-backed FlowLedgerDb. The budget gate (recordOutflowWithinBudget)
// runs in ONE transaction holding a per-season advisory lock, so concurrent
// payouts serialize and can never both spend the same headroom. We lock per
// season (hashtext of the season id) rather than FOR UPDATE on an aggregate,
// which some planners reject.
export class PgFlowLedgerDb implements FlowLedgerDb {
  async ensureSeason(seasonId: number, label = ''): Promise<void> {
    await pool.query(
      `INSERT INTO woc_seasons(season_id, label) VALUES ($1, $2)
       ON CONFLICT (season_id) DO NOTHING`,
      [seasonId, label],
    );
  }

  async seasonHeadroom(seasonId: number): Promise<bigint> {
    const r = await pool.query(
      `SELECT (COALESCE(SUM(amount_base) FILTER (WHERE direction='in'), 0)
             - COALESCE(SUM(amount_base) FILTER (WHERE direction='out'), 0))::text AS headroom
         FROM woc_flow_ledger WHERE season_id = $1`,
      [seasonId],
    );
    return bigintOf(r.rows[0]?.headroom ?? '0');
  }

  async seasonIsOpen(seasonId: number): Promise<boolean> {
    const r = await pool.query(`SELECT status FROM woc_seasons WHERE season_id = $1`, [seasonId]);
    return r.rows[0]?.status === 'active';
  }

  async recordInflow(input: FlowEntryInput): Promise<InflowResult> {
    // ON CONFLICT on the UNIQUE tx_sig makes a replayed inflow a no-op. A null
    // tx_sig (internal recirculation) is allowed and never conflicts.
    const r = await pool.query(
      `INSERT INTO woc_flow_ledger(season_id, source, direction, amount_base, tx_sig, recipient, memo)
       VALUES ($1, $2, 'in', $3, $4, $5, $6)
       ON CONFLICT (tx_sig) DO NOTHING
       RETURNING entry_id`,
      [input.seasonId, input.source, input.amountBase.toString(), input.txSig ?? null, input.recipient ?? null, input.memo ?? null],
    );
    if (r.rowCount === 0) return { ok: false, reason: 'duplicate' };
    return { ok: true, entryId: Number(r.rows[0].entry_id) };
  }

  async recordOutflowWithinBudget(input: FlowEntryInput): Promise<EmitResult> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize all budget decisions for this season; auto-released on COMMIT.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`woc_season:${input.seasonId}`]);

      if (input.txSig) {
        const dup = await client.query(`SELECT 1 FROM woc_payouts WHERE tx_sig = $1`, [input.txSig]);
        if ((dup.rowCount ?? 0) > 0) {
          await client.query('ROLLBACK');
          return { ok: false, reason: 'duplicate', headroomBase: 0n };
        }
      }

      const hr = await client.query(
        `SELECT (COALESCE(SUM(amount_base) FILTER (WHERE direction='in'), 0)
               - COALESCE(SUM(amount_base) FILTER (WHERE direction='out'), 0))::text AS headroom
           FROM woc_flow_ledger WHERE season_id = $1`,
        [input.seasonId],
      );
      const headroom = bigintOf(hr.rows[0]?.headroom ?? '0');

      const decision = emissionDecision(headroom, input.amountBase);
      if (!decision.allow) {
        await client.query('ROLLBACK');
        return { ok: false, reason: decision.reason, headroomBase: headroom };
      }

      const entry = await client.query(
        `INSERT INTO woc_flow_ledger(season_id, source, direction, amount_base, tx_sig, recipient, memo)
         VALUES ($1, $2, 'out', $3, $4, $5, $6) RETURNING entry_id`,
        [input.seasonId, input.source, input.amountBase.toString(), input.txSig ?? null, input.recipient ?? null, input.memo ?? null],
      );
      const entryId = Number(entry.rows[0].entry_id);

      const payout = await client.query(
        `INSERT INTO woc_payouts(season_id, recipient, amount_base, tx_sig, flow_entry_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING payout_id`,
        [input.seasonId, input.recipient ?? '', input.amountBase.toString(), input.txSig ?? null, entryId],
      );

      await client.query('COMMIT');
      return {
        ok: true,
        headroomBase: headroom - input.amountBase,
        entryId,
        payoutId: Number(payout.rows[0].payout_id),
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}
