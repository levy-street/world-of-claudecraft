#!/usr/bin/env node
/**
 * EXPERIMENTAL runner spike (local-gate-perf Phase 10).
 *
 * NOT the default test path. package.json "test" and scripts/gate.mjs stay on
 * Vitest. This script on-demand-installs @miaskiewicz/turbo-test via npx so we
 * never pin it in package.json / pnpm-lock.yaml (lockfile leaves are hashed into
 * shipping asset source fingerprints).
 *
 * Usage:
 *   npm run test:turbo
 *   npm run test:turbo -- --jobs 8 tests/gate_workers.test.ts
 *   TURBO_TEST_JOBS=4 npm run test:turbo
 *
 * Pass-through args go to turbo-test after the default --jobs flag (extra --jobs
 * from the caller wins if placed after).
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const PKG = '@miaskiewicz/turbo-test@0.3.14';
const jobs = process.env.TURBO_TEST_JOBS || '8';
const extra = process.argv.slice(2);

console.error(
  '[test:turbo] EXPERIMENTAL: not the merge-bar runner. Default remains vitest (npm test / gate).',
);

const result = spawnSync('npx', ['--yes', PKG, '--jobs', jobs, ...extra], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});

if (result.error) {
  console.error('[test:turbo] failed to spawn npx:', result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
