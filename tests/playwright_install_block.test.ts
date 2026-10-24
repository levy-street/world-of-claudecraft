import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PLAYWRIGHT_INSTALL_BLOCK } from './helpers/playwright_install_block';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function install(options: { depsExit?: number; browserExit?: number; fonts?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'woc-browser-install-'));
  roots.push(root);
  const trace = join(root, 'trace');
  const marker = join(root, 'fonts');
  const stub = (name: string, body: string) =>
    writeFileSync(join(root, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  writeFileSync(trace, '');
  stub('sudo', 'printf "%s\\n" "$*" >> "$TRACE"; exec "$@"');
  stub('timeout', 'shift 3; exec "$@"');
  stub('node', 'exit "$DEPS_EXIT"');
  stub('npx', 'exit "$BROWSER_EXIT"');
  stub('sed', 'exit 0');
  stub(
    'apt-get',
    'if [ "$1" = install ] && [ "$FONT_INSTALL" = 1 ]; then touch "$FONT_MARKER"; fi',
  );
  stub('fc-list', 'if [ -f "$FONT_MARKER" ]; then echo "CJK font"; fi');
  const script = PLAYWRIGHT_INSTALL_BLOCK.split('\n').slice(1).join('\n');
  const result = spawnSync('bash', ['-e', '-c', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${root}:${process.env.PATH}`,
      TRACE: trace,
      FONT_MARKER: marker,
      DEPS_EXIT: String(options.depsExit ?? 124),
      BROWSER_EXIT: String(options.browserExit ?? 0),
      FONT_INSTALL: options.fonts === false ? '0' : '1',
    },
  });
  return { ...result, trace: readFileSync(trace, 'utf8'), root };
}

// The workflows pin this exact block in ci_workflow/nightly_workflow. Exercise
// its failure branches without privilege changes, package installs or downloads.
describe.skipIf(process.platform === 'win32')('Chromium dependency setup', () => {
  it('runs timeout with installer privileges and falls back after a dependency timeout', () => {
    const result = install();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('install-deps unavailable (exit 124)');
    expect(result.trace).toContain('/etc/apt/apt-mirrors.txt');
    expect(result.trace).toContain('/etc/apt/apt-security-mirrors.txt');
    expect(result.trace).toContain(
      `timeout -k 15 100 ${join(result.root, 'node')} node_modules/playwright/cli.js install-deps chromium`,
    );
    expect(result.trace).toContain('timeout -k 15 60 apt-get update');
    expect(result.trace).toContain(
      'timeout -k 15 90 apt-get install -y --no-install-recommends fonts-noto-cjk',
    );
  });

  it('fails when the fallback cannot provide CJK fonts', () => {
    const result = install({ fonts: false });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('no CJK font coverage by any route');
  });

  it('does not recover a failed browser download through dependency setup', () => {
    const result = install({ browserExit: 9 });
    expect(result.status).toBe(9);
    expect(result.trace).toBe('');
  });

  it('skips the fallback after a successful dependency install', () => {
    const result = install({ depsExit: 0 });
    expect(result.status).toBe(0);
    expect(result.trace).not.toContain('apt-get');
  });
});
