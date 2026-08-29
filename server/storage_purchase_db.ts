import { bankLedgerGrowthLimitFromError } from './bank_ledger_growth_budget';
import {
  createDbTransactionDeadline,
  type DbTransactionDeadlineClient,
} from './db_transaction_deadline';

// The pending-purchase table behind the Claudium storage flow (Bank Storage
// phase 11, server/storage_purchases.ts). One row per purchase attempt,
// keyed by the client-minted idempotency key, written and DURABLE before any
// money moves: the row is what makes a purchase recoverable across a dropped
// session or a process restart, queryable while the character is OFFLINE
// (which is exactly why this is a dedicated table and not character state).
//
// Status vocabulary (single-writer per key under the per-character mutex):
//   pending    - persisted; the spend outcome or the durable apply is still
//                open. Recovered by retrying the SAME key against the service.
//   applied    - legacy mixed-version state only. Current writers archive the
//                deletion-proof receipt and delete the operational row in the
//                character-save transaction.
//   unresolved - the spend debited but the apply-time re-check refused
//                (impossible-state territory: a bug or a restore from
//                backup). Never swept and never regressed; kept for
//                operator attention. Character and account deletion are
//                database-refused until support resolves/removes the case.
//                Never a clawback, never a partial apply.
//
// Applied purchases have a second, append-only receipt outside the character
// FK lifecycle. Closed operational rows still cascade when their parent is
// deleted, but the receipt keeps the original character id and purchase
// fingerprint so a recreated character can never replay the paid key. The
// character-save transaction writes the receipt, Claudium audit row, and
// operational-row deletion together. The archive trigger protects a
// mixed-version writer that still transitions a row to `applied`; the insert
// guard also makes that older writer fail closed on a consumed key it does not
// know how to query.
//
// The operational table is not a refusal log. A definitive no-debit outcome
// atomically deletes its pending row before the game reports the refusal. A
// failed or unconfirmed delete leaves the row pending and recovery retries it.
// This keeps ordinary service refusals at zero persistent rows and removes the
// need for a retention sweep or refusal-specific index.
//
// WHAT BOUNDS THE TABLE, status by status:
//   applied     removed from this operational table by the character-save
//               transaction. Its immutable receipt is bounded to at most the
//               whole ladder per character generation, but character churn
//               means receipt history is not globally constant-bounded. It is
//               paid exactly-once evidence, with the same deliberate
//               append-only growth posture as bank_ledger.
//   unresolved  database-capped together with pending at one OPEN row per
//               character. It keeps both storage-purchase rails closed until
//               support reconciles the confirmed debit.
//   pending     shares that one-open-row character cap. The bounded recovery
//               coordinator drives pending work while the character is online.
//
// ROLLBACK, and be precise about authority: the receipt is the durable
// exactly-once record. The in-blob appliedStorageKeys entry protects the live
// simulation apply, but a PRE-phase-11 server strips that field on its first
// save because its bank writer does not know the key. The receipt survives that
// blob rewrite and still refuses a hoarded-key replay. Keeping receipts forever
// is therefore the authority working, not a retention exception.
//
// The exact release base predates this table entirely, so rollback cannot
// delete these receipts. The database-level insert guard continues protecting
// consumed keys even while an older binary is running.
//
// `realm` is operator forensics only: character ids are globally unique
// across realms (characters.id is the one sequence), so recovery is
// deliberately realm-blind.

// Minimal structural seam over pg's Pool/PoolClient query surface (the
// play_session_retention_db.ts idiom), so every function here runs against
// the real pool, the zonky integration harness, and a fake alike.
interface Queryable {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

interface ConnectableQueryable extends Queryable {
  connect?: () => Promise<DbTransactionDeadlineClient>;
}

interface TransactionalQueryable extends Queryable {
  connect(): Promise<DbTransactionDeadlineClient>;
}

/** Stable shutdown cancellation for one non-transactional storage query. */
export class StoragePurchaseDbAborted extends Error {
  readonly code = 'STORAGE_PURCHASE_DB_ABORTED' as const;

  constructor(readonly operation: string) {
    super(`${operation} aborted`);
    this.name = 'AbortError';
  }
}

const pgErrorCode = (error: unknown): string | undefined =>
  (error as { code?: string } | null | undefined)?.code;

const errorForRelease = (error: unknown): Error =>
  error instanceof Error ? error : new Error('PostgreSQL storage purchase query failed');

/**
 * Acquire a pool client without leaking a cancelled waiter's eventual client.
 * Pool checkout has no cancellation API: if abort wins, reject immediately,
 * then destroy the client when the already-queued checkout eventually lands.
 */
function acquireStoragePurchaseClient(
  db: ConnectableQueryable,
  signal: AbortSignal,
  operation: string,
): Promise<DbTransactionDeadlineClient> {
  if (signal.aborted) return Promise.reject(new StoragePurchaseDbAborted(operation));
  if (typeof db.connect !== 'function') {
    return Promise.reject(
      new TypeError(`${operation} requires a connectable database when cancellation is enabled`),
    );
  }

  let checkout: Promise<DbTransactionDeadlineClient>;
  try {
    checkout = db.connect();
  } catch (error) {
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    let state: 'waiting' | 'aborted' | 'settled' = 'waiting';
    let abortError: StoragePurchaseDbAborted | null = null;
    const detach = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      if (state !== 'waiting') return;
      state = 'aborted';
      abortError = new StoragePurchaseDbAborted(operation);
      detach();
      reject(abortError);
    };

    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();

    void checkout.then(
      (client) => {
        if (state === 'aborted') {
          client.release(abortError ?? new StoragePurchaseDbAborted(operation));
          return;
        }
        state = 'settled';
        detach();
        resolve(client);
      },
      (error) => {
        if (state !== 'waiting') return;
        state = 'settled';
        detach();
        reject(error);
      },
    );
  });
}

/** The server-side ceiling for a shutdown-cancellable recovery statement.
 * Socket teardown makes the JavaScript caller settle promptly, but PostgreSQL
 * may not notice that disconnect while it is waiting on a lock. Lower the
 * checked-out session's statement timeout first so detached backend work has
 * its own deterministic bound too. */
export const STORAGE_PURCHASE_SIGNAL_STATEMENT_TIMEOUT_MS = 2_000;

/**
 * Run one auto-commit statement on an owned client. Abort evicts the client so
 * an in-flight protocol can never return to the pool. PostgreSQL can continue
 * server work briefly after socket teardown, so the session is first bounded
 * to STORAGE_PURCHASE_SIGNAL_STATEMENT_TIMEOUT_MS. A reusable client is
 * returned only after RESET restores its startup default; reset failure poisons
 * the client without replacing an already-known target result or SQLSTATE.
 */
async function storagePurchaseQuery(
  db: ConnectableQueryable,
  text: string,
  values: unknown[],
  operation: string,
  signal?: AbortSignal,
): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> {
  if (!signal) return db.query(text, values);
  const client = await acquireStoragePurchaseClient(db, signal, operation);
  let released = false;
  let causalError: Error | null = null;
  let clientErrorListenerAttached = false;
  let abortListenerAttached = false;

  const detach = () => {
    if (abortListenerAttached) {
      abortListenerAttached = false;
      signal.removeEventListener('abort', onAbort);
    }
    if (clientErrorListenerAttached) {
      clientErrorListenerAttached = false;
      client.removeListener('error', onClientError);
    }
  };
  const release = (error?: Error) => {
    if (released) return;
    released = true;
    detach();
    if (error) client.release(error);
    else client.release();
  };
  const onAbort = () => {
    if (released) return;
    causalError = new StoragePurchaseDbAborted(operation);
    release(causalError);
  };
  const onClientError = (error: Error) => {
    if (released) return;
    causalError = error;
    release(error);
  };

  client.on('error', onClientError);
  clientErrorListenerAttached = true;
  signal.addEventListener('abort', onAbort, { once: true });
  abortListenerAttached = true;
  if (signal.aborted) onAbort();

  try {
    if (released) throw causalError ?? new StoragePurchaseDbAborted(operation);
    try {
      await client.query(`SET statement_timeout = ${STORAGE_PURCHASE_SIGNAL_STATEMENT_TIMEOUT_MS}`);
    } catch (error) {
      if (causalError) throw causalError;
      // A failed SET can leave the session's GUC state unknown. Never reuse it.
      release(errorForRelease(error));
      throw error;
    }
    if (released) throw causalError ?? new StoragePurchaseDbAborted(operation);

    let result: { rows: Record<string, unknown>[]; rowCount: number | null };
    try {
      result = await client.query(text, values);
    } catch (error) {
      if (causalError) throw causalError;
      if (pgErrorCode(error) === undefined) {
        // A codeless driver failure may still have a response in flight.
        release(errorForRelease(error));
      } else {
        // A SQLSTATE means the auto-commit statement ended and the session is
        // idle. Preserve that primary error even if restoring the GUC fails.
        try {
          await client.query('RESET statement_timeout');
          release();
        } catch (resetError) {
          release(errorForRelease(resetError));
        }
      }
      throw error;
    }

    // The target auto-commit result is already authoritative. Cleanup failure
    // must discard only the client, never turn a known write into ambiguity.
    if (!released) {
      try {
        await client.query('RESET statement_timeout');
        release();
      } catch (resetError) {
        release(errorForRelease(resetError));
      }
    }
    return result;
  } finally {
    release();
  }
}

/** Three times the economy RPC timeout. A stale owner can be taken over, while
 * an ordinary five-second call cannot overlap a second cross-process spender. */
export const STORAGE_PURCHASE_SPEND_CLAIM_MS = 15_000;
export const STORAGE_APPLIED_EFFECT_MAX_PENDING = 1;
export const STORAGE_PURCHASE_TRANSACTION_TIMEOUT_MS = 15_000;
export const STORAGE_PURCHASE_TX_STATEMENT_TIMEOUT_MS = 15_000;
export const STORAGE_PURCHASE_TX_LOCK_TIMEOUT_MS = 2_000;
export const STORAGE_PURCHASE_TX_IDLE_TIMEOUT_MS = 2_000;
const STORAGE_PURCHASE_CLAIM_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Idempotent; applied by ensureSchema (server/db.ts) under the boot advisory
// lock. It also removes the feature branch's abandoned refusal history before
// installing the closed status constraint. The full character and account
// indexes support their FK cascades. The partial unique character index is
// paid-rail authority for both pending and unresolved work and the hot
// recovery access path: at most one open row can match.
export function storagePurchaseSchema(schemaName = 'public'): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(schemaName)) {
    throw new Error('storage purchase schema must be a simple lowercase identifier');
  }
  const schema = `"${schemaName}"`;
  return `
-- Capture the caller's IN-FLIGHT search_path (session default or the caller's
-- own SET LOCAL, whichever is live) before this fragment's SET LOCAL below.
-- The closing restore at the end of the fragment replays exactly this value,
-- so the fragment is transparent to the rest of the enclosing transaction.
-- Transaction-scoped (is_local = true): nothing here outlives COMMIT.
SELECT set_config(
  'woc.storage_purchase_prior_search_path',
  current_setting('search_path'),
  true
);
SET LOCAL search_path = "__woc_storage_purchase_schema__", pg_catalog, pg_temp;

CREATE TABLE IF NOT EXISTS storage_purchases (
  id BIGSERIAL PRIMARY KEY,
  realm TEXT NOT NULL,
  -- Both cascades remove CLOSED operational history, but the parent-table
  -- BEFORE DELETE guards below refuse while a pending or unresolved row
  -- records a possible or confirmed debit.
  -- This keeps ordinary character/account deletion available after resolution
  -- without letting a cascade erase the only recovery record. The full sibling
  -- indexes make the allowed cascades and the guard probes index-backed.
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  expected_cost_claudium INT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  spend_claim_token TEXT,
  spend_claim_expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
ALTER TABLE storage_purchases ADD COLUMN IF NOT EXISTS spend_claim_token TEXT;
ALTER TABLE storage_purchases ADD COLUMN IF NOT EXISTS spend_claim_expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS storage_purchases_character ON storage_purchases (character_id);
CREATE INDEX IF NOT EXISTS storage_purchases_account ON storage_purchases (account_id);
DROP INDEX IF EXISTS storage_purchases_character_pending;

-- One-time feature-branch migration. Steady-state boot reads only the catalog;
-- it never rescans a growing operational table for a value the closed
-- constraint already makes impossible.
DO $storage_purchase_status_constraint$
DECLARE
  status_constraint text;
  removed_refused bigint;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO status_constraint
    FROM pg_constraint
   WHERE conname = 'storage_purchases_status_allowed'
     AND conrelid = 'storage_purchases'::regclass;
  IF status_constraint IS NULL OR status_constraint LIKE '%refused%' THEN
    DELETE FROM storage_purchases WHERE status = 'refused';
    -- Production ships this table with the closed constraint, so only a dev
    -- database that ran the feature branch can hold refused rows; the ADD
    -- CONSTRAINT below validates existing rows and would abort boot on them.
    GET DIAGNOSTICS removed_refused = ROW_COUNT;
    IF removed_refused > 0 THEN
      RAISE NOTICE 'storage_purchases: removed % legacy refused row(s) before installing the closed status constraint',
        removed_refused;
    END IF;
    IF status_constraint IS NOT NULL THEN
      ALTER TABLE storage_purchases DROP CONSTRAINT storage_purchases_status_allowed;
    END IF;
    ALTER TABLE storage_purchases
      ADD CONSTRAINT storage_purchases_status_allowed
      CHECK (status IN ('pending', 'applied', 'unresolved'));
  END IF;
END;
$storage_purchase_status_constraint$;
DROP INDEX IF EXISTS storage_purchases_refused;

-- Cross-process paid-rail authority: another key cannot start while this
-- character has either a possibly-debited pending purchase or a confirmed
-- unresolved debit. Use a new name so a deployed pending-only index can never
-- pass behind IF NOT EXISTS. Multiple open rows fail boot loudly: only an
-- operator may reconcile paid evidence.
DO $storage_purchase_open_unique_guard$
DECLARE
  duplicate_character_id int;
  open_index_ready boolean;
BEGIN
  SELECT i.indisunique
         AND i.indisvalid
         AND i.indisready
         AND i.indrelid = 'storage_purchases'::regclass
         AND i.indnkeyatts = 1
         AND i.indnatts = 1
         AND i.indexprs IS NULL
         AND a.attname = 'character_id'
         AND am.amname = 'btree'
         AND opc.opcname = 'int4_ops'
         AND opcnsp.nspname = 'pg_catalog'
         AND pg_get_expr(i.indpred, i.indrelid) =
             '(status = ANY (ARRAY[''pending''::text, ''unresolved''::text]))'
    INTO open_index_ready
    FROM pg_index i
    JOIN pg_class index_rel ON index_rel.oid = i.indexrelid
    JOIN pg_am am ON am.oid = index_rel.relam
    LEFT JOIN pg_attribute a
      ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    LEFT JOIN pg_opclass opc ON opc.oid = i.indclass[0]
    LEFT JOIN pg_namespace opcnsp ON opcnsp.oid = opc.opcnamespace
   WHERE i.indexrelid = to_regclass('storage_purchases_one_open_per_character');
  IF NOT COALESCE(open_index_ready, false) THEN
    SELECT character_id INTO duplicate_character_id
      FROM "__woc_storage_purchase_schema__".storage_purchases
     WHERE status IN ('pending', 'unresolved')
     GROUP BY character_id
    HAVING count(*) > 1
     ORDER BY character_id
     LIMIT 1;
    IF duplicate_character_id IS NOT NULL THEN
      RAISE EXCEPTION 'multiple open storage purchases for character %',
        duplicate_character_id
        USING ERRCODE = '23505',
              HINT = 'Reconcile possibly-debited rows before restarting the server.';
    END IF;
    IF to_regclass('storage_purchases_one_open_per_character') IS NOT NULL THEN
      DROP INDEX storage_purchases_one_open_per_character;
    END IF;
  END IF;
END;
$storage_purchase_open_unique_guard$;
CREATE UNIQUE INDEX IF NOT EXISTS storage_purchases_one_open_per_character
  ON storage_purchases USING btree (character_id)
  WHERE status IN ('pending', 'unresolved');
-- Drop only after the stronger authority exists, so rollout never has a
-- window without a database-enforced character rail.
DROP INDEX IF EXISTS storage_purchases_one_pending_per_character;

DO $storage_purchase_claim_constraint$
DECLARE
  claim_constraint_ready boolean;
BEGIN
  SELECT c.convalidated
         AND c.contype = 'c'
         AND cardinality(c.conkey) = 2
         AND c.conkey @> ARRAY[token_col.attnum, expiry_col.attnum]::smallint[]
         AND pg_get_constraintdef(c.oid) LIKE '%spend_claim_token IS NULL%'
         AND pg_get_constraintdef(c.oid) LIKE '%spend_claim_expires_at IS NULL%'
         AND pg_get_constraintdef(c.oid) LIKE '%spend_claim_token IS NOT NULL%'
         AND pg_get_constraintdef(c.oid) LIKE '%spend_claim_expires_at IS NOT NULL%'
         AND pg_get_constraintdef(c.oid) LIKE '%-4[0-9a-f]{3}-%'
    INTO claim_constraint_ready
    FROM pg_constraint c
    JOIN pg_attribute token_col
      ON token_col.attrelid = c.conrelid AND token_col.attname = 'spend_claim_token'
    JOIN pg_attribute expiry_col
      ON expiry_col.attrelid = c.conrelid AND expiry_col.attname = 'spend_claim_expires_at'
   WHERE c.conname = 'storage_purchases_claim_pair'
     AND c.conrelid = 'storage_purchases'::regclass;
  IF NOT COALESCE(claim_constraint_ready, false) THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'storage_purchases_claim_pair'
         AND conrelid = 'storage_purchases'::regclass
    ) THEN
      ALTER TABLE storage_purchases DROP CONSTRAINT storage_purchases_claim_pair;
    END IF;
    ALTER TABLE storage_purchases
      ADD CONSTRAINT storage_purchases_claim_pair CHECK (
        (spend_claim_token IS NULL AND spend_claim_expires_at IS NULL)
        OR
        (spend_claim_token IS NOT NULL
         AND spend_claim_token ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         AND spend_claim_expires_at IS NOT NULL)
      );
  END IF;
END;
$storage_purchase_claim_constraint$;

-- Stable parent-delete guard. A fresh begin takes KEY SHARE on the account and
-- UPDATE on the character before inserting, while parent DELETE needs the
-- conflicting row locks before this VOLATILE trigger query runs. Therefore a
-- concurrent insert either commits first and is visible here, or loses its FK
-- parent and cannot insert. Account deletion is guarded directly, before its
-- AFTER-trigger cascades can choose an order between characters and purchases.
CREATE OR REPLACE FUNCTION guard_pending_storage_purchase_parent_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, "__woc_storage_purchase_schema__", pg_temp
AS $storage_purchase_parent_delete$
DECLARE
  pending_key text;
BEGIN
  IF TG_TABLE_NAME = 'characters' THEN
    SELECT idempotency_key INTO pending_key
      FROM "__woc_storage_purchase_schema__".storage_purchases
     WHERE character_id = OLD.id AND status IN ('pending', 'unresolved')
     LIMIT 1;
  ELSIF TG_TABLE_NAME = 'accounts' THEN
    SELECT idempotency_key INTO pending_key
      FROM "__woc_storage_purchase_schema__".storage_purchases
     WHERE account_id = OLD.id AND status IN ('pending', 'unresolved')
     LIMIT 1;
  ELSE
    RAISE EXCEPTION 'storage purchase delete guard attached to unexpected table %', TG_TABLE_NAME;
  END IF;

  IF pending_key IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55006',
      MESSAGE = 'storage_purchase_open',
      CONSTRAINT = 'storage_purchases_open_delete_guard';
  END IF;
  RETURN OLD;
END;
$storage_purchase_parent_delete$;

-- Paid-and-applied tombstones deliberately retain the original character id
-- as a scalar, not an FK. Account deletion still removes the account's entire
-- history, while character deletion cannot erase the exactly-once guard.
CREATE TABLE IF NOT EXISTS storage_purchase_applied_receipts (
  source_purchase_id BIGINT NOT NULL UNIQUE,
  realm TEXT NOT NULL,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  character_id INT NOT NULL,
  item_id TEXT NOT NULL,
  expected_cost_claudium INT NOT NULL,
  idempotency_key TEXT PRIMARY KEY,
  -- Null only on the one-time legacy backfill or a mixed-version trigger
  -- archive, whose historical before/after pair cannot be reconstructed.
  purchased_slots_before INT,
  purchased_slots_after INT,
  applied_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT storage_purchase_receipt_slot_progression CHECK (
    (purchased_slots_before IS NULL AND purchased_slots_after IS NULL)
    OR
    (purchased_slots_before IS NOT NULL AND purchased_slots_after IS NOT NULL
     AND purchased_slots_after > purchased_slots_before)
  )
);
CREATE INDEX IF NOT EXISTS storage_purchase_applied_receipts_account
  ON storage_purchase_applied_receipts (account_id);

CREATE TABLE IF NOT EXISTS storage_purchase_schema_migrations (
  name TEXT PRIMARY KEY,
  migrated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION archive_storage_purchase_applied_receipt()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, "__woc_storage_purchase_schema__", pg_temp
AS $storage_purchase_receipt$
BEGIN
  IF NEW.status <> 'applied' THEN
    RETURN NEW;
  END IF;
  -- Serialize mixed-release UPDATE-to-applied writers with current begin/save
  -- authority before probing or archiving the consumed key. An older UPDATE
  -- necessarily locks its child row before reaching this AFTER trigger, so a
  -- rare old/new interleave may deadlock and abort one transaction with 40P01;
  -- that is a fail-closed availability retry, never permission to weaken the
  -- key authority.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.idempotency_key, 0)
  );
  INSERT INTO "__woc_storage_purchase_schema__".storage_purchase_applied_receipts
    (source_purchase_id, realm, account_id, character_id, item_id,
     expected_cost_claudium, idempotency_key, applied_at)
  VALUES
    (NEW.id, NEW.realm, NEW.account_id, NEW.character_id, NEW.item_id,
     NEW.expected_cost_claudium, NEW.idempotency_key, COALESCE(NEW.resolved_at, now()))
  ON CONFLICT (idempotency_key) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
      FROM "__woc_storage_purchase_schema__".storage_purchase_applied_receipts receipt
     WHERE receipt.idempotency_key = NEW.idempotency_key
       AND receipt.source_purchase_id = NEW.id
       AND receipt.realm = NEW.realm
       AND receipt.account_id = NEW.account_id
       AND receipt.character_id = NEW.character_id
       AND receipt.item_id = NEW.item_id
       AND receipt.expected_cost_claudium = NEW.expected_cost_claudium
  ) THEN
    RAISE EXCEPTION 'storage purchase receipt fingerprint conflict for key %',
      NEW.idempotency_key USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$storage_purchase_receipt$;

-- Backfill exactly once. The marker and copy share ensureSchema's transaction,
-- so a failed copy rolls the marker back and the next boot safely retries.
DO $storage_purchase_receipt_migration$
DECLARE
  first_run bigint;
BEGIN
  INSERT INTO storage_purchase_schema_migrations (name)
  VALUES ('applied-receipts-v1')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS first_run = ROW_COUNT;

  IF first_run > 0 THEN
    INSERT INTO storage_purchase_applied_receipts
      (source_purchase_id, realm, account_id, character_id, item_id,
       expected_cost_claudium, idempotency_key, applied_at)
    SELECT p.id, p.realm, p.account_id, p.character_id, p.item_id,
           p.expected_cost_claudium, p.idempotency_key, COALESCE(p.resolved_at, now())
      FROM storage_purchases p
     WHERE p.status = 'applied'
    ON CONFLICT (idempotency_key) DO NOTHING;

    IF EXISTS (
      SELECT 1
        FROM storage_purchases p
        JOIN storage_purchase_applied_receipts receipt
          ON receipt.idempotency_key = p.idempotency_key
       WHERE p.status = 'applied'
         AND (receipt.source_purchase_id, receipt.realm, receipt.account_id,
              receipt.character_id, receipt.item_id, receipt.expected_cost_claudium)
             IS DISTINCT FROM
             (p.id, p.realm, p.account_id, p.character_id, p.item_id,
              p.expected_cost_claudium)
    ) THEN
      RAISE EXCEPTION 'storage purchase receipt backfill fingerprint conflict'
        USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$storage_purchase_receipt_migration$;

CREATE OR REPLACE FUNCTION guard_storage_purchase_consumed_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, "__woc_storage_purchase_schema__", pg_temp
AS $storage_purchase_guard$
BEGIN
  -- A pre-claim binary reaches this trigger without the ordered locks current
  -- begin takes. Acquire account -> character -> key here so its receipt probe
  -- gets a fresh snapshot after any conflicting receipt/delete transaction
  -- commits, and so parent deletion cannot invert the lock order.
  PERFORM 1 FROM "__woc_storage_purchase_schema__".accounts WHERE id = NEW.account_id FOR KEY SHARE;
  PERFORM 1 FROM "__woc_storage_purchase_schema__".characters WHERE id = NEW.character_id FOR UPDATE;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.idempotency_key, 0)
  );
  IF EXISTS (
    SELECT 1 FROM "__woc_storage_purchase_schema__".storage_purchase_applied_receipts
     WHERE idempotency_key = NEW.idempotency_key
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$storage_purchase_guard$;

-- Trigger creation is last so first-rollout relation locks are held for the
-- shortest interval. Steady-state boot is catalog-only: each exact definition
-- survives untouched, while a missing, disabled, or malformed trigger is
-- repaired once. tgtype constants are PostgreSQL's ROW/BEFORE/operation bits.
DO $storage_purchase_trigger_guard$
DECLARE
  trigger_ready boolean;
BEGIN
  SELECT t.tgrelid = 'characters'::regclass
         AND NOT t.tgisinternal
         AND t.tgenabled = 'O'
         AND t.tgfoid = to_regprocedure('guard_pending_storage_purchase_parent_delete()')
         AND t.tgnargs = 0
         AND octet_length(t.tgargs) = 0
         AND t.tgtype = 11
         AND t.tgattr::text = ''
         AND t.tgqual IS NULL
    INTO trigger_ready
    FROM pg_trigger t
   WHERE t.tgname = 'storage_purchase_guard_character_delete'
     AND t.tgrelid = 'characters'::regclass;
  IF NOT COALESCE(trigger_ready, false) THEN
    DROP TRIGGER IF EXISTS storage_purchase_guard_character_delete ON characters;
    CREATE TRIGGER storage_purchase_guard_character_delete
    BEFORE DELETE ON characters
    FOR EACH ROW
    EXECUTE FUNCTION guard_pending_storage_purchase_parent_delete();
  END IF;

  SELECT t.tgrelid = 'accounts'::regclass
         AND NOT t.tgisinternal
         AND t.tgenabled = 'O'
         AND t.tgfoid = to_regprocedure('guard_pending_storage_purchase_parent_delete()')
         AND t.tgnargs = 0
         AND octet_length(t.tgargs) = 0
         AND t.tgtype = 11
         AND t.tgattr::text = ''
         AND t.tgqual IS NULL
    INTO trigger_ready
    FROM pg_trigger t
   WHERE t.tgname = 'storage_purchase_guard_account_delete'
     AND t.tgrelid = 'accounts'::regclass;
  IF NOT COALESCE(trigger_ready, false) THEN
    DROP TRIGGER IF EXISTS storage_purchase_guard_account_delete ON accounts;
    CREATE TRIGGER storage_purchase_guard_account_delete
    BEFORE DELETE ON accounts
    FOR EACH ROW
    EXECUTE FUNCTION guard_pending_storage_purchase_parent_delete();
  END IF;

  SELECT t.tgrelid = 'storage_purchases'::regclass
         AND NOT t.tgisinternal
         AND t.tgenabled = 'O'
         AND t.tgfoid = to_regprocedure('guard_storage_purchase_consumed_key()')
         AND t.tgnargs = 0
         AND octet_length(t.tgargs) = 0
         AND t.tgtype = 7
         AND t.tgattr::text = ''
         AND t.tgqual IS NULL
    INTO trigger_ready
    FROM pg_trigger t
   WHERE t.tgname = 'storage_purchase_guard_consumed_key'
     AND t.tgrelid = 'storage_purchases'::regclass;
  IF NOT COALESCE(trigger_ready, false) THEN
    DROP TRIGGER IF EXISTS storage_purchase_guard_consumed_key ON storage_purchases;
    CREATE TRIGGER storage_purchase_guard_consumed_key
    BEFORE INSERT ON storage_purchases
    FOR EACH ROW
    EXECUTE FUNCTION guard_storage_purchase_consumed_key();
  END IF;

  SELECT t.tgrelid = 'storage_purchases'::regclass
         AND NOT t.tgisinternal
         AND t.tgenabled = 'O'
         AND t.tgfoid = to_regprocedure('archive_storage_purchase_applied_receipt()')
         AND t.tgnargs = 0
         AND octet_length(t.tgargs) = 0
         AND t.tgtype = 21
         AND t.tgattr::text = status_col.attnum::text
         AND t.tgqual IS NULL
    INTO trigger_ready
    FROM pg_trigger t
    JOIN pg_attribute status_col
      ON status_col.attrelid = t.tgrelid AND status_col.attname = 'status'
   WHERE t.tgname = 'storage_purchase_archive_applied'
     AND t.tgrelid = 'storage_purchases'::regclass;
  IF NOT COALESCE(trigger_ready, false) THEN
    DROP TRIGGER IF EXISTS storage_purchase_archive_applied ON storage_purchases;
    CREATE TRIGGER storage_purchase_archive_applied
    AFTER INSERT OR UPDATE OF status ON storage_purchases
    FOR EACH ROW
    EXECUTE FUNCTION archive_storage_purchase_applied_receipt();
  END IF;
END;
$storage_purchase_trigger_guard$;

-- SET LOCAL lasts until COMMIT, not statement end, so the fragment must put
-- back whatever search_path the caller had in effect when it began. TO DEFAULT
-- cannot do that (it resets to the SESSION default, dropping a caller's own
-- in-flight SET LOCAL), so the restore replays the value the fragment's first
-- statement captured. The transparency holds when the whole fragment runs in
-- one transaction with no intervening savepoint rollback: a rollback to a
-- savepoint taken before the capture DISCARDS it, after which current_setting
-- answers EMPTY STRING (or NULL / 42704 when never registered), and an
-- unguarded replay would silently SET search_path to empty. The replay
-- therefore reads with missing_ok and falls back to the session default (the
-- old TO DEFAULT behavior) when the capture is gone. Proven by the restore
-- and discarded-capture tests in tests/server/storage_purchase_db.pg.test.ts.
-- Transaction-scoped again, so nothing leaks past COMMIT.
SELECT set_config(
  'search_path',
  COALESCE(
    NULLIF(current_setting('woc.storage_purchase_prior_search_path', true), ''),
    (SELECT reset_val FROM pg_settings WHERE name = 'search_path')
  ),
  true
);
`.replaceAll('"__woc_storage_purchase_schema__"', schema);
}

export const STORAGE_PURCHASE_SCHEMA = storagePurchaseSchema();

export type StoragePurchaseStatus = 'pending' | 'applied' | 'unresolved';

export interface StoragePurchaseRow {
  id: number;
  realm: string;
  accountId: number;
  characterId: number;
  itemId: string;
  /** The client-declared cost persisted VERBATIM: the service fingerprint
   *  binds item, kind, and cost, so a recovery retry must replay the exact
   *  original number or the service would answer with the already_granted
   *  CONFLICT arm instead of the replay arm. Never a game-authored price. */
  expectedCostClaudium: number;
  idempotencyKey: string;
  status: StoragePurchaseStatus;
}

/** A paid slot grant staged on the live session until the character save that
 * carries its bank blob commits. The save transaction consumes this effect by
 * writing the immutable receipt and its one Claudium audit row, then removing
 * the operational pending row. */
export interface StorageAppliedEffect {
  realm: string;
  accountId: number;
  characterId: number;
  itemId: string;
  expectedCostClaudium: number;
  idempotencyKey: string;
  /** Opaque owner revalidated after service IO and before the synchronous grant. */
  spendClaimToken: string;
  purchasedSlotsBefore: number;
  purchasedSlotsAfter: number;
}

/** One character may have only one operational pending purchase. Mirror that
 * authority at every save seam before any SQL so corrupted/session-injected
 * queues cannot turn a character save into an unbounded transaction. */
export function assertStorageAppliedEffectBatch(effects: readonly StorageAppliedEffect[]): void {
  if (effects.length > STORAGE_APPLIED_EFFECT_MAX_PENDING) {
    throw new Error('storage applied effect queue exceeds one pending purchase');
  }
}

function rowFrom(r: Record<string, unknown>): StoragePurchaseRow {
  return {
    id: Number(r.id),
    realm: String(r.realm),
    accountId: Number(r.account_id),
    characterId: Number(r.character_id),
    itemId: String(r.item_id),
    expectedCostClaudium: Number(r.expected_cost_claudium),
    idempotencyKey: String(r.idempotency_key),
    status: String(r.status) as StoragePurchaseStatus,
  };
}

const RECEIPT_COLUMNS =
  'source_purchase_id, realm, account_id, character_id, item_id, expected_cost_claudium, ' +
  'idempotency_key, purchased_slots_before, purchased_slots_after';

function assertReceiptMatches(
  receipt: Record<string, unknown>,
  effect: StorageAppliedEffect,
): void {
  const before = receipt.purchased_slots_before;
  const after = receipt.purchased_slots_after;
  const legacyAuditUnknown = before === null && after === null;
  const hasAuditPair = before != null && after != null;
  const matches =
    String(receipt.realm) === effect.realm &&
    Number(receipt.account_id) === effect.accountId &&
    Number(receipt.character_id) === effect.characterId &&
    String(receipt.item_id) === effect.itemId &&
    Number(receipt.expected_cost_claudium) === effect.expectedCostClaudium &&
    String(receipt.idempotency_key) === effect.idempotencyKey &&
    (legacyAuditUnknown ||
      (hasAuditPair &&
        Number(before) === effect.purchasedSlotsBefore &&
        Number(after) === effect.purchasedSlotsAfter));
  if (!matches) {
    throw new Error(
      `storage purchase receipt fingerprint conflict for key ${effect.idempotencyKey}`,
    );
  }
}

function assertPendingMatches(
  row: StoragePurchaseRow,
  effect: StorageAppliedEffect,
  spendClaimToken: unknown,
): void {
  if (
    !STORAGE_PURCHASE_CLAIM_TOKEN_PATTERN.test(effect.spendClaimToken) ||
    row.status !== 'pending' ||
    row.realm !== effect.realm ||
    row.accountId !== effect.accountId ||
    row.characterId !== effect.characterId ||
    row.itemId !== effect.itemId ||
    row.expectedCostClaudium !== effect.expectedCostClaudium ||
    row.idempotencyKey !== effect.idempotencyKey ||
    String(spendClaimToken) !== effect.spendClaimToken
  ) {
    throw new Error(
      `storage purchase pending fingerprint conflict for key ${effect.idempotencyKey}`,
    );
  }
}

async function readAppliedReceipt(
  db: Queryable,
  idempotencyKey: string,
): Promise<Record<string, unknown> | null> {
  const res = await db.query(
    `SELECT ${RECEIPT_COLUMNS}
       FROM storage_purchase_applied_receipts
      WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  return res.rows[0] ?? null;
}

/**
 * Acquire parent-account key locks before an effect-bearing character write.
 * Account deletion locks the same parents before cascading to characters, so
 * taking these locks first preserves that lifecycle order and prevents a
 * character-update -> receipt-FK inversion from deadlocking with deletion.
 */
export async function lockStorageAppliedEffectAccountsOnClient(
  db: Queryable,
  effects: readonly StorageAppliedEffect[],
): Promise<void> {
  const accountIds = [...new Set(effects.map((effect) => effect.accountId))].sort((a, b) => a - b);
  if (accountIds.length === 0) return;

  const locked = await db.query(
    `SELECT id FROM accounts
      WHERE id = ANY($1::int[])
      ORDER BY id
      FOR KEY SHARE`,
    [accountIds],
  );
  const lockedIds = locked.rows.map((row) => Number(row.id));
  if (
    lockedIds.length !== accountIds.length ||
    lockedIds.some((accountId, index) => accountId !== accountIds[index])
  ) {
    throw new Error('storage purchase account disappeared before character save');
  }
}

/**
 * Write the durable effects that must commit with a character blob. The caller
 * owns BEGIN/COMMIT. A newly archived effect writes exactly one Claudium
 * bank_ledger row; a retry after an ambiguous COMMIT sees the matching receipt
 * and writes neither a second receipt nor a second audit row.
 */
export async function writeStorageAppliedEffectsOnClient(
  db: Queryable,
  effects: readonly StorageAppliedEffect[],
): Promise<void> {
  assertStorageAppliedEffectBatch(effects);
  const purchaseKeys = [...new Set(effects.map((effect) => effect.idempotencyKey))].sort();
  if (purchaseKeys.length > 0) {
    // `beginStoragePurchase` takes the same transaction-scoped key authority.
    // Batch acquisition keeps deterministic ordering without one extra round
    // trip per effect and closes the delete/receipt-vs-reinsert race.
    await db.query(
      `SELECT pg_advisory_xact_lock(hashtextextended(purchase_key, 0))
         FROM (
           SELECT unnest($1::text[]) AS purchase_key
           ORDER BY purchase_key
         ) ordered_purchase_keys`,
      [purchaseKeys],
    );
  }
  for (const effect of effects) {
    const existing = await readAppliedReceipt(db, effect.idempotencyKey);
    if (existing) {
      assertReceiptMatches(existing, effect);
      // Defense in depth for a mixed-release row inserted after the receipt.
      // Delete by the consumed key and OUR token, not the receipt's historical
      // source id. RETURNING lets a fingerprint mismatch throw and roll the
      // caller-owned transaction back, restoring rather than hiding evidence.
      const residue = await db.query(
        `DELETE FROM storage_purchases
          WHERE idempotency_key = $1 AND status = 'pending'
            AND spend_claim_token = $2
          RETURNING ${ROW_COLUMNS}, spend_claim_token`,
        [effect.idempotencyKey, effect.spendClaimToken],
      );
      if (residue.rows[0]) {
        assertPendingMatches(rowFrom(residue.rows[0]), effect, residue.rows[0].spend_claim_token);
      }
      continue;
    }

    const pendingResult = await db.query(
      `SELECT ${ROW_COLUMNS}, spend_claim_token
         FROM storage_purchases
        WHERE idempotency_key = $1
        FOR UPDATE`,
      [effect.idempotencyKey],
    );
    const pendingRaw = pendingResult.rows[0];
    if (!pendingRaw) {
      throw new Error(`storage purchase pending row missing for key ${effect.idempotencyKey}`);
    }
    const pending = rowFrom(pendingRaw);
    assertPendingMatches(pending, effect, pendingRaw.spend_claim_token);

    const inserted = await db.query(
      `INSERT INTO storage_purchase_applied_receipts
         (source_purchase_id, realm, account_id, character_id, item_id,
          expected_cost_claudium, idempotency_key, purchased_slots_before,
          purchased_slots_after, applied_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING source_purchase_id`,
      [
        pending.id,
        effect.realm,
        effect.accountId,
        effect.characterId,
        effect.itemId,
        effect.expectedCostClaudium,
        effect.idempotencyKey,
        effect.purchasedSlotsBefore,
        effect.purchasedSlotsAfter,
      ],
    );
    if (inserted.rows.length === 0) {
      const raced = await readAppliedReceipt(db, effect.idempotencyKey);
      if (!raced) {
        throw new Error(`storage purchase receipt insert lost for key ${effect.idempotencyKey}`);
      }
      assertReceiptMatches(raced, effect);
    } else {
      try {
        await db.query(
          `INSERT INTO bank_ledger
           (realm, character_id, account_id, op, item_id, count, instance,
            copper_delta, purchased_slots_after, container, container_id)
         VALUES ($1, $2, $3, 'buy_slots', $4, NULL, $5, 0, $6, 'personal', NULL)`,
          [
            effect.realm,
            effect.characterId,
            effect.accountId,
            effect.itemId,
            JSON.stringify({ paidWith: 'claudium' }),
            effect.purchasedSlotsAfter,
          ],
        );
      } catch (error) {
        throw bankLedgerGrowthLimitFromError(error) ?? error;
      }
    }

    const closed = await db.query(
      `DELETE FROM storage_purchases
        WHERE id = $1 AND idempotency_key = $2 AND status = 'pending'
          AND spend_claim_token = $3`,
      [pending.id, effect.idempotencyKey, effect.spendClaimToken],
    );
    if ((closed.rowCount ?? 0) !== 1) {
      throw new Error(`storage purchase pending close failed for key ${effect.idempotencyKey}`);
    }
  }
}

const ROW_COLUMNS =
  'id, realm, account_id, character_id, item_id, expected_cost_claudium, idempotency_key, status';

export interface StoragePurchaseBeginResult {
  inserted: boolean;
  existing: StoragePurchaseRow | null;
  /** A different key owns this character's pending-or-unresolved paid rail. */
  blockedByOpen?: StoragePurchaseRow;
}

async function readStoragePurchaseBeginConflict(
  db: Queryable,
  idempotencyKey: string,
  characterId: number,
): Promise<StoragePurchaseBeginResult | null> {
  const conflict = await db.query(
    `SELECT ${ROW_COLUMNS}, conflict_kind
       FROM (
         SELECT source_purchase_id AS id, realm, account_id, character_id, item_id,
                expected_cost_claudium, idempotency_key, 'applied'::text AS status,
                'same_key'::text AS conflict_kind, 0 AS source_rank
           FROM storage_purchase_applied_receipts
          WHERE idempotency_key = $1
         UNION ALL
         SELECT ${ROW_COLUMNS}, 'same_key'::text AS conflict_kind, 1 AS source_rank
           FROM storage_purchases
          WHERE idempotency_key = $1
         UNION ALL
         SELECT ${ROW_COLUMNS}, 'character_open'::text AS conflict_kind, 2 AS source_rank
           FROM storage_purchases
          WHERE character_id = $2
            AND status IN ('pending', 'unresolved')
            AND idempotency_key <> $1
       ) purchase_conflict
      ORDER BY source_rank
      LIMIT 1`,
    [idempotencyKey, characterId],
  );
  const recorded = conflict.rows[0];
  if (!recorded) return null;
  const parsed = rowFrom(recorded);
  return String(recorded.conflict_kind) === 'character_open'
    ? { inserted: false, existing: null, blockedByOpen: parsed }
    : { inserted: false, existing: parsed };
}

/** Persist the pending record, surface the row already holding the key, or
 *  identify the different open key that owns this character's paid rail.
 *  Returns { inserted: true } when this call created the row, else the
 *  existing row so the caller can distinguish a same-purchase retry from a
 *  cross-purchase key collision. Bare ON CONFLICT covers both unique
 *  authorities. The second query uses a fresh statement snapshot after any
 *  conflicting INSERT wait, so it can see the winning row. */
export async function beginStoragePurchase(
  db: TransactionalQueryable,
  row: {
    realm: string;
    accountId: number;
    characterId: number;
    itemId: string;
    expectedCostClaudium: number;
    idempotencyKey: string;
    claimToken: string;
  },
  signal?: AbortSignal,
): Promise<StoragePurchaseBeginResult> {
  const client = signal
    ? await acquireStoragePurchaseClient(db, signal, 'storage purchase begin checkout')
    : await db.connect();
  const transaction = createDbTransactionDeadline(client, {
    operation: 'storage purchase begin',
    timeoutMs: STORAGE_PURCHASE_TRANSACTION_TIMEOUT_MS,
    signal,
  });
  try {
    await transaction.query('BEGIN');
    // Bound each lock wait and an event-loop-stalled transaction before taking
    // any parent lock. PostgreSQL 16 has no transaction_timeout, so the three
    // ordered lock statements can still sum their individual two-second caps.
    await transaction.query(
      `SET LOCAL statement_timeout = ${STORAGE_PURCHASE_TX_STATEMENT_TIMEOUT_MS}; ` +
        `SET LOCAL lock_timeout = ${STORAGE_PURCHASE_TX_LOCK_TIMEOUT_MS}; ` +
        `SET LOCAL idle_in_transaction_session_timeout = ${STORAGE_PURCHASE_TX_IDLE_TIMEOUT_MS}`,
    );
    // Match the character-save lock order: parent account first, character
    // row second. The character lock serializes different keys for one paid
    // rail against both begin and the save transaction that archives/deletes
    // its pending row.
    await transaction.query('SELECT id FROM accounts WHERE id = $1 FOR KEY SHARE', [row.accountId]);
    await transaction.query('SELECT id FROM characters WHERE id = $1 FOR UPDATE', [
      row.characterId,
    ]);
    // Same-key attempts can name different characters. Serialize that key with
    // writeStorageAppliedEffectsOnClient too. The INSERT begins only after the
    // wait, so its statement snapshot sees any receipt committed by the saver.
    await transaction.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [
      row.idempotencyKey,
    ]);
    const ins = await transaction.query(
      `INSERT INTO storage_purchases
         (realm, account_id, character_id, item_id, expected_cost_claudium, idempotency_key,
          spend_claim_token, spend_claim_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
               now() + ($8 * interval '1 millisecond'))
       ON CONFLICT DO NOTHING
       RETURNING ${ROW_COLUMNS}`,
      [
        row.realm,
        row.accountId,
        row.characterId,
        row.itemId,
        row.expectedCostClaudium,
        row.idempotencyKey,
        row.claimToken,
        STORAGE_PURCHASE_SPEND_CLAIM_MS,
      ],
    );
    if (ins.rows.length > 0) {
      const result = { inserted: true, existing: rowFrom(ins.rows[0]) };
      await transaction.commit();
      return result;
    }

    // The conflict read is paid only by a retry. It has a fresh statement
    // snapshot after any ON CONFLICT wait, so a rolling-deploy writer that won
    // outside the locks is visible too.
    const raced = await readStoragePurchaseBeginConflict(
      transaction,
      row.idempotencyKey,
      row.characterId,
    );
    await transaction.commit();
    return raced ?? { inserted: false, existing: null };
  } catch (err) {
    await transaction.rollback();
    throw err;
  } finally {
    transaction.release();
  }
}

/** Pure lookup by the unique idempotency key (no insert): what the flow
 *  reads BEFORE validating a request, so a retry of a purchase that already
 *  settled (applied / unresolved) or that names a different fingerprint is
 *  answered from its recorded state instead of re-judged as a fresh one. */
export async function storagePurchaseByKey(
  db: ConnectableQueryable,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<StoragePurchaseRow | null> {
  const res = await storagePurchaseQuery(
    db,
    `SELECT ${ROW_COLUMNS}
       FROM (
         SELECT source_purchase_id AS id, realm, account_id, character_id, item_id,
                expected_cost_claudium, idempotency_key, 'applied'::text AS status,
                0 AS source_rank
           FROM storage_purchase_applied_receipts
          WHERE idempotency_key = $1
         UNION ALL
         SELECT ${ROW_COLUMNS}, 1 AS source_rank
           FROM storage_purchases
          WHERE idempotency_key = $1
       ) recorded_purchase
      ORDER BY source_rank
      LIMIT 1`,
    [idempotencyKey],
    'storage purchase key lookup',
    signal,
  );
  return res.rows[0] ? rowFrom(res.rows[0]) : null;
}

/** Acquire or renew the one cross-process outbound-spend lease. Expiry permits
 * takeover after a crashed owner; every post-service mutation still compares
 * the opaque token, so expiry alone never authorizes stale work. */
export async function claimStoragePurchaseSpend(
  db: ConnectableQueryable,
  idempotencyKey: string,
  claimToken: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const res = await storagePurchaseQuery(
    db,
    `UPDATE storage_purchases
        SET spend_claim_token = $2,
            spend_claim_expires_at = now() + ($3 * interval '1 millisecond')
      WHERE idempotency_key = $1 AND status = 'pending'
        AND (spend_claim_token IS NULL
             OR spend_claim_token = $2
             OR spend_claim_expires_at <= now())
      RETURNING id`,
    [idempotencyKey, claimToken, STORAGE_PURCHASE_SPEND_CLAIM_MS],
    'storage purchase spend claim',
    signal,
  );
  return (res.rowCount ?? res.rows.length) === 1;
}

/** Revalidate the same owner after service IO. Unlike acquisition this never
 * takes over an expired foreign token. */
export async function renewStoragePurchaseSpendClaim(
  db: ConnectableQueryable,
  idempotencyKey: string,
  claimToken: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const res = await storagePurchaseQuery(
    db,
    `UPDATE storage_purchases
        SET spend_claim_expires_at = now() + ($3 * interval '1 millisecond')
      WHERE idempotency_key = $1 AND status = 'pending'
        AND spend_claim_token = $2
      RETURNING id`,
    [idempotencyKey, claimToken, STORAGE_PURCHASE_SPEND_CLAIM_MS],
    'storage purchase spend claim renewal',
    signal,
  );
  return (res.rowCount ?? res.rows.length) === 1;
}

export async function releaseStoragePurchaseSpendClaim(
  db: ConnectableQueryable,
  idempotencyKey: string,
  claimToken: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const res = await storagePurchaseQuery(
    db,
    `UPDATE storage_purchases
        SET spend_claim_token = NULL, spend_claim_expires_at = NULL
      WHERE idempotency_key = $1 AND status = 'pending'
        AND spend_claim_token = $2`,
    [idempotencyKey, claimToken],
    'storage purchase spend claim release',
    signal,
  );
  return (res.rowCount ?? 0) === 1;
}

/** Move one purchase to a terminal (or, for 'unresolved', operator-facing)
 *  status. Guarded on the FROM set so a stale writer can never regress a
 *  settled row; returns whether a row actually moved. */
export async function settleStoragePurchase(
  db: ConnectableQueryable,
  idempotencyKey: string,
  status: 'applied' | 'unresolved',
  claimToken: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const res = await storagePurchaseQuery(
    db,
    `UPDATE storage_purchases
        SET status = $2,
            resolved_at = now(),
            spend_claim_token = NULL,
            spend_claim_expires_at = NULL
      WHERE idempotency_key = $1 AND status = 'pending'
        AND spend_claim_token = $3`,
    [idempotencyKey, status, claimToken],
    'storage purchase settlement',
    signal,
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Close a definitively no-debit purchase without retaining refusal history.
 * The guarded DELETE is the proof the caller needs before reporting the
 * service's refusal. false is deliberately ambiguous: recovery must re-read
 * rather than claiming the row is gone.
 */
export async function deletePendingStoragePurchaseWithoutDebit(
  db: ConnectableQueryable,
  idempotencyKey: string,
  claimToken: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const res = await storagePurchaseQuery(
    db,
    `DELETE FROM storage_purchases
      WHERE idempotency_key = $1 AND status = 'pending'
        AND spend_claim_token = $2`,
    [idempotencyKey, claimToken],
    'storage purchase no-debit discard',
    signal,
  );
  return (res.rowCount ?? 0) === 1;
}

/**
 * The login-recovery scan: the one pending purchase for one character. The
 * partial unique index supplies the predicate; the full sibling index remains
 * for the character FK cascade.
 */
export async function pendingStoragePurchasesForCharacter(
  db: ConnectableQueryable,
  characterId: number,
  signal?: AbortSignal,
): Promise<StoragePurchaseRow | null> {
  const res = await storagePurchaseQuery(
    db,
    `SELECT ${ROW_COLUMNS} FROM storage_purchases
      WHERE character_id = $1 AND status = 'pending'
      ORDER BY created_at, id
      LIMIT 1`,
    [characterId],
    'storage purchase pending scan',
    signal,
  );
  return res.rows[0] ? rowFrom(res.rows[0]) : null;
}

/** The database-authoritative paid rail, used at login to distinguish an
 * operator-held unresolved debit from recoverable pending work. This seam is
 * deliberately separate from pendingStoragePurchasesForCharacter: unresolved
 * rows must block both purchase rails but must never enter spend recovery. */
export async function openStoragePurchaseForCharacter(
  db: ConnectableQueryable,
  characterId: number,
  signal?: AbortSignal,
): Promise<StoragePurchaseRow | null> {
  const res = await storagePurchaseQuery(
    db,
    `SELECT ${ROW_COLUMNS} FROM storage_purchases
      WHERE character_id = $1 AND status IN ('pending', 'unresolved')
      ORDER BY created_at, id
      LIMIT 1`,
    [characterId],
    'storage purchase open scan',
    signal,
  );
  return res.rows[0] ? rowFrom(res.rows[0]) : null;
}
