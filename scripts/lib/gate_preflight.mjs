// The two preflights every full-strength gate runs before its step loop, moved
// here so gate.mjs and gate_select.mjs share one copy instead of the selective
// gate quietly losing both.
//
// Behavior is unchanged from the inline versions in gate.mjs; only the log prefix
// is parameterized, because tests/dependency_sync_gate_preflight.test.ts and
// tests/sfx_gate_preflight.test.ts spawn gate.mjs and assert on its exact stderr.
// Both preflights exist to turn a confusing mid-gate failure into a clear early
// one, which the selective gate needs at least as much: it is the path people
// will run most often.
import { spawnSync } from 'node:child_process';
import { FFMPEG_PATH, FFPROBE_PATH } from '../sfx/ffmpeg_paths.mjs';
import {
  formatInstallSyncFailure,
  parseInstallProblems,
  shouldCheckInstallSync,
} from './npm_install_sync.mjs';

/**
 * Verify node_modules matches pnpm-lock.yaml. Returns an error string, or null.
 *
 * @param {{ label: string, shell: boolean, env?: Record<string, string | undefined> }} opts
 * @returns {string | null}
 */
export function checkDependencySync({ label, shell, env = process.env }) {
  if (env.WOC_SKIP_DEP_SYNC === '1') return null;
  const npmLs = spawnSync('npm', ['ls', '--depth=0', '--json'], { encoding: 'utf8', shell });
  if (!shouldCheckInstallSync(npmLs)) return null;
  try {
    const installProblems = parseInstallProblems(npmLs.stdout);
    if (installProblems.length > 0) {
      return `[${label}] FAIL at "dependency sync"\n${formatInstallSyncFailure(installProblems)}`;
    }
  } catch (err) {
    // npm ran but produced unparseable JSON: a problem with the check itself,
    // not evidence of drift, so warn and continue rather than fail on output we
    // cannot interpret.
    console.error(`[${label}] WARN: dependency sync check skipped: ${err.message}`);
  }
  return null;
}

/**
 * Probe the resolved ffmpeg/ffprobe binaries BY EXECUTION. The static packages
 * download their binary via an install script, so a scripts-skipped install
 * leaves a missing file behind the import and the PATH fallback may be absent too.
 *
 * @param {{ label: string, shell: boolean }} opts
 * @returns {string | null} error text, or null when both tools run
 */
export function checkAudioTooling({ label, shell }) {
  const missing = [
    ['ffmpeg', FFMPEG_PATH],
    ['ffprobe', FFPROBE_PATH],
  ].filter(([, toolPath]) => {
    const probe = spawnSync(toolPath, ['-version'], { stdio: 'ignore', shell });
    return probe.error !== undefined || probe.status !== 0;
  });
  if (missing.length === 0) return null;
  return (
    `[${label}] missing required SFX audio tooling: ${missing.map(([name]) => name).join(', ')}\n` +
    `[${label}] the bundled ffmpeg-static/ffprobe-static binaries are absent or broken (a\n` +
    `[${label}] scripts-skipped install leaves them missing): reinstall with\n` +
    `[${label}] pnpm install --frozen-lockfile (ensure onlyBuiltDependencies allows\n` +
    `[${label}] ffmpeg-static/ffprobe-static), or install FFmpeg (including ffprobe) on PATH,\n` +
    `[${label}] then re-run pnpm run ${label === 'gate' ? 'gate' : label}`
  );
}

/**
 * Run both preflights, printing and exiting on the first failure.
 *
 * @param {{ label: string, shell: boolean, env?: Record<string, string | undefined> }} opts
 */
export function runGatePreflights({ label, shell, env = process.env }) {
  const depError = checkDependencySync({ label, shell, env });
  if (depError) {
    console.error(depError);
    process.exit(1);
  }
  const audioError = checkAudioTooling({ label, shell });
  if (audioError) {
    console.error(audioError);
    process.exit(1);
  }
}
