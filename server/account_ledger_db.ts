// SQL boundary for the account ledger (src/sim/account_ledger.ts): the
// per-join load that assembles which characters on an account earned each
// deed (character_deeds) and found each relic (account_relic_finds), plus the
// idempotent relic-find inserts the observer and the login reconcile issue.
// The *_db.ts convention: every query for these reads lives here,
// parameterized, and no other module carries raw SQL for account_relic_finds.
// Deliberate lazy `pool` read (the account_cosmetics_db doctrine): `pool` is
// touched only inside the functions, never at module scope.

import {
  type AccountEarner,
  type AccountLedger,
  freshAccountLedger,
  recordAccountDeed,
  recordAccountRelic,
} from '../src/sim/account_ledger';
import type { PlayerClass } from '../src/sim/types';
import { pool } from './db';

/** The (character, account) pair every insert carries. realm is passed
 *  explicitly (the table carries no DEFAULT; the interpolated-default pattern
 *  is last-boot-wins across realm processes). */
export interface RelicFindWho {
  realm: string;
  characterId: number;
  accountId: number;
}

/** Record a character's relic finds in ONE conflict-swallowing statement.
 *  Idempotent per (character, relic_key), so the live observer, the on-join
 *  seed replay, and a crash-replay all collapse into no-ops. Empty input is a
 *  caller-side no-op (never reaches SQL); keys bind as one text[]. */
export async function insertAccountRelicFinds(
  who: RelicFindWho,
  relicKeys: readonly string[],
): Promise<void> {
  if (relicKeys.length === 0) return;
  await pool.query(
    `INSERT INTO account_relic_finds (realm, character_id, account_id, relic_key)
     SELECT $1, $2, $3, unnest($4::text[])
     ON CONFLICT (character_id, relic_key) DO NOTHING`,
    [who.realm, who.characterId, who.accountId, [...relicKeys]],
  );
}

/** 'YYYY-MM-DD' (UTC) for a timestamptz value the driver hands back as a
 *  Date, or the first ten characters of an ISO string; '' for anything else
 *  (the ledger's "no calendar" value, which the Book renders as no date). */
export function utcDayOf(value: unknown): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return '';
}

interface LedgerRow {
  key: string;
  character_id: number;
  name: string;
  class: string;
  at: unknown;
}

function earnerOf(row: LedgerRow): AccountEarner {
  return {
    characterId: Number(row.character_id),
    name: String(row.name),
    cls: String(row.class) as PlayerClass,
    day: utcDayOf(row.at),
  };
}

/** Pure fold of the two row sets into a ledger (exported so a test can pin
 *  the shape without a pool). Rows arrive oldest-first, so the first earner
 *  of each entry is the first to have earned it on the account. */
export function accountLedgerFromRows(
  deedRows: readonly LedgerRow[],
  relicRows: readonly LedgerRow[],
): AccountLedger {
  const ledger = freshAccountLedger();
  for (const row of deedRows) recordAccountDeed(ledger, String(row.key), earnerOf(row));
  for (const row of relicRows) recordAccountRelic(ledger, String(row.key), earnerOf(row));
  return ledger;
}

/** The whole account ledger for one account: every character's deed earns and
 *  relic finds, each joined to the live character name and class. Two indexed
 *  reads (character_deeds_account, account_relic_finds_account) issued once
 *  per join, the loadAccountCosmetics cadence. Cross-realm by design: an
 *  account's books are one book wherever its characters live. */
export async function loadAccountLedger(accountId: number): Promise<AccountLedger> {
  const [deeds, relics] = await Promise.all([
    pool.query(
      `SELECT d.deed_id AS key, d.character_id, c.name, c.class, d.earned_at AS at
         FROM character_deeds d
         JOIN characters c ON c.id = d.character_id
        WHERE d.account_id = $1
        ORDER BY d.earned_at ASC, d.id ASC`,
      [accountId],
    ),
    pool.query(
      `SELECT f.relic_key AS key, f.character_id, c.name, c.class, f.found_at AS at
         FROM account_relic_finds f
         JOIN characters c ON c.id = f.character_id
        WHERE f.account_id = $1
        ORDER BY f.found_at ASC, f.id ASC`,
      [accountId],
    ),
  ]);
  return accountLedgerFromRows(deeds.rows as LedgerRow[], relics.rows as LedgerRow[]);
}

// The account_relic_finds DDL, this domain's own *_SCHEMA. FK-references
// characters(id) and accounts(id), so ensureSchema (server/db.ts) applies it
// after SCHEMA beside DEEDS_SCHEMA, unconditionally (idempotent).
export const ACCOUNT_LEDGER_SCHEMA = `
-- The Reliquary half of the account ledger (src/sim/account_ledger.ts): one
-- row per (character, relic) the sim decided the character found, the exact
-- sibling of character_deeds. relic_key is the sim's accountRelicKey
-- ('item:<id>', 'mark:<id>', 'mount:<key>'). An OBSERVER index of the sim's
-- decisions (server/account_ledger_records.ts), never an authority: membership
-- truth stays the character state blob, and the login reconcile replays the
-- blob's proven finds idempotently. UNIQUE (character_id, relic_key) is the
-- idempotence backbone; the account index serves the per-join ledger load
-- (loadAccountLedger, server/account_ledger_db.ts), which is the one reader.
CREATE TABLE IF NOT EXISTS account_relic_finds (
  id BIGSERIAL PRIMARY KEY,
  realm TEXT NOT NULL,
  character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  relic_key TEXT NOT NULL,
  found_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (character_id, relic_key)
);
CREATE INDEX IF NOT EXISTS account_relic_finds_account ON account_relic_finds(account_id);
`;
