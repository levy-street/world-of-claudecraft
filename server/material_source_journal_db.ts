// Additive storage for the material source audit: the static schema for a
// container's opening ANCHOR plus its revision JOURNAL, and the ONE batched
// transactional statement that turns a save's before/after container states
// into journal rows. Definitions and one write; this leaf opens no connection,
// reads no env, applies no DDL and starts no transaction.
//
// Contracts:
//   * The caller passes a TRANSACTION-SCOPED queryable client (a pg PoolClient
//     inside its own save transaction, or a test double). Never a pool: this
//     module issues no BEGIN, COMMIT or ROLLBACK and holds no module-global
//     connection, so state, anchor, revision and journal commit or roll back
//     with the caller's ONE outer transaction or not at all.
//   * The caller MUST already hold the underlying container row locks, in its
//     canonical order, and call this ONCE per save transaction. This statement
//     takes row locks of its own on the ANCHOR rows its upsert touches, in the
//     caller's input order, and never reorders the caller's containers. Those
//     anchor locks are NOT what makes two concurrent saves of one container
//     safe: the caller's underlying container row lock is.
//   * Movement is computed only through the shared ledger core
//     (diffMaterialContainers / projectMaterialContainer), so one gathered unit
//     journals as one delta and a balanced re-attribution journals as a count-0
//     row. A container whose before and after carry no movement is ignored
//     ENTIRELY: no query, no anchor, no revision.
//   * An anchor is created LAZILY, with the first actual journal row, and its
//     `opening` is the exact normalized locked before-state at that moment. A
//     later write with trusted proof of an established anchor omits that large
//     opening from the wire record. The same statement supplies a tiny valid
//     placeholder only when its exact PK probe still finds the anchor, while
//     ON CONFLICT only INCREMENTS the revision and never replaces its opening.
//     A false negative resends the opening safely. There is no whole-world
//     backfill: an absent anchor means unaudited storage, never reconciliation.
//   * Input is validated whole BEFORE any SQL is sent (positive safe owner ids,
//     nonempty realm, known container kind, no duplicate container). A refusal
//     is an explicit error CODE, never player-facing text and never a throw.
//     A database error propagates as pg raised it, so the outer transaction
//     aborts rather than committing a partial audit.
//   * Revisions are PostgreSQL bigints and are returned as exact TEXT. They are
//     a per-container counter, never a commit-order watermark.
//
// GROWTH IS NOT ENFORCED HERE, and this module does not claim it is. Before any
// runtime use the parent owes, in its own change: extending the existing
// bank_ledger_growth_budget into an AGGREGATE audit-row budget covering
// bank_ledger plus material_source_journal (anchor cardinality is bounded by
// journal cardinality, since every anchor is created with a surviving journal
// row), adding both table names to MATERIAL_SOURCE_GUARDED_TABLES in
// material_source_writer.ts, applying this DDL from ensureSchema AFTER the
// characters table exists, and the save/guild-book call sites themselves. No
// separate source-row cap, budget, worker or config is added here.

import type { MaterialStackSlot } from '../src/sim/material_stack';
import {
  type MaterialContainerProjection,
  type MaterialLedgerError,
  type MaterialMovementRow,
  planMaterialContainerTransition,
} from './material_source_ledger';

export const MATERIAL_SOURCE_CONTAINERS_TABLE = 'material_source_containers';
export const MATERIAL_SOURCE_JOURNAL_TABLE = 'material_source_journal';

/** Personal bank and materials vault are character-owned; a guild book is not. */
export const MATERIAL_SOURCE_CONTAINER_KINDS = ['personal', 'vault', 'guild'] as const;
export type MaterialSourceContainerKind = (typeof MATERIAL_SOURCE_CONTAINER_KINDS)[number];

const CHARACTER_OWNED_KINDS = ['personal', 'vault'] as const;

const KINDS_SQL = MATERIAL_SOURCE_CONTAINER_KINDS.map((kind) => `'${kind}'`).join(', ');
const CHARACTER_OWNED_SQL = CHARACTER_OWNED_KINDS.map((kind) => `'${kind}'`).join(', ');

/**
 * Additive and idempotent: two new tables and one new index, no ALTER of an
 * existing table and no data migration. Unqualified names resolve through the
 * applying connection's search_path, and `characters` must already exist.
 *
 * Ownership is what makes the deletion story work. A personal or vault anchor
 * carries the owning character id and cascades with it, so deleting a character
 * reaps its own audit. A guild anchor carries NULL there and has no guild or
 * actor foreign key at all, so a surviving guild's source history outlives every
 * contributing character. No account, actor or other private column exists here:
 * the existing command rows keep their attribution.
 *
 * CREATE TABLE IF NOT EXISTS never revisits an inline constraint, which is fine
 * for tables that do not exist yet; changing a CHECK later is a deliberate
 * converge step, not an edit of the literal below.
 */
export const MATERIAL_SOURCE_JOURNAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS ${MATERIAL_SOURCE_CONTAINERS_TABLE} (
  realm TEXT NOT NULL,
  container TEXT NOT NULL,
  owner_id BIGINT NOT NULL,
  -- NULL for a guild book: no cascade, so guild audit survives an actor delete.
  owner_character_id INT REFERENCES characters(id) ON DELETE CASCADE,
  -- The immutable normalized before-state this container's history replays from.
  opening JSONB NOT NULL,
  current_revision BIGINT NOT NULL,
  PRIMARY KEY (realm, container, owner_id),
  CONSTRAINT material_source_containers_kind
    CHECK (container IN (${KINDS_SQL})),
  CONSTRAINT material_source_containers_owner_positive
    CHECK (owner_id > 0),
  CONSTRAINT material_source_containers_revision_positive
    CHECK (current_revision > 0),
  -- The IS NOT NULL is load-bearing, not decoration: a CHECK that evaluates to
  -- NULL is not a violation, so without it a personal or vault anchor carrying
  -- NO owning character would pass this constraint (NULL OR FALSE is NULL) and
  -- escape the cascade that reaps its history.
  CONSTRAINT material_source_containers_owner_character
    CHECK (
      (container IN (${CHARACTER_OWNED_SQL})
        AND owner_character_id IS NOT NULL
        AND owner_character_id = owner_id)
      OR (container = 'guild' AND owner_character_id IS NULL)
    )
);
-- The cascade's own lookup: without it every character delete sequentially
-- scans this table. Partial because a guild row's NULL is never searched for,
-- and an equality on a deleted character id implies IS NOT NULL, so the
-- cascade's lookup still uses this index.
CREATE INDEX IF NOT EXISTS material_source_containers_character
  ON ${MATERIAL_SOURCE_CONTAINERS_TABLE} (owner_character_id)
  WHERE owner_character_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ${MATERIAL_SOURCE_JOURNAL_TABLE} (
  realm TEXT NOT NULL,
  container TEXT NOT NULL,
  owner_id BIGINT NOT NULL,
  revision BIGINT NOT NULL,
  movements JSONB NOT NULL,
  -- Revision is part of the key, so one container can hold at most one row per
  -- revision and a replay can never see two versions of the same step.
  PRIMARY KEY (realm, container, owner_id, revision),
  CONSTRAINT material_source_journal_revision_positive
    CHECK (revision > 0),
  CONSTRAINT material_source_journal_anchor
    FOREIGN KEY (realm, container, owner_id)
    REFERENCES ${MATERIAL_SOURCE_CONTAINERS_TABLE} (realm, container, owner_id)
    ON DELETE CASCADE
);`;

/** The pg surface this module needs. A transaction-scoped PoolClient satisfies it. */
export interface MaterialSourceJournalClient {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows?: Record<string, unknown>[]; rowCount?: number | null }>;
}

/** One container's before and after state for THIS save transaction. */
export interface MaterialSourceContainerChange {
  readonly realm: string;
  readonly container: MaterialSourceContainerKind;
  /** Character id for personal/vault, guild id for guild. Positive safe integer. */
  readonly ownerId: number;
  readonly before: readonly MaterialStackSlot[];
  readonly after: readonly MaterialStackSlot[];
  /** Trusted proof that this exact container anchor existed under the caller's lock. */
  readonly anchorExists?: boolean;
}

/** What one changed container actually wrote. */
export interface MaterialSourceJournalWrite {
  readonly realm: string;
  readonly container: MaterialSourceContainerKind;
  readonly ownerId: number;
  /** PostgreSQL bigint, exact as text; never parsed into a JS number. */
  readonly revision: string;
  /** True when this write minted the anchor (revision 1 is always the opening). */
  readonly anchorCreated: boolean;
  /** Movement rows carried by this revision. */
  readonly movementCount: number;
}

export interface MaterialSourceJournalWriteResult {
  /** One entry per CHANGED container, in the caller's input order. */
  readonly writes: readonly MaterialSourceJournalWrite[];
  /** Containers that moved nothing: no query, no anchor, no revision. */
  readonly unchangedContainers: number;
  readonly anchorsCreated: number;
  readonly movementRows: number;
}

export type MaterialSourceJournalError =
  | 'invalid-input'
  | 'invalid-realm'
  | 'invalid-container'
  | 'invalid-owner'
  | 'duplicate-container'
  | MaterialLedgerError;

export type MaterialSourceJournalResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: MaterialSourceJournalError };

const succeed = <T>(value: T): MaterialSourceJournalResult<T> => ({ ok: true, value });
const fail = (error: MaterialSourceJournalError): MaterialSourceJournalResult<never> => ({
  ok: false,
  error,
});

/**
 * One jsonb_to_recordset record. Keys are snake_case because they ARE the
 * statement's column names; this is the one place SQL naming wins over the
 * TypeScript convention.
 */
export interface MaterialSourceJournalRecord {
  readonly ord: number;
  readonly realm: string;
  readonly container: MaterialSourceContainerKind;
  readonly owner_id: number;
  readonly owner_character_id: number | null;
  readonly opening: MaterialContainerProjection;
  readonly movements: readonly MaterialMovementRow[];
}

/** The wire plan may replace an established anchor's large opening with SQL null. */
export type MaterialSourceJournalPlannedRecord = Omit<MaterialSourceJournalRecord, 'opening'> & {
  readonly opening: MaterialContainerProjection | null;
};

export interface MaterialSourceJournalPlan {
  /** Only the containers that actually moved, in the caller's input order. */
  readonly records: readonly MaterialSourceJournalPlannedRecord[];
  readonly unchangedContainers: number;
}

/** Unambiguous whatever a realm name contains. */
const containerKey = (change: MaterialSourceContainerChange): string =>
  JSON.stringify([change.realm, change.container, change.ownerId]);

const isKind = (value: unknown): value is MaterialSourceContainerKind =>
  MATERIAL_SOURCE_CONTAINER_KINDS.includes(value as MaterialSourceContainerKind);

/**
 * A slot list is persisted records: an array whose every row is a plain
 * non-null, non-array object. A row that is not refuses the WHOLE call, because
 * the shared core would otherwise either throw on it (`null`/`undefined`
 * dereference their item id) or silently DROP it (a primitive or an array reads
 * `undefined` for its item id and vanishes from the projection, which is a
 * wrong audit rather than a partial one).
 *
 * Row FIELDS are deliberately not inspected here: an ordinary object whose item
 * id is not a material is the core's business and is still skipped, and a
 * malformed material slot is the core's refusal to raise. Indexed rather than
 * `every` so a sparse array's holes are read as the `undefined` the core would
 * see, not skipped.
 */
function isSlotList(value: unknown): value is readonly MaterialStackSlot[] {
  if (!Array.isArray(value)) return false;
  for (let i = 0; i < value.length; i++) {
    const row: unknown = value[i];
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return false;
  }
  return true;
}

/**
 * The whole pure half: validate every container, diff it through the shared
 * core, and build the exact records the one statement carries. Any refusal
 * refuses the WHOLE call, before a single byte reaches the database, so a
 * malformed container can never leave half an audit behind.
 */
export function planMaterialSourceJournalWrite(
  changes: readonly MaterialSourceContainerChange[],
  materialIds: ReadonlySet<string>,
): MaterialSourceJournalResult<MaterialSourceJournalPlan> {
  if (!Array.isArray(changes)) return fail('invalid-input');

  const seen = new Set<string>();
  const records: MaterialSourceJournalPlannedRecord[] = [];
  let unchangedContainers = 0;

  for (const change of changes) {
    if (typeof change !== 'object' || change === null) return fail('invalid-input');
    if (typeof change.realm !== 'string' || change.realm.length === 0) return fail('invalid-realm');
    if (!isKind(change.container)) return fail('invalid-container');
    if (!Number.isSafeInteger(change.ownerId) || change.ownerId <= 0) return fail('invalid-owner');
    if (!isSlotList(change.before) || !isSlotList(change.after)) return fail('invalid-input');

    const key = containerKey(change);
    if (seen.has(key)) return fail('duplicate-container');
    seen.add(key);

    const transition = planMaterialContainerTransition(change.before, change.after, materialIds);
    if (!transition.ok) return fail(transition.error);
    if (transition.value.movements.length === 0) {
      unchangedContainers++;
      continue;
    }

    // Reuse the locked before projection already validated by the transition.
    // It seeds INSERT unless the caller's locked live-row read proved this
    // exact anchor exists; ON CONFLICT retains the immutable established one.

    records.push({
      ord: records.length,
      realm: change.realm,
      container: change.container,
      owner_id: change.ownerId,
      owner_character_id: change.container === 'guild' ? null : change.ownerId,
      opening: change.anchorExists === true ? null : transition.value.opening,
      movements: transition.value.movements,
    });
  }

  return succeed({ records, unchangedContainers });
}

/**
 * ONE statement for every changed container: the anchors upsert (insert at
 * revision 1, or increment an existing revision and keep its opening), the
 * matching journal rows insert at exactly those revisions, and the identities
 * come back out. No per-container round trip and no per-source loop.
 *
 * An omitted opening is represented as SQL null. The INSERT substitutes the
 * canonical empty projection only while an exact-PK EXISTS still sees the
 * established anchor; ON CONFLICT then discards that candidate and increments
 * only its revision. If the anchor vanished after capture, the NOT NULL column
 * refuses the candidate and aborts the caller's outer save transaction. The
 * sanctioned character-delete cascade cannot race a live save holding the
 * character lock. This is not a concurrency promise for privileged out-of-band
 * maintenance that bypasses that lock.
 *
 * The journal's foreign key is satisfied by an anchor inserted in this same
 * statement: referential triggers fire at end of statement, by which time the
 * anchor row exists. Duplicate containers would make the ON CONFLICT arm hit one
 * row twice, which is exactly what the pre-SQL duplicate refusal prevents.
 */
export const MATERIAL_SOURCE_JOURNAL_WRITE_SQL = `WITH input AS (
  SELECT *
    FROM jsonb_to_recordset($1::jsonb)
      AS t(ord int, realm text, container text, owner_id bigint,
           owner_character_id bigint, opening jsonb, movements jsonb)
), anchor AS (
  INSERT INTO ${MATERIAL_SOURCE_CONTAINERS_TABLE}
      (realm, container, owner_id, owner_character_id, opening, current_revision)
  SELECT i.realm, i.container, i.owner_id, i.owner_character_id,
         CASE WHEN i.opening IS NOT NULL THEN i.opening
              WHEN EXISTS (
                SELECT 1 FROM ${MATERIAL_SOURCE_CONTAINERS_TABLE} AS established
                 WHERE established.realm = i.realm
                   AND established.container = i.container
                   AND established.owner_id = i.owner_id
              ) THEN '{"entries":[]}'::jsonb
              ELSE NULL
          END,
         1
    FROM input AS i
   ORDER BY i.ord
  ON CONFLICT (realm, container, owner_id) DO UPDATE
     SET current_revision = ${MATERIAL_SOURCE_CONTAINERS_TABLE}.current_revision + 1
  RETURNING realm, container, owner_id, current_revision
), journal AS (
  INSERT INTO ${MATERIAL_SOURCE_JOURNAL_TABLE}
      (realm, container, owner_id, revision, movements)
  SELECT a.realm, a.container, a.owner_id, a.current_revision, i.movements
    FROM anchor a
    JOIN input i
      ON i.realm = a.realm AND i.container = a.container AND i.owner_id = a.owner_id
   ORDER BY i.ord
  RETURNING realm, container, owner_id, revision
)
SELECT i.ord AS ord,
       j.realm AS realm,
       j.container AS container,
       j.owner_id::text AS owner_id,
       j.revision::text AS revision
  FROM journal j
  JOIN input i
    ON i.realm = j.realm AND i.container = j.container AND i.owner_id = j.owner_id
 ORDER BY i.ord`;

/** A returned row that does not answer its own record is a broken statement,
 *  never a refusal to report: throwing aborts the caller's transaction. */
function readWrite(
  record: MaterialSourceJournalPlannedRecord,
  row: Record<string, unknown> | undefined,
): MaterialSourceJournalWrite {
  const revision = row?.revision;
  if (
    row === undefined ||
    Number(row.ord) !== record.ord ||
    row.realm !== record.realm ||
    row.container !== record.container ||
    String(row.owner_id) !== String(record.owner_id) ||
    typeof revision !== 'string' ||
    !/^[1-9][0-9]*$/.test(revision)
  ) {
    throw new Error(`material source journal returned no row for container ordinal ${record.ord}`);
  }
  return {
    realm: record.realm,
    container: record.container,
    ownerId: record.owner_id,
    revision,
    anchorCreated: revision === '1',
    movementCount: record.movements.length,
  };
}

/**
 * Journals every container this save actually moved, on the caller's open
 * transaction, in one statement. Returns the canonical write result, or an
 * error code with nothing sent at all.
 */
export async function writeMaterialSourceJournal(
  client: MaterialSourceJournalClient,
  changes: readonly MaterialSourceContainerChange[],
  materialIds: ReadonlySet<string>,
): Promise<MaterialSourceJournalResult<MaterialSourceJournalWriteResult>> {
  const plan = planMaterialSourceJournalWrite(changes, materialIds);
  if (!plan.ok) return plan;

  const { records, unchangedContainers } = plan.value;
  if (records.length === 0) {
    // A FRESH empty list per answer, never one shared constant: a caller owns
    // what it was handed, and mutating it must not reach the next answer.
    return succeed({ writes: [], unchangedContainers, anchorsCreated: 0, movementRows: 0 });
  }

  const result = await client.query(MATERIAL_SOURCE_JOURNAL_WRITE_SQL, [JSON.stringify(records)]);
  const rows = result.rows ?? [];
  if (rows.length !== records.length) {
    throw new Error(
      `material source journal wrote ${rows.length} of ${records.length} container revisions`,
    );
  }

  const writes = records.map((record, index) => readWrite(record, rows[index]));
  return succeed({
    writes,
    unchangedContainers,
    anchorsCreated: writes.filter((write) => write.anchorCreated).length,
    movementRows: writes.reduce((total, write) => total + write.movementCount, 0),
  });
}
