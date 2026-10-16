import { pool } from './db';
import { getMembership } from './membership_service';
import { referralInviteOwner } from './referral_invites_db';

// One immutable row per referred account, retained for its lifetime. Legacy
// referrals stay ineligible: membership at their signup cannot be reconstructed.
export const REFERRAL_ARMOUR_SCHEMA = `
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS member_eligible BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS inviter_name VARCHAR(32) NOT NULL DEFAULT '';
`;

export interface ReferralArmourEntitlement {
  inviterAccountId: number;
  inviterName: string;
}

export interface ReferralSignup {
  referrerAccountId: number;
  slug: string;
  memberEligible: boolean;
  inviterName: string;
}

/** Resolve before account creation. Failed attribution reads must abort signup;
 * membership service availability only affects the existing armour entitlement. */
export async function resolveReferralSignup(ref: unknown): Promise<ReferralSignup | null> {
  const slug = typeof ref === 'string' ? ref.trim().toLowerCase() : '';
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) return null;
  const invite = await referralInviteOwner(slug);
  const inviter = invite
    ? { inviterAccountId: invite.accountId, inviterName: invite.name }
    : await referralInviterForSlug(slug);
  if (!inviter) return null;
  const membership = await getMembership(inviter.inviterAccountId);
  const now = Date.now();
  return {
    referrerAccountId: inviter.inviterAccountId,
    slug,
    memberEligible:
      membership.active && membership.authorizedUntil > now && (membership.expiresAt ?? 0) > now,
    inviterName: inviter.inviterName.slice(0, 32),
  };
}

export async function recordReferralOnClient(
  client: { query(text: string, values?: unknown[]): Promise<unknown> },
  refereeAccountId: number,
  referral: ReferralSignup,
): Promise<void> {
  if (referral.referrerAccountId === refereeAccountId) return;
  await client.query(
    `INSERT INTO referrals (referee_account_id, referrer_account_id, slug, member_eligible, inviter_name)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (referee_account_id) DO NOTHING`,
    [
      refereeAccountId,
      referral.referrerAccountId,
      referral.slug,
      referral.memberEligible,
      referral.inviterName.slice(0, 32),
    ],
  );
}

/** Resolve the card's current owner and character name without loading its PNG
 * or character state. Both joins use unique/primary keys; ownership is verified. */
export async function referralInviterForSlug(
  slug: string,
): Promise<ReferralArmourEntitlement | null> {
  const result = await pool.query(
    `SELECT p.account_id, c.name FROM player_cards p
     JOIN characters c ON c.id = p.character_id AND c.account_id = p.account_id
     WHERE p.slug = $1`,
    [slug],
  );
  const row = result.rows[0];
  return row
    ? { inviterAccountId: Number(row.account_id), inviterName: row.name.slice(0, 32) }
    : null;
}

/** First attribution wins, including eligibility and the name snapshot. No
 * transaction spans membership service I/O. Old callers default to ineligible. */
export async function recordReferral(
  refereeAccountId: number,
  referrerAccountId: number,
  slug: string,
  memberEligible = false,
  inviterName = '',
): Promise<void> {
  await pool.query(
    `INSERT INTO referrals (referee_account_id, referrer_account_id, slug, member_eligible, inviter_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (referee_account_id) DO NOTHING`,
    [refereeAccountId, referrerAccountId, slug, memberEligible, inviterName.slice(0, 32)],
  );
}

/** One PK read on fresh admission only. Never re-check the inviter's membership:
 * cancellation, card removal, and character renames do not revoke the grant. */
export async function referralArmourForAccount(
  accountId: number,
): Promise<ReferralArmourEntitlement | null> {
  const result = await pool.query(
    `SELECT referrer_account_id, inviter_name FROM referrals
     WHERE referee_account_id = $1 AND member_eligible = true`,
    [accountId],
  );
  const row = result.rows[0];
  return row
    ? { inviterAccountId: Number(row.referrer_account_id), inviterName: row.inviter_name }
    : null;
}
