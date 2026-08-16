// Economy Watch, phase 1: the row shapes shared by the writer, the SQL
// boundary, the reconciler, and the admin read API. Type-only plus one pure
// mapper, so importing it costs nothing and creates no cycle between the
// logic module (`gold_ledger.ts`) and the SQL module (`gold_ledger_db.ts`),
// which would otherwise have to import each other for these.

import type { EconomyCounterparty } from '../src/sim/economy_event_kinds';

/** One row as the writer hands it to SQL. Ids are assigned by the database. */
export interface GoldLedgerInsert {
  realm: string;
  // Nullable because a movement can outlive the account link in edge cases
  // (an offline host, a character whose account row was removed); the column
  // is ON DELETE SET NULL for the same reason.
  accountId: number | null;
  characterId: number;
  kind: string;
  amount: number;
  balanceAfter: number;
  counterpartyKind: string | null;
  counterpartyId: string | null;
  prevLedgerId: number | null;
  simTick: number;
  zone: string;
  posX: number;
  posZ: number;
  sessionId: string | null;
}

/** One row as read back, with its assigned id and timestamp. */
export interface GoldLedgerRow extends GoldLedgerInsert {
  id: number;
  createdAt: string;
}

/**
 * Flatten the sim's counterparty union into the table's two bounded columns.
 *
 * Two columns rather than one JSON blob because both are queried: an operator
 * asking "everything this character traded with" filters on kind and id
 * together, and a JSONB containment query cannot use a plain btree index.
 * `id` is TEXT because the union mixes numeric ids (character, guild) with a
 * string pool name, and a discriminator column plus a text id keeps the pair
 * honest instead of overloading a numeric column with sentinel values.
 */
export function flattenCounterparty(cp: EconomyCounterparty): {
  kind: string | null;
  id: string | null;
} {
  if (cp === null) return { kind: null, id: null };
  return { kind: cp.kind, id: String(cp.id) };
}
