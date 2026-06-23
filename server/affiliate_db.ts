// Realm affiliate program (#475): salespeople share an affiliate link
// (/?aff=<code>) to recruit realm founders, and earn a cut (default 15%) of the
// revenue their referred realms generate. This is the attribution layer; the
// actual USDC payout is drawn from the operator's share when the in-realm revenue
// rails land (#477) - getRealmAffiliate is the hook that split reads.
//
// Two tables: a stable per-account affiliate code (every account can self-serve a
// link), and the per-realm attribution (one affiliate per realm, first-touch at
// founding, cascading with the realm). SQL lives only here (server/CLAUDE.md).

import { randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { isUniqueViolation } from './http_util';
import { resolveRealmType, isRealmStatus, type RealmType, type RealmStatus } from './realm';

type Queryable = Pick<Pool, 'query'> | PoolClient;

export const AFFILIATE_SCHEMA = `
-- Each account's stable affiliate code. Generated lazily on first view, random +
-- URL-safe so it is not enumerable and is decoupled from the username / card slug.
CREATE TABLE IF NOT EXISTS affiliate_codes (
  account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-realm affiliate attribution: the salesperson whose link got this realm
-- founded earns bps of the realm's revenue (drawn from the operator's share; the
-- USDC split lands with #477). One affiliate per realm (PK on realm_id),
-- first-touch at founding, cascades away with the realm.
CREATE TABLE IF NOT EXISTS realm_affiliates (
  realm_id BIGINT PRIMARY KEY REFERENCES realms(realm_id) ON DELETE CASCADE,
  affiliate_account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  bps SMALLINT NOT NULL,
  attributed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS realm_affiliates_affiliate ON realm_affiliates(affiliate_account_id);
`;

// 6 random bytes -> 8 URL-safe chars (base64url: A-Za-z0-9-_). 48 bits of entropy,
// so collisions are astronomically rare; getOrCreateAffiliateCode retries anyway.
function generateAffiliateCode(): string {
  return randomBytes(6).toString('base64url');
}

// The account's stable affiliate code, creating one on first call. Race-safe: a
// concurrent create is absorbed by the account_id conflict, and the rare code
// collision (a different account drawing the same random code) retries.
export async function getOrCreateAffiliateCode(db: Queryable, accountId: number): Promise<string> {
  const existing = await db.query('SELECT code FROM affiliate_codes WHERE account_id = $1', [accountId]);
  if (existing.rows[0]) return String(existing.rows[0].code);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateAffiliateCode();
    try {
      const res = await db.query(
        `INSERT INTO affiliate_codes (account_id, code) VALUES ($1, $2)
         ON CONFLICT (account_id) DO NOTHING RETURNING code`,
        [accountId, code],
      );
      if (res.rows[0]) return String(res.rows[0].code);
      // account_id already had a code (a concurrent create won); read it back.
      const again = await db.query('SELECT code FROM affiliate_codes WHERE account_id = $1', [accountId]);
      if (again.rows[0]) return String(again.rows[0].code);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err; // a code collision: retry a fresh code
    }
  }
  throw new Error('could not allocate a unique affiliate code');
}

// Resolve an affiliate code to its account, or null when the code is unknown.
export async function accountForAffiliateCode(db: Queryable, code: string): Promise<number | null> {
  const res = await db.query('SELECT account_id FROM affiliate_codes WHERE code = $1', [code]);
  return res.rows[0] ? Number(res.rows[0].account_id) : null;
}

// Attribute a realm to an affiliate (first-touch: a realm keeps its first
// affiliate; a later attempt is a no-op).
export async function setRealmAffiliate(
  db: Queryable,
  a: { realmId: number; affiliateAccountId: number; bps: number },
): Promise<void> {
  await db.query(
    `INSERT INTO realm_affiliates (realm_id, affiliate_account_id, bps) VALUES ($1, $2, $3)
     ON CONFLICT (realm_id) DO NOTHING`,
    [a.realmId, a.affiliateAccountId, a.bps],
  );
}

// The affiliate owed a cut of a realm's revenue, or null. The #477 USDC split
// reads this to pay the affiliate `bps` of gross out of the operator's share.
export async function getRealmAffiliate(
  db: Queryable,
  realmId: number,
): Promise<{ affiliateAccountId: number; bps: number } | null> {
  const res = await db.query('SELECT affiliate_account_id, bps FROM realm_affiliates WHERE realm_id = $1', [realmId]);
  return res.rows[0]
    ? { affiliateAccountId: Number(res.rows[0].affiliate_account_id), bps: Number(res.rows[0].bps) }
    : null;
}

export interface AffiliateRealm {
  realmId: number;
  name: string;
  type: RealmType;
  status: RealmStatus;
  tier: number;
  bps: number;
  attributedAt: Date;
}

// An affiliate's referred realms (non-closed), newest first, for their dashboard.
export async function listRealmsByAffiliate(db: Queryable, affiliateAccountId: number): Promise<AffiliateRealm[]> {
  const res = await db.query(
    `SELECT r.realm_id, r.name, r.type, r.status, r.tier, ra.bps, ra.attributed_at
       FROM realm_affiliates ra JOIN realms r ON r.realm_id = ra.realm_id
      WHERE ra.affiliate_account_id = $1 AND r.status <> 'closed'
      ORDER BY ra.attributed_at DESC, r.realm_id DESC`,
    [affiliateAccountId],
  );
  return res.rows.map((r: Record<string, unknown>) => {
    const status = String(r.status);
    return {
      realmId: Number(r.realm_id),
      name: String(r.name),
      type: resolveRealmType(String(r.type)),
      status: isRealmStatus(status) ? status : 'active',
      tier: Number(r.tier),
      bps: Number(r.bps),
      attributedAt: r.attributed_at as Date,
    };
  });
}

// Count of an affiliate's live referred realms, for the affiliate summary.
export async function affiliateRealmCount(db: Queryable, affiliateAccountId: number): Promise<number> {
  const res = await db.query(
    `SELECT count(*)::int AS n FROM realm_affiliates ra JOIN realms r ON r.realm_id = ra.realm_id
      WHERE ra.affiliate_account_id = $1 AND r.status <> 'closed'`,
    [affiliateAccountId],
  );
  return Number(res.rows[0].n);
}
