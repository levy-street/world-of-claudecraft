// The account Reliquary ledger's storage: one row per (account, kind, relic
// id), insert-only. Ownership is additive (a filled relic is never un-filled),
// so the union across characters, sessions, and realms is a plain
// ON CONFLICT DO NOTHING insert with no read-modify-write and no lock: two
// realms folding the same account at once cannot lose either side.
//
// Bounded by construction: the catalog caps the rows an account can ever hold
// (every catalogued id once per kind), so the table's ceiling is accounts x
// catalog and it needs no retention sweep. Read once per world join (PK
// lookup) and per public sheet render; written only when a fold discovers an
// id the ledger did not hold.

import {
  emptyAccountReliquaryLedger,
  LEDGER_KINDS,
  type LedgerKind,
  normalizeAccountReliquaryLedger,
} from '../src/sim/reliquary_account';
import type { AccountReliquaryLedger } from '../src/world_api/cosmetics';
import { type AccountCosmetics, loadAccountCosmetics, pool } from './db';

export const ACCOUNT_RELIQUARY_SCHEMA = `
-- Account-wide Reliquary ownership (docs/design/reliquary.md, "Account scope").
-- Insert-only union of every character's catalogued fills; bounded by the
-- catalog per account. Keep on account delete: ON DELETE CASCADE.
CREATE TABLE IF NOT EXISTS account_relics (
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  relic_id TEXT NOT NULL,
  found_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, kind, relic_id),
  CONSTRAINT account_relics_kind CHECK (kind IN ('items', 'marks', 'mounts', 'titles'))
);
`;

interface QueryPool {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** The account's ledger, catalog-filtered on the way out (a row for an id a
 *  later catalog dropped never reaches a client). Unknown account: empty. */
export async function loadAccountReliquary(
  accountId: number,
  db: QueryPool = pool,
): Promise<AccountReliquaryLedger> {
  const res = await db.query(
    'SELECT kind, relic_id FROM account_relics WHERE account_id = $1 ORDER BY kind, relic_id',
    [accountId],
  );
  const raw: Record<LedgerKind, string[]> = emptyAccountReliquaryLedger();
  for (const row of res.rows) {
    const kind = row.kind as string;
    if ((LEDGER_KINDS as readonly string[]).includes(kind) && typeof row.relic_id === 'string') {
      raw[kind as LedgerKind].push(row.relic_id);
    }
  }
  return normalizeAccountReliquaryLedger(raw);
}

/** Record newly found relics for the account: one batched insert per call,
 *  duplicates ignored. Returns how many rows were new (0 when the ledger
 *  already held every id, or when `added` is empty). */
export async function addAccountRelics(
  accountId: number,
  added: AccountReliquaryLedger,
  db: QueryPool = pool,
): Promise<number> {
  const kinds: string[] = [];
  const ids: string[] = [];
  for (const kind of LEDGER_KINDS) {
    for (const id of added[kind]) {
      kinds.push(kind);
      ids.push(id);
    }
  }
  if (ids.length === 0) return 0;
  const res = await db.query(
    `INSERT INTO account_relics (account_id, kind, relic_id)
     SELECT $1, k, r FROM unnest($2::text[], $3::text[]) AS t(k, r)
     ON CONFLICT (account_id, kind, relic_id) DO NOTHING
     RETURNING relic_id`,
    [accountId, kinds, ids],
  );
  return res.rows.length;
}

/** The world-join cosmetics read, with the account ledger attached: what
 *  ws_auth hands the join so the sim and the client both start account-wide. */
export async function loadAccountCosmeticsWithRelics(accountId: number): Promise<AccountCosmetics> {
  const [cosmetics, reliquary] = await Promise.all([
    loadAccountCosmetics(accountId),
    loadAccountReliquary(accountId),
  ]);
  return { ...cosmetics, reliquary };
}
