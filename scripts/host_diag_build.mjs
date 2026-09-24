#!/usr/bin/env node
// Builds electron/host_diag/dist/HostDiag.ps1, the single-file Windows host
// diagnostic the Electron client ships, from the sources in
// electron/host_diag/win/.
//
//   node scripts/host_diag_build.mjs            write dist/HostDiag.ps1 + dist/manifest.json
//   node scripts/host_diag_build.mjs --check    verify the committed dist is fresh (writes nothing)
//
// Thin on purpose: every transform lives in scripts/lib/host_diag_bundle.mjs,
// which tests/host_diag_bundle.test.ts drives directly.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bundleHostDiag,
  parseHostDiagMeta,
  sha256Hex,
  toShippedBytes,
} from './lib/host_diag_bundle.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WIN_DIR = join(ROOT, 'electron', 'host_diag', 'win');
const DIST_DIR = join(ROOT, 'electron', 'host_diag', 'dist');
const SCRIPT_NAME = 'HostDiag.ps1';

const readDirFiles = (dir, suffix) =>
  readdirSync(dir)
    .filter((name) => name.endsWith(suffix))
    .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));

/** Reads the committed sources and returns the exact bytes dist/HostDiag.ps1
 *  should hold, plus the manifest that pins them. */
function buildHostDiag() {
  const orchestrator = readFileSync(join(WIN_DIR, 'Invoke-HostDiag.ps1'), 'utf8');
  const bytes = toShippedBytes(
    bundleHostDiag({
      orchestrator,
      csFiles: readDirFiles(join(WIN_DIR, 'lib'), '.cs'),
      libPsFiles: readDirFiles(join(WIN_DIR, 'lib'), '.ps1'),
      collectorPsFiles: readDirFiles(join(WIN_DIR, 'collectors'), '.ps1'),
    }),
  );
  const { toolVersion, schemaVersion } = parseHostDiagMeta(orchestrator);
  const manifest = { file: SCRIPT_NAME, sha256: sha256Hex(bytes), toolVersion, schemaVersion };
  return { bytes, manifest, manifestText: `${JSON.stringify(manifest, null, 2)}\n` };
}

const readCommitted = (name) => {
  try {
    return readFileSync(join(DIST_DIR, name));
  } catch {
    return null;
  }
};

const built = buildHostDiag();

if (process.argv.includes('--check')) {
  const stale = [];
  const script = readCommitted(SCRIPT_NAME);
  if (!script) stale.push(`dist/${SCRIPT_NAME} is missing`);
  else if (!script.equals(built.bytes)) {
    stale.push(
      `dist/${SCRIPT_NAME} differs from a fresh build (committed sha256 ${sha256Hex(script)}, fresh ${built.manifest.sha256})`,
    );
  }
  const manifest = readCommitted('manifest.json');
  if (!manifest) stale.push('dist/manifest.json is missing');
  else if (manifest.toString('utf8') !== built.manifestText) {
    stale.push('dist/manifest.json differs from a fresh build');
  }
  if (stale.length) {
    console.error(`host-diag: committed dist is stale.\n  ${stale.join('\n  ')}`);
    console.error('  Run `npm run host-diag:build` and commit the result.');
    process.exit(1);
  }
  console.log(`host-diag: dist is fresh (sha256 ${built.manifest.sha256}).`);
} else {
  mkdirSync(DIST_DIR, { recursive: true });
  writeFileSync(join(DIST_DIR, SCRIPT_NAME), built.bytes);
  writeFileSync(join(DIST_DIR, 'manifest.json'), built.manifestText);
  console.log(
    `host-diag: wrote dist/${SCRIPT_NAME} (${built.bytes.length} bytes, sha256 ${built.manifest.sha256}), tool ${built.manifest.toolVersion}, schema ${built.manifest.schemaVersion}.`,
  );
}
