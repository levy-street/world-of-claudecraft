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

// Auto-reconnect backoff for an unexpectedly dropped game socket. The server
// holds the character in-world (linkdead) for five minutes; the retry window
// is deliberately longer, since past the grace a successful auth simply
// performs a fresh join from the last save. Roughly 1s, 2s, 4s, 8s, then 15s
// apart, with each delay spread over a 0.5x to 1.5x jitter band and clamped at
// the 15s cap (computeBackoffDelay) so many clients dropped by one server blip
// do not retry in lockstep. The clamp trims the band's upper half once the
// schedule reaches the cap, so across 40 attempts the total runs from roughly
// 4.6 minutes (every draw at the floor) to 9.4 minutes (every draw at the
// ceiling), with an expected total near 8 minutes, before giving up for good.
// Exported for the reconnect-overlay show-grace pin (tests/reconnect_overlay
// .test.ts): the grace must clear attempt 1's full jitter band, and a band
// widened here without that pin would quietly reintroduce the veil blink.
export const RECONNECT_BASE_DELAY_MS = 1_000;
export const RECONNECT_MAX_DELAY_MS = 15_000;
export const RECONNECT_MAX_ATTEMPTS = 40;

// The game socket's schedule (ClientWorld.socketClosed): attempt N's delay over
// the constants above. rng is injected for the same reason as above.
export function reconnectBackoffDelay(attempt: number, rng: () => number): number {
  return computeBackoffDelay(attempt, RECONNECT_BASE_DELAY_MS, RECONNECT_MAX_DELAY_MS, rng);
}
