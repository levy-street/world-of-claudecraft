// The dedicated deadline-cancel side pool. Deadline-expiry backend cancels
// must NOT ride the main pool they exist to relieve: a cancel fires at the
// exact moment (deadline expiry) that signals pool or lock saturation, so
// through the main pool it could queue behind login checkouts and pin a
// client for up to the full statement timeout. A max-1 side pool with
// sub-second bounds decouples it: idle it holds zero connections (the
// explicit idle timeout below releases its one client), and a cancel that cannot
// connect or run inside its budget is dropped, best-effort by contract (the
// caller-installed statement_timeout stays the backstop). The transient
// extra connection is in DEPLOY.md's budget arithmetic; the counters export
// as woc_db_backend_cancel_requests_total and
// woc_db_backend_cancel_failures_total.
//
// The pool is created LAZILY on the first cancel: this module and db.ts
// import each other (db.ts wires the hook, this module needs DATABASE_URL),
// and a module-scope Pool would read DATABASE_URL out of a half-evaluated
// db.ts during a circular import. By the first deadline expiry, db.ts is
// long since evaluated.

import { Pool } from 'pg';
import { backendCancelViaPool } from './db_transaction_deadline';

export const DB_CANCEL_POOL_CONNECT_TIMEOUT_MS = 500;
export const DB_CANCEL_STATEMENT_TIMEOUT_MS = 750;
export const DB_CANCEL_QUERY_TIMEOUT_MS = 1_000;
// Explicit, not pg-pool's default: the "transient connection" claim in the
// budget arithmetic is a stated bound of this module, so it must not silently
// move under a driver upgrade. Same value as the current pg-pool default.
export const DB_CANCEL_IDLE_TIMEOUT_MS = 10_000;
// Max-1 by design (see the header). Exported so the boot connection-budget
// guard (db_connection_budget.ts) counts the same figure this pool enforces.
export const DB_CANCEL_POOL_MAX_CLIENTS = 1;

// Memoized as the IN-FLIGHT promise, never the resolved pool: deadline
// expiries cluster at exactly the saturation moment that produces them, and
// a resolved-value memo would let two same-tick first cancels both pass the
// null check across the dynamic-import await and construct two pools, the
// second orphaning the first outside closeBackendCancelPool's reach.
let cancelPoolPromise: Promise<Pool> | null = null;

function ensureCancelPool(): Promise<Pool> {
  if (cancelPoolPromise) return cancelPoolPromise;
  const created = (async () => {
    const { DATABASE_URL } = await import('./db');
    const pool = new Pool({
      connectionString: DATABASE_URL,
      max: DB_CANCEL_POOL_MAX_CLIENTS,
      connectionTimeoutMillis: DB_CANCEL_POOL_CONNECT_TIMEOUT_MS,
      idleTimeoutMillis: DB_CANCEL_IDLE_TIMEOUT_MS,
      statement_timeout: DB_CANCEL_STATEMENT_TIMEOUT_MS,
      query_timeout: DB_CANCEL_QUERY_TIMEOUT_MS,
    });
    if (typeof pool.on === 'function') {
      pool.on('error', (err) => {
        console.error('pg cancel pool: idle client error (client discarded)', err);
      });
    }
    return pool;
  })();
  cancelPoolPromise = created;
  // A rejected factory must not stay memoized for the process lifetime: every
  // later cancel would replay the same stale rejection, and shutdown would
  // trip over it. Null the memo so the next deadline expiry retries fresh; the
  // caller awaiting this same promise still observes the rejection (this
  // handler runs first, it was attached first).
  created.catch(() => {
    if (cancelPoolPromise === created) cancelPoolPromise = null;
  });
  return created;
}

let backendCancelRequestCount = 0;
let backendCancelFailureCount = 0;

// Latched by closeBackendCancelPool BEFORE it reads the memo: a cancel that
// arrives between shutdown and process.exit whose earlier factory REJECTED
// (memo nulled) would otherwise construct a fresh Pool nothing ever ends.
let cancelPoolClosed = false;

/** The one process-wide detached-backend canceller: counted, side-pool-backed,
 * best-effort. Every DbTransactionDeadline cancelBackend hook wires to this. */
export async function cancelDetachedBackend(processId: number): Promise<void> {
  backendCancelRequestCount++;
  if (cancelPoolClosed) {
    // Counted as a failure and rethrown like any other refused cancel; the
    // deadline owner swallows it and the statement_timeout stays the backstop.
    backendCancelFailureCount++;
    throw new Error('pg cancel pool: closed for shutdown, cancel dropped');
  }
  try {
    await backendCancelViaPool(await ensureCancelPool())(processId);
  } catch (error) {
    backendCancelFailureCount++;
    throw error;
  }
}

/** Lifetime detached-backend cancel attempts and failures (metrics + tests). */
export function getBackendCancelCounts(): { requested: number; failed: number } {
  return { requested: backendCancelRequestCount, failed: backendCancelFailureCount };
}

/** Shutdown teardown for the cancel side pool (main.ts, beside pool.end()).
 * Never throws: the shutdown chain runs unguarded, so a rejected lazy factory
 * or a failing end() here would skip the main pools' end() and the clean
 * exit behind it. Best-effort by the same contract as the cancels. */
export async function closeBackendCancelPool(): Promise<void> {
  // Latch first, before the memo read: with a nulled rejected memo there is
  // nothing to end, but a later cancel must still be refused, not rebuilt.
  cancelPoolClosed = true;
  if (!cancelPoolPromise) return;
  try {
    await (await cancelPoolPromise).end();
  } catch (error) {
    console.error('pg cancel pool: shutdown close failed', error);
  }
}
