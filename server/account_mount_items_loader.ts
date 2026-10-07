// One process-wide SQL budget for full join hydration. Periodic refresh has
// its own serial admission behind the realm's major-background-work gate.
// Four active account reads, at most 512 queued accounts, and one promise per
// account. Queued accounts wait at most two seconds; excess or expired reads
// reject and can retry on the normal cadence. The existing query timeout bounds
// active SQL separately, so a slow pool cannot strand a login in a long FIFO.
// Queue operations use a Map FIFO, never an O(queue length) Array.shift.
import type { AccountMountItemsRow } from './account_mount_items_core';
import { loadAccountMountItems } from './account_mount_items_db';
import { captureAccountMountItemsHydration } from './account_mount_items_hydration';

export const ACCOUNT_MOUNT_ITEMS_MAX_READS = 4;
export const ACCOUNT_MOUNT_ITEMS_MAX_PENDING = 512;
export const ACCOUNT_MOUNT_ITEMS_QUEUE_TIMEOUT_MS = 2_000;
type Loader = (accountId: number) => Promise<AccountMountItemsRow[]>;
interface Flight {
  promise: Promise<AccountMountItemsRow[]>;
  resolve(rows: AccountMountItemsRow[]): void;
  reject(err: unknown): void;
  queueTimer?: ReturnType<typeof setTimeout>;
}

/** No TTL: ownership is revocable, so only concurrent requests coalesce. */
export function createAccountMountItemsLoader(
  raw: Loader,
  options: { queueTimeoutMs?: number } = {},
): Loader {
  const flights = new Map<number, Flight>();
  const pending = new Map<number, Flight>();
  let active = 0;

  const drain = (): void => {
    while (active < ACCOUNT_MOUNT_ITEMS_MAX_READS && pending.size > 0) {
      const next = pending.entries().next().value;
      if (!next) return;
      const [accountId, flight] = next;
      pending.delete(accountId);
      clearTimeout(flight.queueTimer);
      active++;
      const stamp = captureAccountMountItemsHydration(accountId);
      const finish = (err: unknown, rows?: AccountMountItemsRow[]): void => {
        active--;
        flights.delete(accountId);
        if (rows) flight.resolve(rows);
        else flight.reject(err);
        drain();
      };
      try {
        void raw(accountId).then(
          (rows) => finish(undefined, stamp(rows)),
          (err) => finish(err),
        );
      } catch (err) {
        finish(err);
      }
    }
  };

  return (accountId) => {
    const current = flights.get(accountId);
    if (current) return current.promise;
    if (pending.size >= ACCOUNT_MOUNT_ITEMS_MAX_PENDING) {
      return Promise.reject(new Error('account mount item read queue is full'));
    }
    let resolve!: Flight['resolve'];
    let reject!: Flight['reject'];
    const promise = new Promise<AccountMountItemsRow[]>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    const flight: Flight = { promise, resolve, reject };
    flights.set(accountId, flight);
    pending.set(accountId, flight);
    drain();
    if (pending.has(accountId)) {
      flight.queueTimer = setTimeout(() => {
        if (pending.get(accountId) !== flight) return;
        pending.delete(accountId);
        flights.delete(accountId);
        flight.reject(new Error('account mount item read queue timed out'));
      }, options.queueTimeoutMs ?? ACCOUNT_MOUNT_ITEMS_QUEUE_TIMEOUT_MS);
    }
    return promise;
  };
}

export const loadAccountMountItemsBounded = createAccountMountItemsLoader(loadAccountMountItems);
