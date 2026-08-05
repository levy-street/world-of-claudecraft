// Shadow validator for the selective gate (`npm run gate:shadow`).
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
// Deliberately NOT part of any gate: it is strictly slower than the full gate
// (it runs the suite plus the selection legs). Run it in the background, on a
// schedule, or over a batch of recent commits.
import { spawnSync } from 'node:child_process';
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAvailableMemoryBytes } from './lib/gate_memory.mjs';
import { buildSelectPlan } from './lib/gate_select_plan.mjs';
import { computeGateWorkers, resolveGateWorkerTierCap } from './lib/gate_workers.mjs';
import { buildAlwaysRunSet, classifyTestSource } from './lib/test_visibility.mjs';

const shell = process.platform === 'win32';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG = process.env.GATE_SHADOW_LOG ?? path.join(repoRoot, 'tmp', 'gate-shadow.jsonl');

const workers = computeGateWorkers({
  cpuCount: os.availableParallelism(),
  freeMemBytes: resolveAvailableMemoryBytes({
    platform: process.platform,
    freeMemBytes: os.freemem(),
  }),
  envOverride: process.env.GATE_MAX_WORKERS,
  tierCap: resolveGateWorkerTierCap(process.env.GATE_WORKER_TIER),
});

/** @param {string} dir @param {string[]} out */
function listTestFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        ['node_modules', 'browser', '__snapshots__', 'fixtures', 'helpers'].includes(entry.name)
      ) {
        continue;
      }
      listTestFiles(full, out);
      continue;
    }
    if (/\.test\.[cm]?ts$/.test(entry.name)) {
      out.push(path.relative(repoRoot, full).split(path.sep).join('/'));
    }
  }
  return out;
}

function changedPaths() {
  const out = new Set();
  const base = process.env.GATE_SELECT_BASE;
  const cmds = base ? [['diff', '--name-only', `${base}...HEAD`]] : [];
  cmds.push(['diff', '--name-only', 'HEAD']);
  for (const args of cmds) {
    const r = spawnSync('git', args, { encoding: 'utf8', shell, cwd: repoRoot });
    if (r.status === 0 && r.stdout) {
      for (const l of r.stdout.split('\n')) if (l.trim()) out.add(l.trim());
    }
  }
  return [...out];
}

/**
 * Run vitest with a JSON reporter and return per-file outcomes.
 * @param {string[]} args
 * @returns {{ ran: Set<string>, failed: Set<string> }}
 */
function runVitest(args) {
  const outFile = path.join(repoRoot, 'tmp', `shadow-${args[0]}.json`);
  spawnSync(
    'npx',
    ['--no-install', 'vitest', ...args, '--reporter=json', `--outputFile=${outFile}`],
    { stdio: 'inherit', shell, cwd: repoRoot, env: { ...process.env, WOC_SKIP_PRETEST: '1' } },
  );
  const ran = new Set();
  const failed = new Set();
  try {
    const report = JSON.parse(readFileSync(outFile, 'utf8'));
    for (const suite of report.testResults ?? []) {
      const rel = path.relative(repoRoot, suite.name).split(path.sep).join('/');
      ran.add(rel);
      if (suite.status === 'failed') failed.add(rel);
    }
  } catch (err) {
    console.error(`[gate:shadow] could not parse ${outFile}: ${err.message}`);
  }
  return { ran, failed };
}

const testFiles = listTestFiles(path.join(repoRoot, 'tests'));
const { alwaysRun } = buildAlwaysRunSet(
  testFiles.map((file) => ({
    file,
    visibility: classifyTestSource(readFileSync(path.join(repoRoot, file), 'utf8')),
  })),
);
const plan = buildSelectPlan({ changedPaths: changedPaths(), alwaysRunFiles: alwaysRun });

console.log(`[gate:shadow] plan mode=${plan.mode} (${plan.reason})`);
if (plan.mode === 'full') {
  console.log('[gate:shadow] planner already falls back to the full suite: no escape possible.');
  process.exit(0);
}

console.log('[gate:shadow] leg 1/3: always-run set');
const always = runVitest(['run', ...plan.alwaysRunFiles, `--maxWorkers=${workers}`]);
console.log('[gate:shadow] leg 2/3: related');
const related =
  plan.relatedSources.length > 0
    ? runVitest([
        'related',
        ...plan.relatedSources,
        '--run',
        '--passWithNoTests',
        `--maxWorkers=${workers}`,
      ])
    : { ran: new Set(), failed: new Set() };
console.log('[gate:shadow] leg 3/3: full suite');
const full = runVitest(['run', `--maxWorkers=${workers}`]);

const selected = new Set([...always.ran, ...related.ran]);
const escapes = [...full.failed].filter((f) => !selected.has(f)).sort();

const record = {
  branch:
    spawnSync('git', ['branch', '--show-current'], {
      encoding: 'utf8',
      shell,
      cwd: repoRoot,
    }).stdout?.trim() ?? '',
  head:
    spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      shell,
      cwd: repoRoot,
    }).stdout?.trim() ?? '',
  planMode: plan.mode,
  selectedCount: selected.size,
  fullCount: full.ran.size,
  fullFailures: [...full.failed].sort(),
  escapes,
};

try {
  appendFileSync(LOG, `${JSON.stringify(record)}\n`);
} catch {
  // tmp/ may not exist on a fresh checkout; the console summary is the signal.
}

console.log(`\n[gate:shadow] selected ${selected.size} of ${full.ran.size} test files`);
if (escapes.length === 0) {
  console.log('[gate:shadow] PASS: no escapes (every full-suite failure was also selected)');
  process.exit(0);
}
console.error(
  `[gate:shadow] ESCAPES (${escapes.length}): selection would have shipped these green`,
);
for (const e of escapes) console.error(`  - ${e}`);
console.error('[gate:shadow] each escape names a missing rule in scripts/lib/test_visibility.mjs');
process.exit(1);
