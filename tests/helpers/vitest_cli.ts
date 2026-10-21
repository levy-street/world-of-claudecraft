// The installed vitest CLI entry, for suites that spawn a real child vitest.
//
// Spawn it as `process.execPath, [VITEST_CLI, ...args]` rather than through
// `npx`: npx is a .cmd shim on Windows, which a shell-less spawn cannot start
// (ENOENT) and a shell spawn would re-quote. On every platform this is the same
// binary `npx --no-install vitest` resolves, so the child behaves identically.
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

export const VITEST_CLI = path.join(
  path.dirname(require.resolve('vitest/package.json')),
  'vitest.mjs',
);
