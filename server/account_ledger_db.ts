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
  isKnownAccountDeedId,
  isKnownAccountRelicKey,
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
  /** Snapshotted onto the row so a find outlives its character (below). */
  name: string;
  cls: PlayerClass;
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
    `INSERT INTO account_relic_finds
       (realm, character_id, account_id, relic_key, character_name, character_class)
     SELECT $1, $2, $3, unnest($4::text[]), $5, $6
     ON CONFLICT (character_id, relic_key) DO NOTHING`,
    [who.realm, who.characterId, who.accountId, [...relicKeys], who.name, who.cls],
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
  // Catalog-bounded on the way out (jgyy's rule from PR #3933): a row for an
  // id a later catalog dropped never reaches a client.
  for (const row of deedRows) {
    const id = String(row.key);
    if (isKnownAccountDeedId(id)) recordAccountDeed(ledger, id, earnerOf(row));
  }
  for (const row of relicRows) {
    const key = String(row.key);
    if (isKnownAccountRelicKey(key)) recordAccountRelic(ledger, key, earnerOf(row));
  }
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
    // LEFT JOIN plus the row's own snapshot: a live character shows its current
    // name (renames follow), a deleted one keeps the name it found the relic
    // under, so the account's Reliquary never loses a find with its finder
    // (survival is jgyy's point from PR #3933; character_deeds still cascades).
    pool.query(
      `SELECT f.relic_key AS key, f.character_id,
              COALESCE(c.name, f.character_name) AS name,
              COALESCE(c.class, f.character_class) AS class,
              f.found_at AS at
         FROM account_relic_finds f
         LEFT JOIN characters c ON c.id = f.character_id
        WHERE f.account_id = $1
        ORDER BY f.found_at ASC, f.id ASC`,
      [accountId],
    ),
  ]);
  return accountLedgerFromRows(deeds.rows as LedgerRow[], relics.rows as LedgerRow[]);
}

/** The public sheet's ledger view: the account's deed ids and relic keys,
 *  nothing else (no names, classes, ids, or days cross into the anonymous
 *  handlers). Two DISTINCT reads over the account indexes, no character join,
 *  catalog-bounded on the way out; served through the TTL cache in
 *  server/account_ledger_keys_cache.ts, never per request. */
export interface AccountLedgerKeys {
  deeds: ReadonlySet<string>;
  relics: ReadonlySet<string>;
}

export async function loadAccountLedgerKeys(accountId: number): Promise<AccountLedgerKeys> {
  const [deeds, relics] = await Promise.all([
    pool.query('SELECT DISTINCT deed_id AS key FROM character_deeds WHERE account_id = $1', [
      accountId,
    ]),
    pool.query('SELECT DISTINCT relic_key AS key FROM account_relic_finds WHERE account_id = $1', [
      accountId,
    ]),
  ]);
  const deedIds = new Set<string>();
  for (const row of deeds.rows as { key: unknown }[]) {
    const id = String(row.key);
    if (isKnownAccountDeedId(id)) deedIds.add(id);
  }
  const relicKeys = new Set<string>();
  for (const row of relics.rows as { key: unknown }[]) {
    const key = String(row.key);
    if (isKnownAccountRelicKey(key)) relicKeys.add(key);
  }
  return { deeds: deedIds, relics: relicKeys };
}

// The account_relic_finds DDL, this domain's own *_SCHEMA. FK-references
// accounts(id), so ensureSchema (server/db.ts) applies it after SCHEMA beside
// DEEDS_SCHEMA, unconditionally (idempotent).
export const ACCOUNT_LEDGER_SCHEMA = `
-- The Reliquary half of the account ledger (src/sim/account_ledger.ts): one
-- row per (character, relic) the sim decided the character found, the
-- character_deeds sibling with ONE deliberate difference: no FK on the
-- character row, plus a name and class snapshot, so a find outlives the
-- character that made it (the account keeps its Reliquary when a character
-- is deleted; jgyy's account-only keying in PR #3933 made the same call).
-- relic_key is the sim's accountRelicKey ('item:<id>', 'mark:<id>',
-- 'mount:<key>'). An OBSERVER index of the sim's
-- decisions (server/account_ledger_records.ts), never an authority: membership
-- truth stays the character state blob, and the login reconcile replays the
-- blob's proven finds idempotently. UNIQUE (character_id, relic_key) is the
-- idempotence backbone; the account index serves the per-join ledger load
-- (loadAccountLedger, server/account_ledger_db.ts), which is the one reader.
CREATE TABLE IF NOT EXISTS account_relic_finds (
  id BIGSERIAL PRIMARY KEY,
  realm TEXT NOT NULL,
  character_id INT NOT NULL,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  relic_key TEXT NOT NULL,
  character_name TEXT NOT NULL,
  character_class TEXT NOT NULL,
  found_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (character_id, relic_key)
);
CREATE INDEX IF NOT EXISTS account_relic_finds_account ON account_relic_finds(account_id);
`;
