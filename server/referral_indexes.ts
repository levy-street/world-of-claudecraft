// Account-bound friend pages walk referee IDs for one inviter. Build concurrently
// because the existing referrals table is populated before this feature ships.
export const REFERRAL_FRIEND_PAGE_INDEX_SQL = `
CREATE INDEX CONCURRENTLY IF NOT EXISTS referrals_referrer_referee
  ON referrals(referrer_account_id, referee_account_id);
`;

export const REFERRAL_FRIEND_PAGE_INVALID_CHECK_SQL = `
SELECT 1 FROM pg_index
 WHERE indexrelid = to_regclass('referrals_referrer_referee') AND NOT indisvalid
`;

export const REFERRAL_FRIEND_PAGE_INVALID_DROP_SQL =
  'DROP INDEX CONCURRENTLY IF EXISTS referrals_referrer_referee';

export const REFERRAL_FRIEND_PAGE_READY_SQL = `
SELECT 1 FROM pg_index
 WHERE indexrelid = to_regclass('referrals_referrer_referee') AND indisvalid AND indisready
`;

/** The global concurrent-index runner starts after listen. Until this particular
 * index is ready, decline friend-page reads instead of scanning referral history. */
export function createReferralFriendPageReadiness(
  query: (sql: string) => Promise<{ rows: unknown[] }>,
  now = Date.now,
): () => Promise<void> {
  let ready = false;
  let retryAt = 0;
  let pending: Promise<void> | null = null;
  return async () => {
    if (ready) return;
    if (pending) return pending;
    if (now() < retryAt) throw new Error('Account friend index is not ready');
    pending = (async () => {
      const result = await query(REFERRAL_FRIEND_PAGE_READY_SQL);
      ready = result.rows.length > 0;
      if (!ready) throw new Error('Account friend index is not ready');
    })().finally(() => {
      retryAt = now() + 5000;
      pending = null;
    });
    return pending;
  };
}
