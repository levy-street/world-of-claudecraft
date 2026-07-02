// The offline sim wants the wall-clock UTC day (delve daily reset) but must not
// read the clock itself, so the frame loop supplies it. Building the string is a
// Date allocation plus an ISO serialization; at 60 Hz that is pure churn for a
// value that changes once a day, so cache it and re-derive at most once a second.
let cachedDay = '';
let nextRefreshAtMs = 0;

/** Current UTC day as `YYYY-MM-DD`, recomputed at most once per second. */
export function currentUtcDay(): string {
  const now = Date.now();
  if (now >= nextRefreshAtMs) {
    cachedDay = new Date(now).toISOString().slice(0, 10);
    nextRefreshAtMs = now + 1000;
  }
  return cachedDay;
}
