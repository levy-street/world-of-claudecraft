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
//        node scripts/ci_shard_weights_harvest.mjs --carry-local \
//             [--reason "<why>"] tests/foo.test.ts=<ms>,<ms>,<ms> [more...]
//   The between-harvests mode: a test file CI has not measured yet (a release
//   sync or a phase added it) gets a row at the MEDIAN of the runs given, plus
//   a machine-readable `local-median` attribution in __provenance.carried
//   naming every run, the date, and the REASON the row is carried rather than
//   harvested (default: the Phase 18 pending-harvest reason). It refuses to
//   touch a harvested row, so a local measurement can never overwrite a CI
//   weight, and it refuses to write a table that fails carriedDefects. Before
//   Phase 18 this carrying happened by hand and was disclosed in prose only,
//   which is how 410 rows reached the committed table with nothing
//   machine-checking that they were real measurements
//   (scripts/lib/ci_shard_weight_carry.mjs states the contract).
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

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { MEASURED_FALLBACK_MS } from './ci_shard_partition.mjs';
import {
  applyLocalCarry,
  carriedDefects,
  missingWeightFiles,
  parseCarryLocalArgs,
  parseCarryLocalCli,
  serializeWeightTable,
  tableRows,
} from './lib/ci_shard_weight_carry.mjs';
import { parseWeightLines } from './lib/ci_shard_weight_parse.mjs';

const target = resolve(import.meta.dirname, 'ci_shard_weights.generated.json');
const ROOT = dirname(import.meta.dirname);
const today = () => new Date().toISOString().slice(0, 10);

if (process.argv[2] === '--carry-local') {
  // Both refusals below are ordinary operator mistakes (a mistyped token, a
  // file CI already measured), so they read as one line, not a stack trace.
  let measurements;
  let out;
  let reason = '';
  try {
    const cli = parseCarryLocalCli(process.argv.slice(3));
    reason = cli.reason;
    measurements = parseCarryLocalArgs(cli.tokens);
    const table = JSON.parse(readFileSync(target, 'utf8'));
    out = applyLocalCarry(table, measurements, { measured: today(), reason });
  } catch (err) {
    console.error(`[carry-local] ${err instanceof Error ? err.message : String(err)}`);
    console.error('usage: node scripts/ci_shard_weights_harvest.mjs --carry-local <path>=<ms>,...');
    process.exit(1);
  }
  // Refuse to WRITE a table that would red the committed-table pin. The
  // fallback is read off the table as it stands (the constant is derived at
  // import time), which a handful of new rows cannot move materially; the
  // authoritative check is tests/ci_shard_partition.test.ts over what lands.
  const defects = carriedDefects(out, { fallbackMs: MEASURED_FALLBACK_MS, requireMap: true });
  if (defects.length > 0) {
    console.error('[carry-local] refusing to write; the result fails its own contract:');
    for (const d of defects) console.error(`  ${d}`);
    process.exit(1);
  }
  writeFileSync(target, serializeWeightTable(out));
  for (const m of measurements) {
    console.log(`[carry-local] ${m.file}: ${out[m.file]} ms (median of ${m.runs.join(', ')})`);
  }
  console.log(`[carry-local] reason recorded on each row: "${reason}"`);
  console.log(`[carry-local] wrote ${tableRows(out).length} rows to ${target}`);
  process.exit(0);
}

if (process.argv[2] === '--carry-local-missing') {
  // The phase-close step. Enumerates every walked test file the table does not
  // measure, runs each `runs` times, and reads each duration from the SAME
  // reporter line the CI harvest parses (lib/ci_shard_weight_parse.mjs), so a
  // locally carried weight and a harvested one mean the same thing. Then it
  // hands the medians to the ordinary --carry-local path, contract check and
  // all. Enumerated, never hand-listed: a file a late unit added cannot be
  // missed, and re-running after more suites land is idempotent for the files
  // already carried (it re-measures and replaces their attribution).
  let reason;
  try {
    ({ reason } = parseCarryLocalCli(
      process.argv.slice(3).filter((a, i, all) => a !== '--runs' && all[i - 1] !== '--runs'),
    ));
  } catch (err) {
    console.error(`[carry-missing] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  const runsAt = process.argv.indexOf('--runs');
  const runsPer = runsAt >= 0 ? Number(process.argv[runsAt + 1]) : 3;
  if (!Number.isInteger(runsPer) || runsPer < 1) {
    console.error('[carry-missing] --runs must be a positive integer');
    process.exit(1);
  }
  const { walkShardTestFiles } = await import('./lib/ci_shard_walk.mjs');
  const { MEASURED_WEIGHTS } = await import('./ci_shard_partition.mjs');
  const missing = missingWeightFiles(walkShardTestFiles(ROOT), MEASURED_WEIGHTS);
  if (missing.length === 0) {
    console.log('[carry-missing] every walked test file already has a weight; nothing to do');
    process.exit(0);
  }
  console.log(`[carry-missing] ${missing.length} unmeasured files, ${runsPer} runs each`);
  const tokens = [];
  for (const file of missing) {
    const runs = [];
    for (let i = 0; i < runsPer; i++) {
      // --reporter=default explicitly: vitest's summary-only output prints no
      // per-file line for a passing run, and the per-file line IS the
      // measurement (the same one parseWeightLines reads out of a CI log).
      const out = spawnSync('npx', ['vitest', 'run', file, '--reporter=default'], {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      const parsed = parseWeightLines(`${out.stdout ?? ''}\n${out.stderr ?? ''}`);
      const ms = parsed[file];
      if (!Number.isInteger(ms) || ms <= 0) {
        console.error(
          `[carry-missing] ${file}: run ${i + 1} printed no parsable duration; measure it by ` +
            'hand and carry it with --carry-local rather than guessing a weight',
        );
        process.exit(1);
      }
      runs.push(ms);
    }
    console.log(`[carry-missing] ${file}: ${runs.join(', ')}`);
    tokens.push(`${file}=${runs.join(',')}`);
  }
  const table = JSON.parse(readFileSync(target, 'utf8'));
  const out = applyLocalCarry(table, parseCarryLocalArgs(tokens), {
    measured: today(),
    reason,
  });
  const defects = carriedDefects(out, { fallbackMs: MEASURED_FALLBACK_MS, requireMap: true });
  if (defects.length > 0) {
    console.error('[carry-missing] refusing to write; the result fails its own contract:');
    for (const d of defects) console.error(`  ${d}`);
    process.exit(1);
  }
  writeFileSync(target, serializeWeightTable(out));
  console.log(`[carry-missing] reason recorded on each row: "${reason}"`);
  console.log(`[carry-missing] carried ${tokens.length} rows; ${tableRows(out).length} total`);
  process.exit(0);
}

const runId = process.argv[2];
if (!runId || !/^\d+$/.test(runId)) {
  console.error('usage: node scripts/ci_shard_weights_harvest.mjs <run-id>');
  console.error('       node scripts/ci_shard_weights_harvest.mjs --carry-local <path>=<ms>,...');
  console.error(
    '       node scripts/ci_shard_weights_harvest.mjs --carry-local-missing [--runs N]',
  );
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
    harvested: today(),
    files: Object.keys(sorted).length,
    // A wholesale harvest MEASURED every row it wrote, so it declares the
    // attribution rather than leaving the map absent for the next union to
    // infer: harvestedFiles equals the row count and nothing is carried.
    harvestedFiles: Object.keys(sorted).length,
    carried: {},
  },
  ...sorted,
};
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
    // The keys THIS script writes (including the Phase 18 attribution pair);
    // anything else is a shape the advisory above could not read.
    Object.keys(provenance).some(
      (k) => !['run', 'harvested', 'files', 'harvestedFiles', 'carried'].includes(k),
    )
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
writeFileSync(target, serializeWeightTable(out));
console.log(`[harvest] wrote ${Object.keys(sorted).length} weights to ${target}`);
