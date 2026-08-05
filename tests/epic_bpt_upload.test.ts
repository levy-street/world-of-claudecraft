/**
 * Pins for the optional Epic BPT upload helper: fail-closed without credentials,
 * --help without secrets, no linux os, dry-run never spawns when gated, and the
 * spawn tail (argv handed to BPT, exit-code propagation, spawn-error arm)
 * through the injected execBpt seam. Does not call real BuildPatchTool or
 * network.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error untyped zero-dependency ops tool (scripts/*.mjs convention)
import * as rawBpt from '../scripts/epic-bpt-upload.mjs';

type BptHelpers = {
  DEFAULT_APP_LAUNCH: { win: string; mac: string };
  DEFAULT_BUILD_ROOTS: { win: string; mac: string };
  REQUIRED_ENV_KEYS: readonly string[];
  missingBptEnv: (env: NodeJS.ProcessEnv) => string[];
  parseArgs: (argv: string[]) => { help?: boolean; dryRun?: boolean; errors: string[] };
  resolveUploadPlan: (opts: {
    os: string;
    buildVersion: string;
    env: NodeJS.ProcessEnv;
    repoRoot: string;
  }) => { bptArgs: string[] };
  redactArgsForLog: (args: string[]) => string[];
  runCli: (
    argv: string[],
    opts: {
      env: NodeJS.ProcessEnv;
      log?: (s: string) => void;
      error?: (s: string) => void;
      repoRoot?: string;
      execBpt?: (
        bin: string,
        args: string[],
        env: NodeJS.ProcessEnv,
      ) => { status: number | null; error?: Error | null };
    },
  ) => number;
};

// Narrow the untyped script surface so noImplicitAny stays green under tsc.
const bpt = rawBpt as BptHelpers;

describe('epic-bpt-upload helpers', () => {
  it('lists every required env key (ops BPT family, not server EPIC_CLIENT_SECRET alone)', () => {
    expect(bpt.REQUIRED_ENV_KEYS).toEqual([
      'EPIC_BPT_BIN',
      'EPIC_BPT_ORGANIZATION_ID',
      'EPIC_BPT_PRODUCT_ID',
      'EPIC_BPT_ARTIFACT_ID',
      'EPIC_BPT_CLIENT_ID',
      'EPIC_BPT_CLIENT_SECRET',
      'EPIC_BPT_CLOUD_DIR',
    ]);
  });

  it('missingBptEnv reports all empty keys and none when provisioned', () => {
    expect(bpt.missingBptEnv({})).toEqual(bpt.REQUIRED_ENV_KEYS);
    expect(bpt.missingBptEnv({ EPIC_BPT_BIN: '  ' })).toContain('EPIC_BPT_BIN');
    const full: NodeJS.ProcessEnv = {};
    for (const k of bpt.REQUIRED_ENV_KEYS) full[k] = `x-${k}`;
    expect(bpt.missingBptEnv(full)).toEqual([]);
  });

  it('parseArgs accepts help and dry-run without os', () => {
    expect(bpt.parseArgs(['--help']).help).toBe(true);
    expect(bpt.parseArgs(['--dry-run', '--os', 'win', '--build-version', '1']).dryRun).toBe(true);
  });

  it('parseArgs rejects linux and unknown flags', () => {
    const linux = bpt.parseArgs(['--os', 'linux', '--build-version', '1']);
    expect(linux.errors.some((e) => /linux/i.test(e))).toBe(true);
    const bad = bpt.parseArgs(['--upload-prod']);
    expect(bad.errors.length).toBeGreaterThan(0);
  });

  it('default BuildRoots are loose release-epic dir trees only', () => {
    expect(bpt.DEFAULT_BUILD_ROOTS.win).toContain('release-epic');
    expect(bpt.DEFAULT_BUILD_ROOTS.win).toContain('win-unpacked');
    expect(bpt.DEFAULT_BUILD_ROOTS.mac).toContain('mac-universal');
    expect(bpt.DEFAULT_APP_LAUNCH.win).toMatch(/\.exe$/);
    expect(bpt.DEFAULT_APP_LAUNCH.mac).toContain('.app');
  });

  it('resolveUploadPlan uses ClientSecretEnvVar never inline secret value', () => {
    const plan = bpt.resolveUploadPlan({
      os: 'win',
      buildVersion: '0.1.0-windows',
      env: {
        EPIC_BPT_ORGANIZATION_ID: 'org',
        EPIC_BPT_PRODUCT_ID: 'prod',
        EPIC_BPT_ARTIFACT_ID: 'art',
        EPIC_BPT_CLIENT_ID: 'cid',
        EPIC_BPT_CLIENT_SECRET: 'super-secret-value',
        EPIC_BPT_CLOUD_DIR: '/tmp/cloud',
        EPIC_BPT_BIN: '/tmp/bpt',
      },
      repoRoot: '/repo',
    });
    expect(plan.bptArgs).toContain('-ClientSecretEnvVar=EPIC_BPT_CLIENT_SECRET');
    expect(plan.bptArgs.join(' ')).not.toContain('super-secret-value');
    expect(plan.bptArgs).toContain('-mode=UploadBinary');
    expect(
      plan.bptArgs.some((a) => a.startsWith('-BuildRoot=') && a.includes('win-unpacked')),
    ).toBe(true);
  });

  it('redactArgsForLog strips inline ClientSecret assignments', () => {
    expect(
      bpt.redactArgsForLog(['-ClientSecret=abc', '-ClientSecretEnvVar=EPIC_BPT_CLIENT_SECRET']),
    ).toEqual(['-ClientSecret=<redacted>', '-ClientSecretEnvVar=EPIC_BPT_CLIENT_SECRET']);
  });
});

describe('epic-bpt-upload runCli', () => {
  it('--help exits 0 without credentials', () => {
    const lines: string[] = [];
    const code = bpt.runCli(['--help'], {
      env: {},
      log: (s) => lines.push(s),
      error: (s) => lines.push(s),
    });
    expect(code).toBe(0);
    expect(lines.join('\n')).toMatch(/epic-bpt-upload/);
    expect(lines.join('\n')).toMatch(/EPIC_BPT_CLIENT_SECRET/);
  });

  it('fails closed with exit 1 when credentials missing', () => {
    const errs: string[] = [];
    const code = bpt.runCli(['--os', 'win', '--build-version', '1.0.0'], {
      env: {},
      log: () => {},
      error: (s) => errs.push(s),
    });
    expect(code).toBe(1);
    expect(errs.join('\n')).toMatch(/missing required credentials/i);
    expect(errs.join('\n')).toMatch(/EPIC_BPT_CLIENT_SECRET/);
    expect(errs.join('\n')).not.toMatch(/login with epic/i);
  });

  it('refuses missing --os / --build-version with exit 2', () => {
    expect(
      bpt.runCli([], {
        env: {},
        log: () => {},
        error: () => {},
      }),
    ).toBe(2);
    expect(
      bpt.runCli(['--os', 'win'], {
        env: {},
        log: () => {},
        error: () => {},
      }),
    ).toBe(2);
  });

  it('dry-run works without secrets and never spawns BPT', () => {
    const lines: string[] = [];
    let spawned = false;
    const code = bpt.runCli(['--dry-run', '--os', 'win', '--build-version', '1.0.0-test'], {
      env: {},
      repoRoot: '/tmp',
      execBpt: () => {
        spawned = true;
        return { status: 0 };
      },
      log: (s) => lines.push(s),
      error: (s) => lines.push(s),
    });
    expect(code).toBe(0);
    expect(spawned).toBe(false);
    expect(lines.join('\n')).toMatch(/dry-run only/i);
    expect(lines.join('\n')).toMatch(/missing env/i);
  });

  it('real upload path fails closed before spawn when bin missing', () => {
    const full: NodeJS.ProcessEnv = {};
    for (const k of bpt.REQUIRED_ENV_KEYS) full[k] = `/nonexistent-${k}`;
    full.EPIC_BPT_BIN = '/nonexistent/BuildPatchTool';
    full.EPIC_BPT_CLOUD_DIR = '/tmp';
    let spawned = false;
    const code = bpt.runCli(['--os', 'win', '--build-version', '1.0.0-test'], {
      env: full,
      repoRoot: '/tmp',
      execBpt: () => {
        spawned = true;
        return { status: 0 };
      },
      log: () => {},
      error: () => {},
    });
    expect(code).toBe(1);
    expect(spawned).toBe(false);
  });

  // The spawn tail through the injected execBpt seam: a fully provisioned run
  // must actually hand BPT the resolved bin and argv, propagate a non-zero BPT
  // exit code, and map a spawn failure to exit 1. Fixtures are a temp file
  // (the "binary") and a temp dir (the BuildRoot); no real BPT, no network.
  function provisionedFixture(): { env: NodeJS.ProcessEnv; bin: string; buildRoot: string } {
    const root = mkdtempSync(join(tmpdir(), 'woc-bpt-test-'));
    const bin = join(root, 'BuildPatchTool');
    writeFileSync(bin, '#!/bin/sh\n');
    const buildRoot = join(root, 'win-unpacked');
    mkdirSync(buildRoot);
    const env: NodeJS.ProcessEnv = {};
    for (const k of bpt.REQUIRED_ENV_KEYS) env[k] = `x-${k}`;
    env.EPIC_BPT_BIN = bin;
    env.EPIC_BPT_BUILD_ROOT = buildRoot;
    return { env, bin, buildRoot };
  }

  it('a provisioned run spawns BPT with the resolved bin and UploadBinary argv (secret only by env var name)', () => {
    const { env, bin, buildRoot } = provisionedFixture();
    const received: { bin: string; args: string[] }[] = [];
    const code = bpt.runCli(['--os', 'win', '--build-version', '1.2.3-win'], {
      env,
      repoRoot: '/tmp',
      execBpt: (spawnBin, args) => {
        received.push({ bin: spawnBin, args });
        return { status: 0 };
      },
      log: () => {},
      error: () => {},
    });
    expect(code).toBe(0);
    expect(received).toHaveLength(1);
    expect(received[0].bin).toBe(bin);
    expect(received[0].args).toContain('-mode=UploadBinary');
    expect(received[0].args).toContain('-BuildVersion=1.2.3-win');
    expect(received[0].args).toContain(`-BuildRoot=${buildRoot}`);
    expect(received[0].args).toContain('-ClientSecretEnvVar=EPIC_BPT_CLIENT_SECRET');
    // The secret VALUE never rides argv, only the env var name above.
    expect(received[0].args.join(' ')).not.toContain('x-EPIC_BPT_CLIENT_SECRET');
  });

  it('propagates a non-zero BPT exit code as its own', () => {
    const { env } = provisionedFixture();
    const code = bpt.runCli(['--os', 'win', '--build-version', '1.2.3-win'], {
      env,
      repoRoot: '/tmp',
      execBpt: () => ({ status: 7 }),
      log: () => {},
      error: () => {},
    });
    expect(code).toBe(7);
  });

  it('maps a spawn failure (error, null status) to exit 1', () => {
    const { env } = provisionedFixture();
    const errs: string[] = [];
    const code = bpt.runCli(['--os', 'win', '--build-version', '1.2.3-win'], {
      env,
      repoRoot: '/tmp',
      execBpt: () => ({ status: null, error: new Error('spawn ENOENT') }),
      log: () => {},
      error: (s) => errs.push(s),
    });
    expect(code).toBe(1);
    expect(errs.join('\n')).toMatch(/failed to spawn/i);
  });
});
