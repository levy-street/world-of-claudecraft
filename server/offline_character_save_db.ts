// The OFFLINE character-blob write, extracted whole from server/db.ts at the
// Phase 18 database review (the monolith ratchet: db.ts pays for growth by
// extraction, server/CLAUDE.md module-first, and the *_db.ts family is where a
// domain's own SQL lives).
//
// WHY IT NEEDS MORE THAN A STATEMENT TIMEOUT. The three offline writers (the
// rename and reclaim signer sweeps, the PBE roster save, and the admin
// clear-item-name strip) used to persist through the live save family, whose
// transaction owner (server/character_save_transaction.ts beginCharacterSaveTx)
// sets THREE bounds: statement_timeout, lock_timeout 2s, and
// idle_in_transaction_session_timeout 10s, under a 65s wall deadline. When the
// lease fence gave them their own writer, the replacement carried only the
// statement bound, and the two it dropped are the ones that matter for a
// single-row UPDATE: this statement takes a ROW LOCK on `characters`, and a
// live session's own save can be holding it. Without lock_timeout a contended
// fence UPDATE waits the entire statement allowance (a full minute on the
// heavy tier it inherited) with a pooled client pinned for all of it, while an
// operator watches an admin request hang; with it, the write fails fast as
// 55P03 and the caller can say so. idle_in_transaction_session_timeout is the
// same defense one level up: it bounds the hold if this process stalls between
// the SET and the COMMIT.
//
// The statement bound is deliberately NOT the heavy tier either. The heavy
// allowance exists for the multi-statement live saves and the big aggregates;
// this is one row's UPDATE, so it takes an allowance sized to that, on the
// GUILD_BANK_LOG_TIMEOUT_MS lowering precedent (db.ts). It still sits above
// the lock bound, or a contended wait could never surface as a lock timeout.
//
// WHAT EACH BOUND ACTUALLY BOUNDS, because the Phase 18 record got this wrong
// and the wrong version was load-bearing in a concurrency argument.
// lock_timeout is per LOCK ACQUISITION, never per statement: one statement
// acquires again each time it re-checks a tuple whose holder changed, and every
// acquisition gets a fresh allowance, so a single statement's total wait can
// run several times past the lock bound (the Phase 18 QA database review
// measured a fenced write landing at 2,909 ms behind two sequential
// contenders, with the racing lease committed at 2,215 ms: both well past the
// 2s lock bound). The bound on the whole write, and therefore on any window it
// leaves open, is OFFLINE_CHARACTER_SAVE_STATEMENT_TIMEOUT_MS. The distinction
// is pinned against real PostgreSQL in
// tests/character_save_statement_pg_integration.test.ts ("bounds a lock
// ACQUISITION, never the statement").
//
// LOCK FIRST, THEN CHECK THE LEASE. The fence's NOT EXISTS is UNCORRELATED
// with the row it gates (its only reference is the character id parameter),
// so PostgreSQL hoists it into an InitPlan and gates the whole UPDATE on a
// One-Time Filter: a verdict computed BEFORE the characters row lock is
// taken. After a lock wait, EvalPlanQual re-checks only the target row's own
// columns and never re-runs an InitPlan, so a lease committed DURING the wait
// was invisible and the write landed over a now-live session (the Phase 18 QA
// database review reproduced exactly that, twice: the session had been handed
// the pre-write blob at its handshake, server/ws_auth.ts, so its next autosave
// clobbered the write while the caller had already reported success and
// committed an audit row asserting an effect that would not survive). Taking
// the row lock in its own statement first moves the whole lock wait ahead of
// the fence, so the UPDATE evaluates its lease check on a fresh snapshot with
// the lock already held. ANY row lock fixes the reproduced loss (measured:
// the repro is green under FOR NO KEY UPDATE too). FOR UPDATE, rather than the
// FOR NO KEY UPDATE the write itself would take, buys a SECOND thing, and the
// difference is measured rather than assumed (the pg suite runs both modes
// against a real lease acquire): FOR UPDATE is the weakest mode that conflicts
// with the FOR KEY SHARE a character_leases INSERT takes on its FK parent row,
// so while this transaction holds it a NEW lease row cannot commit at all,
// which also closes the older recorded residual where a lease committed
// between the fence's snapshot and this COMMIT. What it does NOT close, said
// plainly rather than claimed shut: STEALING an existing (expired) lease row
// runs as ON CONFLICT DO UPDATE without touching character_id, so PostgreSQL
// skips the FK re-check and takes no parent lock, and that arm is unchanged.
// The price of the stronger mode is the exclusion itself: a login's lease
// acquire now waits out an in-flight offline write, one short transaction
// under the two bounds above. This transaction takes exactly ONE row lock and
// never waits while holding another, so it cannot close a deadlock cycle
// against the save path or a lease acquire (the character_delete_db.ts
// verify-read carve-out, same argument).
//
// Name moderation and signer sweeps use offline_character_mutation_db.ts;
// that path also removes expired lease rows under the lock to close revival.
// This snapshot writer remains for the PBE roster fallback.
//
// The transaction runner is INJECTED rather than imported, so this module
// holds no pool of its own: db.ts binds the real runWithStatementTimeout at
// its one call site, and the suite drives the whole statement build and the
// bound sequence with a fake.
import type { QueryResult } from 'pg';

import { sanitizeRemovedZone1Content } from '../src/sim/removed_zone1_content';
import type { CharacterState } from '../src/sim/sim';
import { journalCharacterSaveSources } from './character_material_sources_db';
import {
  CHARACTER_SAVE_PREIMAGE_SELECT,
  characterUpdateStatement,
  readCharacterSavePreimage,
} from './character_save_statement';
import { REALM } from './realm';

/** One row's UPDATE, not the heavy multi-statement tier (see the header). This
 *  is the REAL bound on the whole fenced write, its lock wait included. */
export const OFFLINE_CHARACTER_SAVE_STATEMENT_TIMEOUT_MS = 5_000;
/** The per-LOCK-ACQUISITION wait, matching beginCharacterSaveTx's own 2s. NOT
 *  a bound on the statement: see the header's "what each bound actually
 *  bounds". */
export const OFFLINE_CHARACTER_SAVE_LOCK_TIMEOUT_MS = 2_000;
/** The idle-in-transaction hold, matching beginCharacterSaveTx's own 10s. */
export const OFFLINE_CHARACTER_SAVE_IDLE_TX_TIMEOUT_MS = 10_000;

/** Take the characters row lock BEFORE the fenced UPDATE evaluates its lease
 *  check (the header's "lock first, then check the lease"). Realm-pinned like
 *  the write it precedes, so a cross-realm id locks nothing.
 *
 *  Its projection is the material-source PRE-IMAGE (shared verbatim with the
 *  live lock, so the two cannot drift): this writer REPLACES the whole blob, so
 *  the state it overwrites is exactly the before-state its source journal
 *  replays from, and it is already reading it under the strongest lock here. */
const OFFLINE_CHARACTER_SAVE_ROW_LOCK_SQL = `SELECT ${CHARACTER_SAVE_PREIMAGE_SELECT} FROM characters WHERE id = $1 AND realm = $2 FOR UPDATE`;

/** The shape of db.ts runWithStatementTimeout: run `fn` in ONE transaction on
 *  a dedicated pooled client whose statement_timeout is SET for the duration. */
export type BoundedTransactionRunner = <T>(
  timeoutMs: number,
  fn: (query: (text: string, values?: unknown[]) => Promise<QueryResult>) => Promise<T>,
) => Promise<T>;

/** SET LOCAL takes no bind parameter, so every bound below is interpolated
 *  into the statement text. These are module constants, never caller input,
 *  but validating them as non-negative safe integers here is STILL the
 *  injection guard, exactly as db.ts runWithStatementTimeout validates its own
 *  interpolated allowance: the check is what makes "no other value can reach
 *  the SQL text" true rather than merely intended, and it keeps holding if a
 *  later edit makes one of these configurable. */
function safeBoundMs(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `offline character save ${name} must be a non-negative safe integer, got ${value}`,
    );
  }
  return value;
}

/**
 * Apply the two bounds the injected runner does NOT own (it sets
 * statement_timeout itself). SET LOCAL, so both revert at COMMIT/ROLLBACK and
 * neither leaks to the next checkout. Exported so the real-Postgres suite can
 * drive the PRODUCTION bounds and prove what each one actually bounds, instead
 * of restating the SET LOCAL text as a fixture of its own.
 *
 * The two figures are parameters defaulting to the module constants for the
 * same reason db.ts exposes its interpolated allowance as one: it is what lets
 * a suite drive the injection guard with a value production cannot produce
 * yet, so the guard is a pin rather than an unexercised comment.
 */
export async function applyOfflineCharacterSaveBounds(
  query: (text: string, values?: unknown[]) => Promise<QueryResult>,
  lockTimeoutMs: number = OFFLINE_CHARACTER_SAVE_LOCK_TIMEOUT_MS,
  idleTxTimeoutMs: number = OFFLINE_CHARACTER_SAVE_IDLE_TX_TIMEOUT_MS,
): Promise<void> {
  const lockMs = safeBoundMs('lock_timeout', lockTimeoutMs);
  const idleMs = safeBoundMs('idle_in_transaction_session_timeout', idleTxTimeoutMs);
  await query(`SET LOCAL lock_timeout = ${lockMs}`);
  await query(`SET LOCAL idle_in_transaction_session_timeout = ${idleMs}`);
}

/**
 * Persist a character row from an OFFLINE writer: fenced in the SAME statement
 * on the ABSENCE of a live load lease, so a login that has already claimed the
 * lease (the handshake acquires it before it re-reads the blob,
 * server/ws_auth.ts) makes this write touch nothing and return false, which
 * the caller surfaces as a refusal instead of landing a write the session's
 * next autosave would clobber. The caller's pre-checks answer the common case;
 * the fence answers the reconnect window a per-process session map cannot see
 * (a peer process too), and pins the row's realm. Same chokepoints as the live
 * save (the zone-1 sanitize, the one statement builder with its blob-size
 * signal).
 *
 * The row lock is taken FIRST, in its own statement, so the fence is evaluated
 * with the lock held rather than as an InitPlan decided before the wait (the
 * header's "lock first, then check the lease"; the write loss that ordering
 * caused is reproduced in the pg suite).
 *
 * Every bound is SET before the write it bounds, inside the runner's own
 * transaction, so all three revert at COMMIT and none leaks to the next
 * checkout.
 */
export async function runOfflineCharacterSave(
  runBounded: BoundedTransactionRunner,
  characterId: number,
  level: number,
  state: CharacterState,
): Promise<boolean> {
  const cleanState = sanitizeRemovedZone1Content(state).state;
  const stmt = characterUpdateStatement(characterId, level, JSON.stringify(cleanState), {
    kind: 'unleased',
    realm: REALM,
  });
  const res = await runBounded(OFFLINE_CHARACTER_SAVE_STATEMENT_TIMEOUT_MS, async (query) => {
    await applyOfflineCharacterSaveBounds(query);
    const locked = await query(OFFLINE_CHARACTER_SAVE_ROW_LOCK_SQL, [characterId, REALM]);
    const saved = await query(stmt.text, stmt.values);
    // Same transaction as the write, after it: a refused write (0 rows) journals
    // nothing, and a refused journal aborts the write with it.
    await journalCharacterSaveSources(
      { query },
      characterId,
      readCharacterSavePreimage(locked.rows[0]),
      saved,
      cleanState,
    );
    return saved;
  });
  return (res.rowCount ?? 0) > 0;
}
