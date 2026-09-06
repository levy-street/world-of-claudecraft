#!/usr/bin/env node

// Thin Node launcher. The audit itself remains TypeScript so Vitest and the
// offline CLI exercise one implementation. It only reads the explicit path
// supplied by the caller and never loads env files or opens a database.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./material_source_audit.ts', import.meta.url));
const result = spawnSync(
  process.execPath,
  ['--import', 'tsx/esm', script, ...process.argv.slice(2)],
  {
    stdio: 'inherit',
  },
);

process.exitCode = result.status ?? 2;
