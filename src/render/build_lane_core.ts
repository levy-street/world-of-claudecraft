// PURE (unit-tested, Three-free, DOM-free): the bounded-concurrency runner the
// zone build uses to keep a worker pool fed.
//
// A zone's cells are ordered nearest-first, and that order is the whole point of
// the ordering pass, so submission walks the list in order and never reorders
// it. Only COMPLETION is unordered: whichever worker finishes first attaches
// first. `limit` is the pool's worker count, so exactly as many jobs are in
// flight as there are threads to run them; a plain sequential await would leave
// every worker but one idle, and an unbounded fan-out would post the whole zone
// at once and lose the nearest-first arrival order entirely.
//
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts).

export interface BoundedLaneOptions {
  /** Checked before each submission, so a cancelled build stops submitting new
   *  work (jobs already in flight are still awaited: their own handler decides
   *  whether to discard the result). */
  shouldStop?: () => boolean;
  /** A job that rejects is reported here instead of aborting the lane: one
   *  failed cell must never abandon the rest of the zone. */
  onError?: (error: unknown, index: number) => void;
}

/**
 * Runs `start` over `items` in submission order with at most `limit` jobs in
 * flight, resolving once every started job has settled.
 *
 * `start`'s SYNCHRONOUS prefix (everything before its first await) runs in
 * submission order, so a caller can claim shared state there and rely on the
 * ordering.
 */
export async function runBoundedLane<T>(
  items: readonly T[],
  limit: number,
  start: (item: T, index: number) => Promise<void>,
  opts?: BoundedLaneOptions,
): Promise<void> {
  const max = Math.max(1, Math.floor(limit));
  const inFlight = new Set<Promise<void>>();
  for (let i = 0; i < items.length; i++) {
    if (opts?.shouldStop?.()) break;
    const index = i;
    const job: Promise<void> = start(items[index], index)
      .catch((error: unknown) => {
        opts?.onError?.(error, index);
      })
      .finally(() => {
        inFlight.delete(job);
      });
    inFlight.add(job);
    if (inFlight.size >= max) await Promise.race(inFlight);
  }
  await Promise.all(inFlight);
}
