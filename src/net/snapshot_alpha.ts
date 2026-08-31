// The interpolation alpha between the last authoritative snapshot and the next
// one. Shared by the render loop (src/main.ts) and ClientWorld's re-anchoring of
// a new interpolation segment (src/net/online.ts) so the two can never drift.
//
// The 1.25 cap lets the display lead a late snapshot by a quarter interval
// instead of freezing; the 20ms interval floor keeps a collapsed measured
// cadence from dividing by something near zero. Before the first snapshot there
// is nothing to interpolate from, so the alpha is a full 1.
export function snapshotAlpha(nowMs: number, lastSnapAtMs: number, snapIntervalMs: number): number {
  return lastSnapAtMs > 0
    ? Math.min(1.25, (nowMs - lastSnapAtMs) / Math.max(20, snapIntervalMs))
    : 1;
}
