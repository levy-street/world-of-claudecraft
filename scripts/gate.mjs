// The full local pre-merge gate: the CI checks from .github/workflows/ci.yml run
// locally. Order: the pr-gate job's steps, with the parallel lint job's
// changed-files biome pulled forward as an early fast-fail; on a release/**
// branch the steps run release-tier (I18N_RELEASE_TIER=1), mirroring the
// release-gate job. This script exists because ad-hoc shell chains get the gate
// wrong in two known ways: piping `npm test` through `tail` masks vitest's exit
// code (a red run can print "PASS"), and an unbounded full run saturates every
// core and flakes the heavy sim suites when other work shares the machine
// (failing files that then pass in isolation). Steps run sequentially with
// inherited stdio and stop at the first failure.
// Keep the step list in sync with .github/workflows/ci.yml (and vice versa).
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const workers = Math.max(1, Math.floor(os.cpus().length / 2));
// npm/npx resolve to .cmd files on Windows, which spawnSync only finds via a shell.
const shell = process.platform === 'win32';

const missingAudioTools = ['ffmpeg', 'ffprobe'].filter((tool) => {
  const probe = spawnSync(tool, ['-version'], { stdio: 'ignore', shell });
  return probe.error !== undefined || probe.status !== 0;
});
if (missingAudioTools.length > 0) {
  console.error(
    `[gate] missing required SFX audio tooling on PATH: ${missingAudioTools.join(', ')}\n` +
      '[gate] install FFmpeg (including ffprobe), then re-run npm run gate',
  );
  process.exit(1);
}

const branch =
  spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8', shell }).stdout?.trim() ?? '';
const releaseTier = branch.startsWith('release/');
const env = releaseTier ? { ...process.env, I18N_RELEASE_TIER: '1' } : process.env;

const I18N_ARTIFACTS = [
  'src/ui/i18n.resolved.generated',
  'src/admin/i18n.resolved.generated',
  'src/ui/i18n.status.summary.json',
];

const steps = [
  ['i18n artifacts', 'npm', ['run', 'i18n:gen']],
  [
    'i18n freshness',
    'git',
    ['diff', '--exit-code', '--', ...I18N_ARTIFACTS],
    'the regenerated i18n artifacts differ from the staged/committed copies: stage them ' +
      `(git add ${I18N_ARTIFACTS.join(' ')}) and re-run`,
  ],
  ['malware scan', 'npm', ['run', 'security:gate']],
  ['biome (changed files)', 'npm', ['run', 'ci:changed']],
  ['sfx check', 'npm', ['run', 'sfx:check']],
  ['vitest (full suite)', 'npm', ['test', '--', `--maxWorkers=${workers}`]],
  ['typecheck', 'npx', ['tsc', '--noEmit']],
  ['env build', 'npm', ['run', 'build:env']],
  ['server build', 'npm', ['run', 'build:server']],
  ['client build', 'npm', ['run', 'build']],
];

if (releaseTier) {
  console.log(`[gate] release branch "${branch}": running release-tier (I18N_RELEASE_TIER=1)`);
}

for (const [name, cmd, args, hint] of steps) {
  console.log(`\n[gate] ${name}: ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', env, shell });
  if (res.status !== 0) {
    console.error(`\n[gate] FAIL at "${name}" (exit ${res.status ?? 'killed'})`);
    if (hint) console.error(`[gate] hint: ${hint}`);
    process.exit(res.status ?? 1);
  }
}

console.log(
  `\n[gate] PASS: all ${steps.length} steps green (vitest workers capped at ${workers}, half the cores)`,
);
