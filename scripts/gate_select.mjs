// The SELECTIVE gate (`npm run gate:select`).
//
// Positioning, because this repo now has three gate paths and the difference
// between them is the whole point:
//
//   gate:fast   day loop ONLY. Five steps: malware, changed-file biome, two
//               guard tests, incremental check:ts, and `vitest related`. It skips
//               i18n gen + freshness, wiki content, sfx, browser, the admin and
//               bot typechecks, and ALL FOUR BUILDS. A change that breaks the
//               client bundle or the admin Svelte types passes it cleanly. Never
//               a merge bar.
//
//   gate        the historical merge bar. Every step, plus one full unsharded
//               vitest over all ~2200 test files. Provably complete, and on a
//               14-core/24 GiB host the vitest step alone measures ~751 s.
//
//   gate:select THIS FILE. The FULL gate's step list, unchanged, with exactly one
//               substitution: the full vitest run becomes (always-run set) +
//               (`vitest related` on the diff). Every non-test check stays
//               identical to `gate`, so build, typecheck, freshness, sfx, malware
//               and browser coverage are not reduced at all. Only the test
//               selection is narrowed, and only for changes the planner can
//               reason about.
//
// Why narrowing tests is safe enough to ship a PR on. `vitest related` selects on
// the STATIC IMPORT GRAPH, which models ~80% of this suite correctly and misses
// the rest silently. So this gate never trusts the graph alone: it classifies
// every test file first (scripts/lib/test_visibility.mjs) and ALWAYS runs the
// ones whose coverage reaches outside the graph (disk scans, subprocesses,
// dynamic imports), currently ~490 files at roughly 100 s. `related` is used only
// for the remainder. Any change the planner cannot classify drops the whole run
// to the full suite.
//
// What it still cannot prove. Selection is empirically complete, not provably
// complete: the out-of-graph pattern list is a floor. That is why this path is
// paired with a scheduled full run (see docs/qa-gate.md) which re-establishes a
// known-green baseline off everyone's critical path.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAvailableMemoryBytes } from './lib/gate_memory.mjs';
import {
  buildAlwaysRunArgs,
  buildFullSuiteArgs,
  buildRelatedArgs,
  buildSelectPlan,
} from './lib/gate_select_plan.mjs';
import { buildFullGateSteps } from './lib/gate_steps.mjs';
import { computeGateWorkers, resolveGateWorkerTierCap } from './lib/gate_workers.mjs';
import { buildAlwaysRunSet, classifyTestSource } from './lib/test_visibility.mjs';

const shell = process.platform === 'win32';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
 * Every *.test.ts under tests/, repo-relative with POSIX slashes.
 * @param {string} dir
 * @param {string[]} out
 * @returns {string[]}
 */
function listTestFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Mirrors the vitest config exclude list: never walk a nested worktree or
      // the opt-in browser suite.
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

/** Working-tree + committed-vs-base changes. */
function listChangedPaths() {
  const out = new Set();
  const base = process.env.GATE_SELECT_BASE;
  const ranges = base ? [['diff', '--name-only', `${base}...HEAD`]] : [];
  ranges.push(['diff', '--name-only', 'HEAD']);
  for (const args of ranges) {
    const res = spawnSync('git', args, { encoding: 'utf8', shell, cwd: repoRoot });
    if (res.status === 0 && res.stdout) {
      for (const line of res.stdout.split('\n')) {
        const t = line.trim();
        if (t) out.add(t);
      }
    }
  }
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], {
    encoding: 'utf8',
    shell,
    cwd: repoRoot,
  });
  if (untracked.status === 0 && untracked.stdout) {
    for (const line of untracked.stdout.split('\n')) {
      const t = line.trim();
      if (t) out.add(t);
    }
  }
  return [...out];
}

// Classify the suite. Recomputed every run rather than read from a committed
// list, so the always-run set can never go stale as tests are added: a new test
// that scans from disk joins the set the moment it lands.
const testFiles = listTestFiles(path.join(repoRoot, 'tests'));
const entries = testFiles.map((file) => ({
  file,
  visibility: classifyTestSource(readFileSync(path.join(repoRoot, file), 'utf8')),
}));
const { alwaysRun, counts } = buildAlwaysRunSet(entries);

const changedPaths = listChangedPaths();
const plan = buildSelectPlan({ changedPaths, alwaysRunFiles: alwaysRun });

console.log('[gate:select] full gate step list, selective vitest step');
console.log(
  `[gate:select] suite visibility: ${counts.graph} graph-visible, ` +
    `${counts.blind} blind, ${counts.partial} partial (always-run: ${alwaysRun.length})`,
);
console.log(`[gate:select] mode=${plan.mode} (${plan.reason})`);
console.log(`[gate:select] workers=${workers}`);

// Same step list as the full gate, with the vitest step replaced below.
const branch =
  spawnSync('git', ['branch', '--show-current'], {
    encoding: 'utf8',
    shell,
    cwd: repoRoot,
  }).stdout?.trim() ?? '';
const steps = buildFullGateSteps(workers, {
  releaseTier: branch.startsWith('release/'),
  skipVitest: true,
});

/** @type {Array<{ name: string, cmd: string, args: string[], hint?: string }>} */
const vitestSteps =
  plan.mode === 'full'
    ? [
        {
          name: 'vitest (full suite, planner fell back)',
          cmd: 'npx',
          args: ['--no-install', 'vitest', ...buildFullSuiteArgs({ workers })],
        },
      ]
    : [
        {
          name: `vitest (always-run, ${plan.alwaysRunFiles.length} files)`,
          cmd: 'npx',
          args: [
            '--no-install',
            'vitest',
            ...buildAlwaysRunArgs({ files: plan.alwaysRunFiles, workers }),
          ],
          hint: 'these tests reach outside the module graph, so they run on every selective gate',
        },
      ];

const relatedArgs = buildRelatedArgs({ sources: plan.relatedSources, workers });
if (plan.mode === 'selective' && relatedArgs) {
  vitestSteps.push({
    name: `vitest (related to ${plan.relatedSources.length} changed source file(s))`,
    cmd: 'npx',
    args: ['--no-install', 'vitest', ...relatedArgs],
  });
}

// Insert where the full gate runs its vitest step: after "sfx check".
const sfxIndex = steps.findIndex((s) => s.name === 'sfx check');
steps.splice(sfxIndex >= 0 ? sfxIndex + 1 : 0, 0, ...vitestSteps);

for (const { name, cmd, args, hint, env: envOverlay } of steps) {
  console.log(`\n[gate:select] ${name}: ${cmd} ${args.join(' ')}`);
  const env = envOverlay ? { ...process.env, ...envOverlay } : process.env;
  const res = spawnSync(cmd, args, { stdio: 'inherit', env, shell, cwd: repoRoot });
  if (res.status !== 0) {
    console.error(`\n[gate:select] FAIL at "${name}" (exit ${res.status ?? 'killed'})`);
    if (hint) console.error(`[gate:select] hint: ${hint}`);
    process.exit(res.status ?? 1);
  }
}

console.log(`\n[gate:select] PASS: all ${steps.length} steps green (vitest workers: ${workers})`);
if (plan.mode === 'selective') {
  console.log(
    '[gate:select] NOTE: test selection is empirically complete, not provably complete. ' +
      'The scheduled full run is the backstop (docs/qa-gate.md).',
  );
}
