// The SELECTIVE gate (`node scripts/gate_select.mjs`).
//
// No npm alias: tests/fenbridge_town_assets.test.ts fingerprints the whole of
// package.json as an input to a shipping GLB, so adding a script entry
// invalidates that asset and demands a 63-file re-export. Not worth the churn in
// a tooling change; adding the alias is a follow-up.
//
// Positioning, because this repo has several gate paths and the difference
// between them is the whole point:
//
//   gate:fast   day loop ONLY. A high-signal subset that drops most of the
//               non-test steps, including every build and the admin/bot
//               typechecks, so a change breaking the client bundle or the admin
//               Svelte types passes it cleanly. Never a merge bar.
//
//   gate        the historical merge bar. Every step, plus one full unsharded
//               vitest over the whole suite. Provably complete, and its vitest
//               step alone dominates the run.
//
//   gate:select THIS FILE. The FULL gate's step list, plus the same preflights,
//               with exactly one substitution: the full vitest run becomes an
//               always-run leg plus a `vitest related` leg. Every non-test check
//               stays identical to `gate`, so build, typecheck, freshness, sfx,
//               malware and browser coverage are not reduced at all. Only the
//               test selection narrows, and only for changes the planner can
//               reason about.
//
// Why narrowing tests is safe enough to ship a PR on. `vitest related` selects on
// the STATIC IMPORT GRAPH and misses the rest SILENTLY (a skipped test does not
// error; the gate still prints PASS). So the graph is never trusted alone: every
// test file is classified first (lib/test_visibility.mjs) and the ones reaching
// outside the graph (disk scans, subprocesses, dynamic imports, fs-touching
// shared helpers) ALWAYS run. `related` covers only the graph-visible remainder.
// Any change the planner cannot classify drops the whole run to the full suite.
//
// What it still cannot prove. Selection is empirically complete, not provably
// complete: the out-of-graph pattern list is a floor. That is why this path is
// paired with a scheduled full run (see docs/qa-gate.md) which re-establishes a
// known-green baseline off everyone's critical path.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chunkFileArgs,
  collectSuiteVisibility,
  filterExisting,
  listChangedPaths,
  resolveSelectBase,
} from './lib/gate_discovery.mjs';
import { resolveAvailableMemoryBytes } from './lib/gate_memory.mjs';
import { runGatePreflights } from './lib/gate_preflight.mjs';
import {
  buildAlwaysRunArgs,
  buildFullSuiteArgs,
  buildRelatedArgs,
  buildSelectPlan,
} from './lib/gate_select_plan.mjs';
import {
  buildFullGateSteps,
  I18N_RELEASE_TIER_SUITES,
  PRE_VITEST_STEP_NAME,
} from './lib/gate_steps.mjs';
import { computeGateWorkers, resolveGateWorkerTierCap } from './lib/gate_workers.mjs';

const shell = process.platform === 'win32';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} cmd @param {string[]} args */
const git = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', shell, cwd: repoRoot });

// Resolve the vitest binary directly instead of going through `npx --no-install
// vitest`: npx still pays a real per-invocation startup cost even when it skips
// the install check, and this file spawns vitest up to four times in one run.
const vitestBin = path.join(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vitest.cmd' : 'vitest',
);

// Same preflights as gate.mjs (dependency sync, then ffmpeg/ffprobe by
// execution). They exist to turn a confusing mid-gate failure into a clear early
// one, and this path is the one people run most.
runGatePreflights({ label: 'gate:select', shell });

const workers = computeGateWorkers({
  cpuCount: os.availableParallelism(),
  freeMemBytes: resolveAvailableMemoryBytes({
    platform: process.platform,
    freeMemBytes: os.freemem(),
  }),
  envOverride: process.env.GATE_MAX_WORKERS,
  tierCap: resolveGateWorkerTierCap(process.env.GATE_WORKER_TIER),
});

// Classify the suite. Recomputed every run rather than read from a committed
// list, so the always-run set can never go stale as tests are added: a new test
// that scans from disk joins the set the moment it lands. The classification
// loop itself is shared with gate_shadow.mjs and the CI shard runner
// (lib/gate_discovery.mjs), so the three cannot reason over different suites.
const { testFiles, alwaysRun, counts } = collectSuiteVisibility({
  root: repoRoot,
  readdirSync,
  readFileSync,
  join: path.join,
  relative: path.relative,
  sep: path.sep,
});

// The BRANCH diff, not just the dirty working tree: diffing only against HEAD
// meant a clean committed branch selected nothing and passed green, at exactly
// the moment a merge bar is run. An unresolvable base is a hard stop rather than
// a silent narrowing.
const { base, reason: baseReason } = resolveSelectBase({ env: process.env, run: git });
if (!base) {
  console.error(`[gate:select] cannot resolve a branch base to diff against: ${baseReason}`);
  console.error(
    '[gate:select] set GATE_SELECT_BASE=<ref>, or run `npm run gate` for the full bar.',
  );
  process.exit(1);
}
let changedPaths;
try {
  changedPaths = listChangedPaths({ base, run: git });
} catch (err) {
  console.error(`[gate:select] ${err.message}`);
  console.error('[gate:select] refusing to narrow the run on an unreadable diff.');
  process.exit(1);
}

const plan = buildSelectPlan({
  changedPaths,
  alwaysRunFiles: alwaysRun,
  // Generated i18n artifacts are inert only while present (a deleted one is
  // unprovable: regeneration recreates it untracked, invisible to the
  // freshness diff), so the planner needs a live existence probe.
  exists: (f) => existsSync(path.join(repoRoot, f)),
});

console.log('[gate:select] full gate step list, selective vitest step');
console.log(
  `[gate:select] suite: ${testFiles.length} test files ` +
    `(${counts.graph} graph-visible, ${counts.blind} blind, ${counts.partial} partial); ` +
    `always-run ${alwaysRun.length}`,
);
console.log(
  `[gate:select] diff base: ${base} (${baseReason}); ${changedPaths.length} changed path(s)`,
);
console.log(`[gate:select] mode=${plan.mode} (${plan.reason})`);
console.log(`[gate:select] workers=${workers}`);

const branch = git('git', ['branch', '--show-current']).stdout?.trim() ?? '';
const releaseTier = branch.startsWith('release/');
const steps = buildFullGateSteps(workers, { releaseTier, skipVitest: true });

/** @type {Array<{ name: string, cmd: string, args: string[], hint?: string, env?: Record<string, string> }>} */
const vitestSteps = [];

if (plan.mode === 'full') {
  vitestSteps.push({
    name: 'vitest (full suite, planner fell back)',
    cmd: vitestBin,
    args: [...buildFullSuiteArgs({ workers })],
  });
} else {
  // Chunked: with shell:true on win32, ~500 paths in one argv exceeds cmd.exe's
  // 8191-character command line and the leg cannot launch at all.
  // git diff reports deletions, so a deleted test would put a dead path in the
  // argv; a chunk of only dead paths exits 1 with "No test files found".
  const runnable = filterExisting({
    files: plan.alwaysRunFiles,
    exists: (f) => existsSync(path.join(repoRoot, f)),
  });
  const chunks = chunkFileArgs({ files: runnable });
  chunks.forEach((files, i) => {
    vitestSteps.push({
      name:
        chunks.length === 1
          ? `vitest (always-run, ${runnable.length} files)`
          : `vitest (always-run ${i + 1}/${chunks.length}, ${files.length} files)`,
      cmd: vitestBin,
      args: [...buildAlwaysRunArgs({ files, workers })],
      hint: 'these tests reach outside the module graph, so they run on every selective gate',
    });
  });
  const relatedArgs = buildRelatedArgs({ sources: plan.relatedSources, workers });
  if (relatedArgs) {
    vitestSteps.push({
      // "path(s)", not "changed source file(s)": the list is the union of
      // changed sources AND fed-through generated i18n artifacts, and the
      // plan.reason line above counts those separately.
      name: `vitest (related over ${plan.relatedSources.length} path(s))`,
      cmd: vitestBin,
      args: [...relatedArgs],
    });
  }
}

// buildFullGateSteps nests its release-tier step inside the same `skipVitest`
// guard as the full suite, so asking for skipVitest drops BOTH. Re-add it here,
// or a release branch would run gate:select without I18N_RELEASE_TIER=1 and lose
// the tier signal on exactly the branch where a fast path is most wanted.
if (releaseTier) {
  vitestSteps.push({
    name: 'vitest (release-tier i18n)',
    cmd: vitestBin,
    args: ['run', ...I18N_RELEASE_TIER_SUITES, `--maxWorkers=${workers}`],
    env: { I18N_RELEASE_TIER: '1' },
    hint: 'release-tier i18n is red until every locale is filled: run the i18n-locale-fill workflow (docs/i18n-scaling/translation-workflow.md). It does NOT indicate a code regression.',
  });
}

const anchor = steps.findIndex((s) => s.name === PRE_VITEST_STEP_NAME);
steps.splice(anchor >= 0 ? anchor + 1 : steps.length, 0, ...vitestSteps);

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
