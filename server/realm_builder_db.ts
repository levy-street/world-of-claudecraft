// SQL boundary for the Realm Builder of the Month roll (the *_db.ts
// convention). One row per honoured month, per realm: the monument in Eastbrook
// Vale projects the newest one and its inspect card lists the rest.
//
// This is the live source that src/sim/content/realm_builders.ts was written to
// wait for. That module still owns the shipped placeholder, which is what an
// offline browser world and a realm with an empty table both fall back to.
//
// Bounded by nature (one row a month, forever), so no retention registration:
// the table IS the honour roll, and deleting an old row erases a real award.
//
// Takes the pool as a parameter (the ad_spend_db shape): db.ts applies
// REALM_BUILDER_SCHEMA at boot, so this module stays './db'-free.

import type { Pool } from 'pg';

export const REALM_BUILDER_SCHEMA = `
CREATE TABLE IF NOT EXISTS realm_builder_honours (
  realm TEXT NOT NULL,
  year INT NOT NULL,
  month INT NOT NULL,
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INT REFERENCES accounts(id) ON DELETE SET NULL,
  PRIMARY KEY (realm, year, month),
  CONSTRAINT realm_builder_month_range CHECK (month BETWEEN 1 AND 12),
  CONSTRAINT realm_builder_year_range CHECK (year BETWEEN 2000 AND 4000)
);
`;

export const REALM_BUILDER_MAX_NAME_LENGTH = 64;
export const REALM_BUILDER_MAX_NOTE_LENGTH = 280;
export const REALM_BUILDER_MIN_YEAR = 2000;
export const REALM_BUILDER_MAX_YEAR = 4000;

export interface RealmBuilderRow {
  year: number;
  month: number;
  name: string;
  note: string;
  updatedAt: string;
}

export interface UpsertRealmBuilderInput {
  year: number;
  month: number;
  name: string;
  note?: string;
  updatedBy?: number | null;
}

function validYear(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < REALM_BUILDER_MIN_YEAR ||
    value > REALM_BUILDER_MAX_YEAR
  ) {
    throw new TypeError('year must be a whole calendar year');
  }
  return value;
}

function validMonth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 12) {
    throw new TypeError('month must be 1-12');
  }
  return value;
}

/**
 * Characters no name is made of: C0/C1 controls (a newline would break the
 * plate's one-line bake), the Unicode bidi marks (LRM/RLM and the
 * embedding/override/isolate set), which exist to make text render in an
 * order other than the one it is stored in, and the invisible fillers that
 * can mint a name rendering empty or as a look-alike of an existing honouree:
 * ZWSP (U+200B), the word joiner (U+2060) and the BOM (U+FEFF).
 *
 * NOT the zero-width NON-joiner (U+200C) or joiner (U+200D): those are
 * ordinary orthography. Persian and Urdu write ZWNJ inside words (a Persian
 * honouree's own name can carry one), and Sinhala, Malayalam, Tamil and
 * Kannada use ZWJ for conjunct forms. Rejected, not stripped: an operator
 * should see the refusal. Accents, ligatures and every script are fine: this
 * is a name.
 */
const NAME_FORBIDDEN =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching controls is the point
  /[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/;

/**
 * An honouree's name.
 *
 * Trimmed, length-capped and checked for the characters above, and NOTHING
 * else: this is a community member's own name and it splices verbatim
 * wherever it is shown, exactly like a player name. Every surface that renders
 * it writes it as text (the card sets textContent, the monument bakes it into
 * a canvas), so escaping here would only mean an operator seeing their own
 * entry come back mangled.
 */
function validName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length === 0 || name.length > REALM_BUILDER_MAX_NAME_LENGTH) {
    throw new TypeError('name must be a non-empty string');
  }
  if (NAME_FORBIDDEN.test(name)) {
    throw new TypeError('name contains control, bidi or zero-width characters');
  }
  return name;
}

function validNote(value: unknown): string {
  if (value === undefined || value === null) return '';
  const note = typeof value === 'string' ? value.trim() : '';
  if (note.length > REALM_BUILDER_MAX_NOTE_LENGTH) {
    throw new TypeError('note is too long');
  }
  return note;
}

function toRow(row: {
  year: number | string;
  month: number | string;
  name: string;
  note: string;
  updated_at: string | Date;
}): RealmBuilderRow {
  return {
    year: Number(row.year),
    month: Number(row.month),
    name: row.name,
    note: row.note,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/**
 * The realm's whole roll, NEWEST FIRST.
 *
 * Ordered by (year, month) rather than by when it was entered: a backfilled
 * month belongs in its own place on the roll, not at the top of it.
 */
export async function listRealmBuilders(pool: Pool, realm: string): Promise<RealmBuilderRow[]> {
  const res = await pool.query(
    `SELECT year, month, name, note, updated_at
       FROM realm_builder_honours
      WHERE realm = $1
      ORDER BY year DESC, month DESC`,
    [realm],
  );
  return res.rows.map(toRow);
}

/** Add or re-name one honoured month. */
export async function upsertRealmBuilder(
  pool: Pool,
  realm: string,
  input: UpsertRealmBuilderInput,
): Promise<RealmBuilderRow> {
  const year = validYear(input.year);
  const month = validMonth(input.month);
  const name = validName(input.name);
  const note = validNote(input.note);
  const res = await pool.query(
    `INSERT INTO realm_builder_honours (realm, year, month, name, note, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (realm, year, month) DO UPDATE
       SET name = EXCLUDED.name,
           note = EXCLUDED.note,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by
     RETURNING year, month, name, note, updated_at`,
    [realm, year, month, name, note, input.updatedBy ?? null],
  );
  return toRow(res.rows[0]);
}

/** Remove one honoured month. Answers whether a row was actually there. */
export async function deleteRealmBuilder(
  pool: Pool,
  realm: string,
  year: unknown,
  month: unknown,
): Promise<boolean> {
  const res = await pool.query(
    `DELETE FROM realm_builder_honours WHERE realm = $1 AND year = $2 AND month = $3`,
    [realm, validYear(year), validMonth(month)],
  );
  return (res.rowCount ?? 0) > 0;
}
