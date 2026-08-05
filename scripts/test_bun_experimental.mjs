#!/usr/bin/env node
/**
 * EXPERIMENTAL Bun test spike (local-gate-perf Phase 10).
 *
 * NOT the default test path. package.json "test" and scripts/gate.mjs stay on
 * Vitest. Requires a local `bun` binary (not installed by this repo).
 *
 * Usage:
 *   npm run test:bun
 *   npm run test:bun -- tests/gate_workers.test.ts
 *   npm run test:bun -- vitest run --maxWorkers=4 tests/gate_workers.test.ts
 *
 * Modes:
 * - No args, or args that look like test paths / bun-test flags: `bun test ...`
 * - First arg is `vitest` or `run`: `bunx vitest ...` / `bun run ...` host mode
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const extra = process.argv.slice(2);

console.error(
  '[test:bun] EXPERIMENTAL: not the merge-bar runner. Default remains vitest (npm test / gate).',
);

const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['bun'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
if (which.status !== 0) {
  console.error('[test:bun] bun not found on PATH. Install Bun or skip this spike.');
  process.exit(1);
}

/** @type {string[]} */
let argv;
if (extra.length === 0) {
  argv = ['test'];
} else if (extra[0] === 'vitest') {
  argv = ['x', 'vitest', ...extra.slice(1)];
} else if (extra[0] === 'run') {
  argv = ['run', ...extra.slice(1)];
} else if (extra[0] === 'test') {
  argv = extra;
} else {
  argv = ['test', ...extra];
}

const result = spawnSync('bun', argv, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});

if (result.error) {
  console.error('[test:bun] failed to spawn bun:', result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
