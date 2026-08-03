// The full local pre-merge gate: the CI checks from .github/workflows/ci.yml run
// locally. CI splits each tier into a parallel pair (PR: pr-gate + pr-checks;
// release: release-gate + release-checks) and fans each test job across an
// 8-shard matrix; this script runs the SAME combined step list serially with
// ONE full unsharded vitest run by design (no shard flag). The parallel lint
// job's changed-files biome is pulled forward as an early fast-fail; on a
// release/** branch the steps run release-tier (I18N_RELEASE_TIER=1), mirroring
// the release-gate test job's job-level flag. This script exists because
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
import { buildFullGateSteps } from './lib/gate_steps.mjs';
import { computeGateWorkers, resolveGateWorkerTierCap } from './lib/gate_workers.mjs';
import {
  formatInstallSyncFailure,
  parseInstallProblems,
  shouldCheckInstallSync,
} from './lib/npm_install_sync.mjs';
import { FFMPEG_PATH, FFPROBE_PATH } from './sfx/ffmpeg_paths.mjs';

// Halving the core count only protects a gate run from ITSELF; it does nothing when a
// second `npm run gate` (or any other heavy vitest run) is happening in a sibling
// worktree on the same machine, which this repo's own parallel-worktree workflow makes
// routine. computeGateWorkers additionally clamps to available memory, since a vitest
// fork worker that starts swapping presents as a flaky failure, not a slow one. Optional
// GATE_WORKER_TIER=low|medium|high applies a further cap AFTER the free-mem clamp (never
// instead of it). GATE_MAX_WORKERS=<n> remains the expert absolute override when you
// deliberately share the machine or raise workers on a quiet high-tier host.
const workers = computeGateWorkers({
  cpuCount: os.availableParallelism(),
  freeMemBytes: os.freemem(),
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
if (process.env.WOC_SKIP_DEP_SYNC !== '1') {
  const npmLs = spawnSync('npm', ['ls', '--depth=0', '--json'], { encoding: 'utf8', shell });
  if (shouldCheckInstallSync(npmLs)) {
    try {
      const installProblems = parseInstallProblems(npmLs.stdout);
      if (installProblems.length > 0) {
        console.error(
          `[gate] FAIL at "dependency sync"\n${formatInstallSyncFailure(installProblems)}`,
        );
        process.exit(1);
      }
    } catch (err) {
      // npm ran but did not produce parseable JSON: a problem with the check
      // itself, not evidence of drift, so warn and let the gate continue rather
      // than fail on output we cannot interpret.
      console.error(`[gate] WARN: dependency sync check skipped: ${err.message}`);
    }
  }
}

// Probe the resolved binaries BY EXECUTION: the ffmpeg-static/ffprobe-static
// packages download their binary via an allowlisted install script, so a
// scripts-skipped install leaves a missing file behind the import, and the PATH
// fallback may not exist either. Failing here is cheaper and clearer than
// failing mid-suite.
const missingAudioTools = [
  ['ffmpeg', FFMPEG_PATH],
  ['ffprobe', FFPROBE_PATH],
].filter(([, toolPath]) => {
  const probe = spawnSync(toolPath, ['-version'], { stdio: 'ignore', shell });
  return probe.error !== undefined || probe.status !== 0;
});
if (missingAudioTools.length > 0) {
  console.error(
    `[gate] missing required SFX audio tooling: ${missingAudioTools.map(([name]) => name).join(', ')}\n` +
      '[gate] the bundled ffmpeg-static/ffprobe-static binaries are absent or broken (a\n' +
      '[gate] scripts-skipped install leaves them missing): reinstall with\n' +
      '[gate] pnpm install --frozen-lockfile (ensure onlyBuiltDependencies allows\n' +
      '[gate] ffmpeg-static/ffprobe-static), or install FFmpeg (including ffprobe) on PATH,\n' +
      '[gate] then re-run pnpm run gate',
  );
  process.exit(1);
}

const branch =
  spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8', shell }).stdout?.trim() ?? '';
const releaseTier = branch.startsWith('release/');
// Base env for every step. Per-step overlays (e.g. pretest skip on vitest) merge on top.
const baseEnv = releaseTier ? { ...process.env, I18N_RELEASE_TIER: '1' } : { ...process.env };

// Shared step list (Phase 2 generate-once + Phase 8 turbo cacheable pure steps).
// The bot build rides inside buildFullGateSteps (scripts/lib/gate_steps.mjs), so
// the packet's R7 step stays in every consumer of the shared list.
const steps = buildFullGateSteps(workers);

if (releaseTier) {
  console.log(`[gate] release branch "${branch}": running release-tier (I18N_RELEASE_TIER=1)`);
}

for (const { name, cmd, args, hint, env: envOverlay } of steps) {
  console.log(`\n[gate] ${name}: ${cmd} ${args.join(' ')}`);
  const env = envOverlay ? { ...baseEnv, ...envOverlay } : baseEnv;
  const res = spawnSync(cmd, args, { stdio: 'inherit', env, shell });
  if (res.status !== 0) {
    console.error(`\n[gate] FAIL at "${name}" (exit ${res.status ?? 'killed'})`);
    if (hint) console.error(`[gate] hint: ${hint}`);
    process.exit(res.status ?? 1);
  }
}

console.log(`\n[gate] PASS: all ${steps.length} steps green (vitest workers: ${workers})`);
