// Transactional persistence for the bounded bank-ledger outbox. The caller
// owns the transaction and has already taken the character save FIFO plus the
// account parent lock and character fence. This classifier deliberately runs
// before any guild-book lock. It claims immutable command receipts and inserts
// only newly claimed commands, in caller order, in one PostgreSQL statement.

import { createHash } from 'node:crypto';
import { bankLedgerGrowthLimitFromError } from './bank_ledger_growth_budget';
import {
  BANK_LEDGER_OUTBOX_BATCH_KEY_MAX_LENGTH,
  type BankLedgerCommandBatch,
  bankLedgerBatchMatchesOwner,
  bankLedgerCommandBatchFingerprintJson,
  type SerializedBankLedgerGuildEffect,
  type SerializedBankLedgerOutboxRow,
  serializeBankLedgerGuildEffect,
} from './bank_ledger_outbox';

/**
 * The receipt is the durable answer to an ambiguous COMMIT. It is never pruned:
 * its lifetime matches the bank_ledger rows it makes idempotent, except that the
 * two explicit owner-deletion cascades remove both histories together. The full
 * FK indexes keep either cascade from scanning the keep-forever receipt table.
 */
export const BANK_LEDGER_BATCH_RECEIPTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS bank_ledger_batch_receipts (
  batch_key TEXT PRIMARY KEY,
  realm TEXT NOT NULL,
  character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  row_count INT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bank_ledger_batch_receipts_key_shape CHECK (
    char_length(batch_key) BETWEEN 1 AND ${BANK_LEDGER_OUTBOX_BATCH_KEY_MAX_LENGTH}
    AND batch_key ~ '^[A-Za-z0-9_.:-]+$'
  ),
  CONSTRAINT bank_ledger_batch_receipts_row_count_positive CHECK (row_count > 0),
  CONSTRAINT bank_ledger_batch_receipts_sha256_shape CHECK (
    payload_sha256 ~ '^[0-9a-f]{64}$'
  )
);
CREATE INDEX IF NOT EXISTS bank_ledger_batch_receipts_character
  ON bank_ledger_batch_receipts (character_id);
CREATE INDEX IF NOT EXISTS bank_ledger_batch_receipts_account
  ON bank_ledger_batch_receipts (account_id);

-- Converge the key-shape CHECK on existing databases: CREATE TABLE IF NOT
-- EXISTS never revisits the inline constraint, so a changed
-- BANK_LEDGER_OUTBOX_BATCH_KEY_MAX_LENGTH would otherwise silently keep the
-- old bound. Steady-state boots read only the catalog (the probe matches the
-- definition alone, valid or not, so the NOT VALID window below never
-- re-fires it). A mismatched or missing definition is dropped and re-added
-- once as NOT VALID: enforcement of NEW writes starts immediately, but boot
-- never pays a full-table validation scan of this keep-forever table (a
-- constant edit or a pg_get_constraintdef rendering change would otherwise
-- re-fire it as an unbounded ACCESS EXCLUSIVE scan at boot). The existing
-- rows are validated out of boot, post-listen, INSIDE the same session
-- advisory lock the concurrent index builds hold, bounded and self-caught
-- (validateBankLedgerBatchReceiptsKeyShape below; db.ts wires it).
DO $bank_ledger_batch_receipts_key_shape_converge$
DECLARE
  key_shape_ready boolean;
BEGIN
  SELECT c.contype = 'c'
         AND pg_get_constraintdef(c.oid) LIKE '%char_length(batch_key)%'
         AND pg_get_constraintdef(c.oid) LIKE '%<= ${BANK_LEDGER_OUTBOX_BATCH_KEY_MAX_LENGTH})%'
         AND position('^[A-Za-z0-9_.:-]+$' in pg_get_constraintdef(c.oid)) > 0
    INTO key_shape_ready
    FROM pg_constraint c
   WHERE c.conname = 'bank_ledger_batch_receipts_key_shape'
     AND c.conrelid = 'bank_ledger_batch_receipts'::regclass;
  IF NOT COALESCE(key_shape_ready, false) THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'bank_ledger_batch_receipts_key_shape'
         AND conrelid = 'bank_ledger_batch_receipts'::regclass
    ) THEN
      ALTER TABLE bank_ledger_batch_receipts
        DROP CONSTRAINT bank_ledger_batch_receipts_key_shape;
    END IF;
    ALTER TABLE bank_ledger_batch_receipts
      ADD CONSTRAINT bank_ledger_batch_receipts_key_shape CHECK (
        char_length(batch_key) BETWEEN 1 AND ${BANK_LEDGER_OUTBOX_BATCH_KEY_MAX_LENGTH}
        AND batch_key ~ '^[A-Za-z0-9_.:-]+$'
      ) NOT VALID;
  END IF;
END;
$bank_ledger_batch_receipts_key_shape_converge$;
`;

/**
 * The out-of-boot half of the key-shape converge above: validate a NOT VALID
 * key-shape constraint against the existing rows. VALIDATE takes only SHARE
 * UPDATE EXCLUSIVE, so live inserts keep flowing while the keep-forever table
 * is scanned. Run post-listen (runConcurrentIndexMigrations), INSIDE the
 * session advisory lock the concurrent index builds hold, through the
 * bounded, failure-swallowing helper below; a validation failure means rows
 * violating the CURRENT key shape exist and an operator must reconcile them.
 */
export const BANK_LEDGER_BATCH_RECEIPTS_VALIDATE_SQL = `
DO $bank_ledger_batch_receipts_key_shape_validate$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bank_ledger_batch_receipts_key_shape'
       AND conrelid = 'bank_ledger_batch_receipts'::regclass
       AND NOT convalidated
  ) THEN
    ALTER TABLE bank_ledger_batch_receipts
      VALIDATE CONSTRAINT bank_ledger_batch_receipts_key_shape;
  END IF;
END;
$bank_ledger_batch_receipts_key_shape_validate$;
`;

/**
 * Bounded allowance for the VALIDATE scan, armed with SET LOCAL inside the
 * helper's own transaction. Sizing evidence, and be honest about cache state:
 * the timed measurements are WARM (about 0.5 to 0.7s per 2,000,000 receipt
 * rows, about 3.4s warm at the bank_ledger hard ceiling's cardinality of
 * 10,000,000 rows, an upper bound on receipts since every receipt covers at
 * least one ledger row), while a COLD scan on the shared 4-vCPU production
 * box is tens of seconds. statement_timeout also counts LOCK WAIT, not just
 * the scan. 60s is therefore headroom over the cold case, not 20x over the
 * warm one; a wedged scan still dies instead of camping the dedicated boot
 * client for good.
 */
export const BANK_LEDGER_BATCH_RECEIPTS_VALIDATE_TIMEOUT_MS = 60_000;

/**
 * Lock-wait bound for the VALIDATE transaction. The schema advisory lock
 * already serializes boots, so nothing conflicting should hold the table; a
 * short bound turns a surprise holder into a fast next-boot retry instead of
 * spending the whole statement allowance waiting.
 */
export const BANK_LEDGER_BATCH_RECEIPTS_VALIDATE_LOCK_TIMEOUT_MS = 5_000;

/**
 * Issue the VALIDATE fragment on a dedicated (non-pool) boot client, INSIDE
 * the post-listen session advisory lock (runConcurrentIndexMigrations). The
 * in-lock placement is load-bearing: run after the unlock, a concurrently
 * booting realm would acquire the lock, run its boot DDL (whose ADD COLUMN
 * IF NOT EXISTS and CREATE INDEX IF NOT EXISTS take ACCESS EXCLUSIVE and
 * SHARE locks even when skipping, and SHARE conflicts with VALIDATE's SHARE
 * UPDATE EXCLUSIVE), and then block MID-DDL behind this scan while holding
 * ACCESS EXCLUSIVE on characters/accounts/auth_tokens at statement_timeout
 * 0, freezing every login and save for up to the scan bound. Held inside
 * the lock, that realm waits at pg_advisory_lock holding NOTHING. The scan
 * runs in its own transaction with SET LOCAL bounds, so the exported helper
 * can never leave a 60s session setting on a future pooled caller, and is
 * self-caught: a failed VALIDATE rolls back, reports loudly, and resolves
 * false, leaving the constraint NOT VALID (new writes still enforce) for
 * the next boot to retry. A 23514 failure is the operator signal that
 * surviving rows violate the CURRENT key shape.
 */
export async function validateBankLedgerBatchReceiptsKeyShape(
  client: BankLedgerBatchQueryable,
): Promise<boolean> {
  try {
    await client.query('BEGIN');
    await client.query(
      `SET LOCAL statement_timeout = ${BANK_LEDGER_BATCH_RECEIPTS_VALIDATE_TIMEOUT_MS}; ` +
        `SET LOCAL lock_timeout = ${BANK_LEDGER_BATCH_RECEIPTS_VALIDATE_LOCK_TIMEOUT_MS}`,
    );
    await client.query(BANK_LEDGER_BATCH_RECEIPTS_VALIDATE_SQL);
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(
      'bank_ledger_batch_receipts key-shape VALIDATE failed; the constraint stays NOT VALID (new writes still enforce) and the next boot retries:',
      err,
    );
    return false;
  }
}

export interface BankLedgerBatchOwner {
  readonly realm: string;
  readonly characterId: number;
  readonly accountId: number;
}

/** A pg PoolClient or any transaction-scoped query-compatible test double. */
export interface BankLedgerBatchQueryable {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

interface ExpectedReceipt {
  readonly ordinal: number;
  readonly batchKey: string;
  readonly rowCount: number;
  readonly payloadSha256: string;
  readonly batch: BankLedgerCommandBatch;
  readonly guildEffect: SerializedBankLedgerGuildEffect | null;
}

interface PreparedWrite {
  readonly values: unknown[];
  readonly receipts: readonly ExpectedReceipt[];
}

export interface BankLedgerBatchClaim {
  /** Exact input object, used by the owning outbox as durable-prefix evidence. */
  readonly batch: BankLedgerCommandBatch;
  readonly newlyClaimed: boolean;
  /** Detached replay payload verified by this command's receipt hash. */
  readonly guildEffect: SerializedBankLedgerGuildEffect | null;
}

export interface BankLedgerBatchWriteResult {
  readonly batches: readonly BankLedgerBatchClaim[];
  /** The only legal prior-commit shape: a leading, exact input-object prefix. */
  readonly alreadyCommittedPrefix: readonly BankLedgerCommandBatch[];
}

const BATCH_KEY_SHAPE = /^[A-Za-z0-9_.:-]+$/;

function assertPositiveSafeInteger(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function validateOwner(owner: BankLedgerBatchOwner): void {
  if (typeof owner !== 'object' || owner === null) {
    throw new TypeError('bank ledger batch owner must be an object');
  }
  if (typeof owner.realm !== 'string' || owner.realm.length === 0) {
    throw new TypeError('bank ledger batch owner.realm must be a non-empty string');
  }
  assertPositiveSafeInteger(owner.characterId, 'bank ledger batch owner.characterId');
  assertPositiveSafeInteger(owner.accountId, 'bank ledger batch owner.accountId');
}

function validateBatchKey(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > BANK_LEDGER_OUTBOX_BATCH_KEY_MAX_LENGTH ||
    !BATCH_KEY_SHAPE.test(value)
  ) {
    throw new TypeError(
      `bank ledger batch key must be 1 to ${BANK_LEDGER_OUTBOX_BATCH_KEY_MAX_LENGTH} characters from [A-Za-z0-9_.:-]`,
    );
  }
}

/**
 * Rebuild the property order owned by serializeBankLedgerCommandBatch. A typed
 * caller normally passes that module's frozen rows, while this normalization
 * also makes the receipt hash independent of a hand-built object's insertion
 * order. instanceJson is already detached JSON and is hashed as that exact text.
 */
function normalizedRow(row: SerializedBankLedgerOutboxRow): SerializedBankLedgerOutboxRow {
  return {
    realm: row.realm,
    characterId: row.characterId,
    accountId: row.accountId,
    op: row.op,
    itemId: row.itemId,
    count: row.count,
    instanceJson: row.instanceJson,
    copperDelta: row.copperDelta,
    purchasedSlotsAfter: row.purchasedSlotsAfter,
    container: row.container,
    containerId: row.containerId,
    counterpartyCopperDelta: row.counterpartyCopperDelta,
    counterpartyCount: row.counterpartyCount,
  };
}

export function bankLedgerCommandBatchPayloadSha256(batch: BankLedgerCommandBatch): string {
  return createHash('sha256').update(bankLedgerCommandBatchFingerprintJson(batch)).digest('hex');
}

function prepareWrite(
  owner: BankLedgerBatchOwner,
  batches: readonly BankLedgerCommandBatch[],
): PreparedWrite {
  validateOwner(owner);
  if (!Array.isArray(batches)) {
    throw new TypeError('bank ledger command batches must be an array');
  }

  const seenBatchKeys = new Set<string>();
  const receipts: ExpectedReceipt[] = [];

  const receiptOrdinals: number[] = [];
  const receiptKeys: string[] = [];
  const receiptRealms: string[] = [];
  const receiptCharacterIds: number[] = [];
  const receiptAccountIds: number[] = [];
  const receiptRowCounts: number[] = [];
  const receiptHashes: string[] = [];

  const rowBatchOrdinals: number[] = [];
  const rowOrdinals: number[] = [];
  const rowBatchKeys: string[] = [];
  const rowRealms: string[] = [];
  const rowCharacterIds: number[] = [];
  const rowAccountIds: number[] = [];
  const rowOps: string[] = [];
  const rowItemIds: Array<string | null> = [];
  const rowCounts: Array<number | null> = [];
  const rowInstances: Array<string | null> = [];
  const rowCopperDeltas: number[] = [];
  const rowPurchasedSlots: number[] = [];
  const rowContainers: string[] = [];
  const rowContainerIds: Array<number | null> = [];
  const rowCounterpartyCopperDeltas: Array<number | null> = [];
  const rowCounterpartyCounts: Array<number | null> = [];

  for (let batchOrdinal = 0; batchOrdinal < batches.length; batchOrdinal++) {
    const batch = batches[batchOrdinal];
    if (typeof batch !== 'object' || batch === null) {
      throw new TypeError('bank ledger command batch must be an object');
    }
    validateBatchKey(batch.batchKey);
    if (seenBatchKeys.has(batch.batchKey)) {
      throw new Error(`duplicate bank ledger batch key: ${batch.batchKey}`);
    }
    seenBatchKeys.add(batch.batchKey);
    if (!Array.isArray(batch.rows) || batch.rows.length === 0) {
      throw new RangeError(`bank ledger batch ${batch.batchKey} must contain at least one row`);
    }

    // This validates the complete receipt shape, including guild sidecar
    // correlation, before the first query and returns no caller-owned alias.
    const guildEffect = batch.guildEffect
      ? serializeBankLedgerGuildEffect(batch.guildEffect)
      : null;
    const hash = bankLedgerCommandBatchPayloadSha256(batch);
    if (!bankLedgerBatchMatchesOwner(owner, batch)) {
      throw new Error(`bank ledger batch ${batch.batchKey} does not match owner`);
    }

    const normalizedRows: SerializedBankLedgerOutboxRow[] = [];
    for (let rowOrdinal = 0; rowOrdinal < batch.rows.length; rowOrdinal++) {
      const sourceRow = batch.rows[rowOrdinal];
      if (typeof sourceRow !== 'object' || sourceRow === null) {
        throw new TypeError(`bank ledger batch ${batch.batchKey} row ${rowOrdinal} is invalid`);
      }
      const value = normalizedRow(sourceRow);
      normalizedRows.push(value);
      rowBatchOrdinals.push(batchOrdinal);
      rowOrdinals.push(rowOrdinal);
      rowBatchKeys.push(batch.batchKey);
      rowRealms.push(value.realm);
      rowCharacterIds.push(value.characterId);
      rowAccountIds.push(value.accountId);
      rowOps.push(value.op);
      rowItemIds.push(value.itemId);
      rowCounts.push(value.count);
      rowInstances.push(value.instanceJson);
      rowCopperDeltas.push(value.copperDelta);
      rowPurchasedSlots.push(value.purchasedSlotsAfter);
      rowContainers.push(value.container);
      rowContainerIds.push(value.containerId);
      rowCounterpartyCopperDeltas.push(value.counterpartyCopperDelta);
      rowCounterpartyCounts.push(value.counterpartyCount);
    }

    receiptOrdinals.push(batchOrdinal);
    receiptKeys.push(batch.batchKey);
    receiptRealms.push(owner.realm);
    receiptCharacterIds.push(owner.characterId);
    receiptAccountIds.push(owner.accountId);
    receiptRowCounts.push(normalizedRows.length);
    receiptHashes.push(hash);
    receipts.push({
      ordinal: batchOrdinal,
      batchKey: batch.batchKey,
      rowCount: normalizedRows.length,
      payloadSha256: hash,
      batch,
      guildEffect,
    });
  }

  return {
    values: [
      receiptOrdinals,
      receiptKeys,
      receiptRealms,
      receiptCharacterIds,
      receiptAccountIds,
      receiptRowCounts,
      receiptHashes,
      rowBatchOrdinals,
      rowOrdinals,
      rowBatchKeys,
      rowRealms,
      rowCharacterIds,
      rowAccountIds,
      rowOps,
      rowItemIds,
      rowCounts,
      rowInstances,
      rowCopperDeltas,
      rowPurchasedSlots,
      rowContainers,
      rowContainerIds,
      rowCounterpartyCopperDeltas,
      rowCounterpartyCounts,
    ],
    receipts,
  };
}

// Same-statement visibility is deliberate here. claimed RETURNING is the only
// place a receipt inserted by this statement is visible. Plan shape verified
// empirically (PG16, 1M seeded receipts, the 2,048-key max prefix): a Nested
// Loop of per-key Index Scans on the PK, 9.7ms total, never a seq scan
// (unnest's 2,048-row estimate keeps the planner on the point-probe side).
// Not Index ONLY: existing_receipts selects realm/character/account/row_count/
// payload_sha256, none covered by the batch_key PK, so each probe on the retry
// path fetches its heap tuple. The cost stays one point probe per key.
// existing_receipts
// reads the statement-start snapshot, so an already committed retry is visible;
// a concurrent conflict that ON CONFLICT can detect but the snapshot cannot see
// produces no stored receipt in verification and is rejected for a safe retry.
const WRITE_BANK_LEDGER_COMMAND_BATCHES_SQL = `
WITH receipt_input AS (
  SELECT *
    FROM unnest(
      $1::int[], $2::text[], $3::text[], $4::int[], $5::int[], $6::int[], $7::text[]
    ) AS input(
      batch_ordinal, batch_key, realm, character_id, account_id, row_count, payload_sha256
    )
),
row_input AS (
  SELECT *
    FROM unnest(
      $8::int[], $9::int[], $10::text[], $11::text[], $12::int[], $13::int[],
      $14::text[], $15::text[], $16::int[], $17::jsonb[], $18::bigint[], $19::int[],
      $20::text[], $21::bigint[], $22::bigint[], $23::int[]
    ) AS input(
      batch_ordinal, row_ordinal, batch_key, realm, character_id, account_id,
      op, item_id, count, instance, copper_delta, purchased_slots_after,
      container, container_id, counterparty_copper_delta, counterparty_count
    )
),
claimed AS (
  INSERT INTO bank_ledger_batch_receipts
    (batch_key, realm, character_id, account_id, row_count, payload_sha256)
  SELECT batch_key, realm, character_id, account_id, row_count, payload_sha256
    FROM receipt_input
   ORDER BY batch_ordinal
  ON CONFLICT (batch_key) DO NOTHING
  RETURNING batch_key, realm, character_id, account_id, row_count, payload_sha256
),
existing_receipts AS (
  SELECT existing.batch_key,
         existing.realm,
         existing.character_id,
         existing.account_id,
         existing.row_count,
         existing.payload_sha256
    FROM bank_ledger_batch_receipts AS existing
    JOIN receipt_input AS input ON input.batch_key = existing.batch_key
),
inserted AS (
  INSERT INTO bank_ledger
    (realm, character_id, account_id, op, item_id, count, instance,
     copper_delta, purchased_slots_after, container, container_id,
     counterparty_copper_delta, counterparty_count)
  SELECT ri.realm,
         ri.character_id,
         ri.account_id,
         ri.op,
         ri.item_id,
         ri.count,
         ri.instance,
         ri.copper_delta,
         ri.purchased_slots_after,
         ri.container,
         ri.container_id,
         ri.counterparty_copper_delta,
         ri.counterparty_count
    FROM row_input AS ri
    JOIN claimed AS c ON c.batch_key = ri.batch_key
   ORDER BY ri.batch_ordinal, ri.row_ordinal
  RETURNING id
),
verification AS (
  SELECT input.batch_ordinal,
         input.batch_key,
         claimed.batch_key IS NOT NULL AS newly_claimed,
         COALESCE(claimed.batch_key, existing.batch_key) AS stored_batch_key,
         COALESCE(claimed.realm, existing.realm) AS stored_realm,
         COALESCE(claimed.character_id, existing.character_id) AS stored_character_id,
         COALESCE(claimed.account_id, existing.account_id) AS stored_account_id,
         COALESCE(claimed.row_count, existing.row_count) AS stored_row_count,
         COALESCE(claimed.payload_sha256, existing.payload_sha256) AS stored_payload_sha256
    FROM receipt_input AS input
    LEFT JOIN claimed ON claimed.batch_key = input.batch_key
    LEFT JOIN existing_receipts AS existing
      ON existing.batch_key = input.batch_key AND claimed.batch_key IS NULL
)
SELECT verification.*,
       (SELECT count(*)::int FROM inserted) AS inserted_row_count
  FROM verification
 ORDER BY verification.batch_ordinal`;

function dbInteger(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function receiptVerificationFailed(batchKey: string): Error {
  return new Error(`bank ledger receipt verification failed for batch ${batchKey}`);
}

async function executePreparedWrite(
  tx: BankLedgerBatchQueryable,
  owner: BankLedgerBatchOwner,
  prepared: PreparedWrite,
): Promise<BankLedgerBatchWriteResult> {
  let result: Awaited<ReturnType<BankLedgerBatchQueryable['query']>>;
  try {
    result = await tx.query(WRITE_BANK_LEDGER_COMMAND_BATCHES_SQL, prepared.values);
  } catch (error) {
    throw bankLedgerGrowthLimitFromError(error) ?? error;
  }
  if (result.rows.length !== prepared.receipts.length) {
    throw new Error(
      `bank ledger receipt verification result count mismatch: expected ${prepared.receipts.length}, got ${result.rows.length}`,
    );
  }

  let expectedInsertedRows = 0;
  let reportedInsertedRows: number | null = null;
  let sawNew = false;
  const claims: BankLedgerBatchClaim[] = [];
  const alreadyCommittedPrefix: BankLedgerCommandBatch[] = [];
  for (let index = 0; index < prepared.receipts.length; index++) {
    const expected = prepared.receipts[index];
    const row = result.rows[index];
    const newlyClaimed = row.newly_claimed;
    const insertedRows = dbInteger(row.inserted_row_count);

    if (
      dbInteger(row.batch_ordinal) !== expected.ordinal ||
      row.batch_key !== expected.batchKey ||
      (newlyClaimed !== true && newlyClaimed !== false) ||
      row.stored_batch_key !== expected.batchKey ||
      row.stored_realm !== owner.realm ||
      dbInteger(row.stored_character_id) !== owner.characterId ||
      dbInteger(row.stored_account_id) !== owner.accountId ||
      dbInteger(row.stored_row_count) !== expected.rowCount ||
      row.stored_payload_sha256 !== expected.payloadSha256 ||
      insertedRows === null
    ) {
      throw receiptVerificationFailed(expected.batchKey);
    }

    if (newlyClaimed) {
      sawNew = true;
      expectedInsertedRows += expected.rowCount;
    } else {
      if (sawNew) {
        throw new Error(
          `bank ledger receipt ordering invalid: existing batch ${expected.batchKey} follows a new batch`,
        );
      }
      alreadyCommittedPrefix.push(expected.batch);
    }
    claims.push(
      Object.freeze({
        batch: expected.batch,
        newlyClaimed,
        guildEffect: expected.guildEffect,
      }),
    );
    if (reportedInsertedRows === null) reportedInsertedRows = insertedRows;
    else if (reportedInsertedRows !== insertedRows) {
      throw new Error('bank ledger inserted row count was inconsistent across receipts');
    }
  }

  if (reportedInsertedRows !== expectedInsertedRows) {
    throw new Error(
      `bank ledger inserted row count mismatch: expected ${expectedInsertedRows}, got ${reportedInsertedRows}`,
    );
  }
  return Object.freeze({
    batches: Object.freeze(claims),
    alreadyCommittedPrefix: Object.freeze(alreadyCommittedPrefix),
  });
}

/**
 * Persist one exact outbox prefix inside a caller-owned transaction.
 *
 * Validation is intentionally synchronous and happens before query() is
 * called. Any rejected verification means the caller MUST roll the transaction
 * back. A matching existing receipt is a lost-COMMIT retry and inserts no rows.
 */
export function writeBankLedgerCommandBatches(
  tx: BankLedgerBatchQueryable,
  owner: BankLedgerBatchOwner,
  batches: readonly BankLedgerCommandBatch[],
): Promise<BankLedgerBatchWriteResult> {
  const prepared = prepareWrite(owner, batches);
  if (prepared.receipts.length === 0) {
    return Promise.resolve(
      Object.freeze({ batches: Object.freeze([]), alreadyCommittedPrefix: Object.freeze([]) }),
    );
  }
  return executePreparedWrite(tx, owner, prepared);
}
