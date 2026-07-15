// Full-jitter reconnect backoff over the existing exponential schedule. The
// un-jittered step for an attempt is min(maxMs, baseMs * 2 ** (attempt - 1));
// the returned delay spreads that step across a 0.5x to 1.5x band and is then
// clamped to maxMs, so many clients dropped by the same server blip do not all
// retry on the same beat (a thundering herd on the reconnect endpoint). For
// attempt >= 1 and baseMs > 0 the result is always strictly positive.
//
// rng is injected (a caller passes Math.random) purely so a test can pin the
// schedule deterministically; this module keeps no state and calls no clock or
// global randomness of its own.
export function computeBackoffDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
  rng: () => number,
): number {
  const step = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  return Math.min(maxMs, step * (0.5 + rng()));
}
