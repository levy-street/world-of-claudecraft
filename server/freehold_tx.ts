// THE BOUNDED TRANSACTION every housing transaction the mutation boundary owns
// runs through (docs/freeholds/mutation-touch-set-manifest.md section 5): the
// claim writes, the fenced plot write, the login read, the renewer, the
// operation prepare and close, and the ambiguous-COMMIT verify. One shape so
// the four bounds are never forgotten on one path:
//
// - BEGIN and every SET LOCAL travel as ONE simple-protocol round trip;
// - statement_timeout, lock_timeout and idle_in_transaction_session_timeout are
//   each set, so a lock wait answers 55P03 inside its own bound instead of
//   eating the statement's, and a stalled client cannot hold a row lock;
// - the wall deadline is DbTransactionDeadline's, which destroys the socket
//   when it fires and cancels the detached backend through the canceller the
//   realm registers at boot (setFreeholdTxBackendCanceller, wired by
//   server/main.ts to the process-wide cancelDetachedBackend); a host that
//   registers none (a test) leaves that backend to its own statement_timeout;
// - COMMIT's command TAG is checked (commitChecked): a transaction an earlier
//   statement aborted answers COMMIT with a ROLLBACK tag and no error, and on
//   the login read that would have meant believing a claim that rolled back.
//
// A failure after COMMIT was sent that nothing proves rolled back is rethrown
// as FreeholdCommitAmbiguous, so a caller can never mistake "the answer was
// lost" for "it did not happen": the manifest's P9 verify, or a P2/P3 retry,
// is the only thing that may decide it.
//
// No SQL of its own beyond the bounds line, and no db.ts import: the pool is
// injected, so a Vitest drives every arm with a fake client.
import {
  createDbTransactionDeadline,
  DbTransactionAborted,
  type DbTransactionDeadline,
  type DbTransactionDeadlineClient,
  DbTransactionDeadlineExceeded,
  DbTransactionRolledBack,
} from './db_transaction_deadline';
import { throwProvedRollback } from './pg_rollback_proof';

/** The narrow pool surface: one checkout. node-postgres's Pool satisfies it. */
export interface FreeholdTxPool {
  connect(): Promise<DbTransactionDeadlineClient>;
}

/** The statements a housing transaction issues. DbTransactionDeadline is it. */
export type FreeholdTxQuery = Pick<DbTransactionDeadline, 'query'>;

export interface FreeholdTxBounds {
  /** Names the transaction in deadline and abort errors. Never player data. */
  readonly operation: string;
  readonly statementMs: number;
  readonly lockMs: number;
  readonly idleMs: number;
  /** The whole transaction's wall, including COMMIT. */
  readonly wallMs: number;
}

let registeredCancelBackend: ((processId: number) => Promise<void>) | undefined;

/** The realm's detached-backend canceller for every housing transaction a
 *  deadline cuts (a per-call `cancelBackend` still wins). Passing undefined
 *  unregisters it, which is what a test teardown does. */
export function setFreeholdTxBackendCanceller(
  cancel: ((processId: number) => Promise<void>) | undefined,
): void {
  registeredCancelBackend = cancel;
}

/** A lock bound or a statement bound ran out (55P03, 57014): contention or a
 *  slow database, which the housing counters keep apart from a refusal. */
export function freeholdLockTimeout(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === '55P03' || code === '57014';
}

/** COMMIT was sent and nothing proves it did not land. */
export class FreeholdCommitAmbiguous extends Error {
  readonly code = 'FREEHOLD_COMMIT_AMBIGUOUS' as const;

  constructor(operation: string, cause: unknown) {
    super(`${operation} lost its COMMIT answer; durable truth decides`, { cause });
    this.name = 'FreeholdCommitAmbiguous';
  }
}

function requireBound(name: string, ms: number): number {
  if (!Number.isSafeInteger(ms) || ms <= 0) {
    throw new RangeError(`freehold transaction ${name} must be a positive integer of ms`);
  }
  return ms;
}

/** The one round trip that opens a bounded housing transaction. Exported so
 *  the suites pin the exact bounds each path runs under. */
export function freeholdTxBeginSql(bounds: FreeholdTxBounds): string {
  const statement = requireBound('statementMs', bounds.statementMs);
  const lock = requireBound('lockMs', bounds.lockMs);
  const idle = requireBound('idleMs', bounds.idleMs);
  requireBound('wallMs', bounds.wallMs);
  return (
    'BEGIN; ' +
    `SET LOCAL statement_timeout = ${statement}; ` +
    `SET LOCAL lock_timeout = ${lock}; ` +
    `SET LOCAL idle_in_transaction_session_timeout = ${idle}`
  );
}

/** Whether a failure that reached past COMMIT may still have committed. A
 *  ROLLBACK tag, a statement-level SQLSTATE from a class that aborts before
 *  COMMIT (server/pg_rollback_proof.ts) and the typed deadline arms that say so
 *  are the only proofs that it did not. */
export function freeholdCommitMayHaveLanded(error: unknown): boolean {
  if (error instanceof DbTransactionRolledBack) return false;
  if (error instanceof DbTransactionDeadlineExceeded || error instanceof DbTransactionAborted) {
    return error.commitMayHaveSucceeded;
  }
  return !throwProvedRollback(error);
}

const cancelledReason = (signal: AbortSignal): unknown =>
  signal.reason ?? new Error('freehold transaction cancelled before its checkout');

/** A checkout every given signal also bounds: an abort that wins the race
 *  releases the client when it eventually arrives, so nothing leaks. */
async function connectWithin(
  pool: FreeholdTxPool,
  given: readonly (AbortSignal | undefined)[],
): Promise<DbTransactionDeadlineClient> {
  const signals = given.filter((signal): signal is AbortSignal => signal !== undefined);
  // An already-spent signal refuses BEFORE asking the pool, so it never joins
  // the pool's waiter queue (a login whose budget is gone, a renew pass past
  // its deadline).
  const spent = signals.find((signal) => signal.aborted);
  if (spent) throw cancelledReason(spent);
  const checkout = pool.connect();
  if (signals.length === 0) return checkout;
  return new Promise<DbTransactionDeadlineClient>((resolve, reject) => {
    let settled = false;
    const detach: (() => void)[] = [];
    const settle = (): boolean => {
      if (settled) return false;
      settled = true;
      for (const off of detach) off();
      return true;
    };
    for (const signal of signals) {
      const onAbort = () => {
        if (!settle()) return;
        checkout.then(
          (client) => client.release(),
          () => {},
        );
        reject(cancelledReason(signal));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      detach.push(() => signal.removeEventListener('abort', onAbort));
    }
    checkout.then(
      (client) => {
        // An abort that won already scheduled this client's release.
        if (settle()) resolve(client);
      },
      (error: unknown) => {
        if (settle()) reject(error);
      },
    );
  });
}

export async function runFreeholdTransaction<T>(
  pool: FreeholdTxPool,
  bounds: FreeholdTxBounds,
  run: (tx: FreeholdTxQuery) => Promise<T>,
  opts: {
    /** Bounds the checkout AND the transaction: an abort while it runs cuts it
     *  (its socket destroyed; at COMMIT, FreeholdCommitAmbiguous). */
    readonly signal?: AbortSignal;
    /** Bounds the CHECKOUT only, and is never handed to the transaction: a
     *  transaction that has its client runs to its own bounds (the renewer's
     *  release and its re-reads, where a cut COMMIT could hide a landed
     *  release). */
    readonly checkoutSignal?: AbortSignal;
    readonly cancelBackend?: (processId: number) => Promise<void>;
  } = {},
): Promise<T> {
  const begin = freeholdTxBeginSql(bounds);
  const client = await connectWithin(pool, [opts.signal, opts.checkoutSignal]);
  const tx = createDbTransactionDeadline(client, {
    operation: bounds.operation,
    timeoutMs: bounds.wallMs,
    signal: opts.signal,
    cancelBackend: opts.cancelBackend ?? registeredCancelBackend,
  });
  let commitSent = false;
  try {
    await tx.query(begin);
    const result = await run(tx);
    commitSent = true;
    await tx.commitChecked();
    return result;
  } catch (error) {
    await tx.rollback();
    if (commitSent && freeholdCommitMayHaveLanded(error)) {
      throw new FreeholdCommitAmbiguous(bounds.operation, error);
    }
    throw error;
  } finally {
    tx.release();
  }
}
