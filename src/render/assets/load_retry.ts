// Retry policy for boot-time asset fetches (glTF/HDR/texture). A single
// transient network blip (common on mobile connections) must not permanently
// fail the whole `assetsReady()` gate and strand the player on the loading
// screen with no recourse but "Return to Login".
export const MAX_LOAD_ATTEMPTS = 3;

/** Delay before the given retry attempt (1-indexed: the delay before the
 *  2nd, 3rd, ... try). Fixed schedule, no randomness, so tests stay exact. */
export function retryDelayMs(attempt: number): number {
  return 400 * attempt;
}
