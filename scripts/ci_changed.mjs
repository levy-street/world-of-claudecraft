#!/usr/bin/env node
// Thin orchestrator for `npm run ci:changed`: resolves the correct local
// `--since` ref (scripts/lib/ci_changed_base.mjs, backed by
// scripts/lib/gate_discovery.mjs's resolveSelectBase) and execs biome with
// it, mirroring the `lint` job in .github/workflows/ci.yml. See
// ci_changed_base.mjs's header for why a bare `biome ci --changed` is wrong
// here.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveChangedBaseRef } from './lib/ci_changed_base.mjs';
import { buildBiomeArgs } from './lib/ci_changed_biome_args.mjs';

// npm/npx resolve to .cmd files on Windows, which spawnSync only finds via a
// shell (same pattern as scripts/gate.mjs and scripts/gate_fast.mjs).
const shell = process.platform === 'win32';

// The npm script always runs from repo root, but pin cwd explicitly anyway
// so `run()` never silently scans the wrong subtree if that ever changes
// (e.g. invoked directly from a subdirectory).
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @type {(cmd: string, args: string[]) => { status: number | null, stdout?: string, stderr?: string }} */
function run(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', shell, cwd: REPO_ROOT });
  if (res.error !== undefined) {
    // Surface the real spawn failure (e.g. git not on PATH) instead of
    // letting a generic "status: null" reach resolveChangedBaseRef's caller.
    return {
      status: res.status,
      stdout: res.stdout,
      stderr: `${res.error.message}\n${res.stderr ?? ''}`,
    };
  }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

let since;
try {
  since = resolveChangedBaseRef({ env: process.env, run });
} catch (err) {
  console.error(`[ci:changed] ${err.message}`);
  process.exit(1);
}

console.log(`[ci:changed] --since=${since}`);

const result = spawnSync('npx', buildBiomeArgs(since), { stdio: 'inherit', shell });

if (result.error !== undefined) {
  console.error(`[ci:changed] failed to spawn biome: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
