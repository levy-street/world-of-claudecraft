// SQL boundary for the RiverBoat responsible-gambling primitives (the SocialDb
// pattern: all raw SQL lives here, the rg.ts service talks to the RgDb interface
// so it unit-tests against an in-memory fake). Four account-level surfaces, all
// keyed on accounts(id) which is GLOBAL across realms (so a player who
// self-excludes or age-attests once is covered on every process):
//
//   - riverboat_age_attestations: the 18+ DOB self-attestation (or a KYC
//     vendor's verdict later, behind the same row).
//   - riverboat_tos_acceptances: realm-scoped ToS acceptance (the P2W terms must
//     be accepted before entry; re-prompted on a version bump).
//   - riverboat_exclusions: self-exclusion (cool-off or permanent); permanent is
//     irreversible by the player and by support without a written process.
//   - riverboat_flow_counters: append-only per-(account, day) inflow notional for
//     the rolling deposit/loss limits.
//
// FK-references accounts(id) with ON DELETE CASCADE, so the schema runs after the
// core SCHEMA in ensureSchema. Applied unconditionally (idempotent), like the
// Discord/GitHub schema modules, so the tables exist before the feature enables.
import type { Pool } from 'pg';

export const RG_SCHEMA = `
CREATE TABLE IF NOT EXISTS riverboat_age_attestations (
  account_id   INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  dob          DATE NOT NULL,
  attested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  method       TEXT NOT NULL DEFAULT 'self'
);

CREATE TABLE IF NOT EXISTS riverboat_tos_acceptances (
  account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  realm        TEXT NOT NULL,
  tos_version  TEXT NOT NULL,
  accepted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, realm)
);

CREATE TABLE IF NOT EXISTS riverboat_exclusions (
  account_id   INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  set_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS riverboat_flow_counters (
  account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  day          DATE NOT NULL,
  notional     BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, day)
);

CREATE TABLE IF NOT EXISTS riverboat_limits (
  account_id       INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  daily_cap        BIGINT,
  weekly_cap       BIGINT,
  monthly_cap      BIGINT,
  pending_raise    JSONB,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export type ExclusionKind = 'cooloff_24h' | 'cooloff_30d' | 'permanent';

export interface AgeAttestation {
  dob: string; // ISO date
  attestedAt: string;
  method: string;
}

export interface Exclusion {
  kind: ExclusionKind;
  setAt: string;
  expiresAt: string | null;
}

export type LimitWindow = 'daily' | 'weekly' | 'monthly';

export interface AccountLimits {
  dailyCap: number | null;
  weeklyCap: number | null;
  monthlyCap: number | null;
  // Raises the player requested that have not yet taken effect, one held slot PER
  // window (each until its own effectiveAt), so staging a raise on one window
  // never discards a held raise on another.
  pendingRaises: Partial<Record<LimitWindow, { cap: number; effectiveAt: number }>>;
}

// The read/write surface the rg.ts service depends on. An in-memory fake
// (tests/server/helpers) implements it; the real implementation is makeRgDb.
export interface RgDb {
  getAgeAttestation(accountId: number): Promise<AgeAttestation | null>;
  setAgeAttestation(accountId: number, dob: string, method: string): Promise<void>;
  getTosVersion(accountId: number, realm: string): Promise<string | null>;
  setTosAcceptance(accountId: number, realm: string, tosVersion: string): Promise<void>;
  getExclusion(accountId: number): Promise<Exclusion | null>;
  // Set or replace the exclusion. A permanent exclusion never overwrites to a
  // weaker kind (the service enforces the irreversibility rule before calling).
  setExclusion(accountId: number, kind: ExclusionKind, expiresAt: number | null): Promise<void>;
  clearExclusion(accountId: number): Promise<void>;
  getLimits(accountId: number): Promise<AccountLimits | null>;
  setLimits(accountId: number, limits: AccountLimits): Promise<void>;
  // The summed inflow notional over the [sinceDay, today] inclusive window.
  flowSince(accountId: number, sinceDay: string): Promise<number>;
  addFlow(accountId: number, day: string, notional: number): Promise<void>;
}

// The production RgDb over a pg Pool. All SQL is confined here.
export function makeRgDb(pool: Pool): RgDb {
  return {
    async getAgeAttestation(accountId) {
      const r = await pool.query(
        "SELECT to_char(dob, 'YYYY-MM-DD') AS dob, attested_at, method FROM riverboat_age_attestations WHERE account_id = $1",
        [accountId],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        dob: row.dob,
        attestedAt: new Date(row.attested_at).toISOString(),
        method: row.method,
      };
    },
    async setAgeAttestation(accountId, dob, method) {
      await pool.query(
        `INSERT INTO riverboat_age_attestations (account_id, dob, method)
         VALUES ($1, $2, $3)
         ON CONFLICT (account_id) DO UPDATE SET dob = EXCLUDED.dob, method = EXCLUDED.method, attested_at = now()`,
        [accountId, dob, method],
      );
    },
    async getTosVersion(accountId, realm) {
      const r = await pool.query(
        'SELECT tos_version FROM riverboat_tos_acceptances WHERE account_id = $1 AND realm = $2',
        [accountId, realm],
      );
      return r.rows[0]?.tos_version ?? null;
    },
    async setTosAcceptance(accountId, realm, tosVersion) {
      await pool.query(
        `INSERT INTO riverboat_tos_acceptances (account_id, realm, tos_version)
         VALUES ($1, $2, $3)
         ON CONFLICT (account_id, realm) DO UPDATE SET tos_version = EXCLUDED.tos_version, accepted_at = now()`,
        [accountId, realm, tosVersion],
      );
    },
    async getExclusion(accountId) {
      const r = await pool.query(
        'SELECT kind, set_at, expires_at FROM riverboat_exclusions WHERE account_id = $1',
        [accountId],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        kind: row.kind as ExclusionKind,
        setAt: new Date(row.set_at).toISOString(),
        expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
      };
    },
    async setExclusion(accountId, kind, expiresAt) {
      await pool.query(
        `INSERT INTO riverboat_exclusions (account_id, kind, expires_at, set_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (account_id) DO UPDATE SET kind = EXCLUDED.kind, expires_at = EXCLUDED.expires_at, set_at = now()`,
        [accountId, kind, expiresAt !== null ? new Date(expiresAt).toISOString() : null],
      );
    },
    async clearExclusion(accountId) {
      await pool.query('DELETE FROM riverboat_exclusions WHERE account_id = $1', [accountId]);
    },
    async getLimits(accountId) {
      const r = await pool.query(
        'SELECT daily_cap, weekly_cap, monthly_cap, pending_raise FROM riverboat_limits WHERE account_id = $1',
        [accountId],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        dailyCap: row.daily_cap === null ? null : Number(row.daily_cap),
        weeklyCap: row.weekly_cap === null ? null : Number(row.weekly_cap),
        monthlyCap: row.monthly_cap === null ? null : Number(row.monthly_cap),
        pendingRaises: row.pending_raise ?? {},
      };
    },
    async setLimits(accountId, limits) {
      await pool.query(
        `INSERT INTO riverboat_limits (account_id, daily_cap, weekly_cap, monthly_cap, pending_raise, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (account_id) DO UPDATE SET
           daily_cap = EXCLUDED.daily_cap, weekly_cap = EXCLUDED.weekly_cap,
           monthly_cap = EXCLUDED.monthly_cap, pending_raise = EXCLUDED.pending_raise, updated_at = now()`,
        [
          accountId,
          limits.dailyCap,
          limits.weeklyCap,
          limits.monthlyCap,
          Object.keys(limits.pendingRaises).length ? JSON.stringify(limits.pendingRaises) : null,
        ],
      );
    },
    async flowSince(accountId, sinceDay) {
      const r = await pool.query(
        'SELECT COALESCE(SUM(notional), 0) AS total FROM riverboat_flow_counters WHERE account_id = $1 AND day >= $2::date',
        [accountId, sinceDay],
      );
      return Number(r.rows[0]?.total ?? 0);
    },
    async addFlow(accountId, day, notional) {
      await pool.query(
        `INSERT INTO riverboat_flow_counters (account_id, day, notional)
         VALUES ($1, $2, $3)
         ON CONFLICT (account_id, day) DO UPDATE SET notional = riverboat_flow_counters.notional + EXCLUDED.notional`,
        [accountId, day, notional],
      );
    },
  };
}
