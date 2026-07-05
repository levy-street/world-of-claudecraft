// A FIFO serializer for writes to one shared resource (e.g. the single global
// World Market JSONB row, written by both the 30s autosave and the leave path).
// Each enqueued write runs only after the previous one settles, so the writes
// execute, and therefore commit, in enqueue order. Reading the to-be-persisted
// snapshot INSIDE the write thunk then guarantees the last commit carries the
// freshest snapshot, so an out-of-order commit can never roll a shared blob back
// over a newer one. A rejecting write is surfaced to its own caller but never
// blocks the writes queued behind it.
export function createSerialWriter(): <T>(write: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(write: () => Promise<T>): Promise<T> => {
    const run = tail.then(write, write);
    tail = run.catch(() => {});
    return run;
  };
}
