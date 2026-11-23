// Account-lifetime entitlements and receipts intentionally survive character
// changes and process restarts. Cardinality is one card/completion per signup
// referral, one summary per inviter and at most five tier receipts per inviter.
export const REFERRAL_CARDS_SCHEMA = `
CREATE TABLE IF NOT EXISTS referral_cards (
  link_id INT PRIMARY KEY REFERENCES referrals(referee_account_id) ON DELETE CASCADE,
  inviter_account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  revision INT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  state JSONB NOT NULL CHECK (octet_length(state::text) <= 4096),
  inviter_summon_at TIMESTAMPTZ,
  invitee_summon_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS referral_cards_inviter ON referral_cards(inviter_account_id, link_id);
-- Transferable rewards must retain their source character until moved. This
-- guard is released at the permanent Fogbinder lock. Deferred NO ACTION also
-- allows account deletion to cascade both the card and all its characters.
CREATE TABLE IF NOT EXISTS referral_transfer_characters (
  link_id INT NOT NULL REFERENCES referral_cards(link_id) ON DELETE CASCADE,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  character_id INT NOT NULL REFERENCES characters(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  PRIMARY KEY(link_id,account_id)
);
CREATE INDEX IF NOT EXISTS referral_transfer_character ON referral_transfer_characters(character_id);
CREATE INDEX IF NOT EXISTS referral_transfer_account ON referral_transfer_characters(account_id);
CREATE TABLE IF NOT EXISTS referral_character_progress (
  character_id INT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  ready_count INT NOT NULL DEFAULT 0 CHECK (ready_count >= 0)
);
CREATE TABLE IF NOT EXISTS referral_progress (
  account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  completed_count INT NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  noticed_count INT NOT NULL DEFAULT 0 CHECK (noticed_count >= 0),
  latest_friend_name VARCHAR(32) NOT NULL DEFAULT '',
  rewarded_mask INT NOT NULL DEFAULT 0 CHECK (rewarded_mask BETWEEN 0 AND 31)
);
CREATE TABLE IF NOT EXISTS referral_completions (
  link_id INT PRIMARY KEY REFERENCES referrals(referee_account_id) ON DELETE CASCADE,
  inviter_account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS referral_completions_inviter ON referral_completions(inviter_account_id);
CREATE TABLE IF NOT EXISTS referral_reward_outbox (
  receipt TEXT PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tier SMALLINT NOT NULL CHECK (tier BETWEEN 1 AND 5),
  attempts INT NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS referral_reward_pending ON referral_reward_outbox(available_at, receipt)
  WHERE delivered_at IS NULL;
CREATE INDEX IF NOT EXISTS referral_reward_account ON referral_reward_outbox(account_id);
CREATE TABLE IF NOT EXISTS referral_membership_bonds (
  link_id INT PRIMARY KEY REFERENCES referrals(referee_account_id) ON DELETE CASCADE,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  paid_receipt TEXT NOT NULL,
  recipient_character_id INT,
  recipient_name VARCHAR(32),
  recipient_realm TEXT,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS referral_membership_bonds_pending ON referral_membership_bonds(available_at,link_id)
  WHERE delivered_at IS NULL;
CREATE INDEX IF NOT EXISTS referral_membership_bonds_account ON referral_membership_bonds(account_id);
CREATE INDEX IF NOT EXISTS referral_membership_bonds_realm_pending
  ON referral_membership_bonds(recipient_realm,available_at,link_id) WHERE delivered_at IS NULL;
CREATE INDEX IF NOT EXISTS referral_membership_bonds_unbound_account
  ON referral_membership_bonds(account_id,available_at,link_id)
  WHERE delivered_at IS NULL AND recipient_realm IS NULL;
CREATE TABLE IF NOT EXISTS referral_bond_delivery_characters (
  link_id INT PRIMARY KEY REFERENCES referral_membership_bonds(link_id) ON DELETE CASCADE,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  character_id INT NOT NULL REFERENCES characters(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IF NOT EXISTS referral_bond_delivery_character ON referral_bond_delivery_characters(character_id);
CREATE INDEX IF NOT EXISTS referral_bond_delivery_account ON referral_bond_delivery_characters(account_id);
-- One checkpoint per deployed realm, retained so restarts do not rescan payments.
CREATE TABLE IF NOT EXISTS referral_membership_feed_cursor (
  realm TEXT PRIMARY KEY,
  cursor BIGINT NOT NULL DEFAULT 0 CHECK(cursor>=0)
);
`;
