// The harvest's refusal rule (scripts/ci_shard_weights_harvest.mjs): whether
// ONE job's parsed per-file durations prove its log was read. A shard log
// that parses to nothing, or to a handful of files, is a reporter or fetch
// change (2026-08-28: `gh run view --log --job` came back empty, the harvest
// parsed zero lines and wrote an EMPTY table), never a run with nothing in
// it, so the table is not written. Extracted so the rule is fixture-tested
// instead of rotting inline like the reporter coupling before it.

/** The fewest per-file lines a `PR tests (n)` shard log can carry and still
 *  be a full-mode shard (the eight shards run 380 to 390 files each). */
export const SHARD_LOG_FILE_FLOOR = 100;

const SHARD_JOB = /PR tests \(\d+\)/;

/**
 * @param {string} jobName the CI job's name
 * @param {number} parsedFiles per-file durations parsed from that job's log
 * @returns {{ ok: boolean, reason: string }}
 */
export function shardHarvestVerdict(jobName, parsedFiles) {
  if (SHARD_JOB.test(jobName)) {
    if (parsedFiles >= SHARD_LOG_FILE_FLOOR) return { ok: true, reason: '' };
    return {
      ok: false,
      reason: `${jobName}: ${parsedFiles} per-file reporter line(s) parsed, under the ${SHARD_LOG_FILE_FLOOR} floor of a full-mode shard (a reporter or fetch change); the table is NOT written`,
    };
  }
  // The long-sim lanes and the gate job carry a handful of files each.
  if (parsedFiles > 0) return { ok: true, reason: '' };
  return {
    ok: false,
    reason: `${jobName}: no per-file reporter line parsed; the table is NOT written`,
  };
}
