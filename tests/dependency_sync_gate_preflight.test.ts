import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// `npm ls --depth=0 --json` reads only the local package.json + node_modules
// metadata (no registry hit), so a throwaway fixture directory reproduces every
// arm of the check deterministically and fast, without touching this repo's own
// node_modules. scripts/gate.mjs is spawned by absolute path so its own relative
// imports (./sfx/ffmpeg_paths.mjs) still resolve from the real repo while the
// child process's cwd (and therefore npm ls's target) is the fixture.
//
// Every case here (except the escape-hatch one) also forces the NEXT preflight
// (ffmpeg/ffprobe) to fail via WOC_FFMPEG_PATH/WOC_FFPROBE_PATH pointed at a
// nonexistent binary. That keeps every test fast and gives a positive signal
// that dependency-sync ran and either blocked (its own message wins) or passed
// through (the ffmpeg message wins) rather than the process just exiting 0 for
// an unrelated reason.
const GATE_SCRIPT = resolve(process.cwd(), 'scripts/gate.mjs');
const FORCE_FFMPEG_FAIL = {
  WOC_FFMPEG_PATH: '/nonexistent/woc-preflight/ffmpeg',
  WOC_FFPROBE_PATH: '/nonexistent/woc-preflight/ffprobe',
};
const FFMPEG_FAIL_MESSAGE = 'missing required SFX audio tooling: ffmpeg, ffprobe';

function withFixtureDir(run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'woc-depsync-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('dependency-sync gate preflight', () => {
  it('fails fast, before the ffmpeg probe, on both invalid and missing dependencies', () => {
    withFixtureDir((dir) => {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          name: 'fixture',
          version: '1.0.0',
          dependencies: { fakepkg: '^1.0.0', 'missing-pkg': '^1.0.0' },
        }),
      );
      const nodeModules = join(dir, 'node_modules', 'fakepkg');
      mkdirSync(nodeModules, { recursive: true });
      writeFileSync(
        join(nodeModules, 'package.json'),
        JSON.stringify({ name: 'fakepkg', version: '2.0.0' }),
      );
      // missing-pkg is declared but deliberately never installed.

      const result = spawnSync(process.execPath, [GATE_SCRIPT], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, ...FORCE_FFMPEG_FAIL },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('[gate] FAIL at "dependency sync"');
      expect(result.stderr).toContain(
        'node_modules does not match what package-lock.json would install',
      );
      expect(result.stderr).toContain('invalid: fakepkg@2.0.0');
      expect(result.stderr).toContain('missing: missing-pkg@^1.0.0');
      expect(result.stderr).toContain('Run `npm ci` to reinstall exactly what the lockfile pins');
      expect(result.stdout).not.toContain('[gate] i18n artifacts');
      // Must be the dependency-sync message that wins the race, not the forced
      // ffmpeg failure further down the preflight chain.
      expect(result.stderr).not.toContain(FFMPEG_FAIL_MESSAGE);
    });
  });

  it('does not block the gate on a tree with no invalid or missing dependencies', () => {
    withFixtureDir((dir) => {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: { fakepkg: '^1.0.0' } }),
      );
      const nodeModules = join(dir, 'node_modules', 'fakepkg');
      mkdirSync(nodeModules, { recursive: true });
      // Installed version SATISFIES the declared range: npm ls reports no problems
      // for this package, so this fixture genuinely exercises the check passing,
      // unlike forcing an empty PATH (which would skip the check entirely).
      writeFileSync(
        join(nodeModules, 'package.json'),
        JSON.stringify({ name: 'fakepkg', version: '1.2.0' }),
      );

      const result = spawnSync(process.execPath, [GATE_SCRIPT], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, ...FORCE_FFMPEG_FAIL },
      });

      expect(result.stderr).not.toContain('dependency sync');
      expect(result.stderr).not.toContain('does not match what package-lock.json');
      // Proves execution actually reached and ran the check (not merely skipped
      // it) and continued past it to the next preflight.
      expect(result.stderr).toContain(FFMPEG_FAIL_MESSAGE);
    });
  });

  it('does not block on an extraneous-only tree (no declared dependency is wrong or missing)', () => {
    withFixtureDir((dir) => {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'fixture', version: '1.0.0' }),
      );
      const nodeModules = join(dir, 'node_modules', 'leftover');
      mkdirSync(nodeModules, { recursive: true });
      writeFileSync(
        join(nodeModules, 'package.json'),
        JSON.stringify({ name: 'leftover', version: '1.0.0' }),
      );

      const result = spawnSync(process.execPath, [GATE_SCRIPT], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, ...FORCE_FFMPEG_FAIL },
      });

      expect(result.stderr).not.toContain('dependency sync');
      expect(result.stderr).toContain(FFMPEG_FAIL_MESSAGE);
    });
  });

  it('warns and continues when npm ran but did not produce parseable JSON', () => {
    withFixtureDir((dir) => {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'fixture', version: '1.0.0' }),
      );
      const fakeNpmDir = mkdtempSync(join(tmpdir(), 'woc-depsync-fakenpm-'));
      const fakeNpm = join(fakeNpmDir, 'npm');
      writeFileSync(fakeNpm, '#!/bin/sh\necho "not json at all"\nexit 1\n', { mode: 0o755 });
      try {
        const result = spawnSync(process.execPath, [GATE_SCRIPT], {
          cwd: dir,
          encoding: 'utf8',
          env: {
            ...process.env,
            ...FORCE_FFMPEG_FAIL,
            PATH: `${fakeNpmDir}${delimiter}${process.env.PATH ?? ''}`,
          },
        });

        expect(result.stderr).toContain('[gate] WARN: dependency sync check skipped');
        expect(result.stderr).not.toContain('[gate] FAIL at "dependency sync"');
        // Still proceeds to (and fails at) the next preflight rather than exiting clean.
        expect(result.stderr).toContain(FFMPEG_FAIL_MESSAGE);
      } finally {
        rmSync(fakeNpmDir, { recursive: true, force: true });
      }
    });
  });

  it('WOC_SKIP_DEP_SYNC=1 bypasses the check entirely, even on a drifted tree', () => {
    withFixtureDir((dir) => {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: { fakepkg: '^1.0.0' } }),
      );
      const nodeModules = join(dir, 'node_modules', 'fakepkg');
      mkdirSync(nodeModules, { recursive: true });
      writeFileSync(
        join(nodeModules, 'package.json'),
        JSON.stringify({ name: 'fakepkg', version: '2.0.0' }),
      );

      const result = spawnSync(process.execPath, [GATE_SCRIPT], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, ...FORCE_FFMPEG_FAIL, WOC_SKIP_DEP_SYNC: '1' },
      });

      expect(result.stderr).not.toContain('dependency sync');
      expect(result.stderr).toContain(FFMPEG_FAIL_MESSAGE);
    });
  });
});
