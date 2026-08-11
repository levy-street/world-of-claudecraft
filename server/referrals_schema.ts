// Refer-a-friend DDL (docs/prd/refer-a-friend.md), applied by ensureSchema in
// db.ts under the boot advisory lock. Kept db.ts-import-free (like
// admin_guilds_schema.ts) so db.ts can import it without a cycle; the query
// functions live in server/referrals_db.ts.
//
// referral_codes and referral_milestones are bounded by accounts (one code per
// account; a handful of milestone rows per referee), and the referrals table
// itself is bounded by accounts too (PK on referee_account_id): none of the
// three grows per event, so all three are deliberately keep-forever, no
// retention registration. The referral graph and its milestone history are the
// audit trail behind reward grants and voids, so age-based pruning would erase
// the record an abuse investigation needs.
export const REFERRALS_SCHEMA = `
CREATE TABLE IF NOT EXISTS referral_codes (
  owner_account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The program columns on the existing capture table (server/db.ts SCHEMA owns the
-- CREATE): status is the referral lifecycle (pending -> active -> completed, or
-- voided by anti-abuse/admin); code_used records the redeemed referral code when
-- the entry channel was a code rather than a card slug (slug keeps the raw
-- redeemed token either way, it is NOT NULL in the core DDL); device_fingerprint
-- and ip_hash are the redemption-time correlation hashes (hashed before storage,
-- never raw); redeemed_character_id is the referee character that finished the
-- redemption, stamped when known.
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS code_used TEXT;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS device_fingerprint TEXT;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS ip_hash TEXT;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS redeemed_character_id INT;
-- Serves the per-referrer cap count and the ladder roll-up (both filter on
-- referrer + status).
CREATE INDEX IF NOT EXISTS referrals_referrer_status ON referrals(referrer_account_id, status);
CREATE TABLE IF NOT EXISTS referral_milestones (
  referee_account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  milestone_key TEXT NOT NULL,
  reached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reward_granted BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (referee_account_id, milestone_key)
);
`;
