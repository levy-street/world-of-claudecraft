import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GATE_SHELL, writeFakeCommand } from './fake_command';
import { BASH, POSIX_SH } from './posix_shell';
import { FILE_SYMLINKS } from './symlink_fixture';
import { VITEST_CLI } from './vitest_cli';

// The Windows-portability fixtures. Every suite that uses them argues "Linux is
// unchanged" from the values pinned here: a symlink probe that started answering
// false off Windows, or a shell resolver that changed its answer there, would turn
// real cases into silent skips or a different binary on CI with everything green.
const WIN32 = process.platform === 'win32';
const require = createRequire(import.meta.url);

describe('portability fixtures', () => {
  it.runIf(!WIN32)('keep their plain POSIX values off Windows', () => {
    expect(FILE_SYMLINKS).toBe(true);
    expect(BASH).toBe('bash');
    expect(POSIX_SH).toBe('sh');
    expect(GATE_SHELL).toBe(false);
  });

  it.runIf(WIN32)('resolve the Git for Windows shells on Windows, never the WSL launcher', () => {
    for (const [shell, name] of [
      [BASH, 'bash.exe'],
      [POSIX_SH, 'sh.exe'],
    ] as const) {
      expect(path.isAbsolute(shell), shell).toBe(true);
      expect(path.basename(shell).toLowerCase()).toBe(name);
      expect(shell.toLowerCase()).not.toContain('system32');
      expect(existsSync(shell)).toBe(true);
    }
    expect(GATE_SHELL).toBe(true);
  });

  it('points VITEST_CLI at the bin vitest itself declares', () => {
    const pkgPath = require.resolve('vitest/package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin: { vitest: string } };
    expect(VITEST_CLI).toBe(path.join(path.dirname(pkgPath), pkg.bin.vitest));
    expect(existsSync(VITEST_CLI)).toBe(true);
  });

  it('writes the same shebang script the preflight suites always wrote off Windows', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'woc-fake-command-'));
    try {
      const file = writeFakeCommand(dir, 'npm', { stdout: 'not json at all', exitCode: 1 });
      if (WIN32) {
        expect(file).toBe(path.join(dir, 'npm.cmd'));
        expect(readFileSync(file, 'utf8')).toBe(
          '@echo off\r\necho not json at all\r\nexit /b 1\r\n',
        );
      } else {
        expect(file).toBe(path.join(dir, 'npm'));
        expect(readFileSync(file, 'utf8')).toBe('#!/bin/sh\necho "not json at all"\nexit 1\n');
        expect(statSync(file).mode & 0o777).toBe(0o755);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
