import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoDir = path.join(__dirname, '..');
const buildAssetsPath = path.join(repoDir, 'scripts/assets/build_assets.mjs');

function runBuildAssets(args: string[]) {
  return spawnSync(process.execPath, [buildAssetsPath, ...args], {
    cwd: repoDir,
    encoding: 'utf8',
    timeout: 20_000,
  });
}

function writeCopySpec(root: string, out: string): { sourcePath: string; specPath: string } {
  const sourcePath = path.join(root, 'fixture-source.bin');
  const specPath = path.join(root, 'fixture-spec.json');
  writeFileSync(sourcePath, Buffer.from('deterministic build-assets fixture\n', 'utf8'));
  writeFileSync(
    specPath,
    `${JSON.stringify({ items: [{ src: sourcePath, out, type: 'copy' }] }, null, 2)}\n`,
  );
  return { sourcePath, specPath };
}

describe('build_assets --output-root CLI', () => {
  it('writes deterministic copy outputs only beneath each isolated root', () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'wocc-build-assets-positive-'));
    try {
      const out = 'models/props/output-root-contract.bin';
      const { sourcePath, specPath } = writeCopySpec(fixtureRoot, out);
      const firstRoot = path.join(fixtureRoot, 'first-output');
      const secondRoot = path.join(fixtureRoot, 'second-output');
      const publicPath = path.join(repoDir, 'public', out);
      const publicExistedBefore = existsSync(publicPath);

      const first = runBuildAssets([specPath, '--output-root', firstRoot]);
      const second = runBuildAssets(['--output-root', secondRoot, specPath]);

      expect(first.status, first.stderr).toBe(0);
      expect(second.status, second.stderr).toBe(0);
      const sourceBytes = readFileSync(sourcePath);
      const firstBytes = readFileSync(path.join(firstRoot, out));
      const secondBytes = readFileSync(path.join(secondRoot, out));
      expect(firstBytes).toEqual(sourceBytes);
      expect(secondBytes).toEqual(sourceBytes);
      expect(secondBytes).toEqual(firstBytes);
      expect(existsSync(publicPath)).toBe(publicExistedBefore);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('preserves public/ as the default output root when the option is omitted', () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'wocc-build-assets-default-'));
    const out = `models/props/.build-assets-default-${process.pid}-${path.basename(fixtureRoot)}.bin`;
    const publicPath = path.join(repoDir, 'public', out);
    try {
      const { sourcePath, specPath } = writeCopySpec(fixtureRoot, out);
      const result = runBuildAssets([specPath]);

      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(publicPath)).toEqual(readFileSync(sourcePath));
    } finally {
      rmSync(publicPath, { force: true });
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('rejects --output-root without its required directory argument', () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'wocc-build-assets-missing-'));
    try {
      const { specPath } = writeCopySpec(fixtureRoot, 'models/props/unused.bin');
      const result = runBuildAssets([specPath, '--output-root']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('usage: --output-root <directory>');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('rejects traversal outside the output root and writes no escaped file', () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'wocc-build-assets-traversal-'));
    try {
      const outputRoot = path.join(fixtureRoot, 'isolated-output');
      mkdirSync(outputRoot, { recursive: true });
      const escapedPath = path.join(fixtureRoot, 'escaped.bin');
      const { specPath } = writeCopySpec(fixtureRoot, '../escaped.bin');

      const result = runBuildAssets([specPath, '--output-root', outputRoot]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('output path escapes output root: ../escaped.bin');
      expect(result.stderr).toContain('1 item(s) failed');
      expect(existsSync(escapedPath)).toBe(false);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
