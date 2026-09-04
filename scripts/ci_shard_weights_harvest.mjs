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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { MEASURED_FALLBACK_MS } from './ci_shard_partition.mjs';
import {
  applyLocalCarry,
  carriedDefects,
  carriedRows,
  missingWeightFiles,
  parseCarryLocalArgs,
  parseCarryLocalCli,
  pruneMissingRows,
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
  // process.exitCode, not process.exit: the gate convention. An immediate
  // process.exit can truncate the audit lines above on a piped stdout.
  process.exitCode = 0;
} else if (process.argv[2] === '--prune-missing') {
  // The DELETION counterpart of --carry-local-missing, added 2026-09-01 under
  // masterwrought ruling qr-19-stale-client-deploy-window. Retiring a test file
  // leaves its weight row naming a path that no longer exists, and
  // tests/ci_shard_partition.test.ts reds on exactly that ('every row must name
  // a file that exists on disk': an absent-file row silently skews the pack it
  // lands in). The full harvest cannot discharge it, because that needs a green
  // all-green FULL-MODE CI run, so before this mode the only way to drop the row
  // was to hand-edit a generated table, which the repo forbids. This walks the
  // committed rows, drops the ones whose file is gone, drops their __provenance
  // carried entries with them, and re-derives __provenance.files, all through
  // the same serializeWeightTable the other modes write with.
  //
  // Deliberately NOT a measurement: it only removes, so it can never invent a
  // weight, and it refuses to write a table that fails carriedDefects.
  const table = JSON.parse(readFileSync(target, 'utf8'));
  const before = table.__provenance ?? {};
  // The refusal below tells the operator to raise the bound deliberately, so the
  // bound has to be reachable from here: without this flag that sentence names
  // an option the CLI does not offer.
  const boundAt = process.argv.indexOf('--max-drops');
  const maxDrops = boundAt >= 0 ? Number(process.argv[boundAt + 1]) : undefined;
  if (boundAt >= 0 && (!Number.isInteger(maxDrops) || maxDrops < 1)) {
    console.error('[prune-missing] --max-drops takes a positive integer');
    process.exit(1);
  }
  const {
    table: out,
    gone,
    refusal,
  } = pruneMissingRows(
    table,
    (file) => existsSync(resolve(ROOT, file)),
    maxDrops === undefined ? {} : { maxDrops },
  );
  if (refusal) {
    console.error(`[prune-missing] ${refusal}`);
    console.error(`[prune-missing] first few: ${gone.slice(0, 5).join(', ')}`);
    process.exit(1);
  }
  if (gone.length === 0) {
    console.log('[prune-missing] every measured row names a file that exists; nothing to do');
    process.exitCode = 0;
  } else {
    const defects = carriedDefects(out, { fallbackMs: MEASURED_FALLBACK_MS, requireMap: true });
    if (defects.length > 0) {
      console.error('[prune-missing] refusing to write; the result fails its own contract:');
      for (const d of defects) console.error(`  ${d}`);
      process.exit(1);
    }
    writeFileSync(target, serializeWeightTable(out));
    for (const file of gone) console.log(`[prune-missing] dropped ${file} (no longer on disk)`);
    console.log(
      `[prune-missing] wrote ${tableRows(out).length} rows to ${target} ` +
        `(__provenance.files ${before.files} -> ${out.__provenance.files}, ` +
        `harvestedFiles ${before.harvestedFiles} -> ${out.__provenance.harvestedFiles})`,
    );
    process.exitCode = 0;
  }
} else if (process.argv[2] === '--carry-local-missing') {
  // The phase-close step. Enumerates every walked test file the table does not
  // measure, runs each `runs` times, and reads each duration from the SAME
  // reporter line the CI harvest parses (lib/ci_shard_weight_parse.mjs), so a
  // locally carried weight and a harvested one mean the same thing. Then it
  // hands the medians to the ordinary --carry-local path, contract check and
  // all. Enumerated, never hand-listed: a file a late unit added cannot be
  // missed. Re-running after more suites land measures only what is still
  // unmeasured: missingWeightFiles filters on `typeof weights[f] !== 'number'`,
  // so a row already carried (or harvested) is SKIPPED, not re-measured and not
  // re-attributed. Re-measuring a carried row is --carry-local's job.
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
    process.exitCode = 0;
  } else {
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
        // The run's STATUS first, before the parser gets blamed for it. Vitest
        // prints a failed file as `tests/x.test.ts (1 test | 1 failed)`, a shape
        // the RAN regex does not match, so a RED suite used to fall through to
        // the no-duration refusal below and walk the operator into hand-carrying
        // a weight for a test file that is broken (Phase 18 QA, gate-census
        // item 4). A file with no green run has no weight to carry at all.
        if (out.error || out.status !== 0) {
          const how = out.error
            ? `could not be started (${out.error.message})`
            : out.status === null
              ? `was killed by signal ${out.signal}`
              : `FAILED with exit code ${out.status}`;
          console.error(
            `[carry-missing] ${file}: run ${i + 1} ${how}. A red or unrunnable suite has no ` +
              'weight to carry: fix the file, then re-run. Do NOT hand-carry a weight for it.',
          );
          process.exit(1);
        }
        const parsed = parseWeightLines(`${out.stdout ?? ''}\n${out.stderr ?? ''}`);
        const ms = parsed[file];
        if (!Number.isInteger(ms) || ms <= 0) {
          console.error(
            `[carry-missing] ${file}: run ${i + 1} exited 0 but printed no parsable duration; ` +
              'measure it by hand and carry it with --carry-local rather than guessing a weight',
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
    // process.exitCode, not process.exit (see --carry-local above).
    process.exitCode = 0;
  }
} else {
  const runId = process.argv[2];
  if (!runId || !/^\d+$/.test(runId)) {
    console.error('usage: node scripts/ci_shard_weights_harvest.mjs <run-id>');
    console.error('       node scripts/ci_shard_weights_harvest.mjs --carry-local <path>=<ms>,...');
    console.error(
      '       node scripts/ci_shard_weights_harvest.mjs --carry-local-missing [--runs N]',
    );
    console.error(
      '       node scripts/ci_shard_weights_harvest.mjs --prune-missing [--max-drops N]',
    );
    process.exit(1);
  }

  // Constructed, not a literal: biome's noControlCharactersInRegex forbids a
  // raw ESC byte in a regex literal (recorded trap from the merged-leg round).
  const jobsJson = execFileSync(
    'gh',
    [
      'run',
      'view',
      runId,
      '--json',
      'jobs',
      '-q',
      '[.jobs[] | {id: .databaseId, name, conclusion}]',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const jobs = JSON.parse(jobsJson).filter(
    (j) => /PR tests \(\d+\)|PR long sims|PR gate/.test(j.name) && j.conclusion === 'success',
  );
  if (jobs.length < 10) {
    console.error(
      `only ${jobs.length} green test jobs on run ${runId}; need the 8 shards + 2 lanes`,
    );
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
  // A wholesale re-harvest replaces every carried row with a CI measurement.
  // Report the current machine-readable map before overwriting it, and warn on
  // unknown provenance fields rather than silently discarding a future shape.
  try {
    const prior = JSON.parse(readFileSync(target, 'utf8'));
    const provenance = prior.__provenance;
    const carriedFiles = Object.keys(carriedRows(prior)).length;
    if (carriedFiles > 0) {
      console.log(`[harvest] replacing ${carriedFiles} carried weights with CI-harvested weights`);
    }
    const known = new Set(['run', 'harvested', 'files', 'harvestedFiles', 'carried', 'backfill']);
    const unknown =
      provenance && typeof provenance === 'object'
        ? Object.keys(provenance).filter((key) => !known.has(key))
        : [];
    if (unknown.length > 0) {
      console.warn(
        `[harvest] unrecognized __provenance shape (keys: ${Object.keys(provenance).join(', ')}); ` +
          'the prior table may carry weights this rewrite DISCARDS. Inspect the old provenance ' +
          'before trusting the new table.',
      );
    }
  } catch {
    // No prior table (or unreadable): nothing to report.
  }
  writeFileSync(target, serializeWeightTable(out));
  console.log(`[harvest] wrote ${Object.keys(sorted).length} weights to ${target}`);
}
