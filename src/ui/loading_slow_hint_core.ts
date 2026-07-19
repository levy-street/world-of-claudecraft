// Pure threshold check for the loading-screen "slow connection" hint: true
// once progress has gone quiet for longer than a normal throttled fetch takes,
// so a player on a slow/lossy connection sees a reason for the wait instead of
// a loading screen that looks frozen while the cosmetic tip keeps rotating.
export const SLOW_CONNECTION_HINT_THRESHOLD_MS = 6_000;

export function shouldShowSlowConnectionHint(
  msSinceLastProgress: number,
  thresholdMs: number = SLOW_CONNECTION_HINT_THRESHOLD_MS,
): boolean {
  return msSinceLastProgress >= thresholdMs;
}
