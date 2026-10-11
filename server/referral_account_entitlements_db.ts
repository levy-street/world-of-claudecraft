import { pool } from './db';

export const REFERRAL_CHARACTER_BONUS = 5;
export const REFERRAL_BANK_BONUS = 20;

/** The tier-two reward is permanent once its outbox transaction books bit 2.
 * A pending completion count is not a delivered reward. This is one PK probe,
 * and callers creating a character use their already locked transaction client. */
export async function referralCapacityEarned(
  accountId: number,
  client: Pick<typeof pool, 'query'> = pool,
): Promise<boolean> {
  const result = await client.query(
    'SELECT (rewarded_mask & 2) <> 0 AS earned FROM referral_progress WHERE account_id = $1',
    [accountId],
  );
  return result.rows[0]?.earned === true;
}
