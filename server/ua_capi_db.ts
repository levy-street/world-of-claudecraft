// SQL boundary for the UA conversion-event once-guards (the *_db.ts
// convention). Currently one claim: the D7Retained ad event.
//
// Takes the pool as a parameter (the unstuck_db shape): the column it claims
// lives on accounts (db.ts SCHEMA), and keeping this module './db'-free keeps
// the import graph acyclic for any future schema constant it may grow.

import type { Pool } from 'pg';

/**
 * Atomically claim the one D7Retained send for an account. True exactly once:
 * when the account is currently inside day seven after signup (age in
 * [7 days, 8 days)) and no prior claim landed. The window predicate and the
 * null-guard live in the same UPDATE, so concurrent sessions, realms, or a
 * crash-restart can never double-claim (in-statement guard, never
 * check-then-write).
 */
export async function claimDay7Retention(db: Pool, accountId: number): Promise<boolean> {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) return false;
  const res = await db.query(
    `UPDATE accounts
        SET d7_capi_sent_at = now()
      WHERE id = $1
        AND d7_capi_sent_at IS NULL
        AND created_at <= now() - INTERVAL '7 days'
        AND created_at > now() - INTERVAL '8 days'
      RETURNING id`,
    [accountId],
  );
  return (res.rowCount ?? 0) > 0;
}
