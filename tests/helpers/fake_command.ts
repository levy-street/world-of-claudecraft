// A fake external command (an ffmpeg that runs, an npm that prints junk) for
// suites that drive the gate preflights against a stand-in binary.
//
// POSIX gets the `#!/bin/sh` script these suites always wrote. Windows cannot
// run a shebang script, so there it is a `<name>.cmd` batch file instead: the
// gate spawns its tools with `shell: true` on win32 (scripts/gate.mjs), so
// cmd.exe runs the batch file when given its path, and finds it on PATH under
// the bare name through PATHEXT, exactly as it finds the real npm.cmd.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The `shell` option the gate passes on this platform. */
export const GATE_SHELL = process.platform === 'win32';

/**
 * Write `<dir>/<name>` (POSIX) or `<dir>/<name>.cmd` (Windows) that prints
 * `stdout` (when given) and exits with `exitCode`. Returns the path to spawn.
 */
export function writeFakeCommand(
  dir: string,
  name: string,
  { stdout, exitCode = 0 }: { stdout?: string; exitCode?: number } = {},
): string {
  if (process.platform === 'win32') {
    const file = join(dir, `${name}.cmd`);
    const echo = stdout === undefined ? '' : `echo ${stdout}\r\n`;
    writeFileSync(file, `@echo off\r\n${echo}exit /b ${exitCode}\r\n`);
    return file;
  }
  const file = join(dir, name);
  const echo = stdout === undefined ? '' : `echo "${stdout}"\n`;
  writeFileSync(file, `#!/bin/sh\n${echo}exit ${exitCode}\n`, { mode: 0o755 });
  return file;
}
