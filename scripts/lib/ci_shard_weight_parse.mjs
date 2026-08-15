// Pure parser for the CI shard-weight harvest (scripts/ci_shard_weights_harvest.mjs).
// Extracted so the reporter-format coupling is fixture-tested instead of
// rotting silently: `gh run view --log` renders ESC either as the real byte
// or as the printable two-character `^[`, per-file lines are the vitest
// reporter's `<mark> tests/<file> (N tests ...) <duration>` with ms or s
// durations, and a fully-skipped file prints the down-arrow with NO
// duration, which gets a small floor so permanently-skipped suites (the
// no-database integration files) stop falling to the unknown-file fallback.

const ANSI = new RegExp(`(${String.fromCharCode(27)}|\\^\\[)\\[[0-9;]*m`, 'g');
const RAN = /[\u2713\u2717x] (tests\/\S+\.test\.ts) \((\d+) tests?[^)]*\) ([0-9.]+)(m?s)/;
const SKIPPED = /\u2193 (tests\/\S+\.test\.ts) \((\d+) tests?[^)]*\)/;

export const SKIPPED_FILE_WEIGHT_MS = 100;

/**
 * Parse one log's text into per-file durations (ms). Where a file appears
 * more than once the MAX wins: the partition should plan for the expensive
 * occurrence.
 *
 * @param {string} logText
 * @param {Record<string, number>} [into]
 * @returns {Record<string, number>}
 */
export function parseWeightLines(logText, into = {}) {
  for (const raw of logText.split('\n')) {
    const line = raw.replace(ANSI, '');
    const ran = RAN.exec(line);
    if (ran) {
      const [, file, , val, unit] = ran;
      const ms = Math.round(Number(val) * (unit === 's' ? 1000 : 1));
      into[file] = Math.max(into[file] ?? 0, ms);
      continue;
    }
    const skipped = SKIPPED.exec(line);
    if (skipped) into[skipped[1]] = Math.max(into[skipped[1]] ?? 0, SKIPPED_FILE_WEIGHT_MS);
  }
  return into;
}
