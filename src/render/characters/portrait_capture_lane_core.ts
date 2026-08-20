// In-flight dedupe for the LIVE portrait captures (portrait.ts). The live
// getters answer null on a cache miss and kick the async capture instead of
// blocking the calling frame, so the same key can be asked for many times
// before the first capture lands: a crowd of twenty same-class players asks
// once per player per frame, and every one of those asks would mint its own
// offscreen visual, upload and encode.
//
// The host owns the rig, the cache and the update listeners; this core owns
// only the "one capture per key at a time" rule, the cooldown a key that
// captured nothing backs off on, and the guarantee that a capture's failure
// can never escape into the caller's frame.

/** First cooldown after a capture that cached nothing, doubling per further
 *  consecutive failure and capped at {@link PORTRAIT_CAPTURE_RETRY_MAX_MS}. A
 *  key that can never cache (an absent GLB, a canvas that cannot encode) is
 *  asked again by the very next frame, because every live consumer asks once
 *  per frame while it draws its fallback: with no cooldown that key loops a 43
 *  to 201 ms capture forever. */
export const PORTRAIT_CAPTURE_RETRY_BASE_MS = 1_000;
export const PORTRAIT_CAPTURE_RETRY_MAX_MS = 60_000;

interface PortraitCaptureLane {
  /** Start `capture` for `key` unless one is already running for that key or
   *  the key is inside its failure cooldown. `capture` resolves TRUE when it
   *  cached a portrait; a false or rejected resolution arms the next cooldown
   *  step. The cooldown is measured from this ASK, not from the settle: a
   *  capture is bounded and short next to the smallest cooldown, and this is
   *  the clock reading the caller already holds. */
  request(key: string, nowMs: number, capture: () => Promise<boolean>): void;
  /** True while a capture for `key` is running. */
  pending(key: string): boolean;
  /** True while `key` is backing off, so an ask answers its fallback and
   *  starts nothing. */
  coolingDown(key: string, nowMs: number): boolean;
  /** Forget every in-flight key AND every cooldown (a graphics rebuild swapped
   *  the rig, so the captures still running commit nothing and must not block
   *  the retries, and a key that failed against the old rig deserves a fresh
   *  attempt against the new one). */
  clear(): void;
}

interface FailureState {
  count: number;
  readyAtMs: number;
}

export function createPortraitCaptureLane(): PortraitCaptureLane {
  const inFlight = new Map<string, Promise<void>>();
  const failures = new Map<string, FailureState>();

  const cooldownMs = (count: number): number =>
    Math.min(PORTRAIT_CAPTURE_RETRY_MAX_MS, PORTRAIT_CAPTURE_RETRY_BASE_MS * 2 ** (count - 1));

  const noteSettled = (key: string, cached: boolean, nowMs: number): void => {
    if (cached) {
      failures.delete(key);
      return;
    }
    const count = (failures.get(key)?.count ?? 0) + 1;
    failures.set(key, { count, readyAtMs: nowMs + cooldownMs(count) });
  };

  return {
    request(key, nowMs, capture) {
      if (inFlight.has(key)) return;
      const failure = failures.get(key);
      if (failure && nowMs < failure.readyAtMs) return;
      // The key is claimed BEFORE `capture` runs (it is invoked from a
      // microtask), so work started by the capture itself, or by a listener it
      // fires, cannot slip a second capture past the check above.
      const run = Promise.resolve()
        .then(capture)
        // A rejected capture is not the caller's problem: it counts as a
        // failure like an uncached one, and never surfaces as an unhandled
        // rejection.
        .catch(() => false)
        .then((cached) => {
          // Only retire OUR entry, and only score OUR outcome: clear() plus a
          // fresh ask can have replaced it while this capture was still
          // running, and a superseded capture must neither free the key the
          // new one holds nor back that key off.
          if (inFlight.get(key) !== run) return;
          noteSettled(key, cached === true, nowMs);
          inFlight.delete(key);
        });
      inFlight.set(key, run);
    },
    pending: (key) => inFlight.has(key),
    coolingDown(key, nowMs): boolean {
      const failure = failures.get(key);
      return failure !== undefined && nowMs < failure.readyAtMs;
    },
    clear: () => {
      inFlight.clear();
      failures.clear();
    },
  };
}
