// DURABLE HOUSING OPERATION IDENTITY (07a deliverable 3;
// docs/freeholds/mutation-touch-set-manifest.md P7, P8, P8c, P9): an INTENT row
// committed before any external spend, and a TERMINAL RECEIPT (the tombstone)
// committed in the same transaction as the operation's effect or its close.
//
// - The applied-identity guard is the receipts PRIMARY KEY: an apply or a close
//   inserts its receipt ON CONFLICT DO NOTHING and a zero-row answer refuses,
//   never a SELECT-then-INSERT. A closed id can never be prepared again.
// - Intents exist only while OPEN and are bounded per account
//   (FREEHOLD_OPERATION_OPEN_PER_ACCOUNT, exact under the per-account advisory
//   lock), so the table needs no sweep; every intent ends as a receipt, through
//   an apply or a close (`cancelled` / `refused`), so none blocks a deletion or
//   holds a cap slot forever.
// - An open intent BLOCKS character and account deletion (D88): a BEFORE DELETE
//   guard on both parents raises 55006 with a stable MESSAGE and CONSTRAINT,
//   and the parent keys are RESTRICT, so a missing guard still fails closed.
// - Receipts are KEEP FOREVER (permanent replay authority; no signed
//   replay-horizon evidence exists), observed by the receipts growth gauge. On
//   a TRUE account delete the account reference goes NULL and an erase trigger
//   nulls the plot id and the fingerprint with it.
//
// NO PRODUCTION KIND IS REGISTERED in this release (the scope statement at the
// head of docs/freeholds/mutation-touch-set-manifest.md; 08 registers the
// first): nothing outside the tests prepares an operation, so these tables stay empty
// in a shipped realm, and a dev path (the D81 fixture, the /dev set) never
// reaches this module (pinned by a source scan).
//
// Housing advisory locks use the TWO-int4 form with fixed housing class ids,
// a keyspace disjoint from storage's single-int8 idempotency-key locks and from
// every other advisory user, so no housing lock can collide with a legacy one.
import { createHash } from 'node:crypto';
import { FREEHOLD_GENERATION_TEXT_RE } from './freehold_claim_db';
import { FREEHOLD_PLOT_ID_RE, type FreeholdQueryable } from './freehold_db';
import { type FreeholdTxPool, runFreeholdTransaction } from './freehold_tx';

/** "FHA\x01": the per-account housing class (prepare, close). */
export const FREEHOLD_ADVISORY_ACCOUNT_CLASS = 0x46_48_41_01;
/** "FHO\x01": the per-operation housing class (prepare, apply, close). */
export const FREEHOLD_ADVISORY_OPERATION_CLASS = 0x46_48_4f_01;

/** The open intents one account may hold. Also the recovery pass's read limit,
 *  so ONE pass sees every intent an account can hold. */
export const FREEHOLD_OPERATION_OPEN_PER_ACCOUNT = 8;
/** The account export's receipt cap (the 07 export bound's shape). */
export const FREEHOLD_OPERATION_EXPORT_RECEIPT_LIMIT = 200;
/** The copy references one intent may carry (enforced here, never in DDL, so a
 *  later kind can raise it without relaxing a constraint the pins forbid). */
export const FREEHOLD_OPERATION_MAX_COPY_REFS = 64;

/** The guard's RAISE identity, interpolated into the DDL below. The 55006
 *  consumers match the CONSTRAINT exactly (parentDeleteGuardOf in
 *  server/character_delete_db.ts); the MESSAGE is the stable text a log line
 *  prints, never matched. */
export const FREEHOLD_OPERATION_OPEN_MESSAGE = 'freehold_operation_open';
export const FREEHOLD_OPERATION_OPEN_CONSTRAINT = 'freehold_operations_open_delete_guard';

const FREEHOLD_OPERATION_ID_RE = /^[A-Za-z0-9_:.-]{1,96}$/;
const FREEHOLD_OPERATION_KIND_RE = /^[a-z][a-z0-9_]{0,47}$/;
const FREEHOLD_OPERATION_FINGERPRINT_RE = /^[0-9a-f]{64}$/;

export type FreeholdOperationCloseOutcome = 'cancelled' | 'refused';
export type FreeholdOperationOutcome = 'applied' | FreeholdOperationCloseOutcome;

/** SHA-256 over the canonical request. Deliberately binds NO account or
 *  character id (the intent's columns bind those), so a fingerprint cannot be
 *  re-identified by hashing candidate ids, and a copy ref is an opaque
 *  item-copy identity, never an account or character id. */
export function freeholdOperationFingerprint(request: {
  readonly kind: string;
  readonly plotId: string | null;
  readonly copyRefs: readonly string[];
  readonly expectedDurableRev: string | null;
  readonly fenceGeneration: string | null;
  readonly payloadDigest: string;
}): string {
  const canonical = JSON.stringify([
    'freehold_operation/1',
    request.kind,
    request.plotId,
    [...request.copyRefs],
    request.expectedDurableRev,
    request.fenceGeneration,
    request.payloadDigest,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * The operation DDL, applied by ensureSchema right after the claim fragment.
 * It defines functions and triggers, so it carries the storage fragment's
 * search_path ceremony (server/storage_purchase_db.ts): capture the caller's
 * in-flight path, run under a fixed one, schema-qualify every function body,
 * pin each function's own path, and replay the captured value at the end.
 */
export function freeholdOperationSchema(schemaName = 'public'): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(schemaName)) {
    throw new Error('freehold operation schema must be a simple lowercase identifier');
  }
  const schema = `"${schemaName}"`;
  return `
SELECT set_config(
  'woc.freehold_operation_prior_search_path',
  current_setting('search_path'),
  true
);
-- pg_catalog is deliberately NOT named: unnamed, PostgreSQL searches it FIRST, so
-- a same-named function or operator in the target schema can never bind into a
-- CHECK or DEFAULT below, while unqualified CREATEs still land in the target
-- schema (named second, pg_catalog is searched after it and a decoy binds).
SET LOCAL search_path = "__woc_freehold_operation_schema__", pg_temp;

-- OPEN intents only: a row exists while its operation is open, and apply or
-- close deletes it. Bounded per account (the prepare cap), so it needs no
-- retention sweep. The parents are RESTRICT, never CASCADE: every row is open by
-- definition, so there is never a row a cascade should remove, and if the guard
-- trigger below is ever missing the foreign key still fails closed.
CREATE TABLE IF NOT EXISTS freehold_operations (
  operation_id TEXT PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  character_id INT REFERENCES characters(id) ON DELETE RESTRICT,
  plot_id TEXT,
  kind TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  copy_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  expected_durable_rev BIGINT,
  fence_generation BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT freehold_operations_id_shape CHECK (operation_id ~ '^[A-Za-z0-9_:.-]{1,96}$'),
  CONSTRAINT freehold_operations_plot_id_charset
    CHECK (plot_id IS NULL OR plot_id ~ '^[A-Za-z0-9_:-]{1,64}$'),
  CONSTRAINT freehold_operations_kind_shape CHECK (kind ~ '^[a-z][a-z0-9_]{0,47}$'),
  CONSTRAINT freehold_operations_fingerprint_shape CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT freehold_operations_copy_refs_array CHECK (jsonb_typeof(copy_refs) = 'array'),
  CONSTRAINT freehold_operations_expected_rev_positive
    CHECK (expected_durable_rev IS NULL OR expected_durable_rev >= 1),
  CONSTRAINT freehold_operations_fence_positive
    CHECK (fence_generation IS NULL OR fence_generation >= 1),
  -- A plot-scoped intent carries its fence and a plot-less one carries neither,
  -- so an apply can never compare a NULL fence and match nothing (or, compared
  -- laxly, everything).
  CONSTRAINT freehold_operations_plot_fence_pair CHECK (num_nonnulls(plot_id, fence_generation) <> 1),
  -- A revision is a plot's: a plot-less intent has none to expect.
  CONSTRAINT freehold_operations_rev_needs_plot
    CHECK (expected_durable_rev IS NULL OR plot_id IS NOT NULL)
);
-- PROBED FIRST (07a): a no-op CREATE INDEX IF NOT EXISTS still takes the
-- table's SHARE lock and holds it to the boot COMMIT, which would block every
-- other realm's housing writes through this realm's whole boot.
DO $freehold_operations_indexes$
BEGIN
  -- Recovery discovery, the per-account cap, the account guard and the export.
  IF to_regclass('freehold_operations_account') IS NULL THEN
CREATE INDEX IF NOT EXISTS freehold_operations_account
  ON freehold_operations (account_id, created_at);
  END IF;
  -- The character delete pre-read and its guard.
  IF to_regclass('freehold_operations_character') IS NULL THEN
CREATE INDEX IF NOT EXISTS freehold_operations_character
  ON freehold_operations (character_id) WHERE character_id IS NOT NULL;
  END IF;
END;
$freehold_operations_indexes$;

-- KEEP FOREVER, and deliberately exempt from the retention sweep
-- (server/retention_sweep.ts): a closed operation id is permanent replay
-- authority, and no signed replay-horizon evidence exists that would make
-- deleting one safe (deleting it would re-enable the operation). Growth is
-- observed by server/freehold_receipt_growth_monitor.ts instead. A scheduled
-- cascade waits on the accepted retention schedule (the "Counsel, Terms and
-- storefront model" gate); nothing deletes a receipt before it.
CREATE TABLE IF NOT EXISTS freehold_operation_receipts (
  operation_id TEXT PRIMARY KEY,
  account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  plot_id TEXT,
  kind TEXT NOT NULL,
  outcome TEXT NOT NULL,
  fingerprint TEXT,
  applied_durable_rev BIGINT,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT freehold_operation_receipts_id_shape
    CHECK (operation_id ~ '^[A-Za-z0-9_:.-]{1,96}$'),
  CONSTRAINT freehold_operation_receipts_plot_id_charset
    CHECK (plot_id IS NULL OR plot_id ~ '^[A-Za-z0-9_:-]{1,64}$'),
  CONSTRAINT freehold_operation_receipts_kind_shape CHECK (kind ~ '^[a-z][a-z0-9_]{0,47}$'),
  CONSTRAINT freehold_operation_receipts_outcome_shape CHECK (outcome ~ '^[a-z][a-z_]{0,31}$'),
  CONSTRAINT freehold_operation_receipts_fingerprint_shape
    CHECK (fingerprint IS NULL OR fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT freehold_operation_receipts_rev_positive
    CHECK (applied_durable_rev IS NULL OR applied_durable_rev >= 1),
  CONSTRAINT freehold_operation_receipts_rev_only_applied
    CHECK (applied_durable_rev IS NULL OR outcome = 'applied')
);
-- Leads with account_id, so it serves the SET NULL cascade; its order serves the
-- export's newest-first LIMIT without reading an account's whole history.
-- Probed first, for the same boot-lock reason as above.
DO $freehold_operation_receipts_index$
BEGIN
  IF to_regclass('freehold_operation_receipts_account') IS NULL THEN
CREATE INDEX IF NOT EXISTS freehold_operation_receipts_account
  ON freehold_operation_receipts (account_id, closed_at DESC, operation_id DESC)
  WHERE account_id IS NOT NULL;
  END IF;
END;
$freehold_operation_receipts_index$;

-- D88: an OPEN housing operation blocks deleting its character or account.
-- A prepare takes KEY SHARE on both parents before inserting, while a parent
-- DELETE needs the conflicting row lock before this VOLATILE trigger query
-- runs, so a concurrent prepare either committed first and is visible here or
-- loses its parent and cannot insert (the storage guard's argument).
CREATE OR REPLACE FUNCTION guard_open_freehold_operation_parent_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, "__woc_freehold_operation_schema__", pg_temp
AS $freehold_operation_parent_delete$
DECLARE
  open_operation text;
BEGIN
  IF TG_TABLE_NAME = 'characters' THEN
    SELECT operation_id INTO open_operation
      FROM "__woc_freehold_operation_schema__".freehold_operations
     WHERE character_id = OLD.id
     LIMIT 1;
  ELSIF TG_TABLE_NAME = 'accounts' THEN
    SELECT operation_id INTO open_operation
      FROM "__woc_freehold_operation_schema__".freehold_operations
     WHERE account_id = OLD.id
     LIMIT 1;
  ELSE
    RAISE EXCEPTION 'freehold operation delete guard attached to unexpected table %', TG_TABLE_NAME;
  END IF;

  IF open_operation IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55006',
      MESSAGE = '${FREEHOLD_OPERATION_OPEN_MESSAGE}',
      CONSTRAINT = '${FREEHOLD_OPERATION_OPEN_CONSTRAINT}';
  END IF;
  RETURN OLD;
END;
$freehold_operation_parent_delete$;

-- The erase half of a TRUE account delete. The SET NULL action is an UPDATE
-- that row triggers see, so when the account reference is NULL the plot id (a
-- public wire identity) and the fingerprint (a hash of the request) go with
-- it, and the tombstone keeps only what replay authority needs: the operation
-- id, kind, outcome, revision and time. Keyed on the NEW row alone, never on
-- the transition, so a later UPDATE of an already-erased tombstone cannot
-- write either column back. Only the body changed when it stopped watching the
-- transition: CREATE OR REPLACE keeps the function's oid, so the trigger probe
-- below still passes and a steady-state boot repairs nothing.
CREATE OR REPLACE FUNCTION erase_freehold_operation_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, "__woc_freehold_operation_schema__", pg_temp
AS $freehold_operation_receipt_erase$
BEGIN
  IF NEW.account_id IS NULL THEN
    NEW.plot_id := NULL;
    NEW.fingerprint := NULL;
  END IF;
  RETURN NEW;
END;
$freehold_operation_receipt_erase$;

-- Trigger creation is last. Steady-state boot is catalog-only: each exact
-- definition survives untouched, while a missing, disabled or malformed one is
-- repaired once (the storage probe; DROP TRIGGER IF EXISTS is the one sanctioned
-- reconcile). tgtype is PostgreSQL's ROW/BEFORE/operation bits: 11 is BEFORE
-- DELETE FOR EACH ROW, 19 is BEFORE UPDATE FOR EACH ROW.
DO $freehold_operation_trigger_guard$
DECLARE
  trigger_ready boolean;
BEGIN
  SELECT t.tgrelid = 'characters'::regclass
         AND NOT t.tgisinternal
         AND t.tgenabled = 'O'
         AND t.tgfoid = to_regprocedure('guard_open_freehold_operation_parent_delete()')
         AND t.tgnargs = 0
         AND octet_length(t.tgargs) = 0
         AND t.tgtype = 11
         AND t.tgattr::text = ''
         AND t.tgqual IS NULL
    INTO trigger_ready
    FROM pg_trigger t
   WHERE t.tgname = 'freehold_operation_guard_character_delete'
     AND t.tgrelid = 'characters'::regclass;
  IF NOT COALESCE(trigger_ready, false) THEN
    DROP TRIGGER IF EXISTS freehold_operation_guard_character_delete ON characters;
    CREATE TRIGGER freehold_operation_guard_character_delete
    BEFORE DELETE ON characters
    FOR EACH ROW
    EXECUTE FUNCTION guard_open_freehold_operation_parent_delete();
  END IF;

  SELECT t.tgrelid = 'accounts'::regclass
         AND NOT t.tgisinternal
         AND t.tgenabled = 'O'
         AND t.tgfoid = to_regprocedure('guard_open_freehold_operation_parent_delete()')
         AND t.tgnargs = 0
         AND octet_length(t.tgargs) = 0
         AND t.tgtype = 11
         AND t.tgattr::text = ''
         AND t.tgqual IS NULL
    INTO trigger_ready
    FROM pg_trigger t
   WHERE t.tgname = 'freehold_operation_guard_account_delete'
     AND t.tgrelid = 'accounts'::regclass;
  IF NOT COALESCE(trigger_ready, false) THEN
    DROP TRIGGER IF EXISTS freehold_operation_guard_account_delete ON accounts;
    CREATE TRIGGER freehold_operation_guard_account_delete
    BEFORE DELETE ON accounts
    FOR EACH ROW
    EXECUTE FUNCTION guard_open_freehold_operation_parent_delete();
  END IF;

  SELECT t.tgrelid = 'freehold_operation_receipts'::regclass
         AND NOT t.tgisinternal
         AND t.tgenabled = 'O'
         AND t.tgfoid = to_regprocedure('erase_freehold_operation_receipt()')
         AND t.tgnargs = 0
         AND octet_length(t.tgargs) = 0
         AND t.tgtype = 19
         AND t.tgattr::text = ''
         AND t.tgqual IS NULL
    INTO trigger_ready
    FROM pg_trigger t
   WHERE t.tgname = 'freehold_operation_receipt_erase'
     AND t.tgrelid = 'freehold_operation_receipts'::regclass;
  IF NOT COALESCE(trigger_ready, false) THEN
    DROP TRIGGER IF EXISTS freehold_operation_receipt_erase ON freehold_operation_receipts;
    CREATE TRIGGER freehold_operation_receipt_erase
    BEFORE UPDATE ON freehold_operation_receipts
    FOR EACH ROW
    EXECUTE FUNCTION erase_freehold_operation_receipt();
  END IF;
END;
$freehold_operation_trigger_guard$;

-- Put back whatever search_path the caller had in effect when this fragment
-- began (the storage fragment's replay, including its fallback to the session
-- default when a savepoint rollback discarded the capture).
SELECT set_config(
  'search_path',
  COALESCE(
    NULLIF(current_setting('woc.freehold_operation_prior_search_path', true), ''),
    (SELECT reset_val FROM pg_settings WHERE name = 'search_path')
  ),
  true
);
`.replaceAll('"__woc_freehold_operation_schema__"', schema);
}

export const FREEHOLD_OPERATION_SCHEMA = freeholdOperationSchema();

export interface FreeholdOperationIntent {
  readonly operationId: string;
  readonly accountId: number;
  readonly characterId: number | null;
  readonly plotId: string | null;
  readonly kind: string;
  readonly fingerprint: string;
  readonly copyRefs: readonly string[];
  readonly expectedDurableRev: string | null;
  readonly fenceGeneration: string | null;
}

export type FreeholdOperationPrepare =
  | { readonly kind: 'prepared' }
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'closed'; readonly outcome: string }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'capacity' }
  | { readonly kind: 'parent_missing' };

function requireId(name: string, id: number): number {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new RangeError(`freehold operation ${name} must be a positive safe integer`);
  }
  return id;
}

function requireMatch(name: string, value: string, re: RegExp): string {
  if (typeof value !== 'string' || !re.test(value)) {
    throw new RangeError(`freehold operation ${name} has the wrong shape`);
  }
  return value;
}

function requireRevOrNull(name: string, value: string | null): string | null {
  if (value === null) return null;
  return requireMatch(name, value, FREEHOLD_GENERATION_TEXT_RE);
}

function requireIntent(intent: FreeholdOperationIntent): FreeholdOperationIntent {
  requireMatch('id', intent.operationId, FREEHOLD_OPERATION_ID_RE);
  requireId('account id', intent.accountId);
  if (intent.characterId !== null) requireId('character id', intent.characterId);
  if (intent.plotId !== null) requireMatch('plot id', intent.plotId, FREEHOLD_PLOT_ID_RE);
  requireMatch('kind', intent.kind, FREEHOLD_OPERATION_KIND_RE);
  requireMatch('fingerprint', intent.fingerprint, FREEHOLD_OPERATION_FINGERPRINT_RE);
  if (
    !Array.isArray(intent.copyRefs) ||
    intent.copyRefs.length > FREEHOLD_OPERATION_MAX_COPY_REFS ||
    intent.copyRefs.some((ref) => typeof ref !== 'string' || ref === '' || ref.length > 128) ||
    new Set(intent.copyRefs).size !== intent.copyRefs.length
  ) {
    throw new RangeError('freehold operation copy refs must be distinct non-empty strings');
  }
  requireRevOrNull('expected durable revision', intent.expectedDurableRev);
  requireRevOrNull('fence generation', intent.fenceGeneration);
  if ((intent.plotId === null) !== (intent.fenceGeneration === null)) {
    throw new RangeError(
      'a plot-scoped freehold operation carries its fence, a plot-less one neither',
    );
  }
  if (intent.plotId === null && intent.expectedDurableRev !== null) {
    throw new RangeError('a plot-less freehold operation expects no plot revision');
  }
  return intent;
}

const FREEHOLD_OPERATION_ACCOUNT_LOCK_SQL = 'SELECT pg_advisory_xact_lock($1::int, $2::int)';
const FREEHOLD_OPERATION_ID_LOCK_SQL = 'SELECT pg_advisory_xact_lock($1::int, hashtext($2::text))';
export const FREEHOLD_OPERATION_RECEIPT_READ_SQL =
  'SELECT outcome, fingerprint, account_id FROM freehold_operation_receipts WHERE operation_id = $1';
export const FREEHOLD_OPERATION_INTENT_READ_SQL =
  'SELECT fingerprint, account_id FROM freehold_operations WHERE operation_id = $1';
export const FREEHOLD_OPERATION_OPEN_COUNT_SQL =
  'SELECT count(*)::int AS open FROM freehold_operations WHERE account_id = $1';
export const FREEHOLD_OPERATION_INSERT_SQL = `INSERT INTO freehold_operations
       (operation_id, account_id, character_id, plot_id, kind, fingerprint, copy_refs,
        expected_durable_rev, fence_generation)
VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::bigint, $9::bigint)
ON CONFLICT (operation_id) DO NOTHING
RETURNING operation_id`;

/** Prepare bounds: a short transaction on the request path. */
export const FREEHOLD_OPERATION_PREPARE_BOUNDS = Object.freeze({
  operation: 'freehold operation prepare',
  statementMs: 2_000,
  lockMs: 2_000,
  idleMs: 2_000,
  wallMs: 5_000,
});

/**
 * Commit an operation's intent (manifest P7), BEFORE any external spend, in its
 * own transaction: no client is held across whatever the caller does next.
 * G1 and G2 in KEY SHARE, then the account lock (the cap is exact under it),
 * then the operation lock, then the receipt, the existing intent and the cap.
 */
export async function prepareFreeholdOperation(
  pool: FreeholdTxPool,
  intent: FreeholdOperationIntent,
): Promise<FreeholdOperationPrepare> {
  const i = requireIntent(intent);
  return runFreeholdTransaction(pool, FREEHOLD_OPERATION_PREPARE_BOUNDS, async (tx) => {
    // A deactivated (soft-deleted) account starts nothing: its tombstones are
    // being erased, and a new intent would outlive the erase.
    const account = await tx.query(
      'SELECT id FROM accounts WHERE id = $1 AND deactivated_at IS NULL FOR KEY SHARE',
      [i.accountId],
    );
    if ((account.rowCount ?? 0) === 0) return { kind: 'parent_missing' } as const;
    if (i.characterId !== null) {
      const character = await tx.query(
        'SELECT id FROM characters WHERE id = $1 AND account_id = $2 FOR KEY SHARE',
        [i.characterId, i.accountId],
      );
      if ((character.rowCount ?? 0) === 0) return { kind: 'parent_missing' } as const;
    }
    await tx.query(FREEHOLD_OPERATION_ACCOUNT_LOCK_SQL, [
      FREEHOLD_ADVISORY_ACCOUNT_CLASS,
      i.accountId,
    ]);
    await tx.query(FREEHOLD_OPERATION_ID_LOCK_SQL, [
      FREEHOLD_ADVISORY_OPERATION_CLASS,
      i.operationId,
    ]);
    // An existing id answers only its OWN account's identical request: the
    // fingerprint binds no account (by design, above), so two accounts sending
    // the same canonical request under one id would otherwise read each other's
    // outcome or believe a foreign intent durable. An erased tombstone (a
    // deleted account) has no account and no fingerprint left: conflict.
    const ownedBy = (row: { account_id?: unknown }) =>
      row.account_id !== null && Number(row.account_id) === i.accountId;
    const receipt = await tx.query(FREEHOLD_OPERATION_RECEIPT_READ_SQL, [i.operationId]);
    const closed = receipt.rows[0] as
      | { outcome?: unknown; fingerprint?: unknown; account_id?: unknown }
      | undefined;
    if (closed) {
      return ownedBy(closed) && closed.fingerprint === i.fingerprint
        ? ({ kind: 'closed', outcome: String(closed.outcome) } as const)
        : ({ kind: 'conflict' } as const);
    }
    const existing = await tx.query(FREEHOLD_OPERATION_INTENT_READ_SQL, [i.operationId]);
    const open = existing.rows[0] as { fingerprint?: unknown; account_id?: unknown } | undefined;
    if (open) {
      return ownedBy(open) && open.fingerprint === i.fingerprint
        ? ({ kind: 'duplicate' } as const)
        : ({ kind: 'conflict' } as const);
    }
    const count = await tx.query(FREEHOLD_OPERATION_OPEN_COUNT_SQL, [i.accountId]);
    if (
      Number((count.rows[0] as { open?: unknown })?.open) >= FREEHOLD_OPERATION_OPEN_PER_ACCOUNT
    ) {
      return { kind: 'capacity' } as const;
    }
    const inserted = await tx.query(FREEHOLD_OPERATION_INSERT_SQL, [
      i.operationId,
      i.accountId,
      i.characterId,
      i.plotId,
      i.kind,
      i.fingerprint,
      JSON.stringify(i.copyRefs),
      i.expectedDurableRev,
      i.fenceGeneration,
    ]);
    return (inserted.rowCount ?? 0) === 1
      ? ({ kind: 'prepared' } as const)
      : ({ kind: 'duplicate' } as const);
  });
}

export type FreeholdOperationApplyRefusal =
  | 'missing'
  /** The intent belongs to another account than the caller locked and named. */
  | 'account'
  | 'already_closed'
  | 'fingerprint'
  /** The apply names another plot than the intent was prepared for. */
  | 'plot'
  | 'fence'
  | 'expected_rev';

export const FREEHOLD_OPERATION_INTENT_LOCK_SQL = `SELECT account_id, plot_id, kind, fingerprint,
       expected_durable_rev::text AS expected_durable_rev,
       fence_generation::text AS fence_generation
  FROM freehold_operations WHERE operation_id = $1 FOR UPDATE`;
/** The receipt, written ALREADY ERASED when its account was soft-deleted: the
 *  account row is read under the G1 KEY SHARE every receipt writer holds, which
 *  the soft-delete erase's FOR UPDATE conflicts with, so a receipt either
 *  commits before the erase (and the erase nulls it) or reads the deactivation
 *  and is written nonidentifying. */
export const FREEHOLD_OPERATION_RECEIPT_INSERT_SQL = `INSERT INTO freehold_operation_receipts
       (operation_id, account_id, plot_id, kind, outcome, fingerprint, applied_durable_rev)
SELECT $1,
       CASE WHEN a.deactivated_at IS NULL THEN a.id END,
       CASE WHEN a.deactivated_at IS NULL THEN $3 END,
       $4, $5,
       CASE WHEN a.deactivated_at IS NULL THEN $6 END,
       $7::bigint
  FROM accounts a
 WHERE a.id = $2
ON CONFLICT (operation_id) DO NOTHING
RETURNING operation_id`;
export const FREEHOLD_OPERATION_DELETE_SQL =
  'DELETE FROM freehold_operations WHERE operation_id = $1';

/**
 * Close an open intent INSIDE the caller's transaction: the operation lock, the
 * intent FOR UPDATE with its bindings checked, the receipt insert (the unique
 * guard) and the intent delete. Used by the apply hook (outcome `applied`, in
 * the transaction that commits the effect) and by cancelFreeholdOperation.
 * Answers null on success, else the refusal; a refusal has written nothing
 * the caller's rollback would not remove.
 */
export async function closeFreeholdOperationOnClient(
  tx: FreeholdQueryable,
  close: {
    readonly operationId: string;
    /** The account the caller locked at G1 for this close: the intent must be
     *  its, or the receipt's foreign-key check would take another account's
     *  lock after the operation locks (the order the manifest forbids). */
    readonly accountId: number;
    readonly fingerprint: string;
    readonly outcome: FreeholdOperationOutcome;
    /** Checked only for an apply: the plot, fence and revision it was prepared
     *  under. */
    readonly plotId?: string | null;
    readonly fenceGeneration?: string | null;
    readonly expectedDurableRev?: string | null;
    readonly appliedDurableRev?: string | null;
  },
): Promise<FreeholdOperationApplyRefusal | null> {
  requireMatch('id', close.operationId, FREEHOLD_OPERATION_ID_RE);
  requireId('account id', close.accountId);
  requireMatch('fingerprint', close.fingerprint, FREEHOLD_OPERATION_FINGERPRINT_RE);
  await tx.query(FREEHOLD_OPERATION_ID_LOCK_SQL, [
    FREEHOLD_ADVISORY_OPERATION_CLASS,
    close.operationId,
  ]);
  const locked = await tx.query(FREEHOLD_OPERATION_INTENT_LOCK_SQL, [close.operationId]);
  const intent = locked.rows?.[0] as
    | {
        account_id?: unknown;
        plot_id?: unknown;
        kind?: unknown;
        fingerprint?: unknown;
        expected_durable_rev?: unknown;
        fence_generation?: unknown;
      }
    | undefined;
  if (!intent) {
    const receipt = await tx.query(FREEHOLD_OPERATION_RECEIPT_READ_SQL, [close.operationId]);
    return (receipt.rows?.length ?? 0) > 0 ? 'already_closed' : 'missing';
  }
  if (Number(intent.account_id) !== close.accountId) return 'account';
  if (intent.fingerprint !== close.fingerprint) return 'fingerprint';
  if (close.outcome === 'applied') {
    // NULL-EXPLICIT: a plot-scoped intent has a fence (the pair CHECK), so a
    // NULL here matches only a plot-less intent's NULL, never a real fence.
    const preparedFence =
      typeof intent.fence_generation === 'string' ? intent.fence_generation : null;
    const preparedRev =
      typeof intent.expected_durable_rev === 'string' ? intent.expected_durable_rev : null;
    const preparedPlot = typeof intent.plot_id === 'string' ? intent.plot_id : null;
    if (preparedPlot !== (close.plotId ?? null)) return 'plot';
    if (preparedFence !== (close.fenceGeneration ?? null)) return 'fence';
    if (preparedRev !== (close.expectedDurableRev ?? null)) return 'expected_rev';
  }
  const receipt = await tx.query(FREEHOLD_OPERATION_RECEIPT_INSERT_SQL, [
    close.operationId,
    intent.account_id,
    intent.plot_id ?? null,
    intent.kind,
    close.outcome,
    close.fingerprint,
    requireRevOrNull('applied durable revision', close.appliedDurableRev ?? null),
  ]);
  if ((receipt.rowCount ?? 0) !== 1) return 'already_closed';
  await tx.query(FREEHOLD_OPERATION_DELETE_SQL, [close.operationId]);
  return null;
}

/** Close an intent that will never apply (manifest P8c), in its own short
 *  transaction: the account lock first (the prepare cap's), then the close. */
export async function cancelFreeholdOperation(
  pool: FreeholdTxPool,
  cancel: {
    readonly operationId: string;
    readonly accountId: number;
    readonly fingerprint: string;
    readonly outcome: FreeholdOperationCloseOutcome;
  },
): Promise<FreeholdOperationApplyRefusal | null> {
  requireId('account id', cancel.accountId);
  return runFreeholdTransaction(
    pool,
    { ...FREEHOLD_OPERATION_PREPARE_BOUNDS, operation: 'freehold operation close' },
    async (tx) => {
      // G1 FIRST, as the prepare takes it: the receipt insert's foreign-key
      // check would otherwise take this account's KEY SHARE after the advisory
      // and intent locks, a cycle against an account delete if a guard were
      // ever missing.
      const account = await tx.query('SELECT id FROM accounts WHERE id = $1 FOR KEY SHARE', [
        cancel.accountId,
      ]);
      if ((account.rowCount ?? 0) === 0) return 'missing' as const;
      await tx.query(FREEHOLD_OPERATION_ACCOUNT_LOCK_SQL, [
        FREEHOLD_ADVISORY_ACCOUNT_CLASS,
        cancel.accountId,
      ]);
      return closeFreeholdOperationOnClient(tx, {
        operationId: cancel.operationId,
        accountId: cancel.accountId,
        fingerprint: cancel.fingerprint,
        outcome: cancel.outcome,
      });
    },
  );
}

export interface OpenFreeholdOperation {
  readonly operationId: string;
  readonly accountId: number;
  readonly characterId: number | null;
  readonly plotId: string | null;
  readonly kind: string;
  readonly fingerprint: string;
  readonly copyRefs: readonly string[];
  readonly expectedDurableRev: string | null;
  readonly fenceGeneration: string | null;
}

export const FREEHOLD_OPERATION_DISCOVER_SQL = `SELECT operation_id, account_id, character_id, plot_id, kind,
       fingerprint, copy_refs,
       expected_durable_rev::text AS expected_durable_rev,
       fence_generation::text AS fence_generation
  FROM freehold_operations
 WHERE account_id = $1
 ORDER BY created_at, operation_id
 LIMIT $2`;

/** Recovery discovery: ONE account's open intents through the account index,
 *  at most the cap, never a whole-table scan. */
export async function openFreeholdOperationsForAccount(
  db: FreeholdQueryable,
  accountId: number,
): Promise<OpenFreeholdOperation[]> {
  const res = await db.query(FREEHOLD_OPERATION_DISCOVER_SQL, [
    requireId('account id', accountId),
    FREEHOLD_OPERATION_OPEN_PER_ACCOUNT,
  ]);
  return (res.rows ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      operationId: String(r.operation_id),
      accountId: Number(r.account_id),
      characterId: r.character_id === null ? null : Number(r.character_id),
      plotId: typeof r.plot_id === 'string' ? r.plot_id : null,
      kind: String(r.kind),
      fingerprint: String(r.fingerprint),
      copyRefs: Array.isArray(r.copy_refs) ? (r.copy_refs as unknown[]).map(String) : [],
      expectedDurableRev:
        typeof r.expected_durable_rev === 'string' ? r.expected_durable_rev : null,
      fenceGeneration: typeof r.fence_generation === 'string' ? r.fence_generation : null,
    };
  });
}

/** The verify's operation read (manifest P9), issued after the verify's lock on
 *  the character row waited out the hung transaction: landed iff the intent is
 *  gone and a receipt holds the id. */
export async function freeholdOperationClosedOnClient(
  tx: FreeholdQueryable,
  operationId: string,
): Promise<{ readonly open: boolean; readonly outcome: string | null }> {
  requireMatch('id', operationId, FREEHOLD_OPERATION_ID_RE);
  const intent = await tx.query('SELECT 1 FROM freehold_operations WHERE operation_id = $1', [
    operationId,
  ]);
  const receipt = await tx.query(FREEHOLD_OPERATION_RECEIPT_READ_SQL, [operationId]);
  const row = receipt.rows?.[0] as { outcome?: unknown } | undefined;
  return {
    open: (intent.rows?.length ?? 0) > 0,
    outcome: typeof row?.outcome === 'string' ? row.outcome : null,
  };
}

/** The account export's operation rows: explicit ALLOWLISTS. The fingerprint
 *  and the fence generation are server internals and never leave the server;
 *  receipts are keep-forever, so they are capped, newest first, with the 07
 *  truncation marker. */
export const FREEHOLD_OPERATION_EXPORT_INTENTS_SQL = `SELECT operation_id, kind, character_id, plot_id,
       copy_refs, expected_durable_rev::text AS expected_durable_rev, created_at
  FROM freehold_operations WHERE account_id = $1 ORDER BY created_at, operation_id`;
export const FREEHOLD_OPERATION_EXPORT_RECEIPTS_SQL = `SELECT operation_id, kind, outcome, plot_id,
       applied_durable_rev::text AS applied_durable_rev, closed_at
  FROM freehold_operation_receipts WHERE account_id = $1
 ORDER BY closed_at DESC, operation_id DESC
 LIMIT $2`;

export async function freeholdOperationsForExport(
  db: FreeholdQueryable,
  accountId: number,
): Promise<{ intents: unknown[]; receipts: unknown[] }> {
  requireId('account id', accountId);
  const intents = await db.query(FREEHOLD_OPERATION_EXPORT_INTENTS_SQL, [accountId]);
  // One past the limit, so the marker says "there is more" only when there is.
  const receipts = await db.query(FREEHOLD_OPERATION_EXPORT_RECEIPTS_SQL, [
    accountId,
    FREEHOLD_OPERATION_EXPORT_RECEIPT_LIMIT + 1,
  ]);
  const receiptRows = (receipts.rows ?? []).slice(0, FREEHOLD_OPERATION_EXPORT_RECEIPT_LIMIT);
  if ((receipts.rows?.length ?? 0) > FREEHOLD_OPERATION_EXPORT_RECEIPT_LIMIT) {
    receiptRows.push({ truncated: true, limit: FREEHOLD_OPERATION_EXPORT_RECEIPT_LIMIT });
  }
  return { intents: intents.rows ?? [], receipts: receiptRows };
}

/** The SOFT-delete erase (the touch-set manifest's section 8): account
 *  deactivation fires no cascade, so it nulls the account's tombstone
 *  references itself, the deleteAccountAttribution precedent beside it. The
 *  UPDATE fires the erase trigger, so each tombstone keeps only replay authority
 *  (operation id, kind, outcome, revision, time). Through the receipts account
 *  index; bounded by the account's own history. */
export const FREEHOLD_OPERATION_RECEIPTS_ERASE_SQL =
  'UPDATE freehold_operation_receipts SET account_id = NULL WHERE account_id = $1';
/** The account row FOR UPDATE first: the only row lock that conflicts with the
 *  G1 KEY SHARE every receipt writer holds, so a receipt writer already in
 *  flight finishes before the erase reads, and the erase's UPDATE (a fresh
 *  snapshot after that wait) sees and nulls it. */
const FREEHOLD_OPERATION_ERASE_ACCOUNT_LOCK_SQL = 'SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE';

export const FREEHOLD_OPERATION_ERASE_BOUNDS = Object.freeze({
  operation: 'freehold receipt erase',
  statementMs: 15_000,
  lockMs: 5_000,
  idleMs: 2_000,
  wallMs: 30_000,
});

export async function eraseFreeholdOperationReceiptsForAccount(
  pool: FreeholdTxPool,
  accountId: number,
): Promise<number> {
  const id = requireId('account id', accountId);
  return runFreeholdTransaction(pool, FREEHOLD_OPERATION_ERASE_BOUNDS, async (tx) => {
    await tx.query(FREEHOLD_OPERATION_ERASE_ACCOUNT_LOCK_SQL, [id]);
    const res = await tx.query(FREEHOLD_OPERATION_RECEIPTS_ERASE_SQL, [id]);
    return res.rowCount ?? 0;
  });
}
