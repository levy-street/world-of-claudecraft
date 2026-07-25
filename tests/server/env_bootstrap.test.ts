import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadServerEnv } from '../../server/env';

// REALM_NAME (and any other import-time config read) silently fell back to its
// default when set only in .env: server/realm.ts evaluated process.env before
// server/db.ts's module body had loaded the file. The fix is server/env.ts, a
// bootstrap module the entry point imports FIRST. These tests pin both halves:
// the loader itself, and the import order that makes it run early enough.

describe('loadServerEnv', () => {
  const cleanupKeys: string[] = [];
  let savedCwd: string | null = null;
  let tempDir: string | null = null;

  afterEach(() => {
    for (const k of cleanupKeys.splice(0)) delete process.env[k];
    if (savedCwd !== null) {
      process.chdir(savedCwd);
      savedCwd = null;
    }
    if (tempDir !== null) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('loads .env from the working directory into process.env', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'env-bootstrap-'));
    writeFileSync(
      join(tempDir, '.env'),
      'ENV_BOOTSTRAP_TEST_REALM=TestRealm\nENV_BOOTSTRAP_TEST_FLAG=1\n',
    );
    cleanupKeys.push('ENV_BOOTSTRAP_TEST_REALM', 'ENV_BOOTSTRAP_TEST_FLAG');
    savedCwd = process.cwd();
    process.chdir(tempDir);

    loadServerEnv();

    expect(process.env.ENV_BOOTSTRAP_TEST_REALM).toBe('TestRealm');
    expect(process.env.ENV_BOOTSTRAP_TEST_FLAG).toBe('1');
  });

  it('is a no-op without a .env file (production injects real env vars)', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'env-bootstrap-'));
    savedCwd = process.cwd();
    process.chdir(tempDir);

    expect(() => loadServerEnv()).not.toThrow();
  });
});

describe('entry-point import order (the actual bug)', () => {
  it('server/main.ts imports ./env before any other server-local module', () => {
    const src = readFileSync(resolve(process.cwd(), 'server/main.ts'), 'utf8');
    const imports = [...src.matchAll(/^import\s+(?:[^;]*?from\s+)?'([^']+)'/gms)].map((m) => m[1]);
    const localImports = imports.filter((s) => s.startsWith('./') || s.startsWith('../'));
    expect(
      localImports[0],
      'server/main.ts must import ./env FIRST: realm.ts (and any module reading ' +
        'process.env at import time) evaluates before db.ts loads .env otherwise',
    ).toBe('./env');
  });

  it('server/db.ts delegates its .env load to the shared bootstrap', () => {
    const src = readFileSync(resolve(process.cwd(), 'server/db.ts'), 'utf8');
    expect(src).toMatch(/import '\.\/env';/);
    expect(src, 'db.ts must not keep its own inline loadEnvFile calls').not.toMatch(
      /process\.loadEnvFile/,
    );
  });
});
