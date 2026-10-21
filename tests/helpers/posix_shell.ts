// The POSIX shell a suite spawns to run a repo shell script for real.
//
// Off Windows this is plain `bash` / `sh` on PATH, unchanged. On Windows a bare
// `bash` is a trap: System32\bash.exe is the WSL launcher, which runs the
// script inside a Linux distro that cannot see the test's Windows temp paths
// (or fails outright when no distro is installed). Git for Windows ships a
// real bash next to git itself, so resolve it from `git --exec-path` (the
// test suite needs git anyway). Its bin\ launcher puts the MSYS tools (cat,
// date, sleep, ...) on PATH, which a script spawned from Node needs.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

function gitForWindowsShell(name: 'bash' | 'sh'): string | null {
  const res = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
  if (res.status !== 0) return null;
  // <root>/mingw64/libexec/git-core -> <root>/bin/<name>.exe
  const root = path.resolve(res.stdout.trim(), '..', '..', '..');
  const shell = path.join(root, 'bin', `${name}.exe`);
  return existsSync(shell) ? shell : null;
}

// Without Git for Windows this falls back to the bare name, so a suite fails
// loudly there instead of skipping.
function resolveShell(name: 'bash' | 'sh'): string {
  return (process.platform === 'win32' && gitForWindowsShell(name)) || name;
}

/** The bash to spawn. */
export const BASH = resolveShell('bash');

/** The POSIX sh to spawn. */
export const POSIX_SH = resolveShell('sh');
