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
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { shardHarvestVerdict } from './lib/ci_shard_weight_harvest_guard.mjs';
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
  let log = execFileSync('gh', ['run', 'view', runId, '--log', '--job', String(job.id)], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  // `gh run view --log --job` came back EMPTY on gh 2.8x (2026-08-28, a green
  // merge-queue run): the raw job-log endpoint still serves the full text,
  // with the same per-file reporter lines. Without this arm the harvest
  // parsed nothing and WROTE an empty table.
  if (log.trim() === '') {
    log = execFileSync('gh', ['api', `repos/{owner}/{repo}/actions/jobs/${job.id}/logs`], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
  }
  // A selective-mode log would harvest only the selected slice; the mode
  // line the shard entry prints is the proof this run measured everything.
  if (/changes-job decision: mode=/.test(log) && !/changes-job decision: mode=full/.test(log)) {
    console.error(`[harvest] ${job.name} did not run mode=full; use a full-mode run`);
    process.exit(1);
  }
  // Parsed on its own first: the refusal judges what THIS log proved, not
  // how many keys it added to a set the other jobs already filled (a log
  // truncated to a few files would otherwise pass as "+5").
  const own = parseWeightLines(log);
  const verdict = shardHarvestVerdict(job.name, Object.keys(own).length);
  if (!verdict.ok) {
    console.error(`[harvest] ${verdict.reason}`);
    process.exit(1);
  }
  const before = Object.keys(weights).length;
  for (const [file, ms] of Object.entries(own)) {
    weights[file] = Math.max(weights[file] ?? 0, ms);
  }
  const added = Object.keys(weights).length - before;
  console.log(`[harvest] ${job.name}: ${Object.keys(own).length} files parsed, +${added} new`);
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
writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
console.log(`[harvest] wrote ${Object.keys(sorted).length} weights to ${target}`);
