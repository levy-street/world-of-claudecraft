// Which members of the streamed-prewarm diagnostic lists a perf report can
// afford to carry, and which ones are worth carrying.
//
// Sizing, measured by projecting a real capture through the report's own field
// mapping (the capture: tmp/load_probe-shader-memory-probes-insane-vsync-cold.json,
// 27 compile units, 32 manifest entries, 12 pacing transitions; the artifact is
// a local probe dump, not committed, so treat the figures as the recorded
// provenance of this decision rather than a reproducible fixture): a compile
// unit costs about 280 bytes, a manifest entry about 190, a transition 115.
// The pre-existing prewarm summary (32 manifest entries plus the resume block)
// is already about 7 KB of the server's 16 KB raw-summary budget, and the rest
// of rawSummary takes several more. Carrying 32 compile units would add ~9 KB
// on its own, pushing every report of a session that actually compiled over
// the cap and into the compact path, which is exactly where these fields would
// be dropped: the diagnostic would be missing precisely when it is interesting.
//
// So the lists are SAMPLES, and the sampling picks the informative members
// rather than the first ones:
//   - compile units: every failure first (a failed unit is the signal), then
//     the slowest by synchronous time, which is what a hitch is made of;
//   - pacing transitions: the most RECENT, which carry the end state;
//   - budget variants: the first, since they enumerate a fixed level ladder in
//     a meaningful order and are all equally interesting.
// Selected members are emitted back in their original order, so a reader still
// sees a timeline rather than a ranking.

/** Per-list caps for the verbatim report path. */
export const PREWARM_REPORT_COMPILE_UNITS = 12;
export const PREWARM_REPORT_BUDGET_VARIANTS = 8;
export const PREWARM_REPORT_TRANSITIONS = 12;

/** The fields the compile-unit sampling ranks on. */
export interface SampledCompileUnit {
  failedAtMs?: number | null;
  syncMs?: number | null;
  settledDurationMs?: number | null;
}

/**
 * The most diagnostic `limit` compile units, in their original order.
 * Failures rank above everything; the rest rank by synchronous time, then by
 * settle duration, so a tie between two zero-cost units is broken stably.
 */
export function sampleCompileUnits<T extends SampledCompileUnit>(
  units: readonly T[],
  limit = PREWARM_REPORT_COMPILE_UNITS,
): T[] {
  if (units.length <= limit) return [...units];
  const ranked = units.map((unit, index) => ({ unit, index }));
  ranked.sort((a, b) => {
    const failed = Number(b.unit.failedAtMs != null) - Number(a.unit.failedAtMs != null);
    if (failed !== 0) return failed;
    const sync = (b.unit.syncMs ?? 0) - (a.unit.syncMs ?? 0);
    if (sync !== 0) return sync;
    const settled = (b.unit.settledDurationMs ?? 0) - (a.unit.settledDurationMs ?? 0);
    if (settled !== 0) return settled;
    return a.index - b.index;
  });
  return ranked
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.unit);
}

/** The most recent `limit` pacing transitions, oldest first. */
export function sampleTransitions<T>(units: readonly T[], limit = PREWARM_REPORT_TRANSITIONS): T[] {
  return units.length <= limit ? [...units] : units.slice(units.length - limit);
}

/**
 * Whether a report should carry the heavy streamed-prewarm lists at all.
 *
 * The prewarm snapshot is a BOOT event that the renderer retains, so every
 * later beacon (one per 5 minutes, for the session's lifetime) would otherwise
 * re-send the same few KB describing the same one-time work. Measured, that is
 * about 6.6 KB of a roughly 15.3 KB realistic report against a 16 KB server cap:
 * the repetition is most of the headroom.
 *
 * It is NOT simply "first report only": the background resume lane can still
 * finish units after the first beacon, which genuinely changes the block. So
 * the rule is emit-on-change, keyed on the content itself.
 *
 * The cheap scalar counters are unaffected and ride every report as before.
 *
 * Consulting and recording are SEPARATE, for the same reason the retained
 * worst 10 s window drains only in the success branch (ruling R5): a report
 * that is built but never delivered must not count as sent. Otherwise a failed
 * first beacon would suppress the block for the rest of the session and stamp
 * `prewarmListsUnchanged` pointing a reader at a row that never landed.
 */
export interface PrewarmHeavyListGate {
  /**
   * True when this report should carry the lists. Records NOTHING, so it is
   * safe to build a payload that is then dropped, rejected, or retried.
   */
  peek(fingerprint: string): boolean;
  /** Record a fingerprint as DELIVERED. Call only once the post succeeded. */
  commit(fingerprint: string): void;
  /** Forget what was sent (a new session, or a test). */
  reset(): void;
}

export function createPrewarmHeavyListGate(): PrewarmHeavyListGate {
  let sent: string | null = null;
  return {
    peek: (fingerprint) => fingerprint !== sent,
    commit: (fingerprint) => {
      sent = fingerprint;
    },
    reset: () => {
      sent = null;
    },
  };
}
