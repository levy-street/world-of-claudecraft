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
