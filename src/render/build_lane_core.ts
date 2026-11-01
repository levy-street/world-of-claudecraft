// PURE (unit-tested, Three-free, DOM-free): the bounded-concurrency runner the
// zone build uses to keep a worker pool fed.
//
// Submission follows the order the caller supplies and never reorders it; the
// zone build uses the PULL form (runBoundedPull), which asks for each next cell
// only when a slot frees, so its order can follow a player who walks into the
// zone mid-build (chunk_residency_core.createCellBuildQueue). runBoundedLane is
// the same runner over a fixed list. Only COMPLETION is unordered: whichever
// worker finishes first attaches first. `limit` is the pool's worker count, so
// exactly as many jobs are in flight as there are threads to run them; a plain
// sequential await would leave every worker but one idle, and an unbounded
// fan-out would post the whole zone at once and lose the arrival order.
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
  let i = 0;
  await runBoundedPull(
    () => (i < items.length ? { item: items[i++] } : undefined),
    limit,
    start,
    opts,
  );
}

/**
 * The pull form of runBoundedLane: `next` is asked for the next item only once
 * a slot is free, never ahead of time, so a caller whose priority changes while
 * the lane runs (the zone build following the player) decides each submission
 * with current information. Same limit, stop and error contract; an undefined
 * result ends the lane.
 */
export async function runBoundedPull<T>(
  next: () => { item: T } | undefined,
  limit: number,
  start: (item: T, index: number) => Promise<void>,
  opts?: BoundedLaneOptions,
): Promise<void> {
  const max = Math.max(1, Math.floor(limit));
  const inFlight = new Set<Promise<void>>();
  for (let i = 0; ; i++) {
    if (opts?.shouldStop?.()) break;
    const pulled = next();
    if (!pulled) break;
    const index = i;
    const job: Promise<void> = start(pulled.item, index)
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
