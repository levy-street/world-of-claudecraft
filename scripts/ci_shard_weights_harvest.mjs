// Harvest measured per-file test durations from a green CI run into
// scripts/ci_shard_weights.generated.json, the weight table behind the LPT
// shard partition (scripts/ci_shard_partition.mjs).
//
// Usage: node scripts/ci_shard_weights_harvest.mjs <run-id>
//   <run-id> must be a COMPLETED, ALL-GREEN, FULL-MODE run of the CI
//   workflow (a selective run only covers the selected slice and would
//   silently shrink the table; the vacuity pin in
//   tests/ci_shard_partition.test.ts refuses a shrunken result).
//
// Staleness is deliberately cheap: a wrong or missing weight only unbalances
// a pack, it can never drop a file from the partition (completeness is
// structural, assertPartitionCompleteness), and unknown files fall back to
// the static heuristic. Refresh opportunistically when the suite's shape
// changes (splits, new heavy suites), not on a schedule.
//
// Parsing notes, both measured on run 31777723751 (2026-08-14): `gh run
// view --log` renders ESC as the two printable characters `^[`, so ANSI
// stripping must handle BOTH encodings; per-file lines are the vitest
// reporter's `<check> tests/<file> (N tests) <duration>` with the duration
// in ms or s. Where a file appears in several jobs (floor members), the MAX
// is kept: the partition should plan for the expensive occurrence.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseWeightLines } from './lib/ci_shard_weight_parse.mjs';

const runId = process.argv[2];
if (!runId || !/^\d+$/.test(runId)) {
  console.error('usage: node scripts/ci_shard_weights_harvest.mjs <run-id>');
  process.exit(1);
}

// Constructed, not a literal: biome's noControlCharactersInRegex forbids a
// raw ESC byte in a regex literal (recorded trap from the merged-leg round).
const jobsJson = execFileSync(
  'gh',
  ['run', 'view', runId, '--json', 'jobs', '-q', '[.jobs[] | {id: .databaseId, name, conclusion}]'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
const jobs = JSON.parse(jobsJson).filter(
  (j) => /PR tests \(\d+\)|PR long sims|PR gate/.test(j.name) && j.conclusion === 'success',
);
if (jobs.length < 10) {
  console.error(`only ${jobs.length} green test jobs on run ${runId}; need the 8 shards + 2 lanes`);
  process.exit(1);
}

/** @type {Record<string, number>} */
const weights = {};
for (const job of jobs) {
  const log = execFileSync('gh', ['run', 'view', runId, '--log', '--job', String(job.id)], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  // A selective-mode log would harvest only the selected slice; the mode
  // line the shard entry prints is the proof this run measured everything.
  if (/changes-job decision: mode=/.test(log) && !/changes-job decision: mode=full/.test(log)) {
    console.error(`[harvest] ${job.name} did not run mode=full; use a full-mode run`);
    process.exit(1);
  }
  const before = Object.keys(weights).length;
  parseWeightLines(log, weights);
  console.log(`[harvest] ${job.name}: +${Object.keys(weights).length - before} files`);
}

const sorted = Object.fromEntries(Object.entries(weights).sort(([a], [b]) => (a < b ? -1 : 1)));
const out = {
  __provenance: {
    run: runId,
    harvested: new Date().toISOString().slice(0, 10),
    files: Object.keys(sorted).length,
  },
  ...sorted,
};
const target = resolve(import.meta.dirname, 'ci_shard_weights.generated.json');
// A wholesale re-harvest replaces any locally measured rows a release sync
// merged in. The checked-in provenance uses sibling mergedLocal/mergedFiles;
// accept the older nested localMerge shape too so either table warns.
try {
  const provenance = JSON.parse(readFileSync(target, 'utf8')).__provenance;
  const measured = provenance?.mergedLocal ?? provenance?.localMerge?.measured;
  const files = provenance?.mergedFiles ?? provenance?.localMerge?.files;
  if (typeof measured === 'string' && measured && Number.isInteger(files) && files > 0) {
    console.log(
      `[harvest] replacing ${files} locally measured rows from ${measured} with CI-harvested weights`,
    );
  } else if (
    provenance &&
    typeof provenance === 'object' &&
    Object.keys(provenance).some((k) => !['run', 'harvested', 'files'].includes(k))
  ) {
    // The provenance carries keys beyond this script's own plain-harvest
    // output, but neither known local-merge shape parsed: a THIRD shape the
    // advisory above cannot see. Say so instead of silently overwriting
    // whatever locally measured rows that shape recorded.
    console.warn(
      `[harvest] unrecognized __provenance shape (keys: ${Object.keys(provenance).join(', ')}); ` +
        'the prior table may carry locally measured rows this rewrite DISCARDS. Inspect the ' +
        'old provenance before trusting the new table.',
    );
  }
} catch {
  // No prior table (or unreadable): nothing to report.
}
writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
console.log(`[harvest] wrote ${Object.keys(sorted).length} weights to ${target}`);
