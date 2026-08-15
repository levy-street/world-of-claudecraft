// SQL boundary for the ad_spend ledger (the *_db.ts convention). One row per
// (day, campaign): spend in integer cents plus delivery counts, hand-entered
// through the admin API (or later by a Meta Marketing API import job writing
// through the same upsert). This is what turns the UA cohort reports from
// rates into money: real CPI, cost per level 5, cost per retained player,
// and the spend trend beside the signup trend. Without it the database can
// not answer whether a signup collapse was spend-side or auction-side.
//
// Bounded by nature (one row per campaign per day), so no retention
// registration: the table IS the longitudinal record. Keep forever.
//
// Takes the pool as a parameter (the unstuck_db shape): db.ts applies
// AD_SPEND_SCHEMA at boot, so this module stays './db'-free.

import type { Pool } from 'pg';

export const AD_SPEND_SCHEMA = `
CREATE TABLE IF NOT EXISTS ad_spend (
  day DATE NOT NULL,
  campaign TEXT NOT NULL,
  spend_cents BIGINT NOT NULL,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, campaign),
  CONSTRAINT ad_spend_nonnegative CHECK (
    spend_cents >= 0 AND impressions >= 0 AND clicks >= 0
  )
);
`;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
export const AD_SPEND_MAX_CAMPAIGN_LENGTH = 200;
export const AD_SPEND_MAX_LIST_DAYS = 400;

export interface AdSpendRow {
  day: string;
  campaign: string;
  spendCents: number;
  impressions: number;
  clicks: number;
  currency: string;
  updatedAt: string;
}

export interface UpsertAdSpendInput {
  day: string;
  campaign: string;
  spendCents: number;
  impressions?: number;
  clicks?: number;
  currency?: string;
}

function validDay(value: unknown): string {
  if (typeof value !== 'string' || !DAY_RE.test(value)) {
    throw new TypeError('day must be YYYY-MM-DD');
  }
  return value;
}

function validCampaign(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > AD_SPEND_MAX_CAMPAIGN_LENGTH
  ) {
    throw new TypeError('campaign must be a non-empty string');
  }
  return value.trim();
}

function nonNegativeInt(value: unknown, field: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative integer`);
  }
  return value;
}

function validCurrency(value: unknown): string {
  if (value === undefined) return 'USD';
  if (typeof value !== 'string' || !CURRENCY_RE.test(value)) {
    throw new TypeError('currency must be a 3-letter ISO code');
  }
  return value;
}

type RawRow = {
  day: Date | string;
  campaign: string;
  spend_cents: number | string;
  impressions: number | string;
  clicks: number | string;
  currency: string;
  updated_at: Date | string;
};

const dayString = (value: Date | string): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

function rowFromRaw(row: RawRow): AdSpendRow {
  return {
    day: dayString(row.day),
    campaign: row.campaign,
    spendCents: Number(row.spend_cents),
    impressions: Number(row.impressions),
    clicks: Number(row.clicks),
    currency: row.currency,
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

/** Idempotent upsert: re-entering a (day, campaign) row replaces it, so a
 *  correction is just typing the row again. */
export async function upsertAdSpend(db: Pool, input: UpsertAdSpendInput): Promise<AdSpendRow> {
  const res = await db.query<RawRow>(
    `INSERT INTO ad_spend (day, campaign, spend_cents, impressions, clicks, currency, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (day, campaign) DO UPDATE SET
       spend_cents = EXCLUDED.spend_cents,
       impressions = EXCLUDED.impressions,
       clicks = EXCLUDED.clicks,
       currency = EXCLUDED.currency,
       updated_at = now()
     RETURNING day, campaign, spend_cents, impressions, clicks, currency, updated_at`,
    [
      validDay(input.day),
      validCampaign(input.campaign),
      nonNegativeInt(input.spendCents, 'spendCents'),
      nonNegativeInt(input.impressions, 'impressions', 0),
      nonNegativeInt(input.clicks, 'clicks', 0),
      validCurrency(input.currency),
    ],
  );
  return rowFromRaw(res.rows[0]);
}

/** Row ceiling on the list read: generous for hand-entered data, and a real
 *  bound once a Marketing API importer raises campaign cardinality. */
export const AD_SPEND_MAX_LIST_ROWS = 5000;

/** Newest-first rows for the trailing window (bounded by the max window and
 *  the row ceiling). The (day, campaign) PK serves the day range. */
export async function listAdSpend(db: Pool, days: number): Promise<AdSpendRow[]> {
  const window = Math.min(
    AD_SPEND_MAX_LIST_DAYS,
    Math.max(1, Number.isFinite(days) ? Math.floor(days) : 90),
  );
  const res = await db.query<RawRow>(
    `SELECT day, campaign, spend_cents, impressions, clicks, currency, updated_at
       FROM ad_spend
      WHERE day >= (now() - ($1::int * INTERVAL '1 day'))::date
      ORDER BY day DESC, campaign ASC
      LIMIT $2`,
    [window, AD_SPEND_MAX_LIST_ROWS],
  );
  return res.rows.map(rowFromRaw);
}

/** Remove one (day, campaign) row; true when a row was deleted. */
export async function deleteAdSpend(db: Pool, day: string, campaign: string): Promise<boolean> {
  const res = await db.query('DELETE FROM ad_spend WHERE day = $1 AND campaign = $2', [
    validDay(day),
    validCampaign(campaign),
  ]);
  return (res.rowCount ?? 0) > 0;
}
