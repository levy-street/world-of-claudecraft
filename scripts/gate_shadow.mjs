// Shadow validator for the selective gate (`node scripts/gate_shadow.mjs`).
//
// The selective gate's one risk is silent: when selection is wrong it does not
// error, it just runs fewer tests and still prints PASS. This script is how that
// risk is measured rather than assumed, and it is the evidence the merge-bar
// decision should rest on (see docs/qa-gate.md, "Selective gate").
//
// It runs BOTH paths over the same working tree:
//   1. the selective plan, recording exactly which test files it would execute;
//   2. the full suite, recording which test files actually FAILED.
//
// The finding that matters is the intersection: a test that FAILED under the full
// suite and would NOT have been selected. Each one is a real escape, a change
// that selection would have shipped green. Zero escapes across a representative
// sample of diffs (sim, content, render, ui, i18n, server) is the bar for
// promoting gate:select to the merge contract.
//
// Discovery and changed-path collection are imported from lib/gate_discovery.mjs
// rather than re-implemented: the first cut duplicated both and they had already
// drifted, so the validator was validating a different plan than the gate ran.
//
// Deliberately NOT part of any gate: it is strictly slower than the full gate
// (it runs the suite plus the selection legs). Run it in the background, on a
// schedule, or over a batch of recent commits.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chunkFileArgs,
  compareSelection,
  filterExisting,
  listChangedPaths,
  listTestFiles,
  resolveSelectBase,
} from './lib/gate_discovery.mjs';
import { resolveAvailableMemoryBytes } from './lib/gate_memory.mjs';
import { buildSelectPlan } from './lib/gate_select_plan.mjs';
import { computeGateWorkers, resolveGateWorkerTierCap } from './lib/gate_workers.mjs';
import {
  buildAlwaysRunSet,
  buildHelperImportPattern,
  classifyTestSource,
  FS_HELPER_DIRS,
  HELPER_FS_PATTERN,
} from './lib/test_visibility.mjs';

const shell = process.platform === 'win32';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = path.join(repoRoot, 'tmp');
const LOG = process.env.GATE_SHADOW_LOG ?? path.join(TMP, 'gate-shadow.jsonl');

/** @param {string} cmd @param {string[]} args */
const git = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', shell, cwd: repoRoot });

const workers = computeGateWorkers({
  cpuCount: os.availableParallelism(),
  freeMemBytes: resolveAvailableMemoryBytes({
    platform: process.platform,
    freeMemBytes: os.freemem(),
  }),
  envOverride: process.env.GATE_MAX_WORKERS,
  tierCap: resolveGateWorkerTierCap(process.env.GATE_WORKER_TIER),
});

/**
 * Run one vitest invocation and return per-file outcomes.
 *
 * A missing or unparseable report THROWS. The first cut returned empty sets on a
 * parse failure, which reads downstream as "nothing failed and nothing ran", so
 * the tool built to detect silent gaps would itself have exited 0 silently.
 *
 * @param {string} tag
 * @param {string[]} args
 * @returns {{ ran: Set<string>, failed: Set<string> }}
 */
function runVitest(tag, args) {
  mkdirSync(TMP, { recursive: true });
  const outFile = path.join(TMP, `shadow-${tag}.json`);
  spawnSync(
    'npx',
    ['--no-install', 'vitest', ...args, '--reporter=json', `--outputFile=${outFile}`],
    // NOTE: no WOC_SKIP_PRETEST here. It is an npm lifecycle variable and `npx
    // vitest` never triggers pretest, so setting it was inert.
    { stdio: 'inherit', shell, cwd: repoRoot },
  );
  const ran = new Set();
  const failed = new Set();
  let report;
  try {
    report = JSON.parse(readFileSync(outFile, 'utf8'));
  } catch (err) {
    throw new Error(
      `vitest leg "${tag}" produced no readable report at ${outFile}: ${err.message}`,
    );
  }
  for (const suite of report.testResults ?? []) {
    const rel = path.relative(repoRoot, suite.name).split(path.sep).join('/');
    ran.add(rel);
    if (suite.status === 'failed') failed.add(rel);
  }
  return { ran, failed };
}

const io = { root: repoRoot, readdirSync, join: path.join, relative: path.relative, sep: path.sep };

const fsHelpers = FS_HELPER_DIRS.flatMap((dir) => {
  const full = path.join(repoRoot, dir);
  try {
    return readdirSync(full, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.[cm]?ts$/.test(e.name) && !/\.(test|spec)\./.test(e.name))
      .filter((e) => HELPER_FS_PATTERN.test(readFileSync(path.join(full, e.name), 'utf8')))
      .map((e) => `${dir}/${e.name.replace(/\.[cm]?ts$/, '')}`);
  } catch {
    return [];
  }
});
const helperImportPattern = buildHelperImportPattern(fsHelpers);

const testFiles = listTestFiles({ ...io, dir: path.join(repoRoot, 'tests') });
const { alwaysRun } = buildAlwaysRunSet(
  testFiles.map((file) => ({
    file,
    visibility: classifyTestSource(readFileSync(path.join(repoRoot, file), 'utf8'), {
      helperImportPattern,
    }),
  })),
);

const { base, reason: baseReason } = resolveSelectBase({ env: process.env, run: git });
if (!base) {
  console.error(`[gate:shadow] cannot resolve a branch base: ${baseReason}`);
  process.exit(1);
}
let changedPaths;
try {
  changedPaths = listChangedPaths({ base, run: git });
} catch (err) {
  console.error(`[gate:shadow] ${err.message}`);
  process.exit(1);
}

const plan = buildSelectPlan({ changedPaths, alwaysRunFiles: alwaysRun });
console.log(`[gate:shadow] base=${base} (${baseReason}); plan mode=${plan.mode} (${plan.reason})`);
if (plan.mode === 'full') {
  console.log('[gate:shadow] planner already falls back to the full suite: no escape possible.');
  process.exit(0);
}

try {
  const selected = new Set();
  const chunks = chunkFileArgs({
    files: filterExisting({
      files: plan.alwaysRunFiles,
      exists: (f) => existsSync(path.join(repoRoot, f)),
    }),
  });
  chunks.forEach((files, i) => {
    console.log(`[gate:shadow] always-run leg ${i + 1}/${chunks.length}`);
    for (const f of runVitest(`always-${i}`, ['run', ...files, `--maxWorkers=${workers}`]).ran) {
      selected.add(f);
    }
  });

  if (plan.relatedSources.length > 0) {
    console.log('[gate:shadow] related leg');
    const related = runVitest('related', [
      'related',
      ...plan.relatedSources,
      '--run',
      '--passWithNoTests',
      `--maxWorkers=${workers}`,
    ]);
    for (const f of related.ran) selected.add(f);
  }

  console.log('[gate:shadow] full suite leg');
  const full = runVitest('full', ['run', `--maxWorkers=${workers}`]);

  // A full leg that collected nothing means the comparison is meaningless, and
  // reporting "no escapes" off it would be exactly the false confidence this
  // tool exists to prevent.
  if (full.ran.size === 0) {
    throw new Error('full suite leg collected 0 test files: cannot compare');
  }

  const { escapes, unselected, selectedCount, fullCount } = compareSelection({
    selected,
    fullRan: full.ran,
    fullFailed: full.failed,
  });
  const record = {
    branch: git('git', ['branch', '--show-current']).stdout?.trim() ?? '',
    head: git('git', ['rev-parse', '--short', 'HEAD']).stdout?.trim() ?? '',
    base,
    planMode: plan.mode,
    selectedCount,
    fullCount,
    unselectedCount: unselected.length,
    fullFailures: [...full.failed].sort(),
    escapes,
    unselected,
  };
  mkdirSync(path.dirname(LOG), { recursive: true });
  appendFileSync(LOG, `${JSON.stringify(record)}\n`);

  console.log(`\n[gate:shadow] selected ${selectedCount} of ${fullCount} test files`);
  console.log(
    `[gate:shadow] coverage delta: ${unselected.length} file(s) the full suite ran and ` +
      'selection skipped (this is the surface where an escape could hide, not a defect list)',
  );
  console.log(`[gate:shadow] full-suite failures this run: ${full.failed.size}`);
  if (full.failed.size === 0) {
    console.log(
      '[gate:shadow] INCONCLUSIVE on escapes: the full suite was green, so "no escapes" is ' +
        'vacuous here. Escape evidence needs a run where the full suite actually fails.',
    );
  }
  if (escapes.length === 0) {
    console.log('[gate:shadow] no escapes (every full-suite failure was also selected)');
    process.exit(0);
  }
  console.error(
    `[gate:shadow] ESCAPES (${escapes.length}): selection would have shipped these green`,
  );
  for (const e of escapes) console.error(`  - ${e}`);
  console.error(
    '[gate:shadow] each escape names a missing rule in scripts/lib/test_visibility.mjs',
  );
  process.exit(1);
} catch (err) {
  console.error(`[gate:shadow] ABORT: ${err.message}`);
  console.error('[gate:shadow] no verdict: treat this run as inconclusive, not as a pass.');
  process.exit(2);
}
