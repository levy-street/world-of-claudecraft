// The full local pre-merge gate: the CI checks from .github/workflows/ci.yml run
// locally. CI splits each tier into a parallel pair (PR: pr-gate + pr-checks;
// release: release-gate + release-checks) and fans each test job across an
// 8-shard matrix; this script runs the SAME combined step list serially with
// ONE full unsharded vitest run by design (no shard flag). The parallel lint
// job's changed-files biome is pulled forward as an early fast-fail; on a
// release/** branch the step list ADDS one dedicated release-tier step
// (I18N_RELEASE_TIER=1 over the suites that read it), mirroring the release-i18n
// job; the full suite stays at PR tier in both places so an outstanding locale
// fill can never mask a real test failure (#2820). This script exists because
// ad-hoc shell chains get the gate wrong in two known ways: piping `npm test`
// through `tail` masks vitest's exit code (a red run can print "PASS"), and an
// unbounded full run saturates every core and flakes the heavy sim suites when
// other work shares the machine (failing files that then pass in isolation).
// Steps run sequentially with inherited stdio and stop at the first failure.
// Keep the step list in sync with .github/workflows/ci.yml (and vice versa).
//
// Phase 2: generate-once i18n + wiki; vitest skips pretest; client uses
// build:bundle (no triple gen). Phase 8: pure artifact steps go through turbo
// (local disk cache + parallel typecheck/env/server). Tests, malware, and
// changed-file biome are never treated as cacheable "green forever".
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { cwd } from 'node:process';
import { runGateChild } from './lib/gate_child.mjs';
import { acquireFullSuiteLock } from './lib/gate_lock.mjs';
import { resolveAvailableMemoryBytes } from './lib/gate_memory.mjs';
import { runGatePreflights } from './lib/gate_preflight.mjs';
import { buildFullGateSteps, FULL_SUITE_STEP_NAME } from './lib/gate_steps.mjs';
import { computeGateWorkers, resolveGateWorkerTierCap } from './lib/gate_workers.mjs';

// Halving the core count only protects a gate run from ITSELF; it does nothing when a
// second `npm run gate` (or any other heavy vitest run) is happening in a sibling
// worktree on the same machine, which this repo's own parallel-worktree workflow makes
// routine. computeGateWorkers additionally clamps to available memory, since a vitest
// fork worker that starts swapping presents as a flaky failure, not a slow one. The
// availability figure comes from resolveAvailableMemoryBytes, because os.freemem() reads
// near zero on a healthy macOS host and used to collapse the clamp to a single worker (see
// lib/gate_memory.mjs). Optional GATE_WORKER_TIER=low|medium|high applies a further cap
// AFTER that clamp (never instead of it). GATE_MAX_WORKERS=<n> remains the expert absolute
// override when you deliberately share the machine or raise workers on a quiet high-tier host.
const workers = computeGateWorkers({
  cpuCount: os.availableParallelism(),
  freeMemBytes: resolveAvailableMemoryBytes({
    platform: process.platform,
    freeMemBytes: os.freemem(),
  }),
  envOverride: process.env.GATE_MAX_WORKERS,
  tierCap: resolveGateWorkerTierCap(process.env.GATE_WORKER_TIER),
});
// npm/npx resolve to .cmd files on Windows, which spawnSync only finds via a shell.
const shell = process.platform === 'win32';

// Verify node_modules is what pnpm-lock.yaml actually pins, BEFORE any other
// step. CI always resets this with `pnpm install --frozen-lockfile`, so CI never
// sees drift; a long-lived local checkout can drift silently (a stray
// `pnpm add <pkg>`, or just going stale) and the first symptom is usually a
// confusing tsc or build failure many minutes into the gate that looks like a
// real regression in the change under test. `npm ls --depth=0 --json` still
// works under pnpm's layout, costs under a second, and names the actual problem
// instead of a downstream symptom. No CI job runs this script (CI always starts
// from a fresh frozen install), so nothing else catches a false-positive block;
// WOC_SKIP_DEP_SYNC=1 is the escape hatch for a checkout this check gets wrong,
// and other preflights that need to test their OWN failure mode in isolation
// (tests/sfx_gate_preflight.test.ts) set it explicitly rather than relying on the
// side effect of an empty PATH also making `npm` itself unspawnable.
// Both preflights now live in lib/gate_preflight.mjs so gate:select shares them
// rather than silently losing the early, clear failure they exist to produce.
await runGatePreflights({ label: 'gate', shell });

const branch =
  spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8', shell }).stdout?.trim() ?? '';
const releaseTier = branch.startsWith('release/');
const repoRoot = cwd();
// Base env for every step. Per-step overlays (e.g. pretest skip on vitest) merge on top.
// The release tier is NOT applied here. It rides on the one dedicated vitest step
// buildFullGateSteps adds for a release branch (lib/gate_steps.mjs), mirroring the
// release-i18n job in ci.yml: the full suite stays at PR tier so a red there always
// means a real regression, never an outstanding locale fill (issue #2820).
const baseEnv = { ...process.env };

// Shared step list (Phase 2 generate-once + Phase 8 turbo cacheable pure steps).
// The bot build rides inside buildFullGateSteps (scripts/lib/gate_steps.mjs), so
// the packet's R7 step stays in every consumer of the shared list.
const steps = buildFullGateSteps(workers, { releaseTier, repoRoot });

if (releaseTier) {
  console.log(
    `[gate] release branch "${branch}": adding the release-tier i18n step (I18N_RELEASE_TIER=1)`,
  );
}

// Concurrent `npm run gate` runs are routine under this repo's own per-task-worktree
// workflow, and each sizes its Vitest pool as if it owned the host (computeGateWorkers
// above). Only the full-suite step is the wall-clock bottleneck (#2808), so only it is
// serialized across processes; every other step still runs freely in parallel across
// worktrees. GATE_NO_LOCK=1 restores today's fully concurrent behavior for a user who
// deliberately wants two full suites running at once.
const noLock = process.env.GATE_NO_LOCK === '1';
if (noLock) {
  console.log('[gate] GATE_NO_LOCK=1: full-suite lock disabled, running unserialized');
}

for (const { name, cmd, args, hint, env: envOverlay } of steps) {
  console.log(`\n[gate] ${name}: ${cmd} ${args.join(' ')}`);
  const env = envOverlay ? { ...baseEnv, ...envOverlay } : baseEnv;
  const locked = name === FULL_SUITE_STEP_NAME;
  const { release } = locked
    ? await acquireFullSuiteLock({ optOut: noLock })
    : { release: async () => {} };
  let res;
  try {
    res = locked
      ? await runGateChild(cmd, args, { stdio: 'inherit', env, shell })
      : spawnSync(cmd, args, { stdio: 'inherit', env, shell });
  } finally {
    await release();
  }
  if (res.status !== 0) {
    console.error(`\n[gate] FAIL at "${name}" (exit ${res.status ?? 'killed'})`);
    if (hint) console.error(`[gate] hint: ${hint}`);
    process.exit(res.status ?? 1);
  }
}

console.log(`\n[gate] PASS: all ${steps.length} steps green (vitest workers: ${workers})`);
