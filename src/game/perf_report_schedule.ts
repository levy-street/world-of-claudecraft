const PERF_REPORT_JITTER_RATIO = 0.1;

function stableHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Spreads otherwise synchronized fleet reports around their nominal cadence.
 * The delay is deterministic for a session and sequence, so a reload does not
 * turn scheduling into a new source of random timer churn.
 */
export function jitteredPerfReportDelay(
  baseMs: number,
  sessionId: string,
  sequence: number,
): number {
  if (!Number.isFinite(baseMs) || baseMs <= 0) return 0;
  const normalizedSequence = Number.isFinite(sequence) ? Math.max(0, Math.floor(sequence)) : 0;
  const unit = stableHash(`${sessionId}:${normalizedSequence}`) / 0xffffffff;
  const factor = 1 - PERF_REPORT_JITTER_RATIO + unit * PERF_REPORT_JITTER_RATIO * 2;
  return Math.max(0, Math.round(baseMs * factor));
}

export const perfReportScheduleInternalsForTest = {
  PERF_REPORT_JITTER_RATIO,
};
