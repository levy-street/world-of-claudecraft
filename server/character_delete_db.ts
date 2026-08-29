import {
  type BackgroundDbGateStats,
  type BackgroundDbPermit,
  createBackgroundDbGate,
} from './background_db_gate';
import { CHARACTER_SAVE_STATEMENT_TIMEOUT_MS } from './character_save_transaction';
import {
  backendCancelViaPool,
  createDbTransactionDeadline,
  DbTransactionAborted,
  type DbTransactionDeadlineClient,
  DbTransactionDeadlineExceeded,
} from './db_transaction_deadline';

// 65s wall over a 60s DELETE statement bound, the character-save shape: the
// widened DELETE below is useless if this driver-side deadline destroys the
// socket at 15s while the cascade is still running. Every statement before
// the DELETE keeps the tight 15s server bound.
export const CHARACTER_DELETE_TRANSACTION_TIMEOUT_MS = 65_000;

/** The tight bound for every statement except the widened DELETE. Mirrors
 * server/db.ts DB_STATEMENT_TIMEOUT_MS (not imported: db.ts already imports
 * character-save siblings, and this module must stay cycle-free). */
export const DELETE_RESTORE_STATEMENT_TIMEOUT_MS = 15_000;

export type OpenStoragePurchaseStatus = 'pending' | 'unresolved';

/** Stable domain refusal for a character whose paid storage rail is still open. */
export class CharacterStoragePurchaseOpen extends Error {
  readonly code = 'CHARACTER_STORAGE_PURCHASE_OPEN' as const;

  constructor(
    readonly characterId: number,
    readonly status: OpenStoragePurchaseStatus,
  ) {
    super(`character ${characterId} has an open ${status} storage purchase`);
    this.name = 'CharacterStoragePurchaseOpen';
  }
}

/** Retryable refusal: the realm's background-DB gate had no permit inside the
 * bounded wait, so the delete never took a pool client. */
export class CharacterDeleteQueueSaturated extends Error {
  readonly code = 'CHARACTER_DELETE_QUEUE_SATURATED' as const;

  constructor(readonly characterId: number) {
    super(`character ${characterId} delete refused: background database gate saturated`);
    this.name = 'CharacterDeleteQueueSaturated';
  }
}

/** The requester vanished during the bounded permit wait: the socket is
 * closed, so no refusal can reach anyone and the HTTP arms write NOTHING.
 * Distinct from CharacterDeleteQueueSaturated so a dead client is never
 * booked as gate saturation (the 503 and its counter keep meaning
 * saturation). */
export class CharacterDeleteClientGone extends Error {
  readonly code = 'CHARACTER_DELETE_CLIENT_GONE' as const;

  constructor(readonly characterId: number) {
    super(`character ${characterId} delete abandoned: the requesting client disconnected`);
    this.name = 'CharacterDeleteClientGone';
  }
}

export interface CharacterDeleteBackgroundPermit {
  release(): void;
}

export type CharacterDeleteAcquireBackgroundPermit = (
  signal: AbortSignal,
) => Promise<CharacterDeleteBackgroundPermit | null>;

/** Same bounded wait as the paid-guild sibling: past it the player retries. */
export const CHARACTER_DELETE_PERMIT_WAIT_MS = 15_000;

/** At most this many concurrent deletes may hold realm background permits.
 * A delete's 65s wall is the longest hold the gate admits, and the gate's
 * signal-less consumers (autosave, the market and mail saves, the shutdown
 * saveAll) wait UNBOUNDED by design: their only retry is the next periodic
 * sweep, and at shutdown there is none, so refusing them on a timer would
 * trade durability for latency. Sub-capping delete concurrency instead keeps
 * a delete stampede from occupying the whole gate: past the cap the extra
 * deletes wait the same bounded 15s and refuse retryably, and every other
 * permit stays available to the durability writers. */
export const CHARACTER_DELETE_PERMIT_SUB_CAP = 2;

// The sub-cap is the same FIFO permit gate the realm uses, at delete-local
// capacity (zero headroom arithmetic). Acquired BEFORE the realm gate, so a
// parked delete queues here without ever claiming a realm permit.
const deleteSubGate = createBackgroundDbGate(CHARACTER_DELETE_PERMIT_SUB_CAP, 0);

// Lifetime CharacterDeleteQueueSaturated throws (the 503 bookings).
// Client-gone abandonments deliberately never count here.
let saturationRefusals = 0;

/** The delete sub-gate's readout plus the lifetime saturation refusals and
 * the ambiguity-resolver outcome counters. */
export interface CharacterDeleteGateStats
  extends BackgroundDbGateStats,
    CharacterDeleteVerifyStats {
  busyRefusals: number;
}

/** Scrape-time read for the woc_character_delete_gate metric family: the
 * sub-cap parks a delete stampede BEFORE the realm gate, so the realm gate's
 * waiting gauge structurally cannot see it, and without this readout a leaked
 * sub slot would be undiagnosable and CHARACTER_DELETE_PERMIT_SUB_CAP
 * untunable from production. */
export function characterDeleteGateStats(): CharacterDeleteGateStats {
  return { ...deleteSubGate.stats(), busyRefusals: saturationRefusals, ...verifyStats };
}

let registeredAcquireBackgroundPermit: CharacterDeleteAcquireBackgroundPermit | null = null;

/** main.ts registers the realm's one major-background gate here at boot, the
 * configurePaidGuildCreateBackgroundGate pattern; null unregisters (tests). */
export function configureCharacterDeleteBackgroundGate(
  acquire: CharacterDeleteAcquireBackgroundPermit | null,
): void {
  registeredAcquireBackgroundPermit = acquire;
}

export interface CharacterDeletePool {
  connect(): Promise<DbTransactionDeadlineClient>;
  /** Optional so narrow fakes stay valid; with it, a deadline that destroys the
   * socket also fires pg_cancel_backend so the cascade's locks drop early. */
  query?(sql: string, values: unknown[]): Promise<unknown>;
  /** Overrides the pool-derived canceller: db.ts wires its dedicated,
   * side-pool-backed hook so an expiry cancel never rides the saturated main
   * pool it exists to relieve. */
  cancelBackend?(processId: number): Promise<void>;
}

/**
 * Gate-then-checkout, the paid-guild-creation shape: a 65s wall over a 60s
 * DELETE bound can hold a pool client for a minute on a player-reachable
 * route, so a handful of concurrent deletes of ledger-heavy characters would
 * otherwise hold most of the 10-client pool while holding accounts/characters
 * row locks. Acquiring a major-background permit BEFORE the checkout composes
 * the delete under the realm's one background gate instead. A refused wait is
 * a prompt retryable refusal that never touched the pool; the caller's signal
 * bounds ONLY this wait (see deleteOwnedCharacterRow), and a caller gone
 * mid-wait throws CharacterDeleteClientGone, never the saturation refusal.
 */
async function acquireCharacterDeletePermit(
  characterId: number,
  signal: AbortSignal | undefined,
): Promise<CharacterDeleteBackgroundPermit> {
  const acquirePermit = registeredAcquireBackgroundPermit;
  const waitController = new AbortController();
  const waitTimer = setTimeout(() => waitController.abort(), CHARACTER_DELETE_PERMIT_WAIT_MS);
  waitTimer.unref();
  const composed = signal
    ? AbortSignal.any([signal, waitController.signal])
    : waitController.signal;
  let subPermit: BackgroundDbPermit | null = null;
  let permit: CharacterDeleteBackgroundPermit | null = null;
  try {
    // Sub-cap first, and UNCONDITIONALLY: a delete past
    // CHARACTER_DELETE_PERMIT_SUB_CAP parks here and never claims (or queues
    // on) a realm permit, and an unregistered realm gate (tests, a boot
    // window) must not bypass the delete concurrency bound. Both waits share
    // the one 15s bound above.
    subPermit = await deleteSubGate.acquire(composed);
    if (subPermit && acquirePermit) {
      try {
        permit = await acquirePermit(composed);
      } catch (error) {
        subPermit.release();
        throw error;
      }
    }
  } finally {
    clearTimeout(waitTimer);
  }
  if (!subPermit || (acquirePermit && !permit)) {
    subPermit?.release();
    // The requester vanished mid-wait: an abandonment, never gate pressure,
    // so it must not book the saturation refusal (or its 503).
    if (signal?.aborted) throw new CharacterDeleteClientGone(characterId);
    saturationRefusals++;
    throw new CharacterDeleteQueueSaturated(characterId);
  }
  const realmPermit = permit;
  const subSlot = subPermit;
  return {
    release(): void {
      // Realm permit first, then the delete slot; both releases are
      // idempotent, and a throwing realm release must not leak the slot.
      try {
        realmPermit?.release();
      } finally {
        subSlot.release();
      }
    },
  };
}

/**
 * Delete one owned character after serializing with storage purchase starts.
 * Account parent locks always precede the character lifecycle lock. The
 * caller's signal bounds ONLY the permit wait: once BEGIN has run, a client
 * disconnect must not tear the transaction, because an abort landing during
 * COMMIT would leave a committed DELETE whose world-state purge (run by the
 * HTTP arms on success) never runs, permanently orphaning the character's
 * market listings and Ravenpost mail. The 65s wall is the transaction's own
 * bound, and an ambiguous COMMIT under it is verified below.
 */
export async function deleteOwnedCharacterRow(
  db: CharacterDeletePool,
  accountId: number,
  characterId: number,
  realm: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const permit = await acquireCharacterDeletePermit(characterId, signal);
  let client: DbTransactionDeadlineClient;
  try {
    client = await db.connect();
  } catch (error) {
    permit.release();
    throw error;
  }
  const transaction = createDbTransactionDeadline(client, {
    operation: 'character delete',
    timeoutMs: CHARACTER_DELETE_TRANSACTION_TIMEOUT_MS,
    // Deliberately NO caller signal past this point (see the doc above); the
    // request-close abort is spent at the permit wait.
    cancelBackend:
      db.cancelBackend ??
      (db.query ? backendCancelViaPool({ query: db.query.bind(db) }) : undefined),
  });
  try {
    await transaction.query('BEGIN');
    await transaction.query(`SET LOCAL statement_timeout = ${DELETE_RESTORE_STATEMENT_TIMEOUT_MS};
      SET LOCAL lock_timeout = '2s';
      SET LOCAL idle_in_transaction_session_timeout = '2s'`);

    const account = await transaction.query('SELECT id FROM accounts WHERE id = $1 FOR KEY SHARE', [
      accountId,
    ]);
    if ((account.rowCount ?? 0) === 0) {
      await transaction.rollback();
      return false;
    }

    const character = await transaction.query(
      `SELECT id FROM characters
        WHERE id = $1 AND account_id = $2 AND realm = $3
        FOR UPDATE`,
      [characterId, accountId, realm],
    );
    if ((character.rowCount ?? 0) === 0) {
      await transaction.rollback();
      return false;
    }

    // READ COMMITTED takes a fresh snapshot after the character lock wait. A
    // purchase start takes the same character lock before INSERT, so either its
    // open row is visible here or it cannot start until this delete finishes.
    const openPurchase = await transaction.query(
      `SELECT status FROM storage_purchases
        WHERE character_id = $1 AND status IN ('pending', 'unresolved')
        LIMIT 1`,
      [characterId],
    );
    if (openPurchase.rows[0]) {
      throw new CharacterStoragePurchaseOpen(
        characterId,
        String(openPurchase.rows[0].status) as OpenStoragePurchaseStatus,
      );
    }

    // The DELETE cascade now spans bank_ledger and bank_ledger_batch_receipts,
    // both keep-forever tables whose per-character row counts grow without
    // bound, so a heavy character's cascade can exceed the transaction's 15s
    // statement bound. Under that bound a large enough history would make
    // deletion PERMANENTLY impossible for exactly the accounts most likely to
    // request it. Widen the bound for this one statement (matching the heavy
    // character-save allowance) and restore the tighter bound afterward so
    // COMMIT keeps the transaction's own ceiling.
    await transaction.query(`SET LOCAL statement_timeout = ${CHARACTER_SAVE_STATEMENT_TIMEOUT_MS}`);
    const deleted = await transaction.query(
      'DELETE FROM characters WHERE id = $1 AND account_id = $2 AND realm = $3',
      [characterId, accountId, realm],
    );
    // Deliberately skipped when the DELETE throws: the catch below rolls the
    // whole transaction back, which clears every SET LOCAL with it.
    await transaction.query(`SET LOCAL statement_timeout = ${DELETE_RESTORE_STATEMENT_TIMEOUT_MS}`);
    await transaction.commit();
    return (deleted.rowCount ?? 0) > 0;
  } catch (error) {
    await transaction.rollback();
    // The 65s wall can expire DURING COMMIT. Verify before propagating: a
    // propagated ambiguity would skip the caller's success side (link change,
    // admin busts, the HTTP arms' world-state purge) for a delete that
    // actually landed. Runs while the permit is still held, so the verify
    // read rides the delete's own admission.
    if (await ambiguousCommitLanded(db, error, accountId, characterId, realm)) return true;
    throw error;
  } finally {
    // Permit release AFTER the transaction returns its client: its lifetime
    // covers the whole pool hold, the clientWithPermit contract.
    try {
      transaction.release();
    } finally {
      permit.release();
    }
  }
}

/** Bounded lock wait for the ambiguity verify read below, under the tight
 * 15s statement bound so an expired wait keeps its own honest 55P03
 * (lock_not_available) instead of an ambiguous statement cancel (a lock
 * wait counts toward statement_timeout, so the ordering decides which
 * fires; measured on PG16). */
export const CHARACTER_DELETE_VERIFY_LOCK_TIMEOUT_MS = 10_000;

/** The verify read, locked on purpose (see ambiguousCommitLanded): a plain
 * SELECT would RACE the hung COMMIT it is verifying. FOR KEY SHARE, the
 * weakest mode that still queues behind the in-flight DELETE's row lock
 * (measured on PG16: identical answers to FOR UPDATE on both outcomes),
 * because in the not-landed case the verify briefly holds a LIVE character's
 * row and FOR UPDATE there blocked a concurrent character save into its 2s
 * lock_timeout (measured: the save died 55P03 under FOR UPDATE, proceeded in
 * 2 ms under KEY SHARE, whose lock ordinary non-key saves do not conflict
 * with). Exported so the pg suite drives this exact statement against real
 * PostgreSQL. */
export const CHARACTER_DELETE_VERIFY_SQL =
  'SELECT 1 FROM characters WHERE id = $1 AND account_id = $2 AND realm = $3 FOR KEY SHARE';

/** Lifetime outcomes of the ambiguity resolver, exposed on the gate readout:
 * the bug this resolver fixes (a landed delete reported unlanded, its world
 * purge skipped) was production-invisible precisely because nothing counted
 * here, and a regression would be equally invisible without these. */
export interface CharacterDeleteVerifyStats {
  verifyLanded: number;
  verifyNotLanded: number;
  verifyFailed: number;
}

const verifyStats: CharacterDeleteVerifyStats = {
  verifyLanded: 0,
  verifyNotLanded: 0,
  verifyFailed: 0,
};

const verifyReleaseError = (error: unknown): Error =>
  error instanceof Error ? error : new Error('character delete verify failed');

/**
 * The commit-ambiguity resolver, the guild_create_db reconcile precedent: on
 * an error carrying commitMayHaveSucceeded, a fresh read decides whether the
 * COMMIT landed. The row gone proves the delete is durable and the caller's
 * success side (link change, admin busts, the world-state purge) must run;
 * what the lock does NOT prove is WHOSE commit removed it: after this
 * transaction's rollback a rival retry can land the delete before this read,
 * and then both requests run the (idempotent) success side, which is the
 * right answer either way. The row still present, or the verify itself
 * failing, leaves the original failure standing: the refusal stays
 * retryable, and a retry re-answers honestly.
 *
 * The read WAITS the in-flight transaction out instead of racing it: a READ
 * COMMITTED snapshot taken while the hung COMMIT is still applying sees the
 * deleted-but-uncommitted row as PRESENT, so a plain SELECT here answered
 * "not landed" for a delete that then committed, the client's retry got a
 * 404, and the world-state purge never ran (permanent orphaned market
 * listings and Ravenpost mail), widest exactly under the contention that
 * expired the wall mid-COMMIT. FOR KEY SHARE queues behind the deleting
 * backend's row lock until that commit resolves and then answers
 * definitively either way: a committed delete fails the EvalPlanQual
 * recheck and returns zero rows; an abort leaves the surviving row, which
 * this read shares and returns (see CHARACTER_DELETE_VERIFY_SQL for why
 * KEY SHARE and not FOR UPDATE). The wait is bounded by lock_timeout in
 * its own transaction; an expiry propagates the ambiguity honestly,
 * exactly like a failed checkout.
 *
 * One deliberate exception to the module's account-parent-first lock rule:
 * this transaction takes NO accounts lock. That is safe because it takes
 * exactly one row lock and never waits while holding another, so it cannot
 * close a deadlock cycle against the save path, a rival delete, or a
 * storage-purchase start; any future second lock added here must rejoin
 * the parent-first hierarchy. Runs while the delete permit is still held,
 * so the wait rides the delete's own admission and never stacks over the
 * sub-cap; the cost of that is TIME, stated honestly: an ambiguous delete
 * extends its permit hold past the 65s wall by up to the checkout bound
 * plus the 15s verify statement bound (about 85s worst case), so two
 * simultaneously ambiguous deletes hold both sub-cap slots for that window
 * and further deletes refuse retryably.
 */
async function ambiguousCommitLanded(
  db: CharacterDeletePool,
  error: unknown,
  accountId: number,
  characterId: number,
  realm: string,
): Promise<boolean> {
  const ambiguous =
    (error instanceof DbTransactionAborted || error instanceof DbTransactionDeadlineExceeded) &&
    error.commitMayHaveSucceeded;
  if (!ambiguous) return false;
  let verify: DbTransactionDeadlineClient;
  try {
    verify = await db.connect();
  } catch {
    // Unresolved ambiguity: the original failure is the honest answer.
    verifyStats.verifyFailed++;
    return false;
  }
  // A FATAL landing on a checked-out client with no 'error' listener throws
  // at process level (pg-pool detaches its own idle listener on acquire),
  // and this client can sit in a lock wait for up to the 10s bound, plenty
  // of window for a server restart or a backend reap. Swallow it here: the
  // next statement on the dead client rejects into the catches below, which
  // discard it. Same hazard the deadline wrapper's own listener covers for
  // the delete's client (db_transaction_deadline.ts).
  const onVerifyError = (): void => {};
  verify.on('error', onVerifyError);
  const releaseVerify = (error?: Error): void => {
    verify.removeListener('error', onVerifyError);
    if (error) verify.release(error);
    else verify.release();
  };
  let landed: boolean;
  try {
    await verify.query('BEGIN');
    // idle_in_transaction rides along like the delete's own transaction: it
    // fires only when idle BETWEEN statements (a lock wait is not idle), so
    // it bounds a stalled event loop or a black-holed ROLLBACK without ever
    // cutting the bounded lock wait short.
    await verify.query(`SET LOCAL statement_timeout = ${DELETE_RESTORE_STATEMENT_TIMEOUT_MS};
      SET LOCAL lock_timeout = ${CHARACTER_DELETE_VERIFY_LOCK_TIMEOUT_MS};
      SET LOCAL idle_in_transaction_session_timeout = '2s'`);
    const row = await verify.query(CHARACTER_DELETE_VERIFY_SQL, [characterId, accountId, realm]);
    landed = (row.rowCount ?? 0) === 0;
  } catch (error) {
    // Same posture as a failed checkout: propagate the original ambiguity.
    // The client may hold an open (possibly aborted) transaction, so it is
    // DISCARDED rather than returned to the pool.
    verifyStats.verifyFailed++;
    releaseVerify(verifyReleaseError(error));
    return false;
  }
  if (landed) verifyStats.verifyLanded++;
  else verifyStats.verifyNotLanded++;
  try {
    await verify.query('ROLLBACK');
  } catch (error) {
    // The answer above is already definitive; a failed ROLLBACK only means
    // this client cannot go back to the pool. Discarded HERE, not in a
    // shared catch: a clean release below must never be followed by a
    // second release (pg throws on double release).
    releaseVerify(verifyReleaseError(error));
    return landed;
  }
  releaseVerify();
  return landed;
}
