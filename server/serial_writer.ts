// A FIFO serializer for writes to one shared resource (e.g. the single global
// World Market JSONB row, written by both the 30s autosave and the leave path).
// Each enqueued write runs only after the previous one settles, so the writes
// execute, and therefore commit, in enqueue order. Reading the to-be-persisted
// snapshot INSIDE the write thunk then guarantees the last commit carries the
// freshest snapshot, so an out-of-order commit can never roll a shared blob back
// over a newer one. A rejecting write is surfaced to its own caller but never
// blocks the writes queued behind it.
/**
 * @param onWrite optional observer of each write's SYNCHRONOUS cost, in ms: the
 *   part of the thunk that runs before its first await. That is where the shared
 *   blob is built and stringified (the caller reads the snapshot inside the thunk,
 *   see above), and it runs on the main thread. It is deliberately measured HERE
 *   rather than at the enqueue site: `tail.then` defers the thunk to a microtask,
 *   so a timer wrapped around the enqueue call sees the bookkeeping and nothing
 *   else (measured: 0.02 ms around an enqueue whose write then blocked 250 ms).
 *   The observer never throws into the write; a throwing observer would fail a
 *   persistence write for a measurement.
 */
export function createSerialWriter<WriteContext = unknown>(
  onWrite?: (syncMs: number, context: WriteContext | undefined) => void,
): <T>(write: () => Promise<T>, context?: WriteContext) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  const timed = onWrite
    ? <T>(write: () => Promise<T>, context: WriteContext | undefined): Promise<T> => {
        const started = process.hrtime.bigint();
        try {
          return write();
        } finally {
          try {
            onWrite(Number(process.hrtime.bigint() - started) / 1e6, context);
          } catch {
            /* an observer must never break a persistence write */
          }
        }
      }
    : undefined;
  return <T>(write: () => Promise<T>, context?: WriteContext): Promise<T> => {
    const run = timed
      ? tail.then(
          () => timed(write, context),
          () => timed(write, context),
        )
      : tail.then(write, write);
    tail = run.catch(() => {});
    return run;
  };
}

// The per-key variant: one FIFO per key (e.g. one per character id), with the
// same ordering and error contract as createSerialWriter (a rejecting write
// surfaces to its own caller, exactly once, and never blocks or poisons the
// writes queued behind it), plus cleanup: a key's entry is dropped once its
// last write settles, so a map keyed by characters that come and go does not
// grow without bound. GameServer's per-character save queue rides this, and
// so does every out-of-band durable character write (the marketplace escrow
// persist): sharing one FIFO per character is what makes commit order equal
// enqueue order across ALL of a character's writers, so a snapshot serialized
// inside a queued write can never be overtaken by a staler one committing
// later.
//
// TWO RULES for writes on this queue, both deadlock edges Postgres can never
// see because they live in the promise chain:
// - a write must never await another enqueue for its OWN key (self-deadlock;
//   the kickSession note inside GameServer.saveCharacter is the precedent);
// - the established cross-queue order is character FIFO FIRST, then the
//   market serial writer, and never an enqueue from inside a market thunk or
//   while holding a pool client / open transaction.
export interface KeyedSerialWriter<K> {
  enqueue<T>(key: K, write: () => Promise<T>): Promise<T>;
  /** Queue a write that may be cancelled only until it starts. A queued
   * abort rejects immediately with KeyedSerialWriteAborted and unlinks the
   * write without disturbing surviving FIFO order. Once the write starts,
   * its AbortSignal is detached and the write owns its normal result. */
  enqueueCancellable<T>(key: K, signal: AbortSignal, write: () => Promise<T>): Promise<T>;
  /** How many keys hold a running or queued write right now (the leak pin:
   *  a drained key must not retain its entry). Production caller: the
   *  woc_character_save_pending_keys gauge (server/http/game_metrics.ts)
   *  reads it off GameServer's character-save queue at scrape time. */
  pendingKeys(): number;
}

/** Stable rejection from enqueueCancellable when cancellation wins before start. */
export class KeyedSerialWriteAborted extends Error {
  readonly code = 'KEYED_SERIAL_WRITE_ABORTED' as const;

  constructor() {
    super('keyed serial write aborted before starting');
    this.name = 'KeyedSerialWriteAborted';
  }
}

type KeyedWriteState = 'queued' | 'running' | 'settled';

interface KeyedWriteQueue<K> {
  readonly key: K;
  head: KeyedWriteEntry<K> | null;
  tail: KeyedWriteEntry<K> | null;
  running: boolean;
  startScheduled: boolean;
}

interface KeyedWriteEntry<K> {
  readonly queue: KeyedWriteQueue<K>;
  readonly write: () => Promise<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
  previous: KeyedWriteEntry<K> | null;
  next: KeyedWriteEntry<K> | null;
  state: KeyedWriteState;
  signal: AbortSignal | null;
  onAbort: (() => void) | null;
}

// createSerialWriter with a depth watch: counts writes queued-or-running and
// warns (rate-limited to once a minute) past `warnDepth`. GameServer's shared
// market writer rides this so a dirty-book autosave pile-up is loud before it
// becomes save latency; the message is the wrapper's one behavior, so it is
// caller-supplied and unchanged by this move. `onWrite` observes the same
// synchronous write window createSerialWriter reports, applied here because the
// inner keyed writer takes no observer of its own.
export interface DepthWarnedSerialWriter<WriteContext = unknown> {
  <T>(write: () => Promise<T>, context?: WriteContext): Promise<T>;
  /** Cancel a queued shared-resource write before it starts. Once running, the
   *  job receives the caller-owned signal and owns active-I/O cancellation. */
  enqueueCancellable<T>(
    signal: AbortSignal,
    write: () => Promise<T>,
    context?: WriteContext,
  ): Promise<T>;
}

export function createDepthWarnedSerialWriter<WriteContext = unknown>(
  warnDepth: number,
  message: (depth: number) => string,
  onWrite?: (syncMs: number, context: WriteContext | undefined) => void,
): DepthWarnedSerialWriter<WriteContext> {
  const writer = createKeyedSerialWriter<'shared'>();
  // Same contract as createSerialWriter's own shim: time the SYNCHRONOUS window
  // only (the finally runs when write() returns its promise, not when that
  // promise settles), and never let an observer throw into a persistence write.
  const observed = <T>(
    write: () => Promise<T>,
    context: WriteContext | undefined,
  ): (() => Promise<T>) => {
    if (!onWrite) return write;
    return () => {
      const started = process.hrtime.bigint();
      try {
        return write();
      } finally {
        try {
          onWrite(Number(process.hrtime.bigint() - started) / 1e6, context);
        } catch {
          /* an observer must never break a persistence write */
        }
      }
    };
  };
  let depth = 0;
  let lastWarnMs = 0;
  const track = <T>(enqueue: () => Promise<T>): Promise<T> => {
    depth++;
    if (depth > warnDepth && Date.now() - lastWarnMs > 60_000) {
      lastWarnMs = Date.now();
      console.warn(message(depth));
    }
    return enqueue().finally(() => {
      depth--;
    });
  };
  const enqueue = (<T>(write: () => Promise<T>, context?: WriteContext): Promise<T> =>
    track(() =>
      writer.enqueue('shared', observed(write, context)),
    )) as DepthWarnedSerialWriter<WriteContext>;
  enqueue.enqueueCancellable = <T>(
    signal: AbortSignal,
    write: () => Promise<T>,
    context?: WriteContext,
  ): Promise<T> =>
    track(() => writer.enqueueCancellable('shared', signal, observed(write, context)));
  return enqueue;
}

export function createKeyedSerialWriter<K>(): KeyedSerialWriter<K> {
  const queues = new Map<K, KeyedWriteQueue<K>>();

  const detachAbort = (entry: KeyedWriteEntry<K>): void => {
    if (entry.signal && entry.onAbort) {
      entry.signal.removeEventListener('abort', entry.onAbort);
    }
    entry.signal = null;
    entry.onAbort = null;
  };

  const deleteQueueIfEmpty = (queue: KeyedWriteQueue<K>): void => {
    if (queue.head === null && queues.get(queue.key) === queue) queues.delete(queue.key);
  };

  const unlink = (entry: KeyedWriteEntry<K>): void => {
    const { queue, previous, next } = entry;
    if (previous) previous.next = next;
    else queue.head = next;
    if (next) next.previous = previous;
    else queue.tail = previous;
    entry.previous = null;
    entry.next = null;
  };

  const scheduleStart = (queue: KeyedWriteQueue<K>): void => {
    if (queue.running || queue.startScheduled || queue.head === null) return;
    queue.startScheduled = true;
    void Promise.resolve().then(() => {
      queue.startScheduled = false;
      startNext(queue);
    });
  };

  const settleRunning = (
    entry: KeyedWriteEntry<K>,
    outcome: { ok: true; value: unknown } | { ok: false; error: unknown },
  ): void => {
    if (entry.state !== 'running') return;
    const { queue } = entry;
    entry.state = 'settled';
    queue.running = false;
    unlink(entry);
    if (queue.head) scheduleStart(queue);
    else deleteQueueIfEmpty(queue);
    if (outcome.ok) entry.resolve(outcome.value);
    else entry.reject(outcome.error);
  };

  function startNext(queue: KeyedWriteQueue<K>): void {
    if (queue.running) return;
    const entry = queue.head;
    if (!entry) {
      deleteQueueIfEmpty(queue);
      return;
    }
    queue.running = true;
    entry.state = 'running';
    detachAbort(entry);
    let running: Promise<unknown>;
    try {
      running = entry.write();
    } catch (error) {
      settleRunning(entry, { ok: false, error });
      return;
    }
    void Promise.resolve(running).then(
      (value) => settleRunning(entry, { ok: true, value }),
      (error: unknown) => settleRunning(entry, { ok: false, error }),
    );
  }

  const cancelQueued = (entry: KeyedWriteEntry<K>): void => {
    if (entry.state !== 'queued') return;
    const { queue } = entry;
    entry.state = 'settled';
    detachAbort(entry);
    unlink(entry);
    if (queue.head) scheduleStart(queue);
    else deleteQueueIfEmpty(queue);
    entry.reject(new KeyedSerialWriteAborted());
  };

  const enqueue = <T>(key: K, signal: AbortSignal | null, write: () => Promise<T>): Promise<T> => {
    let resolvePromise!: (value: T | PromiseLike<T>) => void;
    let rejectPromise!: (error: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    let queue = queues.get(key);
    if (!queue) {
      queue = { key, head: null, tail: null, running: false, startScheduled: false };
      queues.set(key, queue);
    }
    const entry: KeyedWriteEntry<K> = {
      queue,
      write,
      resolve: (value) => resolvePromise(value as T),
      reject: rejectPromise,
      previous: queue.tail,
      next: null,
      state: 'queued',
      signal,
      onAbort: null,
    };
    if (queue.tail) queue.tail.next = entry;
    else queue.head = entry;
    queue.tail = entry;

    if (signal) {
      entry.onAbort = () => cancelQueued(entry);
      signal.addEventListener('abort', entry.onAbort, { once: true });
      if (signal.aborted) entry.onAbort();
    }
    scheduleStart(queue);
    return promise;
  };

  return {
    enqueue<T>(key: K, write: () => Promise<T>): Promise<T> {
      return enqueue(key, null, write);
    },
    enqueueCancellable<T>(key: K, signal: AbortSignal, write: () => Promise<T>): Promise<T> {
      return enqueue(key, signal, write);
    },
    pendingKeys(): number {
      return queues.size;
    },
  };
}
