// The ONE online authority for the Hearth Key travel cooldown (C01, refining
// D67). The clock belongs to the ACCOUNT: one row per account, keyed and
// foreign-keyed on accounts(id). Owning the Hearth Key item is inventory
// usability and nothing else, so no plot row, no character blob and no wire
// mirror may ever carry this cooldown. That is not tidiness. A plot is
// transferable and a character is deletable, so a cooldown living on either
// would let an account buy, sell or delete its way to a fresh ready key, and
// the second freehold (D67) shares this single row precisely so a second home
// cannot double the travel budget.
//
// The server Sim's freeholdKeyReadyAtMs mirror (never on the wire) is a
// committed value the sim may deny with locally, and never an authorization.
// The rule this module exists to serve is that every accepted
// remote entry re-reads and advances this row inside the entry transaction,
// under the account participant lock, so a cached or forged client value cannot
// buy a trip.
//
// PERFORMED SINCE 07a, on a LIT realm only: the remote Hearth trip
// (server/freehold_hearth_trip.ts) commits `advanceFreeholdHearthOnClient` in
// the same transaction as the character save that carries the trip, through
// the housing hook (server/freehold_mutation.ts), and a dark realm still never
// reaches it, so nothing writes account_freehold_hearth in a shipped realm
// while FREEHOLDS_ENABLED is off. The isolated per-Sim clock in
// src/sim/freehold/hearth_key.ts stays the offline and headless cooldown, and
// online it is a forward-only mirror the trip merges this row's value into: it
// may deny a use locally, it never admits one.
//
// TWO INVARIANTS every caller must keep:
//   1. ONE clock reading per accepted entry, taken from the DATABASE, after
//      the account participant lock. now() is the transaction timestamp on
//      purpose: two statements inside one accepted entry can never disagree
//      about when it happened, and no process clock enters the decision.
//   2. An accepted advance never DECREASES ready_at_ms or revision. GREATEST
//      plus a bare `revision + 1` are that guarantee in the statement itself,
//      so a regressed database clock can only make the key later, never
//      earlier and never eligible while it is unready.
//
// Refusals, an already-home no-op and the physical door do not advance the
// row: only an ACCEPTED remote entry does, and the advance commits with that
// entry or not at all (this module never opens or closes a transaction).
//
// Both counters are BIGINT and cross into TypeScript as decimal TEXT, never as
// a JS number: an epoch-milliseconds value plus a cooldown is comfortably
// inside 2^53 today, but every comparison and every sum here is BigInt so the
// module cannot silently start rounding if that ever stops being true.
import type { Pool } from 'pg';
import { FREEHOLD_WRITE_TOKEN_RE } from './freehold_claim_db';
import type { FreeholdQueryable } from './freehold_db';

/** Absent means READY, with the zero revision: an account that has never
 *  travelled has no row, and lazily writing one from a plain read would turn
 *  every status poll into a write. The one writer is the entry transaction.
 *
 *  NO PRODUCTION READER, and exported on purpose: `loadFreeholdHearth` answers
 *  the `absent` KIND rather than this value, and server/freehold_persist.ts
 *  duplicates the revision as a literal so a fake port bag needs no database
 *  module in its runtime graph. This is the DECLARATION of what absence means,
 *  which the pg suite asserts against, and the place a later reader learns that
 *  absent is ready rather than unknown. */
export const ABSENT_FREEHOLD_HEARTH: FreeholdHearthState = { readyAtMs: '0', revision: '0' };

/** A decimal, non-negative, canonically formatted BIGINT as PostgreSQL renders
 *  it. Leading zeros, a sign, or a float rendering means the column is not what
 *  this module believes it is, which is 'unsupported', never a usable value. */
const NON_NEGATIVE_BIGINT_TEXT = /^(0|[1-9][0-9]*)$/;

const bigintText = (value: unknown): string | null =>
  typeof value === 'string' && NON_NEGATIVE_BIGINT_TEXT.test(value) ? value : null;

/**
 * Idempotent DDL, applied by ensureSchema (server/db.ts) inside the boot
 * advisory-lock transaction. Parameterized on the schema so the real-PostgreSQL
 * suite can install it in a private schema; the identifier guard and the quoted
 * placeholder substitution are storagePurchaseSchema's, unchanged.
 *
 * Deliberately WITHOUT a SET LOCAL search_path ceremony, matching
 * server/freehold_db.ts: this fragment defines no function and no trigger, so
 * it needs no fixed execution path, and ensureSchema runs every fragment on ONE
 * client inside ONE transaction where a SET LOCAL search_path would leak into
 * every later fragment until explicitly replayed back. Qualifying the created
 * object and leaving the GUC alone is the smaller blast radius. `accounts`
 * stays unqualified for the same reason it does in maps_db.ts: the foreign key
 * must resolve through the applying connection's own search_path.
 */
export function freeholdHearthSchema(schemaName = 'public'): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(schemaName)) {
    throw new Error('freehold hearth schema must be a simple lowercase identifier');
  }
  const schema = `"${schemaName}"`;
  return `
-- The shared-account Hearth Key travel cooldown, one row per account.
-- account_id is BOTH the primary key and the foreign key, so the account
-- delete cascade is already index-backed and a second index would be dead
-- weight on a table that is only ever read and updated by exact key.
--
-- KEEP FOREVER: this table is deliberately EXEMPT from the retention sweep
-- (server/retention_sweep.ts) and has no age column to sweep on. Pruning an
-- idle account's row is not reclaiming garbage, it is handing every character
-- on that account a free ready key, which is the exact bypass the account-level
-- clock exists to close. The table is bounded by the account table itself:
-- at most one row per account, removed only when the account is.
CREATE TABLE IF NOT EXISTS "__woc_freehold_hearth_schema__".account_freehold_hearth (
  account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  ready_at_ms BIGINT NOT NULL DEFAULT 0,
  revision BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The per-advance token the ambiguous-COMMIT verify reads (07a): 16 random
  -- bytes as hex, written by the advance itself, so a verify that waited out a
  -- hung transaction can tell THAT attempt's advance from any other.
  advance_token TEXT
    CONSTRAINT account_freehold_hearth_advance_token_shape
    CHECK (advance_token IS NULL OR advance_token ~ '^[0-9a-f]{32}$'),
  CONSTRAINT account_freehold_hearth_ready_nonnegative CHECK (ready_at_ms >= 0),
  CONSTRAINT account_freehold_hearth_revision_nonnegative CHECK (revision >= 0)
);

-- The same column for a database whose table predates it. PROBED FIRST: an
-- ALTER TABLE takes ACCESS EXCLUSIVE before it ever checks IF NOT EXISTS, and
-- held through the rest of the boot transaction that lock would block every
-- other realm's Hearth reads, so an ordinary boot only reads the catalog. The
-- column's CHECK is probed by NAME too: a column that exists without it (added
-- by hand) gets it back NOT VALID, so every new token is checked again while
-- no boot scans the table to re-validate old rows (the advance only ever wrote
-- hex tokens).
DO $freehold_hearth_advance_token$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid = to_regclass('"__woc_freehold_hearth_schema__".account_freehold_hearth')
       AND attname = 'advance_token'
       AND NOT attisdropped
  ) THEN
    ALTER TABLE "__woc_freehold_hearth_schema__".account_freehold_hearth
      ADD COLUMN IF NOT EXISTS advance_token TEXT
      CONSTRAINT account_freehold_hearth_advance_token_shape
      CHECK (advance_token IS NULL OR advance_token ~ '^[0-9a-f]{32}$');
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
     WHERE conrelid = to_regclass('"__woc_freehold_hearth_schema__".account_freehold_hearth')
       AND conname = 'account_freehold_hearth_advance_token_shape'
       AND contype = 'c'
  ) THEN
    ALTER TABLE "__woc_freehold_hearth_schema__".account_freehold_hearth
      ADD CONSTRAINT account_freehold_hearth_advance_token_shape
      CHECK (advance_token IS NULL OR advance_token ~ '^[0-9a-f]{32}$') NOT VALID;
  END IF;
END;
$freehold_hearth_advance_token$;

`.replaceAll('"__woc_freehold_hearth_schema__"', schema);
}

export const FREEHOLD_HEARTH_SCHEMA = freeholdHearthSchema();

/** The durable cooldown, both counters as decimal BIGINT text. */
export interface FreeholdHearthState {
  readonly readyAtMs: string;
  readonly revision: string;
}

export type FreeholdHearthLoad =
  | { readonly kind: 'absent' }
  | { readonly kind: 'state'; readonly state: FreeholdHearthState }
  | { readonly kind: 'unsupported'; readonly detail: string };

/** The same structural refusal server/freehold_db.ts runs on every entry point,
 *  and for the same reason: a non-integer sent anyway raises 22P02 and aborts
 *  the CALLER's whole transaction, where a throw here costs it nothing it had
 *  not already broken. Unreachable from today's one production caller, which
 *  builds an owner key from the id first, and load-bearing for the 07a
 *  admission participant, which will run inside someone else's transaction.
 *  NOTE the class change it makes: a non-positive id used to run the query and
 *  answer `absent`, which reads as READY; it now throws. WHERE THAT THROW LANDS
 *  DEPENDS ON THE PORT, and only a coincidence keeps the two the same. On the
 *  two-port fallback the rejection reaches loadOnce, which converts it into an
 *  unadmitted HOLD. On the COMBINED port the clock read sits inside a `.catch`
 *  that carries a fault across as a value, so this throw alone would answer a
 *  cold clock and a normal login; the account is still held only because
 *  server/freehold_db.ts runs the IDENTICAL predicate on the row read first,
 *  outside that catch. The 07a participant, which runs inside someone else's
 *  transaction, is the caller this guard is really for. */
function requireHearthAccountId(accountId: number): void {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) {
    throw new RangeError('freehold hearth accountId must be a positive safe integer');
  }
}

/** One indexed primary-key read, and a READ ONLY one: a missing row is
 *  'absent' (ABSENT_FREEHOLD_HEARTH, ready at revision zero) and is NEVER
 *  created here. A row whose counters do not read back as non-negative BIGINT
 *  text is 'unsupported' rather than absence.
 *
 *  WHAT THAT KIND BUYS, stated exactly, because an earlier version of this line
 *  claimed it stops a damaged row granting a trip and it does not. This release
 *  normalizes 'unsupported' to the COLD clock with a WARN
 *  (server/freehold_hearth_load.ts), which is ready: the store's deliberate
 *  asymmetry is that the plot fails closed and the clock fails OPEN, and an
 *  unreadable clock is the case that asymmetry is about. The distinct kind buys
 *  the operator a named warning that the realm has outgrown a schema it is
 *  still reading, not a refusal. REFUSING THE TRIP IS 07a's JOB: the admission
 *  participant that lands there is the caller with a trip to refuse, and it
 *  must treat 'unsupported' as corrupt rather than as ready. Nothing writes
 *  this row in this release, so nothing acts on it yet. */
export async function loadFreeholdHearth(
  db: FreeholdQueryable,
  accountId: number,
): Promise<FreeholdHearthLoad> {
  requireHearthAccountId(accountId);
  const res = await db.query(
    `SELECT ready_at_ms::text AS ready_at_ms, revision::text AS revision
       FROM account_freehold_hearth
      WHERE account_id = $1`,
    [accountId],
  );
  const row = res.rows?.[0];
  if (row === undefined) return { kind: 'absent' };
  const readyAtMs = bigintText(row.ready_at_ms);
  const revision = bigintText(row.revision);
  if (readyAtMs === null || revision === null) {
    return {
      kind: 'unsupported',
      // CLASSIFIES, never identifies. Every detail on this module's refusals is
      // logged verbatim by the persistence store's warn port, and that channel
      // holds the same identity-free rule as the counters beside it: an
      // operator dashboard is entitled to know WHAT refused, not WHOSE.
      detail: 'hearth counters are not non-negative bigint text',
    };
  }
  return { kind: 'state', state: { readyAtMs, revision } };
}

export type FreeholdHearthAdvance =
  | {
      readonly kind: 'advanced';
      readonly readyAtMs: string;
      readonly revision: string;
      readonly nowMs: string;
    }
  | {
      readonly kind: 'cooldown';
      readonly readyAtMs: string;
      readonly revision: string;
      readonly nowMs: string;
    }
  /** A stored ready time past `now + cooldown`: no accepted advance can write
   *  that, so only a backward database clock step or a bad row produced it.
   *  Refused and written nothing (the rollout contract's fail-closed rule): the
   *  refusal does NOT unlock the key, which stays refused until the row is
   *  repaired, but it is counted and warned (trip_corrupt) instead of being
   *  honored silently, and no advance ever builds on the bad value. DEPLOY.md
   *  carries the operator's query and repair. */
  | {
      readonly kind: 'corrupt';
      readonly readyAtMs: string;
      readonly revision: string;
      readonly nowMs: string;
    }
  | { readonly kind: 'unsupported'; readonly detail: string };

/** Step 1. The account participant, taken FIRST so the epoch in step 3 is read
 *  under it and two entries on one account cannot both observe a ready key.
 *  FOR KEY SHARE, not FOR UPDATE: a concurrent character save takes FOR KEY
 *  SHARE on this same parent row, and FOR UPDATE here would block that save
 *  into its own lock timeout (the measured character_delete_db.ts finding).
 *  Two hearth entries still serialize, because KEY SHARE is not the lock that
 *  orders them: the FOR UPDATE row lock in step 3 is.
 *
 *  WHAT IT DOES BLOCK, measured rather than assumed, and the ordering rule the
 *  07a caller owes because of it. A transaction holding this lock does NOT block
 *  a concurrent FOR KEY SHARE (character save, character delete, bank ledger) or
 *  FOR NO KEY UPDATE (bank ledger save effects, general chat quota), and DOES
 *  block FOR UPDATE on the same account row for the life of the entry
 *  transaction: character_create_db.ts, maps_db.ts (twice), staff_db.ts and
 *  user_assets_db.ts each take that. There is no cycle among the four statements
 *  here, but the caller must take THIS lock before any lock those paths take
 *  first, and must not touch maps, user_assets, character creation or the admin
 *  roles after it, or the pair deadlocks. */
export const FREEHOLD_HEARTH_ACCOUNT_LOCK_SQL =
  'SELECT id FROM accounts WHERE id = $1 FOR KEY SHARE';

/** Step 2. Lazy, conflict-safe first-use initialization, and it lives HERE, in
 *  the admitted entry transaction, rather than in loadFreeholdHearth: a plain
 *  read must never write. */
export const FREEHOLD_HEARTH_INIT_SQL =
  'INSERT INTO account_freehold_hearth (account_id) VALUES ($1) ON CONFLICT (account_id) DO NOTHING';

/** Step 3. The counters and the ONE authoritative epoch, observed together,
 *  once, after the participant lock, under the row lock that orders concurrent
 *  entries on this account. now() is the transaction clock deliberately. */
export const FREEHOLD_HEARTH_READ_FOR_UPDATE_SQL = `SELECT ready_at_ms::text AS ready_at_ms,
       revision::text AS revision,
       (EXTRACT(EPOCH FROM now()) * 1000)::bigint::text AS now_ms,
       (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint::text AS clock_ms
  FROM account_freehold_hearth
 WHERE account_id = $1
   FOR UPDATE`;

/** Step 5. The monotonicity guarantee, in the statement: GREATEST can only
 *  push ready_at_ms forward and `revision + 1` can only count up, so an
 *  accepted advance under a regressed database clock makes the key later, never
 *  earlier. Exported so the real-PostgreSQL suite drives this exact text with a
 *  now_ms the eligibility guard above could never produce. */
export const FREEHOLD_HEARTH_ADVANCE_SQL = `UPDATE account_freehold_hearth
   SET ready_at_ms = GREATEST(ready_at_ms, $2::bigint + $3::bigint),
       revision = revision + 1,
       advance_token = $4,
       updated_at = now()
 WHERE account_id = $1
 RETURNING ready_at_ms::text AS ready_at_ms, revision::text AS revision`;

/** The ambiguous-COMMIT verify's read (07a, the touch-set manifest's P9). Plain
 *  on purpose: the verify first waits on the character row the hung
 *  transaction locked, so by the time this runs, as its own statement with a
 *  fresh snapshot, that transaction has resolved and a row it INSERTED (an
 *  account's first advance) is visible. A locked read of this row alone could
 *  not wait for an uncommitted insert. */
export const FREEHOLD_HEARTH_VERIFY_SQL = `SELECT advance_token, revision::text AS revision
  FROM account_freehold_hearth WHERE account_id = $1`;

/** Whether this attempt's advance is the one on the row, after the wait. */
export async function freeholdHearthAdvanceLandedOnClient(
  client: FreeholdQueryable,
  accountId: number,
  advanceToken: string,
): Promise<boolean> {
  requireHearthAccountId(accountId);
  const res = await client.query(FREEHOLD_HEARTH_VERIFY_SQL, [accountId]);
  return res.rows?.[0]?.advance_token === advanceToken;
}

/**
 * Check and advance the account's Hearth cooldown INSIDE the caller's already
 * open transaction, on the caller's client. It never issues BEGIN, COMMIT or
 * ROLLBACK, never sleeps and never retries: the caller owns the transaction,
 * its timeouts and its retry policy, and the advance commits with the accepted
 * entry or disappears with it.
 *
 * The statement order IS the contract: account participant lock, conflict-safe
 * initialization, locking read of the counters plus the single epoch, then
 * either a refusal that writes NOTHING or the monotone update.
 */
export async function advanceFreeholdHearthOnClient(
  client: FreeholdQueryable,
  accountId: number,
  cooldownMs: number,
  /** This attempt's token (16 random bytes as hex), stamped by the advance so
   *  an ambiguous COMMIT can be verified; null leaves the row's token NULL. */
  advanceToken: string | null = null,
): Promise<FreeholdHearthAdvance> {
  requireHearthAccountId(accountId);
  if (advanceToken !== null && !FREEHOLD_WRITE_TOKEN_RE.test(advanceToken)) {
    throw new RangeError('hearth advance token must be 32 lowercase hex characters');
  }
  if (!Number.isSafeInteger(cooldownMs) || cooldownMs < 0) {
    return {
      kind: 'unsupported',
      detail: `hearth cooldown ${String(cooldownMs)} is not a non-negative safe integer`,
    };
  }
  const account = await client.query(FREEHOLD_HEARTH_ACCOUNT_LOCK_SQL, [accountId]);
  if ((account.rows?.length ?? 0) === 0) {
    return { kind: 'unsupported', detail: 'the account row is absent' };
  }
  await client.query(FREEHOLD_HEARTH_INIT_SQL, [accountId]);
  const read = await client.query(FREEHOLD_HEARTH_READ_FOR_UPDATE_SQL, [accountId]);
  const row = read.rows?.[0];
  if (row === undefined) {
    return { kind: 'unsupported', detail: 'the hearth row vanished under lock' };
  }
  const readyAtMs = bigintText(row.ready_at_ms);
  const revision = bigintText(row.revision);
  const nowMs = bigintText(row.now_ms);
  // The CORRUPT test reads the wall clock at the read, never now(): now() is
  // this transaction's START, and a concurrent advance that began after it and
  // committed while this one waited for the row lock legitimately wrote a ready
  // time up to its own later start plus the cooldown. Against now() that
  // ordinary race would read as corrupt; against the clock after the wait it
  // cannot, while a backward clock step still does.
  const clockMs = bigintText(row.clock_ms);
  if (readyAtMs === null || revision === null || nowMs === null || clockMs === null) {
    return {
      kind: 'unsupported',
      detail: 'the hearth read is not non-negative bigint text',
    };
  }
  // BigInt, never Number: the comparison that decides a trip must not depend
  // on a float that happens to be exact today.
  if (BigInt(nowMs) < BigInt(readyAtMs)) {
    // Past the clock plus a whole cooldown is beyond anything an advance writes.
    if (BigInt(readyAtMs) - BigInt(clockMs) > BigInt(cooldownMs)) {
      return { kind: 'corrupt', readyAtMs, revision, nowMs };
    }
    return { kind: 'cooldown', readyAtMs, revision, nowMs };
  }
  const advanced = await client.query(FREEHOLD_HEARTH_ADVANCE_SQL, [
    accountId,
    nowMs,
    String(cooldownMs),
    advanceToken,
  ]);
  const updated = advanced.rows?.[0];
  const nextReadyAtMs = bigintText(updated?.ready_at_ms);
  const nextRevision = bigintText(updated?.revision);
  if (nextReadyAtMs === null || nextRevision === null) {
    return {
      kind: 'unsupported',
      detail: 'the hearth advance returned no usable row',
    };
  }
  return { kind: 'advanced', readyAtMs: nextReadyAtMs, revision: nextRevision, nowMs };
}

/** The subject-access read (exportAccountData): the account's one cooldown row,
 *  or null when it has never travelled. Counters ship as text for the same
 *  reason they are read as text everywhere else here. */
export async function freeholdHearthForExport(
  db: FreeholdQueryable,
  accountId: number,
): Promise<Record<string, unknown> | null> {
  const res = await db.query(
    `SELECT ready_at_ms::text AS ready_at_ms, revision::text AS revision, updated_at
       FROM account_freehold_hearth
      WHERE account_id = $1`,
    [accountId],
  );
  return res.rows?.[0] ?? null;
}
