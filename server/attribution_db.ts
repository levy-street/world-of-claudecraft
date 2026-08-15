// SQL boundary for signup attribution (the *_db.ts convention). One row per
// account, written once at registration: the first-touch ad-click identifiers
// (fbclid, the Meta _fbp/_fbc cookies), UTM tags, the landing URL and
// referrer the visitor first arrived on, and the pre-signup site-presence
// visitor id. This is what lets the UA reports split paid from organic and
// tie a cohort back to a campaign and creative; without it every funnel
// number is a blended average.
//
// Privacy shape: the row carries no IP and no free-text beyond capped
// identifiers the visitor's own URL carried, and is written only when the
// signup request presented at least one attribution signal. Lifecycle: the
// FK CASCADE covers only a hard account DELETE (the federated-race provision
// cleanup); user-facing removal is a SOFT delete (deactivated_at), so the
// deactivation path explicitly deletes this row (deleteAccountAttribution,
// called from handleAccountDeactivate) and the subject-access export
// includes it (exportAccountData).
//
// No './db' import: db.ts applies ACCOUNT_ATTRIBUTION_SCHEMA at boot, so this
// module takes the pool as a parameter (the unstuck_db shape) to keep the
// import graph acyclic.

import type { Pool } from 'pg';

export const ACCOUNT_ATTRIBUTION_SCHEMA = `
CREATE TABLE IF NOT EXISTS account_attribution (
  account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  fbclid TEXT,
  fbp TEXT,
  fbc TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  landing_url TEXT,
  referrer TEXT,
  visitor_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_attribution_campaign
  ON account_attribution(utm_campaign) WHERE utm_campaign IS NOT NULL;
CREATE INDEX IF NOT EXISTS account_attribution_source
  ON account_attribution(utm_source) WHERE utm_source IS NOT NULL;
`;

/** The persisted attribution shape. Every field nullable: the row is written
 *  whenever at least one signal is present. */
export interface AccountAttributionRow {
  accountId: number;
  fbclid?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  landingUrl?: string | null;
  referrer?: string | null;
  visitorId?: string | null;
}

const nullable = (value: string | null | undefined): string | null =>
  value === undefined || value === null || value.length === 0 ? null : value;

/** Stamp the whole signup profile in ONE UPDATE (locale, country, opt-in).
 *  Registration is exactly when write bursts happen, so this replaces three
 *  single-column UPDATEs (three row versions, three pool checkouts) with one.
 *  Null fields leave the column untouched; the country keeps its write-once
 *  semantic via COALESCE; opt-in only ever flips TO true here (the explicit
 *  checkbox), never back. */
export async function updateAccountSignupProfile(
  db: Pool,
  accountId: number,
  profile: { locale: string | null; country: string | null; marketingOptIn: boolean },
): Promise<void> {
  await db.query(
    `UPDATE accounts SET
       locale = COALESCE($2, locale),
       created_country = COALESCE(created_country, $3),
       marketing_opt_in = (marketing_opt_in OR $4)
     WHERE id = $1`,
    [accountId, profile.locale, profile.country, profile.marketingOptIn],
  );
}

/** Remove the attribution row on account deactivation: user-facing removal is
 *  a soft delete that never fires the FK CASCADE, so the ad-click identifiers
 *  are erased explicitly when the player leaves. */
export async function deleteAccountAttribution(db: Pool, accountId: number): Promise<void> {
  await db.query('DELETE FROM account_attribution WHERE account_id = $1', [accountId]);
}

/** The subject-access read (exportAccountData): the stored first-touch row,
 *  or null when signup carried no signal. */
export async function accountAttributionForExport(
  db: Pool,
  accountId: number,
): Promise<Record<string, unknown> | null> {
  const res = await db.query(
    `SELECT fbclid, fbp, fbc, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
            landing_url, referrer, visitor_id, created_at
       FROM account_attribution WHERE account_id = $1`,
    [accountId],
  );
  return res.rows[0] ?? null;
}

/** Write the one first-touch attribution row. ON CONFLICT DO NOTHING keeps
 *  first-touch semantics under any replay: the first write wins forever. */
export async function insertAccountAttribution(
  db: Pool,
  row: AccountAttributionRow,
): Promise<void> {
  if (!Number.isSafeInteger(row.accountId) || row.accountId <= 0) {
    throw new TypeError('accountId must be a positive safe integer');
  }
  await db.query(
    `INSERT INTO account_attribution (
       account_id, fbclid, fbp, fbc,
       utm_source, utm_medium, utm_campaign, utm_content, utm_term,
       landing_url, referrer, visitor_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (account_id) DO NOTHING`,
    [
      row.accountId,
      nullable(row.fbclid),
      nullable(row.fbp),
      nullable(row.fbc),
      nullable(row.utmSource),
      nullable(row.utmMedium),
      nullable(row.utmCampaign),
      nullable(row.utmContent),
      nullable(row.utmTerm),
      nullable(row.landingUrl),
      nullable(row.referrer),
      nullable(row.visitorId),
    ],
  );
}
