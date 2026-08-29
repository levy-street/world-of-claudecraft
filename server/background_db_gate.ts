// Realm-local admission for database-heavy background work.
//
// The pg Pool is shared with login, auth, and player request traffic. Autosave,
// storage-purchase recovery, and World Market escrow each have useful local
// concurrency limits, but independent limits can still add up past the pool's
// capacity. This one gate composes those named major producers before the pool
// checkout queue becomes their first shared backpressure boundary. Other
// background jobs still use the same pool, so the configured headroom is NOT
// a guaranteed interactive reserve; a true reserve requires classifying every
// checkout or separate priority pools under one connection budget.

// Three reserved clients, counted against the pool maximum: two for
// interactive login/auth/request checkouts, plus one for the process-global
// bank-ledger FIFO tail (server/bank_ledger.ts), which checks out a pool
// client OUTSIDE this gate. Without the third reservation the composition
// arithmetic admits gate permits + the ledger tail = the whole pool, and
// interactive checkouts eat the full connect timeout at peak.
export const BACKGROUND_DB_MAJOR_PRODUCER_HEADROOM = 3;

export interface BackgroundDbPermit {
  /** Idempotent: a stale finally block cannot over-release the gate. */
  release(): void;
}

export interface BackgroundDbGateStats {
  inFlight: number;
  waiting: number;
  max: number;
  /** Pool clients outside this gate's named-producer cap. Bypass work can use
   *  them, so this is composition headroom rather than a reserved partition. */
  configuredHeadroom: number;
  acquired: number;
  refused: number;
  cancelled: number;
}

export interface BackgroundDbGate {
  /** FIFO wait for background work that is safe to delay. Null means the
   * caller's AbortSignal fired before a permit was granted. */
  acquire(signal?: AbortSignal): Promise<BackgroundDbPermit | null>;
  /** Immediate admission for request-path work whose caller owns the retry. */
  tryAcquire(): BackgroundDbPermit | null;
  stats(): BackgroundDbGateStats;
}

interface Waiter {
  readonly resolve: (permit: BackgroundDbPermit | null) => void;
  readonly signal?: AbortSignal;
  readonly onAbort?: () => void;
}

/** At very small operator-configured pools, keep one named-producer lane so
 * durability can still make progress. At DB_POOL_MAX_CLIENTS=1 the reserve
 * vanishes entirely: the one named-producer lane IS the only pool client, so
 * a granted background permit can hold it against interactive checkouts and
 * the ledger FIFO tail alike. That is accepted (durability beats a reserve
 * nobody can size at a pool of one); do not "fix" the floor. */
export function backgroundDbCapacity(
  poolMaxClients: number,
  requestedHeadroom = BACKGROUND_DB_MAJOR_PRODUCER_HEADROOM,
): number {
  const poolMax = Math.max(1, Math.floor(poolMaxClients));
  const headroom = Math.max(0, Math.floor(requestedHeadroom));
  return Math.max(1, poolMax - headroom);
}

export function createBackgroundDbGate(
  poolMaxClients: number,
  requestedHeadroom = BACKGROUND_DB_MAJOR_PRODUCER_HEADROOM,
): BackgroundDbGate {
  const poolMax = Math.max(1, Math.floor(poolMaxClients));
  const max = backgroundDbCapacity(poolMax, requestedHeadroom);
  const waiters = new Map<object, Waiter>();
  let inFlight = 0;
  let acquired = 0;
  let refused = 0;
  let cancelled = 0;

  function permit(): BackgroundDbPermit {
    let held = true;
    inFlight++;
    acquired++;
    return {
      release(): void {
        if (!held) return;
        held = false;
        inFlight = Math.max(0, inFlight - 1);
        grantWaiters();
      },
    };
  }

  function grantWaiters(): void {
    while (inFlight < max) {
      const next = waiters.entries().next().value as [object, Waiter] | undefined;
      if (!next) return;
      const [token, waiter] = next;
      waiters.delete(token);
      if (waiter.onAbort) waiter.signal?.removeEventListener('abort', waiter.onAbort);
      if (waiter.signal?.aborted) {
        cancelled++;
        waiter.resolve(null);
        continue;
      }
      waiter.resolve(permit());
    }
  }

  return {
    acquire(signal?: AbortSignal): Promise<BackgroundDbPermit | null> {
      if (signal?.aborted) {
        cancelled++;
        return Promise.resolve(null);
      }
      if (inFlight < max && waiters.size === 0) return Promise.resolve(permit());
      return new Promise((resolve) => {
        const token = {};
        if (!signal) {
          waiters.set(token, { resolve });
          return;
        }
        const onAbort = () => {
          if (!waiters.delete(token)) return;
          signal.removeEventListener('abort', onAbort);
          cancelled++;
          resolve(null);
        };
        waiters.set(token, { resolve, signal, onAbort });
        signal.addEventListener('abort', onAbort, { once: true });
      });
    },
    tryAcquire(): BackgroundDbPermit | null {
      // Never jump ahead of an older asynchronous waiter.
      if (inFlight >= max || waiters.size > 0) {
        refused++;
        return null;
      }
      return permit();
    },
    stats(): BackgroundDbGateStats {
      return {
        inFlight,
        waiting: waiters.size,
        max,
        configuredHeadroom: Math.max(0, poolMax - max),
        acquired,
        refused,
        cancelled,
      };
    },
  };
}
